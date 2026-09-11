import {
  canEnqueueMessage,
  createQueuedMessageId,
  EMPTY_MESSAGE_QUEUE,
  enqueueMessage,
  getMessageQueueStore,
  holdMessageQueue,
  markQueuedMessageSending,
  MESSAGE_QUEUE_LIMIT,
  MessageQueueStore,
  messageQueueScopeKey,
  nextDeliverableMessage,
  promoteQueuedMessage,
  queuedMessageDelivery,
  releaseMessageQueue,
  removeQueuedMessage,
  resetMessageQueueStore,
  type QueuedMessage,
} from './messageQueue';

function item(id: string, text = id): QueuedMessage {
  return { id, text, images: [], createdAt: 1 };
}

describe('messageQueue model', () => {
  it('keeps the optimistic user prefix on queued ids', () => {
    expect(createQueuedMessageId(1700, () => 0.5)).toMatch(/^usr_1700_q[a-z0-9]+$/);
  });

  it('appends in order, resumes a held queue, and rejects duplicates', () => {
    const held = { ...EMPTY_MESSAGE_QUEUE, items: [item('a')], held: true };
    const next = enqueueMessage(held, item('b'));
    expect(next.items.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(next.held).toBe(false);
    expect(enqueueMessage(next, item('b'))).toBe(next);
  });

  it('caps the queue at the shared limit', () => {
    let state = EMPTY_MESSAGE_QUEUE;
    for (let index = 0; index < MESSAGE_QUEUE_LIMIT; index += 1) {
      state = enqueueMessage(state, item(`m${index}`));
    }
    expect(canEnqueueMessage(state)).toBe(false);
    expect(enqueueMessage(state, item('overflow'))).toBe(state);
  });

  it('removes items and drops the hold once nothing is left', () => {
    let state = enqueueMessage(enqueueMessage(EMPTY_MESSAGE_QUEUE, item('a')), item('b'));
    state = holdMessageQueue(state);
    state = removeQueuedMessage(state, 'a');
    expect(state).toEqual({ items: [item('b')], held: true, sendingId: null });
    state = removeQueuedMessage(state, 'b');
    expect(state.held).toBe(false);
    expect(removeQueuedMessage(state, 'missing')).toBe(state);
  });

  it('promotes an item to the head and releases the hold', () => {
    let state = enqueueMessage(enqueueMessage(EMPTY_MESSAGE_QUEUE, item('a')), item('b'));
    state = holdMessageQueue(state);
    state = promoteQueuedMessage(state, 'b');
    expect(state.items.map((entry) => entry.id)).toEqual(['b', 'a']);
    expect(state.held).toBe(false);
    expect(promoteQueuedMessage(state, 'missing')).toBe(state);
  });

  it('holds, releases, and clears an in-flight marker when held', () => {
    expect(holdMessageQueue(EMPTY_MESSAGE_QUEUE)).toBe(EMPTY_MESSAGE_QUEUE);
    let state = enqueueMessage(EMPTY_MESSAGE_QUEUE, item('a'));
    state = markQueuedMessageSending(state, 'a');
    expect(state.sendingId).toBe('a');
    expect(nextDeliverableMessage(state)).toBeNull();
    state = holdMessageQueue(state);
    expect(state).toEqual({ items: [item('a')], held: true, sendingId: null });
    expect(holdMessageQueue(state)).toBe(state);
    expect(nextDeliverableMessage(state)).toBeNull();
    state = releaseMessageQueue(state);
    expect(state.held).toBe(false);
    expect(releaseMessageQueue(state)).toBe(state);
    expect(nextDeliverableMessage(state)).toEqual(item('a'));
  });

  it('ignores a sending marker for an unknown item', () => {
    const state = enqueueMessage(EMPTY_MESSAGE_QUEUE, item('a'));
    expect(markQueuedMessageSending(state, 'zzz')).toBe(state);
    expect(markQueuedMessageSending(state, null)).toBe(state);
  });

  it('derives the delivery presentation per item', () => {
    let state = enqueueMessage(enqueueMessage(EMPTY_MESSAGE_QUEUE, item('a')), item('b'));
    expect(queuedMessageDelivery(state, 'a')).toBe('queued');
    state = markQueuedMessageSending(state, 'a');
    expect(queuedMessageDelivery(state, 'a')).toBe('sending');
    expect(queuedMessageDelivery(state, 'b')).toBe('queued');
    state = holdMessageQueue(state);
    expect(queuedMessageDelivery(state, 'a')).toBe('held');
  });
});

describe('MessageQueueStore', () => {
  afterEach(() => resetMessageQueueStore());

  it('returns a stable empty snapshot and scopes queues by connection and session', () => {
    const store = new MessageQueueStore();
    const scope = messageQueueScopeKey('conn', 'agent:main:main');
    expect(store.read(scope)).toBe(EMPTY_MESSAGE_QUEUE);
    expect(store.read(null)).toBe(EMPTY_MESSAGE_QUEUE);
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);
    store.update(scope, (state) => enqueueMessage(state, item('a')));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.read(scope).items).toHaveLength(1);
    expect(store.read(messageQueueScopeKey('conn', 'agent:main:other'))).toBe(EMPTY_MESSAGE_QUEUE);
    // Unchanged reducers do not notify.
    store.update(scope, (state) => state);
    expect(listener).toHaveBeenCalledTimes(1);
    store.update(scope, (state) => removeQueuedMessage(state, 'a'));
    expect(store.read(scope)).toBe(EMPTY_MESSAGE_QUEUE);
    unsubscribe();
    store.update(scope, (state) => enqueueMessage(state, item('b')));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.update(null, (state) => enqueueMessage(state, item('c')))).toBe(EMPTY_MESSAGE_QUEUE);
  });

  it('clears every queue of a removed connection only', () => {
    const store = new MessageQueueStore();
    store.update(messageQueueScopeKey('conn-a', 's1'), (state) => enqueueMessage(state, item('a')));
    store.update(messageQueueScopeKey('conn-a', 's2'), (state) => enqueueMessage(state, item('b')));
    store.update(messageQueueScopeKey('conn-ab', 's1'), (state) => enqueueMessage(state, item('c')));
    const listener = jest.fn();
    store.subscribe(listener);
    store.clearConnection('conn-a');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.read(messageQueueScopeKey('conn-a', 's1'))).toBe(EMPTY_MESSAGE_QUEUE);
    expect(store.read(messageQueueScopeKey('conn-a', 's2'))).toBe(EMPTY_MESSAGE_QUEUE);
    expect(store.read(messageQueueScopeKey('conn-ab', 's1')).items).toHaveLength(1);
    store.clearConnection('missing');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('shares one default store until reset', () => {
    const first = getMessageQueueStore();
    expect(getMessageQueueStore()).toBe(first);
    resetMessageQueueStore();
    expect(getMessageQueueStore()).not.toBe(first);
  });
});
