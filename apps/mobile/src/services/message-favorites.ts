import AsyncStorage from '@react-native-async-storage/async-storage';
import type { UiMessage } from '../types/chat';
import { buildFavoriteMessageKey } from '../utils/message-favorites';

export type FavoritedMessage = {
  favoriteKey: string;
  favoritedAt: number;
  gatewayConfigId: string;
  agentId: string;
  agentName?: string;
  agentEmoji?: string;
  sessionKey: string;
  sessionLabel?: string;
  messageId: string;
  role: UiMessage['role'];
  attribution?: UiMessage['attribution'];
  sentLocally?: true;
  text: string;
  timestampMs?: number;
  modelLabel?: string;
  toolName?: string;
  toolStatus?: UiMessage['toolStatus'];
  toolSummary?: string;
  toolArgs?: string;
  toolDetail?: string;
  toolDurationMs?: number;
  toolStartedAt?: number;
  toolFinishedAt?: number;
};

type ToggleFavoriteParams = {
  gatewayConfigId: string;
  agentId: string;
  agentName?: string;
  agentEmoji?: string;
  sessionKey: string;
  sessionLabel?: string;
  message: UiMessage;
};

const INDEX_KEY = 'clawket.messageFavorites.index.v1';
const ITEM_PREFIX = 'clawket.messageFavorites.item.';

function itemStorageKey(favoriteKey: string): string {
  return `${ITEM_PREFIX}${favoriteKey}`;
}

function isFavoritedMessage(value: unknown): value is FavoritedMessage {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.favoriteKey === 'string' &&
    typeof record.favoritedAt === 'number' &&
    typeof record.gatewayConfigId === 'string' &&
    typeof record.agentId === 'string' &&
    typeof record.sessionKey === 'string' &&
    typeof record.messageId === 'string' &&
    typeof record.role === 'string' &&
    typeof record.text === 'string'
  );
}

async function readIndex(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

async function writeIndex(keys: string[]): Promise<void> {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(keys));
}

let queue: Promise<void> = Promise.resolve();

async function withLock<T>(task: () => Promise<T>): Promise<T> {
  const previous = queue.catch(() => {});
  let release!: () => void;
  queue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}

function toFavoriteRecord(params: ToggleFavoriteParams): FavoritedMessage {
  const favoriteKey = buildFavoriteMessageKey({
    gatewayConfigId: params.gatewayConfigId,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    message: params.message,
  });

  return {
    favoriteKey,
    favoritedAt: Date.now(),
    gatewayConfigId: params.gatewayConfigId,
    agentId: params.agentId,
    agentName: params.agentName,
    agentEmoji: params.agentEmoji,
    sessionKey: params.sessionKey,
    sessionLabel: params.sessionLabel,
    messageId: params.message.id,
    role: params.message.role,
    ...(params.message.attribution ? { attribution: params.message.attribution } : {}),
    ...(params.message.sentLocally ? { sentLocally: true as const } : {}),
    text: params.message.text,
    timestampMs: params.message.timestampMs,
    modelLabel: params.message.modelLabel,
    toolName: params.message.toolName,
    toolStatus: params.message.toolStatus,
    toolSummary: params.message.toolSummary,
    toolArgs: params.message.toolArgs,
    toolDetail: params.message.toolDetail,
    toolDurationMs: params.message.toolDurationMs,
    toolStartedAt: params.message.toolStartedAt,
    toolFinishedAt: params.message.toolFinishedAt,
  };
}

export const MessageFavoritesService = {
  buildFavoriteKey(params: ToggleFavoriteParams): string {
    return buildFavoriteMessageKey({
      gatewayConfigId: params.gatewayConfigId,
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      message: params.message,
    });
  },

  async listFavorites(): Promise<FavoritedMessage[]> {
    return withLock(async () => {
      const index = await readIndex();
      if (index.length === 0) return [];
      const entries = await AsyncStorage.multiGet(
        index.map((favoriteKey) => itemStorageKey(favoriteKey)),
      );
      const favorites: FavoritedMessage[] = [];
      const sanitizedIndex: string[] = [];

      for (const [, raw] of entries) {
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          if (!isFavoritedMessage(parsed)) continue;
          favorites.push(parsed);
          sanitizedIndex.push(parsed.favoriteKey);
        } catch {
          // Skip corrupted items.
        }
      }

      favorites.sort((a, b) => b.favoritedAt - a.favoritedAt);
      if (sanitizedIndex.length !== index.length) {
        await writeIndex(sanitizedIndex);
      }
      return favorites;
    });
  },

  async getFavoriteKeySet(): Promise<Set<string>> {
    const favorites = await this.listFavorites();
    return new Set(favorites.map((item) => item.favoriteKey));
  },

  async getFavoriteByKey(favoriteKey: string): Promise<FavoritedMessage | null> {
    return withLock(async () => {
      try {
        const raw = await AsyncStorage.getItem(itemStorageKey(favoriteKey));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return isFavoritedMessage(parsed) ? parsed : null;
      } catch {
        return null;
      }
    });
  },

  async toggleFavorite(
    params: ToggleFavoriteParams,
  ): Promise<{ favoriteKey: string; favorited: boolean }> {
    return withLock(async () => {
      const record = toFavoriteRecord(params);
      const storageKey = itemStorageKey(record.favoriteKey);
      const index = await readIndex();
      const exists = index.includes(record.favoriteKey);

      if (exists) {
        await AsyncStorage.removeItem(storageKey);
        await writeIndex(index.filter((item) => item !== record.favoriteKey));
        return { favoriteKey: record.favoriteKey, favorited: false };
      }

      await AsyncStorage.setItem(storageKey, JSON.stringify(record));
      await writeIndex([record.favoriteKey, ...index.filter((item) => item !== record.favoriteKey)]);
      return { favoriteKey: record.favoriteKey, favorited: true };
    });
  },

  async clearAll(): Promise<void> {
    await withLock(async () => {
      const index = await readIndex();
      if (index.length > 0) {
        await AsyncStorage.multiRemove(index.map((favoriteKey) => itemStorageKey(favoriteKey)));
      }
      await AsyncStorage.removeItem(INDEX_KEY);
    });
  },
};
