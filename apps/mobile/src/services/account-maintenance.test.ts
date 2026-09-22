jest.mock('./chat-cache', () => ({
  ChatCacheService: { clearAll: jest.fn(async () => undefined) },
}));
jest.mock('./incoming-share', () => ({
  IncomingShareStore: { clearConsumedAfter: jest.fn(async (clear: () => Promise<void>) => clear()) },
}));
jest.mock('./message-favorites', () => ({
  MessageFavoritesService: { clearAll: jest.fn(async () => undefined) },
}));
jest.mock('./thread-activity-cache', () => ({
  ThreadActivityCacheService: { clearAll: jest.fn(async () => undefined) },
}));
jest.mock('./storage', () => ({
  StorageService: {
    clearLegacyGatewayConfig: jest.fn(async () => undefined),
    clearIdentity: jest.fn(async () => undefined),
    clearLifetimeUpgradeAnnouncementShown: jest.fn(async () => undefined),
    clearLocalPreferences: jest.fn(async () => undefined),
  },
}));

import { clearAccountCache, resetAccountDevice, resetForFreshInstall } from './account-maintenance';
import { ChatCacheService } from './chat-cache';
import { MessageFavoritesService } from './message-favorites';
import { StorageService } from './storage';
import { ThreadActivityCacheService } from './thread-activity-cache';

describe('account maintenance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('clears local conversations, favorites, and announcement state without credentials', async () => {
    await clearAccountCache();

    expect(ChatCacheService.clearAll).toHaveBeenCalledTimes(1);
    expect(ThreadActivityCacheService.clearAll).toHaveBeenCalledTimes(1);
    expect(MessageFavoritesService.clearAll).toHaveBeenCalledTimes(1);
    expect(StorageService.clearLifetimeUpgradeAnnouncementShown).toHaveBeenCalledTimes(1);
    expect(StorageService.clearIdentity).not.toHaveBeenCalled();
    expect(StorageService.clearLegacyGatewayConfig).not.toHaveBeenCalled();
  });

  it('removes every registry connection and forgets credentials and identity', async () => {
    const order: string[] = [];
    await resetAccountDevice({
      connectionIds: ['one', 'two'],
      removeConnection: async (connectionId) => {
        order.push(`remove:${connectionId}`);
        return true;
      },
    });

    expect(order).toEqual(['remove:one', 'remove:two']);
    expect(ChatCacheService.clearAll).toHaveBeenCalledTimes(1);
    expect(ThreadActivityCacheService.clearAll).toHaveBeenCalledTimes(1);
    expect(MessageFavoritesService.clearAll).toHaveBeenCalledTimes(1);
    expect(StorageService.clearIdentity).toHaveBeenCalledTimes(1);
    expect(StorageService.clearLegacyGatewayConfig).toHaveBeenCalledTimes(1);
  });

  it('fresh-install reset forgets connections and preferences but keeps the device identity', async () => {
    const removeAllConnections = jest.fn(async () => 2);

    await resetForFreshInstall({ removeAllConnections });

    expect(removeAllConnections).toHaveBeenCalledTimes(1);
    expect(StorageService.clearLegacyGatewayConfig).toHaveBeenCalledTimes(1);
    expect(StorageService.clearLocalPreferences).toHaveBeenCalledTimes(1);
    // The Pro grace record lives beside the identity and must survive a reinstall.
    expect(StorageService.clearIdentity).not.toHaveBeenCalled();
    expect(ChatCacheService.clearAll).not.toHaveBeenCalled();
  });

  it('fresh-install reset surfaces a failed connection wipe instead of clearing preferences over it', async () => {
    await expect(resetForFreshInstall({
      removeAllConnections: async () => { throw new Error('keychain unavailable'); },
    })).rejects.toThrow('keychain unavailable');

    expect(StorageService.clearLocalPreferences).not.toHaveBeenCalled();
  });
});
