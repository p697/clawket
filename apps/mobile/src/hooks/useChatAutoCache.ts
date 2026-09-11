import { useEffect, useRef } from 'react';
import { ChatCacheService } from '../services/chat-cache';
import { UiMessage } from '../types/chat';

type Params = {
  /** Stable gateway identifier (e.g. derived from URL). */
  gatewayConfigId: string | null;
  agentId: string;
  agentName?: string;
  agentEmoji?: string;
  sessionKey: string | null;
  sessionId?: string;
  sessionLabel?: string;
  messages: UiMessage[];
  /** Only cache when history is loaded and stable (not mid-stream). */
  historyLoaded: boolean;
};

const DEBOUNCE_MS = 2000;

/**
 * Automatically caches chat messages to local storage whenever
 * the message list changes, debounced to avoid excessive writes.
 */
export function useChatAutoCache({
  gatewayConfigId,
  agentId,
  agentName,
  agentEmoji,
  sessionKey,
  sessionId,
  sessionLabel,
  messages,
  historyLoaded,
}: Params): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Capture latest values for the debounced callback
  const latestRef = useRef({ gatewayConfigId, agentId, agentName, agentEmoji, sessionKey, sessionId, sessionLabel, messages, historyLoaded });
  latestRef.current = { gatewayConfigId, agentId, agentName, agentEmoji, sessionKey, sessionId, sessionLabel, messages, historyLoaded };

  useEffect(() => {
    if (!historyLoaded || !sessionKey || !gatewayConfigId) return;
    // Skip if there are no real messages to cache
    if (messages.length === 0) return;
    // Skip if still streaming (any message has streaming=true)
    if (messages.some((m) => m.streaming)) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      const latest = latestRef.current;
      if (!latest.gatewayConfigId || !latest.sessionKey) return;
      ChatCacheService.saveMessages(
        {
          gatewayConfigId: latest.gatewayConfigId,
          agentId: latest.agentId,
          agentName: latest.agentName,
          agentEmoji: latest.agentEmoji,
          sessionKey: latest.sessionKey,
          sessionId: latest.sessionId,
          sessionLabel: latest.sessionLabel,
        },
        latest.messages,
      ).catch(() => {});
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [gatewayConfigId, agentId, sessionKey, sessionId, sessionLabel, messages, historyLoaded]);
}
