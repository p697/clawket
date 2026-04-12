import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { sha256 } from 'js-sha256';

jest.mock('../theme', () => ({
  defaultAccentId: 'iceBlue',
  isAccentScale: jest.fn(() => false),
}));

import { StorageService } from './storage';

describe('StorageService gateway config backups', () => {
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

  it('persists relay configs with clientToken even when no legacy token or password is present', async () => {
    await StorageService.setGatewayConfigsState({
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

    await expect(StorageService.getGatewayConfig()).resolves.toEqual({
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
    });
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

    const state = await StorageService.getGatewayConfigsState();

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
  });

  it('migrates the legacy single gateway config with explicit OpenClaw metadata', async () => {
    secureStoreValues['clawket.gatewayConfig.v1'] = JSON.stringify({
      url: 'http://127.0.0.1:8080',
      token: 'legacy-token',
      password: 'legacy-password',
    });

    const state = await StorageService.getGatewayConfigsState();

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

  it('falls back to the legacy unscoped device token key when no scoped token exists', async () => {
    secureStoreValues['clawket.deviceToken.device-1'] = 'legacy-token';

    await expect(StorageService.getDeviceToken('device-1', {
      serverUrl: 'https://registry.example.com',
      gatewayId: 'gw_alpha',
    })).resolves.toBe('legacy-token');
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
});
