import { useCallback, useRef } from 'react';
import { ChatCacheService } from '../services/chat-cache';
import { UiMessage } from '../types/chat';
import { agentIdFromSessionKey } from './agentActivity';
import { cachedMessageToUiMessage } from './historyLineage';

type Params = {
  gatewayConfigId: string | null;
  currentAgentId: string;
  dbg: (msg: string) => void;
};

export function useChatLocalHistoryPaging({
  gatewayConfigId,
  currentAgentId,
  dbg,
}: Params) {
  const activeSessionKeyRef = useRef<string | null>(null);
  const hasMoreLocalRef = useRef(true);
  const scopeVersionRef = useRef(0);

  const resetLocalHistoryPaging = useCallback((sessionKey: string | null) => {
    scopeVersionRef.current += 1;
    activeSessionKeyRef.current = sessionKey;
    hasMoreLocalRef.current = true;
  }, []);

  const loadOlderLocalPage = useCallback(async (
    sessionKey: string,
    currentMessages: UiMessage[],
    pageSize: number,
  ): Promise<{ pageMessages: UiMessage[]; hasMore: boolean }> => {
    if (!gatewayConfigId) return { pageMessages: [], hasMore: false };
    if (!hasMoreLocalRef.current && activeSessionKeyRef.current === sessionKey) {
      return { pageMessages: [], hasMore: false };
    }

    activeSessionKeyRef.current = sessionKey;
    const scopeVersion = scopeVersionRef.current;

    const beforeMessageId = currentMessages[0]?.id;
    const agentId = agentIdFromSessionKey(sessionKey) ?? currentAgentId;
    const page = await ChatCacheService.getTimelinePage(
      gatewayConfigId,
      agentId,
      sessionKey,
      {
        beforeMessageId,
        pageSize,
      },
    );
    if (scopeVersion !== scopeVersionRef.current || activeSessionKeyRef.current !== sessionKey) {
      return { pageMessages: [], hasMore: true };
    }

    const messages = page.messages.map(cachedMessageToUiMessage);
    hasMoreLocalRef.current = page.hasMore;
    dbg(
      `localHistory: key=${sessionKey} before=${beforeMessageId ?? 'none'} `
      + `fetched=${messages.length} hasMore=${page.hasMore}`,
    );
    return {
      pageMessages: messages,
      hasMore: page.hasMore,
    };
  }, [currentAgentId, dbg, gatewayConfigId]);

  return {
    resetLocalHistoryPaging,
    loadOlderLocalPage,
  };
}
