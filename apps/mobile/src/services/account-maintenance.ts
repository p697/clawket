import { ChatCacheService } from './chat-cache';
import { MessageFavoritesService } from './message-favorites';
import { StorageService } from './storage';
import { ThreadActivityCacheService } from './thread-activity-cache';

export async function clearAccountCache(): Promise<void> {
  await Promise.all([
    ChatCacheService.clearAll(),
    ThreadActivityCacheService.clearAll(),
    MessageFavoritesService.clearAll(),
    StorageService.clearLifetimeUpgradeAnnouncementShown(),
  ]);
}

/**
 * Fresh-install reset. iOS Keychain outlives the deleted bundle, so without
 * this a reinstalled app boots into its old connections with an empty roster
 * cache and a locked add action. Connections, their credentials and the local
 * preferences are forgotten; the device identity and the Pro entitlement /
 * grace record beside it are kept on purpose (docs/3.0/06 §宽限期: granted
 * once per device, never reissued by a reinstall).
 */
export async function resetForFreshInstall(input: Readonly<{
  removeAllConnections: () => Promise<number>;
}>): Promise<void> {
  await input.removeAllConnections();
  await Promise.all([
    StorageService.clearLegacyGatewayConfig(),
    StorageService.clearLocalPreferences(),
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
    ThreadActivityCacheService.clearAll(),
    MessageFavoritesService.clearAll(),
    StorageService.clearIdentity(),
    StorageService.clearLegacyGatewayConfig(),
  ]);
}
