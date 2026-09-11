import type { CachedSessionMeta } from '../../services/chat-cache';
import type { FavoritedMessage } from '../../services/message-favorites';
import { loadSearchMessageDetail } from './message-detail';
import {
  loadRecentSearches,
  rememberRecentSearch,
  type RecentSearchStorage,
} from './recent-searches';

function meta(storageKey: string, updatedAt: number): CachedSessionMeta {
  return {
    storageKey,
    gatewayConfigId: 'connection',
    agentId: 'agent',
    agentName: 'Agent',
    sessionKey: 'session',
    sessionLabel: 'Session',
    messageCount: 1,
    updatedAt,
  };
}

function favorite(): FavoritedMessage {
  return {
    favoriteKey: 'favorite',
    favoritedAt: 40,
    gatewayConfigId: 'connection',
    agentId: 'agent',
    agentName: 'Agent',
    sessionKey: 'session',
    sessionLabel: 'Session',
    messageId: 'favorite-message',
    role: 'assistant',
    text: 'Favorite copy',
  };
}

describe('Search local data helpers', () => {
  it('loads a message from the newest matching cache generation', async () => {
    const cache = {
      listSessions: jest.fn(async () => [meta('old', 10), meta('new', 20)]),
      getMessagesByStorageKey: jest.fn(async (storageKey: string) => storageKey === 'new'
        ? [{ id: 'message', role: 'assistant' as const, text: 'Newest copy', timestampMs: 30 }]
        : []),
    };
    const favorites = { listFavorites: jest.fn(async () => [favorite()]) };

    await expect(loadSearchMessageDetail(
      { connectionId: 'connection', sessionKey: 'session', messageId: 'message' },
      cache,
      favorites,
    )).resolves.toEqual({
      connectionId: 'connection',
      agentId: 'agent',
      sessionKey: 'session',
      messageId: 'message',
      title: 'Session',
      text: 'Newest copy',
      timestampMs: 30,
    });
    expect(favorites.listFavorites).not.toHaveBeenCalled();
  });

  it('falls back to a locally stored favorite when cache generations were evicted', async () => {
    const cache = {
      listSessions: jest.fn(async () => []),
      getMessagesByStorageKey: jest.fn(async () => []),
    };
    const favorites = { listFavorites: jest.fn(async () => [favorite()]) };

    await expect(loadSearchMessageDetail(
      { connectionId: 'connection', sessionKey: 'session', messageId: 'favorite-message' },
      cache,
      favorites,
    )).resolves.toMatchObject({
      messageId: 'favorite-message',
      text: 'Favorite copy',
    });
  });

  it('returns null when neither local source contains the message', async () => {
    await expect(loadSearchMessageDetail(
      { connectionId: 'connection', sessionKey: 'session', messageId: 'missing' },
      { listSessions: async () => [], getMessagesByStorageKey: async () => [] },
      { listFavorites: async () => [] },
    )).resolves.toBeNull();
  });

  it('sanitizes corrupted recent-search storage and persists newest-first uniqueness', async () => {
    let value: string | null = JSON.stringify([' Hermes ', 42, 'hermes', 'OpenClaw']);
    const storage: RecentSearchStorage = {
      getItem: jest.fn(async () => value),
      setItem: jest.fn(async (_key, next) => {
        value = next;
      }),
    };

    await expect(loadRecentSearches(storage)).resolves.toEqual(['Hermes', 'OpenClaw']);
    await expect(rememberRecentSearch(' openclaw ', storage)).resolves.toEqual([
      'openclaw',
      'Hermes',
    ]);
    expect(JSON.parse(value ?? '[]')).toEqual(['openclaw', 'Hermes']);
  });
});
