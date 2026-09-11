import { act, renderHook } from '@testing-library/react-native';
import {
  resolveCapabilities,
  type AgentAdapter,
  type BackendKind,
  type ModelSelectionState,
} from '@clawket/agent-protocol';
import { analyticsEvents } from '../services/analytics/events';
import type { SessionInfo } from '../types';
import { useChatModelPicker } from './useChatModelPicker';

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));

const appContextMock = { foregroundEpoch: 0 };

jest.mock('../contexts/AppContext', () => ({ useAppContext: () => appContextMock }));
jest.mock('../services/analytics/events', () => ({
  analyticsEvents: { chatModelSelected: jest.fn() },
}));

type ModelOpsFixture = {
  backendKind?: BackendKind;
  list?: jest.Mock;
  getSelection?: jest.Mock;
  setSelection?: jest.Mock;
  listSessions?: jest.Mock;
};

function createAdapter(fixture: ModelOpsFixture = {}) {
  const backendKind = fixture.backendKind ?? 'openclaw';
  const transportKinds = { openclaw: 'relay', hermes: 'relay', 'local-model': 'relay', youmind: 'https' } as const;
  const modelOps = {
    ...(fixture.list ? { list: fixture.list } : {}),
    ...(fixture.getSelection ? { getSelection: fixture.getSelection } : {}),
    ...(fixture.setSelection ? { setSelection: fixture.setSelection } : {}),
  };
  const adapter = {
    connection: {
      id: `${backendKind}-connection`,
      backendKind,
      transportKind: transportKinds[backendKind],
      label: backendKind,
      createdAt: 1,
      isFreeSlot: false,
    },
    capabilities: resolveCapabilities(backendKind),
    state: 'ready' as const,
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    probe: jest.fn().mockResolvedValue(true),
    listAgents: jest.fn().mockResolvedValue([]),
    listSessions: fixture.listSessions ?? jest.fn().mockResolvedValue([]),
    loadSession: jest.fn().mockResolvedValue({ key: 'main', messages: [], hasActiveRun: false }),
    prompt: jest.fn().mockResolvedValue({ runId: 'run-1' }),
    cancel: jest.fn().mockResolvedValue(undefined),
    management: { models: modelOps },
    on: jest.fn(() => jest.fn()),
    modelOps,
  };
  return adapter as typeof adapter & AgentAdapter;
}

function modelSelection(
  currentModel: string,
  currentProvider: string,
  options: Partial<ModelSelectionState> = {},
): ModelSelectionState {
  return {
    currentModel,
    currentProvider,
    currentBaseUrl: '',
    models: options.models ?? [],
    providers: options.providers,
    note: options.note,
  };
}

describe('useChatModelPicker', () => {
  let consoleErrorSpy: jest.SpyInstance;
  const mockedAnalytics = analyticsEvents as jest.Mocked<typeof analyticsEvents>;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    jest.clearAllMocks();
    appContextMock.foregroundEpoch = 0;
  });

  it('does not open picker when the adapter is not ready', () => {
    const adapter = createAdapter({ list: jest.fn() });
    const { result } = renderHook(() => useChatModelPicker({
      connectionState: 'connecting',
      adapter,
      sessionKey: 'agent:main:main',
      setInput: jest.fn(),
      setSessions: jest.fn(),
    }));

    expect(result.current.openModelPicker()).toBe(false);
    expect(result.current.modelPickerVisible).toBe(false);
  });

  it('opens picker and loads models through management.models', async () => {
    const list = jest.fn().mockResolvedValue([
      { id: 'gpt-5', name: 'gpt-5', provider: 'openai' },
    ]);
    const adapter = createAdapter({ list });
    const { result } = renderHook(() => useChatModelPicker({
      connectionState: 'ready',
      adapter,
      sessionKey: 'agent:main:main',
      setInput: jest.fn(),
      setSessions: jest.fn(),
    }));

    expect(result.current.openModelPicker()).toBe(true);
    await act(async () => { await Promise.resolve(); });

    expect(list).toHaveBeenCalledTimes(1);
    expect(result.current.availableModels).toEqual([
      { id: 'gpt-5', name: 'gpt-5', provider: 'openai' },
    ]);
    expect(result.current.modelPickerError).toBeNull();
  });

  it('keeps the listed catalog and falls back to session metadata when selection is empty', async () => {
    const catalog = [{ id: 'gpt-5', name: 'gpt-5', provider: 'openai' }];
    const adapter = createAdapter({
      list: jest.fn().mockResolvedValue(catalog),
      getSelection: jest.fn().mockResolvedValue(modelSelection('', '')),
      listSessions: jest.fn().mockResolvedValue([{
        key: 'agent:main:main',
        kind: 'main',
        title: 'Main',
        updatedAt: 1,
        hasActiveRun: false,
        model: 'gpt-5',
        modelProvider: 'openai',
        allowedActions: {},
      }]),
    });
    const { result } = renderHook(() => useChatModelPicker({
      connectionState: 'ready',
      adapter,
      sessionKey: 'agent:main:main',
      setInput: jest.fn(),
      setSessions: jest.fn(),
    }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.currentModelHeaderLabel).toBe('openai/gpt-5');

    expect(result.current.openModelPicker()).toBe(true);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.availableModels).toEqual(catalog);
  });

  it('keeps picker open and exposes a model loading error', async () => {
    const adapter = createAdapter({ list: jest.fn().mockRejectedValue(new Error('boom')) });
    const { result } = renderHook(() => useChatModelPicker({
      connectionState: 'ready',
      adapter,
      sessionKey: 'agent:main:main',
      setInput: jest.fn(),
      setSessions: jest.fn(),
    }));

    expect(result.current.openModelPicker()).toBe(true);
    await act(async () => { await Promise.resolve(); });

    expect(result.current.modelPickerVisible).toBe(true);
    expect(result.current.modelPickerError).toBe('boom');
    expect(result.current.availableModels).toEqual([]);
  });

  it('fills a /model command when selection cannot run while disconnected', () => {
    const setInput = jest.fn();
    let sessions: SessionInfo[] = [
      { key: 'agent:main:main', kind: 'direct', model: 'old', modelProvider: 'openai' },
    ];
    const setSessions = jest.fn((updater: (prev: SessionInfo[]) => SessionInfo[]) => {
      sessions = updater(sessions);
    });
    const adapter = createAdapter({ setSelection: jest.fn() });
    const { result } = renderHook(() => useChatModelPicker({
      connectionState: 'connecting',
      adapter,
      sessionKey: 'agent:main:main',
      setInput,
      setSessions,
    }));

    act(() => {
      result.current.onSelectModel({ id: 'gpt-4o', name: 'gpt-4o', provider: 'openai' });
    });

    expect(setInput).toHaveBeenCalledWith('/model openai/gpt-4o');
    expect(sessions[0]).toEqual(expect.objectContaining({ model: 'gpt-4o', modelProvider: 'openai' }));
    expect(mockedAnalytics.chatModelSelected).toHaveBeenCalledWith(expect.objectContaining({
      provider_model: 'openai/gpt-4o',
      source: 'chat_model_picker',
    }));
  });

  it('uses per-session adapter model selection for OpenClaw', async () => {
    const setInput = jest.fn();
    const setSelection = jest.fn().mockResolvedValue({
      ok: true,
      scope: 'global',
      ...modelSelection('gpt-5', 'openai'),
    });
    let sessions: SessionInfo[] = [{ key: 'agent:main:main', kind: 'direct' }];
    const setSessions = jest.fn((updater: (prev: SessionInfo[]) => SessionInfo[]) => {
      sessions = updater(sessions);
    });
    const adapter = createAdapter({ setSelection });
    const { result } = renderHook(() => useChatModelPicker({
      connectionState: 'ready',
      adapter,
      sessionKey: 'agent:main:main',
      setInput,
      setSessions,
    }));

    act(() => {
      result.current.onSelectModel({ id: 'gpt-5', name: 'gpt-5', provider: 'openai' });
    });
    await act(async () => { await Promise.resolve(); });

    expect(setSelection).toHaveBeenCalledWith({
      model: 'gpt-5',
      provider: 'openai',
      scope: 'session',
      sessionKey: 'agent:main:main',
    });
    expect(setInput).not.toHaveBeenCalled();
    expect(sessions[0]).toEqual(expect.objectContaining({ model: 'gpt-5', modelProvider: 'openai' }));
  });

  it('loads Hermes providers and current global model from adapter selection state', async () => {
    const selection = modelSelection('gpt-5.3-codex', 'openai-codex', {
      models: [{ id: 'gpt-5.3-codex', name: 'gpt-5.3-codex', provider: 'openai-codex' }],
      providers: [
        { slug: 'openai-codex', name: 'OpenAI Codex', isCurrent: true, models: ['gpt-5.3-codex'], totalModels: 1 },
        { slug: 'custom:moonshot', name: 'moonshot', isCurrent: false, models: [], totalModels: 0 },
      ],
    });
    const getSelection = jest.fn().mockResolvedValue(selection);
    const adapter = createAdapter({
      backendKind: 'hermes',
      list: jest.fn().mockResolvedValue(selection.models),
      getSelection,
    });
    const { result } = renderHook(() => useChatModelPicker({
      connectionState: 'ready',
      adapter,
      sessionKey: 'main',
      setInput: jest.fn(),
      setSessions: jest.fn(),
    }));

    await act(async () => { await Promise.resolve(); });
    expect(result.current.currentModelHeaderLabel).toBe('openai-codex/gpt-5.3-codex');
    expect(result.current.availableProviders).toEqual([]);

    expect(result.current.openModelPicker()).toBe(true);
    await act(async () => { await Promise.resolve(); });

    expect(result.current.availableProviders).toEqual(selection.providers);
    expect(getSelection).toHaveBeenCalled();
  });

  it('uses global adapter model selection for Hermes', async () => {
    const setInput = jest.fn();
    const nextSelection = {
      ok: true,
      scope: 'global' as const,
      ...modelSelection('kimi-k2-0711-preview', 'custom:moonshot', {
        models: [{ id: 'kimi-k2-0711-preview', name: 'kimi-k2-0711-preview', provider: 'custom:moonshot' }],
      }),
    };
    const setSelection = jest.fn().mockResolvedValue(nextSelection);
    const adapter = createAdapter({ backendKind: 'hermes', setSelection });
    const { result } = renderHook(() => useChatModelPicker({
      connectionState: 'ready',
      adapter,
      sessionKey: 'main',
      setInput,
      setSessions: jest.fn(),
    }));

    act(() => {
      result.current.onSelectModel({
        id: 'kimi-k2-0711-preview',
        name: 'kimi-k2-0711-preview',
        provider: 'custom:moonshot',
      });
    });
    await act(async () => { await Promise.resolve(); });

    expect(setSelection).toHaveBeenCalledWith({
      model: 'kimi-k2-0711-preview',
      provider: 'custom:moonshot',
      scope: 'global',
    });
    expect(setInput).not.toHaveBeenCalled();
    expect(result.current.currentModelProvider).toBe('custom:moonshot');
  });

  it('reopens the picker and rolls back an optimistic selection when mutation fails', async () => {
    const setSelection = jest.fn().mockRejectedValue(new Error('switch failed'));
    const adapter = createAdapter({
      setSelection,
      getSelection: jest.fn().mockResolvedValue(modelSelection('gpt-current', 'openai')),
    });
    let sessions: SessionInfo[] = [{
      key: 'agent:main:main',
      kind: 'global',
      model: 'gpt-current',
      modelProvider: 'openai',
    }];
    const setSessions = jest.fn((updater: (prev: SessionInfo[]) => SessionInfo[]) => {
      sessions = updater(sessions);
    });
    const { result } = renderHook(() => useChatModelPicker({
      connectionState: 'ready',
      adapter,
      sessionKey: 'agent:main:main',
      setInput: jest.fn(),
      setSessions,
    }));

    await act(async () => { await Promise.resolve(); });
    expect(result.current.currentModelHeaderLabel).toBe('openai/gpt-current');

    act(() => {
      result.current.onSelectModel({ id: 'gpt-next', name: 'gpt-next', provider: 'openai' });
      result.current.setModelPickerVisible(false);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.modelPickerVisible).toBe(true);
    expect(result.current.modelPickerError).toBe('switch failed');
    expect(result.current.currentModelHeaderLabel).toBe('openai/gpt-current');
    expect(sessions[0]).toEqual(expect.objectContaining({
      model: 'gpt-current',
      modelProvider: 'openai',
    }));
  });

  it('keeps the last visible model until a replacement adapter refresh resolves', async () => {
    let resolveSelection: ((value: ModelSelectionState) => void) | null = null;
    const hermes = createAdapter({
      backendKind: 'hermes',
      getSelection: jest.fn().mockResolvedValue(modelSelection('gpt-5.3-codex', 'openai-codex')),
    });
    const openClaw = createAdapter({
      getSelection: jest.fn(() => new Promise<ModelSelectionState>((resolve) => {
        resolveSelection = resolve;
      })),
    });
    let currentAdapter: AgentAdapter = hermes;
    const { result, rerender } = renderHook(() => useChatModelPicker({
      connectionState: 'ready',
      adapter: currentAdapter,
      sessionKey: 'agent:main:main',
      setInput: jest.fn(),
      setSessions: jest.fn(),
    }));

    await act(async () => { await Promise.resolve(); });
    expect(result.current.currentModelHeaderLabel).toBe('openai-codex/gpt-5.3-codex');

    currentAdapter = openClaw;
    rerender(undefined);
    await act(async () => { await Promise.resolve(); });
    expect(result.current.currentModelHeaderLabel).toBe('openai-codex/gpt-5.3-codex');

    await act(async () => {
      resolveSelection?.(modelSelection('gpt-5.4', 'openai'));
      await Promise.resolve();
    });
    expect(result.current.currentModelHeaderLabel).toBe('openai/gpt-5.4');
  });

  it('ignores a stale adapter catalog and selection that resolve after a backend switch', async () => {
    let resolveHermesRefresh: ((value: ModelSelectionState) => void) | null = null;
    let resolveHermesCatalog: ((value: Array<{ id: string; name: string; provider: string }>) => void) | null = null;
    const hermes = createAdapter({
      backendKind: 'hermes',
      list: jest.fn(() => new Promise((resolve) => {
        resolveHermesCatalog = resolve;
      })),
      getSelection: jest.fn(() => new Promise<ModelSelectionState>((resolve) => {
        resolveHermesRefresh = resolve;
      })),
    });
    const openClawSelection = modelSelection('gpt-5.4', 'openai', {
      models: [{ id: 'gpt-5.4', name: 'GPT 5.4', provider: 'openai' }],
    });
    const openClaw = createAdapter({
      list: jest.fn().mockResolvedValue(openClawSelection.models),
      getSelection: jest.fn().mockResolvedValue(openClawSelection),
    });
    let currentAdapter: AgentAdapter = hermes;
    let currentSessionKey = 'main';
    const { result, rerender } = renderHook(() => useChatModelPicker({
      connectionState: 'ready',
      adapter: currentAdapter,
      sessionKey: currentSessionKey,
      setInput: jest.fn(),
      setSessions: jest.fn(),
    }));

    expect(result.current.openModelPicker()).toBe(true);
    currentAdapter = openClaw;
    currentSessionKey = 'agent:main:main';
    rerender(undefined);
    await act(async () => { await Promise.resolve(); });
    expect(result.current.openModelPicker()).toBe(true);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.currentModelHeaderLabel).toBe('openai/gpt-5.4');
    expect(result.current.availableModels).toEqual(openClawSelection.models);

    await act(async () => {
      resolveHermesCatalog?.([{
        id: 'kimi-old',
        name: 'Kimi old',
        provider: 'custom:moonshot',
      }]);
      resolveHermesRefresh?.(modelSelection('kimi-old', 'custom:moonshot'));
      await Promise.resolve();
    });
    expect(result.current.currentModelHeaderLabel).toBe('openai/gpt-5.4');
    expect(result.current.availableModels).toEqual(openClawSelection.models);
  });

  it('ignores a stale model mutation result after the active adapter changes', async () => {
    let resolveHermesMutation: ((value: ModelSelectionState) => void) | null = null;
    const hermes = createAdapter({
      backendKind: 'hermes',
      setSelection: jest.fn(() => new Promise<ModelSelectionState>((resolve) => {
        resolveHermesMutation = resolve;
      })),
      getSelection: jest.fn().mockResolvedValue(modelSelection('kimi-current', 'custom:moonshot')),
    });
    const openClaw = createAdapter({
      getSelection: jest.fn().mockResolvedValue(modelSelection('gpt-current', 'openai')),
    });
    let currentAdapter: AgentAdapter = hermes;
    let currentSessionKey = 'main';
    const { result, rerender } = renderHook(() => useChatModelPicker({
      connectionState: 'ready',
      adapter: currentAdapter,
      sessionKey: currentSessionKey,
      setInput: jest.fn(),
      setSessions: jest.fn(),
    }));

    await act(async () => { await Promise.resolve(); });
    act(() => {
      result.current.onSelectModel({
        id: 'kimi-next',
        name: 'Kimi next',
        provider: 'custom:moonshot',
      });
    });
    currentAdapter = openClaw;
    currentSessionKey = 'agent:main:main';
    rerender(undefined);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.currentModelHeaderLabel).toBe('openai/gpt-current');

    await act(async () => {
      resolveHermesMutation?.(modelSelection('kimi-stale', 'custom:moonshot'));
      await Promise.resolve();
    });
    expect(result.current.currentModelHeaderLabel).toBe('openai/gpt-current');
    expect(result.current.modelPickerError).toBeNull();
  });
});
