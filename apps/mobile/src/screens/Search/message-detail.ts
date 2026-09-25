import { normalizeMessageAttribution } from '../../chat/messageAttribution';
import type { MessageAttribution } from '@clawket/agent-protocol';
import type {
  CachedMessage,
  CachedSessionMeta,
} from '../../services/chat-cache';
import type { FavoritedMessage } from '../../services/message-favorites';

export type SearchMessageDetail = Readonly<{
  connectionId: string;
  agentId: string;
  sessionKey: string;
  messageId: string;
  title: string;
  text: string;
  attribution?: MessageAttribution;
  timestampMs: number | null;
}>;

export interface MessageDetailCachePort {
  listSessions(): Promise<CachedSessionMeta[]>;
  getMessagesByStorageKey(storageKey: string): Promise<CachedMessage[]>;
}

export interface MessageDetailFavoritesPort {
  listFavorites(): Promise<FavoritedMessage[]>;
}

export type MessageDetailCoordinates = Readonly<{
  connectionId: string;
  sessionKey: string;
  messageId: string;
}>;

function detailFromFavorite(
  favorite: FavoritedMessage,
): SearchMessageDetail {
  return {
    connectionId: favorite.gatewayConfigId,
    agentId: favorite.agentId,
    sessionKey: favorite.sessionKey,
    messageId: favorite.messageId,
    title: favorite.sessionLabel?.trim() || favorite.agentName?.trim() || favorite.agentId,
    ...(favorite.attribution ? { attribution: normalizeMessageAttribution(favorite.attribution) } : {}),
    text: favorite.text || favorite.toolSummary || favorite.toolName || '',
    timestampMs: favorite.timestampMs ?? favorite.favoritedAt,
  };
}

export async function loadSearchMessageDetail(
  coordinates: MessageDetailCoordinates,
  cache: MessageDetailCachePort,
  favorites: MessageDetailFavoritesPort,
): Promise<SearchMessageDetail | null> {
  const sessions = (await cache.listSessions())
    .filter((session) => (
      session.gatewayConfigId === coordinates.connectionId
      && session.sessionKey === coordinates.sessionKey
    ))
    .sort((left, right) => right.updatedAt - left.updatedAt);

  for (const session of sessions) {
    const messages = await cache.getMessagesByStorageKey(session.storageKey);
    const message = messages.find((candidate) => candidate.id === coordinates.messageId);
    if (!message) continue;
    return {
      connectionId: session.gatewayConfigId,
      agentId: session.agentId,
      sessionKey: session.sessionKey,
      messageId: message.id,
      title: session.sessionLabel?.trim() || session.agentName?.trim() || session.agentId,
      ...(message.attribution ? { attribution: normalizeMessageAttribution(message.attribution) } : {}),
      text: message.text || message.toolSummary || message.toolName || '',
      timestampMs: message.timestampMs ?? session.lastMessageMs ?? session.updatedAt,
    };
  }

  const storedFavorites = await favorites.listFavorites();
  const favorite = storedFavorites.find((candidate) => (
    candidate.gatewayConfigId === coordinates.connectionId
    && candidate.sessionKey === coordinates.sessionKey
    && candidate.messageId === coordinates.messageId
  ));
  return favorite ? detailFromFavorite(favorite) : null;
}
