import { act, renderHook } from '@testing-library/react-native';
import {
  createMockAdapter,
  type ConnectionDescriptor,
  type SessionDescriptor,
  type SessionUpdate,
} from '@clawket/agent-protocol';
import {
  mapAdapterChatMessage,
  mapAdapterSessionUpdate,
  useAdapterChatEvents,
} from './useAdapterChatEvents';

jest.mock('../i18n', () => ({
  __esModule: true,
  default: { t: (key: string) => key },
}));

const connection: ConnectionDescriptor = {
  id: 'connection-1',
  backendKind: 'openclaw',
  transportKind: 'relay',
  label: 'Preview',
  environment: 'preview',
  createdAt: 1,
  isFreeSlot: true,
};

const session: SessionDescriptor = {
  connectionId: connection.id,
  agentId: 'main',
  key: 'agent:main:main',
  kind: 'main',
  title: 'Main',
  updatedAt: 10,
  hasActiveRun: false,
  allowedActions: { rename: true, reset: true, delete: false, pin: true },
};

describe('mapAdapterChatMessage', () => {
  it('preserves normalized history content in the existing UiMessage shape', () => {
    expect(mapAdapterChatMessage({
      id: 'message-1',
      role: 'user',
      text: 'Inspect this',
      timestampMs: 11,
      idempotencyKey: 'idem-1',
      skill: { id: 'review', name: 'Review' },
      attachments: [
        { type: 'image', mimeType: 'image/jpeg', uri: 'file:///one.jpg' },
        { type: 'image', mimeType: 'image/png', content: 'data:image/png;base64,two' },
        { type: 'image', mimeType: 'image/webp', content: 'three' },
        { type: 'file', mimeType: ' Text/Plain ', content: 'not-retained-by-ui', name: ' a.txt ' },
      ],
      provider: 'provider',
      model: 'model',
      usage: { input: 2, output: 3, cacheRead: 4, cacheWrite: 5, total: 14 },
    })).toEqual({
      id: 'message-1',
      role: 'user',
      text: 'Inspect this',
      userSkill: { id: 'review', name: 'Review' },
      idempotencyKey: 'idem-1',
      timestampMs: 11,
      imageUris: [
        'file:///one.jpg',
        'data:image/png;base64,two',
        'data:image/webp;base64,three',
      ],
      fileAttachments: [{ mimeType: 'text/plain', fileName: 'a.txt' }],
      modelLabel: 'provider/model',
      usage: {
        inputTokens: 2,
        outputTokens: 3,
        cacheReadTokens: 4,
        cacheWriteTokens: 5,
        totalTokens: 14,
      },
      toolName: undefined,
      toolStatus: undefined,
      toolSummary: undefined,
      toolArgs: undefined,
      toolDetail: undefined,
    });

    expect(mapAdapterChatMessage({
      id: 'tool-1',
      role: 'tool',
      text: '',
      tool: {
        name: 'read',
        status: 'success',
        callId: 'call-1',
        summary: 'Read file',
        input: { path: '/tmp/file' },
        output: { lines: 2 },
        durationMs: 50,
        startedAtMs: 100,
        finishedAtMs: 150,
      },
    })).toMatchObject({
      id: 'tool-1',
      toolName: 'read',
      toolStatus: 'success',
      toolSummary: 'Read file',
      toolArgs: '{\n  "path": "/tmp/file"\n}',
      toolDetail: '{\n  "lines": 2\n}',
      toolDurationMs: 50,
      toolStartedAt: 100,
      toolFinishedAt: 150,
    });
  });

  it('hides transport-only delivery mirrors and silent replies', () => {
    expect(mapAdapterChatMessage({
      id: 'mirror',
      role: 'assistant',
      text: 'Delivered',
      provider: 'openclaw',
      model: 'delivery-mirror',
    })).toBeNull();
    expect(mapAdapterChatMessage({
      id: 'silent',
      role: 'assistant',
      text: 'NO_REPLY',
    })).toBeNull();
  });
});

describe('mapAdapterSessionUpdate', () => {
  const options = {
    now: () => 1_000,
    translate: (key: string) => `translated:${key}`,
  };

  it('maps history and every run-stream lifecycle update without backend knowledge', () => {
    expect(mapAdapterSessionUpdate({
      type: 'history_reconciled',
      sessionKey: session.key,
      history: {
        key: session.key,
        messages: [
          { id: 'user-1', role: 'user', text: 'Hello' },
          { id: 'assistant-1', role: 'assistant', text: 'Hi' },
          { id: 'silent-1', role: 'assistant', text: 'NO_REPLY' },
        ],
        nextCursor: 'cursor-2',
        hasActiveRun: true,
      },
    }, options)).toMatchObject({
      type: 'history_reconciled',
      sessionKey: session.key,
      messages: [
        { id: 'user-1', role: 'user', text: 'Hello' },
        { id: 'assistant-1', role: 'assistant', text: 'Hi' },
      ],
      nextCursor: 'cursor-2',
      hasActiveRun: true,
    });

    expect(mapAdapterSessionUpdate({
      type: 'run_started',
      sessionKey: session.key,
      runId: 'run-1',
    }, options)).toEqual({
      type: 'run_started',
      sessionKey: session.key,
      runId: 'run-1',
      activeRunId: 'run-1',
      isSending: true,
      startedAtMs: 1_000,
    });

    expect(mapAdapterSessionUpdate({
      type: 'agent_message_chunk',
      sessionKey: session.key,
      runId: 'run-1',
      text: 'Hello',
    }, options)).toMatchObject({
      type: 'agent_message_chunk',
      activeRunId: 'run-1',
      isSending: true,
      visible: true,
      streamingMessage: {
        id: 'streaming',
        role: 'assistant',
        text: 'Hello',
        streaming: true,
      },
    });

    const silentChunk = mapAdapterSessionUpdate({
      type: 'agent_message_chunk',
      sessionKey: session.key,
      runId: 'run-1',
      text: 'NO_',
    }, options);
    expect(silentChunk).toMatchObject({
      type: 'agent_message_chunk',
      visible: false,
    });
    expect(silentChunk).not.toHaveProperty('streamingMessage');

    expect(mapAdapterSessionUpdate({
      type: 'agent_thought_chunk',
      sessionKey: session.key,
      runId: 'run-1',
      text: 'reasoning',
    }, options)).toMatchObject({
      type: 'agent_thought_chunk',
      text: 'reasoning',
      activeRunId: 'run-1',
      isSending: true,
    });

    expect(mapAdapterSessionUpdate({
      type: 'tool_call',
      sessionKey: session.key,
      runId: 'run-1',
      toolCallId: 'call-1',
      title: 'Read file',
      kind: 'read',
      rawInput: { path: '/tmp/a' },
    }, options)).toMatchObject({
      type: 'tool_call',
      merge: false,
      message: {
        id: 'toolcall_call-1',
        role: 'tool',
        toolName: 'read',
        toolStatus: 'running',
        toolSummary: 'Read file',
        toolStartedAt: 1_000,
      },
    });

    expect(mapAdapterSessionUpdate({
      type: 'tool_call_update',
      sessionKey: session.key,
      runId: 'run-1',
      toolCallId: 'call-1',
      status: 'success',
      rawOutput: { ok: true },
    }, options)).toMatchObject({
      type: 'tool_call_update',
      merge: true,
      message: {
        id: 'toolcall_call-1',
        toolStatus: 'success',
        toolDetail: '{\n  "ok": true\n}',
        toolFinishedAt: 1_000,
      },
    });

    expect(mapAdapterSessionUpdate({
      type: 'run_finished',
      sessionKey: session.key,
      runId: 'run-1',
      stopReason: 'end_turn',
      message: { role: 'assistant', content: 'Done', provider: 'p', model: 'm' },
      usage: { input: 5, output: 7, total: 12 },
    }, options)).toMatchObject({
      type: 'run_finished',
      activeRunId: null,
      isSending: false,
      stopReason: 'end_turn',
      finalMessage: {
        id: 'final_run-1',
        role: 'assistant',
        text: 'Done',
        timestampMs: 1_000,
        modelLabel: 'p/m',
        usage: { inputTokens: 5, outputTokens: 7, totalTokens: 12 },
      },
    });

    expect(mapAdapterSessionUpdate({
      type: 'run_finished',
      sessionKey: session.key,
      runId: 'run-2',
      stopReason: 'cancelled',
    }, options)).toMatchObject({
      type: 'run_finished',
      activeRunId: null,
      isSending: false,
      systemMessage: {
        id: 'sys_abort_run-2',
        text: 'translated:Run aborted by user.',
      },
    });

    expect(mapAdapterSessionUpdate({
      type: 'run_finished',
      sessionKey: session.key,
      runId: 'silent-run',
      stopReason: 'end_turn',
      message: { role: 'assistant', content: 'NO_REPLY' },
    }, options)).toMatchObject({ finalMessage: undefined });
  });

  it('maps compaction, approval, session, usage, system, and error updates', () => {
    expect(mapAdapterSessionUpdate({
      type: 'compaction',
      sessionKey: session.key,
      phase: 'start',
    }, options)).toMatchObject({ notice: 'translated:Compacting context...' });
    expect(mapAdapterSessionUpdate({
      type: 'compaction',
      sessionKey: session.key,
      phase: 'end',
    }, options)).toMatchObject({ notice: null });

    expect(mapAdapterSessionUpdate({
      type: 'approval_requested',
      sessionKey: session.key,
      approval: {
        kind: 'exec',
        id: 'approval-1',
        command: 'npm test',
        cwd: '/workspace',
        expiresAtMs: 2_000,
      },
    }, options)).toMatchObject({
      type: 'approval_requested',
      message: {
        id: 'approval_approval-1',
        role: 'system',
        timestampMs: 1_000,
        approval: {
          id: 'approval-1',
          command: 'npm test',
          cwd: '/workspace',
          expiresAtMs: 2_000,
          status: 'pending',
        },
      },
    });

    const pairUpdate: SessionUpdate = {
      type: 'approval_requested',
      approval: {
        kind: 'pair',
        id: 'pair-1',
        target: 'device',
        displayName: 'Phone',
        platform: 'ios',
        receivedAtMs: 900,
      },
    };
    expect(mapAdapterSessionUpdate(pairUpdate, options)).toMatchObject({
      type: 'approval_requested',
      approval: pairUpdate.approval,
      message: undefined,
    });

    expect(mapAdapterSessionUpdate({
      type: 'approval_resolved',
      approvalId: 'approval-1',
      decision: 'deny',
    }, options)).toEqual({
      type: 'approval_resolved',
      approvalId: 'approval-1',
      decision: 'deny',
      status: 'denied',
      messageId: 'approval_approval-1',
    });
    expect(mapAdapterSessionUpdate({
      type: 'approval_resolved',
      approvalId: 'approval-2',
      decision: 'expired',
    }, options)).toMatchObject({ status: 'expired' });

    expect(mapAdapterSessionUpdate({
      type: 'session_info_update',
      session: { key: session.key, title: 'Renamed', hasActiveRun: true },
    }, options)).toEqual({
      type: 'session_info_update',
      session: { key: session.key, title: 'Renamed', hasActiveRun: true },
    });
    expect(mapAdapterSessionUpdate({
      type: 'usage_update',
      sessionKey: session.key,
      contextUsed: 4,
      contextWindow: 10,
      costToday: 0.25,
    }, options)).toEqual({
      type: 'usage_update',
      sessionKey: session.key,
      contextUsed: 4,
      contextWindow: 10,
      costToday: 0.25,
    });
    expect(mapAdapterSessionUpdate({
      type: 'system_event',
      sessionKey: session.key,
      kind: 'command_ack',
      text: 'Model switched',
      timestampMs: 800,
    }, options)).toMatchObject({
      type: 'system_event',
      message: {
        id: 'system_command_ack_800',
        role: 'system',
        text: 'Model switched',
        timestampMs: 800,
      },
    });
    expect(mapAdapterSessionUpdate({
      type: 'error',
      sessionKey: session.key,
      runId: 'run-1',
      code: 'server',
      message: 'Boom',
    }, options)).toMatchObject({
      type: 'error',
      code: 'server',
      errorMessage: 'Boom',
      message: {
        id: 'error_run-1_1000',
        role: 'system',
        text: 'Boom',
        timestampMs: 1_000,
      },
    });
  });
});

describe('useAdapterChatEvents', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('subscribes to state, sessions, and mapped update events and cleans them up', async () => {
    const adapter = createMockAdapter({
      connection,
      sessions: [session],
      timeline: [{
        atMs: 10,
        update: {
          type: 'system_event',
          sessionKey: session.key,
          kind: 'connection',
          text: 'Reconnected',
          timestampMs: 10,
        },
      }],
    });
    const onState = jest.fn();
    const onSessions = jest.fn();
    const firstOnUpdate = jest.fn();
    const secondOnUpdate = jest.fn();

    const { rerender, unmount } = renderHook(
      ({ onUpdate }: { onUpdate: typeof firstOnUpdate }) => useAdapterChatEvents({
        adapter,
        onState,
        onSessions,
        onUpdate,
        now: () => 123,
      }),
      { initialProps: { onUpdate: firstOnUpdate } },
    );

    expect(onState).toHaveBeenCalledWith('idle');
    await act(async () => {
      await adapter.connect();
    });
    expect(onState.mock.calls).toEqual([
      ['idle'],
      ['connecting', undefined],
      ['handshaking', undefined],
      ['ready', undefined],
    ]);

    await act(async () => {
      await adapter.createSession?.('main', { title: 'Second' });
    });
    expect(onSessions).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ title: 'Second' }),
    ]));

    act(() => adapter.replayTimeline());
    expect(firstOnUpdate).toHaveBeenCalledWith(expect.objectContaining({
      type: 'system_event',
      message: expect.objectContaining({ text: 'Reconnected' }),
    }));

    rerender({ onUpdate: secondOnUpdate });
    act(() => {
      adapter.resetTimeline();
      adapter.replayTimeline();
    });
    expect(firstOnUpdate).toHaveBeenCalledTimes(1);
    expect(secondOnUpdate).toHaveBeenCalledTimes(1);

    unmount();
    act(() => {
      adapter.disconnect();
      adapter.resetTimeline();
      adapter.replayTimeline();
    });
    expect(onState).toHaveBeenCalledTimes(4);
    expect(secondOnUpdate).toHaveBeenCalledTimes(1);
  });
});
