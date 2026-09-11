import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import type { PendingImage } from '../types/chat';
import {
  createQueuedMessageId,
  enqueueMessage,
  getMessageQueueStore,
  holdMessageQueue,
  markQueuedMessageSending,
  messageQueueScopeKey,
  promoteQueuedMessage,
  releaseMessageQueue,
  removeQueuedMessage,
  type MessageQueueState,
  type MessageQueueStore,
  type QueuedMessage,
} from './messageQueue';

type Params = {
  connectionId: string | null;
  sessionKey: string | null;
  store?: MessageQueueStore;
};

export type ChatMessageQueue = Readonly<{
  state: MessageQueueState;
  /** Pinned scope for work that outlives a session switch (e.g. an in-flight delivery). */
  scopeKey: string | null;
  store: MessageQueueStore;
  /** Latest store value for callbacks that run after awaits. */
  readCurrent: () => MessageQueueState;
  enqueue: (input: { text: string; images: ReadonlyArray<PendingImage> }) => QueuedMessage | null;
  /** Removes the item and hands it back so the composer can adopt it. */
  remove: (id: string) => QueuedMessage | null;
  promote: (id: string) => void;
  hold: () => void;
  release: () => void;
  markSending: (id: string | null) => void;
}>;

export function useChatMessageQueue({ connectionId, sessionKey, store }: Params): ChatMessageQueue {
  const resolvedStore = store ?? getMessageQueueStore();
  const scopeKey = connectionId && sessionKey ? messageQueueScopeKey(connectionId, sessionKey) : null;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const subscribe = useCallback(
    (listener: () => void) => resolvedStore.subscribe(listener),
    [resolvedStore],
  );
  const read = useCallback(() => resolvedStore.read(scopeKey), [resolvedStore, scopeKey]);
  const state = useSyncExternalStore(subscribe, read, read);

  return useMemo<ChatMessageQueue>(() => ({
    state,
    scopeKey,
    store: resolvedStore,
    readCurrent: () => resolvedStore.read(scopeRef.current),
    enqueue: ({ text, images }) => {
      const createdAt = Date.now();
      const item: QueuedMessage = {
        id: createQueuedMessageId(createdAt),
        text,
        images: [...images],
        createdAt,
      };
      const before = resolvedStore.read(scopeRef.current);
      const after = resolvedStore.update(scopeRef.current, (current) => enqueueMessage(current, item));
      return after.items.length > before.items.length ? item : null;
    },
    remove: (id) => {
      const item = resolvedStore.read(scopeRef.current).items.find((entry) => entry.id === id) ?? null;
      if (item) resolvedStore.update(scopeRef.current, (current) => removeQueuedMessage(current, id));
      return item;
    },
    promote: (id) => {
      resolvedStore.update(scopeRef.current, (current) => promoteQueuedMessage(current, id));
    },
    hold: () => {
      resolvedStore.update(scopeRef.current, holdMessageQueue);
    },
    release: () => {
      resolvedStore.update(scopeRef.current, releaseMessageQueue);
    },
    markSending: (id) => {
      resolvedStore.update(scopeRef.current, (current) => markQueuedMessageSending(current, id));
    },
  }), [resolvedStore, scopeKey, state]);
}
