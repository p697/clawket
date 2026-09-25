import { normalizeMessageAttribution } from '../chat/messageAttribution';
import AsyncStorage from "@react-native-async-storage/async-storage";
import { UiMessage } from "../types/chat";
import { sanitizeSilentPreviewText, shouldHideMessage } from "../utils/chat-message";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Lightweight message stored in the cache (strip transient / heavy fields). */
export type CachedMessage = {
  id: string;
  historyMessageId?: string;
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  attribution?: UiMessage["attribution"];
  sentLocally?: true;
  sendUncertain?: boolean;
  idempotencyKey?: string;
  timestampMs?: number;
  imageUris?: string[];
  imageMetas?: UiMessage["imageMetas"];
  fileAttachments?: UiMessage["fileAttachments"];
  modelLabel?: string;
  usage?: UiMessage["usage"];
  toolName?: string;
  toolStatus?: "running" | "success" | "error" | "unknown";
  toolSummary?: string;
  toolArgs?: string;
  toolDetail?: string;
  toolDurationMs?: number;
  toolStartedAt?: number;
  toolFinishedAt?: number;
};

/** Metadata stored in the session index for list display. */
export type CachedSessionMeta = {
  /** Deterministic storage key for the message payload. */
  storageKey: string;
  gatewayConfigId: string;
  agentId: string;
  agentName?: string;
  agentEmoji?: string;
  sessionKey: string;
  sessionId?: string;
  sessionLabel?: string;
  messageCount: number;
  firstMessageMs?: number;
  lastMessageMs?: number;
  lastMessagePreview?: string;
  lastModelLabel?: string;
  updatedAt: number;
};

export type CachedSessionSnapshot = {
  meta: CachedSessionMeta;
  messages: CachedMessage[];
};

export type ChatCacheSearchFilter = {
  agentId?: string;
  gatewayConfigId?: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INDEX_KEY = "clawket.chatCache.index.v2";
const MSG_PREFIX = "clawket.chatCache.msgs.";
const MAX_CACHED_SESSIONS = 50;
const CHUNK_SIZE = 100;
const CHUNKED_STORAGE_VERSION = 3;

type StoredChunkManifest = {
  version: number;
  chunkCount: number;
  messageCount: number;
  revision?: string;
};

type StoredGenerationLayout = {
  chunkCount: number;
  revision?: string;
  version?: number;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function normalizeSessionId(sessionId?: string): string | undefined {
  if (!sessionId) return undefined;
  const trimmed = sessionId.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function makeStorageKey(
  gatewayConfigId: string,
  agentId: string,
  sessionKey: string,
  sessionId?: string,
): string {
  // Simple deterministic key — readable and collision-free for practical use.
  const stableSessionId = normalizeSessionId(sessionId);
  if (stableSessionId) {
    return `${MSG_PREFIX}${gatewayConfigId}::${agentId}::${sessionKey}::sid:${stableSessionId}`;
  }
  return `${MSG_PREFIX}${gatewayConfigId}::${agentId}::${sessionKey}`;
}

function isCacheableMessage(
  message: Pick<UiMessage, "role"> | Pick<CachedMessage, "role">,
): boolean {
  return (
    message.role === "user" ||
    message.role === "assistant" ||
    message.role === "tool"
  );
}

function isStoredCachedMessage(value: unknown): value is CachedMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.role === "string" &&
    typeof candidate.text === "string"
  );
}

function sanitizeCachedMessages(messages: unknown[]): CachedMessage[] {
  return messages
    .filter(isStoredCachedMessage)
    .filter(isCacheableMessage)
    .map(message => ({ ...message, attribution: normalizeMessageAttribution(message.attribution), sentLocally: message.sentLocally === true ? true as const : undefined }))
    .filter((message) => !shouldHideMessage(message));
}

function toSlim(msg: UiMessage): CachedMessage {
  const slim: CachedMessage = {
    id: msg.id,
    role: msg.role,
    text: msg.text,
  };
  if (msg.attribution) slim.attribution = normalizeMessageAttribution(msg.attribution);
  if (msg.sentLocally) slim.sentLocally = true;
  if (msg.sendUncertain) slim.sendUncertain = true;
  if (msg.historyMessageId) slim.historyMessageId = msg.historyMessageId;
  if (msg.idempotencyKey) slim.idempotencyKey = msg.idempotencyKey;
  if (msg.timestampMs) slim.timestampMs = msg.timestampMs;
  if (msg.imageUris?.length) slim.imageUris = msg.imageUris;
  if (msg.imageMetas?.length) slim.imageMetas = msg.imageMetas;
  if (msg.fileAttachments?.length) slim.fileAttachments = msg.fileAttachments;
  if (msg.modelLabel) slim.modelLabel = msg.modelLabel;
  if (msg.usage) slim.usage = msg.usage;
  if (msg.toolName) slim.toolName = msg.toolName;
  if (msg.toolStatus) slim.toolStatus = msg.toolStatus;
  if (msg.toolSummary) slim.toolSummary = msg.toolSummary;
  if (msg.toolArgs) slim.toolArgs = msg.toolArgs;
  if (msg.toolDetail) slim.toolDetail = msg.toolDetail;
  if (typeof msg.toolDurationMs === "number")
    slim.toolDurationMs = msg.toolDurationMs;
  if (typeof msg.toolStartedAt === "number")
    slim.toolStartedAt = msg.toolStartedAt;
  if (typeof msg.toolFinishedAt === "number")
    slim.toolFinishedAt = msg.toolFinishedAt;
  return slim;
}

function buildPreview(message: CachedMessage | undefined): string | undefined {
  if (!message) return undefined;
  if (message.role === "tool")
    return message.toolSummary || message.toolName || undefined;
  const sanitized = sanitizeSilentPreviewText(message.text);
  return sanitized ? sanitized.slice(0, 160) : undefined;
}

function buildMetaFromMessages(
  meta: CachedSessionMeta,
  messages: CachedMessage[],
): CachedSessionMeta {
  const timestamps = messages
    .map((message) => message.timestampMs)
    .filter((value): value is number => typeof value === "number" && value > 0);

  return {
    ...meta,
    messageCount: messages.length,
    firstMessageMs: timestamps.length > 0 ? Math.min(...timestamps) : undefined,
    lastMessageMs: timestamps.length > 0 ? Math.max(...timestamps) : undefined,
    lastMessagePreview: buildPreview(messages[messages.length - 1]),
    lastModelLabel: messages[messages.length - 1]?.modelLabel,
  };
}

function generationSortValue(meta: CachedSessionMeta): number {
  return meta.firstMessageMs ?? meta.lastMessageMs ?? meta.updatedAt;
}

function chunkStorageKey(
  storageKey: string,
  chunkIndex: number,
  revision?: string,
): string {
  if (revision) {
    return `${storageKey}::rev:${revision}::chunk:${chunkIndex}`;
  }
  return `${storageKey}::chunk:${chunkIndex}`;
}

function isStoredChunkManifest(value: unknown): value is StoredChunkManifest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.version === "number" &&
    typeof candidate.chunkCount === "number" &&
    typeof candidate.messageCount === "number"
  );
}

function splitMessagesIntoChunks(messages: CachedMessage[]): CachedMessage[][] {
  const chunks: CachedMessage[][] = [];
  for (let index = 0; index < messages.length; index += CHUNK_SIZE) {
    chunks.push(messages.slice(index, index + CHUNK_SIZE));
  }
  return chunks;
}

function areSessionMetasEqual(
  a: CachedSessionMeta,
  b: CachedSessionMeta,
): boolean {
  return (
    a.storageKey === b.storageKey &&
    a.gatewayConfigId === b.gatewayConfigId &&
    a.agentId === b.agentId &&
    a.agentName === b.agentName &&
    a.agentEmoji === b.agentEmoji &&
    a.sessionKey === b.sessionKey &&
    a.sessionId === b.sessionId &&
    a.sessionLabel === b.sessionLabel &&
    a.messageCount === b.messageCount &&
    a.firstMessageMs === b.firstMessageMs &&
    a.lastMessageMs === b.lastMessageMs &&
    a.lastMessagePreview === b.lastMessagePreview &&
    a.lastModelLabel === b.lastModelLabel &&
    a.updatedAt === b.updatedAt
  );
}

async function readIndex(): Promise<CachedSessionMeta[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is CachedSessionMeta => !!item && typeof item === "object",
      )
      .map((item) => ({
        ...item,
        sessionId: normalizeSessionId((item as CachedSessionMeta).sessionId),
      }));
  } catch {
    return [];
  }
}

async function writeIndex(index: CachedSessionMeta[]): Promise<void> {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

let indexAccessQueue: Promise<void> = Promise.resolve();

async function runWithIndexLock<T>(task: () => Promise<T>): Promise<T> {
  const previous = indexAccessQueue.catch(() => {});
  let release!: () => void;
  indexAccessQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}

async function sanitizeIndexedSession(meta: CachedSessionMeta): Promise<{
  meta: CachedSessionMeta | null;
  messages: CachedMessage[];
  changed: boolean;
}> {
  try {
    const stored = await readGenerationMessages(meta.storageKey);
    if (stored.missing) {
      return { meta: null, messages: [], changed: true };
    }
    const messages = stored.messages;
    if (messages.length === 0) {
      await removeGenerationStorage(meta.storageKey).catch(() => {});
      return { meta: null, messages: [], changed: true };
    }
    if (stored.changed) {
      await writeGenerationMessages(
        meta.storageKey,
        messages,
        stored.layout,
      ).catch(() => {});
    }

    const nextMeta = buildMetaFromMessages(meta, messages);
    return {
      meta: nextMeta,
      messages,
      changed: stored.changed || !areSessionMetasEqual(meta, nextMeta),
    };
  } catch {
    await removeGenerationStorage(meta.storageKey).catch(() => {});
    return { meta: null, messages: [], changed: true };
  }
}

async function getSanitizedIndexUnsafe(): Promise<{
  index: CachedSessionMeta[];
  messagesByKey: Map<string, CachedMessage[]>;
}> {
  const index = await readIndex();
  const normalized = await Promise.all(
    index.map((meta) => sanitizeIndexedSession(meta)),
  );
  const nextIndex = normalized
    .map((item) => item.meta)
    .filter((item): item is CachedSessionMeta => item !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  if (
    normalized.some((item) => item.changed) ||
    nextIndex.length !== index.length
  ) {
    await writeIndex(nextIndex);
  }

  return {
    index: nextIndex,
    messagesByKey: new Map(
      normalized
        .filter(
          (
            item,
          ): item is {
            meta: CachedSessionMeta;
            messages: CachedMessage[];
            changed: boolean;
          } => item.meta !== null,
        )
        .map((item) => [item.meta.storageKey, item.messages]),
    ),
  };
}

async function removeIndexedSessionUnsafe(storageKey: string): Promise<void> {
  await removeGenerationStorage(storageKey);
  const index = await readIndex();
  const next = index.filter((item) => item.storageKey !== storageKey);
  await writeIndex(next);
}

async function readGenerationMessages(storageKey: string): Promise<{
  messages: CachedMessage[];
  changed: boolean;
  missing: boolean;
  layout: StoredGenerationLayout;
}> {
  const raw = await AsyncStorage.getItem(storageKey);
  if (!raw) {
    return {
      messages: [],
      changed: false,
      missing: true,
      layout: { chunkCount: 0 },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      messages: [],
      changed: true,
      missing: false,
      layout: { chunkCount: 0 },
    };
  }

  if (Array.isArray(parsed)) {
    const messages = sanitizeCachedMessages(parsed);
    return {
      messages,
      changed: true,
      missing: false,
      layout: { chunkCount: 0 },
    };
  }

  if (!isStoredChunkManifest(parsed)) {
    return {
      messages: [],
      changed: true,
      missing: false,
      layout: { chunkCount: 0 },
    };
  }

  const manifest = parsed;
  const revision =
    manifest.version >= 3 && typeof manifest.revision === "string"
      ? manifest.revision
      : undefined;
  const messages: CachedMessage[] = [];
  let changed = false;
  for (let chunkIndex = 0; chunkIndex < manifest.chunkCount; chunkIndex += 1) {
    const rawChunk = await AsyncStorage.getItem(
      chunkStorageKey(storageKey, chunkIndex, revision),
    );
    if (!rawChunk) {
      changed = true;
      continue;
    }
    try {
      const parsedChunk = JSON.parse(rawChunk);
      if (!Array.isArray(parsedChunk)) {
        changed = true;
        continue;
      }
      const sanitizedChunk = sanitizeCachedMessages(parsedChunk);
      if (sanitizedChunk.length !== parsedChunk.length) {
        changed = true;
      }
      messages.push(...sanitizedChunk);
    } catch {
      changed = true;
    }
  }

  if (messages.length !== manifest.messageCount) {
    changed = true;
  }

  return {
    messages,
    changed,
    missing: false,
    layout: {
      chunkCount: manifest.chunkCount,
      revision,
      version: manifest.version,
    },
  };
}

function createChunkRevision(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function writeGenerationMessages(
  storageKey: string,
  messages: CachedMessage[],
  previousLayout?: StoredGenerationLayout,
): Promise<void> {
  const chunks = splitMessagesIntoChunks(messages);
  const revision = createChunkRevision();
  const manifest: StoredChunkManifest = {
    version: CHUNKED_STORAGE_VERSION,
    chunkCount: chunks.length,
    messageCount: messages.length,
    revision,
  };

  await AsyncStorage.multiSet(
    chunks.map((chunk, chunkIndex) => [
      chunkStorageKey(storageKey, chunkIndex, revision),
      JSON.stringify(chunk),
    ]),
  );
  await AsyncStorage.setItem(storageKey, JSON.stringify(manifest));

  if (!previousLayout) return;

  const staleKeys: string[] = [];
  for (
    let chunkIndex = 0;
    chunkIndex < previousLayout.chunkCount;
    chunkIndex += 1
  ) {
    staleKeys.push(
      chunkStorageKey(storageKey, chunkIndex, previousLayout.revision),
    );
  }
  if (staleKeys.length === 0) return;

  await AsyncStorage.multiRemove(staleKeys).catch(async () => {
    for (const key of staleKeys) {
      await AsyncStorage.removeItem(key).catch(() => {});
    }
  });
}

async function removeGenerationStorage(storageKey: string): Promise<void> {
  const raw = await AsyncStorage.getItem(storageKey).catch(() => null);
  let layout: StoredGenerationLayout = { chunkCount: 0 };
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (isStoredChunkManifest(parsed)) {
        layout = {
          chunkCount: parsed.chunkCount,
          revision:
            parsed.version >= 3 && typeof parsed.revision === "string"
              ? parsed.revision
              : undefined,
          version: parsed.version,
        };
      }
    } catch {
      // best-effort cleanup only
    }
  }

  const keys = [storageKey];
  for (let chunkIndex = 0; chunkIndex < layout.chunkCount; chunkIndex += 1) {
    keys.push(chunkStorageKey(storageKey, chunkIndex, layout.revision));
  }

  await AsyncStorage.multiRemove(keys).catch(async () => {
    for (const key of keys) {
      await AsyncStorage.removeItem(key).catch(() => {});
    }
  });
}

async function removeStorageKeysStrict(keys: ReadonlyArray<string>): Promise<void> {
  if (keys.length === 0) return;
  try {
    await AsyncStorage.multiRemove([...keys]);
    return;
  } catch {
    let removalFailed = false;
    for (const key of keys) {
      try {
        await AsyncStorage.removeItem(key);
      } catch {
        removalFailed = true;
      }
    }
    if (removalFailed) {
      throw new Error("Failed to remove chat cache entries.");
    }
  }
}

function findMessageIndexById(messages: CachedMessage[], id: string): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.id === id) return index;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const ChatCacheService = {
  /**
   * Save (or update) cached messages for a session.
   * Also updates the session index.
   */
  async saveMessages(
    params: {
      gatewayConfigId: string;
      agentId: string;
      agentName?: string;
      agentEmoji?: string;
      sessionKey: string;
      sessionId?: string;
      sessionLabel?: string;
    },
    messages: UiMessage[],
  ): Promise<void> {
    try {
      await runWithIndexLock(async () => {
        const stableSessionId = normalizeSessionId(params.sessionId);
        const storageKey = makeStorageKey(
          params.gatewayConfigId,
          params.agentId,
          params.sessionKey,
          stableSessionId,
        );
        // Only cache user + assistant + tool messages (skip system noise)
        const cacheable = messages
          .filter(isCacheableMessage)
          .map(message => ({ ...message, attribution: normalizeMessageAttribution(message.attribution), sentLocally: message.sentLocally === true ? true as const : undefined }))
          .filter((message) => !shouldHideMessage(message))
          .map(toSlim);

        if (cacheable.length === 0) return;

        const existing = await readGenerationMessages(storageKey).catch(() => ({
          messages: [] as CachedMessage[],
          changed: false,
          missing: true,
          layout: { chunkCount: 0 } as StoredGenerationLayout,
        }));
        await writeGenerationMessages(storageKey, cacheable, existing.layout);

        const index = await readIndex();
        const existingIndex = index.findIndex(
          (item) => item.storageKey === storageKey,
        );
        const meta = buildMetaFromMessages(
          {
            storageKey,
            gatewayConfigId: params.gatewayConfigId,
            agentId: params.agentId,
            agentName: params.agentName,
            agentEmoji: params.agentEmoji,
            sessionKey: params.sessionKey,
            sessionId: stableSessionId,
            sessionLabel: params.sessionLabel,
            updatedAt: Date.now(),
            messageCount: 0,
          },
          cacheable,
        );

        if (existingIndex >= 0) {
          index[existingIndex] = meta;
        } else {
          index.unshift(meta);
        }

        index.sort((a, b) => b.updatedAt - a.updatedAt);
        if (index.length > MAX_CACHED_SESSIONS) {
          const removed = index.splice(MAX_CACHED_SESSIONS);
          for (const item of removed) {
            await removeGenerationStorage(item.storageKey).catch(() => {});
          }
        }

        await writeIndex(index);
      });
    } catch {
      // best-effort
    }
  },

  /** Retrieve cached messages for a specific session. */
  async getMessages(
    gatewayConfigId: string,
    agentId: string,
    sessionKey: string,
    sessionId?: string,
  ): Promise<CachedMessage[]> {
    try {
      return runWithIndexLock(async () => {
        const { index, messagesByKey } = await getSanitizedIndexUnsafe();
        const stableSessionId = normalizeSessionId(sessionId);

        if (stableSessionId) {
          const storageKey = makeStorageKey(
            gatewayConfigId,
            agentId,
            sessionKey,
            stableSessionId,
          );
          return messagesByKey.get(storageKey) ?? [];
        }

        const latest = index.find(
          (item) =>
            item.gatewayConfigId === gatewayConfigId &&
            item.agentId === agentId &&
            item.sessionKey === sessionKey,
        );
        if (!latest) return [];
        return messagesByKey.get(latest.storageKey) ?? [];
      });
    } catch {
      return [];
    }
  },

  /** Retrieve cached messages directly by storage key. */
  async getMessagesByStorageKey(storageKey: string): Promise<CachedMessage[]> {
    try {
      return runWithIndexLock(async () => {
        const { messagesByKey } = await getSanitizedIndexUnsafe();
        return messagesByKey.get(storageKey) ?? [];
      });
    } catch {
      return [];
    }
  },

  /** List all cached session metadata, sorted by updatedAt desc. */
  async listSessions(): Promise<CachedSessionMeta[]> {
    return runWithIndexLock(async () => {
      const { index } = await getSanitizedIndexUnsafe();
      return index;
    });
  },

  /** List cached generations for one logical session, ordered oldest → newest. */
  async listSessionGenerations(
    gatewayConfigId: string,
    agentId: string,
    sessionKey: string,
  ): Promise<CachedSessionMeta[]> {
    return runWithIndexLock(async () => {
      const { index } = await getSanitizedIndexUnsafe();
      return index
        .filter(
          (item) =>
            item.gatewayConfigId === gatewayConfigId &&
            item.agentId === agentId &&
            item.sessionKey === sessionKey,
        )
        .sort(
          (a, b) =>
            generationSortValue(a) - generationSortValue(b) ||
            a.updatedAt - b.updatedAt,
        );
    });
  },

  /** List cached snapshots for one logical session, ordered oldest → newest. */
  async getSessionLineage(
    gatewayConfigId: string,
    agentId: string,
    sessionKey: string,
  ): Promise<CachedSessionSnapshot[]> {
    try {
      return runWithIndexLock(async () => {
        const { index, messagesByKey } = await getSanitizedIndexUnsafe();
        const generations = index
          .filter(
            (item) =>
              item.gatewayConfigId === gatewayConfigId &&
              item.agentId === agentId &&
              item.sessionKey === sessionKey,
          )
          .sort(
            (a, b) =>
              generationSortValue(a) - generationSortValue(b) ||
              a.updatedAt - b.updatedAt,
          );
        return generations.map((meta) => ({
          meta,
          messages: messagesByKey.get(meta.storageKey) ?? [],
        }));
      });
    } catch {
      return [];
    }
  },

  /** Retrieve metadata for a specific cached session. */
  async getSessionMeta(
    gatewayConfigId: string,
    agentId: string,
    sessionKey: string,
    sessionId?: string,
  ): Promise<CachedSessionMeta | null> {
    return runWithIndexLock(async () => {
      const { index } = await getSanitizedIndexUnsafe();
      const stableSessionId = normalizeSessionId(sessionId);
      if (stableSessionId) {
        const storageKey = makeStorageKey(
          gatewayConfigId,
          agentId,
          sessionKey,
          stableSessionId,
        );
        return index.find((item) => item.storageKey === storageKey) ?? null;
      }
      return (
        index.find(
          (item) =>
            item.gatewayConfigId === gatewayConfigId &&
            item.agentId === agentId &&
            item.sessionKey === sessionKey,
        ) ?? null
      );
    });
  },

  /** Delete a single cached session (messages + index entry). */
  async deleteSession(storageKey: string): Promise<void> {
    try {
      await runWithIndexLock(async () => {
        await removeIndexedSessionUnsafe(storageKey);
      });
    } catch {
      // best-effort
    }
  },

  /** Delete cached messages for one session using gateway/agent/session coordinates. */
  async deleteMessages(
    gatewayConfigId: string,
    agentId: string,
    sessionKey: string,
    sessionId?: string,
  ): Promise<void> {
    await runWithIndexLock(async () => {
      const stableSessionId = normalizeSessionId(sessionId);
      if (stableSessionId) {
        await removeIndexedSessionUnsafe(
          makeStorageKey(gatewayConfigId, agentId, sessionKey, stableSessionId),
        );
        return;
      }

      const { index } = await getSanitizedIndexUnsafe();
      const matched = index.filter(
        (item) =>
          item.gatewayConfigId === gatewayConfigId &&
          item.agentId === agentId &&
          item.sessionKey === sessionKey,
      );
      for (const item of matched) {
        await removeIndexedSessionUnsafe(item.storageKey);
      }
    });
  },

  /**
   * Delete every cached generation owned by one connection while preserving
   * other connections. Scanning storage also removes orphaned revision chunks
   * that are no longer reachable from the cache index.
   */
  async clearConnection(gatewayConfigId: string): Promise<void> {
    const normalizedConnectionId = gatewayConfigId.trim();
    if (!normalizedConnectionId) {
      throw new Error("Connection id is required.");
    }
    await runWithIndexLock(async () => {
      const index = await readIndex();
      const storagePrefix = `${MSG_PREFIX}${normalizedConnectionId}::`;
      const allKeys = await AsyncStorage.getAllKeys();
      const connectionKeys = allKeys.filter((key) => key.startsWith(storagePrefix));

      // Remove message payloads first. If the following index commit fails,
      // normal index sanitation observes the missing manifests and heals it.
      await removeStorageKeysStrict(connectionKeys);
      await writeIndex(index.filter((item) => item.gatewayConfigId !== normalizedConnectionId));
    });
  },

  /** Clear all chat cache. */
  async clearAll(): Promise<void> {
    try {
      await runWithIndexLock(async () => {
        const index = await readIndex();
        for (const item of index) {
          await removeGenerationStorage(item.storageKey).catch(() => {});
        }
        await AsyncStorage.removeItem(INDEX_KEY).catch(() => {});
      });
    } catch {
      // best-effort
    }
  },

  /**
   * Search cached messages across all sessions.
   * Returns matching sessions with their matching messages.
   */
  async search(
    query: string,
    filter?: ChatCacheSearchFilter,
  ): Promise<Array<{ meta: CachedSessionMeta; matches: CachedMessage[] }>> {
    return runWithIndexLock(async () => {
      const { index, messagesByKey } = await getSanitizedIndexUnsafe();
      const filtered = index.filter((item) => {
        if (filter?.agentId && item.agentId !== filter.agentId) return false;
        if (
          filter?.gatewayConfigId &&
          item.gatewayConfigId !== filter.gatewayConfigId
        )
          return false;
        return true;
      });

      const lowerQuery = query.toLowerCase();
      const results: Array<{
        meta: CachedSessionMeta;
        matches: CachedMessage[];
      }> = [];

      for (const meta of filtered) {
        const messages = messagesByKey.get(meta.storageKey) ?? [];
        const matches = messages.filter(
          (m) =>
            m.text.toLowerCase().includes(lowerQuery) ||
            (m.toolName && m.toolName.toLowerCase().includes(lowerQuery)) ||
            (m.toolSummary && m.toolSummary.toLowerCase().includes(lowerQuery)),
        );
        if (matches.length > 0) {
          results.push({ meta, matches });
        }
      }

      return results;
    });
  },

  /**
   * Read one older timeline page for a logical session across all cached generations.
   * Returned messages are ordered oldest -> newest and end strictly before beforeMessageId when provided.
   */
  async getTimelinePage(
    gatewayConfigId: string,
    agentId: string,
    sessionKey: string,
    options?: {
      beforeMessageId?: string;
      pageSize?: number;
    },
  ): Promise<{ messages: CachedMessage[]; hasMore: boolean }> {
    const pageSize = Math.max(1, options?.pageSize ?? 50);
    return runWithIndexLock(async () => {
      const { index, messagesByKey } = await getSanitizedIndexUnsafe();
      const timeline = index
        .filter(
          (item) =>
            item.gatewayConfigId === gatewayConfigId &&
            item.agentId === agentId &&
            item.sessionKey === sessionKey,
        )
        .sort(
          (a, b) =>
            generationSortValue(a) - generationSortValue(b) ||
            a.updatedAt - b.updatedAt,
        )
        .flatMap((meta) => messagesByKey.get(meta.storageKey) ?? []);
      if (timeline.length === 0) {
        return { messages: [], hasMore: false };
      }

      let endIndex = timeline.length;
      if (options?.beforeMessageId) {
        const boundaryIndex = findMessageIndexById(
          timeline,
          options.beforeMessageId,
        );
        if (boundaryIndex >= 0) {
          endIndex = boundaryIndex;
        }
      }

      if (endIndex <= 0) {
        return { messages: [], hasMore: false };
      }

      const startIndex = Math.max(0, endIndex - pageSize);
      return {
        messages: timeline.slice(startIndex, endIndex),
        hasMore: startIndex > 0,
      };
    });
  },
};
