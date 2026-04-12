import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { CachedSessionMeta, ChatCacheService } from '../../../services/chat-cache';
import { cacheMessageImages, findCachedEntry, generateStableKey, getAllCachedForSession } from '../../../services/image-cache';
import { LastOpenedSessionSnapshot, StorageService } from '../../../services/storage';
import { markHermesConnectTrace } from '../../../services/hermes-connect-debug';
import { SessionInfo } from '../../../types';
import { ImageMeta, UiMessage } from '../../../types/chat';
import { sessionKeysMatch } from '../../../utils/session-key';
import {
  extractAssistantDisplayText,
  extractIdempotencyKey,
  extractImageRawData,
  extractImageUris,
  extractText,
  hasImageBlocks,
  isAssistantDeliveryMirrorMessage,
  isAssistantSilentReplyMessage,
  parseMessageTimestamp,
  sanitizeUserMessageText,
  shouldHideMessage,
  stableMessageId,
} from '../../../utils/chat-message';
import { formatToolOneLinerLocalized, stripToolStatusPrefix } from '../../../utils/tool-display';
import { HISTORY_PAGE_SIZE } from '../constants';
import { ChatScreenProps } from '../types';
import { shouldSuppressHistoryLoadError } from './historyErrorPolicy';
import { shouldPreserveOptimisticAssistant } from './cacheHydrationPolicy';
import { preserveOptimisticAssistantMessage } from './historyMergePolicy';
import { shouldRestoreCacheBeforeHistoryRefresh } from './historyRefreshPolicy';
import { ReconcileAssistantOptions, shouldAppendReconciledAssistant } from './historyReconcile';
import { selectSessionForCurrentAgent } from './sessionSelection';
import { agentIdFromSessionKey } from './agentActivity';
import { cachedMessageToUiMessage } from './historyLineage';
import {
  buildCachedPreviewSessions,
  buildSnapshotPreviewSession,
} from './startupPreview';
import { useChatLocalHistoryPaging } from './useChatLocalHistoryPaging';
import {
  isBackendScopedMainSessionKey,
  isSessionKeyInAgentScope,
  sanitizeSnapshotForAgent,
} from '../../../utils/agent-session-scope';

let msgCounter = 0;
function makeId(prefix: string): string {
  return `${prefix}_${++msgCounter}`;
}

function appendUniqueUris(target: string[], uris?: string[]): void {
  if (!uris?.length) return;
  for (const uri of uris) {
    if (!target.includes(uri)) target.push(uri);
  }
}

function readToolName(source: Record<string, unknown>): string {
  return String(
    source.toolName
    ?? source.name
    ?? source.tool
    ?? (source.function as Record<string, unknown> | undefined)?.name
    ?? 'tool',
  );
}

function readToolCallId(source: Record<string, unknown>): string | undefined {
  const id = source.toolCallId ?? source.tool_call_id ?? source.id;
  return typeof id === 'string' && id.trim().length > 0 ? id : undefined;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? '');
  }
}

function areStringArraysEqual(a?: string[], b?: string[]): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function areUiMessagesEquivalent(prev: UiMessage[], next: UiMessage[]): boolean {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let index = 0; index < prev.length; index++) {
    const a = prev[index];
    const b = next[index];
    if (a.id !== b.id) return false;
    if (a.role !== b.role) return false;
    if (a.text !== b.text) return false;
    if (a.idempotencyKey !== b.idempotencyKey) return false;
    if (a.timestampMs !== b.timestampMs) return false;
    if (a.streaming !== b.streaming) return false;
    if (a.modelLabel !== b.modelLabel) return false;
    if (!areStringArraysEqual(a.imageUris, b.imageUris)) return false;
    if (a.imageMetas !== b.imageMetas) return false;
    if (a.toolName !== b.toolName) return false;
    if (a.toolStatus !== b.toolStatus) return false;
    if (a.toolSummary !== b.toolSummary) return false;
    if (a.toolArgs !== b.toolArgs) return false;
    if (a.toolDetail !== b.toolDetail) return false;
    if (a.toolDurationMs !== b.toolDurationMs) return false;
    if (a.toolStartedAt !== b.toolStartedAt) return false;
    if (a.toolFinishedAt !== b.toolFinishedAt) return false;
  }
  return true;
}

function summarizeMessage(message: UiMessage | undefined): string {
  if (!message) return 'none';
  const text = (message.text ?? '').replace(/\s+/g, ' ').trim();
  const preview = text.length > 36 ? `${text.slice(0, 36)}...` : text;
  return `${message.id}|${message.role}|${message.timestampMs ?? 'na'}|${preview || '(empty)'}`;
}

function summarizeMessages(label: string, list: UiMessage[]): string {
  const last = list[list.length - 1];
  const lastAssistant = [...list].reverse().find((message) => message.role === 'assistant');
  return `${label}: len=${list.length} last=${summarizeMessage(last)} lastAssistant=${summarizeMessage(lastAssistant)}`;
}

function prependUniqueMessages(previousMessages: UiMessage[], olderMessages: UiMessage[]): UiMessage[] {
  if (olderMessages.length === 0) return previousMessages;
  const existingIds = new Set(previousMessages.map((message) => message.id));
  const prependable = olderMessages.filter((message) => !existingIds.has(message.id));
  if (prependable.length === 0) return previousMessages;
  return [...prependable, ...previousMessages];
}

type Params = {
  gateway: ChatScreenProps['gateway'];
  dbg: (msg: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  sessionKeyRef: RefObject<string | null>;
  mainSessionKey: string;
  gatewayConfigId: string | null;
  currentAgentId: string;
  initialPreview?: LastOpenedSessionSnapshot | null;
};

export function useChatHistoryState({
  gateway,
  dbg,
  t,
  sessionKeyRef,
  mainSessionKey,
  gatewayConfigId,
  currentAgentId,
  initialPreview,
}: Params) {
  const initialPreviewSession = buildSnapshotPreviewSession(initialPreview ?? null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [sessionKey, setSessionKey] = useState<string | null>(initialPreview?.sessionKey ?? null);
  const [sessions, setSessions] = useState<SessionInfo[]>(initialPreviewSession);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingSessions, setRefreshingSessions] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [thinkingLevel, setThinkingLevel] = useState<string | null>(null);

  const historyLimitRef = useRef(HISTORY_PAGE_SIZE);
  const historyRawCountRef = useRef(0);
  const loadMoreLockRef = useRef(false);
  const historyRequestIdRef = useRef(0);
  const historyLoadInFlightRef = useRef(new Map<string, Promise<number>>());
  const historyReconcileInFlightRef = useRef(new Map<string, Promise<void>>());
  const startupPreviewRestoredRef = useRef(false);
  const cacheHydrationSessionKeyRef = useRef<string | null>(null);
  const messagesRef = useRef<UiMessage[]>(messages);
  const historyLoadedRef = useRef(historyLoaded);
  const previousGatewayScopeRef = useRef<string | null>(gatewayConfigId);
  const localOlderMessagesRef = useRef<UiMessage[]>([]);
  const localHistoryPaging = useChatLocalHistoryPaging({
    gatewayConfigId,
    currentAgentId,
    dbg,
  });

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    historyLoadedRef.current = historyLoaded;
  }, [historyLoaded]);

  useEffect(() => {
    if (previousGatewayScopeRef.current === gatewayConfigId) return;
    previousGatewayScopeRef.current = gatewayConfigId;
    startupPreviewRestoredRef.current = false;
    cacheHydrationSessionKeyRef.current = null;
    historyRequestIdRef.current += 1;
    sessionKeyRef.current = null;
    setMessages([]);
    setSessionKey(null);
    setSessions([]);
    setRefreshing(false);
    setRefreshingSessions(false);
    setHasMoreHistory(true);
    setLoadingMoreHistory(false);
    setHistoryLoaded(false);
    setThinkingLevel(null);
    historyLimitRef.current = HISTORY_PAGE_SIZE;
    historyRawCountRef.current = 0;
    loadMoreLockRef.current = false;
    localOlderMessagesRef.current = [];
    localHistoryPaging.resetLocalHistoryPaging(null);
    historyLoadInFlightRef.current.clear();
    historyReconcileInFlightRef.current.clear();
  }, [gatewayConfigId, localHistoryPaging, sessionKeyRef]);

  const restoreCachedMessages = useCallback(async (
    key: string,
    options?: { clearWhenEmpty?: boolean; sessionId?: string },
  ): Promise<boolean> => {
    if (!gatewayConfigId) return false;

    try {
      const cacheAgentId = agentIdFromSessionKey(key) ?? currentAgentId;
      const page = await ChatCacheService.getTimelinePage(gatewayConfigId, cacheAgentId, key, {
        pageSize: HISTORY_PAGE_SIZE,
      });
      if (!!sessionKeyRef.current && !sessionKeysMatch(sessionKeyRef.current, key)) {
        dbg(`cache: drop stale restore for key=${key}`);
        return false;
      }
      const restored = page.messages.map(cachedMessageToUiMessage);
      if (restored.length === 0) {
        if (options?.clearWhenEmpty) {
          setMessages([]);
        }
        localOlderMessagesRef.current = [];
        localHistoryPaging.resetLocalHistoryPaging(key);
        return false;
      }
      setMessages((prev) => (areUiMessagesEquivalent(prev, restored) ? prev : restored));
      localOlderMessagesRef.current = [];
      localHistoryPaging.resetLocalHistoryPaging(key);
      dbg(
        `cache: restored ${restored.length} msgs for key=${key} `
        + `| ${summarizeMessages('cache', restored)}`,
      );
      return true;
    } catch {
      if (options?.clearWhenEmpty) {
        setMessages([]);
      }
      localOlderMessagesRef.current = [];
      localHistoryPaging.resetLocalHistoryPaging(key);
      return false;
    }
  }, [currentAgentId, dbg, gatewayConfigId, localHistoryPaging, sessionKeyRef]);

  useEffect(() => {
    if (!initialPreview?.sessionKey) return;
    if (sessionKeyRef.current) return;
    sessionKeyRef.current = initialPreview.sessionKey;
    cacheHydrationSessionKeyRef.current = initialPreview.sessionKey;
    void restoreCachedMessages(initialPreview.sessionKey, {
      clearWhenEmpty: true,
      sessionId: initialPreview.sessionId,
    }).then((restored) => {
      if (restored) {
        setHistoryLoaded(true);
      }
    });
  }, [initialPreview, restoreCachedMessages, sessionKeyRef]);

  useEffect(() => {
    if (!gatewayConfigId || startupPreviewRestoredRef.current) return;
    if (sessionKeyRef.current) return;

    startupPreviewRestoredRef.current = true;
    let cancelled = false;

    const restoreStartupPreview = async () => {
      const [rawSnapshot, cachedSessions] = await Promise.all([
        StorageService.getLastOpenedSessionSnapshot(gatewayConfigId, currentAgentId).catch(() => null),
        ChatCacheService.listSessions().catch((): CachedSessionMeta[] => []),
      ]);
      const snapshot = sanitizeSnapshotForAgent(rawSnapshot, currentAgentId, { mainSessionKey });
      if (cancelled || sessionKeyRef.current) return;

      const snapshotPreview = buildSnapshotPreviewSession(snapshot);
      const previewCacheKey = snapshot?.sessionKey ?? mainSessionKey;
      const cachedPreview = buildCachedPreviewSessions(cachedSessions, gatewayConfigId, previewCacheKey)
        .filter((session) => isSessionKeyInAgentScope(session.key, currentAgentId, { mainSessionKey }));
      const previewSessions = [...snapshotPreview, ...cachedPreview]
        .filter((session, index, list) => list.findIndex((item) => item.key === session.key) === index);
      if (previewSessions.length > 0) {
        setSessions((prev) => (prev.length > 0 ? prev : previewSessions));
      }

      const previewKey = snapshot?.sessionKey ?? previewSessions[0]?.key ?? null;
      if (!previewKey) return;
      const previewSession = previewSessions.find((session) => session.key === previewKey);

      sessionKeyRef.current = previewKey;
      setSessionKey(previewKey);
      historyLimitRef.current = HISTORY_PAGE_SIZE;
      setHasMoreHistory(true);
      historyRawCountRef.current = 0;
      localOlderMessagesRef.current = [];
      localHistoryPaging.resetLocalHistoryPaging(previewKey);

      cacheHydrationSessionKeyRef.current = previewKey;
      const restored = await restoreCachedMessages(previewKey, {
        clearWhenEmpty: true,
        sessionId: previewSession?.sessionId,
      });
      if (cancelled || !restored) return;
      setHistoryLoaded(true);
      dbg(`cache: startup preview restored for key=${previewKey}`);
    };

    void restoreStartupPreview();

    return () => {
      cancelled = true;
    };
  }, [currentAgentId, dbg, gatewayConfigId, localHistoryPaging, mainSessionKey, restoreCachedMessages, sessionKeyRef]);

  const loadHistory = useCallback(async (key: string, limit = historyLimitRef.current): Promise<number> => {
    const requestKey = `${key}::${limit}`;
    const inFlight = historyLoadInFlightRef.current.get(requestKey);
    if (inFlight) {
      dbg(`history: reuse in-flight load for key=${key} limit=${limit}`);
      return inFlight;
    }

    const request = (async (): Promise<number> => {
    markHermesConnectTrace('history_fetch_begin', {
      limit,
    });
    const requestId = ++historyRequestIdRef.current;
    const isStaleRequest = () => (
      requestId !== historyRequestIdRef.current
      || (!!sessionKeyRef.current && !sessionKeysMatch(sessionKeyRef.current, key))
    );

    try {
      const historyResult = await gateway.fetchHistory(key, limit);
      markHermesConnectTrace('history_fetch_done', {
        limit,
        messageCount: historyResult.messages.length,
      });
      const history = historyResult.messages;
      const currentSessionId = historyResult.sessionId;

      if (isStaleRequest()) {
        dbg(`history: drop stale fetch result for key=${key}`);
        return history.length;
      }

      if (currentSessionId) {
        setSessions((prev) => {
          let matched = false;
          const next = prev.map((session) => {
            if (!sessionKeysMatch(session.key, key)) return session;
            matched = true;
            return session.sessionId !== currentSessionId
              ? { ...session, sessionId: currentSessionId }
              : session;
          });
          if (matched) return next;
          return [...next, { key, kind: 'unknown', sessionId: currentSessionId }];
        });
      }

      if (historyResult.thinkingLevel) {
        setThinkingLevel(historyResult.thinkingLevel);
      }

      historyRawCountRef.current = history.length;
      setHasMoreHistory(history.length >= limit || history.length > 0);

      const cachedImages = await getAllCachedForSession(key).catch(() => []);
      if (isStaleRequest()) {
        dbg(`history: drop stale cache result for key=${key}`);
        return history.length;
      }

      const usedCacheIndices = new Set<number>();

      dbg(`history: ${history.length} msgs, cache: ${cachedImages.length} entries`);
      for (const cached of cachedImages) {
        dbg(`  cached: stableKey=${cached.stableKey?.slice(0, 16)}... ts=${cached.timestamp} uris=${cached.uris.length}`);
      }

      const uiMessages: UiMessage[] = [];
      const toCache: Array<{ text: string; ts: number; images: Array<{ base64: string; mimeType: string }>; idempotencyKey?: string }> = [];

      let currentTurnText = '';
      let currentTurnImages: string[] = [];
      let currentTurnTimestamp = 0;
      let currentTurnModel = '';
      let hasAssistantTurn = false;
      const currentTurnHasContent = () => currentTurnText.trim().length > 0 || currentTurnImages.length > 0;

      const flushAssistantTurn = () => {
        if (!hasAssistantTurn) return;
        const hasTurnContent = currentTurnHasContent();
        if (hasTurnContent) {
          const idSeed = currentTurnText || `${currentTurnImages.length}_img`;
          uiMessages.push({
            id: stableMessageId('assistant', currentTurnTimestamp, idSeed),
            role: 'assistant',
            text: currentTurnText,
            timestampMs: currentTurnTimestamp > 0 ? currentTurnTimestamp : undefined,
            imageUris: currentTurnImages.length > 0 ? currentTurnImages : undefined,
            modelLabel: currentTurnModel || undefined,
          });
        }

        currentTurnText = '';
        currentTurnImages = [];
        currentTurnTimestamp = 0;
        currentTurnModel = '';
        hasAssistantTurn = false;
      };

      let prevRole: string | undefined;

      for (const message of history) {
        if (message.role === 'user') {
          flushAssistantTurn();
          const rawText = extractText(message.content);
          const text = sanitizeUserMessageText(rawText);
          let imageUris = extractImageUris(message.content);
          const rawImages = extractImageRawData(message.content);
          let displayText = text;

          const meta = (message as Record<string, unknown>).__openclaw as { truncated?: boolean } | undefined;
          const msgTs = parseMessageTimestamp(message);
          const idempotencyKey = extractIdempotencyKey(message);
          const hasImg = hasImageBlocks(message.content);
          const stableKey = generateStableKey('user', msgTs, text);
          dbg(`user: stableKey=${stableKey.slice(0, 16)}... ts=${msgTs} trunc=${!!meta?.truncated} hasImg=${hasImg} uris=${!!imageUris} idemp=${idempotencyKey ? 'yes' : 'no'}`);

          let imageDimensions: Array<{ width: number; height: number }> | undefined;

          const likelyMissingImagePayload = !imageUris
            && (meta?.truncated || hasImageBlocks(message.content) || text.startsWith('📷 ') || (text.trim() === '' && cachedImages.length > 0));

          if (likelyMissingImagePayload) {
            const match = findCachedEntry(
              cachedImages,
              { idempotencyKey, timestamp: msgTs, role: 'user', content: text },
              usedCacheIndices,
            );
            if (match) {
              usedCacheIndices.add(match.index);
              imageUris = match.entry.uris;
              imageDimensions = match.entry.imageDimensions;
              displayText = match.entry.messageText;
              dbg(`  matched: stableKey=${match.entry.stableKey.slice(0, 16)}... (by ${idempotencyKey && match.entry.idempotencyKey === idempotencyKey ? 'idempotencyKey' : 'stableKey'})`);
            } else {
              dbg(`  no match found for ts=${msgTs}`);
            }
          }

          if (rawImages && msgTs > 0) {
            const userStableKey = generateStableKey('user', msgTs, text);
            const alreadyCached = cachedImages.some((cached) => cached.stableKey === userStableKey);
            if (!alreadyCached) toCache.push({ text, ts: msgTs, images: rawImages, idempotencyKey });
          }

          if (shouldHideMessage({ role: 'user', text: displayText })) continue;
          if (displayText.trim() === '' && !imageUris) continue;

          // Build imageMetas from URIs + cached dimensions
          let imageMetas: ImageMeta[] | undefined;
          if (imageUris && imageUris.length > 0) {
            imageMetas = imageUris.map((uri, idx) => ({
              uri,
              width: imageDimensions?.[idx]?.width ?? 0,
              height: imageDimensions?.[idx]?.height ?? 0,
            }));
          }

          // Deduplicate exact same history item by stable ID only.
          const userMsgId = stableMessageId('user', msgTs, displayText);
          if (uiMessages.some((item) => item.id === userMsgId)) continue;

          uiMessages.push({
            id: userMsgId,
            role: 'user',
            text: displayText,
            idempotencyKey,
            timestampMs: msgTs > 0 ? msgTs : undefined,
            imageUris,
            imageMetas,
          });
          prevRole = 'user';
          continue;
        }

        if (message.role === 'assistant') {
          if (isAssistantDeliveryMirrorMessage(message)) {
            flushAssistantTurn();
            prevRole = 'assistant';
            continue;
          }
          if (isAssistantSilentReplyMessage(message)) {
            flushAssistantTurn();
            prevRole = 'assistant';
            continue;
          }
          const msgTs = parseMessageTimestamp(message);
          const text = extractAssistantDisplayText(message.content);
          const containsToolCallBlock = Array.isArray(message.content)
            && message.content.some((rawBlock) => {
              if (!rawBlock || typeof rawBlock !== 'object') return false;
              const block = rawBlock as Record<string, unknown>;
              return String(block.type ?? '').toLowerCase() === 'toolcall';
            });

          const shouldStartNewTurn = hasAssistantTurn
            && currentTurnHasContent()
            && (prevRole === 'user'
              || prevRole === 'assistant'
              || prevRole === 'toolResult'
              || containsToolCallBlock);
          if (shouldStartNewTurn) {
            flushAssistantTurn();
          }

          hasAssistantTurn = true;
          prevRole = 'assistant';
          if (msgTs > 0) currentTurnTimestamp = msgTs;

          const msgRec = message as Record<string, unknown>;
          if (!currentTurnModel) {
            const model = typeof msgRec.model === 'string' ? msgRec.model : '';
            const provider = typeof msgRec.provider === 'string' ? msgRec.provider : '';
            if (model) {
              currentTurnModel = provider ? `${provider}/${model}` : model;
            }
          }

          if (text.trim().length > 0) {
            currentTurnText = currentTurnText ? `${currentTurnText}\n${text}` : text;
          }

          appendUniqueUris(currentTurnImages, extractImageUris(message.content));

          if (Array.isArray(message.content)) {
            for (let index = 0; index < message.content.length; index++) {
              const rawBlock = message.content[index];
              if (!rawBlock || typeof rawBlock !== 'object') continue;
              const block = rawBlock as Record<string, unknown>;
              const type = String(block.type ?? '').toLowerCase();
              if (type !== 'toolcall') continue;

              const name = readToolName(block);
              const argsRaw = block.arguments ?? block.args ?? block.input;
              const toolCallId = readToolCallId(block);
              const id = `toolcall_${toolCallId ?? `${msgTs}_${index}_${uiMessages.length}`}`;
              if (uiMessages.some((item) => item.id === id)) continue;

              uiMessages.push({
                id,
                role: 'tool',
                text: '',
                toolName: name,
                toolStatus: 'running',
                toolSummary: formatToolOneLinerLocalized(name, argsRaw, t),
                toolArgs: argsRaw ? stringifyUnknown(argsRaw) : undefined,
                toolStartedAt: msgTs > 0 ? msgTs : undefined,
              });
            }
          }
          continue;
        }

        if (message.role === 'toolResult') {
          // Keep assistant/tool interleaving stable: if assistant text was buffered,
          // flush it before rendering the following tool result row.
          if (hasAssistantTurn && currentTurnHasContent()) {
            flushAssistantTurn();
          }
          prevRole = 'toolResult';
          const msgTs = parseMessageTimestamp(message);

          const msgRecord = message as Record<string, unknown>;
          const toolCallId = readToolCallId(msgRecord);
          const name = readToolName(msgRecord);
          const hasError = !!(msgRecord.isError || msgRecord.error);
          const toolArgs = typeof msgRecord.toolArgs === 'string'
            ? msgRecord.toolArgs
            : msgRecord.args !== undefined
              ? stringifyUnknown(msgRecord.args)
              : undefined;
          const toolStartedAt = typeof msgRecord.toolStartedAt === 'number'
            ? msgRecord.toolStartedAt
            : undefined;
          const toolFinishedAt = typeof msgRecord.toolFinishedAt === 'number'
            ? msgRecord.toolFinishedAt
            : (msgTs > 0 ? msgTs : undefined);
          const toolDurationMs = typeof msgRecord.toolDurationMs === 'number'
            ? msgRecord.toolDurationMs
            : (
              typeof toolStartedAt === 'number' && typeof toolFinishedAt === 'number'
                ? Math.max(0, toolFinishedAt - toolStartedAt)
                : undefined
            );

          const outputText = extractText(message.content);
          const outputValue = outputText
            || (typeof msgRecord.output === 'string' ? msgRecord.output : undefined)
            || msgRecord.output
            || msgRecord.result
            || msgRecord.toolOutput
            || msgRecord.text;
          const output = outputValue !== undefined ? stringifyUnknown(outputValue) : '';

          let existingIdx = -1;
          if (toolCallId) {
            const targetId = `toolcall_${toolCallId}`;
            for (let index = uiMessages.length - 1; index >= 0; index--) {
              if (uiMessages[index].id === targetId) {
                existingIdx = index;
                break;
              }
            }
          }

          if (existingIdx >= 0) {
            const existing = uiMessages[existingIdx];
            const baseSummary = stripToolStatusPrefix(existing.toolSummary ?? '', t)
              || formatToolOneLinerLocalized(name, undefined, t);
            const finishedAt = msgTs > 0 ? msgTs : existing.toolFinishedAt;
            const durationMs = (
              existing.toolStartedAt !== undefined
              && typeof finishedAt === 'number'
            )
              ? Math.max(0, finishedAt - existing.toolStartedAt)
              : existing.toolDurationMs;
            uiMessages[existingIdx] = {
              ...existing,
              toolName: existing.toolName ?? name,
              toolStatus: hasError ? 'error' : 'success',
              toolSummary: hasError
                ? t('Failed {{name}}', { name: baseSummary })
                : t('Completed {{name}}', { name: baseSummary }),
              toolArgs: existing.toolArgs ?? toolArgs,
              toolDetail: output || undefined,
              toolDurationMs: durationMs ?? toolDurationMs,
              toolStartedAt: existing.toolStartedAt ?? toolStartedAt,
              toolFinishedAt: finishedAt ?? toolFinishedAt,
            };
          } else {
            const baseSummary = formatToolOneLinerLocalized(name, undefined, t);
            uiMessages.push({
              id: `toolresult_${toolCallId ?? uiMessages.length}`,
              role: 'tool',
              text: '',
              toolName: name,
              toolStatus: hasError ? 'error' : 'success',
              toolSummary: hasError
                ? t('Failed {{name}}', { name: baseSummary })
                : t('Completed {{name}}', { name: baseSummary }),
              toolArgs,
              toolDetail: output || undefined,
              toolDurationMs,
              toolStartedAt,
              toolFinishedAt,
            });
          }
          continue;
        }

        if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'toolResult') continue;
      }
      flushAssistantTurn();

      if (toCache.length > 0) {
        for (const item of toCache) {
          await cacheMessageImages(key, item.text, item.images, { timestamp: item.ts, idempotencyKey: item.idempotencyKey, role: 'user' });
        }
        dbg(`cached ${toCache.length} new image(s) from history`);
      }

      if (isStaleRequest()) {
        dbg(`history: drop stale parsed result for key=${key}`);
        return history.length;
      }
      const allowOptimisticPreservation = shouldPreserveOptimisticAssistant({
        pendingHydrationSessionKey: cacheHydrationSessionKeyRef.current,
        targetSessionKey: key,
      });
      setMessages((prev) => {
        const lineageMergedMessages = prependUniqueMessages(uiMessages, localOlderMessagesRef.current);
        const mergedMessages = allowOptimisticPreservation
          ? preserveOptimisticAssistantMessage(prev, lineageMergedMessages)
          : lineageMergedMessages;
        dbg(
          `history:setMessages key=${key} allowPreserve=${allowOptimisticPreservation} `
          + `currentSessionId=${currentSessionId ?? 'none'} `
          + `| ${summarizeMessages('prev', prev)} `
          + `| ${summarizeMessages('nextRaw', uiMessages)} `
          + `| ${summarizeMessages('nextMerged', mergedMessages)}`,
        );
        const same = areUiMessagesEquivalent(prev, mergedMessages);
        return same ? prev : mergedMessages;
      });
      if (cacheHydrationSessionKeyRef.current === key) {
        cacheHydrationSessionKeyRef.current = null;
      }
      setHistoryLoaded(true);
      markHermesConnectTrace('history_loaded', {
        messageCount: uiMessages.length,
        sessionKeyPresent: Boolean(sessionKeyRef.current),
      });
      return history.length;
    } catch {
      if (cacheHydrationSessionKeyRef.current === key) {
        cacheHydrationSessionKeyRef.current = null;
      }
      if (requestId === historyRequestIdRef.current) {
        const connState = gateway.getConnectionState();
        if (shouldSuppressHistoryLoadError(connState)) {
          dbg(`history: suppressed load error while connection state=${connState}`);
        } else {
          dbg(`history: failed to load for key=${key}; keeping cached/current messages`);
        }
        setHistoryLoaded(true);
        markHermesConnectTrace('history_loaded_error_path', {
          connectionState: connState,
          sessionKeyPresent: Boolean(sessionKeyRef.current),
        });
      }
      return 0;
    }
    })();

    historyLoadInFlightRef.current.set(requestKey, request);
    try {
      return await request;
    } finally {
      const current = historyLoadInFlightRef.current.get(requestKey);
      if (current === request) {
        historyLoadInFlightRef.current.delete(requestKey);
      }
    }
  }, [dbg, gateway, sessionKeyRef, t]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const startKey = sessionKeyRef.current;
      const startMessages = messagesRef.current;
      dbg(`refresh:start currentKey=${startKey ?? 'null'} | ${summarizeMessages('visible', startMessages)}`);
      const list = await gateway.listSessions();
      setSessions(list);

      const currentKey = sessionKeyRef.current;
      const currentMessages = messagesRef.current;
      const currentHistoryLoaded = historyLoadedRef.current;

      const selected = selectSessionForCurrentAgent({
        sessions: list,
        mainSessionKey,
        currentKey,
      });
      const fallbackKey = (
        selected?.key
        ?? (currentKey && isSessionKeyInAgentScope(currentKey, currentAgentId, { mainSessionKey }) ? currentKey : null)
        ?? mainSessionKey
      );

      if (!sessionKeyRef.current || sessionKeyRef.current !== fallbackKey) {
        sessionKeyRef.current = fallbackKey;
        setSessionKey(fallbackKey);
      }

      const shouldRestoreCache = shouldRestoreCacheBeforeHistoryRefresh({
        targetKey: fallbackKey,
        currentKey,
        historyLoaded: currentHistoryLoaded,
        currentMessages,
      });
      if (shouldRestoreCache) {
        cacheHydrationSessionKeyRef.current = fallbackKey;
        await restoreCachedMessages(fallbackKey, { sessionId: selected?.sessionId });
      } else {
        dbg(`cache: skip restore for active session refresh key=${fallbackKey}`);
      }
      dbg(`refresh:loadHistory key=${fallbackKey} limit=${historyLimitRef.current}`);
      await loadHistory(fallbackKey, historyLimitRef.current);
      dbg(`refresh:done key=${fallbackKey}`);
    } catch {
      if (!sessionKeyRef.current) return;
      const currentMessages = messagesRef.current;
      const currentHistoryLoaded = historyLoadedRef.current;
      const shouldRestoreCache = shouldRestoreCacheBeforeHistoryRefresh({
        targetKey: sessionKeyRef.current,
        currentKey: sessionKeyRef.current,
        historyLoaded: currentHistoryLoaded,
        currentMessages,
      });
      if (shouldRestoreCache) {
        cacheHydrationSessionKeyRef.current = sessionKeyRef.current;
        await restoreCachedMessages(sessionKeyRef.current);
      } else {
        dbg(`cache: skip restore after refresh failure key=${sessionKeyRef.current}`);
      }
      dbg(`refresh:retryLoadHistory key=${sessionKeyRef.current} limit=${historyLimitRef.current}`);
      await loadHistory(sessionKeyRef.current, historyLimitRef.current);
    } finally {
      setRefreshing(false);
    }
  }, [dbg, gateway, loadHistory, mainSessionKey, restoreCachedMessages, sessionKeyRef]);

  const onLoadMoreHistory = useCallback(async () => {
    if (!sessionKey || loadingMoreHistory || refreshing || !hasMoreHistory) return;
    if (loadMoreLockRef.current) return;
    loadMoreLockRef.current = true;

    const prevCount = historyRawCountRef.current;
    setLoadingMoreHistory(true);
    const nextLimit = historyLimitRef.current + HISTORY_PAGE_SIZE;

    try {
      const historyResult = await gateway.fetchHistory(sessionKey, nextLimit);
      const history = historyResult.messages;
      historyRawCountRef.current = history.length;

      if (history.length <= prevCount) {
        const localPage = await localHistoryPaging.loadOlderLocalPage(
          sessionKey,
          messagesRef.current,
          HISTORY_PAGE_SIZE,
        );
        if (localPage.pageMessages.length > 0) {
          localOlderMessagesRef.current = prependUniqueMessages(
            localOlderMessagesRef.current,
            localPage.pageMessages,
          );
          setMessages((prev) => prependUniqueMessages(prev, localPage.pageMessages));
          setHasMoreHistory(localPage.hasMore);
        } else {
          setHasMoreHistory(false);
        }
        setLoadingMoreHistory(false);
        setTimeout(() => {
          loadMoreLockRef.current = false;
        }, 350);
        return;
      }

      await loadHistory(sessionKey, nextLimit);
      historyLimitRef.current = nextLimit;
      setHasMoreHistory(history.length >= nextLimit);
    } catch {
    }

    setLoadingMoreHistory(false);
    setTimeout(() => {
      loadMoreLockRef.current = false;
    }, 350);
  }, [gateway, hasMoreHistory, loadHistory, loadingMoreHistory, localHistoryPaging, refreshing, sessionKey]);

  const reconcileLatestAssistantFromHistory = useCallback(async (
    key: string,
    options?: ReconcileAssistantOptions,
  ) => {
    const requestKey = buildReconcileRequestKey(key, options);
    const inFlight = historyReconcileInFlightRef.current.get(requestKey);
    if (inFlight) {
      dbg(`reconcile: reuse in-flight request for key=${requestKey}`);
      return inFlight;
    }

    const request = (async (): Promise<void> => {
    try {
      const historyResult = await gateway.fetchHistory(key, 12);
      const history = historyResult.messages;

      let latestAssistant: (typeof history)[number] | undefined;
      for (let index = history.length - 1; index >= 0; index--) {
        const message = history[index];
        if (message.role !== 'assistant') continue;
        if (isAssistantDeliveryMirrorMessage(message)) continue;
        if (isAssistantSilentReplyMessage(message)) continue;
        const text = extractAssistantDisplayText(message.content);
        if (!text.trim()) continue;
        latestAssistant = message;
        break;
      }
      if (!latestAssistant) return;

      const finalText = extractAssistantDisplayText(latestAssistant.content);
      const finalTimestamp = parseMessageTimestamp(latestAssistant);
      const latestRec = latestAssistant as Record<string, unknown>;
      const latestModel = typeof latestRec.model === 'string' ? latestRec.model : '';
      const latestProvider = typeof latestRec.provider === 'string' ? latestRec.provider : '';
      const finalModelLabel = latestModel ? (latestProvider ? `${latestProvider}/${latestModel}` : latestModel) : undefined;
      dbg(`reconcile: finalTextLen=${finalText.length}`);
      if (!finalText.trim()) return;

      setMessages((prev) => {
        if (!sessionKeysMatch(sessionKeyRef.current, key)) return prev;
        dbg(`reconcile:setMessages key=${key} | finalTextLen=${finalText.length} | ${summarizeMessages('prev', prev)}`);

        let currentRunIdx = -1;
        let lastAssistantIdx = -1;
        for (let index = prev.length - 1; index >= 0; index--) {
          if (prev[index].role !== 'assistant') continue;
          if (lastAssistantIdx < 0) lastAssistantIdx = index;
          if (prev[index].id.startsWith('final_') || prev[index].id.startsWith('abort_')) {
            currentRunIdx = index;
            break;
          }
        }

        if (currentRunIdx >= 0) {
          const target = prev[currentRunIdx];
          if (target.text === finalText) {
            dbg('reconcile: already up to date, skip');
            return prev;
          }
          dbg('reconcile: updating current run message with history data');
          const updated = [...prev];
          updated[currentRunIdx] = {
            ...target,
            text: finalText,
            timestampMs: finalTimestamp > 0 ? finalTimestamp : target.timestampMs,
            modelLabel: finalModelLabel ?? target.modelLabel,
          };
          dbg(`reconcile:updateCurrentRun key=${key} | ${summarizeMessages('updated', updated)}`);
          return updated;
        }

        if (lastAssistantIdx >= 0 && prev[lastAssistantIdx].text === finalText) {
          dbg('reconcile: last assistant already matches, skip');
          return prev;
        }

        if (!shouldAppendReconciledAssistant(finalTimestamp, options)) {
          dbg('reconcile: skip append without active recovery context');
          return prev;
        }

        dbg('reconcile: appending final assistant message');
        const appended = [...prev, {
          id: makeId('ast'),
          role: 'assistant' as const,
          text: finalText,
          timestampMs: finalTimestamp > 0 ? finalTimestamp : Date.now(),
          modelLabel: finalModelLabel,
        }];
        dbg(`reconcile:appended key=${key} | ${summarizeMessages('appended', appended)}`);
        return appended;
      });
    } catch {
    }
    })();

    historyReconcileInFlightRef.current.set(requestKey, request);
    try {
      await request;
    } finally {
      const current = historyReconcileInFlightRef.current.get(requestKey);
      if (current === request) {
        historyReconcileInFlightRef.current.delete(requestKey);
      }
    }
  }, [dbg, gateway, sessionKeyRef]);

  const loadSessionsAndHistory = useCallback(async () => {
    const currentKey = sessionKeyRef.current;
    markHermesConnectTrace('history_bootstrap_begin', {
      currentKeyPresent: Boolean(currentKey),
    });

    // Fire both reads in parallel: cached snapshot + server session list
    const snapshotPromise = gatewayConfigId
      ? StorageService.getLastOpenedSessionSnapshot(gatewayConfigId, currentAgentId)
        .then((snapshot) => sanitizeSnapshotForAgent(snapshot, currentAgentId, { mainSessionKey }))
        .catch(() => null)
      : Promise.resolve(null);
    const listPromise = gateway.listSessions();

    // Optimistic: prefer the currently visible main session; fall back to cached snapshot.
    const snapshot = await snapshotPromise;
    const snapshotPreview = buildSnapshotPreviewSession(snapshot);
    if (snapshotPreview.length > 0) {
      setSessions((prev) => (prev.length > 0 ? prev : snapshotPreview));
    }
    const preferredKey = (
      currentKey && isSessionKeyInAgentScope(currentKey, currentAgentId, { mainSessionKey })
        ? currentKey
        : snapshot?.sessionKey
          ?? (isBackendScopedMainSessionKey(mainSessionKey) ? mainSessionKey : null)
    );
    let optimisticHistoryPromise: Promise<number> | null = null;
    if (preferredKey) {
      sessionKeyRef.current = preferredKey;
      setSessionKey(preferredKey);
      markHermesConnectTrace('session_key_selected', {
        source: 'preferred',
      });
      historyLimitRef.current = HISTORY_PAGE_SIZE;
      setHasMoreHistory(true);
      setHistoryLoaded(false);
      historyRawCountRef.current = 0;
      cacheHydrationSessionKeyRef.current = preferredKey;
      void restoreCachedMessages(preferredKey, {
        sessionId: snapshot?.sessionKey === preferredKey ? snapshot.sessionId : undefined,
      });
      optimisticHistoryPromise = loadHistory(preferredKey, HISTORY_PAGE_SIZE);
    }

    try {
      const list = await listPromise;
      markHermesConnectTrace('sessions_list_done', {
        count: list.length,
      });
      setSessions(list);
      const selected = selectSessionForCurrentAgent({
        sessions: list,
        mainSessionKey,
        currentKey: sessionKeyRef.current,
      });
      if (selected) {
        if (selected.key === preferredKey && optimisticHistoryPromise) {
          // Optimistic guess was correct — just await the already-running load
          await optimisticHistoryPromise;
        } else {
          // Different key than optimistic target — load the correct one
          // (stale optimistic result auto-dropped by historyRequestIdRef guard)
          sessionKeyRef.current = selected.key;
          setSessionKey(selected.key);
          markHermesConnectTrace('session_key_selected', {
            source: 'selected',
          });
          historyLimitRef.current = HISTORY_PAGE_SIZE;
          setHasMoreHistory(true);
          setHistoryLoaded(false);
          historyRawCountRef.current = 0;
          cacheHydrationSessionKeyRef.current = selected.key;
          await restoreCachedMessages(selected.key, {
            clearWhenEmpty: true,
            sessionId: selected.sessionId,
          });
          await loadHistory(selected.key, HISTORY_PAGE_SIZE);
        }
      }
      markHermesConnectTrace('history_bootstrap_done', {
        sessionKeyPresent: Boolean(sessionKeyRef.current),
      });
    } catch {
      // If optimistic load is already running, let it finish
      if (optimisticHistoryPromise) {
        await optimisticHistoryPromise.catch(() => {});
        return;
      }
      const fallbackKey = preferredKey ?? mainSessionKey;
      sessionKeyRef.current = fallbackKey;
      setSessionKey(fallbackKey);
      markHermesConnectTrace('session_key_selected', {
        source: 'fallback',
      });
      historyLimitRef.current = HISTORY_PAGE_SIZE;
      setHasMoreHistory(true);
      setHistoryLoaded(false);
      historyRawCountRef.current = 0;
      cacheHydrationSessionKeyRef.current = fallbackKey;
      void restoreCachedMessages(fallbackKey, { clearWhenEmpty: true });
      loadHistory(fallbackKey, HISTORY_PAGE_SIZE);
    }
  }, [currentAgentId, gateway, gatewayConfigId, loadHistory, mainSessionKey, restoreCachedMessages]);

  const refreshCurrentSessionHistory = useCallback(async () => {
    const currentKey = sessionKeyRef.current;
    if (!currentKey) return;
    await loadHistory(currentKey, historyLimitRef.current);
  }, [loadHistory, sessionKeyRef]);

  return {
    messages,
    setMessages,
    sessionKey,
    setSessionKey,
    sessions,
    setSessions,
    refreshing,
    refreshingSessions,
    hasMoreHistory,
    loadingMoreHistory,
    historyLoaded,
    thinkingLevel,
    setThinkingLevel,
    historyLimitRef,
    historyRawCountRef,
    loadMoreLockRef,
    setHasMoreHistory,
    setHistoryLoaded,
    onRefresh,
    onLoadMoreHistory,
    loadHistory,
    refreshCurrentSessionHistory,
    loadSessionsAndHistory,
    restoreCachedMessages,
    refreshSessions: useCallback(async () => {
      setRefreshingSessions(true);
      try {
        const currentKey = sessionKeyRef.current;
        const list = await gateway.listSessions();
        setSessions(list);

        const selected = selectSessionForCurrentAgent({
          sessions: list,
          mainSessionKey,
          currentKey,
        });
        if (!selected) return;
        if (selected.key !== currentKey) {
          sessionKeyRef.current = selected.key;
          setSessionKey(selected.key);
          setHistoryLoaded(false);
          cacheHydrationSessionKeyRef.current = selected.key;
          await restoreCachedMessages(selected.key, {
            clearWhenEmpty: true,
            sessionId: selected.sessionId,
          });
          await loadHistory(selected.key, historyLimitRef.current);
        }
      } catch {
        // silent
      } finally {
        setRefreshingSessions(false);
      }
    }, [gateway, gatewayConfigId, loadHistory, mainSessionKey, restoreCachedMessages, sessionKeyRef]),
    reconcileLatestAssistantFromHistory,
  };
}

function buildReconcileRequestKey(
  sessionKey: string,
  options?: ReconcileAssistantOptions,
): string {
  const appendIfMissing = options?.appendIfMissing ? '1' : '0';
  const minTimestampMs = typeof options?.minTimestampMs === 'number' && Number.isFinite(options.minTimestampMs)
    ? String(options.minTimestampMs)
    : '0';
  return `${sessionKey}::append=${appendIfMissing}::min=${minTimestampMs}`;
}
