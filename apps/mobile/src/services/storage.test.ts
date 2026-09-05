import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { sha256 } from 'js-sha256';

jest.mock('../theme', () => ({
  defaultAccentId: 'iceBlue',
  isBuiltInAccentId: jest.fn(() => false),
}));

import { StorageService } from './storage';

describe('StorageService legacy connections and config backups', () => {
  const mockedAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
  const mockedSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;
  let secureStoreValues: Record<string, string>;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    secureStoreValues = {};
    mockedSecureStore.getItemAsync.mockImplementation(async (key: string) => secureStoreValues[key] ?? null);
    mockedSecureStore.setItemAsync.mockImplementation(async (key: string, value: string) => {
      secureStoreValues[key] = value;
    });
    mockedSecureStore.deleteItemAsync.mockImplementation(async (key: string) => {
      delete secureStoreValues[key];
    });
  });

  it('saves backups with a timestamped key prefix', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_710_000_000_000);
    jest.spyOn(Math, 'random').mockReturnValue(0.123456789);

    const summary = await StorageService.saveGatewayConfigBackup({
      gateway: { auth: { token: 'secret' } },
    });

    expect(summary.createdAt).toBe(1_710_000_000_000);
    expect(summary.id).toBe('clawket.gatewayConfigBackup.v1.1710000000000.4fzzzx');
    expect(mockedAsyncStorage.setItem).toHaveBeenCalledWith(
      'clawket.gatewayConfigBackup.v1.1710000000000.4fzzzx',
      JSON.stringify({
        version: 1,
        id: 'clawket.gatewayConfigBackup.v1.1710000000000.4fzzzx',
        createdAt: 1_710_000_000_000,
        config: {
          gateway: { auth: { token: 'secret' } },
        },
      }),
    );
  });

  it('lists valid backups sorted by newest first', async () => {
    mockedAsyncStorage.getAllKeys.mockResolvedValue([
      'clawket.gatewayConfigBackup.v1.100.a',
      'clawket.gatewayConfigBackup.v1.200.b',
      'other.key',
    ]);
    mockedAsyncStorage.multiGet.mockResolvedValue([
      [
        'clawket.gatewayConfigBackup.v1.100.a',
        JSON.stringify({
          version: 1,
          id: 'clawket.gatewayConfigBackup.v1.100.a',
          createdAt: 100,
          config: { first: true },
        }),
      ],
      [
        'clawket.gatewayConfigBackup.v1.200.b',
        JSON.stringify({
          version: 1,
          id: 'clawket.gatewayConfigBackup.v1.200.b',
          createdAt: 200,
          config: { second: true },
        }),
      ],
    ]);

    const backups = await StorageService.listGatewayConfigBackups();

    expect(backups).toEqual([
      { id: 'clawket.gatewayConfigBackup.v1.200.b', createdAt: 200 },
      { id: 'clawket.gatewayConfigBackup.v1.100.a', createdAt: 100 },
    ]);
  });

  it('reads a single backup entry by id', async () => {
    mockedAsyncStorage.getItem.mockResolvedValue(
      JSON.stringify({
        version: 1,
        id: 'clawket.gatewayConfigBackup.v1.300.c',
        createdAt: 300,
        config: { agents: { defaults: {} } },
      }),
    );

    const backup = await StorageService.getGatewayConfigBackup('clawket.gatewayConfigBackup.v1.300.c');

    expect(backup).toEqual({
      version: 1,
      id: 'clawket.gatewayConfigBackup.v1.300.c',
      createdAt: 300,
      config: { agents: { defaults: {} } },
    });
  });

  it('deletes a single backup entry by id', async () => {
    await StorageService.deleteGatewayConfigBackup('clawket.gatewayConfigBackup.v1.300.c');

    expect(mockedAsyncStorage.removeItem).toHaveBeenCalledWith(
      'clawket.gatewayConfigBackup.v1.300.c',
    );
  });

  it('reads the latest legacy Relay config without rewriting its retained key', async () => {
    const retainedValue = JSON.stringify({
      activeId: 'relay_1',
      configs: [{
        id: 'relay_1',
        name: 'Relay Gateway',
        mode: 'relay',
        url: 'wss://relay.example.com/ws',
        relay: {
          serverUrl: 'https://registry.example.com',
          gatewayId: 'gw_123',
          clientToken: 'gct_new',
          protocolVersion: 2,
          supportsBootstrap: true,
        },
        createdAt: 1,
        updatedAt: 1,
      }],
    });
    secureStoreValues['clawket.gatewayConfigsState.v1'] = retainedValue;

    await expect(StorageService.readLegacyGatewayConfigsState()).resolves.toEqual({
      activeId: 'relay_1',
      configs: [expect.objectContaining({
        id: 'relay_1',
        url: 'wss://relay.example.com/ws',
        token: undefined,
        password: undefined,
        backendKind: 'openclaw',
        transportKind: 'relay',
        mode: 'relay',
        hermes: undefined,
        relay: {
          serverUrl: 'https://registry.example.com',
          gatewayId: 'gw_123',
          clientToken: 'gct_new',
          displayName: undefined,
          protocolVersion: 2,
          supportsBootstrap: true,
        },
      })],
    });
    expect(secureStoreValues['clawket.gatewayConfigsState.v1']).toBe(retainedValue);
    expect(mockedSecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(mockedSecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('migrates legacy profile configs with explicit OpenClaw backend and transport metadata', async () => {
    secureStoreValues['clawket.gatewayProfilesConfig.v1'] = JSON.stringify({
      activeMode: 'tailscale',
      local: {
        url: 'http://127.0.0.1:8080',
        token: 'local-token',
      },
      tailscale: {
        url: 'http://gateway.tailnet.ts.net:8080',
        token: 'tailscale-token',
      },
      cloudflare: {
        url: '',
      },
    });

    const state = await StorageService.readLegacyGatewayConfigsState();

    expect(state.activeId).toBe('legacy_tailscale');
    expect(state.configs).toEqual([
      expect.objectContaining({
        id: 'legacy_local',
        backendKind: 'openclaw',
        transportKind: 'local',
        mode: 'local',
        url: 'http://127.0.0.1:8080',
        token: 'local-token',
      }),
      expect.objectContaining({
        id: 'legacy_tailscale',
        backendKind: 'openclaw',
        transportKind: 'tailscale',
        mode: 'tailscale',
        url: 'http://gateway.tailnet.ts.net:8080',
        token: 'tailscale-token',
      }),
    ]);
    expect(mockedSecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(mockedSecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('migrates the legacy single gateway config with explicit OpenClaw metadata', async () => {
    secureStoreValues['clawket.gatewayConfig.v1'] = JSON.stringify({
      url: 'http://127.0.0.1:8080',
      token: 'legacy-token',
      password: 'legacy-password',
    });

    const state = await StorageService.readLegacyGatewayConfigsState();

    expect(state).toEqual({
      activeId: 'legacy_single',
      configs: [
        expect.objectContaining({
          id: 'legacy_single',
          name: 'Gateway',
          backendKind: 'openclaw',
          transportKind: 'local',
          mode: 'local',
          url: 'http://127.0.0.1:8080',
          token: 'legacy-token',
          password: 'legacy-password',
        }),
      ],
    });
    expect(mockedSecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(mockedSecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('clears all retained legacy connection keys only during an explicit device reset', async () => {
    secureStoreValues['clawket.gatewayConfig.v1'] = '{"url":"ws://legacy"}';
    secureStoreValues['clawket.gatewayProfilesConfig.v1'] = '{"activeMode":"local"}';
    secureStoreValues['clawket.gatewayConfigsState.v1'] = '{"activeId":null,"configs":[]}';
    secureStoreValues['clawket.identity.v1'] = '{"deviceId":"keep"}';

    await StorageService.clearLegacyGatewayConfig();

    expect(secureStoreValues).toEqual({
      'clawket.identity.v1': '{"deviceId":"keep"}',
    });
    expect(mockedSecureStore.deleteItemAsync.mock.calls.map(([key]) => key)).toEqual([
      'clawket.gatewayConfig.v1',
      'clawket.gatewayProfilesConfig.v1',
      'clawket.gatewayConfigsState.v1',
    ]);
  });

  it('stores relay device tokens under a gateway-scoped key', async () => {
    await StorageService.setDeviceToken('device-1', 'token-a', {
      serverUrl: 'https://registry.example.com/',
      gatewayId: 'gw_alpha',
    });

    expect(secureStoreValues).toEqual({
      [`clawket.deviceToken.device-1_relay_${sha256('https://registry.example.com::gw_alpha')}`]: 'token-a',
    });
  });

  it('keeps device tokens isolated across relay gateways for the same device id', async () => {
    await StorageService.setDeviceToken('device-1', 'token-a', {
      serverUrl: 'https://registry.example.com',
      gatewayId: 'gw_alpha',
    });
    await StorageService.setDeviceToken('device-1', 'token-b', {
      serverUrl: 'https://registry.example.com',
      gatewayId: 'gw_beta',
    });

    await expect(StorageService.getDeviceToken('device-1', {
      serverUrl: 'https://registry.example.com',
      gatewayId: 'gw_alpha',
    })).resolves.toBe('token-a');
    await expect(StorageService.getDeviceToken('device-1', {
      serverUrl: 'https://registry.example.com',
      gatewayId: 'gw_beta',
    })).resolves.toBe('token-b');
  });

  it('keeps operator and node device tokens isolated on the same connection', async () => {
    const connectionScope = {
      serverUrl: 'https://registry.example.com',
      gatewayId: 'gw_alpha',
    };
    await StorageService.setDeviceTokenRecord('device-1', {
      token: 'operator-token',
      role: 'operator',
      scopes: ['operator.read'],
    }, connectionScope);
    await StorageService.setDeviceTokenRecord('device-1', {
      token: 'node-token',
      role: 'node',
      scopes: [],
    }, { ...connectionScope, role: 'node' });

    await expect(StorageService.getDeviceTokenRecord('device-1', connectionScope)).resolves.toMatchObject({
      token: 'operator-token',
      role: 'operator',
    });
    await expect(StorageService.getDeviceTokenRecord('device-1', {
      ...connectionScope,
      role: 'node',
    })).resolves.toMatchObject({
      token: 'node-token',
      role: 'node',
    });
    expect(Object.keys(secureStoreValues)).toEqual(expect.arrayContaining([
      `clawket.deviceToken.device-1_relay_${sha256('https://registry.example.com::gw_alpha')}`,
      `clawket.deviceToken.device-1_relay_${sha256('https://registry.example.com::gw_alpha')}_role_${sha256('node')}`,
    ]));
  });

  it('falls back to the legacy unscoped device token key when no scoped token exists', async () => {
    secureStoreValues['clawket.deviceToken.device-1'] = 'legacy-token';

    await expect(StorageService.getDeviceToken('device-1', {
      serverUrl: 'https://registry.example.com',
      gatewayId: 'gw_alpha',
    })).resolves.toBe('legacy-token');
  });

  it('never offers a legacy operator token to a node role lookup', async () => {
    secureStoreValues['clawket.deviceToken.device-1'] = 'legacy-token';

    await expect(StorageService.getDeviceToken('device-1', {
      serverUrl: 'https://registry.example.com',
      gatewayId: 'gw_alpha',
      role: 'node',
    })).resolves.toBeNull();
  });

  it('migrates raw device tokens to operator records with unknown scopes', async () => {
    secureStoreValues['clawket.deviceToken.device-1'] = 'legacy-token';

    await expect(StorageService.getDeviceTokenRecord('device-1', {
      serverUrl: 'https://registry.example.com',
      gatewayId: 'gw_alpha',
    })).resolves.toEqual({
      version: 1,
      token: 'legacy-token',
      role: 'operator',
      scopes: [],
      updatedAtMs: 0,
    });
  });

  it('persists normalized device token role and scopes as one secure record', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    await StorageService.setDeviceTokenRecord('device-1', {
      token: ' operator-token ',
      role: ' operator ',
      scopes: ['operator.write', 'operator.read', 'operator.write'],
    }, {
      serverUrl: 'https://registry.example.com/',
      gatewayId: 'gw_alpha',
    });

    await expect(StorageService.getDeviceTokenRecord('device-1', {
      serverUrl: 'https://registry.example.com',
      gatewayId: 'gw_alpha',
    })).resolves.toEqual({
      version: 1,
      token: 'operator-token',
      role: 'operator',
      scopes: ['operator.read', 'operator.write'],
      updatedAtMs: 1_800_000_000_000,
    });
  });

  it('deletes both scoped and legacy device token keys for a relay gateway scope', async () => {
    secureStoreValues[`clawket.deviceToken.device-1_relay_${sha256('https://registry.example.com::gw_alpha')}`] = 'scoped-token';
    secureStoreValues['clawket.deviceToken.device-1'] = 'legacy-token';

    await StorageService.deleteDeviceToken('device-1', {
      serverUrl: 'https://registry.example.com',
      gatewayId: 'gw_alpha',
    });

    expect(secureStoreValues).toEqual({});
  });

  it('deletes a rejected node token without deleting operator credentials', async () => {
    const operatorKey = `clawket.deviceToken.device-1_relay_${sha256('https://registry.example.com::gw_alpha')}`;
    const nodeKey = `${operatorKey}_role_${sha256('node')}`;
    secureStoreValues[operatorKey] = 'operator-token';
    secureStoreValues[nodeKey] = 'node-token';
    secureStoreValues['clawket.deviceToken.device-1'] = 'legacy-operator-token';

    await StorageService.deleteDeviceToken('device-1', {
      serverUrl: 'https://registry.example.com',
      gatewayId: 'gw_alpha',
      role: 'node',
    });

    expect(secureStoreValues).toEqual({
      [operatorKey]: 'operator-token',
      'clawket.deviceToken.device-1': 'legacy-operator-token',
    });
  });

  it('clears both roles for one relay without touching another relay scope', async () => {
    const alphaScope = {
      serverUrl: 'https://registry.example.com',
      gatewayId: 'gw_alpha',
    };
    const betaScope = {
      serverUrl: 'https://registry.example.com',
      gatewayId: 'gw_beta',
    };
    for (const [scope, suffix] of [[alphaScope, 'alpha'], [betaScope, 'beta']] as const) {
      await StorageService.setDeviceTokenRecord('device-1', {
        token: `operator-${suffix}`,
        role: 'operator',
        scopes: ['operator.read'],
      }, scope);
      await StorageService.setDeviceTokenRecord('device-1', {
        token: `node-${suffix}`,
        role: 'node',
        scopes: [],
      }, { ...scope, role: 'node' });
    }

    await StorageService.deleteDeviceToken('device-1', alphaScope);
    await StorageService.deleteDeviceToken('device-1', { ...alphaScope, role: 'node' });

    await expect(StorageService.getDeviceToken('device-1', alphaScope)).resolves.toBeNull();
    await expect(StorageService.getDeviceToken('device-1', {
      ...alphaScope,
      role: 'node',
    })).resolves.toBeNull();
    await expect(StorageService.getDeviceToken('device-1', betaScope)).resolves.toBe('operator-beta');
    await expect(StorageService.getDeviceToken('device-1', {
      ...betaScope,
      role: 'node',
    })).resolves.toBe('node-beta');
  });

  it('persists the lifetime upgrade announcement shown flag', async () => {
    mockedAsyncStorage.getItem.mockResolvedValueOnce(null);
    await expect(StorageService.hasLifetimeUpgradeAnnouncementBeenShown()).resolves.toBe(false);

    await StorageService.markLifetimeUpgradeAnnouncementShown();
    expect(mockedAsyncStorage.setItem).toHaveBeenCalledWith(
      'clawket.lifetimeUpgradeAnnouncementShown.v1',
      '1',
    );

    mockedAsyncStorage.getItem.mockResolvedValueOnce('1');
    await expect(StorageService.hasLifetimeUpgradeAnnouncementBeenShown()).resolves.toBe(true);

    await StorageService.clearLifetimeUpgradeAnnouncementShown();
    expect(mockedAsyncStorage.removeItem).toHaveBeenCalledWith(
      'clawket.lifetimeUpgradeAnnouncementShown.v1',
    );
  });
});
