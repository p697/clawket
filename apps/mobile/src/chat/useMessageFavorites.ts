import { useCallback, useEffect, useMemo, useState } from 'react';
import { analyticsEvents } from '../services/analytics/events';
import { MessageFavoritesService } from '../services/message-favorites';
import type { UiMessage } from '../types/chat';

type Params = {
  agentEmoji?: string | null;
  agentId: string;
  agentName?: string | null;
  gatewayConfigId: string | null;
  listData: UiMessage[];
  sessionKey: string | null;
  sessionLabel?: string | null;
};

export function useMessageFavorites({
  agentEmoji,
  agentId,
  agentName,
  gatewayConfigId,
  listData,
  sessionKey,
  sessionLabel,
}: Params) {
  const [favoriteKeySet, setFavoriteKeySet] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    MessageFavoritesService.getFavoriteKeySet()
      .then((set) => {
        if (active) setFavoriteKeySet(set);
      })
      .catch(() => {
        if (active) setFavoriteKeySet(new Set());
      });
    return () => {
      active = false;
    };
  }, []);

  const buildFavoriteKey = useCallback((message: UiMessage): string | null => {
    if (!gatewayConfigId || !sessionKey) return null;
    return MessageFavoritesService.buildFavoriteKey({
      gatewayConfigId,
      agentId,
      sessionKey,
      message,
    });
  }, [agentId, gatewayConfigId, sessionKey]);

  const favoriteMessageIdSet = useMemo(() => {
    if (favoriteKeySet.size === 0 || !gatewayConfigId || !sessionKey) {
      return new Set<string>();
    }
    const ids = new Set<string>();
    for (const message of listData) {
      const key = buildFavoriteKey(message);
      if (key && favoriteKeySet.has(key)) {
        ids.add(message.id);
      }
    }
    return ids;
  }, [buildFavoriteKey, favoriteKeySet, gatewayConfigId, listData, sessionKey]);

  const toggleFavorite = useCallback(async (message: UiMessage) => {
    if (!gatewayConfigId || !sessionKey) {
      return { favorited: false, favoriteKey: null };
    }

    const result = await MessageFavoritesService.toggleFavorite({
      gatewayConfigId,
      agentId,
      agentName: agentName ?? undefined,
      agentEmoji: agentEmoji ?? undefined,
      sessionKey,
      sessionLabel: sessionLabel ?? undefined,
      message,
    });

    setFavoriteKeySet((prev) => {
      const next = new Set(prev);
      if (result.favorited) {
        next.add(result.favoriteKey);
      } else {
        next.delete(result.favoriteKey);
      }
      return next;
    });

    analyticsEvents.messageFavoriteToggled({
      action: result.favorited ? 'favorite' : 'unfavorite',
      role: message.role,
      source: 'selection_overlay',
    });

    return { favorited: result.favorited, favoriteKey: result.favoriteKey };
  }, [agentEmoji, agentId, agentName, gatewayConfigId, sessionKey, sessionLabel]);

  const isFavoritedMessage = useCallback((message: UiMessage): boolean => {
    const key = buildFavoriteKey(message);
    return key ? favoriteKeySet.has(key) : false;
  }, [buildFavoriteKey, favoriteKeySet]);

  return {
    favoriteKeySet,
    favoriteMessageIdSet,
    isFavoritedMessage,
    toggleFavorite,
  };
}
