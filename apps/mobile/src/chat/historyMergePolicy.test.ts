import { UiMessage } from '../types/chat';
import { preserveHydratedMessageKeys, preserveMessagePresentation, preserveOptimisticAssistantMessage, prependOlderCachedMessages, retireAliasedTools } from './historyMergePolicy';

describe('preserveHydratedMessageKeys', () => {
  const cached: UiMessage = { id: 'cached-row', historyMessageId: 'server-row', renderKey: 'stable-row', role: 'assistant', text: 'Outdated text', timestampMs: 1000 };
  const canonical: UiMessage = { id: 'history-row', historyMessageId: 'server-row', role: 'assistant', text: 'Corrected text', timestampMs: 2000 };
  it('carries only identity, leaving canonical text, timestamps and membership authoritative', () => {
    const other = { ...canonical, id: 'different-turn', historyMessageId: 'other-server-row', text: cached.text };
    expect(preserveHydratedMessageKeys([cached, { ...cached, id: 'stale', historyMessageId: 'stale', renderKey: 'stale' }], [canonical, other]))
      .toEqual([{ ...canonical, renderKey: 'stable-row' }, other]);
  });
  it('does not guess between multiple cached or canonical rows with the same history identity', () => {
    expect(preserveHydratedMessageKeys([cached, { ...cached, id: 'replica', renderKey: 'replica' }], [canonical])).toEqual([canonical]);
    const duplicate = { ...canonical, id: 'second-part' };
    expect(preserveHydratedMessageKeys([cached], [canonical, duplicate])).toEqual([canonical, duplicate]);
  });
  it('does not create duplicate render keys or replace a newer live key', () => {
    const other = { ...canonical, id: 'stable-row', historyMessageId: 'other-server-row' };
    expect(preserveHydratedMessageKeys([cached], [canonical, other])).toEqual([canonical, other]);
    const live = { ...canonical, renderKey: 'live-row' };
    expect(preserveHydratedMessageKeys([cached], [live])).toEqual([live]);
    expect(preserveHydratedMessageKeys([cached, { ...other, renderKey: 'stable-row' }], [canonical])).toEqual([canonical]);
  });
});

describe('prependOlderCachedMessages', () => {
  it('does not resurrect cached tool-turn text while paging after a restart', () => {
    const answer: UiMessage = { id: 'h_answer', historyMessageId: 'server-answer', role: 'assistant', text: 'Done', timestampMs: 70_000 };
    expect(prependOlderCachedMessages([answer], [
      { ...answer, id: 'old-row', timestampMs: 1_000 },
      { id: 'stream_segment_65000_0', role: 'assistant', text: 'Done', timestampMs: 65_000 },
    ])).toEqual([answer]);
    const differentTurn = { ...answer, id: 'another-row', historyMessageId: 'another-answer' };
    expect(prependOlderCachedMessages([answer], [differentTurn])).toEqual([differentTurn, answer]);
  });
  const server: UiMessage = { id: 'h_user_server', role: 'user', text: 'Hello', timestampMs: 70_000 };
  const cached: UiMessage = { id: 'usr_64000', role: 'user', text: 'Hello', timestampMs: 64_000 };
  it('does not restore an optimistic copy after the server assigns its timestamp and ID', () => {
    expect(prependOlderCachedMessages([server], [cached])).toEqual([server]);
  });
  it('preserves a second intentional send and older messages outside the matching window', () => {
    const second = { ...cached, id: 'usr_65000', timestampMs: 65_000 };
    const old = { ...cached, id: 'usr_1000', timestampMs: 1_000 };
    expect(prependOlderCachedMessages([server], [old, cached, second])).toEqual([old, second, server]);
  });
  it('does not collapse different attachments based on text and time alone', () => {
    const image = { ...cached, imageUris: ['file://test.png'] };
    expect(prependOlderCachedMessages([server], [image])).toEqual([image, server]);
  });
  it('matches attachment echoes only by their explicit idempotency key', () => {
    const image = { ...cached, imageUris: ['file://test.png'], idempotencyKey: 'same-send' };
    const echo = { ...server, idempotencyKey: 'same-send' };
    expect(prependOlderCachedMessages([echo], [image])).toEqual([echo]);
  });
});

describe('preserveOptimisticAssistantMessage', () => {
  it('preserves a local optimistic user message when refreshed history is still stale', () => {
    const previousMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      { id: 'a1', role: 'assistant', text: 'Older answer', timestampMs: 2_000 },
      { id: 'usr_3000', role: 'user', text: 'New question', timestampMs: 3_000 },
    ];
    const nextMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      { id: 'a1', role: 'assistant', text: 'Older answer', timestampMs: 2_000 },
    ];

    expect(preserveOptimisticAssistantMessage(previousMessages, nextMessages)).toEqual([
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      { id: 'a1', role: 'assistant', text: 'Older answer', timestampMs: 2_000 },
      { id: 'usr_3000', role: 'user', text: 'New question', timestampMs: 3_000 },
    ]);
  });

  it('drops the local optimistic user once refreshed history catches up', () => {
    const previousMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      { id: 'a1', role: 'assistant', text: 'Older answer', timestampMs: 2_000 },
      { id: 'usr_3000', role: 'user', text: 'New question', timestampMs: 3_000 },
    ];
    const nextMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      { id: 'a1', role: 'assistant', text: 'Older answer', timestampMs: 2_000 },
      { id: 'h_user_3200', role: 'user', text: 'New question', timestampMs: 3_200 },
    ];

    expect(preserveOptimisticAssistantMessage(previousMessages, nextMessages)).toEqual(nextMessages);
  });

  it('drops the local optimistic user when history catches up but omits timestamp metadata', () => {
    const previousMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      { id: 'a1', role: 'assistant', text: 'Older answer', timestampMs: 2_000 },
      { id: 'usr_3000', role: 'user', text: '你好', timestampMs: 3_000 },
    ];
    const nextMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      { id: 'a1', role: 'assistant', text: 'Older answer', timestampMs: 2_000 },
      { id: 'h_user_missing_meta', role: 'user', text: '你好' },
    ];

    expect(preserveOptimisticAssistantMessage(previousMessages, nextMessages)).toEqual(nextMessages);
  });

  it('does not conflate consecutive image-only user messages during history refresh', () => {
    const previousMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      { id: 'a1', role: 'assistant', text: 'Older answer', timestampMs: 2_000 },
      {
        id: 'usr_3000',
        role: 'user',
        text: '📷 1 image',
        timestampMs: 3_000,
        imageUris: ['file:///image-b.jpg'],
      },
    ];
    const nextMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      { id: 'a1', role: 'assistant', text: 'Older answer', timestampMs: 2_000 },
      {
        id: 'h_user_2900',
        role: 'user',
        text: '',
        timestampMs: 2_900,
        imageUris: ['file:///image-a.jpg'],
      },
    ];

    expect(preserveOptimisticAssistantMessage(previousMessages, nextMessages)).toEqual([
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      { id: 'a1', role: 'assistant', text: 'Older answer', timestampMs: 2_000 },
      {
        id: 'h_user_2900',
        role: 'user',
        text: '',
        timestampMs: 2_900,
        imageUris: ['file:///image-a.jpg'],
      },
      {
        id: 'usr_3000',
        role: 'user',
        text: '📷 1 image',
        timestampMs: 3_000,
        imageUris: ['file:///image-b.jpg'],
      },
    ]);
  });

  it('does not conflate a file-bearing optimistic message with text-only history', () => {
    const optimistic: UiMessage = {
      id: 'usr_3000',
      role: 'user',
      text: 'Review this file',
      timestampMs: 3_000,
      fileAttachments: [{
        mimeType: 'application/pdf',
        fileName: 'spec.pdf',
        uri: 'file:///spec.pdf',
      }],
    };
    const history: UiMessage[] = [
      { id: 'history-user', role: 'user', text: 'Review this file' },
    ];

    expect(preserveOptimisticAssistantMessage([optimistic], history)).toEqual([
      ...history,
      optimistic,
    ]);
  });

  it('drops an optimistic image-only message once matching history arrives with the same idempotency key', () => {
    const previousMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      {
        id: 'usr_3000',
        role: 'user',
        text: '📷 1 image',
        idempotencyKey: 'run_same',
        timestampMs: 3_000,
        imageUris: ['file:///pending-image.jpg'],
      },
    ];
    const nextMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      {
        id: 'h_user_3200',
        role: 'user',
        text: '',
        idempotencyKey: 'run_same',
        timestampMs: 3_200,
        imageUris: ['file:///cached-image.jpg'],
      },
    ];

    expect(preserveOptimisticAssistantMessage(previousMessages, nextMessages)).toEqual(nextMessages);
  });

  it('does not resurrect an older optimistic slash command when later turns already exist', () => {
    const previousMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      { id: 'a1', role: 'assistant', text: 'Older answer', timestampMs: 2_000 },
      { id: 'usr_3000', role: 'user', text: '/think high', timestampMs: 3_000 },
      { id: 'a2', role: 'assistant', text: 'Thinking level set to high.', timestampMs: 3_200 },
      { id: 'u3', role: 'user', text: 'Latest question', timestampMs: 10_000 },
      { id: 'a3', role: 'assistant', text: 'Latest answer', timestampMs: 11_000 },
    ];
    const nextMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      { id: 'a1', role: 'assistant', text: 'Older answer', timestampMs: 2_000 },
      { id: 'u3', role: 'user', text: 'Latest question', timestampMs: 10_000 },
      { id: 'a3', role: 'assistant', text: 'Latest answer', timestampMs: 11_000 },
    ];

    expect(preserveOptimisticAssistantMessage(previousMessages, nextMessages)).toEqual(nextMessages);
  });

  it('preserves a local final message when refreshed history is still stale', () => {
    const previousMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Hello', timestampMs: 1000 },
      { id: 'final_run', role: 'assistant', text: 'Latest answer', timestampMs: 2000 },
    ];
    const nextMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Hello', timestampMs: 1000 },
    ];

    expect(preserveOptimisticAssistantMessage(previousMessages, nextMessages)).toEqual([
      { id: 'u1', role: 'user', text: 'Hello', timestampMs: 1000 },
      { id: 'final_run', role: 'assistant', text: 'Latest answer', timestampMs: 2000 },
    ]);
  });

  it('does not preserve the local final message once history catches up', () => {
    const previousMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Hello', timestampMs: 1000 },
      { id: 'final_run', role: 'assistant', text: 'Latest answer', timestampMs: 2000 },
    ];
    const nextMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Hello', timestampMs: 1000 },
      { id: 'ast_1', role: 'assistant', text: 'Latest answer', timestampMs: 2100 },
    ];

    expect(preserveOptimisticAssistantMessage(previousMessages, nextMessages)).toEqual([
      { id: 'u1', role: 'user', text: 'Hello', timestampMs: 1000 },
      { id: 'final_run', role: 'assistant', text: 'Latest answer', timestampMs: 2100 },
    ]);
  });

  it('treats normalized assistant text as the same message', () => {
    const previousMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Hello', timestampMs: 1000 },
      { id: 'final_run', role: 'assistant', text: 'Hello,\n\nLucy.  ', timestampMs: 5000 },
    ];
    const nextMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Hello', timestampMs: 1000 },
      { id: 'ast_1', role: 'assistant', text: 'Hello,\nLucy.', timestampMs: 4500 },
    ];

    expect(preserveOptimisticAssistantMessage(previousMessages, nextMessages)).toEqual([
      { id: 'u1', role: 'user', text: 'Hello', timestampMs: 1000 },
      { id: 'final_run', role: 'assistant', text: 'Hello,\nLucy.', timestampMs: 4500 },
    ]);
  });

  it('replaces the latest assistant in the current turn when local final is newer', () => {
    const previousMessages: UiMessage[] = [
      { id: 'u0', role: 'user', text: 'Older question', timestampMs: 1000 },
      { id: 'a0', role: 'assistant', text: 'Older answer', timestampMs: 2000 },
      { id: 'u1', role: 'user', text: 'What is the latest Expo SDK?', timestampMs: 10_000 },
      { id: 'final_run', role: 'assistant', text: 'The latest stable release is Expo SDK 55.0.5.', timestampMs: 16_000 },
    ];
    const nextMessages: UiMessage[] = [
      { id: 'u0', role: 'user', text: 'Older question', timestampMs: 1000 },
      { id: 'a0', role: 'assistant', text: 'Older answer', timestampMs: 2000 },
      { id: 'u1', role: 'user', text: 'What is the latest Expo SDK?', timestampMs: 10_000 },
      { id: 'a1', role: 'assistant', text: 'Expo releases are not managed in GitHub Releases.', timestampMs: 14_000 },
    ];

    expect(preserveOptimisticAssistantMessage(previousMessages, nextMessages)).toEqual([
      { id: 'u0', role: 'user', text: 'Older question', timestampMs: 1000 },
      { id: 'a0', role: 'assistant', text: 'Older answer', timestampMs: 2000 },
      { id: 'u1', role: 'user', text: 'What is the latest Expo SDK?', timestampMs: 10_000 },
      { id: 'final_run', role: 'assistant', text: 'The latest stable release is Expo SDK 55.0.5.', timestampMs: 16_000 },
    ]);
  });

  it('keeps transcript segments and tools and appends only the unseen final tail', () => {
    const previousMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Check OpenClaw and Clawket', timestampMs: 10_000 },
      {
        id: 'final_run',
        role: 'assistant',
        text: 'First tool complete.\nSecond tool complete.\nFinal answer.',
        timestampMs: 18_000,
      },
    ];
    const nextMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Check OpenClaw and Clawket', timestampMs: 10_000 },
      { id: 'a1', role: 'assistant', text: 'First tool complete.', timestampMs: 14_000 },
      { id: 'tool1', role: 'tool', text: '', toolName: 'search', toolStatus: 'success' },
      { id: 'a2', role: 'assistant', text: 'Second tool complete.', timestampMs: 16_000 },
      { id: 'tool2', role: 'tool', text: '', toolName: 'search', toolStatus: 'success' },
    ];

    expect(preserveOptimisticAssistantMessage(previousMessages, nextMessages)).toEqual([
      ...nextMessages, { ...previousMessages[1], text: 'Final answer.' },
    ]);
  });
});

it('does not resurrect a streamed final reply when paging cached history', () => {
  const current = [{ id: 'h_assistant_server', role: 'assistant' as const, text: 'Test received', timestampMs: 112_000 }];
  expect(prependOlderCachedMessages(current, [{ id: 'final_run', role: 'assistant', text: 'Test received', timestampMs: 100_000 }])).toEqual(current);
});


describe('preserveMessagePresentation', () => {
  const local: UiMessage = {
    id: 'usr_1000', renderKey: 'usr_1000', role: 'user', text: 'Photo',
    timestampMs: 1000, idempotencyKey: 'send-1', sendUncertain: true,
    imageUris: ['file://original.jpg'], imageMetas: [{ uri: 'file://original.jpg', width: 400, height: 300 }],
  };
  it('retains local geometry and row identity for an exact echo without changing the wire ID or delivery evidence', () => {
    const echo: UiMessage = { id: 'history-server', role: 'user', text: 'Photo', timestampMs: 5000, idempotencyKey: 'send-1', imageUris: ['https://example.com/photo.jpg'] };
    expect(preserveMessagePresentation([local], [echo])).toEqual([{
      ...echo, renderKey: local.renderKey, timestampMs: local.timestampMs,
      imageUris: local.imageUris, imageMetas: local.imageMetas,
    }]);
  });
  it('does not carry presentation across equal text with missing, conflicting, ambiguous or other-role send keys', () => {
    const echo: UiMessage = { id: 'server', role: 'user', text: 'Photo', timestampMs: 1001 };
    for (const next of [echo, { ...echo, idempotencyKey: 'different' }, { ...echo, role: 'assistant' as const, idempotencyKey: 'send-1' }]) {
      expect(preserveMessagePresentation([local], [next])).toEqual([next]);
    }
    const duplicate = { ...local, id: 'usr_1001', renderKey: 'usr_1001' };
    const ambiguous = { ...echo, idempotencyKey: 'send-1' };
    expect(preserveMessagePresentation([local, duplicate], [ambiguous])).toEqual([ambiguous]);
    const duplicateEcho = { ...ambiguous, id: 'server-other' };
    expect(preserveMessagePresentation([local], [ambiguous, duplicateEcho])).toEqual([ambiguous, duplicateEcho]);
  });
  it('keeps a finalized reply identity through history reconciliation', () => {
    const final: UiMessage = { id: 'final_run', renderKey: 'reply:1000:0', role: 'assistant', text: 'Answer', timestampMs: 2000 };
    const echo: UiMessage = { id: 'history-answer', role: 'assistant', text: 'Answer', timestampMs: 2100 };
    const reconciled = preserveOptimisticAssistantMessage([final], [echo]);
    expect(preserveMessagePresentation([final], reconciled)[0].renderKey).toBe(final.renderKey);
  });
});


describe('live turn reconciliation', () => {
  const user: UiMessage = { id: 'usr_1000', role: 'user', text: 'Check', idempotencyKey: 'send-1', timestampMs: 1000 };
  const local: UiMessage[] = [user,
    { id: 'segment', renderKey: 'reply:1000:0', presentationRunId: 'run', role: 'assistant', text: 'First.', timestampMs: 2000 },
    { id: 'toolcall_one', presentationRunId: 'run', role: 'tool', text: '', toolName: 'read', toolStatus: 'success' },
    { id: 'final_run', renderKey: 'reply:1000:1', presentationRunId: 'run', role: 'assistant', text: 'Answer.', timestampMs: 3000 },
  ];
  it('retains the same text/tool order through stale, split and aggregate history, including a later user turn', () => {
    expect(preserveOptimisticAssistantMessage(local, [user])).toEqual(local);
    const split: UiMessage[] = [{ ...user, id: 'remote-user' },
      { id: 'remote-first', role: 'assistant', text: 'First.' },
      { id: 'toolcall_one', role: 'tool', text: '', toolName: 'read', toolStatus: 'success', toolDetail: 'details' },
      { id: 'remote-last', role: 'assistant', text: 'Answer.' }];
    const merged = preserveOptimisticAssistantMessage(local, split);
    expect(merged.map(message => message.text)).toEqual(['Check', 'First.', '', 'Answer.']);
    expect(merged.map(message => message.renderKey)).toEqual([undefined, 'reply:1000:0', 'toolcall_one', 'reply:1000:1']);
    expect(merged[2].toolDetail).toBe('details');
    const later: UiMessage = { id: 'other-user', role: 'user', text: 'Next', idempotencyKey: 'send-2' };
    const aggregate: UiMessage[] = [split[0], { id: 'aggregate', role: 'assistant', text: 'First.\nAnswer.' }, split[2], later];
    const refreshed = preserveOptimisticAssistantMessage(merged, aggregate);
    expect(refreshed.map(message => message.text)).toEqual(['Check', 'First.', '', 'Answer.', 'Next']);
    expect(preserveOptimisticAssistantMessage(refreshed, aggregate)).toEqual(refreshed);
  });
  it('places a newly recovered introduction before the tool and final reply, retaining live identities', () => {
    const missedIntroduction = [user, local[2], local[3]];
    const remote: UiMessage[] = [user,
      { id: 'intro', role: 'assistant', text: 'I am reading the instructions.' },
      { ...local[2], presentationRunId: undefined },
      { id: 'answer', role: 'assistant', text: 'Answer.' },
    ];
    const merged = preserveOptimisticAssistantMessage(missedIntroduction, remote);
    expect(merged.map(row => row.text)).toEqual(['Check', 'I am reading the instructions.', '', 'Answer.']);
    expect(merged[2].renderKey).toBe('toolcall_one');
    expect(merged[3].renderKey).toBe('reply:1000:1');
    expect(preserveOptimisticAssistantMessage(merged, remote)).toEqual(merged);
  });
  it('does not attach a local completed turn to another identical prompt', () => {
    const other: UiMessage = { ...user, id: 'other-user', idempotencyKey: 'other-send' };
    const next = [other, { id: 'other-answer', role: 'assistant' as const, text: 'Other answer' }];
    const reconciled = preserveOptimisticAssistantMessage(local, next);
    expect(reconciled.slice(0, 2)).toEqual(next);
    expect(reconciled.filter(message => message.role === 'user')).toHaveLength(2);
  });
  it('repairs old cumulative live bubbles only against confirmed split history', () => {
    const broken = [user,
      { ...local[1], text: 'First.' },
      local[2],
      { ...local[3], text: 'First.Answer.' },
    ];
    const remote: UiMessage[] = [user,
      { id: 'a', role: 'assistant', text: 'First.' }, local[2],
      { id: 'b', role: 'assistant', text: 'Answer.' },
    ];
    const repaired = preserveOptimisticAssistantMessage(broken, remote);
    expect(repaired.map(row => row.text)).toEqual(['Check', 'First.', '', 'Answer.']);
    expect(preserveOptimisticAssistantMessage(repaired, remote)).toEqual(repaired);
    const intentional = remote.map(row => row.id === 'b' ? { ...row, text: 'First.Answer.' } : row);
    expect(preserveOptimisticAssistantMessage(broken, intentional).at(-1)?.text).toBe('First.Answer.');
  });
  it('does not drop a repeated short prompt against an older known message or conflicting send key', () => {
    const old: UiMessage = { id: 'history-old', role: 'user', text: 'OK', timestampMs: 1000, idempotencyKey: 'old' };
    const fresh: UiMessage = { id: 'usr_2000', renderKey: 'usr_2000', role: 'user', text: 'OK', timestampMs: 2000, idempotencyKey: 'fresh' };
    expect(preserveOptimisticAssistantMessage([old, fresh], [old])).toEqual([old, fresh]);
    const noMetadata = { ...old, timestampMs: undefined, idempotencyKey: undefined };
    expect(preserveOptimisticAssistantMessage([noMetadata, fresh], [noMetadata])).toEqual([noMetadata, fresh]);
  });
});


describe('local turn ownership after history echoes', () => {
  const sent: UiMessage = { id: 'usr_3000', renderKey: 'usr_3000', role: 'user',
    text: 'OK', timestampMs: 3000, idempotencyKey: 'current-send' };

  it('retains send identity when a confirmed legacy echo omits it', () => {
    const echo: UiMessage = { id: 'server-user', role: 'user', text: 'OK', timestampMs: 3100 };
    const adopted = preserveOptimisticAssistantMessage([sent], [echo]);
    expect(adopted[0]).toMatchObject({ id: echo.id, renderKey: sent.renderKey,
      idempotencyKey: sent.idempotencyKey, timestampMs: sent.timestampMs });
    const different = { ...echo, id: 'other-user', idempotencyKey: 'different-send' };
    expect(preserveOptimisticAssistantMessage(adopted, [different])).toEqual([different, adopted[0]]);
    expect(preserveOptimisticAssistantMessage(adopted, [])).toEqual(adopted);
  });

  it('does not acknowledge a repeated prompt with an older row whose UI projection changed', () => {
    const previous: UiMessage = { id: 'h_old-user', historyMessageId: 'wire-old-user', role: 'user', text: 'OK', timestampMs: 1000 };
    const wire = { ...previous, id: 'wire-old-user', historyMessageId: undefined };
    expect(preserveOptimisticAssistantMessage([previous, sent], [wire])).toEqual([wire, sent]);
  });
});

describe('confirmed tool aliases', () => {
  const stale: UiMessage = { id: 'toolcall_native', role: 'tool', text: '', toolName: 'skill_view', toolStatus: 'success' };
  const canonical: UiMessage = { ...stale, id: 'toolresult_live' };
  it('retires a source copy only with the exact canonical tool present', () => {
    expect(retireAliasedTools([stale], [canonical], { native: 'live' })).toEqual([]);
    expect(retireAliasedTools([stale], [canonical])).toEqual([stale]);
    expect(retireAliasedTools([stale], [], { native: 'live' })).toEqual([stale]);
    expect(retireAliasedTools([stale], [{ ...canonical, toolName: 'terminal' }], { native: 'live' })).toEqual([stale]);
    expect(retireAliasedTools([{ ...stale, role: 'user' }], [canonical], { native: 'live' })).toHaveLength(1);
  });
});
