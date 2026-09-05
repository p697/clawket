import { ChatCacheService } from './chat-cache';
import { MessageFavoritesService } from './message-favorites';
import { StorageService } from './storage';

export async function clearAccountCache(): Promise<void> {
  await Promise.all([
    ChatCacheService.clearAll(),
    MessageFavoritesService.clearAll(),
    StorageService.clearLifetimeUpgradeAnnouncementShown(),
  ]);
}

export async function resetAccountDevice(input: Readonly<{
  connectionIds: ReadonlyArray<string>;
  removeConnection: (connectionId: string) => Promise<boolean>;
}>): Promise<void> {
  for (const connectionId of input.connectionIds) {
    await input.removeConnection(connectionId);
  }
  await Promise.all([
    ChatCacheService.clearAll(),
    MessageFavoritesService.clearAll(),
    StorageService.clearIdentity(),
    StorageService.clearLegacyGatewayConfig(),
  ]);
}
