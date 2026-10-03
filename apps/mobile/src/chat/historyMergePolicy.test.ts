import { UiMessage } from '../types/chat';
import { preserveApprovalRows, preserveHydratedMessageKeys, preserveMessagePresentation, preserveOptimisticAssistantMessage, preserveToolTiming, prependOlderCachedMessages, reconcileAcceptedSteeringMessage, retireAliasedTools } from './historyMergePolicy';

describe('reconcileAcceptedSteeringMessage', () => {
  const prompt: UiMessage = { id: 'prompt', historyMessageId: 'prompt-native', role: 'user', text: 'Initial task', timestampMs: 1_000 };
  const accepted: UiMessage = { id: 'usr_121000_steer_active', renderKey: 'usr_121000_steer_active', role: 'user', sentLocally: true, text: 'Change course', timestampMs: 121_000 };
  const echo: UiMessage = { id: 'echo', historyMessageId: 'steer-native', role: 'user', text: accepted.text, timestampMs: 1_000 };

  it('keeps a native echo with the original turn clock, including a renamed dispatch anchor', () => {
    const current = [{ ...prompt, id: 'history-prompt' }, echo];
    expect(reconcileAcceptedSteeringMessage([prompt], current, accepted)).toBe(current);
  });

  it.each([false, true])('finds accepted input persisted before an already visible assistant row (%s)', alias => {
    const assistant: UiMessage = { id: 'live-assistant', renderKey: 'stable-assistant', role: 'assistant', text: 'Working' };
    const current = [prompt, echo, { ...assistant, id: alias ? 'native-assistant' : assistant.id }];
    expect(reconcileAcceptedSteeringMessage([prompt, assistant], current, accepted)).toBe(current);
  });

  it('keeps intentional repeated guidance after a previous canonical echo', () => {
    const second = { ...echo, id: 'second', historyMessageId: 'second-native' };
    const current = [prompt, echo, second];
    expect(reconcileAcceptedSteeringMessage([prompt, echo], current, accepted)).toBe(current);
    expect(current.filter(message => message.text === accepted.text)).toHaveLength(2);
  });

  it('inserts missing accepted input at dispatch position, before a later final and same-text queued send', () => {
    const final: UiMessage = { id: 'old-final', role: 'assistant', text: 'Done' };
    const next: UiMessage = { id: 'next-send', historyMessageId: 'next-native', idempotencyKey: 'next-send-key', role: 'user', text: accepted.text, timestampMs: 121_100 };
    expect(reconcileAcceptedSteeringMessage([prompt], [prompt, final, next], accepted)).toEqual([prompt, accepted, final, next]);
    // A later stale reload cannot let that independent send adopt the steering row.
    expect(preserveOptimisticAssistantMessage([prompt, accepted], [prompt, next]).filter(message => message.text === accepted.text)).toHaveLength(2);
  });

  it('does not use older prepended input, different authors or attachments as steering evidence', () => {
    const tool: UiMessage = { id: 'tool', role: 'tool', text: 'Working' };
    const attachment = { ...echo, imageUris: ['file://different.png'] };
    const inbound = { ...echo, id: 'inbound', historyMessageId: 'inbound-native', attribution: { channel: 'slack', sender: { id: 'other' } } };
    const current = [echo, prompt, tool, attachment, inbound];
    expect(reconcileAcceptedSteeringMessage([prompt, tool], current, accepted)).toEqual([echo, prompt, tool, accepted, attachment, inbound]);
  });

  it('does not treat locally queued or accepted rows as new native steering echoes', () => {
    const queued: UiMessage = { ...echo, historyMessageId: undefined, delivery: 'queued' };
    const local: UiMessage = { ...echo, id: 'usr_120000', historyMessageId: undefined };
    const current = [prompt, queued, local];
    expect(reconcileAcceptedSteeringMessage([prompt], current, accepted)).toEqual([prompt, accepted, queued, local]);
  });

  it('keeps all repeated native echoes without adding an ACK copy and does not guess placement in a replaced window', () => {
    const duplicate = { ...echo, id: 'other-echo', historyMessageId: 'other-native' };
    const repeated = [prompt, echo, duplicate];
    expect(reconcileAcceptedSteeringMessage([prompt], repeated, accepted)).toBe(repeated);
    const next: UiMessage = { id: 'new-turn', historyMessageId: 'new-native', role: 'user', text: 'Next task' };
    const current = [next];
    expect(reconcileAcceptedSteeringMessage([prompt], current, accepted)).toBe(current);
  });

  it('appends once in an empty window and keeps an already accepted row idempotently', () => {
    expect(reconcileAcceptedSteeringMessage([], [], accepted)).toEqual([accepted]);
    const current = [prompt, accepted];
    expect(reconcileAcceptedSteeringMessage([prompt], current, accepted)).toBe(current);
  });
});

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
  it('does not move the previous final reply past a newer user while recovering timestamp-free history', () => {
    const old: UiMessage = { id: 'final_old', role: 'assistant', text: 'Old answer', timestampMs: 1000, historyMessageId: 'old-native' };
    const user: UiMessage = { id: 'usr_2000', role: 'user', text: 'New question', timestampMs: 2000, idempotencyKey: 'send-2' };
    const next: UiMessage[] = [
      { ...old, id: 'h_old', timestampMs: undefined },
      { ...user, id: 'h_user' },
      { id: 'h_new', role: 'assistant', text: 'New answer', historyMessageId: 'new-native' },
    ];
    expect(preserveOptimisticAssistantMessage([old, user], next)).toEqual(next);
  });

  it('does not duplicate a confirmed prior native reply when history contains a remotely started next turn', () => {
    const old: UiMessage = { id: 'final_old', role: 'assistant', text: 'Old answer', timestampMs: 1000, historyMessageId: 'old-native' };
    const next: UiMessage[] = [
      { ...old, id: 'h_old', timestampMs: undefined },
      { id: 'h_user', role: 'user', text: 'Another device asks' },
      { id: 'h_new', role: 'assistant', text: 'New answer', historyMessageId: 'new-native' },
    ];
    expect(preserveOptimisticAssistantMessage([old], next)).toEqual(next);
  });

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
      ...echo, renderKey: local.renderKey,
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

describe('canonical user clocks after exact native echoes', () => {
  const local: UiMessage = { id: 'usr_150000', renderKey: 'usr_150000', role: 'user', text: 'Photo',
    timestampMs: 150_000, idempotencyKey: 'send-clock', sentLocally: true,
    imageUris: ['file://photo.jpg'], imageMetas: [{ uri: 'file://photo.jpg', width: 400, height: 300 }] };
  const echo: UiMessage = { id: 'native-user', historyMessageId: 'native-user', role: 'user', text: 'Photo',
    timestampMs: 141_000, idempotencyKey: 'send-clock', imageUris: ['https://example.com/photo.jpg'] };
  const reply: UiMessage = { id: 'native-reply', role: 'assistant', text: 'Received', timestampMs: 142_000 };
  const merge = (previous: UiMessage[], next: UiMessage[]) => preserveMessagePresentation(previous,
    preserveOptimisticAssistantMessage(previous, next));

  it.each([
    ['presentation', preserveMessagePresentation],
    ['optimistic', preserveOptimisticAssistantMessage],
    ['both passes', merge],
  ] as const)('%s adopts the native clock without changing message order, identity or photo geometry', (_name, reconcile) => {
    const result = reconcile([local], [echo, reply]);
    expect(result.map(message => message.id)).toEqual([echo.id, reply.id]);
    expect(result[0]).toMatchObject({ timestampMs: echo.timestampMs, renderKey: local.renderKey, sentLocally: true });
    expect(result[0].imageUris).toBe(local.imageUris);
    expect(result[0].imageMetas).toBe(local.imageMetas);
    expect(result[1]).toBe(reply);
    expect(merge(result, [echo, reply])[0].timestampMs).toBe(echo.timestampMs);
  });

  it('uses a unique known native history ID even without a send key', () => {
    const previous = { ...local, id: echo.id, historyMessageId: echo.historyMessageId, idempotencyKey: undefined };
    const next = { ...echo, idempotencyKey: undefined };
    expect(merge([previous], [next, reply])[0].timestampMs).toBe(echo.timestampMs);
  });

  it.each([undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, 8.64e15 + 1])(
    'preserves the phone clock when native time is missing or invalid (%s)', timestampMs => {
      expect(merge([local], [{ ...echo, timestampMs }, reply])[0].timestampMs).toBe(local.timestampMs);
    },
  );

  it('does not promote a send key inherited by a legacy text match into native time evidence', () => {
    const previous = { ...local, text: 'Hello', imageUris: undefined, imageMetas: undefined };
    const legacy: UiMessage = { id: 'legacy-user', role: 'user', text: 'Hello', timestampMs: 141_000 };
    const first = merge([previous], [legacy, reply]);
    expect(first[0]).toMatchObject({ idempotencyKey: previous.idempotencyKey, timestampMs: previous.timestampMs });
    const refreshed = merge(first, [{ ...legacy, timestampMs: 141_500 }, reply]);
    expect(refreshed[0].timestampMs).toBe(previous.timestampMs);
  });

  it('does not treat a shared UI ID as native identity evidence', () => {
    const previous = { ...local, id: echo.id, idempotencyKey: undefined };
    const next = { ...echo, historyMessageId: undefined, idempotencyKey: undefined };
    expect(merge([previous], [next, reply])[0].timestampMs).toBe(previous.timestampMs);
  });

  it.each(['send', 'history'] as const)('does not correct a clock using ambiguous %s identity', identity => {
    const previous = identity === 'send' ? local
      : { ...local, id: echo.id, historyMessageId: echo.historyMessageId, idempotencyKey: undefined };
    const next = identity === 'send' ? echo : { ...echo, idempotencyKey: undefined };
    const duplicatePrevious = { ...previous, id: 'other-previous', renderKey: undefined };
    // A duplicate without a render key must still make the evidence ambiguous.
    expect(preserveMessagePresentation([duplicatePrevious, previous], [next, reply])[0].timestampMs).toBe(previous.timestampMs);
    const duplicateNext = { ...next, id: 'other-native' };
    expect(merge([previous], [next, duplicateNext, reply])[0].timestampMs).toBe(previous.timestampMs);
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


it('keeps a local extension command before its newer canonical result notices', () => {
  const command: UiMessage = { id: 'usr_123', role: 'user', text: '/choose', timestampMs: 120_000 };
  const before: UiMessage = { id: 'ast-before', role: 'assistant', text: 'Earlier', timestampMs: 110_000 };
  const notice: UiMessage = { id: 'notice', historyMessageId: 'native-notice', role: 'system', text: 'Selected Blue', timestampMs: 130_000 };
  expect(preserveOptimisticAssistantMessage([before, command], [before, notice]).map(row => row.id))
    .toEqual(['ast-before', 'usr_123', 'notice']);
  for (const unknown of [{ ...notice, timestampMs: undefined }, { ...notice, timestampMs: 100_000 }, { ...notice, historyMessageId: undefined }]) {
    expect(preserveOptimisticAssistantMessage([before, command], [before, unknown]).map(row => row.id))
      .toEqual(['ast-before', 'notice', 'usr_123']);
  }
});

describe('preserveApprovalRows', () => {
  const card = (id: string, status: 'pending' | 'allowed' = 'allowed'): UiMessage => ({
    id, role: 'system', text: '', timestampMs: 9_999_999,
    approval: { id, kind: 'exec', command: 'curl --head https://example.com', status, expiresAtMs: null },
  });
  const ask: UiMessage = { id: 'ask', role: 'user', text: 'Fetch it' };
  const said: UiMessage = { id: 'live-said', renderKey: 'said', role: 'assistant', text: 'I will use curl.' };
  const call: UiMessage = { id: 'toolcall_1', role: 'tool', text: '', toolName: 'exec', toolStatus: 'running' };

  it('keeps an answered card beside the row it followed when history drops it', () => {
    const approval = card('approval_1');
    // Newest first: the card arrived after the Agent's words.
    const previous = [approval, call, said, ask];
    const next: UiMessage[] = [
      { id: 'answer', role: 'assistant', text: 'HTTP/2 200' },
      { ...call, id: 'toolresult_1', toolStatus: 'success' },
      { id: 'history-said', renderKey: 'said', role: 'assistant', text: 'I will use curl.' },
      ask,
    ];
    expect(preserveApprovalRows(previous, next).map(message => message.id))
      .toEqual(['answer', 'toolresult_1', 'approval_1', 'history-said', 'ask']);
  });

  it('returns the same list when nothing is missing and never keeps pairing requests', () => {
    const next = [card('approval_2'), ask];
    expect(preserveApprovalRows([card('approval_2'), ask], next)).toBe(next);
    const pairing: UiMessage = {
      id: 'approval_pair_device_1', role: 'system', text: '',
      approval: { id: '1', kind: 'pair', target: 'device', displayName: null, platform: null, receivedAtMs: 1, status: 'pending' },
    };
    const plain = [ask];
    expect(preserveApprovalRows([pairing, ask], plain)).toBe(plain);
  });

  it('puts a card with no surviving neighbour first rather than dropping it', () => {
    expect(preserveApprovalRows([card('approval_3', 'pending')], [ask]).map(message => message.id)).toEqual(['approval_3', 'ask']);
  });
});

describe('preserveToolTiming', () => {
  // Pi's live rows are `toolcall_<id>`; its history returns `toolresult_<id>` with only the record's clock.
  const live: UiMessage = { id: 'toolcall_call_1', role: 'tool', text: '', toolName: 'bash', toolStatus: 'success', toolStartedAt: 10_000, toolFinishedAt: 35_000 };
  const reloaded: UiMessage = { id: 'toolresult_call_1', role: 'tool', text: '', toolName: 'bash', toolStatus: 'success', toolFinishedAt: 7_000 };
  const reply: UiMessage = { id: 'reply', role: 'assistant', text: 'done' };

  it('keeps the times the phone measured when history has none of its own', () => {
    expect(preserveToolTiming([live], [reply, reloaded])).toEqual([
      reply,
      { ...reloaded, toolStartedAt: 10_000, toolFinishedAt: 35_000, toolDurationMs: undefined },
    ]);
  });

  it('leaves timed history, unfinished live rows and other calls alone', () => {
    const timed = [{ ...reloaded, toolDurationMs: 2_000 }];
    expect(preserveToolTiming([live], timed)).toBe(timed);
    const running = { ...live, toolStatus: 'running' as const, toolFinishedAt: undefined };
    const next = [reloaded];
    expect(preserveToolTiming([running], next)).toBe(next);
    const other = [{ ...reloaded, id: 'toolresult_call_2' }];
    expect(preserveToolTiming([live], other)).toBe(other);
    expect(preserveToolTiming([{ ...reply, toolStartedAt: 1, toolFinishedAt: 2 }], next)).toBe(next);
  });

  it('follows the snapshot alias for a call the live stream named differently', () => {
    const aliased = { ...live, id: 'toolcall_live_7' };
    expect(preserveToolTiming([aliased], [{ ...reloaded, id: 'toolcall_item_7' }], { live_7: 'item_7' })[0])
      .toMatchObject({ id: 'toolcall_item_7', toolStartedAt: 10_000, toolFinishedAt: 35_000 });
  });
});
