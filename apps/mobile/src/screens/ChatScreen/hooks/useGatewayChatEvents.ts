import { Dispatch, RefObject, SetStateAction, useEffect, useRef } from 'react';
import i18n from '../../../i18n';
import { enrichAgentsWithIdentity } from '../../../services/agent-identity';
import { extractText } from '../../../services/gateway';
import { sessionKeysMatch } from '../../../utils/session-key';
import {
  isAssistantDeliveryMirrorMessage,
  isAssistantSilentReplyMessage,
  isSilentReplyPrefixText,
  parseMessageTimestamp,
} from '../../../utils/chat-message';

import { ConnectionState } from '../../../types';
import { MessageUsage, UiMessage } from '../../../types/chat';
import { formatToolActivity, formatToolOneLinerLocalized } from '../../../utils/tool-display';
import { ChatScreenProps } from '../types';
import {
  AgentActivity,
  agentIdFromSessionKey,
  applyDelta as applyActivityDelta,
  applyRunEnd,
  applyRunStart,
  applyToolStart as applyActivityToolStart,
} from './agentActivity';
import {
  applyChildDelta,
  applyChildRunEnd,
  applyChildRunStart,
  applyChildToolStart,
  ChildSessionActivity,
} from './childSessionActivity';
import {
  clearSessionRunState,
  markSessionRunDelta,
  markSessionRunStarted,
  SessionRunState,
} from './sessionRunState';
import { hasCompletedAssistantForRememberedRun } from './runStateValidation';
import { shouldAdoptPendingOptimisticRunId } from './pendingOptimisticRun';
import { formatSystemErrorMessage } from './systemErrorMessage';
import {
  shouldDelayConnectionRecoveryMessage,
  shouldSuppressHermesStartupRecoveryMessage,
  shouldShowConnectionRecoveryMessage,
} from './connectionRecoveryPolicy';
import { sanitizeVisibleStreamText } from './chatControllerUtils';
import { markHermesConnectTrace } from '../../../services/hermes-connect-debug';

type Params = {
  gateway: ChatScreenProps['gateway'];
  config: ChatScreenProps['config'];
  showDebug: boolean;
  dbg: (msg: string) => void;
  sessionKeyRef: RefObject<string | null>;
  lastConnStateRef: RefObject<ConnectionState>;
  compactionTimerRef: RefObject<ReturnType<typeof setTimeout> | null>;
  currentRunIdRef: RefObject<string | null>;
  streamStartedAtRef: RefObject<number | null>;
  chatStreamRef: RefObject<string | null>;
  sessionRunStateRef: RefObject<Map<string, SessionRunState>>;
  pendingOptimisticRunIdsRef: RefObject<Map<string, string>>;
  setConnectionState: Dispatch<SetStateAction<ConnectionState>>;
  setPairingPending: (pending: boolean) => void;
  setIsSending: (sending: boolean) => void;
  setChatStream: (text: string | null) => void;
  setMessages: Dispatch<SetStateAction<UiMessage[]>>;
  setToolMessages: Dispatch<SetStateAction<UiMessage[]>>;
  commitCurrentStreamSegment: (timestampMs?: number) => void;
  clearTransientRunPresentation: (options?: { preserveCurrentStream?: boolean; preserveToolMessages?: boolean }) => void;
  setCompactionNotice: (message: string | null) => void;
  loadSessionsAndHistory: () => Promise<void>;
  reconcileLatestAssistantFromHistory: (
    key: string,
    options?: { appendIfMissing?: boolean; minTimestampMs?: number },
  ) => Promise<void>;
  currentAgentId: string;
  onAgentsLoaded: (agents: Array<{ id: string; name?: string; identity?: { name?: string; emoji?: string; avatar?: string; avatarUrl?: string } }>) => void;
  onDefaultAgentId?: (defaultId: string) => void;
  shouldIgnoreRunId?: (runId: string) => boolean;
  onStreamFinished?: () => void;
  execApprovalEnabled: boolean;
  setActivityLabel: (label: string | null) => void;
  agentActivityRef: RefObject<Map<string, AgentActivity>>;
  childSessionActivityRef: RefObject<Map<string, ChildSessionActivity>>;
  onChildSessionActivityChange: () => void;
  onAgentActiveCountChange: (delta: 1 | -1) => void;
  resetAgentActiveCount: () => void;
  onRunSignal?: () => void;
  onToolSettled?: (info: { runId: string; sessionKey: string | null; toolName: string; status: 'success' | 'error' }) => void;
  onToolResult?: (info: { runId: string; sessionKey: string | null; toolName: string; status: 'success' | 'error' }) => void;
};

let msgCounter = 0;
const HERMES_READY_AGENT_LOAD_DELAY_MS = 1500;
function makeId(prefix: string): string {
  return `${prefix}_${++msgCounter}`;
}

function shouldReloadHistoryForFinalEvent(
  message?: { role?: string; content?: string | Array<{ type: string; text?: string }> },
): boolean {
  if (!message || typeof message !== 'object') {
    return true;
  }
  const role = typeof message.role === 'string' ? message.role.toLowerCase() : '';
  if (role && role !== 'assistant') {
    return true;
  }
  return false;
}

function extractModelLabel(
  message?: { provider?: string; model?: string },
): string | undefined {
  if (!message) return undefined;
  const model = typeof message.model === 'string' ? message.model : '';
  const provider = typeof message.provider === 'string' ? message.provider : '';
  if (!model) return undefined;
  return provider ? `${provider}/${model}` : model;
}

function parseUsage(
  raw?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number },
): MessageUsage | undefined {
  if (!raw) return undefined;
  const input = typeof raw.input === 'number' ? raw.input : undefined;
  const output = typeof raw.output === 'number' ? raw.output : undefined;
  const cacheRead = typeof raw.cacheRead === 'number' ? raw.cacheRead : undefined;
  const cacheWrite = typeof raw.cacheWrite === 'number' ? raw.cacheWrite : undefined;
  const total = typeof raw.total === 'number' ? raw.total : undefined;
  if (input === undefined && output === undefined && total === undefined) return undefined;
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    totalTokens: total,
  };
}

function withToolMessage(
  prev: UiMessage[],
  id: string,
  value: UiMessage,
): UiMessage[] {
  const idx = prev.findIndex((item) => item.id === id);
  if (idx < 0) return [...prev, value];
  const next = [...prev];
  next[idx] = { ...next[idx], ...value, id };
  return next;
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

function normalizeAssistantText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function shouldMergeFinalIntoExistingAssistant(params: {
  candidate: UiMessage;
  snapshotText: string;
  activeRunStartedAt: number | null;
}): boolean {
  const { candidate, snapshotText, activeRunStartedAt } = params;
  if (candidate.role !== 'assistant') return false;
  if (candidate.id.startsWith('final_') || candidate.id.startsWith('abort_')) return false;
  const normalizedCandidate = normalizeAssistantText(candidate.text);
  const normalizedSnapshot = normalizeAssistantText(snapshotText);
  if (!normalizedCandidate || !normalizedSnapshot) return false;

  const candidateTimestamp = candidate.timestampMs ?? 0;
  if (activeRunStartedAt && candidateTimestamp > 0 && candidateTimestamp + 1000 < activeRunStartedAt) {
    return false;
  }

  return (
    normalizedSnapshot.includes(normalizedCandidate)
    || normalizedCandidate.includes(normalizedSnapshot)
  );
}

export function useGatewayChatEvents(params: Params) {
  const lastFatalErrorRef = useRef<{ signature: string; at: number } | null>(null);
  const delayedConnectionErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyAgentLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingConnectionRecoveryRef = useRef<{
    signature: string;
    code?: string;
    message?: string;
  } | null>(null);
  const {
    gateway,
    config,
    showDebug,
    dbg,
    sessionKeyRef,
    lastConnStateRef,
    compactionTimerRef,
    currentRunIdRef,
    streamStartedAtRef,
    chatStreamRef,
    sessionRunStateRef,
    pendingOptimisticRunIdsRef,
    setConnectionState,
    setPairingPending,
    setIsSending,
    setChatStream,
    setMessages,
    setToolMessages,
    commitCurrentStreamSegment,
    clearTransientRunPresentation,
    setCompactionNotice,
    loadSessionsAndHistory,
    reconcileLatestAssistantFromHistory,
    currentAgentId,
    onAgentsLoaded,
    onDefaultAgentId,
    shouldIgnoreRunId,
    onStreamFinished,
    execApprovalEnabled,
    setActivityLabel,
    agentActivityRef,
    childSessionActivityRef,
    onChildSessionActivityChange,
    onAgentActiveCountChange,
    resetAgentActiveCount,
    onRunSignal,
    onToolSettled,
    onToolResult,
  } = params;

  useEffect(() => {
    const clearDelayedConnectionRecovery = () => {
      if (delayedConnectionErrorTimerRef.current) {
        clearTimeout(delayedConnectionErrorTimerRef.current);
        delayedConnectionErrorTimerRef.current = null;
      }
      pendingConnectionRecoveryRef.current = null;
    };

    const clearReadyAgentLoad = () => {
      if (readyAgentLoadTimerRef.current) {
        clearTimeout(readyAgentLoadTimerRef.current);
        readyAgentLoadTimerRef.current = null;
      }
    };

    const appendConnectionRecoveryMessage = (message?: string, code?: string) => {
      const signature = `recovery:${code ?? ''}:${message ?? ''}`;
      const now = Date.now();
      const last = lastFatalErrorRef.current;
      if (last && last.signature === signature && now - last.at < 20_000) {
        return;
      }
      lastFatalErrorRef.current = { signature, at: now };
      const connectionRecoveryText = i18n.t('Connection Error: Check your network connection and that OpenClaw or Hermes is running, or run "clawket pair" on your computer, then try again.', { ns: 'chat' });
      setMessages((prev) => [...prev, {
        id: makeId('err'),
        role: 'system',
        text: formatSystemErrorMessage(connectionRecoveryText, message),
      }]);
    };

    const scheduleDelayedConnectionRecovery = (payload: { code?: string; message?: string }) => {
      const signature = `recovery:${payload.code ?? ''}:${payload.message ?? ''}`;
      if (pendingConnectionRecoveryRef.current?.signature === signature) {
        return;
      }
      if (delayedConnectionErrorTimerRef.current) {
        clearTimeout(delayedConnectionErrorTimerRef.current);
        delayedConnectionErrorTimerRef.current = null;
      }
      pendingConnectionRecoveryRef.current = {
        signature,
        code: payload.code,
        message: payload.message,
      };
      delayedConnectionErrorTimerRef.current = setTimeout(() => {
        delayedConnectionErrorTimerRef.current = null;
        const pending = pendingConnectionRecoveryRef.current;
        pendingConnectionRecoveryRef.current = null;
        if (!pending) return;
        if (gateway.getConnectionState() === 'ready') return;
        appendConnectionRecoveryMessage(pending.message, pending.code);
      }, 10_000);
    };

    const resolveEventSessionKey = (eventSessionKey?: string): string | null => {
      return eventSessionKey || sessionKeyRef.current || null;
    };

    // Traced wrapper — logs every isSending transition with reason (debug mode only)
    const tracedSetIsSending = (value: boolean, reason: string) => {
      if (showDebug) {
        const tag = `[isSending] → ${value} | reason=${reason} | runId=${currentRunIdRef.current?.slice(0, 8) ?? 'null'} | session=${sessionKeyRef.current ?? 'null'}`;
        dbg(tag);
        console.log(tag);
      }
      setIsSending(value);
    };

    const adoptPendingOptimisticRunId = (key: string, eventRunId: string): boolean => {
      if (!shouldAdoptPendingOptimisticRunId({
        sessionKey: key,
        eventRunId,
        currentRunId: currentRunIdRef.current,
        pendingRunIds: pendingOptimisticRunIdsRef.current,
      })) {
        if (pendingOptimisticRunIdsRef.current.get(key) === eventRunId) {
          pendingOptimisticRunIdsRef.current.delete(key);
        }
        return false;
      }
      const pendingRunId = pendingOptimisticRunIdsRef.current.get(key);
      if (!pendingRunId) {
        pendingOptimisticRunIdsRef.current.delete(key);
        return false;
      }
      currentRunIdRef.current = eventRunId;
      pendingOptimisticRunIdsRef.current.delete(key);
      if (showDebug) {
        dbg(`adopt optimistic runId: ${pendingRunId.slice(0, 8)} -> ${eventRunId.slice(0, 8)} session=${key}`);
      }
      return true;
    };

    const applyRememberedRunStateToCurrentSession = async () => {
      const key = sessionKeyRef.current;
      if (!key) return;
      const remembered = sessionRunStateRef.current.get(key);
      if (!remembered) {
        currentRunIdRef.current = null;
        streamStartedAtRef.current = null;
        clearTransientRunPresentation();
        tracedSetIsSending(false, 'applyRemembered:no-entry');
        setActivityLabel(null);
        return;
      }
      try {
        const historyResult = await gateway.fetchHistory(key, 12);
        const latestMessages: UiMessage[] = [];
        for (const message of historyResult.messages) {
          if (message.role !== 'assistant') continue;
          if (isAssistantDeliveryMirrorMessage(message)) continue;
          if (isAssistantSilentReplyMessage(message)) continue;
          const text = extractText(message.content as Parameters<typeof extractText>[0]);
          if (!text.trim()) continue;
          latestMessages.push({
            id: `history_assistant_${parseMessageTimestamp(message)}`,
            role: 'assistant',
            text,
            timestampMs: parseMessageTimestamp(message) || undefined,
          });
        }
        if (hasCompletedAssistantForRememberedRun(latestMessages, remembered)) {
          clearSessionRunState(sessionRunStateRef.current, key, remembered.runId);
          currentRunIdRef.current = null;
          streamStartedAtRef.current = null;
          clearTransientRunPresentation();
          tracedSetIsSending(false, `applyRemembered:skip-stale runId=${remembered.runId.slice(0, 8)}`);
          setActivityLabel(null);
          return;
        }
      } catch {
        // Fall back to the remembered run state when validation cannot complete.
      }
      currentRunIdRef.current = remembered.runId;
      streamStartedAtRef.current = remembered.startedAt;
      const streamText = sanitizeVisibleStreamText(remembered.streamText);
      chatStreamRef.current = streamText;
      setChatStream(streamText);
      tracedSetIsSending(true, `applyRemembered:restore runId=${remembered.runId.slice(0, 8)}`);
    };

    const loadAgents = () => {
      gateway.listAgents().then(async (result) => {
        if (result.agents.length > 0) {
          // Immediately provide basic agent data so UI has something to show
          onAgentsLoaded(result.agents);
          const enriched = await enrichAgentsWithIdentity(gateway, result.agents);
          onAgentsLoaded(enriched);
        }
        if (result.defaultId && result.defaultId !== 'main') {
          onDefaultAgentId?.(result.defaultId);
        }
      }).catch(() => {});
    };

    const scheduleReadyAgentLoad = () => {
      clearReadyAgentLoad();
      if (config?.backendKind !== 'hermes') {
        loadAgents();
        return;
      }
      readyAgentLoadTimerRef.current = setTimeout(() => {
        readyAgentLoadTimerRef.current = null;
        loadAgents();
      }, HERMES_READY_AGENT_LOAD_DELAY_MS);
    };

    const offConn = gateway.on('connection', ({ state }) => {
      const prevState = lastConnStateRef.current;
      lastConnStateRef.current = state;
      setConnectionState(state);
      if (config?.backendKind === 'hermes') {
        markHermesConnectTrace('connection_state', {
          state,
          prevState,
        });
      }
      if (state === 'ready') {
        clearDelayedConnectionRecovery();
        setPairingPending(false);
        if (prevState !== 'ready') {
          void applyRememberedRunStateToCurrentSession();
          if (config?.backendKind === 'hermes') {
            markHermesConnectTrace('connection_ready', {
              sessionKeyPresent: Boolean(sessionKeyRef.current),
            });
            markHermesConnectTrace('load_sessions_and_history_begin');
          }
          void loadSessionsAndHistory().finally(() => {
            if (config?.backendKind === 'hermes') {
              markHermesConnectTrace('load_sessions_and_history_done', {
                sessionKeyPresent: Boolean(sessionKeyRef.current),
              });
            }
            scheduleReadyAgentLoad();
          });
        }
      } else if (state === 'pairing_pending') {
        setPairingPending(true);
      }
      // Reset all streaming state on connection loss
      if (state !== 'ready' && prevState === 'ready') {
        clearReadyAgentLoad();
        const lostRunId = currentRunIdRef.current;
        agentActivityRef.current.clear();
        childSessionActivityRef.current.clear();
        onChildSessionActivityChange();
        resetAgentActiveCount();
        const key = sessionKeyRef.current;
        if (key && currentRunIdRef.current) {
          sessionRunStateRef.current.set(key, {
            runId: currentRunIdRef.current,
            streamText: chatStreamRef.current,
            startedAt: streamStartedAtRef.current ?? Date.now(),
          });
        }
        currentRunIdRef.current = null;
        streamStartedAtRef.current = null;
        clearTransientRunPresentation();
        tracedSetIsSending(false, `conn-drop:${state}:prevRun=${lostRunId?.slice(0, 8) ?? 'null'}`);
        setActivityLabel(null);
      }
    });

    const offPairing = gateway.on('pairingRequired', () => {
      setPairingPending(true);
    });

    const offPairingResolved = gateway.on('pairingResolved', ({ decision }) => {
      if (decision === 'approved') {
        setPairingPending(false);
      }
    });

    const currentState = gateway.getConnectionState();
    setConnectionState(currentState);
    // Only auto-load on initial mount when no session is selected yet.
    // On agent switch, switchSession already handles session selection;
    // calling loadSessionsAndHistory here would race and overwrite sessionKeyRef.
    // Reconnections are handled by the connection event handler above.
    if (currentState === 'ready' && !sessionKeyRef.current) {
      loadSessionsAndHistory();
    }

    const offRunStart = gateway.on('chatRunStart', ({ runId, sessionKey: evtKey }) => {
      // Ignore run-tracking events before handshake completes — these are
      // replayed events from the previous connection and would re-infect
      // cleared streaming state.
      if (lastConnStateRef.current !== 'ready') return;
      onRunSignal?.();
      const key = resolveEventSessionKey(evtKey);
      if (!key) return;
      markSessionRunStarted(sessionRunStateRef.current, key, runId);
      const actAgentId = agentIdFromSessionKey(key);
      if (actAgentId && actAgentId !== currentAgentId) {
        if (applyRunStart(agentActivityRef.current, actAgentId)) {
          onAgentActiveCountChange(1);
        }
      }
      if (actAgentId && key.includes(':subagent:')) {
        applyChildRunStart(childSessionActivityRef.current, key);
        onChildSessionActivityChange();
      }
      if (!sessionKeysMatch(key, sessionKeyRef.current)) return;
      if (currentRunIdRef.current && currentRunIdRef.current !== runId && !adoptPendingOptimisticRunId(key, runId)) {
        return;
      }
      if (currentRunIdRef.current) return;
      currentRunIdRef.current = runId;
      streamStartedAtRef.current = Date.now();
      tracedSetIsSending(true, `chatRunStart:${runId.slice(0, 8)}`);
      if (showDebug) dbg(`run start lifecycle: ${runId.slice(0, 8)} session=${evtKey}`);
    });

    const offDelta = gateway.on('chatDelta', ({ runId, sessionKey: evtKey, text }) => {
      if (lastConnStateRef.current !== 'ready') return;
      onRunSignal?.();
      if (shouldIgnoreRunId?.(runId)) return;
      if (isSilentReplyPrefixText(text)) return;
      const key = resolveEventSessionKey(evtKey);
      if (!key) return;
      markSessionRunDelta(sessionRunStateRef.current, key, runId, text);
      const actAgentId = agentIdFromSessionKey(key);
      if (actAgentId && actAgentId !== currentAgentId) {
        applyActivityDelta(agentActivityRef.current, actAgentId, text);
      }
      if (key.includes(':subagent:')) {
        applyChildDelta(childSessionActivityRef.current, key, text);
        onChildSessionActivityChange();
      }
      if (!sessionKeysMatch(key, sessionKeyRef.current)) return;
      if (currentRunIdRef.current && currentRunIdRef.current !== runId && !adoptPendingOptimisticRunId(key, runId)) return;
      if (!currentRunIdRef.current) {
        currentRunIdRef.current = runId;
        streamStartedAtRef.current = Date.now();
        tracedSetIsSending(true, `chatDelta:pickup:${runId.slice(0, 8)}`);
      }
      setActivityLabel(null);
      const current = chatStreamRef.current ?? '';
      if (!current || text.length >= current.length) {
        chatStreamRef.current = text;
        setChatStream(text);
      }
    });

    const offTool = gateway.on('chatTool', ({ runId, sessionKey: evtKey, toolCallId, name, phase, timestampMs, args, output, status }) => {
      if (lastConnStateRef.current !== 'ready') return;
      onRunSignal?.();
      if (shouldIgnoreRunId?.(runId)) return;
      const key = resolveEventSessionKey(evtKey);
      if (!key) return;
      markSessionRunStarted(sessionRunStateRef.current, key, runId);
      const actAgentId = agentIdFromSessionKey(key);
      if (actAgentId && actAgentId !== currentAgentId && phase === 'start') {
        applyActivityToolStart(agentActivityRef.current, actAgentId, name || 'tool');
      }
      if (phase === 'start' && key.includes(':subagent:')) {
        applyChildToolStart(childSessionActivityRef.current, key, name || 'tool');
        onChildSessionActivityChange();
      }
      if (!sessionKeysMatch(key, sessionKeyRef.current)) {
        if (showDebug) dbg(`drop tool UI update: session mismatch (evt=${key} cur=${sessionKeyRef.current})`);
        return;
      }
      if (currentRunIdRef.current && currentRunIdRef.current !== runId && !adoptPendingOptimisticRunId(key, runId)) {
        if (showDebug) dbg(`drop tool: run mismatch (evt=${runId} cur=${currentRunIdRef.current})`);
        return;
      }
      if (!currentRunIdRef.current) {
        currentRunIdRef.current = runId;
        streamStartedAtRef.current = Date.now();
        tracedSetIsSending(true, `chatTool:pickup:${runId.slice(0, 8)}`);
        if (showDebug) dbg(`pick up run from tool event: ${runId.slice(0, 8)}`);
      }

      const toolName = name || 'tool';
      const messageId = `toolcall_${toolCallId}`;
      const detail = typeof output === 'string'
        ? (output.length > 120_000 ? `${output.slice(0, 120_000)}... [truncated]` : output)
        : undefined;
      const hasError = status === 'error';

      if (showDebug) dbg(`tool stream: ${toolName} (${status}) phase=${phase} id=${toolCallId.slice(0, 12)}`);

      if (phase === 'start') {
        const startedAt = typeof timestampMs === 'number' && Number.isFinite(timestampMs)
          ? timestampMs
          : Date.now();
        setActivityLabel(formatToolActivity(toolName, (key, options) => i18n.t(key, { ns: 'chat', ...(options ?? {}) })));
        commitCurrentStreamSegment();
        const summary = formatToolOneLinerLocalized(toolName, args, (key, options) => i18n.t(key, { ns: 'chat', ...(options ?? {}) }));
        setToolMessages((prev) => withToolMessage(prev, messageId, {
          id: messageId,
          role: 'tool',
          text: '',
          toolName,
          toolStatus: 'running',
          toolSummary: summary,
          toolArgs: args ? (typeof args === 'string' ? args : JSON.stringify(args, null, 2)) : undefined,
          toolStartedAt: startedAt,
        }));
        return;
      }

      if (phase === 'update') {
        setToolMessages((prev) => withToolMessage(prev, messageId, {
          id: messageId,
          role: 'tool',
          text: '',
          toolName,
          toolStatus: 'running',
          toolSummary: formatToolOneLinerLocalized(toolName, args, (key, options) => i18n.t(key, { ns: 'chat', ...(options ?? {}) })),
          toolDetail: detail,
        }));
        return;
      }

      const base = formatToolOneLinerLocalized(toolName, args, (key, options) => i18n.t(key, { ns: 'chat', ...(options ?? {}) }));
      setToolMessages((prev) => {
        const existing = prev.find(m => m.id === messageId);
        const finishedAt = typeof timestampMs === 'number' && Number.isFinite(timestampMs)
          ? timestampMs
          : Date.now();
        const durationMs = existing?.toolStartedAt ? Math.max(0, finishedAt - existing.toolStartedAt) : undefined;

        return withToolMessage(prev, messageId, {
          id: messageId,
          role: 'tool',
          text: '',
          toolName,
          toolStatus: hasError ? 'error' : 'success',
          toolSummary: hasError
            ? i18n.t('Failed {{name}}', { ns: 'chat', name: base })
            : i18n.t('Completed {{name}}', { ns: 'chat', name: base }),
          toolDetail: detail,
          toolDurationMs: durationMs,
          toolFinishedAt: finishedAt,
        });
      });
      onToolSettled?.({
        runId,
        sessionKey: key,
        toolName,
        status: hasError ? 'error' : 'success',
      });
      onToolResult?.({
        runId,
        sessionKey: key,
        toolName,
        status: hasError ? 'error' : 'success',
      });
    });

    const offFinal = gateway.on('chatFinal', ({ runId, sessionKey: evtKey, message, usage }) => {
      onRunSignal?.();
      if (shouldIgnoreRunId?.(runId)) return;
      const key = resolveEventSessionKey(evtKey);
      if (key) {
        clearSessionRunState(sessionRunStateRef.current, key, runId);
        const actAgentId = agentIdFromSessionKey(key);
        if (actAgentId && actAgentId !== currentAgentId) {
          if (applyRunEnd(agentActivityRef.current, actAgentId)) {
            onAgentActiveCountChange(-1);
          }
        }
        if (key.includes(':subagent:')) {
          applyChildRunEnd(childSessionActivityRef.current, key);
          onChildSessionActivityChange();
        }
      }
      if (key && !sessionKeysMatch(key, sessionKeyRef.current)) {
        if (showDebug) dbg(`drop final UI update: session mismatch (evt=${key} cur=${sessionKeyRef.current})`);
        return;
      }

      const activeRunId = currentRunIdRef.current;
      const adoptedPendingRunId = !!key && activeRunId !== runId && adoptPendingOptimisticRunId(key, runId);
      const resolvedActiveRunId = adoptedPendingRunId ? currentRunIdRef.current : activeRunId;
      const isCurrentRun = !!resolvedActiveRunId && resolvedActiveRunId === runId;
      const activeRunStartedAt = streamStartedAtRef.current;
      const payloadText = extractText(message);
      const isSilentFinal = isAssistantSilentReplyMessage(message);
      const modelLabel = extractModelLabel(message as { provider?: string; model?: string } | undefined);
      const parsedUsage = parseUsage(usage);
      const finalId = `final_${runId}`;

      if (!isCurrentRun) {
        if (showDebug) dbg(`final out-of-band: run=${runId.slice(0, 8)} active=${activeRunId ? activeRunId.slice(0, 8) : 'none'}`);
        const shouldReload = shouldReloadHistoryForFinalEvent(message);
        const reconcileKey = evtKey || sessionKeyRef.current;
        if (shouldReload && reconcileKey) {
          setTimeout(() => {
            reconcileLatestAssistantFromHistory(reconcileKey, {
              appendIfMissing: false,
            }).catch(() => {});
          }, 30);
        }
        return;
      }

      if (showDebug) dbg('accept final: current run match');
      if (key) {
        sessionRunStateRef.current.delete(key);
        pendingOptimisticRunIdsRef.current.delete(key);
      }

      const streamText = chatStreamRef.current ?? '';
      const snapshotText = isSilentFinal
        ? ''
        : (payloadText.trim().length > 0 ? payloadText : streamText);

      if (snapshotText.trim()) {
        setMessages((prev) => {
          const exists = prev.some((m) => m.id === finalId);
          dbg(`final:setMessages run=${runId.slice(0, 8)} exists=${exists} snapshotLen=${snapshotText.length} | ${summarizeMessages('prev', prev)}`);
          if (exists) return prev;
          for (let index = prev.length - 1; index >= 0; index--) {
            const candidate = prev[index];
            if (!shouldMergeFinalIntoExistingAssistant({
              candidate,
              snapshotText,
              activeRunStartedAt,
            })) {
              continue;
            }

            const next = [...prev];
            next[index] = {
              ...candidate,
              id: finalId,
              text: snapshotText,
              timestampMs: Date.now(),
              modelLabel,
              usage: parsedUsage,
            };
            dbg(`final:merged run=${runId.slice(0, 8)} target=${candidate.id} | ${summarizeMessages('next', next)}`);
            return next;
          }
          const next = [...prev, {
            id: finalId,
            role: 'assistant' as const,
            text: snapshotText,
            timestampMs: Date.now(),
            modelLabel,
            usage: parsedUsage,
          }];
          dbg(`final:appended run=${runId.slice(0, 8)} | ${summarizeMessages('next', next)}`);
          return next;
        });
      }

      // Order matters: setMessages adds the final bubble first, so listData's
      // guard suppresses the streaming bubble. Then setChatStream(null) removes
      // it cleanly with no visible flash.
      clearTransientRunPresentation({ preserveCurrentStream: true, preserveToolMessages: true });
      tracedSetIsSending(false, `chatFinal:${runId.slice(0, 8)}`);
      setActivityLabel(null);
      currentRunIdRef.current = null;
      streamStartedAtRef.current = null;

      const shouldReload = shouldReloadHistoryForFinalEvent(message);
      const reconcileKey = evtKey || sessionKeyRef.current;
      if (shouldReload && reconcileKey) {
        setTimeout(() => {
          reconcileLatestAssistantFromHistory(reconcileKey, {
            appendIfMissing: true,
            minTimestampMs: activeRunStartedAt ?? undefined,
          }).catch(() => {});
        }, 30);
      }

      onStreamFinished?.();
    });

    const offAborted = gateway.on('chatAborted', ({ runId, sessionKey: evtKey }) => {
      onRunSignal?.();
      if (shouldIgnoreRunId?.(runId)) return;
      const key = resolveEventSessionKey(evtKey);
      if (key) {
        clearSessionRunState(sessionRunStateRef.current, key, runId);
        const actAgentId = agentIdFromSessionKey(key);
        if (actAgentId && actAgentId !== currentAgentId) {
          if (applyRunEnd(agentActivityRef.current, actAgentId)) {
            onAgentActiveCountChange(-1);
          }
        }
        if (key.includes(':subagent:')) {
          applyChildRunEnd(childSessionActivityRef.current, key);
          onChildSessionActivityChange();
        }
      }
      if (key && !sessionKeysMatch(key, sessionKeyRef.current)) {
        if (showDebug) dbg(`drop aborted UI update: session mismatch (evt=${key} cur=${sessionKeyRef.current})`);
        return;
      }
      if (currentRunIdRef.current && currentRunIdRef.current !== runId) {
        adoptPendingOptimisticRunId(key ?? sessionKeyRef.current ?? '', runId);
      }
      if (!currentRunIdRef.current || currentRunIdRef.current !== runId) {
        if (showDebug) dbg(`drop aborted: run mismatch (evt=${runId} cur=${currentRunIdRef.current})`);
        return;
      }
      if (showDebug) dbg('accept aborted: current run match');
      if (key) {
        sessionRunStateRef.current.delete(key);
        pendingOptimisticRunIdsRef.current.delete(key);
      }

      const snapshotText = chatStreamRef.current ?? '';
      const abortId = `abort_${runId}`;
      if (snapshotText.trim()) {
        setMessages((prev) => {
          const exists = prev.some((m) => m.id === abortId);
          if (exists) return prev;
          return [...prev, { id: abortId, role: 'assistant', text: snapshotText, timestampMs: Date.now() }];
        });
      }
      // Add a system message indicating the run was aborted
      setMessages((prev) => {
        const sysId = `sys_abort_${runId}`;
        const exists = prev.some((m) => m.id === sysId);
        if (exists) return prev;
        return [
          ...prev,
          {
            id: sysId,
            role: 'system',
            text: i18n.t('Run aborted by user.', { ns: 'chat' }),
            timestampMs: Date.now(),
          },
        ];
      });
      tracedSetIsSending(false, `chatAborted:${runId.slice(0, 8)}`);
      clearTransientRunPresentation({ preserveCurrentStream: true });
      setActivityLabel(null);
      currentRunIdRef.current = null;
      streamStartedAtRef.current = null;
    });

    const offChatErr = gateway.on('chatError', ({ runId, sessionKey: evtKey, message }) => {
      onRunSignal?.();
      if (shouldIgnoreRunId?.(runId)) return;
      const key = resolveEventSessionKey(evtKey);
      if (key) {
        clearSessionRunState(sessionRunStateRef.current, key, runId);
        const actAgentId = agentIdFromSessionKey(key);
        if (actAgentId && actAgentId !== currentAgentId) {
          if (applyRunEnd(agentActivityRef.current, actAgentId)) {
            onAgentActiveCountChange(-1);
          }
        }
        if (key.includes(':subagent:')) {
          applyChildRunEnd(childSessionActivityRef.current, key);
          onChildSessionActivityChange();
        }
      }
      if (key && !sessionKeysMatch(key, sessionKeyRef.current)) {
        if (showDebug) dbg(`drop chatError UI update: session mismatch (evt=${key} cur=${sessionKeyRef.current})`);
        return;
      }
      if (currentRunIdRef.current && currentRunIdRef.current !== runId) {
        adoptPendingOptimisticRunId(key ?? sessionKeyRef.current ?? '', runId);
      }
      if (!currentRunIdRef.current || currentRunIdRef.current !== runId) {
        if (showDebug) dbg(`drop chatError: run mismatch (evt=${runId} cur=${currentRunIdRef.current})`);
        return;
      }
      if (showDebug) dbg('accept chatError: current run match');
      if (key) {
        sessionRunStateRef.current.delete(key);
        pendingOptimisticRunIdsRef.current.delete(key);
      }
      tracedSetIsSending(false, `chatError:${runId.slice(0, 8)}`);
      clearTransientRunPresentation();
      setActivityLabel(null);
      currentRunIdRef.current = null;
      streamStartedAtRef.current = null;
      setMessages((prev) => [...prev, { id: makeId('err'), role: 'system', text: `Error: ${message}` }]);
    });

    const offErr = gateway.on('error', ({ code, message, retryable, hint }) => {
      if (shouldSuppressHermesStartupRecoveryMessage({
        backendKind: config?.backendKind,
        sessionKey: sessionKeyRef.current,
        connectionState: gateway.getConnectionState(),
        code,
        message,
      })) {
        clearDelayedConnectionRecovery();
        if (showDebug) {
          dbg(`suppress Hermes startup error: code=${code ?? 'unknown'} message=${message ?? ''}`);
        }
        return;
      }
      if (code === 'local_tls_unsupported') {
        clearDelayedConnectionRecovery();
        const signature = `${code}:${message}:${hint ?? ''}`;
        const now = Date.now();
        const last = lastFatalErrorRef.current;
        if (last && last.signature === signature && now - last.at < 20_000) {
          return;
        }
        lastFatalErrorRef.current = { signature, at: now };
        setMessages((prev) => [...prev, {
          id: makeId('err'),
          role: 'system',
          text: i18n.t('Direct local TLS gateway connections are not supported in Clawket mobile yet. Disable OpenClaw gateway TLS for LAN pairing, or use Relay/Tailscale instead.', { ns: 'chat' }),
        }]);
        return;
      }
      if (shouldShowConnectionRecoveryMessage(code, message)) {
        if (shouldDelayConnectionRecoveryMessage(code, message)) {
          scheduleDelayedConnectionRecovery({ code, message });
          return;
        }
        clearDelayedConnectionRecovery();
        appendConnectionRecoveryMessage(message, code);
        return;
      }
      if (retryable === false) {
        clearDelayedConnectionRecovery();
        const signature = `${code}:${message}:${hint ?? ''}`;
        const now = Date.now();
        const last = lastFatalErrorRef.current;
        if (last && last.signature === signature && now - last.at < 20_000) {
          return;
        }
        lastFatalErrorRef.current = { signature, at: now };
        const connectionRecoveryText = i18n.t('Connection Error: Check your network connection and that OpenClaw or Hermes is running, or run "clawket pair" on your computer, then try again.', { ns: 'chat' });
        setMessages((prev) => [...prev, {
          id: makeId('err'),
          role: 'system',
          text: formatSystemErrorMessage(connectionRecoveryText, message),
        }]);
        return;
      }
      setMessages((prev) => [...prev, { id: makeId('err'), role: 'system', text: `Error: ${message}` }]);
    });

    const offApprovalReq = execApprovalEnabled
      ? gateway.on('execApprovalRequested', (evt) => {
          // Only show approvals for the current session (if sessionKey matches)
          if (evt.request.sessionKey && !sessionKeysMatch(evt.request.sessionKey, sessionKeyRef.current)) return;
          const msgId = `approval_${evt.id}`;
          const command = evt.request.commandArgv
            ? evt.request.commandArgv.join(' ')
            : evt.request.command;
          setMessages((prev) => {
            if (prev.some((m) => m.id === msgId)) return prev;
            return [...prev, {
              id: msgId,
              role: 'system' as const,
              text: '',
              timestampMs: evt.createdAtMs,
              approval: {
                id: evt.id,
                command,
                cwd: evt.request.cwd,
                host: evt.request.host,
                expiresAtMs: evt.expiresAtMs,
                status: 'pending',
              },
            }];
          });
        })
      : undefined;

    const offApprovalRes = execApprovalEnabled
      ? gateway.on('execApprovalResolved', (evt) => {
          const msgId = `approval_${evt.id}`;
          const decision = evt.decision;
          const status = decision === 'deny' ? 'denied' as const : 'allowed' as const;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msgId && m.approval
                ? { ...m, approval: { ...m.approval, status } }
                : m,
            ),
          );
        })
      : undefined;

    const offCompaction = gateway.on('chatCompaction', ({ sessionKey: evtKey, phase }) => {
      if (evtKey && !sessionKeysMatch(evtKey, sessionKeyRef.current)) return;
      if (compactionTimerRef.current) {
        clearTimeout(compactionTimerRef.current);
        compactionTimerRef.current = null;
      }
      if (phase === 'start') {
        setCompactionNotice(i18n.t('Compacting context...', { ns: 'chat' }));
        compactionTimerRef.current = setTimeout(() => {
          setCompactionNotice(null);
          compactionTimerRef.current = null;
        }, 5000);
      } else if (phase === 'end') {
        setCompactionNotice(null);
      }
    });

    const offSeqGap = gateway.on('seqGap', ({ sessionKey: evtKey }) => {
      const key = resolveEventSessionKey(evtKey);
      if (key && !sessionKeysMatch(key, sessionKeyRef.current)) return;
      if (showDebug) dbg(`seqGap: resetting stream state (session=${evtKey})`);
      // Sequence gap means we missed events — clear streaming state and reconcile
      const hadActiveRun = !!currentRunIdRef.current || !!chatStreamRef.current;
      const activeRunStartedAt = streamStartedAtRef.current;
      currentRunIdRef.current = null;
      streamStartedAtRef.current = null;
      clearTransientRunPresentation();
      tracedSetIsSending(false, 'seqGap');
      setActivityLabel(null);
      const reconcileKey = key || sessionKeyRef.current;
      if (reconcileKey) {
        reconcileLatestAssistantFromHistory(reconcileKey, {
          appendIfMissing: hadActiveRun,
          minTimestampMs: activeRunStartedAt ?? undefined,
        }).catch(() => {});
      }
    });

    const offHealth = gateway.on('health', (payload) => {
      if (showDebug) dbg(`health: status=${payload.status ?? 'unknown'}`);
    });

    const offTick = gateway.on('tick', () => {
      // Transport-level keep-alive — no action needed
    });

    if (config?.url) {
      gateway.configure(config);
      if (config.backendKind === 'hermes') {
        markHermesConnectTrace('gateway_connect_call', {
          transport: config.transportKind,
        });
      }
      gateway.connect();
    }

    return () => {
      clearDelayedConnectionRecovery();
      clearReadyAgentLoad();
      offConn();
      offPairing();
      offPairingResolved();
      offRunStart();
      offDelta();
      offTool();
      offFinal();
      offAborted();
      offChatErr();
      offErr();
      offApprovalReq?.();
      offApprovalRes?.();
      offCompaction();
      offSeqGap();
      offHealth();
      offTick();
    };
  }, [
    compactionTimerRef,
    config,
    currentAgentId,
    execApprovalEnabled,
    currentRunIdRef,
    dbg,
    gateway,
    loadSessionsAndHistory,
    onAgentsLoaded,
    onDefaultAgentId,
    reconcileLatestAssistantFromHistory,
    shouldIgnoreRunId,
    sessionKeyRef,
    setChatStream,
    setCompactionNotice,
    setConnectionState,
    setIsSending,
    setMessages,
    setToolMessages,
    commitCurrentStreamSegment,
    clearTransientRunPresentation,
    setActivityLabel,
    setPairingPending,
    showDebug,
    streamStartedAtRef,
    lastConnStateRef,
    chatStreamRef,
    sessionRunStateRef,
    agentActivityRef,
    onAgentActiveCountChange,
    resetAgentActiveCount,
    onRunSignal,
    onToolSettled,
    onToolResult,
  ]);
}
