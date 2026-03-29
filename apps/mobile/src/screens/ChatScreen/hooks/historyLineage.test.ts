import { CachedSessionSnapshot } from '../../../services/chat-cache';
import { UiMessage } from '../../../types/chat';
import { buildCachedLineageMessages, cachedMessageToUiMessage, mergeHistoryWithCachedLineage } from './historyLineage';

function makeSnapshot(params: {
  storageKey: string;
  sessionId?: string;
  updatedAt: number;
  messages: Array<{ id: string; role?: 'user' | 'assistant' | 'tool'; text: string; timestampMs?: number }>;
}): CachedSessionSnapshot {
  return {
    meta: {
      storageKey: params.storageKey,
      gatewayConfigId: 'gw-1',
      agentId: 'main',
      sessionKey: 'agent:main:main',
      sessionId: params.sessionId,
      messageCount: params.messages.length,
      updatedAt: params.updatedAt,
    },
    messages: params.messages.map((message) => ({
      id: message.id,
      role: message.role ?? 'user',
      text: message.text,
      timestampMs: message.timestampMs,
    })),
  };
}

describe('historyLineage', () => {
  it('converts cached messages to non-streaming UI messages', () => {
    expect(cachedMessageToUiMessage({
      id: '1',
      role: 'assistant',
      text: 'hello',
      idempotencyKey: 'run_1',
    })).toMatchObject({
      id: '1',
      role: 'assistant',
      text: 'hello',
      idempotencyKey: 'run_1',
      streaming: false,
    });
  });

  it('builds cached lineage in generation order and can exclude the active sessionId', () => {
    const snapshots = [
      makeSnapshot({
        storageKey: 'old',
        sessionId: 'sess-old',
        updatedAt: 10,
        messages: [
          { id: 'u1', text: 'old user', timestampMs: 1 },
          { id: 'a1', role: 'assistant', text: 'old reply', timestampMs: 2 },
        ],
      }),
      makeSnapshot({
        storageKey: 'new',
        sessionId: 'sess-new',
        updatedAt: 20,
        messages: [
          { id: 'u2', text: 'new user', timestampMs: 3 },
          { id: 'a2', role: 'assistant', text: 'new reply', timestampMs: 4 },
        ],
      }),
    ];

    expect(buildCachedLineageMessages(snapshots).map((message) => message.id)).toEqual([
      'u1',
      'a1',
      'u2',
      'a2',
    ]);
    expect(buildCachedLineageMessages(snapshots, { excludeSessionId: 'sess-new' }).map((message) => message.id)).toEqual([
      'u1',
      'a1',
    ]);
  });

  it('filters cached assistant NO_REPLY messages while keeping user NO_REPLY text', () => {
    const snapshots = [
      makeSnapshot({
        storageKey: 'silent',
        sessionId: 'sess-silent',
        updatedAt: 10,
        messages: [
          { id: 'u1', role: 'user', text: 'NO_REPLY', timestampMs: 1 },
          { id: 'a1', role: 'assistant', text: 'NO_REPLY', timestampMs: 2 },
          { id: 'a2', role: 'assistant', text: 'real reply', timestampMs: 3 },
        ],
      }),
    ];

    expect(buildCachedLineageMessages(snapshots).map((message) => `${message.role}:${message.text}`)).toEqual([
      'user:NO_REPLY',
      'assistant:real reply',
    ]);
  });

  it('filters cached delivery-mirror assistant messages while keeping the real reply', () => {
    const snapshots = [
      {
        meta: {
          storageKey: 'mirror',
          gatewayConfigId: 'gw-1',
          agentId: 'main',
          sessionKey: 'agent:main:main',
          sessionId: 'sess-mirror',
          messageCount: 2,
          updatedAt: 10,
        },
        messages: [
          {
            id: 'a1',
            role: 'assistant',
            text: 'real reply',
            timestampMs: 2,
            provider: 'openclaw',
            model: 'delivery-mirror',
          },
          {
            id: 'a2',
            role: 'assistant',
            text: 'real reply',
            timestampMs: 3,
            provider: 'openai',
            model: 'gpt-5',
          },
        ],
      },
    ] as unknown as CachedSessionSnapshot[];

    expect(buildCachedLineageMessages(snapshots).map((message) => message.id)).toEqual(['a2']);
  });

  it('merges archived cached generations ahead of current gateway history', () => {
    const cachedSnapshots = [
      makeSnapshot({
        storageKey: 'old',
        sessionId: 'sess-old',
        updatedAt: 10,
        messages: [
          { id: 'u1', text: 'old user', timestampMs: 1 },
          { id: 'a1', role: 'assistant', text: 'old reply', timestampMs: 2 },
        ],
      }),
      makeSnapshot({
        storageKey: 'current-cache',
        sessionId: 'sess-current',
        updatedAt: 20,
        messages: [
          { id: 'u2', text: 'cached current user', timestampMs: 3 },
        ],
      }),
    ];
    const currentMessages: UiMessage[] = [
      { id: 'u2-live', role: 'user', text: 'live current user', timestampMs: 3 },
      { id: 'a2-live', role: 'assistant', text: 'live current reply', timestampMs: 4 },
    ];

    expect(mergeHistoryWithCachedLineage({
      cachedSnapshots,
      currentMessages,
      currentSessionId: 'sess-current',
    }).map((message) => message.id)).toEqual([
      'u1',
      'a1',
      'u2-live',
      'a2-live',
    ]);
  });

  it('deduplicates overlapping messages in favor of the current history copy', () => {
    const cachedSnapshots = [
      makeSnapshot({
        storageKey: 'old',
        sessionId: 'sess-old',
        updatedAt: 10,
        messages: [
          { id: 'dup', role: 'assistant', text: 'same text', timestampMs: 2 },
        ],
      }),
    ];
    const currentMessages: UiMessage[] = [
      { id: 'dup', role: 'assistant', text: 'same text', timestampMs: 2, modelLabel: 'latest' },
    ];

    const merged = mergeHistoryWithCachedLineage({
      cachedSnapshots,
      currentMessages,
      currentSessionId: 'sess-current',
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].modelLabel).toBe('latest');
  });

  it('deduplicates tool messages even when toolSummary changes across locales', () => {
    const cachedSnapshots = [
      {
        meta: {
          storageKey: 'old-tool',
          gatewayConfigId: 'gw-1',
          agentId: 'main',
          sessionKey: 'agent:main:main',
          sessionId: 'sess-old',
          messageCount: 1,
          updatedAt: 10,
        },
        messages: [
          {
            id: 'toolcall_123',
            role: 'tool',
            text: '',
            timestampMs: 100,
            toolName: 'bash',
            toolSummary: 'Completed bash',
          },
        ],
      },
    ] satisfies CachedSessionSnapshot[];
    const currentMessages: UiMessage[] = [
      {
        id: 'toolcall_123',
        role: 'tool',
        text: '',
        timestampMs: 100,
        toolName: 'bash',
        toolSummary: '已完成 bash',
        toolStatus: 'success',
      },
    ];

    const merged = mergeHistoryWithCachedLineage({
      cachedSnapshots,
      currentMessages,
      currentSessionId: 'sess-current',
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].toolSummary).toBe('已完成 bash');
    expect(merged[0].toolStatus).toBe('success');
  });
});
