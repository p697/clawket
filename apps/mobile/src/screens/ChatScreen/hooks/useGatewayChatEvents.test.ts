import { act, renderHook } from '@testing-library/react-native';
import { ConnectionState } from '../../../types';
import { UiMessage } from '../../../types/chat';
import { useGatewayChatEvents } from './useGatewayChatEvents';
import { formatSystemErrorMessage } from './systemErrorMessage';
import {
  shouldDelayConnectionRecoveryMessage,
  shouldShowConnectionRecoveryMessage,
} from './connectionRecoveryPolicy';

jest.mock('../../../i18n', () => ({
  __esModule: true,
  default: {
    t: (key: string, options?: Record<string, unknown>) => {
      if (!options) return key;
      return key.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, token: string) => String(options[token] ?? ''));
    },
  },
}));

jest.mock('../../../services/gateway', () => ({
  extractText: (message?: { content?: unknown }) => {
    const content = message?.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
      .filter((block: { type?: string }) => block.type === 'text')
      .map((block: { text?: string }) => block.text ?? '')
      .join('');
  },
}));

type GatewayEventMap = {
  chatDelta: { runId: string; sessionKey: string; text: string };
  chatFinal: { runId: string; sessionKey: string; message?: unknown; usage?: unknown };
  chatAborted: { runId: string; sessionKey: string };
  chatError: { runId: string; sessionKey: string; message: string };
  chatTool: { runId: string; sessionKey: string; toolCallId: string; name: string; phase: 'start' | 'update' | 'result'; status?: 'running' | 'success' | 'error' };
  chatRunStart: { runId: string; sessionKey?: string };
  chatCompaction: { runId: string; sessionKey?: string; phase: 'start' | 'end' };
  error: { code: string; message: string; retryable?: boolean; hint?: string };
  connection: { state: ConnectionState };
  pairingRequired: unknown;
  pairingResolved: unknown;
  execApprovalRequested: never;
  execApprovalResolved: never;
};

function createGatewayMock() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  return {
    on: jest.fn((event: string, listener: (payload: unknown) => void) => {
      const bucket = listeners.get(event) ?? new Set<(payload: unknown) => void>();
      bucket.add(listener);
      listeners.set(event, bucket);
      return () => {
        bucket.delete(listener);
      };
    }),
    emit<K extends keyof GatewayEventMap>(event: K, payload: GatewayEventMap[K]) {
      for (const listener of listeners.get(event) ?? []) {
        listener(payload);
      }
    },
    fetchHistory: jest.fn().mockResolvedValue({ messages: [] }),
    listSessions: jest.fn().mockResolvedValue([]),
    listAgents: jest.fn().mockResolvedValue({ agents: [], defaultId: null }),
    getConnectionState: jest.fn().mockReturnValue('ready'),
  };
}

function createHookHarness() {
  const gateway = createGatewayMock();
  let messages: UiMessage[] = [];
  let toolMessages: UiMessage[] = [];
  let chatStream: string | null = null;
  let isSending = false;
  let activityLabel: string | null = null;

  const sessionKeyRef = { current: 'agent:main:main' } as { current: string | null };
  const lastConnStateRef = { current: 'ready' as ConnectionState } as { current: ConnectionState };
  const compactionTimerRef = { current: null } as { current: ReturnType<typeof setTimeout> | null };
  const currentRunIdRef = { current: null } as { current: string | null };
  const streamStartedAtRef = { current: null } as { current: number | null };
  const chatStreamRef = { current: null } as { current: string | null };
  const sessionRunStateRef = { current: new Map() } as { current: Map<string, any> };
  const pendingOptimisticRunIdsRef = { current: new Map() } as { current: Map<string, string> };
  const agentActivityRef = { current: new Map() } as { current: Map<string, any> };
  const childSessionActivityRef = { current: new Map() } as { current: Map<string, any> };

  const setMessages = jest.fn((value: UiMessage[] | ((prev: UiMessage[]) => UiMessage[])) => {
    messages = typeof value === 'function' ? value(messages) : value;
  });
  const setToolMessages = jest.fn((value: UiMessage[] | ((prev: UiMessage[]) => UiMessage[])) => {
    toolMessages = typeof value === 'function' ? value(toolMessages) : value;
  });
  const setChatStream = jest.fn((value: string | null) => {
    chatStream = value;
  });
  const setIsSending = jest.fn((value: boolean) => {
    isSending = value;
  });
  const setActivityLabel = jest.fn((value: string | null) => {
    activityLabel = value;
  });

  const params = {
    gateway: gateway as any,
    config: null,
    showDebug: false,
    dbg: jest.fn(),
    sessionKeyRef,
    lastConnStateRef,
    compactionTimerRef,
    currentRunIdRef,
    streamStartedAtRef,
    chatStreamRef,
    sessionRunStateRef,
    pendingOptimisticRunIdsRef,
    setConnectionState: jest.fn(),
    setPairingPending: jest.fn(),
    setIsSending,
    setChatStream,
    setMessages,
    setToolMessages,
    commitCurrentStreamSegment: jest.fn(),
    clearTransientRunPresentation: jest.fn(),
    setCompactionNotice: jest.fn(),
    loadSessionsAndHistory: jest.fn().mockResolvedValue(undefined),
    reconcileLatestAssistantFromHistory: jest.fn().mockResolvedValue(undefined),
    currentAgentId: 'main',
    onAgentsLoaded: jest.fn(),
    onDefaultAgentId: jest.fn(),
    shouldIgnoreRunId: jest.fn().mockReturnValue(false),
    onStreamFinished: jest.fn(),
    execApprovalEnabled: false,
    setActivityLabel,
    agentActivityRef,
    childSessionActivityRef,
    onChildSessionActivityChange: jest.fn(),
    onAgentActiveCountChange: jest.fn(),
    resetAgentActiveCount: jest.fn(),
    onRunSignal: jest.fn(),
    onToolSettled: jest.fn(),
    onToolResult: jest.fn(),
  };

  return {
    gateway,
    params,
    getMessages: () => messages,
    getToolMessages: () => toolMessages,
    getChatStream: () => chatStream,
    getIsSending: () => isSending,
    getActivityLabel: () => activityLabel,
  };
}

describe('formatSystemErrorMessage', () => {
  it('appends the raw error on a new line', () => {
    expect(
      formatSystemErrorMessage(
        'Connection Error: Check your network connection and that OpenClaw is running.',
        'WebSocket open timed out',
      ),
    ).toBe(
      'Connection Error: Check your network connection and that OpenClaw is running.\nRaw Error: WebSocket open timed out',
    );
  });

  it('returns the primary message when the raw error is empty', () => {
    expect(formatSystemErrorMessage('Connection Error', '   ')).toBe('Connection Error');
  });
});

describe('shouldDelayConnectionRecoveryMessage', () => {
  it('returns true for websocket transport errors', () => {
    expect(shouldDelayConnectionRecoveryMessage('ws_error', 'WebSocket error')).toBe(true);
  });

  it('returns true for websocket open timeout', () => {
    expect(shouldDelayConnectionRecoveryMessage('ws_connect_timeout', 'WebSocket open timed out')).toBe(true);
  });

  it('returns true for challenge timeout', () => {
    expect(shouldDelayConnectionRecoveryMessage('challenge_timeout', 'Gateway challenge timed out')).toBe(true);
  });

  it('returns false for pairing required', () => {
    expect(shouldDelayConnectionRecoveryMessage('pairing_required', 'Pairing approval timed out. Please retry.')).toBe(false);
  });
});

describe('shouldShowConnectionRecoveryMessage', () => {
  it('returns true for websocket transport errors', () => {
    expect(shouldShowConnectionRecoveryMessage('ws_error', 'WebSocket error')).toBe(true);
  });

  it('returns true for pairing required', () => {
    expect(shouldShowConnectionRecoveryMessage('pairing_required', 'Pairing approval timed out. Please retry.')).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(shouldShowConnectionRecoveryMessage('invalid_json', 'Failed to parse server message')).toBe(false);
  });
});

describe('useGatewayChatEvents', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) {
        return;
      }
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('ignores streamed NO_REPLY prefix fragments in RN chat state', () => {
    const harness = createHookHarness();
    renderHook(() => useGatewayChatEvents(harness.params));

    act(() => {
      harness.gateway.emit('chatDelta', {
        runId: 'run-1',
        sessionKey: 'agent:main:main',
        text: 'NO',
      });
    });

    expect(harness.getChatStream()).toBeNull();
    expect(harness.params.currentRunIdRef.current).toBeNull();
    expect(harness.params.setChatStream).not.toHaveBeenCalled();
  });

  it('tracks child subagent session activity across start, delta, tool, and final', () => {
    const harness = createHookHarness();
    renderHook(() => useGatewayChatEvents(harness.params));

    act(() => {
      harness.gateway.emit('chatRunStart', {
        runId: 'run-child',
        sessionKey: 'agent:main:subagent:coder',
      });
    });

    expect(
      harness.params.childSessionActivityRef.current.get('agent:main:subagent:coder'),
    ).toMatchObject({ status: 'streaming' });

    act(() => {
      harness.gateway.emit('chatDelta', {
        runId: 'run-child',
        sessionKey: 'agent:main:subagent:coder',
        text: 'Inspecting repo state',
      });
    });

    expect(
      harness.params.childSessionActivityRef.current.get('agent:main:subagent:coder'),
    ).toMatchObject({
      status: 'streaming',
      previewText: 'Inspecting repo state',
    });

    act(() => {
      harness.gateway.emit('chatTool', {
        runId: 'run-child',
        sessionKey: 'agent:main:subagent:coder',
        toolCallId: 'tool-1',
        name: 'read',
        phase: 'start',
      });
    });

    expect(
      harness.params.childSessionActivityRef.current.get('agent:main:subagent:coder'),
    ).toMatchObject({
      status: 'tool_calling',
      toolName: 'read',
    });

    act(() => {
      harness.gateway.emit('chatFinal', {
        runId: 'run-child',
        sessionKey: 'agent:main:subagent:coder',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Done' }],
        },
      });
    });

    expect(
      harness.params.childSessionActivityRef.current.get('agent:main:subagent:coder'),
    ).toMatchObject({
      status: 'completed',
      toolName: 'read',
    });
    expect(harness.params.onChildSessionActivityChange).toHaveBeenCalled();
  });

  it('does not track non-subagent sessions in child session activity', () => {
    const harness = createHookHarness();
    renderHook(() => useGatewayChatEvents(harness.params));

    act(() => {
      harness.gateway.emit('chatRunStart', {
        runId: 'run-dm',
        sessionKey: 'agent:main:dm:alice',
      });
    });

    expect(harness.params.childSessionActivityRef.current.size).toBe(0);
    expect(harness.params.onChildSessionActivityChange).not.toHaveBeenCalled();
  });

  it('cleans up the active run without appending a bubble for exact NO_REPLY finals', () => {
    const harness = createHookHarness();
    harness.params.currentRunIdRef.current = 'run-1';
    harness.params.streamStartedAtRef.current = 123;
    harness.params.chatStreamRef.current = 'NO_REPLY';

    renderHook(() => useGatewayChatEvents(harness.params));

    act(() => {
      harness.gateway.emit('chatFinal', {
        runId: 'run-1',
        sessionKey: 'agent:main:main',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'NO_REPLY' }],
        },
      });
    });

    expect(harness.getMessages()).toEqual([]);
    expect(harness.params.currentRunIdRef.current).toBeNull();
    expect(harness.params.streamStartedAtRef.current).toBeNull();
    expect(harness.params.clearTransientRunPresentation).toHaveBeenCalledWith({
      preserveCurrentStream: true,
      preserveToolMessages: true,
    });
    expect(harness.params.onStreamFinished).toHaveBeenCalled();
  });

  it('cleans up the active run without appending a bubble for NO_ finals', () => {
    const harness = createHookHarness();
    harness.params.currentRunIdRef.current = 'run-1';
    harness.params.streamStartedAtRef.current = 123;
    harness.params.chatStreamRef.current = 'NO_';

    renderHook(() => useGatewayChatEvents(harness.params));

    act(() => {
      harness.gateway.emit('chatFinal', {
        runId: 'run-1',
        sessionKey: 'agent:main:main',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'NO_' }],
        },
      });
    });

    expect(harness.getMessages()).toEqual([]);
    expect(harness.params.currentRunIdRef.current).toBeNull();
    expect(harness.params.streamStartedAtRef.current).toBeNull();
    expect(harness.params.clearTransientRunPresentation).toHaveBeenCalledWith({
      preserveCurrentStream: true,
      preserveToolMessages: true,
    });
    expect(harness.params.onStreamFinished).toHaveBeenCalled();
  });

  it('shows a dedicated message for unsupported direct local TLS gateways', () => {
    const harness = createHookHarness();
    renderHook(() => useGatewayChatEvents(harness.params));

    act(() => {
      harness.gateway.emit('error', {
        code: 'local_tls_unsupported',
        message: 'Clawket mobile does not currently support direct local TLS gateway connections.',
        retryable: false,
      });
    });

    expect(harness.getMessages()).toEqual([
      expect.objectContaining({
        role: 'system',
        text: 'Direct local TLS gateway connections are not supported in Clawket mobile yet. Disable OpenClaw gateway TLS for LAN pairing, or use Relay/Tailscale instead.',
      }),
    ]);
  });

  it('waits for Hermes session sync before loading agents after reconnect', async () => {
    jest.useFakeTimers();
    const harness = createHookHarness();
    let resolveSessions: (() => void) | null = null;
    harness.params.config = { backendKind: 'hermes' } as any;
    harness.params.lastConnStateRef.current = 'connecting';
    harness.params.loadSessionsAndHistory = jest.fn().mockImplementation(() => new Promise<void>((resolve) => {
      resolveSessions = resolve;
    }));

    renderHook(() => useGatewayChatEvents(harness.params));

    act(() => {
      harness.gateway.emit('connection', { state: 'ready' });
    });

    expect(harness.params.loadSessionsAndHistory).toHaveBeenCalledTimes(1);
    expect(harness.gateway.listAgents).not.toHaveBeenCalled();

    await act(async () => {
      resolveSessions?.();
      await Promise.resolve();
    });

    expect(harness.gateway.listAgents).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1500);
      await Promise.resolve();
    });

    expect(harness.gateway.listAgents).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('keeps OpenClaw agent loading immediate after reconnect', async () => {
    const harness = createHookHarness();
    harness.params.config = { backendKind: 'openclaw' } as any;
    harness.params.lastConnStateRef.current = 'connecting';
    harness.params.loadSessionsAndHistory = jest.fn().mockResolvedValue(undefined);

    renderHook(() => useGatewayChatEvents(harness.params));

    await act(async () => {
      harness.gateway.emit('connection', { state: 'ready' });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(harness.params.loadSessionsAndHistory).toHaveBeenCalledTimes(1);
    expect(harness.gateway.listAgents).toHaveBeenCalledTimes(1);
  });
});
