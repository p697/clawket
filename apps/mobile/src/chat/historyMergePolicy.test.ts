import { finishLiveRunPresentation, liveReplyRenderKey } from './liveRunThread';
import { UiMessage } from '../types/chat';
import { preserveCompletedRunPresentation, preserveApprovalRows, preserveHydratedMessageKeys, preserveMessagePresentation, preserveOptimisticAssistantMessage, preserveToolTiming, prependOlderCachedMessages, reconcileAcceptedSteeringMessage, retireAliasedTools } from './historyMergePolicy';

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
  it('replaces a stopped run snapshot with the transcript reply that extends it', () => {
    const prompt: UiMessage = { id: 'h_user', role: 'user', text: 'Write a story', timestampMs: 1_000 };
    const reply: UiMessage = { id: 'h_reply', role: 'assistant', text: '# The Cat\n\nIt was two in the morning.', timestampMs: 5_000 };
    const stopped: UiMessage = { id: 'abort_run-1', role: 'assistant', text: '#', timestampMs: 30_000 };
    expect(preserveOptimisticAssistantMessage([prompt, stopped], [prompt, reply])).toEqual([prompt, reply]);
  });

  describe('steering echo identity', () => {
    const main: UiMessage = { id: 'native-main', historyMessageId: 'native-main', role: 'user', text: 'Wait', timestampMs: 1_000 };
    const first: UiMessage = { id: 'usr_10000_steer_run_1', renderKey: 'usr_10000_steer_run_1', role: 'user', sentLocally: true, text: 'Keep waiting', timestampMs: 10_000 };
    const firstEcho: UiMessage = { id: 'native-guide-1', historyMessageId: 'native-guide-1', role: 'user', text: first.text, timestampMs: first.timestampMs };
    const reconcile = (previous: UiMessage[], next: UiMessage[]) => preserveMessagePresentation(previous,
      preserveOptimisticAssistantMessage(previous, next));

    it.each([62_000, 125_000])('does not give a %i ms older native guide a newer steering identity when the send key is missing', (difference) => {
      const second: UiMessage = { ...first, id: `usr_${10_000 + difference}_steer_run_2`, renderKey: `usr_${10_000 + difference}_steer_run_2`, timestampMs: 10_000 + difference };
      // A read immediately after the second ACK can still contain only the first native guide.
      const merged = reconcile([main, first, second], [main, firstEcho]);
      expect(merged).toEqual([main, firstEcho, second]);
      expect(merged.find(message => message.id === firstEcho.id)?.renderKey).not.toBe(second.renderKey);
    });

    it('adopts the later exact native guide without carrying the wrong key through a completed or cold canonical snapshot', () => {
      const second: UiMessage = { ...first, id: 'usr_135000_steer_run_2', renderKey: 'usr_135000_steer_run_2', timestampMs: 135_000 };
      const secondEcho: UiMessage = { ...firstEcho, id: 'native-guide-2', historyMessageId: 'native-guide-2', timestampMs: 135_010 };
      const stale = reconcile([main, first, second], [main, firstEcho]);
      const completed = reconcile(stale, [main, firstEcho, secondEcho]);
      expect(completed.filter(message => message.role === 'user').map(message => message.id)).toEqual([main.id, firstEcho.id, secondEcho.id]);
      expect(completed.find(message => message.id === firstEcho.id)?.renderKey).toBeUndefined();
      expect(completed.find(message => message.id === secondEcho.id)?.renderKey).toBe(second.renderKey);
      expect(new Set(completed.map(message => message.renderKey ?? message.id)).size).toBe(completed.length);
      const confirmed = reconcile(completed, [main, firstEcho, secondEcho]);
      // A later exact history alias owns the canonical clock, while keys stay stable.
      expect(confirmed).toEqual([main, firstEcho, { ...completed[2], timestampMs: secondEcho.timestampMs }]);
      expect(reconcile(confirmed, [main, firstEcho, secondEcho])).toEqual(confirmed);
      expect(preserveHydratedMessageKeys(completed, [main, firstEcho, secondEcho]))
        .toEqual([main, firstEcho, { ...secondEcho, renderKey: second.renderKey, sentLocally: true }]);
    });

    it('keeps an already confirmed exact history identity even when its authoritative clock changes', () => {
      const confirmed = { ...first, historyMessageId: firstEcho.id, timestampMs: 135_000 };
      const merged = reconcile([main, confirmed], [main, firstEcho]);
      expect(merged).toHaveLength(2);
      expect(merged[1]).toMatchObject({ id: firstEcho.id, renderKey: first.renderKey, historyMessageId: firstEcho.id, timestampMs: firstEcho.timestampMs });
      const exactId = { ...firstEcho, renderKey: first.renderKey, sentLocally: true as const };
      expect(reconcile([main, exactId], [main, { ...firstEcho, timestampMs: 135_000 }])[1])
        .toMatchObject({ id: firstEcho.id, renderKey: first.renderKey, timestampMs: 135_000 });
    });

    it('keeps legacy timestamp-free steering echoes and ordinary non-steering fallback behavior', () => {
      const steering = { ...first, timestampMs: 135_000 };
      const untimed = { ...firstEcho, timestampMs: undefined };
      expect(reconcile([main, steering], [main, untimed])[1]).toMatchObject({ id: firstEcho.id, renderKey: first.renderKey });
      const ordinary = { ...steering, id: 'usr_135000', renderKey: 'usr_135000' };
      expect(reconcile([main, ordinary], [main, firstEcho])[1]).toMatchObject({ id: firstEcho.id, renderKey: ordinary.renderKey });
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 8_640_000_000_000_001])('does not treat an invalid native clock (%s) as contradictory steering evidence', (timestampMs) => {
      const steering = { ...first, timestampMs: 135_000 };
      expect(reconcile([main, steering], [main, { ...firstEcho, timestampMs }])[1])
        .toMatchObject({ id: firstEcho.id, renderKey: first.renderKey });
    });
  });

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

  it.each(['unknown', 'running'] as const)('does not restore old completion clocks to explicitly reported %s history', toolStatus => {
    const next = [{ ...reloaded, toolStatus, toolStatusReported: true as const, toolFinishedAt: undefined }];
    expect(preserveToolTiming([live], next)).toBe(next);
    expect(next[0].toolFinishedAt).toBeUndefined();
  });

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

describe('native same-run completed presentation', () => {
  it('keeps two canonical guides interleaved while adopting completed live tool identities', () => {
    const main: UiMessage = { id: 'main', role: 'user', text: 'Task', turnId: 'turn', idempotencyKey: 'send' };
    const a: UiMessage = { id: 'live-a', role: 'assistant', text: 'A', turnId: 'turn', presentationRunId: 'run', renderKey: 'stable-a' };
    const tool: UiMessage = { id: 'toolcall_exec', role: 'tool', text: '', toolName: 'exec', toolStatus: 'running', turnId: 'turn', presentationRunId: 'run' };
    const b: UiMessage = { id: 'live-b', role: 'assistant', text: 'B', turnId: 'turn', presentationRunId: 'run', renderKey: 'stable-b' };
    const guide1: UiMessage = { id: 'guide1', role: 'user', text: 'Same guide', turnId: 'turn' };
    const guide2: UiMessage = { ...guide1, id: 'guide2' };
    const next: UiMessage = { ...guide1, id: 'next', idempotencyKey: 'next-send', turnId: 'next-turn' };
    const remote: UiMessage[] = [main, { ...a, id: 'native-a', presentationRunId: undefined },
      { ...tool, toolStatus: 'success', presentationRunId: undefined }, guide1,
      { ...b, id: 'native-b', presentationRunId: undefined }, guide2, next];
    const rows = preserveCompletedRunPresentation([main, a, tool, guide1, b, guide2], remote);
    expect(rows.map(row => row.text)).toEqual(['Task', 'A', '', 'Same guide', 'B', 'Same guide', 'Same guide']);
    expect(rows.filter(row => row.role === 'user').map(row => row.id)).toEqual(['main', 'guide1', 'guide2', 'next']);
    expect(rows.filter(row => row.id === 'toolcall_exec')).toEqual([expect.objectContaining({ toolStatus: 'success' })]);
    expect(rows.find(row => row.text === 'A')?.renderKey).toBe('stable-a');
    expect(rows.at(-1)).toEqual(next);
  });
});



describe('interrupted cumulative commentary across a canonical same-turn guide', () => {
  const setup = () => {
    const main: UiMessage = { id: 'native-main', role: 'user', text: 'Synthetic main', turnId: 'native-turn', idempotencyKey: 'main-send' };
    const s: UiMessage = { id: 'native-s', role: 'assistant', text: 'Before tool.', turnId: 'native-turn', timestampMs: 1_000 };
    const tool: UiMessage = { id: 'toolcall_synthetic', role: 'tool', text: '', toolName: 'exec', toolStatus: 'running', turnId: 'native-turn' };
    const a: UiMessage = { id: 'native-a', role: 'assistant', text: 'Commentary A.', turnId: 'native-turn', timestampMs: 10_000 };
    const guide: UiMessage = { id: 'native-guide', role: 'user', text: 'Synthetic guide', turnId: 'native-turn', timestampMs: 20_000 };
    const b: UiMessage = { id: 'native-b', role: 'assistant', text: 'Commentary B.', turnId: 'native-turn', timestampMs: 30_000 };
    const history = [main, s, tool, a, guide, b];
    // This is the actual controller terminal composition; the cumulative tail
    // has never met another tool boundary. No synthetic ACK cuts the text.
    const rows = finishLiveRunPresentation({
      segments: [{ id: 'local-s', renderKey: 'stable-s', text: s.text, timestampMs: 1_000, afterToolCount: 0 }],
      tools: [tool], tail: a.text + '\n\n' + b.text, runId: 'synthetic-run',
      startedAt: 1_000, turnId: 'native-turn', cancelled: true,
    });
    const merge = (incoming: UiMessage[]) => preserveOptimisticAssistantMessage([
      ...incoming.filter(message => !rows.some(row => row.id === message.id)), ...rows,
    ], incoming);
    return { main, s, tool, a, guide, b, history, rows, merge };
  };

  it('keeps canonical A / guide / B once after abort instead of retaining a second A+B bubble', () => {
    const { history, a, b, merge } = setup();
    const result = merge(history);
    expect(result.map(row => row.text)).toEqual(['Synthetic main', 'Before tool.', '', a.text, 'Synthetic guide', b.text]);
    expect(result.filter(row => row.role === 'assistant').map(row => row.timestampMs)).toEqual([1_000, 10_000, 30_000]);
    expect(result.filter(row => row.id === a.id)).toHaveLength(1);
    expect(result.filter(row => row.id === b.id)).toHaveLength(1);
    expect(result.find(row => row.text === 'Before tool.')?.renderKey).toBe('stable-s');
    expect(result.find(row => row.id === a.id)?.renderKey).toBe(liveReplyRenderKey(1_000, 'synthetic-run', 1));
    expect(new Set(result.map(row => row.renderKey ?? row.id)).size).toBe(result.length);
    // Repeated reconciliation cannot recreate the aborted aggregate.
    expect(preserveOptimisticAssistantMessage(result, history).map(row => row.text)).toEqual(result.map(row => row.text));
  });

  it.each(['missing-b', 'no-guide', 'foreign-guide', 'local-ack', 'no-turn', 'missing-clock', 'changed-tail'] as const)
  ('retains unproven text instead of guessing a split for %s', variant => {
    const { history, a, b, rows, merge } = setup();
    const incoming = history.flatMap(row => {
      if (variant === 'missing-b' && row.id === b.id) return [];
      if (variant === 'no-guide' && row.role === 'user' && row.id !== 'native-main') return [];
      if (variant === 'foreign-guide' && row.id === 'native-guide') return [{ ...row, turnId: 'foreign-turn' }];
      if (variant === 'local-ack' && row.id === 'native-guide') return [{ ...row, id: 'usr_20000_steer_synthetic-run', sentLocally: true as const }];
      if (variant === 'no-turn') return [{ ...row, turnId: undefined }];
      if (variant === 'missing-clock' && row.id === b.id) return [{ ...row, timestampMs: undefined }];
      if (variant === 'changed-tail' && row.id === b.id) return [{ ...row, text: b.text + ' Changed.' }];
      return [row];
    });
    const result = merge(incoming);
    expect(result.some(row => row.id === 'abort_synthetic-run' && row.text === a.text + '\n\n' + b.text)).toBe(true);
    expect(rows.find(row => row.id === 'abort_synthetic-run')?.text).toBe(a.text + '\n\n' + b.text);
  });
  it.each([undefined, 0, Number.NaN])('does not split across an unreported or invalid guide clock (%s)', timestampMs => {
    const { history, a, b, merge } = setup();
    const incoming = history.map(row => row.id === 'native-guide' ? { ...row, timestampMs } : row);
    expect(merge(incoming).some(row => row.id === 'abort_synthetic-run' && row.text === a.text + '\n\n' + b.text)).toBe(true);
  });

  it('preserves canonical row order even when individually valid clocks are nonmonotonic', () => {
    const { history, a, b, merge } = setup();
    const incoming = history.map(row => row.id === b.id ? { ...row, timestampMs: 5_000 } : row);
    const result = merge(incoming);
    expect(result.map(row => row.text)).toEqual(['Synthetic main', 'Before tool.', '', a.text, 'Synthetic guide', b.text]);
    expect(result.filter(row => row.role === 'assistant').map(row => row.timestampMs)).toEqual([1_000, 10_000, 5_000]);
  });

  it('keeps an already displayed canonical A render identity instead of claiming it for the aborted rollup', () => {
    const { history, a, b, merge } = setup();
    const incoming = history.map(row => row.id === a.id ? { ...row, renderKey: 'old-stable-canonical-a' } : row);
    const result = merge(incoming);
    expect(result.find(row => row.id === a.id)?.renderKey).toBe('old-stable-canonical-a');
    expect(result.filter(row => row.id === a.id)).toHaveLength(1);
    expect(result.filter(row => row.id === b.id)).toHaveLength(1);
    expect(new Set(result.map(row => row.renderKey ?? row.id)).size).toBe(result.length);
  });

  it('does not give canonical A a render key already owned by canonical B', () => {
    const { history, a, b, merge } = setup();
    const tailKey = liveReplyRenderKey(1_000, 'synthetic-run', 1);
    const incoming = history.map(row => row.id === b.id ? { ...row, renderKey: tailKey } : row);
    const result = merge(incoming);
    // A adopts its own canonical identity rather than stealing B's existing cell.
    expect(result.find(row => row.id === a.id)?.renderKey ?? a.id).toBe(a.id);
    expect(result.find(row => row.id === b.id)?.renderKey).toBe(tailKey);
    expect(result.some(row => row.id === 'abort_synthetic-run')).toBe(false);
    expect(new Set(result.map(row => row.renderKey ?? row.id)).size).toBe(result.length);
  });

  it('preserves a distinct earlier identical paragraph when the latest exact native identity is known', () => {
    const { history, a, b, guide, merge } = setup();
    const earlyA = { ...a, id: 'native-earlier-a', timestampMs: 5_000 };
    const earlyGuide = { ...guide, id: 'native-earlier-guide', timestampMs: 6_000 };
    const intervening = { ...a, id: 'native-intervening', text: 'An independent paragraph.', timestampMs: 7_000 };
    const incoming = [...history.slice(0, 3), earlyA, earlyGuide, intervening, ...history.slice(3)];
    const result = merge(incoming);
    expect(result.map(row => row.text)).toEqual(incoming.map(row => row.text));
    expect(result.filter(row => row.id === earlyA.id)).toHaveLength(1);
    expect(result.filter(row => row.id === a.id)).toHaveLength(1);
    expect(result.findIndex(row => row.id === a.id)).toBeLessThan(result.findIndex(row => row.id === guide.id));
    expect(result.findIndex(row => row.id === guide.id)).toBeLessThan(result.findIndex(row => row.id === b.id));
    expect(result.some(row => row.id === 'abort_synthetic-run')).toBe(false);
    expect(new Set(result.map(row => row.renderKey ?? row.id)).size).toBe(result.length);
  });

  it('retains an aggregate when an exact local prefix has changed content', () => {
    const { history, a, b, rows } = setup();
    const ownedA: UiMessage = { ...a, text: 'Unconfirmed changed paragraph.', presentationRunId: 'synthetic-run', renderKey: 'old-stable-canonical-a' };
    const prior = [...history.filter(row => !rows.some(local => local.id === row.id) && row.id !== a.id), ...rows.filter(row => row.id !== 'abort_synthetic-run'), ownedA, rows.find(row => row.id === 'abort_synthetic-run')!];
    const result = preserveOptimisticAssistantMessage(prior, history);
    expect(result.some(row => row.id === 'abort_synthetic-run' && row.text === a.text + '\n\n' + b.text)).toBe(true);
    expect(new Set(result.map(row => row.renderKey ?? row.id)).size).toBe(result.length);
  });

  it('does not clone A when an independent local presentation segment already owns its exact canonical identity', () => {
    const { history, a, b, rows } = setup();
    const ownedA: UiMessage = { ...a, presentationRunId: 'synthetic-run', renderKey: 'old-stable-canonical-a' };
    const prior = [...history.filter(row => !rows.some(local => local.id === row.id) && row.id !== a.id), ...rows.filter(row => row.id !== 'abort_synthetic-run'), ownedA, rows.find(row => row.id === 'abort_synthetic-run')!];
    const result = preserveOptimisticAssistantMessage(prior, history);
    expect(result.filter(row => row.id === a.id)).toHaveLength(1);
    expect(result.find(row => row.id === a.id)?.renderKey).toBe('old-stable-canonical-a');
    expect(result.some(row => row.id === 'abort_synthetic-run')).toBe(false);
    expect(result.map(row => row.text)).toEqual(['Synthetic main', 'Before tool.', '', a.text, 'Synthetic guide', b.text]);
    expect(new Set(result.map(row => row.renderKey ?? row.id)).size).toBe(result.length);
  });

});

describe('interrupted commentary with independently owned canonical prefix', () => {
  const fixture = () => {
    const turnId = 'synthetic-prefix-turn';
    const runId = 'synthetic-prefix-run';
    const repeated = 'Synthetic repeated commentary A.';
    const after = 'Synthetic commentary B.';
    const main: UiMessage = { id: 'synthetic-main', role: 'user', text: 'Synthetic task',
      turnId, idempotencyKey: 'synthetic-main-send' };
    const assistant = (ordinal: number, text: string): UiMessage => ({
      id: `synthetic-native-assistant-${ordinal}`, role: 'assistant', text,
      turnId, timestampMs: ordinal * 10_000,
    });
    const a1 = assistant(1, 'Synthetic introduction.');
    const earlierA = assistant(3, repeated);
    const latestA = assistant(10, repeated);
    const b = assistant(11, after);
    const tool: UiMessage = { id: 'toolcall_synthetic-prefix', role: 'tool', text: '',
      toolName: 'exec', toolStatus: 'success', turnId, timestampMs: 15_000 };
    // Native wire ID survives an ACK-first echo; sentLocally is its origin only.
    const guide1: UiMessage = { id: 'synthetic-native-guide-1', role: 'user', text: 'Synthetic guide',
      turnId, timestampMs: 95_000, sentLocally: true, renderKey: 'usr_95000_steer_synthetic-prefix-run' };
    const guide2: UiMessage = { id: 'synthetic-native-guide-2', role: 'user', text: guide1.text,
      turnId, timestampMs: 105_000, sentLocally: true, renderKey: 'usr_105000_steer_synthetic-prefix-run' };
    // Exactly 16 canonical rows, 12 assistants, two same-turn guides. The early
    // ordinal-3 A has the same text as ordinal-10 A but a distinct wire identity.
    // This is synthetic ordering, not copied private Native text or wire data.
    const canonical: UiMessage[] = [main, a1, tool,
      assistant(2, 'Synthetic commentary two.'), earlierA,
      assistant(4, 'Synthetic commentary four.'), assistant(5, 'Synthetic commentary five.'),
      assistant(6, 'Synthetic commentary six.'), assistant(7, 'Synthetic commentary seven.'),
      assistant(8, 'Synthetic commentary eight.'), assistant(9, 'Synthetic commentary nine.'),
      guide1, latestA, guide2, b, assistant(12, 'Synthetic later paragraph.')];
    const finished = finishLiveRunPresentation({
      segments: [{ id: 'synthetic-local-intro', renderKey: 'synthetic-stable-intro',
        text: a1.text, timestampMs: a1.timestampMs!, afterToolCount: 0 }],
      tools: [tool], tail: repeated + '\n\n' + after, runId,
      startedAt: 10_000, turnId, cancelled: true,
    });
    const aborted = finished.find(row => row.id === `abort_${runId}`)!;
    const previous = (owners: UiMessage[] = []): UiMessage[] => [
      main, ...finished.filter(row => row !== aborted), guide1, ...owners, guide2, aborted,
    ];
    const merge = (owners: UiMessage[] = []) => preserveOptimisticAssistantMessage(previous(owners), canonical);
    return { canonical, latestA, earlierA, b, aborted, repeated, runId, merge };
  };

  it('keeps the earlier equal-text Native row when the unique latest A/guide/B tail is reconciled', () => {
    const { canonical, latestA, earlierA, b, aborted, repeated, merge } = fixture();
    expect(canonical).toHaveLength(16);
    expect(canonical.filter(row => row.role === 'assistant')).toHaveLength(12);
    const result = merge();
    // A text fallback must not win before an available exact wire identity.
    expect(result.map(row => row.id)).toEqual(canonical.map(row => row.id));
    expect(result.filter(row => row.text === repeated).map(row => row.id)).toEqual([earlierA.id, latestA.id]);
    expect(result.find(row => row.id === latestA.id)?.renderKey).toBe(aborted.renderKey);
    expect(result.find(row => row.id === earlierA.id)?.renderKey ?? earlierA.id).toBe(earlierA.id);
    expect(result.find(row => row.id === b.id)?.timestampMs).toBe(b.timestampMs);
    expect(result.some(row => row.id === aborted.id)).toBe(false);
    expect(new Set(result.map(row => row.renderKey ?? row.id)).size).toBe(result.length);
    expect(preserveOptimisticAssistantMessage(result, canonical)).toEqual(result);
  });

  it('keeps an exact independently owned latest A cell and replaces only the interrupted suffix with B', () => {
    const { canonical, latestA, earlierA, b, aborted, runId, merge } = fixture();
    const owner: UiMessage = { ...latestA, presentationRunId: runId, renderKey: 'synthetic-owned-latest-a' };
    const result = merge([owner]);
    expect(result.map(row => row.id)).toEqual(canonical.map(row => row.id));
    expect(result.filter(row => row.id === latestA.id)).toHaveLength(1);
    expect(result.find(row => row.id === latestA.id)).toMatchObject({
      text: latestA.text, turnId: latestA.turnId, timestampMs: latestA.timestampMs,
      renderKey: owner.renderKey,
    });
    expect(result.find(row => row.id === earlierA.id)?.renderKey ?? earlierA.id).toBe(earlierA.id);
    expect(result.find(row => row.id === b.id)).toMatchObject({
      text: b.text, timestampMs: b.timestampMs, renderKey: aborted.renderKey,
    });
    expect(result.some(row => row.id === aborted.id)).toBe(false);
    expect(new Set(result.map(row => row.renderKey ?? row.id)).size).toBe(result.length);
    expect(preserveOptimisticAssistantMessage(result, canonical)).toEqual(result);
  });

  it('retains the aggregate when exact prefix ownership has changed text or is ambiguous', () => {
    const { latestA, aborted, runId, merge } = fixture();
    const owner: UiMessage = { ...latestA, presentationRunId: runId, renderKey: 'synthetic-owned-latest-a' };
    const cases: UiMessage[][] = [
      [{ ...owner, text: 'Synthetic changed ownership text.' }],
      [owner, { ...owner, id: 'synthetic-local-alias-a', historyMessageId: latestA.id,
        renderKey: 'synthetic-second-owner-a' }],
    ];
    for (const owners of cases) {
      const result = merge(owners);
      expect(result.filter(row => row.id === aborted.id)).toEqual([expect.objectContaining({
        text: aborted.text, turnId: aborted.turnId, renderKey: aborted.renderKey,
      })]);
    }
  });
});
