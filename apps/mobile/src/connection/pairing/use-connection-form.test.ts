import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useGatewayConfigForm } from './use-connection-form';
import { StorageService } from '../../services/storage';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('../../contexts/GatewayOverlayContext', () => ({
  useGatewayOverlay: () => ({
    showOverlay: jest.fn(),
    hideOverlay: jest.fn(),
  }),
}));

jest.mock('../../contexts/ProPaywallContext', () => ({
  useProPaywall: jest.fn(() => ({
    isPro: false,
    showPaywall: jest.fn(),
  })),
}));

jest.mock('../../services/storage', () => ({
  StorageService: {
    getGatewayConfigsState: jest.fn(),
    setGatewayConfigsState: jest.fn(),
    clearIdentity: jest.fn(),
    clearGatewayConfig: jest.fn(),
    getRelayServiceEnvironment: jest.fn(),
    setRelayServiceEnvironment: jest.fn(),
  },
}));

describe('useGatewayConfigForm', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) {
        return;
      }
    });
    (StorageService.getGatewayConfigsState as jest.Mock).mockResolvedValue({
      activeId: null,
      configs: [],
    });
    (StorageService.getRelayServiceEnvironment as jest.Mock).mockResolvedValue('production');
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('forces new manual connections to start as OpenClaw custom transport', async () => {
    const gateway = {
      disconnect: jest.fn(),
      configure: jest.fn(),
      connect: jest.fn(),
      getDeviceIdentity: jest.fn().mockResolvedValue({ deviceId: 'device-1' }),
    } as any;

    const { result } = renderHook(() =>
      useGatewayConfigForm({
        gateway,
        initialConfig: null,
        debugMode: false,
        onSaved: jest.fn(),
        onReset: jest.fn(),
      }),
    );

    await act(async () => {
      result.current.openCreateEditor();
    });

    expect(result.current.editorVisible).toBe(true);
    expect(result.current.editingConfigId).toBeNull();
    expect(result.current.editorBackendKind).toBe('openclaw');
    expect(result.current.editorTransportKind).toBe('custom');
  });

  it('saves Hermes manual connections as custom direct connections without separate auth fields', async () => {
    const onSaved = jest.fn();
    const gateway = {
      disconnect: jest.fn(),
      configure: jest.fn(),
      connect: jest.fn(),
      getDeviceIdentity: jest.fn().mockResolvedValue({ deviceId: 'device-1' }),
    } as any;

    const { result } = renderHook(() =>
      useGatewayConfigForm({
        gateway,
        initialConfig: null,
        debugMode: false,
        onSaved,
        onReset: jest.fn(),
      }),
    );

    await act(async () => {
      result.current.openCreateEditor('manual');
    });

    await act(async () => {
      result.current.setEditorBackendKind('hermes');
      result.current.setEditorUrl('ws://192.168.1.8:4319/v1/hermes/ws?token=secret');
      result.current.setEditorName('Hermes LAN');
    });

    await act(async () => {
      await result.current.saveEditor();
    });

    const lastCall = (StorageService.setGatewayConfigsState as jest.Mock).mock.calls.at(-1)?.[0];
    expect(lastCall.configs[0]).toMatchObject({
      name: 'Hermes LAN',
      backendKind: 'hermes',
      transportKind: 'custom',
      mode: 'hermes',
      url: 'ws://192.168.1.8:4319/v1/hermes/ws?token=secret',
      token: undefined,
      password: undefined,
      hermes: {
        bridgeUrl: 'http://192.168.1.8:4319',
      },
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it('can create multiple YouMind connections without activating them immediately', async () => {
    const { useProPaywall } = jest.requireMock('../../contexts/ProPaywallContext') as {
      useProPaywall: jest.Mock;
    };
    useProPaywall.mockReturnValue({
      isPro: true,
      showPaywall: jest.fn(),
    });

    (StorageService.getGatewayConfigsState as jest.Mock).mockResolvedValue({
      activeId: 'cfg_existing',
      configs: [{
        id: 'cfg_existing',
        name: 'YouMind (first@example.com)',
        backendKind: 'youmind',
        transportKind: 'custom',
        mode: 'custom',
        url: 'https://youmind.com',
        createdAt: 1,
        updatedAt: 1,
      }],
    });

    const gateway = {
      disconnect: jest.fn(),
      configure: jest.fn(),
      connect: jest.fn(),
      getDeviceIdentity: jest.fn().mockResolvedValue({ deviceId: 'device-1' }),
    } as any;

    const { result } = renderHook(() =>
      useGatewayConfigForm({
        gateway,
        initialConfig: null,
        debugMode: false,
        onSaved: jest.fn(),
        onReset: jest.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.configs.length).toBe(1);
    });

    await act(async () => {
      await result.current.createYouMindConfig({
        id: 'cfg_second',
        name: 'YouMind (second@example.com)',
      });
    });

    const lastCall = (StorageService.setGatewayConfigsState as jest.Mock).mock.calls.at(-1)?.[0];
    expect(lastCall.activeId).toBe('cfg_existing');
    expect(lastCall.configs).toHaveLength(2);
    expect(lastCall.configs[1]).toMatchObject({
      id: 'cfg_second',
      name: 'YouMind (second@example.com)',
      backendKind: 'youmind',
      transportKind: 'custom',
      mode: 'custom',
      url: 'https://youmind.com',
    });
    expect(gateway.connect).not.toHaveBeenCalled();
  });

  it('keeps OpenClaw manual connections on the legacy auth path while saving as custom transport', async () => {
    const onSaved = jest.fn();
    const gateway = {
      disconnect: jest.fn(),
      configure: jest.fn(),
      connect: jest.fn(),
      getDeviceIdentity: jest.fn().mockResolvedValue({ deviceId: 'device-1' }),
    } as any;

    const { result } = renderHook(() =>
      useGatewayConfigForm({
        gateway,
        initialConfig: null,
        debugMode: false,
        onSaved,
        onReset: jest.fn(),
      }),
    );

    await act(async () => {
      result.current.openCreateEditor('manual');
    });

    await act(async () => {
      result.current.setEditorBackendKind('openclaw');
      result.current.setEditorUrl('ws://192.168.1.20:18789');
      result.current.setEditorToken('legacy-token');
      result.current.setEditorName('OpenClaw LAN');
    });

    await act(async () => {
      await result.current.saveEditor();
    });

    const lastCall = (StorageService.setGatewayConfigsState as jest.Mock).mock.calls.at(-1)?.[0];
    expect(lastCall.configs[0]).toMatchObject({
      name: 'OpenClaw LAN',
      backendKind: 'openclaw',
      transportKind: 'custom',
      mode: 'custom',
      url: 'ws://192.168.1.20:18789',
      token: 'legacy-token',
      password: undefined,
      relay: undefined,
      hermes: undefined,
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it('prefers token auth method when opening an editor with both credentials', async () => {
    (StorageService.getGatewayConfigsState as jest.Mock).mockResolvedValue({
      activeId: null,
      configs: [{
        id: 'cfg_1',
        name: 'Test Gateway',
        mode: 'custom',
        url: 'ws://127.0.0.1:18789',
        token: 'token-abc',
        password: 'password-xyz',
        createdAt: 1,
        updatedAt: 1,
      }],
    });

    const gateway = {
      disconnect: jest.fn(),
      configure: jest.fn(),
      connect: jest.fn(),
      getDeviceIdentity: jest.fn().mockResolvedValue({ deviceId: 'device-1' }),
    } as any;

    const { result } = renderHook(() =>
      useGatewayConfigForm({
        gateway,
        initialConfig: null,
        debugMode: false,
        onSaved: jest.fn(),
        onReset: jest.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.configs.length).toBe(1);
    });

    await act(async () => {
      result.current.openEditEditor('cfg_1');
    });

    expect(result.current.editorAuthMethod).toBe('token');
  });

  it('saves only the selected auth credential', async () => {
    (StorageService.getGatewayConfigsState as jest.Mock).mockResolvedValue({
      activeId: null,
      configs: [{
        id: 'cfg_2',
        name: 'Office Gateway',
        mode: 'custom',
        url: 'ws://192.168.1.10:18789',
        token: 'old-token',
        password: undefined,
        createdAt: 2,
        updatedAt: 2,
      }],
    });

    const gateway = {
      disconnect: jest.fn(),
      configure: jest.fn(),
      connect: jest.fn(),
      getDeviceIdentity: jest.fn().mockResolvedValue({ deviceId: 'device-1' }),
    } as any;

    const { result } = renderHook(() =>
      useGatewayConfigForm({
        gateway,
        initialConfig: null,
        debugMode: false,
        onSaved: jest.fn(),
        onReset: jest.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.configs.length).toBe(1);
    });

    await act(async () => {
      result.current.openEditEditor('cfg_2');
    });

    await act(async () => {
      result.current.setEditorAuthMethod('password');
    });

    await act(async () => {
      result.current.setEditorPassword('new-password');
    });

    await act(async () => {
      await result.current.saveEditor();
    });

    expect(StorageService.setGatewayConfigsState).toHaveBeenCalled();
    const lastCall = (StorageService.setGatewayConfigsState as jest.Mock).mock.calls.at(-1)?.[0];
    expect(lastCall).toBeTruthy();
    expect(lastCall.configs[0].token).toBeUndefined();
    expect(lastCall.configs[0].password).toBe('new-password');
  });

  it('keeps existing relay fallback credentials when a scanned relay QR omits them', async () => {
    (StorageService.getGatewayConfigsState as jest.Mock).mockResolvedValue({
      activeId: 'cfg_relay',
      configs: [{
        id: 'cfg_relay',
        name: 'Relay Gateway',
        mode: 'relay',
        url: 'wss://relay-old.example.com/ws',
        token: 'legacy-token',
        relay: {
          serverUrl: 'https://registry.example.com',
          gatewayId: 'gw_123',
          clientToken: 'gct_old',
        },
        createdAt: 2,
        updatedAt: 2,
      }],
    });

    const gateway = {
      getDeviceIdentity: jest.fn().mockResolvedValue({ deviceId: 'device-1' }),
    } as any;

    const { result } = renderHook(() =>
      useGatewayConfigForm({
        gateway,
        initialConfig: null,
        debugMode: false,
        onSaved: jest.fn(),
        onReset: jest.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.configs.length).toBe(1);
    });

    await act(async () => {
      result.current.openEditEditor('cfg_relay');
    });

    await act(async () => {
      await result.current.applyScannedConfig({
        url: 'wss://relay-new.clawket.ai/ws',
        mode: 'relay',
        relay: {
          serverUrl: 'https://registry.example.com',
          gatewayId: 'gw_123',
          clientToken: 'gct_new',
          protocolVersion: 2,
          supportsBootstrap: true,
        },
      });
    });

    expect(result.current.editorToken).toBe('legacy-token');
    expect(result.current.editorPassword).toBe('');
    expect(result.current.editorRelayClientToken).toBe('gct_new');
  });

  it('allows saving a relay config that only has clientToken and locks non-name fields for editing', async () => {
    (StorageService.getGatewayConfigsState as jest.Mock).mockResolvedValue({
      activeId: 'cfg_relay',
      configs: [{
        id: 'cfg_relay',
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
        createdAt: 2,
        updatedAt: 2,
      }],
    });

    const gateway = {
      disconnect: jest.fn(),
      configure: jest.fn(),
      connect: jest.fn(),
      getDeviceIdentity: jest.fn().mockResolvedValue({ deviceId: 'device-1' }),
    } as any;

    const { result } = renderHook(() =>
      useGatewayConfigForm({
        gateway,
        initialConfig: null,
        debugMode: false,
        onSaved: jest.fn(),
        onReset: jest.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.configs.length).toBe(1);
    });

    await act(async () => {
      result.current.openEditEditor('cfg_relay');
    });

    expect(result.current.isRelayEditorLocked).toBe(true);

    await act(async () => {
      result.current.setEditorName('Renamed Relay');
    });

    await act(async () => {
      await result.current.saveEditor();
    });

    expect(Alert.alert).not.toHaveBeenCalledWith('Missing Auth', expect.anything());
    expect(StorageService.setGatewayConfigsState).toHaveBeenCalled();
    const lastCall = (StorageService.setGatewayConfigsState as jest.Mock).mock.calls.at(-1)?.[0];
    expect(lastCall.configs[0]).toMatchObject({
      id: 'cfg_relay',
      name: 'Renamed Relay',
      mode: 'relay',
      url: 'wss://relay.example.com/ws',
      token: undefined,
      password: undefined,
      relay: {
        serverUrl: 'https://registry.example.com',
        gatewayId: 'gw_123',
        clientToken: 'gct_new',
        protocolVersion: 2,
        supportsBootstrap: true,
      },
    });
  });

  it('keeps Hermes relay transport when refreshing an existing config from a scanned QR', async () => {
    (StorageService.getGatewayConfigsState as jest.Mock).mockResolvedValue({
      activeId: 'cfg_hermes_relay',
      configs: [{
        id: 'cfg_hermes_relay',
        name: 'Hermes Relay',
        backendKind: 'hermes',
        transportKind: 'relay',
        mode: 'hermes',
        url: 'wss://hermes-relay-old.example.com/ws',
        relay: {
          serverUrl: 'https://hermes-registry.example.com',
          gatewayId: 'hbg_123',
          clientToken: 'hct_old',
        },
        createdAt: 2,
        updatedAt: 2,
      }],
    });

    const gateway = {
      disconnect: jest.fn(),
      configure: jest.fn(),
      connect: jest.fn(),
      getDeviceIdentity: jest.fn().mockResolvedValue({ deviceId: 'device-1' }),
    } as any;

    const { result } = renderHook(() =>
      useGatewayConfigForm({
        gateway,
        initialConfig: null,
        debugMode: false,
        onSaved: jest.fn(),
        onReset: jest.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.configs.length).toBe(1);
    });

    await act(async () => {
      result.current.openEditEditor('cfg_hermes_relay');
    });

    await act(async () => {
      await result.current.applyScannedConfig({
        url: 'wss://hermes-relay.example.com/ws',
        backendKind: 'hermes',
        transportKind: 'relay',
        mode: 'hermes',
        relay: {
          serverUrl: 'https://hermes-registry.example.com',
          gatewayId: 'hbg_123',
          clientToken: 'hct_new',
          displayName: 'Hermes Mac',
        },
      });
    });

    expect(result.current.editorBackendKind).toBe('hermes');
    expect(result.current.editorTransportKind).toBe('relay');
    expect(result.current.isRelayEditorLocked).toBe(true);
    expect(result.current.editorRelayClientToken).toBe('hct_new');

    await act(async () => {
      await result.current.saveEditor();
    });

    const lastCall = (StorageService.setGatewayConfigsState as jest.Mock).mock.calls.at(-1)?.[0];
    expect(lastCall.configs[0]).toMatchObject({
      id: 'cfg_hermes_relay',
      backendKind: 'hermes',
      transportKind: 'relay',
      mode: 'hermes',
      url: 'wss://hermes-relay.example.com/ws',
      relay: {
        serverUrl: 'https://hermes-registry.example.com',
        gatewayId: 'hbg_123',
        clientToken: 'hct_new',
      },
    });
  });

  it('resets app state when deleting the last active gateway config', async () => {
    (StorageService.getGatewayConfigsState as jest.Mock).mockResolvedValue({
      activeId: 'cfg_last',
      configs: [{
        id: 'cfg_last',
        name: 'Last Gateway',
        mode: 'custom',
        url: 'ws://127.0.0.1:18789',
        token: 'token-last',
        createdAt: 3,
        updatedAt: 3,
      }],
    });

    const onReset = jest.fn();
    const gateway = {
      disconnect: jest.fn(),
      getDeviceIdentity: jest.fn().mockResolvedValue({ deviceId: 'device-1' }),
    } as any;

    const { result } = renderHook(() =>
      useGatewayConfigForm({
        gateway,
        initialConfig: {
          url: 'ws://127.0.0.1:18789',
          token: 'token-last',
          mode: 'custom',
        },
        debugMode: false,
        onSaved: jest.fn(),
        onReset,
      }),
    );

    await waitFor(() => {
      expect(result.current.configs.length).toBe(1);
      expect(result.current.activeConfigId).toBe('cfg_last');
    });

    await act(async () => {
      result.current.deleteConfig('cfg_last');
    });

    const alertCall = (Alert.alert as jest.Mock).mock.calls.at(-1);
    expect(alertCall).toBeTruthy();
    const deleteAction = alertCall?.[2]?.find((action: { text?: string }) => action.text === 'Delete');
    expect(deleteAction).toBeTruthy();

    await act(async () => {
      await deleteAction.onPress();
    });

    expect(StorageService.setGatewayConfigsState).toHaveBeenCalledWith({ activeId: null, configs: [] });
    expect(gateway.disconnect).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
