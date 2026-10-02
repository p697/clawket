import { act, renderHook } from '@testing-library/react-native';
import {
  resolveCapabilities,
  type AgentAdapter,
  type BackendKind,
  type ModelSelectionState,
} from '@clawket/agent-protocol';
import { analyticsEvents } from '../services/analytics/events';
import type { ConnectionState, SessionInfo } from '../types';
import { useChatModelPicker } from './useChatModelPicker';
import { runtimeSettingsStatus } from '../connection/runtime-settings-status';
import { AdapterError } from '@clawket/agent-protocol';
import { SessionCatalogSupersededError } from '../connection/adapters/session-catalog';

afterEach(() => runtimeSettingsStatus.clearConnection('codex-connection'));

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
  setFastMode?: jest.Mock;
  setPermissions?: jest.Mock;
  listSessions?: jest.Mock;
};

function createAdapter(fixture: ModelOpsFixture = {}) {
  const backendKind = fixture.backendKind ?? 'openclaw';
  const transportKinds = { openclaw: 'relay', hermes: 'relay', 'local-model': 'relay', pi: 'relay', codex: 'relay', 'claude-code': 'relay' } as const;
  const modelOps = {
    ...(fixture.list ? { list: fixture.list } : {}),
    ...(fixture.getSelection ? { getSelection: fixture.getSelection } : {}),
    ...(fixture.setSelection ? { setSelection: fixture.setSelection } : {}),
    ...(fixture.setFastMode ? { setFastMode: fixture.setFastMode } : {}),
    ...(fixture.setPermissions ? { setPermissions: fixture.setPermissions } : {}),
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
    ...options,
    models: options.models ?? [],
    providers: options.providers,
    note: options.note,
  };
}

describe('useChatModelPicker', () => {
  it('retains a cold refresh catalog without overwriting newer native initialization metadata', async () => {
    let resolveSelection!: (value: ModelSelectionState) => void;
    const adapter = createAdapter({ backendKind: 'claude-code', getSelection: jest.fn(() => new Promise<ModelSelectionState>(resolve => { resolveSelection = resolve; })) });
    const { result, rerender } = renderHook<ReturnType<typeof useChatModelPicker>, { model?: string }>(({ model }) => useChatModelPicker({
      adapter, connectionState: 'ready', sessionKey: 'current',
      sessionMetadata: { key: 'current', model }, setInput: jest.fn(), setSessions: jest.fn(),
    }), { initialProps: {} });
    rerender({ model: 'haiku' });
    const catalog = [{ id: 'haiku', name: 'Haiku 4.5', provider: 'anthropic' }];
    await act(async () => { resolveSelection(modelSelection('stale-model', 'anthropic', {
      models: catalog, fastMode: { enabled: true, available: true }, thinkingLevel: 'high',
    })); });
    expect(result.current.availableModels).toEqual(catalog);
    expect(result.current.currentModel).toBe('haiku');
    expect(result.current.currentModelProvider).toBeNull();
    expect(result.current.currentModelHeaderLabel).toBe('anthropic/haiku');
    expect(result.current.currentModelDisplayName).toBe('Haiku 4.5');
    expect(result.current.nativeThinkingLevel).toBeNull();
    expect(result.current.fastMode).toEqual({ enabled: true, available: true });
    expect(adapter.listSessions).not.toHaveBeenCalled();
  });

  it.each(['session', 'adapter', 'offline'] as const)('rejects an old refresh catalog after a %s context change', async (change) => {
    let resolveSelection!: (value: ModelSelectionState) => void;
    const adapter = createAdapter({ backendKind: 'claude-code', getSelection: jest.fn()
      .mockImplementationOnce(() => new Promise<ModelSelectionState>(resolve => { resolveSelection = resolve; }))
      .mockResolvedValue(modelSelection('new-model', 'anthropic')) });
    const replacement = createAdapter({ backendKind: 'claude-code',
      getSelection: jest.fn().mockResolvedValue(modelSelection('replacement-model', 'anthropic')) });
    type Context = { adapter: AgentAdapter; key: string; state: ConnectionState };
    const initialProps: Context = { adapter, key: 'old', state: 'ready' };
    const { result, rerender } = renderHook<ReturnType<typeof useChatModelPicker>, Context>(
      ({ adapter: activeAdapter, key, state }) => useChatModelPicker({ adapter: activeAdapter,
        connectionState: state, sessionKey: key, setInput: jest.fn(), setSessions: jest.fn() }), { initialProps });
    rerender({ adapter: change === 'adapter' ? replacement : adapter,
      key: change === 'session' ? 'new' : 'old', state: change === 'offline' ? 'closed' : 'ready' });
    await act(async () => { await Promise.resolve(); });
    const selected = result.current.currentModel;
    await act(async () => { resolveSelection(modelSelection('haiku', 'anthropic', {
      models: [{ id: 'haiku', name: 'Haiku 4.5', provider: 'anthropic' }],
    })); });
    expect(result.current.availableModels).toEqual([]);
    expect(result.current.currentModel).toBe(selected);
  });

  it('does not let an earlier read undo an explicit model choice', async () => {
    let resolveSelection!: (value: ModelSelectionState) => void;
    const adapter = createAdapter({ backendKind: 'claude-code',
      getSelection: jest.fn(() => new Promise<ModelSelectionState>(resolve => { resolveSelection = resolve; })),
      setSelection: jest.fn().mockResolvedValue(modelSelection('chosen-model', 'anthropic')),
    });
    const { result } = renderHook(() => useChatModelPicker({ adapter, connectionState: 'ready', sessionKey: 'current', setInput: jest.fn(), setSessions: jest.fn() }));
    await act(async () => { result.current.onSelectModel({ id: 'chosen-model', name: 'Chosen model', provider: 'anthropic' }); });
    await act(async () => { resolveSelection(modelSelection('stale-model', 'anthropic')); });
    expect(result.current.currentModel).toBe('chosen-model');
  });

  it('keeps newly resolved metadata when an older picker selection completes, without leaving loading stuck', async () => {
    let resolveSelection!: (value: ModelSelectionState) => void;
    const adapter = createAdapter({ backendKind: 'claude-code', list: jest.fn().mockResolvedValue([]),
      getSelection: jest.fn().mockResolvedValueOnce(modelSelection('', 'anthropic'))
        .mockImplementationOnce(() => new Promise<ModelSelectionState>(resolve => { resolveSelection = resolve; })),
    });
    const { result, rerender } = renderHook<ReturnType<typeof useChatModelPicker>, { model?: string }>(({ model }) => useChatModelPicker({
      adapter, connectionState: 'ready', sessionKey: 'current',
      sessionMetadata: { key: 'current', model }, setInput: jest.fn(), setSessions: jest.fn(),
    }), { initialProps: {} });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { result.current.openModelPicker(); await Promise.resolve(); });
    expect(result.current.modelPickerLoading).toBe(true);
    rerender({ model: 'native-new-model' });
    await act(async () => { resolveSelection(modelSelection('stale-model', 'anthropic')); });
    expect(result.current.currentModel).toBe('native-new-model');
    expect(result.current.modelPickerLoading).toBe(false);
  });

  it('clears the previous session model while a new Claude session has no resolved model', async () => {
    const adapter = createAdapter({
      backendKind: 'claude-code',
      getSelection: jest.fn((key: string) => Promise.resolve(modelSelection(key === 'old' ? 'claude-sonnet-test' : '', 'anthropic'))),
      listSessions: jest.fn().mockResolvedValue([{ key: 'old', model: 'claude-sonnet-test', modelProvider: 'anthropic' }]),
    });
    const { result, rerender } = renderHook<ReturnType<typeof useChatModelPicker>, { key: string }>(({ key }) => useChatModelPicker({
      adapter, connectionState: 'ready', sessionKey: key, setInput: jest.fn(), setSessions: jest.fn(),
    }), { initialProps: { key: 'old' } });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.currentModel).toBe('claude-sonnet-test');
    rerender({ key: 'new' });
    expect(result.current.currentModelDisplayName).toBeNull();
    await act(async () => { await Promise.resolve(); });
    expect(result.current.currentModel).toBeNull();
    expect(result.current.currentModelProvider).toBeNull();
  });

  it('keeps the global Hermes model when changing conversations', async () => {
    const adapter = createAdapter({ backendKind: 'hermes', getSelection: jest.fn().mockResolvedValue(modelSelection('deepseek-test', 'deepseek')) });
    const { result, rerender } = renderHook<ReturnType<typeof useChatModelPicker>, { key: string }>(({ key }) => useChatModelPicker({
      adapter, connectionState: 'ready', sessionKey: key, setInput: jest.fn(), setSessions: jest.fn(),
    }), { initialProps: { key: 'old' } });
    await act(async () => { await Promise.resolve(); });
    rerender({ key: 'new' });
    expect(result.current.currentModel).toBe('deepseek-test');
    await act(async () => { await Promise.resolve(); });
  });

  it('hydrates a newly initialized session model without reopening the picker', async () => {
    const adapter = createAdapter({ backendKind: 'claude-code', getSelection: jest.fn().mockResolvedValue(modelSelection('', 'anthropic')) });
    const { result, rerender } = renderHook<ReturnType<typeof useChatModelPicker>, { model?: string }>(({ model }) => useChatModelPicker({
      adapter, connectionState: 'ready', sessionKey: 'branch',
      sessionMetadata: { key: 'branch', model }, setInput: jest.fn(), setSessions: jest.fn(),
    }), { initialProps: {} });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.currentModelDisplayName).toBeNull();
    rerender({ model: 'claude-sonnet-test' });
    expect(result.current.currentModelDisplayName).toBe('claude-sonnet-test');
  });

  it('ignores unrelated and globally scoped session model metadata', async () => {
    for (const backendKind of ['claude-code', 'hermes'] as const) {
      const adapter = createAdapter({ backendKind, getSelection: jest.fn().mockResolvedValue(modelSelection('current', 'provider')) });
      const { result, rerender, unmount } = renderHook<ReturnType<typeof useChatModelPicker>, { key: string; model: string }>(({ key, model }) => useChatModelPicker({
        adapter, connectionState: 'ready', sessionKey: 'selected',
        sessionMetadata: { key, model }, setInput: jest.fn(), setSessions: jest.fn(),
      }), { initialProps: { key: 'other', model: 'unrelated' } });
      await act(async () => { await Promise.resolve(); });
      expect(result.current.currentModel).toBe('current');
      if (backendKind === 'hermes') {
        rerender({ key: 'selected', model: 'old-session-model' });
        expect(result.current.currentModel).toBe('current');
      }
      unmount();
    }
  });

  it('shows the resolved native model for an alias without changing its write identity', async () => {
    const adapter = createAdapter({ backendKind: 'claude-code', getSelection: jest.fn().mockResolvedValue(modelSelection('default', 'anthropic', {
      models: [{ id: 'default', name: 'Default (recommended)', provider: 'anthropic', resolvedModel: 'claude-opus-test[1m]' }],
    })) });
    const { result } = renderHook(() => useChatModelPicker({ adapter, connectionState: 'ready', sessionKey: 'new', setInput: jest.fn(), setSessions: jest.fn() }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.currentModel).toBe('default');
    expect(result.current.currentModelDisplayName).toBe('claude-opus-test[1m]');
  });

  it.each(['haiku', 'claude-haiku-4-5-20251001'])('uses the catalog display name in the composer while retaining the exact model ID (selection: %s)', async (current) => {
    const model = { id: 'haiku', name: 'Haiku 4.5', provider: 'anthropic', resolvedModel: 'claude-haiku-4-5-20251001' };
    const adapter = createAdapter({ backendKind: 'claude-code', getSelection: jest.fn().mockResolvedValue(modelSelection(current, 'anthropic', {
      models: [model],
    })) });
    const { result } = renderHook(() => useChatModelPicker({
      adapter, connectionState: 'ready', sessionKey: 'new', setInput: jest.fn(), setSessions: jest.fn(),
    }));
    await act(async () => {});
    expect(result.current.currentModel).toBe(current);
    expect(result.current.currentModelDisplayName).toBe('Haiku 4.5');
    expect(result.current.availableModels).toEqual([model]);
  });

  it('retains an alias icon after a session update omits its provider without changing the model selection', async () => {
    const model = { id: 'haiku', name: 'Haiku 4.5', provider: 'anthropic', resolvedModel: 'claude-haiku-4-5-20251001' };
    const setSelection = jest.fn();
    const adapter = createAdapter({ backendKind: 'claude-code', setSelection,
      getSelection: jest.fn().mockResolvedValue(modelSelection('haiku', 'anthropic', { models: [model] })),
    });
    const { result, rerender } = renderHook<ReturnType<typeof useChatModelPicker>, { metadata?: SessionInfo }>(
      ({ metadata }) => useChatModelPicker({ adapter, connectionState: 'ready', sessionKey: 'current',
        sessionMetadata: metadata, setInput: jest.fn(), setSessions: jest.fn() }),
      { initialProps: {} },
    );
    await act(async () => {});
    expect(result.current.currentModelHeaderLabel).toBe('anthropic/haiku');
    rerender({ metadata: { key: 'current', model: 'haiku' } });
    expect(result.current.currentModelProvider).toBeNull();
    expect(result.current.currentModel).toBe('haiku');
    expect(result.current.currentModelHeaderLabel).toBe('anthropic/haiku');
    expect(result.current.currentModelDisplayName).toBe('Haiku 4.5');
    expect(setSelection).not.toHaveBeenCalled();

    rerender({ metadata: { key: 'current', model: 'haiku', modelProvider: 'custom-provider' } });
    expect(result.current.currentModelProvider).toBe('custom-provider');
    expect(result.current.currentModelHeaderLabel).toBe('custom-provider/haiku');
    expect(setSelection).not.toHaveBeenCalled();
  });

  it('does not infer an alias provider from an ambiguous catalog', async () => {
    const adapter = createAdapter({ backendKind: 'claude-code',
      getSelection: jest.fn().mockResolvedValue(modelSelection('alias', '', { models: [
        { id: 'alias', name: 'Model A', provider: 'anthropic' },
        { id: 'alias', name: 'Model B', provider: 'openai' },
      ] })),
    });
    const { result } = renderHook(() => useChatModelPicker({ adapter, connectionState: 'ready', sessionKey: 'current',
      setInput: jest.fn(), setSessions: jest.fn() }));
    await act(async () => {});
    expect(result.current.currentModelProvider).toBeNull();
    expect(result.current.currentModelHeaderLabel).toBe('alias');
  });

  it('does not duplicate the catalog provider on an already namespaced model identity', async () => {
    const adapter = createAdapter({ backendKind: 'claude-code',
      getSelection: jest.fn().mockResolvedValue(modelSelection('anthropic/haiku', '', { models: [
        { id: 'haiku', name: 'Haiku 4.5', provider: 'anthropic' },
      ] })),
    });
    const { result } = renderHook(() => useChatModelPicker({ adapter, connectionState: 'ready', sessionKey: 'current',
      setInput: jest.fn(), setSessions: jest.fn() }));
    await act(async () => {});
    expect(result.current.currentModel).toBe('anthropic/haiku');
    expect(result.current.currentModelHeaderLabel).toBe('anthropic/haiku');
  });

  it('keeps the native model ID as the composer fallback when the catalog has not arrived', async () => {
    const adapter = createAdapter({ backendKind: 'codex', getSelection: jest.fn().mockResolvedValue(modelSelection('native-model-id', 'openai')) });
    const { result } = renderHook(() => useChatModelPicker({
      adapter, connectionState: 'ready', sessionKey: 'new', setInput: jest.fn(), setSessions: jest.fn(),
    }));
    await act(async () => {});
    expect(result.current.currentModelDisplayName).toBe('native-model-id');
  });

  it.each([
    { input: ['text'], expected: false },
    { input: ['text', 'image'], expected: true },
    { input: undefined, expected: undefined },
  ])('uses the selected provider image capability: $expected', async ({ input, expected }) => {
    const adapter = createAdapter({ backendKind: 'pi', getSelection: jest.fn().mockResolvedValue(modelSelection('same', 'selected', {
      models: [
        { id: 'same', name: 'Other', provider: 'other', input: ['text', 'image'] },
        { id: 'same', name: 'Selected', provider: 'selected', input: input as Array<'text' | 'image'> | undefined },
      ],
    })) });
    const { result } = renderHook(() => useChatModelPicker({ adapter, connectionState: 'ready', sessionKey: 'new', setInput: jest.fn(), setSessions: jest.fn() }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.currentModelSupportsImages).toBe(expected);
  });

  it('does not borrow the previous session image restriction while refreshing another session', async () => {
    const getSelection = jest.fn().mockResolvedValueOnce(modelSelection('text', 'p', {
      models: [{ id: 'text', name: 'Text', provider: 'p', input: ['text'] }],
    })).mockImplementation(() => new Promise(() => {}));
    const adapter = createAdapter({ backendKind: 'pi', getSelection });
    const { result, rerender } = renderHook<ReturnType<typeof useChatModelPicker>, { key: string }>(({ key }) => useChatModelPicker({ adapter, connectionState: 'ready', sessionKey: key, setInput: jest.fn(), setSessions: jest.fn() }), { initialProps: { key: 'first' } });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.currentModelSupportsImages).toBe(false);
    rerender({ key: 'second' });
    expect(result.current.currentModelSupportsImages).toBeUndefined();
  });

  it('does not replace a new conversation model with another session from a stale list', async () => {
    const selection = jest.fn().mockResolvedValueOnce(modelSelection('current', 'anthropic')).mockResolvedValue(modelSelection('', ''));
    const adapter = createAdapter({ getSelection: selection, listSessions: jest.fn().mockResolvedValue([{ key: 'another', model: 'wrong' }]) });
    const { result } = renderHook(() => useChatModelPicker({ adapter, connectionState: 'ready', sessionKey: 'new', setInput: jest.fn(), setSessions: jest.fn() }));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await result.current.refreshCurrentModel(); });
    expect(result.current.currentModel).toBe('current');
  });

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

  it('keeps the model sheet open after a choice and offers that model first next time', async () => {
    const setSelection = jest.fn().mockResolvedValue({ ok: true, scope: 'session', ...modelSelection('gpt-5', 'openai') });
    const adapter = createAdapter({ setSelection });
    const { result } = renderHook(() => useChatModelPicker({
      connectionState: 'ready',
      adapter,
      sessionKey: 'agent:main:main',
      setInput: jest.fn(),
      setSessions: jest.fn(),
    }));
    act(() => result.current.setModelPickerVisible(true));
    act(() => { result.current.onSelectModel({ id: 'gpt-5', name: 'gpt-5', provider: 'openai' }); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    // A+ model sheet (owner-approved 2026-10-01): the check moves, the sheet stays.
    expect(result.current.modelPickerVisible).toBe(true);
    expect(result.current.recentModels).toEqual(['openai/gpt-5']);
    expect(result.current.modelScope).toBe('session');
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

  it('does not show another backend model while a replacement adapter refresh resolves', async () => {
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
    expect(result.current.currentModelHeaderLabel).toBeNull();

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


describe('configured default model', () => {
  it.each([false, true])('loads independently of model selection (config failure: %s)', async (fails) => {
    const adapter = createAdapter({ list: jest.fn().mockResolvedValue([{ id: 'mini', name: 'Mini', provider: 'openai' }]) });
    adapter.management!.models!.getCatalog = fails
      ? jest.fn().mockRejectedValue(new Error('config unavailable'))
      : jest.fn().mockResolvedValue({ defaults: { primary: 'openai/default' } });
    const { result } = renderHook(() => useChatModelPicker({ adapter, connectionState: 'ready', sessionKey: 'main', setInput: jest.fn(), setSessions: jest.fn() }));
    await act(async () => { result.current.openModelPicker(); });
    expect(result.current.configuredDefaultModel).toBe(fails ? undefined : 'openai/default');
    expect(result.current.modelPickerError).toBeNull();
    expect(result.current.availableModels).toHaveLength(1);
  });
});

it('hydrates and changes native reasoning without sending a slash-command prompt', async () => {
  const setThinkingLevel = jest.fn();
  const selection: ModelSelectionState = { currentModel: 'codex-model', currentProvider: 'openai', currentBaseUrl: '', thinkingLevel: 'medium', models: [{ id: 'codex-model', name: 'Codex model', provider: 'openai', reasoningLevels: ['low', 'medium'] }] };
  const adapter = createAdapter({ backendKind: 'codex', getSelection: jest.fn().mockResolvedValue(selection) });
  const write = jest.fn().mockResolvedValue({ ...selection, thinkingLevel: 'low' });
  adapter.management.models!.setThinkingLevel = write;
  const { result } = renderHook(() => useChatModelPicker({ adapter, connectionState: 'ready', sessionKey: 'owned', setInput: jest.fn(), setSessions: jest.fn(), setThinkingLevel }));
  await act(async () => {});
  expect(setThinkingLevel).toHaveBeenCalledWith('medium');
  await act(async () => { expect(result.current.selectNativeThinkingLevel('low')).toBe(true); });
  expect(write).toHaveBeenCalledWith('owned', 'low');
  expect(setThinkingLevel).toHaveBeenLastCalledWith('low');
  expect(adapter.prompt).not.toHaveBeenCalled();
});


describe('native confirmed runtime settings', () => {
  const native = (model = 'before') => modelSelection(model, 'provider', {
    fastMode: { enabled: false, available: true }, permissions: { mode: 'workspace', available: true, scope: 'session' },
  });
  it.each(['superseded', 'network'] as const)('keeps permission confirmation while handling a %s metadata fallback', async failure => {
    const selection = modelSelection('', 'openai', { permissions: {
      mode: 'workspace', available: true, scope: 'session', requiresConfirmation: true,
    } });
    const error = failure === 'superseded' ? new SessionCatalogSupersededError()
      : new AdapterError('network', 'Session catalog read was superseded');
    const listSessions = jest.fn().mockRejectedValue(error);
    const adapter = createAdapter({ backendKind: 'codex', getSelection: jest.fn().mockResolvedValue(selection), listSessions });
    const { result } = renderHook(() => useChatModelPicker({ adapter, connectionState: 'ready',
      sessionKey: 'session', setInput: jest.fn(), setSessions: jest.fn() }));
    await act(async () => {});
    expect(listSessions).toHaveBeenCalledTimes(1);
    expect(result.current.runtimeSettingsUnconfirmed).toBe(true);
    expect(result.current.permissions?.requiresConfirmation).toBe(true);
    expect(result.current.modelPickerVisible).toBe(failure === 'network');
    expect(result.current.modelPickerError).toBe(failure === 'network' ? error.message : null);
  });
  it('blocks sending on a native permission-confirmation requirement until explicit permission selection is acknowledged', async () => {
    const guarded = { ...native(), permissions: { mode: 'full-access' as const, available: true, scope: 'session' as const, requiresConfirmation: true } };
    const getSelection = jest.fn().mockResolvedValue(guarded);
    const setPermissions = jest.fn().mockResolvedValue({ ...native(), permissions: { mode: 'workspace', available: true, scope: 'session', requiresConfirmation: false } });
    const adapter = createAdapter({ backendKind: 'codex', getSelection, list: jest.fn(), setPermissions,
      setFastMode: jest.fn().mockResolvedValue({ ...guarded, fastMode: { enabled: true, available: true } }) });
    const { result } = renderHook(() => useChatModelPicker({ adapter, connectionState: 'ready', sessionKey: 'session', setInput: jest.fn(), setSessions: jest.fn() }));
    await act(async () => {});
    expect(result.current.runtimeSettingsUnconfirmedRef.current).toBe(true);
    expect(result.current.permissions?.requiresConfirmation).toBe(true);
    act(() => { result.current.setModelPickerVisible(false); result.current.setPermissionPickerVisible(false); });
    await act(async () => result.current.refreshCurrentModel());
    expect(result.current.runtimeSettingsUnconfirmed).toBe(true);
    await act(async () => result.current.onSelectFastMode(true));
    expect(result.current.runtimeSettingsUnconfirmedRef.current).toBe(true);
    await act(async () => result.current.onSelectPermissions('workspace'));
    expect(setPermissions).toHaveBeenCalledWith('workspace', 'session');
    expect(result.current.runtimeSettingsUnconfirmedRef.current).toBe(false);
    expect(result.current.permissions?.requiresConfirmation).toBe(false);
  });

  it('preserves the native permission requirement after remount and does not clear it from an old peer lacking the flag', async () => {
    const guarded = { ...native(), permissions: { mode: 'workspace' as const, available: true, scope: 'session' as const, requiresConfirmation: true } };
    const adapter = createAdapter({ backendKind: 'codex', getSelection: jest.fn().mockResolvedValue(guarded) });
    const initial = renderHook(() => useChatModelPicker({ adapter, connectionState: 'ready', sessionKey: 'session', setInput: jest.fn(), setSessions: jest.fn() }));
    await act(async () => {});
    initial.unmount();
    const getSelection = jest.fn().mockRejectedValue(new Error('Readback unavailable'));
    const replacement = createAdapter({ backendKind: 'codex', getSelection, list: jest.fn() });
    const next = renderHook(() => useChatModelPicker({ adapter: replacement, connectionState: 'ready', sessionKey: 'session', setInput: jest.fn(), setSessions: jest.fn() }));
    await act(async () => {});
    expect(next.result.current.runtimeSettingsUnconfirmedRef.current).toBe(true);
    expect(next.result.current.permissions?.requiresConfirmation).toBe(true);
    getSelection.mockResolvedValue(native());
    await act(async () => next.result.current.retryModelPickerLoad());
    expect(next.result.current.runtimeSettingsUnconfirmedRef.current).toBe(true);
    expect(next.result.current.permissions?.requiresConfirmation).toBe(true);
    getSelection.mockResolvedValue({ ...native(), permissions: { ...native().permissions!, requiresConfirmation: false } });
    await act(async () => next.result.current.retryModelPickerLoad());
    expect(next.result.current.runtimeSettingsUnconfirmedRef.current).toBe(false);
  });
  it.each(['refresh', 'picker'] as const)('keeps authoritative permissions and speed when model-only metadata arrives during %s', async source => {
    let resolveSelection!: (value: ModelSelectionState) => void;
    const getSelection = jest.fn().mockResolvedValue(native());
    if (source === 'refresh') getSelection.mockImplementation(() => new Promise(resolve => { resolveSelection = resolve; }));
    const adapter = createAdapter({ backendKind: 'codex', getSelection, list: jest.fn() });
    const { result, rerender } = renderHook<ReturnType<typeof useChatModelPicker>, { model?: string }>(({ model }) => useChatModelPicker({
      adapter, connectionState: 'ready', sessionKey: 'session', sessionMetadata: { key: 'session', model },
      setInput: jest.fn(), setSessions: jest.fn(),
    }), { initialProps: {} });
    await act(async () => {});
    if (source === 'picker') {
      getSelection.mockImplementation(() => new Promise(resolve => { resolveSelection = resolve; }));
      act(() => result.current.openPermissionPicker());
    }
    rerender({ model: 'newer-native-model' });
    await act(async () => resolveSelection({ ...native('older-model'),
      permissions: { mode: 'full-access', available: true, scope: 'session' }, fastMode: { enabled: true, available: true } }));
    expect(result.current.currentModel).toBe('newer-native-model');
    expect(result.current.permissions?.mode).toBe('full-access');
    expect(result.current.fastMode?.enabled).toBe(true);
  });
  it('does not let a read begun before a confirmed permission write restore the old permissions or speed', async () => {
    const full = { ...native(), permissions: { mode: 'full-access' as const, available: true, scope: 'session' as const }, fastMode: { enabled: true, available: true } };
    const getSelection = jest.fn().mockResolvedValue(native());
    const adapter = createAdapter({ backendKind: 'codex', getSelection, setPermissions: jest.fn().mockResolvedValue(full) });
    const { result } = renderHook(() => useChatModelPicker({ adapter, connectionState: 'ready', sessionKey: 'session', setInput: jest.fn(), setSessions: jest.fn() }));
    await act(async () => {});
    let oldRead!: (value: ModelSelectionState) => void;
    getSelection.mockImplementation(() => new Promise(resolve => { oldRead = resolve; }));
    let refreshing!: Promise<void>;
    act(() => { refreshing = result.current.refreshCurrentModel(); });
    await act(async () => result.current.onSelectPermissions('full-access'));
    expect(result.current.permissions?.mode).toBe('full-access');
    await act(async () => { oldRead(native()); await refreshing; });
    expect(result.current.permissions?.mode).toBe('full-access');
    expect(result.current.fastMode?.enabled).toBe(true);
    expect(result.current.runtimeSettingsUnconfirmed).toBe(false);
  });
  it('invalidates reads started during a permission write when its native confirmation arrives', async () => {
    let confirmWrite!: (value: ModelSelectionState) => void;
    const getSelection = jest.fn().mockResolvedValue(native());
    const adapter = createAdapter({ backendKind: 'codex', getSelection,
      setPermissions: jest.fn(() => new Promise(resolve => { confirmWrite = resolve; })) });
    const { result } = renderHook(() => useChatModelPicker({ adapter, connectionState: 'ready', sessionKey: 'session', setInput: jest.fn(), setSessions: jest.fn() }));
    await act(async () => {});
    act(() => result.current.onSelectPermissions('full-access'));
    let staleRead!: (value: ModelSelectionState) => void;
    getSelection.mockImplementation(() => new Promise(resolve => { staleRead = resolve; }));
    let refreshing!: Promise<void>;
    act(() => { refreshing = result.current.refreshCurrentModel(); });
    await act(async () => confirmWrite({ ...native(), permissions: { mode: 'full-access', available: true, scope: 'session' }, fastMode: { enabled: true, available: true } }));
    await act(async () => { staleRead(native()); await refreshing; });
    expect(result.current.permissions?.mode).toBe('full-access');
    expect(result.current.fastMode?.enabled).toBe(true);
  });
  it('does not let an older refresh replace a newer picker settings response', async () => {
    const getSelection = jest.fn().mockResolvedValue(native());
    const adapter = createAdapter({ backendKind: 'codex', getSelection, list: jest.fn() });
    const { result } = renderHook(() => useChatModelPicker({ adapter, connectionState: 'ready', sessionKey: 'session', setInput: jest.fn(), setSessions: jest.fn() }));
    await act(async () => {});
    const pending: Array<(value: ModelSelectionState) => void> = [];
    getSelection.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    let refreshing!: Promise<void>;
    act(() => { refreshing = result.current.refreshCurrentModel(); result.current.openPermissionPicker(); });
    await act(async () => pending[1]({ ...native(), permissions: { mode: 'full-access', available: true, scope: 'session' }, fastMode: { enabled: true, available: true } }));
    await act(async () => { pending[0](native()); await refreshing; });
    expect(result.current.permissions?.mode).toBe('full-access');
    expect(result.current.fastMode?.enabled).toBe(true);
  });
  it('clears a previous thinking level when an authoritative refresh returns the native default', async () => {
    const getSelection = jest.fn().mockResolvedValue({ ...native(), thinkingLevel: 'high' });
    const adapter = createAdapter({ backendKind: 'codex', getSelection });
    const { result } = renderHook(() => useChatModelPicker({
      adapter, connectionState: 'ready', sessionKey: 'session', setInput: jest.fn(), setSessions: jest.fn(),
    }));
    await act(async () => {});
    expect(result.current.nativeThinkingLevel).toBe('high');
    getSelection.mockResolvedValue(native());
    await act(async () => result.current.refreshCurrentModel());
    expect(result.current.nativeThinkingLevel).toBeNull();
    expect(adapter.prompt).not.toHaveBeenCalled();
  });

  it('offers the levels the backend reports for the current model until a read stops reporting them', async () => {
    const reported = modelSelection('gpt-6-astra', 'openai', {
      thinkingLevel: 'medium', thinkingLevels: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
    });
    const getSelection = jest.fn().mockResolvedValue(reported);
    const setSelection = jest.fn().mockResolvedValue({
      ...modelSelection('claude-fable-5', 'anthropic', { thinkingLevel: 'adaptive', thinkingLevels: ['low', 'high', 'adaptive'] }),
      ok: true, scope: 'session',
    });
    const adapter = createAdapter({ getSelection, setSelection });
    const { result } = renderHook(() => useChatModelPicker({
      adapter, connectionState: 'ready', sessionKey: 'session', setInput: jest.fn(), setSessions: jest.fn(),
    }));
    await act(async () => {});
    expect(result.current.nativeThinkingLevels).toEqual(['off', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(result.current.nativeThinkingLevel).toBe('medium');
    // A model switch reports the new model's levels and the level the backend kept.
    await act(async () => result.current.onSelectModel({ id: 'claude-fable-5', name: 'Claude Fable 5', provider: 'anthropic' }));
    expect(result.current.nativeThinkingLevels).toEqual(['low', 'high', 'adaptive']);
    expect(result.current.nativeThinkingLevel).toBe('adaptive');
    getSelection.mockResolvedValue(modelSelection('gpt-6-astra', 'openai'));
    await act(async () => result.current.refreshCurrentModel());
    expect(result.current.nativeThinkingLevels).toBeNull();
    expect(adapter.prompt).not.toHaveBeenCalled();
  });

  it('clears the old thinking choice when a confirmed model change has no reasoning levels', async () => {
    const getSelection = jest.fn().mockResolvedValue({ ...native(), thinkingLevel: 'high' });
    const nextModel = { id: 'plain', name: 'Plain', provider: 'provider', reasoningLevels: [] };
    const adapter = createAdapter({ backendKind: 'codex', getSelection,
      setSelection: jest.fn().mockResolvedValue({ ...native('plain'), models: [nextModel] }) });
    const { result } = renderHook(() => useChatModelPicker({
      adapter, connectionState: 'ready', sessionKey: 'session', setInput: jest.fn(), setSessions: jest.fn(),
    }));
    await act(async () => {});
    expect(result.current.nativeThinkingLevel).toBe('high');
    await act(async () => result.current.onSelectModel(nextModel));
    expect(result.current.currentModel).toBe('plain');
    expect(result.current.nativeThinkingLevel).toBeNull();
    expect(result.current.availableModels[0].reasoningLevels).toEqual([]);
    expect(adapter.prompt).not.toHaveBeenCalled();
  });

  it('waits for confirmed model settings and fences an overlapping permission tap', async () => {
    let confirm!: (state: ModelSelectionState) => void;
    const setPermissions = jest.fn();
    const adapter = createAdapter({ backendKind: 'codex', getSelection: jest.fn().mockResolvedValue(native()),
      setSelection: jest.fn(() => new Promise<ModelSelectionState>(resolve => { confirm = resolve; })), setPermissions });
    const { result } = renderHook(() => useChatModelPicker({ adapter, connectionState: 'ready', sessionKey: 'session', setInput: jest.fn(), setSessions: jest.fn() }));
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.onSelectModel({ id: 'after', name: 'After', provider: 'provider' }); result.current.onSelectPermissions('full-access'); });
    expect(result.current.currentModel).toBe('before');
    expect(result.current.runtimeSettingsBusy).toBe(true);
    expect(result.current.runtimeSettingsPendingRef.current).toBe(true);
    expect(setPermissions).not.toHaveBeenCalled();
    await act(async () => { confirm(native('after')); });
    expect(result.current.currentModel).toBe('after');
    expect(result.current.runtimeSettingsBusy).toBe(false);
  });
  it('keeps the acknowledged permission after failure and never writes the next session automatically', async () => {
    const setPermissions = jest.fn().mockRejectedValue(new Error('Owner did not apply settings'));
    const adapter = createAdapter({ backendKind: 'codex', getSelection: jest.fn().mockResolvedValue(native()), setPermissions });
    const { result, rerender } = renderHook<ReturnType<typeof useChatModelPicker>, { key: string }>(({ key }) => useChatModelPicker({ adapter, connectionState: 'ready', sessionKey: key, setInput: jest.fn(), setSessions: jest.fn() }), { initialProps: { key: 'first' } });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { result.current.onSelectPermissions('full-access'); });
    expect(setPermissions).toHaveBeenCalledWith('full-access', 'first');
    expect(result.current.permissions?.mode).toBe('workspace');
    expect(result.current.modelPickerError).toBe('Owner did not apply settings');
    rerender({ key: 'second' });
    expect(result.current.permissions).toBeUndefined();
    await act(async () => { await Promise.resolve(); });
    expect(setPermissions).toHaveBeenCalledTimes(1);
  });
  it('does not let an old session setting reply replace the current session', async () => {
    let confirm!: (state: ModelSelectionState) => void;
    const adapter = createAdapter({ backendKind: 'codex', getSelection: jest.fn().mockResolvedValue(native()),
      setFastMode: jest.fn(() => new Promise<ModelSelectionState>(resolve => { confirm = resolve; })) });
    const { result, rerender } = renderHook<ReturnType<typeof useChatModelPicker>, { key: string }>(({ key }) => useChatModelPicker({ adapter, connectionState: 'ready', sessionKey: key, setInput: jest.fn(), setSessions: jest.fn() }), { initialProps: { key: 'first' } });
    await act(async () => { await Promise.resolve(); });
    act(() => result.current.onSelectFastMode(true));
    rerender({ key: 'second' });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { confirm({ ...native('stale'), fastMode: { enabled: true, available: true } }); });
    expect(result.current.currentModel).toBe('before');
    expect(result.current.fastMode?.enabled).toBe(false);
    expect(result.current.runtimeSettingsBusy).toBe(false);
  });

  it('keeps an interrupted permission write unconfirmed until a successful native readback', async () => {
    let rejectWrite!: (reason: Error) => void;
    const getSelection = jest.fn().mockResolvedValue(native());
    const adapter = createAdapter({ backendKind: 'codex', getSelection, list: jest.fn(),
      setPermissions: jest.fn(() => new Promise<ModelSelectionState>((_resolve, reject) => { rejectWrite = reject; })) });
    const { result, rerender } = renderHook<ReturnType<typeof useChatModelPicker>, { state: 'ready' | 'reconnecting' }>(({ state }) => useChatModelPicker({
      adapter, connectionState: state, sessionKey: 'session', setInput: jest.fn(), setSessions: jest.fn(),
    }), { initialProps: { state: 'ready' } });
    await act(async () => { await Promise.resolve(); });
    act(() => result.current.onSelectPermissions('full-access'));
    rerender({ state: 'reconnecting' });
    await act(async () => rejectWrite(new Error('Connection interrupted')));
    expect(result.current.runtimeSettingsBusy).toBe(false);
    expect(result.current.runtimeSettingsPendingRef.current).toBe(false);
    expect(result.current.runtimeSettingsUnconfirmedRef.current).toBe(true);
    expect(result.current.permissions?.mode).toBe('workspace');
    expect(result.current.modelPickerError).toBe('Connection interrupted');
    act(() => result.current.setModelPickerVisible(false));
    expect(result.current.runtimeSettingsUnconfirmed).toBe(true);

    getSelection.mockRejectedValue(new Error('Readback unavailable'));
    rerender({ state: 'ready' });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.runtimeSettingsUnconfirmed).toBe(true);
    getSelection.mockResolvedValue(modelSelection('before', 'provider', {
      permissions: { mode: null, available: false, scope: 'session' },
    }));
    await act(async () => result.current.retryModelPickerLoad());
    expect(result.current.runtimeSettingsUnconfirmed).toBe(true);

    getSelection.mockResolvedValue({ ...native(), permissions: { mode: 'full-access', available: true, scope: 'session' } });
    await act(async () => result.current.retryModelPickerLoad());
    expect(result.current.runtimeSettingsUnconfirmedRef.current).toBe(false);
    expect(result.current.runtimeSettingsUnconfirmed).toBe(false);
    expect(result.current.permissions?.mode).toBe('full-access');
  });

  it('preserves the uncertain conversation across adapter replacement without letting its late reply update another session', async () => {
    let resolveWrite!: (state: ModelSelectionState) => void;
    const adapter = createAdapter({ backendKind: 'codex', getSelection: jest.fn().mockResolvedValue(native()),
      setFastMode: jest.fn(() => new Promise<ModelSelectionState>(resolve => { resolveWrite = resolve; })) });
    const replacement = createAdapter({ backendKind: 'codex', getSelection: jest.fn().mockRejectedValue(new Error('Readback unavailable')) });
    const { result, rerender } = renderHook<ReturnType<typeof useChatModelPicker>, { selectedAdapter: AgentAdapter; key: string }>(({ selectedAdapter, key }) => useChatModelPicker({
      adapter: selectedAdapter, connectionState: 'ready', sessionKey: key, setInput: jest.fn(), setSessions: jest.fn(),
    }), { initialProps: { selectedAdapter: adapter, key: 'first' } });
    await act(async () => { await Promise.resolve(); });
    act(() => result.current.onSelectFastMode(true));
    rerender({ selectedAdapter: replacement, key: 'second' });
    await act(async () => { await Promise.resolve(); });
    await act(async () => resolveWrite({ ...native('late'), fastMode: { enabled: true, available: true } }));
    expect(result.current.currentModel).toBeNull();
    expect(result.current.runtimeSettingsUnconfirmed).toBe(false);
    rerender({ selectedAdapter: replacement, key: 'first' });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.runtimeSettingsUnconfirmedRef.current).toBe(true);
    expect(result.current.runtimeSettingsUnconfirmed).toBe(true);
  });

  it('settles a picker read while offline so the same adapter can retry after recovery', async () => {
    let rejectRead!: (reason: Error) => void;
    const getSelection = jest.fn().mockResolvedValueOnce(native())
      .mockImplementationOnce(() => new Promise<ModelSelectionState>((_resolve, reject) => { rejectRead = reject; }))
      .mockResolvedValue(native());
    const adapter = createAdapter({ backendKind: 'codex', getSelection, list: jest.fn() });
    const { result, rerender } = renderHook<ReturnType<typeof useChatModelPicker>, { state: 'ready' | 'reconnecting' }>(({ state }) => useChatModelPicker({
      adapter, connectionState: state, sessionKey: 'session', setInput: jest.fn(), setSessions: jest.fn(),
    }), { initialProps: { state: 'ready' } });
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.openModelPicker(); });
    expect(result.current.modelPickerLoading).toBe(true);
    rerender({ state: 'reconnecting' });
    await act(async () => rejectRead(new Error('Connection interrupted')));
    expect(result.current.modelPickerLoading).toBe(false);
    expect(result.current.modelPickerVisible).toBe(true);
    expect(result.current.modelPickerError).toBe('Connection interrupted');
    rerender({ state: 'ready' });
    await act(async () => result.current.retryModelPickerLoad());
    expect(result.current.modelPickerLoading).toBe(false);
    expect(result.current.modelPickerError).toBeNull();
  });

  it('keeps Send blocked when a Thread remounts after a write whose outcome is unknown', async () => {
    let rejectWrite!: (reason: Error) => void;
    const adapter = createAdapter({ backendKind: 'codex', getSelection: jest.fn().mockResolvedValue(native()),
      setPermissions: jest.fn(() => new Promise<ModelSelectionState>((_resolve, reject) => { rejectWrite = reject; })) });
    const first = renderHook(() => useChatModelPicker({ adapter, connectionState: 'ready', sessionKey: 'session', setInput: jest.fn(), setSessions: jest.fn() }));
    await act(async () => { await Promise.resolve(); });
    act(() => first.result.current.onSelectPermissions('full-access'));
    first.unmount();
    const getSelection = jest.fn().mockRejectedValue(new Error('Readback unavailable'));
    const replacement = createAdapter({ backendKind: 'codex', getSelection, list: jest.fn() });
    const next = renderHook(() => useChatModelPicker({ adapter: replacement, connectionState: 'ready', sessionKey: 'session', setInput: jest.fn(), setSessions: jest.fn() }));
    await act(async () => { await Promise.resolve(); });
    expect(next.result.current.runtimeSettingsUnconfirmedRef.current).toBe(true);
    expect(next.result.current.modelPickerVisible).toBe(true);
    expect(next.result.current.modelPickerError).toBe('Readback unavailable');
    await act(async () => rejectWrite(new Error('Connection interrupted')));
    expect(next.result.current.runtimeSettingsUnconfirmed).toBe(true);
    getSelection.mockResolvedValue({ ...native(), permissions: { mode: 'full-access', available: true, scope: 'session' } });
    await act(async () => next.result.current.retryModelPickerLoad());
    expect(next.result.current.runtimeSettingsUnconfirmedRef.current).toBe(false);
    expect(next.result.current.permissions?.mode).toBe('full-access');
  });

  it('does not let a retired picker read settle the next session loading state', async () => {
    let rejectOldRead!: (reason: Error) => void;
    let resolveNewRead!: (state: ModelSelectionState) => void;
    const getSelection = jest.fn().mockResolvedValueOnce(native())
      .mockImplementationOnce(() => new Promise<ModelSelectionState>((_resolve, reject) => { rejectOldRead = reject; }))
      .mockResolvedValueOnce(native())
      .mockImplementationOnce(() => new Promise<ModelSelectionState>(resolve => { resolveNewRead = resolve; }));
    const adapter = createAdapter({ backendKind: 'codex', getSelection, list: jest.fn() });
    const { result, rerender } = renderHook<ReturnType<typeof useChatModelPicker>, { key: string }>(({ key }) => useChatModelPicker({
      adapter, connectionState: 'ready', sessionKey: key, setInput: jest.fn(), setSessions: jest.fn(),
    }), { initialProps: { key: 'first' } });
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.openModelPicker(); });
    rerender({ key: 'second' });
    expect(result.current.modelPickerLoading).toBe(false);
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.openModelPicker(); });
    await act(async () => rejectOldRead(new Error('Old conversation disconnected')));
    expect(result.current.modelPickerLoading).toBe(true);
    expect(result.current.modelPickerError).toBeNull();
    await act(async () => resolveNewRead(native('second-model')));
    expect(result.current.modelPickerLoading).toBe(false);
    expect(result.current.currentModel).toBe('second-model');
  });
});
