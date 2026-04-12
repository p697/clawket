import { act, renderHook } from '@testing-library/react-native';
import { useGatewayRuntimeSettings } from './useGatewayRuntimeSettings';

const patchWithRestart = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('../../../hooks/useGatewayPatch', () => ({
  useGatewayPatch: () => ({
    patchWithRestart,
  }),
}));

describe('useGatewayRuntimeSettings', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) {
        return;
      }
    });
    patchWithRestart.mockResolvedValue(true);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('restarts the gateway without requesting an extra save confirmation', async () => {
    const gateway = {
      getConfig: jest.fn().mockResolvedValue({
        config: {},
        hash: 'hash-1',
      }),
      listModels: jest.fn().mockResolvedValue([]),
      getGatewayInfo: jest.fn().mockReturnValue(null),
      getBackendKind: jest.fn().mockReturnValue('openclaw'),
    } as any;

    const { result } = renderHook(() => useGatewayRuntimeSettings({
      gateway,
      gatewayEpoch: 0,
      hasActiveGateway: true,
    }));

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.restartGateway();
    });

    expect(patchWithRestart).toHaveBeenCalledWith(expect.objectContaining({
      patch: {},
      configHash: 'hash-1',
      savingMessage: 'Requesting Gateway restart...',
      restartingMessage: 'Restarting Gateway...',
    }));
    expect(patchWithRestart.mock.calls[0]?.[0]).not.toHaveProperty('confirmation');
  });
});
