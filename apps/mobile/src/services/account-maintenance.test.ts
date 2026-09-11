jest.mock('./chat-cache', () => ({
  ChatCacheService: { clearAll: jest.fn(async () => undefined) },
}));
jest.mock('./message-favorites', () => ({
  MessageFavoritesService: { clearAll: jest.fn(async () => undefined) },
}));
jest.mock('./storage', () => ({
  StorageService: {
    clearLegacyGatewayConfig: jest.fn(async () => undefined),
    clearIdentity: jest.fn(async () => undefined),
    clearLifetimeUpgradeAnnouncementShown: jest.fn(async () => undefined),
  },
}));

import { clearAccountCache, resetAccountDevice } from './account-maintenance';
import { ChatCacheService } from './chat-cache';
import { MessageFavoritesService } from './message-favorites';
import { StorageService } from './storage';

describe('account maintenance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('clears local conversations, favorites, and announcement state without credentials', async () => {
    await clearAccountCache();

    expect(ChatCacheService.clearAll).toHaveBeenCalledTimes(1);
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
    expect(MessageFavoritesService.clearAll).toHaveBeenCalledTimes(1);
    expect(StorageService.clearIdentity).toHaveBeenCalledTimes(1);
    expect(StorageService.clearLegacyGatewayConfig).toHaveBeenCalledTimes(1);
  });
});
