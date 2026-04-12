import { act, renderHook } from '@testing-library/react-native';
import { analyticsEvents } from '../../../services/analytics/events';
import { useChatModelPicker } from './useChatModelPicker';
import { SessionInfo } from '../../../types';

jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
}));

const appContextMock = {
  foregroundEpoch: 0,
  gatewayEpoch: 0,
};

jest.mock('../../../contexts/AppContext', () => ({
  useAppContext: () => appContextMock,
}));

jest.mock('../../../services/analytics/events', () => ({
  analyticsEvents: {
    chatModelSelected: jest.fn(),
  },
}));

describe('useChatModelPicker', () => {
  let consoleErrorSpy: jest.SpyInstance;
  const mockedAnalytics = analyticsEvents as jest.Mocked<typeof analyticsEvents>;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) {
        return;
      }
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    jest.clearAllMocks();
    appContextMock.foregroundEpoch = 0;
    appContextMock.gatewayEpoch = 0;
  });

  it('does not open picker when gateway is not ready', () => {
    const { result } = renderHook(() =>
      useChatModelPicker({
        connectionState: 'connecting',
        gateway: {
          listModels: jest.fn(),
          listSessions: jest.fn(),
          getModelSelectionState: jest.fn(),
          setModelSelection: jest.fn(),
          getBackendKind: () => 'openclaw' as const,
        },
        sessionKey: 'agent:main:main',
        setInput: jest.fn(),
        setSessions: jest.fn(),
        submitMessage: jest.fn(),
      }),
    );

    expect(result.current.openModelPicker()).toBe(false);
    expect(result.current.modelPickerVisible).toBe(false);
  });

  it('opens picker and loads models successfully', async () => {
    const gateway = {
      listModels: jest.fn().mockResolvedValue([
        { id: 'gpt-5', name: 'gpt-5', provider: 'openai' },
      ]),
      listSessions: jest.fn(),
      getModelSelectionState: jest.fn(),
      getBackendKind: () => 'openclaw' as const,
      setModelSelection: jest.fn(),
    };

    const { result } = renderHook(() =>
      useChatModelPicker({
        connectionState: 'ready',
        gateway,
        sessionKey: 'agent:main:main',
        setInput: jest.fn(),
        setSessions: jest.fn(),
        submitMessage: jest.fn(),
      }),
    );

    expect(result.current.openModelPicker()).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.modelPickerVisible).toBe(true);
    expect(gateway.listModels).toHaveBeenCalledTimes(1);
    expect(result.current.availableModels).toEqual([
      { id: 'gpt-5', name: 'gpt-5', provider: 'openai' },
    ]);
    expect(result.current.modelPickerError).toBeNull();
  });

  it('keeps picker open and exposes error when model loading fails', async () => {
    const gateway = {
      listModels: jest.fn().mockRejectedValue(new Error('boom')),
      listSessions: jest.fn(),
      getModelSelectionState: jest.fn(),
      getBackendKind: () => 'openclaw' as const,
      setModelSelection: jest.fn(),
    };

    const { result } = renderHook(() =>
      useChatModelPicker({
        connectionState: 'ready',
        gateway,
        sessionKey: 'agent:main:main',
        setInput: jest.fn(),
        setSessions: jest.fn(),
        submitMessage: jest.fn(),
      }),
    );

    expect(result.current.openModelPicker()).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.modelPickerVisible).toBe(true);
    expect(result.current.modelPickerError).toBe('boom');
    expect(result.current.availableModels).toEqual([]);
  });

  it('fills /model command instead of sending when not ready', () => {
    const setInput = jest.fn();
    const submitMessage = jest.fn();
    let sessions: SessionInfo[] = [
      { key: 'agent:main:main', kind: 'direct', model: 'old', modelProvider: 'openai' },
    ];
    const setSessions = jest.fn((updater: (prev: SessionInfo[]) => SessionInfo[]) => {
      sessions = updater(sessions);
    });

    const { result } = renderHook(() =>
      useChatModelPicker({
        connectionState: 'connecting',
        gateway: {
          listModels: jest.fn(),
          listSessions: jest.fn(),
          getModelSelectionState: jest.fn(),
          setModelSelection: jest.fn(),
          getBackendKind: () => 'openclaw' as const,
        },
        sessionKey: 'agent:main:main',
        setInput,
        setSessions,
        submitMessage,
      }),
    );

    act(() => {
      result.current.onSelectModel({ id: 'gpt-4o', name: 'gpt-4o', provider: 'openai' });
    });

    expect(setInput).toHaveBeenCalledWith('/model openai/gpt-4o');
    expect(submitMessage).not.toHaveBeenCalled();
    expect(sessions[0].model).toBe('gpt-4o');
    expect(sessions[0].modelProvider).toBe('openai');
    expect(mockedAnalytics.chatModelSelected).toHaveBeenCalledWith({
      provider_model: 'openai/gpt-4o',
      model_id: 'gpt-4o',
      model_name: 'gpt-4o',
      provider: 'openai',
      source: 'chat_model_picker',
      session_key_present: true,
    });
  });

  it('sends /model command when gateway is ready', () => {
    const setInput = jest.fn();
    const submitMessage = jest.fn();
    let sessions: SessionInfo[] = [
      { key: 'agent:main:main', kind: 'direct' },
    ];
    const setSessions = jest.fn((updater: (prev: SessionInfo[]) => SessionInfo[]) => {
      sessions = updater(sessions);
    });

    const { result } = renderHook(() =>
      useChatModelPicker({
        connectionState: 'ready',
        gateway: {
          listModels: jest.fn(),
          listSessions: jest.fn(),
          getModelSelectionState: jest.fn(),
          setModelSelection: jest.fn(),
          getBackendKind: () => 'openclaw' as const,
        },
        sessionKey: 'agent:main:main',
        setInput,
        setSessions,
        submitMessage,
      }),
    );

    act(() => {
      result.current.onSelectModel({ id: 'gpt-5', name: 'gpt-5', provider: 'openai' });
    });

    expect(submitMessage).toHaveBeenCalledWith('/model openai/gpt-5', []);
    expect(setInput).not.toHaveBeenCalled();
    expect(sessions[0].model).toBe('gpt-5');
    expect(sessions[0].modelProvider).toBe('openai');
  });

  it('loads Hermes providers and current global model from model selection state', async () => {
    const gateway = {
      listModels: jest.fn(),
      listSessions: jest.fn(),
      getBackendKind: () => 'hermes' as const,
      setModelSelection: jest.fn(),
      getCurrentModelState: jest.fn().mockResolvedValue({
        currentModel: 'gpt-5.3-codex',
        currentProvider: 'openai-codex',
        currentBaseUrl: '',
        note: null,
      }),
      getModelSelectionState: jest.fn().mockResolvedValue({
        currentModel: 'gpt-5.3-codex',
        currentProvider: 'openai-codex',
        currentBaseUrl: '',
        note: null,
        models: [
          { id: 'gpt-5.3-codex', name: 'gpt-5.3-codex', provider: 'openai-codex' },
        ],
        providers: [
          { slug: 'openai-codex', name: 'OpenAI Codex', isCurrent: true, models: ['gpt-5.3-codex'], totalModels: 1 },
          { slug: 'custom:moonshot', name: 'moonshot', isCurrent: false, models: [], totalModels: 0 },
        ],
      }),
    };

    const { result } = renderHook(() =>
      useChatModelPicker({
        connectionState: 'ready',
        gateway,
        sessionKey: 'agent:main:main',
        setInput: jest.fn(),
        setSessions: jest.fn(),
        submitMessage: jest.fn(),
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(gateway.getCurrentModelState).toHaveBeenCalled();
    expect(result.current.currentModel).toBe('gpt-5.3-codex');
    expect(result.current.currentModelProvider).toBe('openai-codex');
    expect(result.current.currentModelHeaderLabel).toBe('openai-codex/gpt-5.3-codex');
    expect(result.current.availableProviders).toEqual([]);

    expect(result.current.openModelPicker()).toBe(true);

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.availableProviders).toEqual([
      { slug: 'openai-codex', name: 'OpenAI Codex', isCurrent: true, models: ['gpt-5.3-codex'], totalModels: 1 },
      { slug: 'custom:moonshot', name: 'moonshot', isCurrent: false, models: [], totalModels: 0 },
    ]);
    expect(gateway.getModelSelectionState).toHaveBeenCalled();
    expect(gateway.listModels).not.toHaveBeenCalled();
  });

  it('uses Hermes model.set instead of sending a chat command', async () => {
    const setInput = jest.fn();
    const submitMessage = jest.fn();
    const setSessions = jest.fn();
    const gateway = {
      listModels: jest.fn(),
      listSessions: jest.fn(),
      getBackendKind: () => 'hermes' as const,
      getCurrentModelState: jest.fn().mockResolvedValue({
        currentModel: 'gpt-5.3-codex',
        currentProvider: 'openai-codex',
        currentBaseUrl: '',
        note: null,
      }),
      getModelSelectionState: jest.fn().mockResolvedValue({
        currentModel: 'gpt-5.3-codex',
        currentProvider: 'openai-codex',
        currentBaseUrl: '',
        note: null,
        models: [
          { id: 'gpt-5.3-codex', name: 'gpt-5.3-codex', provider: 'openai-codex' },
          { id: 'kimi-k2-0711-preview', name: 'kimi-k2-0711-preview', provider: 'custom:moonshot' },
        ],
        providers: [
          { slug: 'openai-codex', name: 'OpenAI Codex', isCurrent: true, models: ['gpt-5.3-codex'], totalModels: 1 },
          { slug: 'custom:moonshot', name: 'Moonshot', isCurrent: false, models: ['kimi-k2-0711-preview'], totalModels: 1 },
        ],
      }),
      setModelSelection: jest.fn().mockResolvedValue({
        currentModel: 'kimi-k2-0711-preview',
        currentProvider: 'custom:moonshot',
        currentBaseUrl: 'https://api.moonshot.cn/v1',
        note: null,
        models: [
          { id: 'gpt-5.3-codex', name: 'gpt-5.3-codex', provider: 'openai-codex' },
          { id: 'kimi-k2-0711-preview', name: 'kimi-k2-0711-preview', provider: 'custom:moonshot' },
        ],
        providers: [
          { slug: 'openai-codex', name: 'OpenAI Codex', isCurrent: false, models: ['gpt-5.3-codex'], totalModels: 1 },
          { slug: 'custom:moonshot', name: 'Moonshot', isCurrent: true, models: ['kimi-k2-0711-preview'], totalModels: 1 },
        ],
      }),
    };

    const { result } = renderHook(() =>
      useChatModelPicker({
        connectionState: 'ready',
        gateway,
        sessionKey: 'agent:main:main',
        setInput,
        setSessions,
        submitMessage,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.onSelectModel({
        id: 'kimi-k2-0711-preview',
        name: 'kimi-k2-0711-preview',
        provider: 'custom:moonshot',
      });
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(gateway.setModelSelection).toHaveBeenCalledWith({
      model: 'kimi-k2-0711-preview',
      provider: 'custom:moonshot',
      scope: 'global',
    });
    expect(submitMessage).not.toHaveBeenCalled();
    expect(setInput).not.toHaveBeenCalled();
    expect(setSessions).not.toHaveBeenCalled();
    expect(result.current.currentModel).toBe('kimi-k2-0711-preview');
    expect(result.current.currentModelProvider).toBe('custom:moonshot');
  });

  it('keeps the last visible model while refreshing after switching from Hermes to OpenClaw', async () => {
    let backendKind: 'openclaw' | 'hermes' = 'hermes';
    let resolveSessions: ((value: SessionInfo[]) => void) | null = null;
    const gateway = {
      listModels: jest.fn().mockResolvedValue([
        { id: 'gpt-5.4', name: 'gpt-5.4', provider: 'openai' },
      ]),
      listSessions: jest.fn().mockImplementation(() => new Promise<SessionInfo[]>((resolve) => {
        resolveSessions = resolve;
      })),
      getBackendKind: jest.fn(() => backendKind),
      setModelSelection: jest.fn(),
      getCurrentModelState: jest.fn().mockResolvedValue({
        currentModel: 'gpt-5.3-codex',
        currentProvider: 'openai-codex',
        currentBaseUrl: '',
        note: null,
      }),
      getModelSelectionState: jest.fn().mockResolvedValue({
        currentModel: 'gpt-5.3-codex',
        currentProvider: 'openai-codex',
        currentBaseUrl: '',
        note: null,
        models: [
          { id: 'gpt-5.3-codex', name: 'gpt-5.3-codex', provider: 'openai-codex' },
        ],
        providers: [
          { slug: 'openai-codex', name: 'OpenAI Codex', isCurrent: true, models: ['gpt-5.3-codex'], totalModels: 1 },
        ],
      }),
    };

    const { result, rerender } = renderHook<
      ReturnType<typeof useChatModelPicker>,
      { connectionState: 'ready' }
    >(
      ({ connectionState }) =>
        useChatModelPicker({
          connectionState,
          gateway,
          sessionKey: 'agent:main:main',
          setInput: jest.fn(),
          setSessions: jest.fn(),
          submitMessage: jest.fn(),
        }),
      {
        initialProps: {
          connectionState: 'ready' as const,
        },
      },
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.currentModel).toBe('gpt-5.3-codex');
    expect(result.current.currentModelProvider).toBe('openai-codex');

    backendKind = 'openclaw';
    appContextMock.gatewayEpoch += 1;
    rerender({ connectionState: 'ready' as const });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.currentModel).toBe('gpt-5.3-codex');
    expect(result.current.currentModelProvider).toBe('openai-codex');

    await act(async () => {
      resolveSessions?.([
        {
          key: 'agent:main:main',
          kind: 'direct',
          model: 'gpt-5.4',
          modelProvider: 'openai',
        },
      ]);
      await Promise.resolve();
    });

    expect(result.current.currentModel).toBe('gpt-5.4');
    expect(result.current.currentModelProvider).toBe('openai');
  });
});
