import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  AppStateStatus,
  Keyboard,
  Platform,
} from "react-native";
import { useIsFocused } from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as Network from "expo-network";
import { useTranslation } from "react-i18next";
import {
  isImageAttachmentMimeType,
  normalizeAttachmentMimeType,
  supportsFileAttachments,
  type AgentAdapter,
  type AgentDescriptor,
  type ConnectionState as AdapterConnectionState,
  type SessionDescriptor,
  type SessionHistory,
} from "@clawket/agent-protocol";
import {
  type AdapterChatUpdate,
  useAdapterChatEvents,
} from "./useAdapterChatEvents";
import type { ComposerHandle } from "../components/ui/Composer";
import { SLASH_COMMANDS, SlashCommand } from "../data/slash-commands";
import { useChatImagePicker } from "../hooks/useChatImagePicker";
import * as DocumentPicker from "expo-document-picker";

import { useChatImagePreview } from "../hooks/useChatImagePreview";
import { analyticsEvents } from "../services/analytics/events";
import { recordSuccessfulSendForAutomaticReview } from "../services/auto-app-review";
import { cacheMessageImages } from "../services/image-cache";
import { stopSpeechRecognitionAsync } from "../services/speech/speechRecognition";
import { StorageService } from "../services/storage";
import { ConnectionState, SessionInfo } from "../types";
import { PendingImage, UiMessage } from "../types/chat";
import {
  isAssistantDeliveryMirrorMessage,
  isAssistantSilentReplyMessage,
  sessionLabel,
  shouldHideMessage,
} from "../utils/chat-message";
import { sessionKeysMatch } from "../utils/session-key";
import { useChatAutoCache } from "../hooks/useChatAutoCache";
import { APPROVE_COMMAND, HISTORY_PAGE_SIZE, MAX_IMAGES } from "./constants";
import type { ChatControllerOptions } from "./types";
import { useAppContext } from "../contexts/AppContext";
import {
  AgentActivity,
  agentIdFromSessionKey,
  applyDelta as applyActivityDelta,
  applyRunEnd,
  applyRunStart,
  applyToolStart as applyActivityToolStart,
} from "./agentActivity";
import {
  applyChildDelta,
  applyChildRunEnd,
  applyChildRunStart,
  applyChildToolStart,
  ChildSessionActivity,
} from "./childSessionActivity";
import { resolveCachedAgentIdentity } from "./cacheAgentIdentity";
import { shouldClearComposerInput } from "./composerClearPolicy";
import { canSendMessage } from "./composerInteractionPolicy";
import { deriveCurrentSessionActivity } from "./currentSessionActivity";
import { hasCompletedAssistantForRememberedRun } from "./runStateValidation";
import { useChatHistoryState } from "./useChatHistoryState";
import { buildLiveRunListData, StreamSegment } from "./liveRunThread";
import {
  clearSessionRunState,
  markSessionRunDelta,
  markSessionRunStarted,
  SessionRunState,
} from "./sessionRunState";
import { shouldAdoptPendingOptimisticRunId } from "./pendingOptimisticRun";
import { preserveOptimisticAssistantMessage } from "./historyMergePolicy";
import {
  FOREGROUND_REFRESH_AFTER_RECONNECT_TIMEOUT_MS,
  getForegroundRefreshDelayMs,
  shouldReconnectBeforeForegroundRefresh,
} from "./foregroundRefreshPolicy";
import {
  formatToolActivity,
  formatToolOneLinerLocalized,
} from "../utils/tool-display";
import { useChatVoiceInput } from "./useChatVoiceInput";
import { useChatModelPicker } from "./useChatModelPicker";
import { useChatCommandPicker } from "./useChatCommandPicker";
import { isMacCatalyst } from "../utils/platform";
import {
  buildUiFileAttachments,
  extractSlashCommand,
  readFileAsBase64,
  buildPromptAttachments,
  resolveAttachmentOnlyFallbackKey,
  sanitizeVisibleStreamText,
  summarizeAttachmentFormats,
} from "./chatControllerUtils";
import { useChatComposerDraft } from "./useChatComposerDraft";
import { useChatPasteAttachments } from "./useChatPasteAttachments";
import { useChatAgentIdentity } from "./useChatAgentIdentity";
import { useBufferedDebugLog } from "./useBufferedDebugLog";
import { preparePendingImagesForSend } from "./preparePendingImagesForSend";
import { mapAdapterSession, mapAdapterSessionPatch } from "./adapterChatMapping";

type SilentCommandProbe = {
  sessionKey: string;
  latestText: string;
  finishing: boolean;
  timeout: ReturnType<typeof setTimeout> | null;
  resolve: (value: string) => void;
  reject: (reason: Error) => void;
};

function mapAdapterConnectionState(state: AdapterConnectionState): ConnectionState {
  switch (state) {
    case "idle":
      return "idle";
    case "connecting":
      return "connecting";
    case "handshaking":
      return "challenging";
    case "ready":
      return "ready";
    case "reconnecting":
      return "reconnecting";
    case "offline":
    case "error":
      return "closed";
  }
}

function mapAdapterAgent(agent: AgentDescriptor) {
  return {
    id: agent.agentId,
    name: agent.name,
    identity: {
      name: agent.name,
      emoji: agent.emoji,
      avatarUrl: agent.avatarUrl,
    },
  };
}

function latestVisibleAssistant(history: SessionHistory): {
  text: string;
  timestampMs: number;
} | null {
  for (let index = history.messages.length - 1; index >= 0; index -= 1) {
    const message = history.messages[index];
    if (message.role !== "assistant") continue;
    if (isAssistantDeliveryMirrorMessage(message)) continue;
    if (isAssistantSilentReplyMessage(message)) continue;
    const text = message.text.trim();
    if (!text) continue;
    return { text: message.text, timestampMs: message.timestampMs ?? 0 };
  }
  return null;
}

function reconnectAdapter(adapter: AgentAdapter | null): void {
  if (!adapter) return;
  adapter.disconnect();
  void adapter.connect().catch(() => undefined);
}

function mergeStreamText(previous: string | null, incoming: string): string {
  if (!previous || incoming.startsWith(previous)) return incoming;
  if (previous.startsWith(incoming)) return previous;
  return `${previous}${incoming}`;
}

function withToolMessage(previous: UiMessage[], message: UiMessage): UiMessage[] {
  const index = previous.findIndex((candidate) => candidate.id === message.id);
  if (index < 0) return [...previous, message];
  const next = [...previous];
  next[index] = { ...previous[index], ...message, id: message.id };
  return next;
}

function appendUniqueMessage(previous: UiMessage[], message: UiMessage): UiMessage[] {
  return previous.some((candidate) => candidate.id === message.id)
    ? previous
    : [...previous, message];
}

function shouldMergeFinalMessage(
  candidate: UiMessage,
  finalText: string,
  activeRunStartedAt: number | null,
): boolean {
  if (candidate.role !== "assistant") return false;
  if (candidate.id.startsWith("final_") || candidate.id.startsWith("abort_")) return false;
  const candidateText = candidate.text.replace(/\s+/g, " ").trim();
  const normalizedFinal = finalText.replace(/\s+/g, " ").trim();
  if (!candidateText || !normalizedFinal) return false;
  const candidateTimestamp = candidate.timestampMs ?? 0;
  if (
    activeRunStartedAt
    && candidateTimestamp > 0
    && candidateTimestamp + 1_000 < activeRunStartedAt
  ) {
    return false;
  }
  return candidateText.includes(normalizedFinal) || normalizedFinal.includes(candidateText);
}

export function useChatController({
  adapter,
  debugMode,
  showAgentAvatar,
  chatSessionRequest,
  clearChatSessionRequest,
}: ChatControllerOptions) {
  const appContext = useAppContext();
  const { t, i18n } = useTranslation("chat");
  const { speechRecognitionLanguage } = appContext;
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    adapter ? mapAdapterConnectionState(adapter.state) : "idle",
  );
  const [input, setInput] = useState("");
  const composerRef = useRef<ComposerHandle>(null);
  const [isSending, setIsSending] = useState(false);
  const [isPreparingSend, setIsPreparingSend] = useState(false);
  const [pairingPending, setPairingPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [compactionNotice, setCompactionNotice] = useState<string | null>(null);
  const [activityLabel, setActivityLabel] = useState<string | null>(null);
  const [slashSuggestionsDismissed, setSlashSuggestionsDismissed] =
    useState(false);
  const [slashMenuForced, setSlashMenuForced] = useState(false);
  const [staticThinkPickerVisible, setStaticThinkPickerVisible] =
    useState(false);
  const {
    pendingImages,
    setPendingImages,
    pickImage,
    clearPendingImages,
    removePendingImage,
    canAddMoreImages,
  } = useChatImagePicker(MAX_IMAGES);
  const {
    onPasteFiles,
    onPasteFailed,
  } = useChatPasteAttachments({
    pendingAttachments: pendingImages,
    setPendingAttachments: setPendingImages,
    maxAttachments: MAX_IMAGES,
    capabilities: adapter?.capabilities,
  });

  const pickFile = useCallback(async () => {
    if (!supportsFileAttachments(adapter?.capabilities)) return;
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    if (!asset.uri) return;
    try {
      const b64 = await readFileAsBase64(asset.uri);
      const img = {
        uri: asset.uri,
        base64: b64,
        mimeType: normalizeAttachmentMimeType(asset.mimeType),
        fileName: asset.name,
      };
      setPendingImages((prev: PendingImage[]) =>
        [...prev, img].slice(0, MAX_IMAGES),
      );
    } catch {
      /* skip */
    }
  }, [adapter?.capabilities, setPendingImages]);

  const takePhoto = useCallback(async () => {
    const IP = await import("expo-image-picker");
    const res = isMacCatalyst
      ? await IP.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        quality: 0.8,
        base64: true,
        exif: false,
      })
      : await (async () => {
        const perm = await IP.requestCameraPermissionsAsync();
        if (!perm.granted) return { canceled: true, assets: [] };
        return IP.launchCameraAsync({
          quality: 0.8,
          base64: true,
          exif: false,
        });
      })();
    if (!res.canceled && res.assets?.[0]?.base64) {
      const a = res.assets[0];
      setPendingImages((prev: PendingImage[]) =>
        [
          ...prev,
          {
            uri: a.uri,
            base64: a.base64!,
            mimeType: normalizeAttachmentMimeType(a.mimeType, "image/jpeg"),
            width: a.width,
            height: a.height,
          },
        ].slice(0, MAX_IMAGES),
      );
    }
  }, [setPendingImages]);

  const preview = useChatImagePreview();
  const showDebug = debugMode ?? false;
  const { logs: debugLog, appendDebugLog: dbg } = useBufferedDebugLog(showDebug);
  const hasAdapter = adapter !== null;
  const thinkingLevelOptions = useMemo(
    () => adapter?.capabilities.thinkingLevels
      ? (adapter.management?.models?.listThinkingLevels?.() ?? [])
      : [],
    [adapter],
  );

  const sessionKeyRef = useRef<string | null>(null);
  const lastAdapterStateRef = useRef<AdapterConnectionState>("idle");
  const lastAdapterRef = useRef<AgentAdapter | null>(adapter);
  const sendPreflightInFlightRef = useRef(false);
  const sendTriggerGuardRef = useRef(false);

  const [chatStream, setChatStream] = useState<string | null>(null);
  const [chatStreamSegments, setChatStreamSegments] = useState<StreamSegment[]>(
    [],
  );
  const [chatToolMessages, setChatToolMessages] = useState<UiMessage[]>([]);
  const currentRunIdRef = useRef<string | null>(null);
  const chatStreamRef = useRef<string | null>(null);
  const chatStreamSegmentsRef = useRef<StreamSegment[]>([]);
  const chatToolMessagesRef = useRef<UiMessage[]>([]);
  const streamStartedAtRef = useRef<number | null>(null);
  const lastRunSignalAtRef = useRef(0);
  const lastRunRecoveryProbeAtRef = useRef(0);
  const pendingRunTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const foregroundRunRecoveryTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const foregroundRefreshTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const foregroundRefreshProbeSeqRef = useRef(0);
  const toolSettledRecoveryTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const postStreamHistoryRefreshTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const runRecoveryInFlightRef = useRef<{
    sessionKey: string;
    promise: Promise<void>;
  } | null>(null);
  const recentRunRecoveryRef = useRef<{
    sessionKey: string;
    at: number;
  } | null>(null);
  const historyReloadInFlightRef = useRef<{
    sessionKey: string;
    promise: Promise<number>;
  } | null>(null);
  const recentHistoryReloadRef = useRef<{
    sessionKey: string;
    at: number;
  } | null>(null);
  const sessionRunStateRef = useRef<Map<string, SessionRunState>>(new Map());
  const pendingOptimisticRunIdsRef = useRef<Map<string, string>>(new Map());
  const agentActivityRef = useRef<Map<string, AgentActivity>>(new Map());
  const childSessionActivityRef = useRef<Map<string, ChildSessionActivity>>(new Map());
  const lastConfirmedTransportAtRef = useRef(0);
  const forceSendProbeUntilRef = useRef(0);
  const [agentActiveCount, setAgentActiveCount] = useState(0);
  const [childSessionActivityVersion, setChildSessionActivityVersion] = useState(0);
  const onAgentActiveCountChange = useCallback((delta: 1 | -1) => {
    setAgentActiveCount((prev) => Math.max(0, prev + delta));
  }, []);
  const resetAgentActiveCount = useCallback(() => setAgentActiveCount(0), []);
  const onChildSessionActivityChange = useCallback(() => {
    setChildSessionActivityVersion((prev) => prev + 1);
  }, []);
  const clearChildSessionActivities = useCallback((sessionKeys: string[]) => {
    if (sessionKeys.length === 0) return;
    let changed = false;
    for (const sessionKey of sessionKeys) {
      if (childSessionActivityRef.current.delete(sessionKey)) {
        changed = true;
      }
    }
    if (changed) {
      onChildSessionActivityChange();
    }
  }, [onChildSessionActivityChange]);
  const compactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silentCommandProbesRef = useRef<Map<string, SilentCommandProbe>>(new Map());

  const {
    toggleVoiceInput,
    voiceInputActive,
    voiceInputDisabled,
    voiceInputLevel,
    voiceInputState,
    voiceInputSupported,
  } = useChatVoiceInput({
    composerRef,
    input,
    speechRecognitionLanguage,
    setInput,
    t,
  });

  // Pending run inactivity timeout: if no events arrive for this duration
  // while isSending is true, force-clear the stuck state.
  const PENDING_RUN_INACTIVITY_MS = 22_000;
  const HISTORY_COMPLETION_IDLE_MS = 8_000;
  const POST_STREAM_HISTORY_REFRESH_DELAY_MS = 300;
  const RUN_RECOVERY_MIN_INTERVAL_MS = 1_500;
  const HISTORY_RELOAD_MIN_INTERVAL_MS = 1_500;
  const ORPHAN_RUNNING_TOOL_GRACE_MS = 20_000;
  const SEND_FAST_PROBE_TIMEOUT_MS = 1500;
  const SEND_HEALTH_WINDOW_MS = 3_000;
  const SEND_FORCE_PROBE_GRACE_MS = 8_000;

  const clearPendingRunTimeout = useCallback(() => {
    if (pendingRunTimeoutRef.current) {
      clearTimeout(pendingRunTimeoutRef.current);
      pendingRunTimeoutRef.current = null;
    }
  }, []);

  const clearToolSettledRecoveryTimer = useCallback(() => {
    if (toolSettledRecoveryTimerRef.current) {
      clearTimeout(toolSettledRecoveryTimerRef.current);
      toolSettledRecoveryTimerRef.current = null;
    }
  }, []);

  const clearPostStreamHistoryRefreshTimer = useCallback(() => {
    if (postStreamHistoryRefreshTimerRef.current) {
      clearTimeout(postStreamHistoryRefreshTimerRef.current);
      postStreamHistoryRefreshTimerRef.current = null;
    }
  }, []);

  const clearTransientRunPresentation = useCallback(
    (options?: { preserveCurrentStream?: boolean; preserveToolMessages?: boolean }) => {
      setChatStreamSegments([]);
      if (!options?.preserveToolMessages) {
        setChatToolMessages([]);
      }
      if (options?.preserveCurrentStream) {
        return;
      }
      chatStreamRef.current = null;
      setChatStream(null);
    },
    [],
  );

  const commitCurrentStreamSegment = useCallback((timestampMs?: number) => {
    const currentText = chatStreamRef.current ?? "";
    if (!currentText.trim()) {
      return;
    }
    const ts = timestampMs ?? Date.now();
    setChatStreamSegments((prev) => [
      ...prev,
      {
        id: `stream_segment_${ts}_${prev.length}`,
        text: currentText,
        timestampMs: ts,
      },
    ]);
    chatStreamRef.current = null;
    setChatStream(null);
  }, []);

  const armPendingRunTimeout = useCallback(() => {
    clearPendingRunTimeout();
    pendingRunTimeoutRef.current = setTimeout(() => {
      pendingRunTimeoutRef.current = null;
      // Only fire if a run is still tracked
      if (!currentRunIdRef.current) return;
      if (showDebug)
        dbg(
          `[isSending] → false | reason=pendingRunTimeout (${PENDING_RUN_INACTIVITY_MS}ms inactivity) | runId=${currentRunIdRef.current?.slice(0, 8)}`,
        );
      const sessionKey = sessionKeyRef.current;
      if (sessionKey) {
        sessionRunStateRef.current.delete(sessionKey);
        pendingOptimisticRunIdsRef.current.delete(sessionKey);
      }
      currentRunIdRef.current = null;
      streamStartedAtRef.current = null;
      clearTransientRunPresentation();
      setIsSending(false);
      setActivityLabel(null);
    }, PENDING_RUN_INACTIVITY_MS);
  }, [clearPendingRunTimeout, clearTransientRunPresentation]);

  const {
    initialChatPreview,
    mainSessionKey,
    currentAgentId,
    agents,
    setAgents,
    setCurrentAgentId,
    pendingAgentSwitch,
    clearPendingAgentSwitch,
    execApprovalEnabled,
    pendingChatNotificationOpen,
    clearPendingChatNotificationOpen,
    pendingChatInput,
    clearPendingChatInput,
    pendingMainSessionSwitch,
    clearPendingMainSessionSwitch,
  } = appContext;
  const gatewayConfigId = adapter?.connection.id ?? null;
  const history = useChatHistoryState({
    adapter,
    dbg,
    t,
    sessionKeyRef,
    mainSessionKey,
    gatewayConfigId,
    currentAgentId,
    initialPreview: initialChatPreview,
  });

  // Auto-cache messages to local storage
  const cacheAgentIdentity = resolveCachedAgentIdentity(
    agents,
    currentAgentId,
    history.sessionKey,
  );
  const cacheAgentName = cacheAgentIdentity.agentName;
  const currentSessionInfo = history.sessions.find(
    (s) => s.key === history.sessionKey,
  );
  const cacheSessionLabel = currentSessionInfo
    ? sessionLabel(currentSessionInfo, { currentAgentName: cacheAgentName })
    : undefined;
  const agentIdentity = useChatAgentIdentity({
    agents,
    cacheAgentName,
    currentAgentId,
    currentSessionInfo,
    adapter,
    gatewayConfigId,
    initialPreview: initialChatPreview,
    mainSessionKey,
    sessionKey: history.sessionKey,
  });
  useChatAutoCache({
    gatewayConfigId,
    agentId: cacheAgentIdentity.agentId,
    agentName: cacheAgentIdentity.agentName,
    agentEmoji: cacheAgentIdentity.agentEmoji,
    sessionKey: history.sessionKey,
    sessionId: currentSessionInfo?.sessionId,
    sessionLabel: cacheSessionLabel,
    messages: history.messages,
    historyLoaded: history.historyLoaded,
  });

  const persistCurrentRunState = useCallback(
    (key: string | null, options?: { clear?: boolean }) => {
      if (!key) return;
      if (options?.clear) {
        sessionRunStateRef.current.delete(key);
        return;
      }
      const runId = currentRunIdRef.current;
      if (!runId) {
        sessionRunStateRef.current.delete(key);
        return;
      }
      sessionRunStateRef.current.set(key, {
        runId,
        streamText: chatStreamRef.current,
        startedAt: streamStartedAtRef.current ?? Date.now(),
      });
    },
    [],
  );

  const {
    clearPersistedDraft,
    resetDraftLoadState,
  } = useChatComposerDraft({
    currentAgentId,
    input,
    sessionKey: history.sessionKey,
    setInput,
  });

  const clearActiveRunState = useCallback(
    (sessionKey: string | null, reason: string, runId?: string | null) => {
      if (showDebug) {
        dbg(
          `[isSending] → false | reason=${reason} | runId=${(runId ?? currentRunIdRef.current)?.slice(0, 8) ?? "null"} | session=${sessionKey ?? "null"}`,
        );
      }
      if (sessionKey) {
        pendingOptimisticRunIdsRef.current.delete(sessionKey);
        if (runId) {
          const remembered = sessionRunStateRef.current.get(sessionKey);
          if (remembered?.runId === runId) {
            sessionRunStateRef.current.delete(sessionKey);
          }
        } else {
          sessionRunStateRef.current.delete(sessionKey);
        }
      }
      currentRunIdRef.current = null;
      streamStartedAtRef.current = null;
      lastRunSignalAtRef.current = 0;
      lastRunRecoveryProbeAtRef.current = 0;
      clearToolSettledRecoveryTimer();
      clearTransientRunPresentation();
      setIsSending(false);
      setActivityLabel(null);
    },
    [
      clearToolSettledRecoveryTimer,
      clearTransientRunPresentation,
      dbg,
      showDebug,
    ],
  );

  const syncDerivedSessionActivity = useCallback(
    (reason: string) => {
      const key = history.sessionKey;
      const remembered = key
        ? (sessionRunStateRef.current.get(key) ?? null)
        : null;

      // During session/gateway switches, history can still be stale for the newly
      // selected key. Avoid deriving a false positive sending state from old rows.
      if (!history.historyLoaded && !remembered && !currentRunIdRef.current) {
        setIsSending(false);
        setActivityLabel(null);
        return;
      }

      const derived = deriveCurrentSessionActivity(
        history.messages,
        remembered,
      );

      if (!derived.isSending) {
        if (currentRunIdRef.current || chatStreamRef.current) {
          clearActiveRunState(key, `${reason}:derived-idle`);
          return;
        }
        setIsSending(false);
        if (!chatStreamRef.current) {
          setActivityLabel(null);
        }
        return;
      }

      if (!currentRunIdRef.current && remembered) {
        currentRunIdRef.current = remembered.runId;
        streamStartedAtRef.current = remembered.startedAt;
        const streamText = sanitizeVisibleStreamText(remembered.streamText);
        chatStreamRef.current = streamText;
        setChatStream(streamText);
        lastRunSignalAtRef.current = Math.max(
          lastRunSignalAtRef.current,
          remembered.startedAt,
        );
      }

      if (
        !derived.hasTrackedRun &&
        derived.hasRunningTool &&
        !currentRunIdRef.current
      ) {
        const toolTimestampMs = derived.latestRunningToolTimestampMs ?? 0;
        const toolAgeMs =
          toolTimestampMs > 0
            ? Date.now() - toolTimestampMs
            : Number.POSITIVE_INFINITY;

        if (toolAgeMs >= ORPHAN_RUNNING_TOOL_GRACE_MS) {
          clearActiveRunState(key, `${reason}:stale-running-tool`);
          return;
        }

        if (key && Date.now() - lastRunRecoveryProbeAtRef.current >= 5_000) {
          lastRunRecoveryProbeAtRef.current = Date.now();
          history
            .loadHistory(key, history.historyLimitRef.current)
            .catch(() => {});
        }
      }

      setIsSending(true);
      if (
        !chatStreamRef.current &&
        !currentRunIdRef.current &&
        derived.hasRunningTool &&
        derived.latestRunningToolName
      ) {
        setActivityLabel(formatToolActivity(derived.latestRunningToolName, t));
      }
    },
    [
      clearActiveRunState,
      history.historyLimitRef,
      history.historyLoaded,
      history.loadHistory,
      history.messages,
      history.sessionKey,
      t,
    ],
  );

  const revalidateRecoveredRun = useCallback(
    async (sessionKey: string, reason: string) => {
      const remembered = sessionRunStateRef.current.get(sessionKey);
      if (!remembered) {
        if (showDebug)
          dbg(
            `revalidate:skip no-remembered session=${sessionKey} reason=${reason}`,
          );
        return;
      }

      try {
        if (showDebug) {
          dbg(
            `revalidate:start session=${sessionKey} reason=${reason} runId=${remembered.runId.slice(0, 8)} startedAt=${remembered.startedAt}`,
          );
        }
        if (!adapter) return;
        const historyResult = await adapter.loadSession(sessionKey, { limit: 12 });
        if (sessionKeyRef.current !== sessionKey) return;

        const latestAssistant = latestVisibleAssistant(historyResult);
        const latestAssistantText = latestAssistant?.text ?? "";
        const latestAssistantTs = latestAssistant?.timestampMs ?? 0;

        if (!latestAssistantText.trim()) {
          if (showDebug)
            dbg(
              `revalidate:no-assistant session=${sessionKey} reason=${reason}`,
            );
          return;
        }
        const startedAt = remembered.startedAt || 0;
        if (latestAssistantTs > 0 && latestAssistantTs + 1000 < startedAt) {
          if (showDebug)
            dbg(
              `revalidate:stale-assistant session=${sessionKey} reason=${reason} latestTs=${latestAssistantTs} startedAt=${startedAt}`,
            );
          return;
        }

        await history.reconcileLatestAssistantFromHistory(sessionKey, {
          appendIfMissing: true,
          minTimestampMs: startedAt,
        });
        if (sessionKeyRef.current !== sessionKey) return;
        const liveRunStillActive = currentRunIdRef.current === remembered.runId;
        const idleMs = Date.now() - lastRunSignalAtRef.current;
        if (liveRunStillActive && idleMs < HISTORY_COMPLETION_IDLE_MS) {
          if (showDebug)
            dbg(
              `revalidate:defer-clear session=${sessionKey} reason=${reason} idleMs=${idleMs}`,
            );
          return;
        }
        if (showDebug)
          dbg(
            `revalidate:resolved session=${sessionKey} reason=${reason} latestTs=${latestAssistantTs}`,
          );
        clearActiveRunState(
          sessionKey,
          `revalidateRecoveredRun:${reason}`,
          remembered.runId,
        );
        history.refreshSessions().catch(() => {});
      } catch {
        if (showDebug)
          dbg(`revalidate:error session=${sessionKey} reason=${reason}`);
        // Ignore recovery probe failures; normal streaming events can still recover state.
      }
    },
    [
      clearActiveRunState,
      dbg,
      adapter,
      history.reconcileLatestAssistantFromHistory,
      history.refreshSessions,
      showDebug,
    ],
  );

  const requestRunRecovery = useCallback(
    (sessionKey: string, reason: string) => {
      const inFlight = runRecoveryInFlightRef.current;
      if (inFlight && inFlight.sessionKey === sessionKey) {
        if (showDebug) dbg(`revalidate:reuse session=${sessionKey} reason=${reason}`);
        return inFlight.promise;
      }

      const recent = recentRunRecoveryRef.current;
      if (
        recent &&
        recent.sessionKey === sessionKey &&
        Date.now() - recent.at < RUN_RECOVERY_MIN_INTERVAL_MS
      ) {
        if (showDebug) dbg(`revalidate:skip-recent session=${sessionKey} reason=${reason}`);
        return Promise.resolve();
      }

      const promise = revalidateRecoveredRun(sessionKey, reason).finally(() => {
        if (runRecoveryInFlightRef.current?.promise === promise) {
          runRecoveryInFlightRef.current = null;
          recentRunRecoveryRef.current = {
            sessionKey,
            at: Date.now(),
          };
        }
      });
      runRecoveryInFlightRef.current = { sessionKey, promise };
      return promise;
    },
    [dbg, revalidateRecoveredRun, showDebug],
  );

  const requestVisibleHistoryReload = useCallback(
    (sessionKey: string, reason: string) => {
      const inFlight = historyReloadInFlightRef.current;
      if (inFlight && inFlight.sessionKey === sessionKey) {
        if (showDebug) dbg(`historyReload:reuse session=${sessionKey} reason=${reason}`);
        return inFlight.promise;
      }

      const recent = recentHistoryReloadRef.current;
      if (
        recent &&
        recent.sessionKey === sessionKey &&
        Date.now() - recent.at < HISTORY_RELOAD_MIN_INTERVAL_MS
      ) {
        if (showDebug) dbg(`historyReload:skip-recent session=${sessionKey} reason=${reason}`);
        return Promise.resolve(0);
      }

      const promise = history
        .loadHistory(sessionKey, history.historyLimitRef.current)
        .finally(() => {
          if (historyReloadInFlightRef.current?.promise === promise) {
            historyReloadInFlightRef.current = null;
            recentHistoryReloadRef.current = {
              sessionKey,
              at: Date.now(),
            };
          }
        });
      historyReloadInFlightRef.current = { sessionKey, promise };
      return promise;
    },
    [dbg, history, showDebug],
  );

  const restoreRunStateForSession = useCallback(
    (key: string | null) => {
      if (!key) {
        if (showDebug)
          dbg("[isSending] → false | reason=restoreRunState:no-key");
        currentRunIdRef.current = null;
        streamStartedAtRef.current = null;
        lastRunSignalAtRef.current = 0;
        lastRunRecoveryProbeAtRef.current = 0;
        clearTransientRunPresentation();
        setIsSending(false);
        setActivityLabel(null);
        return;
      }
      const remembered = sessionRunStateRef.current.get(key);
      if (!remembered) {
        if (showDebug)
          dbg(
            `[isSending] → false | reason=restoreRunState:no-entry | session=${key}`,
          );
        currentRunIdRef.current = null;
        streamStartedAtRef.current = null;
        lastRunSignalAtRef.current = 0;
        lastRunRecoveryProbeAtRef.current = 0;
        clearTransientRunPresentation();
        setIsSending(false);
        setActivityLabel(null);
        return;
      }
      if (showDebug)
        dbg(
          `[isSending] → true | reason=restoreRunState:remembered | runId=${remembered.runId.slice(0, 8)} | session=${key}`,
        );
      currentRunIdRef.current = remembered.runId;
      streamStartedAtRef.current = remembered.startedAt;
      lastRunSignalAtRef.current = Date.now();
      lastRunRecoveryProbeAtRef.current = 0;
      const streamText = sanitizeVisibleStreamText(remembered.streamText);
      chatStreamRef.current = streamText;
      setChatStream(streamText);
      setIsSending(true);
    },
    [clearTransientRunPresentation],
  );

  useEffect(() => {
    sessionKeyRef.current = history.sessionKey;
    clearPostStreamHistoryRefreshTimer();
    clearTransientRunPresentation();
    restoreRunStateForSession(history.sessionKey);
  }, [
    clearPostStreamHistoryRefreshTimer,
    clearTransientRunPresentation,
    history.sessionKey,
    restoreRunStateForSession,
  ]);

  useEffect(() => {
    return () => {
      clearPostStreamHistoryRefreshTimer();
    };
  }, [clearPostStreamHistoryRefreshTimer]);

  useEffect(() => {
    chatStreamRef.current = chatStream;
  }, [chatStream]);

  useEffect(() => {
    chatStreamSegmentsRef.current = chatStreamSegments;
  }, [chatStreamSegments]);

  useEffect(() => {
    chatToolMessagesRef.current = chatToolMessages;
  }, [chatToolMessages]);

  // Track last refresh time to debounce auto-refreshes (min 5s apart)
  const lastAutoRefreshRef = useRef(0);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const backgroundedAtRef = useRef<number | null>(null);
  const pendingNotificationScrollSessionKeyRef = useRef<string | null>(null);
  const [scrollToBottomRequestAt, setScrollToBottomRequestAt] = useState<number | null>(null);
  const autoRefresh = useCallback(() => {
    if (!hasAdapter) {
      dbg("autoRefresh:skip no adapter");
      return;
    }
    // Skip refresh while a stream is active — reloading history mid-stream
    // causes the partial assistant message from gateway to duplicate the
    // streaming bubble.
    if (currentRunIdRef.current) {
      dbg(`autoRefresh:skip activeRun=${currentRunIdRef.current.slice(0, 8)}`);
      return;
    }
    const now = Date.now();
    if (now - lastAutoRefreshRef.current < 2000) {
      dbg(
        `autoRefresh:skip debounce delta=${now - lastAutoRefreshRef.current}`,
      );
      return;
    }
    lastAutoRefreshRef.current = now;
    dbg(`autoRefresh:start session=${history.sessionKey ?? "null"}`);
    history
      .onRefresh()
      .finally(() =>
        clearTransientRunPresentation({ preserveCurrentStream: true }),
      );
  }, [
    clearTransientRunPresentation,
    dbg,
    hasAdapter,
    history.onRefresh,
    history.sessionKey,
  ]);

  const clearForegroundRunRecoveryTimer = useCallback(() => {
    if (!foregroundRunRecoveryTimerRef.current) return;
    clearTimeout(foregroundRunRecoveryTimerRef.current);
    foregroundRunRecoveryTimerRef.current = null;
  }, []);

  const clearForegroundRefreshWait = useCallback(() => {
    foregroundRefreshProbeSeqRef.current += 1;
    if (foregroundRefreshTimerRef.current) {
      clearTimeout(foregroundRefreshTimerRef.current);
      foregroundRefreshTimerRef.current = null;
    }
  }, []);

  const scheduleForegroundRefresh = useCallback(
    (awayMs: number, hasRunningChat: boolean) => {
      if (!hasAdapter) {
        dbg("foregroundRefresh:skip no adapter");
        clearForegroundRefreshWait();
        return;
      }
      const delayMs = getForegroundRefreshDelayMs(awayMs);
      clearForegroundRefreshWait();

      if (
        !shouldReconnectBeforeForegroundRefresh({
          platformOs: Platform.OS,
          awayMs,
          hasRunningChat,
          connectionState,
        })
      ) {
        foregroundRefreshTimerRef.current = setTimeout(() => {
          foregroundRefreshTimerRef.current = null;
          autoRefresh();
        }, delayMs);
        return;
      }

      const probeSeq = foregroundRefreshProbeSeqRef.current + 1;
      foregroundRefreshProbeSeqRef.current = probeSeq;
      foregroundRefreshTimerRef.current = setTimeout(() => {
        foregroundRefreshTimerRef.current = null;
        void (async () => {
          const ok = await adapter?.probe(
            FOREGROUND_REFRESH_AFTER_RECONNECT_TIMEOUT_MS,
          );
          if (foregroundRefreshProbeSeqRef.current !== probeSeq) return;
          if (ok) {
            autoRefresh();
          }
        })();
      }, delayMs);
    },
    [
      autoRefresh,
      clearForegroundRefreshWait,
      connectionState,
      dbg,
      adapter,
      hasAdapter,
    ],
  );

  const previousGatewayScopeRef = useRef<string | null>(gatewayConfigId);
  useEffect(() => {
    if (previousGatewayScopeRef.current === gatewayConfigId) return;
    previousGatewayScopeRef.current = gatewayConfigId;

    // Clear all transient run-tracking state when gateway scope changes.
    // Session keys can overlap across gateways (e.g. agent:main:main), so
    // keeping remembered run state would leak stale "thinking" to new scopes.
    sessionRunStateRef.current.clear();
    pendingOptimisticRunIdsRef.current.clear();
    agentActivityRef.current.clear();
    childSessionActivityRef.current.clear();
    runRecoveryInFlightRef.current = null;
    recentRunRecoveryRef.current = null;
    historyReloadInFlightRef.current = null;
    recentHistoryReloadRef.current = null;
    resetAgentActiveCount();
    onChildSessionActivityChange();
    currentRunIdRef.current = null;
    streamStartedAtRef.current = null;
    lastRunSignalAtRef.current = 0;
    lastRunRecoveryProbeAtRef.current = 0;
    clearPendingRunTimeout();
    clearToolSettledRecoveryTimer();
    clearPostStreamHistoryRefreshTimer();
    clearForegroundRunRecoveryTimer();
    clearForegroundRefreshWait();
    clearTransientRunPresentation();
    setIsSending(false);
    setActivityLabel(null);
  }, [
    gatewayConfigId,
    clearForegroundRefreshWait,
    clearForegroundRunRecoveryTimer,
    clearPendingRunTimeout,
    clearPostStreamHistoryRefreshTimer,
    clearToolSettledRecoveryTimer,
    clearTransientRunPresentation,
    resetAgentActiveCount,
  ]);

  const recoverForegroundRunIfStuck = useCallback(() => {
    const runIdSnapshot = currentRunIdRef.current;
    const sessionKeySnapshot = history.sessionKey;
    if (!runIdSnapshot || !sessionKeySnapshot) return;

    clearForegroundRunRecoveryTimer();
    foregroundRunRecoveryTimerRef.current = setTimeout(() => {
      foregroundRunRecoveryTimerRef.current = null;
      const stillSameRun =
        currentRunIdRef.current === runIdSnapshot &&
        history.sessionKey === sessionKeySnapshot;
      if (!stillSameRun) return;

      const idleMs = Date.now() - lastRunSignalAtRef.current;
      if (idleMs < 12_000) return;

      if (showDebug)
        dbg(
          `foregroundRecovery:start session=${sessionKeySnapshot} runId=${runIdSnapshot.slice(0, 8)} idleMs=${idleMs}`,
        );
      reconnectAdapter(adapter);
      void requestRunRecovery(sessionKeySnapshot, "foreground");

      setTimeout(() => {
        if (
          currentRunIdRef.current !== runIdSnapshot ||
          history.sessionKey !== sessionKeySnapshot
        )
          return;
        if (showDebug)
          dbg(
            `foregroundRecovery:loadHistory session=${sessionKeySnapshot} runId=${runIdSnapshot.slice(0, 8)}`,
          );
        requestVisibleHistoryReload(sessionKeySnapshot, "foreground")
          .catch(() => {});
      }, 1200);

      setTimeout(() => {
        if (
          currentRunIdRef.current !== runIdSnapshot ||
          history.sessionKey !== sessionKeySnapshot
        )
          return;
        const idleAfterRecoveryMs = Date.now() - lastRunSignalAtRef.current;
        if (idleAfterRecoveryMs < 15_000) return;

        if (showDebug)
          dbg(
            `foregroundRecovery:timeout session=${sessionKeySnapshot} runId=${runIdSnapshot.slice(0, 8)} idleMs=${idleAfterRecoveryMs}`,
          );
        clearActiveRunState(
          sessionKeySnapshot,
          "foregroundRecoveryTimeout",
          runIdSnapshot,
        );
        history.refreshSessions().catch(() => {});
      }, 2500);
    }, 1200);
  }, [
    clearActiveRunState,
    clearForegroundRunRecoveryTimer,
    dbg,
    adapter,
    history.historyLimitRef,
    history.loadHistory,
    history.refreshSessions,
    history.sessionKey,
    requestRunRecovery,
    requestVisibleHistoryReload,
    showDebug,
  ]);

  useEffect(() => {
    const showEvt =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = Keyboard.addListener(showEvt, () =>
      setKeyboardVisible(true),
    );
    const onHide = Keyboard.addListener(hideEvt, () =>
      setKeyboardVisible(false),
    );
    // Dismiss keyboard + reconnect/refresh when app returns from background
    const appStateSub = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus) => {
        const prevState = appStateRef.current;
        appStateRef.current = nextState;

        if (nextState === "background" || nextState === "inactive") {
          backgroundedAtRef.current = Date.now();
          return;
        }
        if (nextState !== "active" || prevState === "active") return;

        Keyboard.dismiss();
        setKeyboardVisible(false);

        const awayMs = backgroundedAtRef.current
          ? Date.now() - backgroundedAtRef.current
          : 0;
        backgroundedAtRef.current = null;
        const hasRunningChat = !!currentRunIdRef.current;
        // Refresh visible history after transport freshness has been re-established.
        scheduleForegroundRefresh(awayMs, hasRunningChat);
        if (hasRunningChat) {
          if (awayMs >= 12_000 || connectionState !== "ready") {
            void adapter?.probe();
          }
          if (history.sessionKey) {
            void requestRunRecovery(history.sessionKey, "app-active");
          }
          recoverForegroundRunIfStuck();
        }
        return;

        // unreachable
      },
    );
    return () => {
      onShow.remove();
      onHide.remove();
      appStateSub.remove();
      clearForegroundRefreshWait();
      clearForegroundRunRecoveryTimer();
      clearPendingRunTimeout();
    };
  }, [
    clearForegroundRefreshWait,
    clearForegroundRunRecoveryTimer,
    clearPendingRunTimeout,
    connectionState,
    adapter,
    history.sessionKey,
    recoverForegroundRunIfStuck,
    requestRunRecovery,
    scheduleForegroundRefresh,
  ]);

  // Auto-refresh when Chat tab gains focus (switching from Console/My tab)
  const isFocused = useIsFocused();
  const prevFocusedRef = useRef(isFocused);
  useEffect(() => {
    const wasFocused = prevFocusedRef.current;
    prevFocusedRef.current = isFocused;
    if (isFocused && !wasFocused && hasAdapter) {
      autoRefresh();
    }
  }, [isFocused, autoRefresh, hasAdapter]);

  useEffect(() => {
    if (!isSending) {
      clearPendingRunTimeout();
      clearForegroundRefreshWait();
      clearForegroundRunRecoveryTimer();
      lastRunRecoveryProbeAtRef.current = 0;
    }
  }, [
    clearForegroundRefreshWait,
    clearPendingRunTimeout,
    clearForegroundRunRecoveryTimer,
    isSending,
  ]);

  useEffect(() => {
    if (!isSending) return;

    const interval = setInterval(() => {
      const sessionKey = history.sessionKey;
      const runId = currentRunIdRef.current;
      if (!sessionKey || !runId) return;

      const now = Date.now();
      const idleMs = now - lastRunSignalAtRef.current;
      if (idleMs < 15_000) return;
      if (now - lastRunRecoveryProbeAtRef.current < 8_000) return;

      lastRunRecoveryProbeAtRef.current = now;

      // Force-clear if idle exceeds 25s — the history probe may keep failing
      // (e.g. no parseable assistant message for this OpenClaw version), so
      // don't rely on it alone; clear unconditionally before the hard timeout.
      if (idleMs >= 18_000) {
        if (showDebug)
          dbg(
            `watchdog:force-clear session=${sessionKey} runId=${runId.slice(0, 8)} idleMs=${idleMs}`,
          );
        clearActiveRunState(sessionKey, `watchdog:force-clear`, runId);
        return;
      }

      if (showDebug)
        dbg(
          `watchdog:probe session=${sessionKey} runId=${runId.slice(0, 8)} idleMs=${idleMs}`,
        );
      void requestRunRecovery(sessionKey, "watchdog");

      if (
        idleMs >= 45_000 &&
        connectionState !== "connecting" &&
        connectionState !== "challenging" &&
        connectionState !== "reconnecting"
      ) {
        if (showDebug)
          dbg(
            `watchdog:reconnect session=${sessionKey} runId=${runId.slice(0, 8)} idleMs=${idleMs}`,
          );
        reconnectAdapter(adapter);
      }
    }, 4_000);

    return () => clearInterval(interval);
  }, [
    clearActiveRunState,
    connectionState,
    dbg,
    adapter,
    history.sessionKey,
    isSending,
    requestRunRecovery,
    showDebug,
  ]);

  useEffect(() => {
    syncDerivedSessionActivity("messages-or-session");
  }, [syncDerivedSessionActivity]);

  useEffect(() => {
    const sessionKey = history.sessionKey;
    if (!sessionKey) return;
    const remembered = sessionRunStateRef.current.get(sessionKey);
    if (!remembered) return;
    if (!hasCompletedAssistantForRememberedRun(history.messages, remembered))
      return;
    if (currentRunIdRef.current) return;

    clearActiveRunState(
      sessionKey,
      "historyObservedCompleted",
      remembered.runId,
    );
  }, [clearActiveRunState, history.messages, history.sessionKey]);

  useEffect(() => {
    if (connectionState !== "ready" || !history.sessionKey) return;
    if (!sessionRunStateRef.current.has(history.sessionKey)) return;
    void requestRunRecovery(history.sessionKey, "connection-ready");
  }, [connectionState, history.sessionKey, requestRunRecovery]);

  // Consume pending chat input from cross-tab navigation (e.g. Ask AI from Cron, Install from ClawHub).
  // NOTE: session switching for pendingMainSessionSwitch is handled in a later effect
  // (after switchSession is defined) so that the session switch and input fill happen together.
  // This effect only handles the simple case (no session switch needed).
  useEffect(() => {
    if (pendingChatInput && !pendingMainSessionSwitch) {
      setInput(pendingChatInput);
      clearPendingChatInput();
    }
  }, [pendingChatInput, clearPendingChatInput, pendingMainSessionSwitch]);

  useEffect(() => {
    setSlashSuggestionsDismissed(false);
  }, [input]);

  const markTransportConfirmed = useCallback((timestampMs = Date.now()) => {
    lastConfirmedTransportAtRef.current = timestampMs;
    forceSendProbeUntilRef.current = 0;
  }, []);

  const markRunSignal = useCallback(() => {
    clearPostStreamHistoryRefreshTimer();
    lastRunSignalAtRef.current = Date.now();
    lastRunRecoveryProbeAtRef.current = 0;
    armPendingRunTimeout();
  }, [armPendingRunTimeout, clearPostStreamHistoryRefreshTimer]);

  const adoptPendingRunId = useCallback((sessionKey: string, runId: string) => {
    if (!shouldAdoptPendingOptimisticRunId({
      sessionKey,
      eventRunId: runId,
      currentRunId: currentRunIdRef.current,
      pendingRunIds: pendingOptimisticRunIdsRef.current,
    })) {
      if (pendingOptimisticRunIdsRef.current.get(sessionKey) === runId) {
        pendingOptimisticRunIdsRef.current.delete(sessionKey);
      }
      return false;
    }
    const previousRunId = currentRunIdRef.current;
    currentRunIdRef.current = runId;
    pendingOptimisticRunIdsRef.current.delete(sessionKey);
    if (showDebug) {
      dbg(
        `adopt optimistic runId: ${previousRunId?.slice(0, 8) ?? "none"} -> ${runId.slice(0, 8)} session=${sessionKey}`,
      );
    }
    return true;
  }, [dbg, showDebug]);

  const finishSilentCommandProbe = useCallback(
    (runId: string, result: { text?: string; error?: Error }) => {
      const probe = silentCommandProbesRef.current.get(runId);
      if (!probe) return;
      silentCommandProbesRef.current.delete(runId);
      if (probe.timeout) clearTimeout(probe.timeout);
      if (result.error) probe.reject(result.error);
      else probe.resolve(result.text ?? probe.latestText);
    },
    [],
  );

  const consumeSilentCommandUpdate = useCallback(
    (update: AdapterChatUpdate): boolean => {
      if (!("runId" in update) || !update.runId) return false;
      const probe = silentCommandProbesRef.current.get(update.runId);
      if (!probe) return false;
      if ("sessionKey" in update && update.sessionKey !== probe.sessionKey) {
        return false;
      }

      switch (update.type) {
        case "agent_message_chunk":
          probe.latestText = mergeStreamText(probe.latestText, update.text);
          return true;
        case "run_finished":
          if (probe.finishing) return true;
          probe.finishing = true;
          if (update.stopReason === "cancelled") {
            finishSilentCommandProbe(update.runId, {
              error: new Error("Command probe aborted."),
            });
            return true;
          }
          if (update.stopReason === "error") {
            finishSilentCommandProbe(update.runId, {
              error: new Error("Command probe failed."),
            });
            return true;
          }
          void (async () => {
            let finalText = update.finalMessage?.text ?? probe.latestText;
            if (!finalText.trim() && adapter) {
              try {
                const historyResult = await adapter.loadSession(probe.sessionKey, { limit: 8 });
                finalText = latestVisibleAssistant(historyResult)?.text ?? "";
              } catch {
                finalText = probe.latestText;
              }
            }
            finishSilentCommandProbe(update.runId, { text: finalText });
          })();
          return true;
        case "error":
          finishSilentCommandProbe(update.runId, {
            error: new Error(update.errorMessage || "Command probe failed."),
          });
          return true;
        case "run_started":
        case "agent_thought_chunk":
        case "tool_call":
        case "tool_call_update":
          return true;
        default:
          return false;
      }
    },
    [adapter, finishSilentCommandProbe],
  );

  const schedulePostStreamHistoryRefresh = useCallback(() => {
    const completedSessionKey = sessionKeyRef.current;
    clearPostStreamHistoryRefreshTimer();
    postStreamHistoryRefreshTimerRef.current = setTimeout(() => {
      postStreamHistoryRefreshTimerRef.current = null;
      if (!completedSessionKey) return;
      if (sessionKeyRef.current !== completedSessionKey) return;
      if (currentRunIdRef.current) return;
      if (streamStartedAtRef.current !== null) return;
      requestVisibleHistoryReload(completedSessionKey, "post-stream")
        .finally(() =>
          clearTransientRunPresentation({ preserveCurrentStream: true }),
        )
        .catch(() => {});
    }, POST_STREAM_HISTORY_REFRESH_DELAY_MS);
  }, [
    clearPostStreamHistoryRefreshTimer,
    clearTransientRunPresentation,
    requestVisibleHistoryReload,
  ]);

  const handleAdapterState = useCallback((state: AdapterConnectionState) => {
    const previous = lastAdapterStateRef.current;
    const adapterChanged = lastAdapterRef.current !== adapter;
    lastAdapterRef.current = adapter;
    lastAdapterStateRef.current = state;
    setConnectionState(mapAdapterConnectionState(state));

    if (state === "ready") {
      markTransportConfirmed();
      setPairingPending(false);
      if (adapterChanged || previous !== "ready") {
        restoreRunStateForSession(sessionKeyRef.current);
        const activeAdapter = adapter;
        const sessionSync = Promise.resolve(history.loadSessionsAndHistory())
          .catch(() => undefined);
        if (activeAdapter) {
          void sessionSync.then(async () => {
            if (
              lastAdapterRef.current !== activeAdapter
              || lastAdapterStateRef.current !== "ready"
            ) return;
            const listedAgents = await activeAdapter.listAgents();
            if (
              lastAdapterRef.current !== activeAdapter
              || lastAdapterStateRef.current !== "ready"
            ) return;
            if (listedAgents.length === 0) return;
            setAgents(listedAgents.map(mapAdapterAgent));
            const defaultAgent = listedAgents.find((agent) => agent.isMain);
            if (!defaultAgent || defaultAgent.agentId === "main") return;
            StorageService.getCurrentAgentId()
              .then((persisted) => {
                if (
                  !persisted
                  && lastAdapterRef.current === activeAdapter
                  && lastAdapterStateRef.current === "ready"
                ) {
                  setCurrentAgentId(defaultAgent.agentId);
                }
              })
              .catch(() => {});
          }).catch(() => {});
        }
      }
      return;
    }

    forceSendProbeUntilRef.current = Date.now() + SEND_FORCE_PROBE_GRACE_MS;
    if (previous !== "ready") return;
    const sessionKey = sessionKeyRef.current;
    if (sessionKey && currentRunIdRef.current) {
      sessionRunStateRef.current.set(sessionKey, {
        runId: currentRunIdRef.current,
        streamText: chatStreamRef.current,
        startedAt: streamStartedAtRef.current ?? Date.now(),
      });
    }
    agentActivityRef.current.clear();
    childSessionActivityRef.current.clear();
    onChildSessionActivityChange();
    resetAgentActiveCount();
    currentRunIdRef.current = null;
    streamStartedAtRef.current = null;
    clearTransientRunPresentation();
    setIsSending(false);
    setActivityLabel(null);
  }, [
    adapter,
    clearTransientRunPresentation,
    history.loadSessionsAndHistory,
    markTransportConfirmed,
    onChildSessionActivityChange,
    resetAgentActiveCount,
    restoreRunStateForSession,
    setAgents,
    setCurrentAgentId,
  ]);

  const handleAdapterSessions = useCallback((sessions: SessionDescriptor[]) => {
    history.setSessions((previous) => sessions.map((session) => {
      const existing = previous.find((candidate) => candidate.key === session.key);
      return { ...existing, ...mapAdapterSession(session) };
    }));
  }, [history.setSessions]);

  const handleAdapterUpdate = useCallback((update: AdapterChatUpdate) => {
    if (consumeSilentCommandUpdate(update)) return;
    if (update.type !== "error") markTransportConfirmed();

    const markActivityStarted = (sessionKey: string, runId: string) => {
      markSessionRunStarted(sessionRunStateRef.current, sessionKey, runId);
      const agentId = agentIdFromSessionKey(sessionKey);
      if (agentId && agentId !== currentAgentId) {
        if (applyRunStart(agentActivityRef.current, agentId)) {
          onAgentActiveCountChange(1);
        }
      }
      if (sessionKey.includes(":subagent:")) {
        applyChildRunStart(childSessionActivityRef.current, sessionKey);
        onChildSessionActivityChange();
      }
    };

    const markActivityFinished = (sessionKey: string, runId: string) => {
      clearSessionRunState(sessionRunStateRef.current, sessionKey, runId);
      const agentId = agentIdFromSessionKey(sessionKey);
      if (agentId && agentId !== currentAgentId) {
        if (applyRunEnd(agentActivityRef.current, agentId)) {
          onAgentActiveCountChange(-1);
        }
      }
      if (sessionKey.includes(":subagent:")) {
        applyChildRunEnd(childSessionActivityRef.current, sessionKey);
        onChildSessionActivityChange();
      }
    };

    const matchesCurrentSession = (sessionKey: string) =>
      sessionKeysMatch(sessionKey, sessionKeyRef.current);

    const acceptRun = (sessionKey: string, runId: string) => {
      if (
        currentRunIdRef.current
        && currentRunIdRef.current !== runId
        && !adoptPendingRunId(sessionKey, runId)
      ) {
        return false;
      }
      if (!currentRunIdRef.current) {
        currentRunIdRef.current = runId;
        streamStartedAtRef.current = Date.now();
      }
      setIsSending(true);
      return true;
    };

    switch (update.type) {
      case "history_reconciled": {
        if (!matchesCurrentSession(update.sessionKey)) return;
        history.setMessages((previous) =>
          preserveOptimisticAssistantMessage(previous, update.messages),
        );
        history.historyRawCountRef.current = update.history.messages.length;
        history.setHistoryLoaded(true);
        history.setHasMoreHistory(Boolean(update.nextCursor));
        if (!update.hasActiveRun) {
          const activeRunId = currentRunIdRef.current;
          clearSessionRunState(
            sessionRunStateRef.current,
            update.sessionKey,
            activeRunId ?? undefined,
          );
          pendingOptimisticRunIdsRef.current.delete(update.sessionKey);
          currentRunIdRef.current = null;
          streamStartedAtRef.current = null;
          clearTransientRunPresentation();
          setIsSending(false);
          setActivityLabel(null);
        }
        return;
      }
      case "run_started":
        if (lastAdapterStateRef.current !== "ready") return;
        markRunSignal();
        markActivityStarted(update.sessionKey, update.runId);
        if (!matchesCurrentSession(update.sessionKey)) return;
        acceptRun(update.sessionKey, update.runId);
        return;
      case "agent_message_chunk": {
        if (lastAdapterStateRef.current !== "ready") return;
        if (!update.visible) return;
        markRunSignal();
        const mergedText = mergeStreamText(
          sessionRunStateRef.current.get(update.sessionKey)?.streamText ?? null,
          update.text,
        );
        markSessionRunDelta(
          sessionRunStateRef.current,
          update.sessionKey,
          update.runId,
          mergedText,
        );
        const agentId = agentIdFromSessionKey(update.sessionKey);
        if (agentId && agentId !== currentAgentId) {
          applyActivityDelta(agentActivityRef.current, agentId, mergedText);
        }
        if (update.sessionKey.includes(":subagent:")) {
          applyChildDelta(childSessionActivityRef.current, update.sessionKey, mergedText);
          onChildSessionActivityChange();
        }
        if (!matchesCurrentSession(update.sessionKey)) return;
        if (!acceptRun(update.sessionKey, update.runId)) return;
        const nextText = mergeStreamText(chatStreamRef.current, update.text);
        chatStreamRef.current = nextText;
        setChatStream(nextText);
        setActivityLabel(null);
        return;
      }
      case "agent_thought_chunk":
        if (lastAdapterStateRef.current !== "ready") return;
        markRunSignal();
        markActivityStarted(update.sessionKey, update.runId);
        if (matchesCurrentSession(update.sessionKey)) {
          acceptRun(update.sessionKey, update.runId);
        }
        return;
      case "tool_call": {
        if (lastAdapterStateRef.current !== "ready") return;
        markRunSignal();
        markActivityStarted(update.sessionKey, update.runId);
        const agentId = agentIdFromSessionKey(update.sessionKey);
        const toolName = update.message.toolName ?? "tool";
        if (agentId && agentId !== currentAgentId) {
          applyActivityToolStart(agentActivityRef.current, agentId, toolName);
        }
        if (update.sessionKey.includes(":subagent:")) {
          applyChildToolStart(childSessionActivityRef.current, update.sessionKey, toolName);
          onChildSessionActivityChange();
        }
        if (!matchesCurrentSession(update.sessionKey)) return;
        if (!acceptRun(update.sessionKey, update.runId)) return;
        commitCurrentStreamSegment();
        setActivityLabel(formatToolActivity(toolName, t));
        const message = {
          ...update.message,
          toolSummary: formatToolOneLinerLocalized(toolName, update.message.toolArgs, t),
        };
        setChatToolMessages((previous) => withToolMessage(previous, message));
        return;
      }
      case "tool_call_update": {
        if (lastAdapterStateRef.current !== "ready") return;
        markRunSignal();
        markSessionRunStarted(sessionRunStateRef.current, update.sessionKey, update.runId);
        if (!matchesCurrentSession(update.sessionKey)) return;
        if (!acceptRun(update.sessionKey, update.runId)) return;
        const previousMessage = chatToolMessagesRef.current.find(
          (message) => message.id === update.message.id,
        );
        const toolName = previousMessage?.toolName ?? "tool";
        const finishedAt = update.message.toolFinishedAt;
        const durationMs = finishedAt && previousMessage?.toolStartedAt
          ? Math.max(0, finishedAt - previousMessage.toolStartedAt)
          : undefined;
        const localizedSummary = formatToolOneLinerLocalized(
          toolName,
          previousMessage?.toolArgs,
          t,
        );
        const message: UiMessage = {
          ...previousMessage,
          ...update.message,
          toolName,
          toolSummary: update.message.toolStatus === "error"
            ? t("Failed {{name}}", { name: localizedSummary })
            : update.message.toolStatus === "success"
              ? t("Completed {{name}}", { name: localizedSummary })
              : localizedSummary,
          toolDurationMs: durationMs,
        };
        setChatToolMessages((previous) => withToolMessage(previous, message));
        if (update.message.toolStatus === "running") return;
        clearToolSettledRecoveryTimer();
        requestVisibleHistoryReload(update.sessionKey, "tool-result").catch(() => {});
        toolSettledRecoveryTimerRef.current = setTimeout(() => {
          toolSettledRecoveryTimerRef.current = null;
          if (
            currentRunIdRef.current !== update.runId
            || !sessionKeysMatch(update.sessionKey, sessionKeyRef.current)
          ) return;
          void requestRunRecovery(update.sessionKey, "tool-settled");
        }, 1800);
        return;
      }
      case "run_finished": {
        markRunSignal();
        markActivityFinished(update.sessionKey, update.runId);
        if (!matchesCurrentSession(update.sessionKey)) return;
        const activeRunId = currentRunIdRef.current;
        if (
          activeRunId !== update.runId
          && !adoptPendingRunId(update.sessionKey, update.runId)
        ) {
          return;
        }
        const activeRunStartedAt = streamStartedAtRef.current;
        const streamText = chatStreamRef.current ?? "";
        if (update.stopReason === "cancelled") {
          if (streamText.trim()) {
            history.setMessages((previous) => appendUniqueMessage(previous, {
              id: `abort_${update.runId}`,
              role: "assistant",
              text: streamText,
              timestampMs: Date.now(),
            }));
          }
          if (update.systemMessage) {
            history.setMessages((previous) =>
              appendUniqueMessage(previous, update.systemMessage!),
            );
          }
        } else if (update.stopReason !== "error") {
          const finalText = update.finalMessage?.text || streamText;
          if (finalText.trim()) {
            const finalMessage: UiMessage = {
              ...(update.finalMessage ?? {
                id: `final_${update.runId}`,
                role: "assistant" as const,
                text: finalText,
                timestampMs: Date.now(),
              }),
              text: finalText,
            };
            history.setMessages((previous) => {
              if (previous.some((message) => message.id === finalMessage.id)) {
                return previous;
              }
              for (let index = previous.length - 1; index >= 0; index -= 1) {
                const candidate = previous[index];
                if (!shouldMergeFinalMessage(candidate, finalText, activeRunStartedAt)) {
                  continue;
                }
                const next = [...previous];
                next[index] = { ...candidate, ...finalMessage };
                return next;
              }
              return [...previous, finalMessage];
            });
          } else {
            setTimeout(() => {
              history.reconcileLatestAssistantFromHistory(update.sessionKey, {
                appendIfMissing: true,
                minTimestampMs: activeRunStartedAt ?? undefined,
              }).catch(() => {});
            }, 30);
          }
        }
        pendingOptimisticRunIdsRef.current.delete(update.sessionKey);
        currentRunIdRef.current = null;
        streamStartedAtRef.current = null;
        clearTransientRunPresentation({
          preserveCurrentStream: true,
          preserveToolMessages: update.stopReason !== "cancelled",
        });
        setIsSending(false);
        setActivityLabel(null);
        if (update.stopReason !== "cancelled" && update.stopReason !== "error") {
          schedulePostStreamHistoryRefresh();
        }
        return;
      }
      case "compaction":
        if (!matchesCurrentSession(update.sessionKey)) return;
        if (compactionTimerRef.current) clearTimeout(compactionTimerRef.current);
        compactionTimerRef.current = null;
        setCompactionNotice(update.notice);
        if (update.notice) {
          compactionTimerRef.current = setTimeout(() => {
            setCompactionNotice(null);
            compactionTimerRef.current = null;
          }, 5000);
        }
        return;
      case "approval_requested":
        if (update.approval.kind === "pair") {
          setPairingPending(true);
          return;
        }
        if (
          update.approval.kind === "exec"
          && execApprovalEnabled
          && (!update.sessionKey || matchesCurrentSession(update.sessionKey))
          && update.message
        ) {
          history.setMessages((previous) =>
            appendUniqueMessage(previous, update.message!),
          );
        }
        return;
      case "approval_resolved":
        setPairingPending(false);
        history.setMessages((previous) => previous.map((message) => (
          message.id === update.messageId && message.approval
            ? {
                ...message,
                approval: { ...message.approval, status: update.status },
              }
            : message
        )));
        return;
      case "session_info_update":
        history.setSessions((previous) => {
          const existing = previous.find((session) => session.key === update.session.key);
          const partial = mapAdapterSessionPatch(update.session);
          if (!existing) return [...previous, partial];
          return previous.map((session) =>
            session.key === update.session.key ? { ...session, ...partial } : session,
          );
        });
        return;
      case "usage_update":
        history.setSessions((previous) => previous.map((session) =>
          session.key === update.sessionKey
            ? {
                ...session,
                totalTokens: update.contextUsed,
                contextTokens: update.contextWindow,
                totalTokensFresh: update.contextUsed !== undefined,
              }
            : session,
        ));
        return;
      case "system_event":
        if (matchesCurrentSession(update.sessionKey)) {
          history.setMessages((previous) =>
            appendUniqueMessage(previous, update.message),
          );
        }
        return;
      case "error": {
        forceSendProbeUntilRef.current = Date.now() + SEND_FORCE_PROBE_GRACE_MS;
        const matchesSession = !update.sessionKey
          || matchesCurrentSession(update.sessionKey);
        if (!matchesSession) return;
        if (update.runId && currentRunIdRef.current === update.runId) {
          clearActiveRunState(
            update.sessionKey ?? sessionKeyRef.current,
            `adapter-error:${update.code}`,
            update.runId,
          );
        }
        history.setMessages((previous) =>
          appendUniqueMessage(previous, update.message),
        );
        return;
      }
    }
  }, [
    adoptPendingRunId,
    clearActiveRunState,
    clearToolSettledRecoveryTimer,
    clearTransientRunPresentation,
    commitCurrentStreamSegment,
    consumeSilentCommandUpdate,
    currentAgentId,
    execApprovalEnabled,
    history,
    markRunSignal,
    markTransportConfirmed,
    onAgentActiveCountChange,
    onChildSessionActivityChange,
    requestRunRecovery,
    requestVisibleHistoryReload,
    schedulePostStreamHistoryRefresh,
    t,
  ]);

  useAdapterChatEvents({
    adapter,
    onState: handleAdapterState,
    onSessions: handleAdapterSessions,
    onUpdate: handleAdapterUpdate,
  });

  useEffect(() => {
    if (adapter) return;
    handleAdapterState("idle");
  }, [adapter, handleAdapterState]);

  // When switching agents, reconcile the agent activity ref:
  // 1. Clear the incoming agent's tracked activity (it becomes current, so its
  //    status is now managed locally via isSending/activityLabel). Without this,
  //    chatFinal for the current agent is skipped by the !== currentAgentId guard,
  //    leaving a stale streaming entry and an orphaned count.
  // 2. Seed the departing agent's activity if it was running — its chatRunStart
  //    was skipped while it was current, so agentActivityRef has no entry.
  const prevAgentIdRef = useRef(currentAgentId);
  useEffect(() => {
    const prevAgentId = prevAgentIdRef.current;
    prevAgentIdRef.current = currentAgentId;
    if (prevAgentId === currentAgentId) return;

    // Step 1: clear incoming agent's tracked activity
    const incomingActivity = agentActivityRef.current.get(currentAgentId);
    if (incomingActivity) {
      const wasActive = incomingActivity.status !== "idle";
      agentActivityRef.current.delete(currentAgentId);
      if (wasActive) {
        setAgentActiveCount((prev) => Math.max(0, prev - 1));
      }
    }

    // Step 2: seed departing agent from known run states
    for (const [sessionKey] of sessionRunStateRef.current.entries()) {
      const agentId = agentIdFromSessionKey(sessionKey);
      if (agentId && agentId !== currentAgentId) {
        if (applyRunStart(agentActivityRef.current, agentId)) {
          setAgentActiveCount((prev) => prev + 1);
        }
      }
    }
  }, [currentAgentId]);

  const canSend = useMemo(
    () =>
      canSendMessage({
        connectionState,
        hasSession: !!history.sessionKey,
        hasContent: !!input.trim() || pendingImages.length > 0,
        isSending: isSending || isPreparingSend || voiceInputActive,
        refreshingConversation: history.refreshing,
        refreshingSessions: history.refreshingSessions,
      }),
    [
      connectionState,
      history.refreshing,
      history.refreshingSessions,
      history.sessionKey,
      input,
      isPreparingSend,
      pendingImages.length,
      isSending,
      voiceInputActive,
    ],
  );

  useEffect(() => {
    if (connectionState === "ready") return;
    forceSendProbeUntilRef.current = Date.now() + SEND_FORCE_PROBE_GRACE_MS;
  }, [connectionState, SEND_FORCE_PROBE_GRACE_MS]);

  const isNetworkLikelyOffline = useCallback(async (): Promise<boolean> => {
    try {
      const state = await Network.getNetworkStateAsync();
      if (state.isConnected === false) return true;
      if (state.isInternetReachable === false) return true;
      return false;
    } catch {
      return false;
    }
  }, []);

  const ensureConnectionReadyForSend =
    useCallback(async (): Promise<boolean> => {
      if (await isNetworkLikelyOffline()) {
        forceSendProbeUntilRef.current = Date.now() + SEND_FORCE_PROBE_GRACE_MS;
        return false;
      }

      const now = Date.now();
      const inForcedProbeWindow = now < forceSendProbeUntilRef.current;
      const hasRecentConfirmedTransport =
        now - lastConfirmedTransportAtRef.current <= SEND_HEALTH_WINDOW_MS;
      if (
        connectionState === "ready" &&
        !inForcedProbeWindow &&
        hasRecentConfirmedTransport
      ) {
        return true;
      }

      try {
        if (!adapter) return false;
        const ok =
          connectionState === "ready"
            ? await adapter.probe(SEND_FAST_PROBE_TIMEOUT_MS)
            : await adapter.probe();
        if (ok) {
          markTransportConfirmed();
        } else {
          forceSendProbeUntilRef.current =
            Date.now() + SEND_FORCE_PROBE_GRACE_MS;
        }
        return ok;
      } catch {
        forceSendProbeUntilRef.current = Date.now() + SEND_FORCE_PROBE_GRACE_MS;
        return false;
      }
    }, [
      connectionState,
      adapter,
      isNetworkLikelyOffline,
      markTransportConfirmed,
      SEND_FAST_PROBE_TIMEOUT_MS,
      SEND_FORCE_PROBE_GRACE_MS,
      SEND_HEALTH_WINDOW_MS,
    ]);

  const acquireSendTriggerGuard = useCallback((): boolean => {
    if (sendTriggerGuardRef.current) return false;
    sendTriggerGuardRef.current = true;
    return true;
  }, []);

  const releaseSendTriggerGuard = useCallback(() => {
    sendTriggerGuardRef.current = false;
  }, []);

  useEffect(() => {
    // This guard only covers the gap before React commits disabled UI state.
    // Once render catches up, normal composer locking takes over.
    releaseSendTriggerGuard();
  }, [isPreparingSend, isSending, releaseSendTriggerGuard]);

  const submitMessage = useCallback(
    (text: string, images: PendingImage[]) => {
      const sessionKey = history.sessionKey;
      if (!sessionKey || !adapter) return;
      const localTimestamp = Date.now();
      const idempotencyKey = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const realImages = images.filter((image) => isImageAttachmentMimeType(image.mimeType));
      const files = images.filter((image) => !isImageAttachmentMimeType(image.mimeType));
      const fallbackKey = resolveAttachmentOnlyFallbackKey(images);
      const attachmentFallbackCopy = {
        'Look at this image': t('Look at this image', { ns: 'chat' }),
        'Look at these images': t('Look at these images', { ns: 'chat' }),
        'Review this file': t('Review this file', { ns: 'chat' }),
        'Review these files': t('Review these files', { ns: 'chat' }),
        'Review these attachments': t('Review these attachments', { ns: 'chat' }),
      } as const;
      const fallbackText = fallbackKey ? attachmentFallbackCopy[fallbackKey] : '';
      const uiMsg: UiMessage = {
        id: `usr_${localTimestamp}`,
        role: "user",
        text: text || fallbackText,
        idempotencyKey,
        timestampMs: localTimestamp,
        imageUris:
          realImages.length > 0
            ? realImages.map((image) => image.uri)
            : undefined,
        imageMetas:
          realImages.length > 0
            ? realImages.map((i) => ({
                uri: i.uri,
                width: i.width ?? 0,
                height: i.height ?? 0,
              }))
            : undefined,
        fileAttachments: buildUiFileAttachments(files),
      };
      if (!shouldHideMessage(uiMsg)) {
        history.setMessages((prev) => [...prev, uiMsg]);
      }

      const claimsActiveRun = !currentRunIdRef.current;
      if (claimsActiveRun) {
        clearTransientRunPresentation({ preserveCurrentStream: true });
        currentRunIdRef.current = idempotencyKey;
        streamStartedAtRef.current = localTimestamp;
        lastRunSignalAtRef.current = localTimestamp;
        chatStreamRef.current = "";
        setChatStream("");
        sessionRunStateRef.current.set(sessionKey, {
          runId: idempotencyKey,
          streamText: "",
          startedAt: localTimestamp,
        });
        pendingOptimisticRunIdsRef.current.set(sessionKey, idempotencyKey);
      }
      if (showDebug)
        dbg(
          `[isSending] → true | reason=submitMessage | runId=${currentRunIdRef.current?.slice(0, 8) ?? "null"} | session=${sessionKey}`,
        );
      setIsSending(true);
      armPendingRunTimeout();

      if (realImages.length > 0 && !shouldHideMessage(uiMsg)) {
        cacheMessageImages(
          sessionKey,
          uiMsg.text,
          realImages.map((image) => ({
            base64: image.base64,
            mimeType: normalizeAttachmentMimeType(image.mimeType),
            width: image.width,
            height: image.height,
          })),
          { timestamp: localTimestamp, role: "user", idempotencyKey },
        )
          .then(() =>
            dbg(`cache write ok: ts=${localTimestamp} images=${realImages.length}`),
          )
          .catch((err) => dbg(`cache write failed: ${String(err)}`));
      }

      const attachments = buildPromptAttachments(images);

      const effectiveText = text || fallbackText || " ";
      adapter
        .prompt(sessionKey, { text: effectiveText, attachments, idempotencyKey })
        .then(({ runId: serverRunId }) => {
          void recordSuccessfulSendForAutomaticReview();
          markTransportConfirmed();
          if (
            pendingOptimisticRunIdsRef.current.get(sessionKey) ===
            idempotencyKey
          ) {
            pendingOptimisticRunIdsRef.current.delete(sessionKey);
          }
          // If the server assigned a different runId, update our tracking refs
          if (
            claimsActiveRun &&
            serverRunId !== idempotencyKey &&
            currentRunIdRef.current === idempotencyKey
          ) {
            currentRunIdRef.current = serverRunId;
            const existing = sessionRunStateRef.current.get(sessionKey);
            if (existing && existing.runId === idempotencyKey) {
              sessionRunStateRef.current.set(sessionKey, {
                ...existing,
                runId: serverRunId,
              });
            }
          }
        })
        .catch((err: unknown) => {
          if (
            pendingOptimisticRunIdsRef.current.get(sessionKey) ===
            idempotencyKey
          ) {
            pendingOptimisticRunIdsRef.current.delete(sessionKey);
          }
          if (claimsActiveRun && currentRunIdRef.current === idempotencyKey) {
            setIsSending(false);
            setChatStream(null);
            currentRunIdRef.current = null;
            streamStartedAtRef.current = null;
            sessionRunStateRef.current.delete(sessionKey);
          }
          const msg = err instanceof Error ? err.message : String(err);
          history.setMessages((prev) => [
            ...prev,
            {
              id: `err_${Date.now()}`,
              role: "system",
              text: `Send failed: ${msg}`,
            },
          ]);
        });
    },
    [adapter, dbg, history, markTransportConfirmed, t],
  );

  const submitMessageWithConnectionCheck = useCallback(
    async (
      text: string,
      images: PendingImage[],
      options?: { triggerGuardHeld?: boolean },
    ): Promise<boolean> => {
      const triggerGuardHeld = options?.triggerGuardHeld === true;
      const acquiredGuardLocally = !triggerGuardHeld;
      if (acquiredGuardLocally && !acquireSendTriggerGuard()) return false;
      let shouldReleaseTriggerGuard = true;
      if (sendPreflightInFlightRef.current) {
        if (acquiredGuardLocally) {
          releaseSendTriggerGuard();
        }
        return false;
      }
      if (!history.sessionKey) {
        if (acquiredGuardLocally) {
          releaseSendTriggerGuard();
        }
        return false;
      }

      sendPreflightInFlightRef.current = true;
      setIsPreparingSend(true);
      try {
        const ready = await ensureConnectionReadyForSend();
        if (!ready) return false;
        const prepared = await preparePendingImagesForSend(images);
        if (prepared.changed) {
          setPendingImages(prepared.images);
        }
        submitMessage(text, prepared.images);
        shouldReleaseTriggerGuard = false;
        return true;
      } finally {
        sendPreflightInFlightRef.current = false;
        setIsPreparingSend(false);
        if (shouldReleaseTriggerGuard) {
          releaseSendTriggerGuard();
        }
      }
    },
    [
      acquireSendTriggerGuard,
      ensureConnectionReadyForSend,
      history.sessionKey,
      releaseSendTriggerGuard,
      setPendingImages,
      submitMessage,
    ],
  );

  const {
    availableModels,
    availableProviders,
    currentModel,
    currentModelHeaderLabel,
    currentModelProvider,
    modelPickerError,
    modelPickerLoading,
    modelPickerVisible,
    onSelectModel,
    openModelPicker,
    retryModelPickerLoad,
    setModelPickerVisible,
  } = useChatModelPicker({
    connectionState,
    adapter,
    sessionKey: history.sessionKey,
    setInput,
    setSessions: history.setSessions,
  });

  const runSilentCommandProbe = useCallback(
    (commandText: string): Promise<string> => {
      const sessionKey = history.sessionKey;
      if (!sessionKey) {
        return Promise.reject(new Error("No active session."));
      }

      const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      return new Promise<string>((resolve, reject) => {
        const probe: SilentCommandProbe = {
          sessionKey,
          latestText: "",
          finishing: false,
          timeout: null,
          resolve,
          reject,
        };
        silentCommandProbesRef.current.set(runId, probe);
        void (async () => {
          const ready = await ensureConnectionReadyForSend();
          if (!ready) {
            finishSilentCommandProbe(runId, {
              error: new Error("Gateway is not connected."),
            });
            return;
          }
          if (!adapter) {
            finishSilentCommandProbe(runId, {
              error: new Error("Gateway is not connected."),
            });
            return;
          }
          adapter
            .prompt(sessionKey, { text: commandText, idempotencyKey: runId })
            .catch((err: unknown) => {
              finishSilentCommandProbe(runId, {
                error: err instanceof Error ? err : new Error(String(err)),
              });
            });
        })();

        probe.timeout = setTimeout(() => {
          finishSilentCommandProbe(runId, {
            error: new Error("Timed out while loading command options."),
          });
        }, 15_000);
      });
    },
    [
      ensureConnectionReadyForSend,
      finishSilentCommandProbe,
      adapter,
      history.sessionKey,
    ],
  );

  const {
    closeCommandPicker,
    commandPickerError,
    commandPickerLoading,
    commandPickerOptions,
    commandPickerTitle,
    commandPickerVisible,
    onSelectCommandOption,
    openCommandPicker,
    retryCommandPickerLoad,
  } = useChatCommandPicker({
    connectionState,
    runSilentCommandProbe,
    sessionKey: history.sessionKey,
    setInput,
    setThinkingLevel: history.setThinkingLevel,
    submitMessage: submitMessageWithConnectionCheck,
    t,
  });

  const onSend = useCallback(() => {
    void (async () => {
      const text = input.trim();
      const images = [...pendingImages];
      if ((!text && images.length === 0) || !history.sessionKey) return;
      if (!acquireSendTriggerGuard()) return;

      if (voiceInputActive) {
        void stopSpeechRecognitionAsync().catch(() => {});
      }

      analyticsEvents.chatSendTapped({
        has_text: text.length > 0,
        text_length: text.length,
        attachment_count: images.length,
        image_count: images.filter((image) => isImageAttachmentMimeType(image.mimeType)).length,
        file_count: images.filter((image) => !isImageAttachmentMimeType(image.mimeType)).length,
        attachment_formats: summarizeAttachmentFormats(images) ?? undefined,
        is_command: text.startsWith("/"),
        slash_command: extractSlashCommand(text) ?? undefined,
        session_key_present: Boolean(history.sessionKey),
      });

      if (
        text.toLowerCase() === "/models" &&
        images.length === 0 &&
        openModelPicker()
      ) {
        releaseSendTriggerGuard();
        setInput("");
        clearPendingImages();
        return;
      }

      if (
        text.toLowerCase() === "/think" &&
        images.length === 0 &&
        openCommandPicker("think")
      ) {
        releaseSendTriggerGuard();
        setInput("");
        clearPendingImages();
        return;
      }

      if (
        text.toLowerCase() === "/fast" &&
        images.length === 0 &&
        openCommandPicker("fast")
      ) {
        releaseSendTriggerGuard();
        setInput("");
        clearPendingImages();
        return;
      }

      if (
        text.toLowerCase() === "/reasoning" &&
        images.length === 0 &&
        openCommandPicker("reasoning")
      ) {
        releaseSendTriggerGuard();
        setInput("");
        clearPendingImages();
        return;
      }

      // Haptic feedback — crisp impact
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);

      const sent = await submitMessageWithConnectionCheck(text, images, {
        triggerGuardHeld: true,
      });
      if (!sent) return;

      // Clear input without remounting TextInput (preserves keyboard)
      if (shouldClearComposerInput("send-button")) {
        setInput("");
        composerRef.current?.clear();
      }
      clearPendingImages();
      clearPersistedDraft();
    })();
  }, [
    clearPendingImages,
    clearPersistedDraft,
    acquireSendTriggerGuard,
    history.sessionKey,
    input,
    openCommandPicker,
    openModelPicker,
    pendingImages,
    releaseSendTriggerGuard,
    submitMessageWithConnectionCheck,
    voiceInputActive,
  ]);

  const onSelectSlashCommand = useCallback(
    (command: SlashCommand) => {
      setSlashSuggestionsDismissed(false);
      setSlashMenuForced(false);

      // Clear the input when user typed a slash-prefixed query (e.g. "/s")
      // so the suggestion popup dismisses and stale text is removed.
      // Fill-type commands will overwrite the input below, so this is safe.
      if (input.startsWith("/")) {
        setInput("");
      }

      analyticsEvents.chatSlashCommandTriggered({
        command_key: command.key,
        command: command.command,
        action: command.action,
        source: "slash_suggestions",
        session_key_present: Boolean(history.sessionKey),
      });

      if (
        (command.key === "think" || command.key === "reasoning" || command.key === "fast") &&
        openCommandPicker(command.key)
      ) {
        return;
      }

      if (command.action === "fill") {
        setInput(`${command.command} `);
        return;
      }

      if (command.action === "custom") {
        if (command.key === "models" && openModelPicker()) {
          return;
        }

        if (connectionState === "ready" && !!history.sessionKey) {
          void submitMessageWithConnectionCheck(command.command, []).then(
            (sent) => {
              if (!sent) {
                setInput(command.command);
              }
            },
          );
          return;
        }

        setInput(command.command);
        return;
      }

      if (connectionState === "ready" && !!history.sessionKey) {
        void submitMessageWithConnectionCheck(command.command, []).then(
          (sent) => {
            if (!sent) {
              setInput(command.command);
            }
          },
        );
        return;
      }

      setInput(command.command);
    },
    [
      connectionState,
      history.sessionKey,
      input,
      openCommandPicker,
      openModelPicker,
      submitMessageWithConnectionCheck,
    ],
  );

  const dismissSlashSuggestions = useCallback(() => {
    setSlashSuggestionsDismissed(true);
    setSlashMenuForced(false);
  }, []);

  const openSlashMenu = useCallback(() => {
    if (slashMenuForced) {
      setSlashSuggestionsDismissed(true);
      setSlashMenuForced(false);
    } else {
      setSlashSuggestionsDismissed(false);
      setSlashMenuForced(true);
    }
  }, [slashMenuForced]);

  const slashToken = useMemo(() => {
    if (!input.startsWith("/")) return "";
    return input.slice(1).split(/\s/, 1)[0] ?? "";
  }, [input]);

  const slashSuggestions = useMemo(() => {
    if (slashSuggestionsDismissed) return [] as SlashCommand[];

    // Button-triggered: show all commands
    if (slashMenuForced && !input.startsWith("/")) return SLASH_COMMANDS;

    if (!input.startsWith("/")) return [] as SlashCommand[];
    if (/\s/.test(input.slice(1))) return [] as SlashCommand[];

    const normalized = slashToken.toLowerCase();
    const prefix = `/${normalized}`;
    return SLASH_COMMANDS.filter((item) =>
      item.command.toLowerCase().startsWith(prefix),
    );
    // .slice(0, 8);
  }, [input, slashSuggestionsDismissed, slashMenuForced, slashToken]);

  const showSlashSuggestions = slashSuggestions.length > 0;

  const openStaticThinkPicker = useCallback(() => {
    setStaticThinkPickerVisible(true);
  }, []);

  const closeStaticThinkPicker = useCallback(() => {
    setStaticThinkPickerVisible(false);
  }, []);

  const onSelectStaticThinkLevel = useCallback(
    (level: string) => {
      setStaticThinkPickerVisible(false);

      const effectiveLevel = level === "off" ? null : level;
      history.setThinkingLevel(effectiveLevel);

      const commandText = `/think ${level}`;
      if (connectionState !== "ready" || !history.sessionKey) {
        setInput(commandText);
        return;
      }
      void submitMessageWithConnectionCheck(commandText, []).then((sent) => {
        if (!sent) {
          setInput(commandText);
        }
      });
    },
    [connectionState, history, submitMessageWithConnectionCheck],
  );

  const openSession = useCallback(
    (
      session: SessionInfo,
      options?: {
        forceReload?: boolean;
        clearInput?: boolean;
        clearWhenEmpty?: boolean;
      },
    ) => {
      if (!options?.forceReload && session.key === history.sessionKey) {
        return;
      }

      if (session.key !== history.sessionKey) {
        persistCurrentRunState(history.sessionKey);
      }
      sessionKeyRef.current = session.key;
      history.setSessionKey(session.key);
      history.setHistoryLoaded(false);
      if (options?.clearInput !== false) {
        setInput("");
      }
      resetDraftLoadState();
      restoreRunStateForSession(session.key);
      history.historyLimitRef.current = HISTORY_PAGE_SIZE;
      history.setHasMoreHistory(true);
      history.historyRawCountRef.current = 0;
      history.loadMoreLockRef.current = false;
      void history.restoreCachedMessages(session.key, {
        clearWhenEmpty: options?.clearWhenEmpty ?? true,
        sessionId: session.sessionId,
      });
      history.loadHistory(session.key, HISTORY_PAGE_SIZE);
    },
    [
      history,
      persistCurrentRunState,
      resetDraftLoadState,
      restoreRunStateForSession,
    ],
  );

  const switchSession = useCallback(
    (session: SessionInfo) => {
      openSession(session);
    },
    [openSession],
  );

  const reloadSession = useCallback(
    (
      session: SessionInfo,
      options?: { clearInput?: boolean; clearWhenEmpty?: boolean },
    ) => {
      openSession(session, {
        forceReload: true,
        clearInput: options?.clearInput ?? false,
        clearWhenEmpty: options?.clearWhenEmpty ?? true,
      });
    },
    [openSession],
  );

  // React to agent switches from outside Chat.
  useEffect(() => {
    if (!pendingAgentSwitch) return;
    const mainKey = `agent:${pendingAgentSwitch}:main`;
    clearPendingAgentSwitch();
    const found = history.sessions.find((s: SessionInfo) => s.key === mainKey);
    if (found) {
      switchSession(found);
    } else {
      switchSession({ key: mainKey, kind: "unknown", label: "Main session" });
    }
  }, [
    pendingAgentSwitch,
    clearPendingAgentSwitch,
    history.sessions,
    switchSession,
  ]);

  // Consume pending chat input that also requires switching to main session
  useEffect(() => {
    if (pendingChatInput && pendingMainSessionSwitch) {
      const found = history.sessions.find(
        (s: SessionInfo) => s.key === mainSessionKey,
      );
      if (found) {
        switchSession(found);
      } else {
        switchSession({
          key: mainSessionKey,
          kind: "unknown",
          label: "Main session",
        });
      }
      clearPendingMainSessionSwitch();
      setInput(pendingChatInput);
      clearPendingChatInput();
    }
  }, [
    pendingChatInput,
    pendingMainSessionSwitch,
    clearPendingMainSessionSwitch,
    clearPendingChatInput,
    mainSessionKey,
    history.sessions,
    switchSession,
  ]);

  useEffect(() => {
    const pendingKey = pendingNotificationScrollSessionKeyRef.current;
    if (!pendingKey) return;
    if (!history.historyLoaded || !history.sessionKey) return;
    if (!sessionKeysMatch(history.sessionKey, pendingKey)) return;
    pendingNotificationScrollSessionKeyRef.current = null;
    setScrollToBottomRequestAt(Date.now());
  }, [history.historyLoaded, history.sessionKey]);

  useEffect(() => {
    const targetKey = chatSessionRequest?.sessionKey?.trim();
    if (!targetKey) return;
    if (history.sessionKey === targetKey) {
      clearChatSessionRequest?.();
      return;
    }

    let cancelled = false;

    const openRequestedSession = async () => {
      let latestSessions = history.sessions;
      let targetSession = latestSessions.find(
        (session) => session.key === targetKey,
      );
      if (!targetSession) {
        try {
          latestSessions = adapter
            ? (await adapter.listSessions(currentAgentId)).map(mapAdapterSession)
            : [];
          if (cancelled) return;
          history.setSessions(latestSessions);
          targetSession = latestSessions.find(
            (session) => session.key === targetKey,
          );
        } catch {
          // Ignore and fall back to opening the key directly.
        }
      }

      if (cancelled) return;
      switchSession(
        targetSession ?? {
          key: targetKey,
          kind: "unknown",
          label: targetKey,
        },
      );
      clearChatSessionRequest?.();
    };

    void openRequestedSession();
    return () => {
      cancelled = true;
    };
  }, [
    clearChatSessionRequest,
    adapter,
    currentAgentId,
    history.sessionKey,
    history.sessions,
    history.setSessions,
    chatSessionRequest,
    switchSession,
  ]);

  useEffect(() => {
    const targetKey = pendingChatNotificationOpen?.sessionKey?.trim();
    if (!targetKey) return;

    if (history.historyLoaded && history.sessionKey && sessionKeysMatch(history.sessionKey, targetKey)) {
      pendingNotificationScrollSessionKeyRef.current = null;
      setScrollToBottomRequestAt(Date.now());
      clearPendingChatNotificationOpen();
      return;
    }

    let cancelled = false;
    pendingNotificationScrollSessionKeyRef.current = targetKey;

    const openFromNotification = async () => {
      let latestSessions = history.sessions;
      let targetSession = latestSessions.find((session) => session.key === targetKey);
      if (!targetSession) {
        try {
          latestSessions = adapter
            ? (await adapter.listSessions(currentAgentId)).map(mapAdapterSession)
            : [];
          if (cancelled) return;
          history.setSessions(latestSessions);
          targetSession = latestSessions.find((session) => session.key === targetKey);
        } catch {
          // Ignore and fall back to opening the key directly.
        }
      }

      if (cancelled) return;
      switchSession(
        targetSession ?? {
          key: targetKey,
          kind: 'unknown',
          label: targetKey,
        },
      );
      clearPendingChatNotificationOpen();
    };

    void openFromNotification();
    return () => {
      cancelled = true;
    };
  }, [
    clearPendingChatNotificationOpen,
    adapter,
    currentAgentId,
    history.historyLoaded,
    history.sessionKey,
    history.sessions,
    history.setSessions,
    pendingChatNotificationOpen,
    switchSession,
  ]);

  const handleCopyCommand = useCallback(async () => {
    await Clipboard.setStringAsync(APPROVE_COMMAND);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const handlePairingRetry = useCallback(() => {
    setPairingPending(false);
    reconnectAdapter(adapter);
  }, [adapter]);

  const listData = useMemo((): UiMessage[] => {
    return buildLiveRunListData({
      historyMessages: history.messages,
      streamSegments: chatStreamSegments,
      toolMessages: chatToolMessages,
      liveStreamText: chatStream,
      liveStreamStartedAt: streamStartedAtRef.current,
      activeRunId: currentRunIdRef.current,
    });
  }, [chatStream, chatStreamSegments, chatToolMessages, history.messages]);

  const resolveApproval = useCallback(
    (id: string, decision: "allow-once" | "allow-always" | "deny") => {
      analyticsEvents.approvalResolved({
        kind: "exec",
        decision,
      });
      const status =
        decision === "deny" ? ("denied" as const) : ("allowed" as const);
      history.setMessages((prev) =>
        prev.map((m) =>
          m.approval?.id === id
            ? { ...m, approval: { ...m.approval, status } }
            : m,
        ),
      );
      adapter?.management?.approvals?.resolveExec(id, decision).catch(() => {});
    },
    [adapter, history],
  );

  const abortCurrentRun = useCallback(() => {
    if (!history.sessionKey) return;
    if (!adapter?.capabilities.abort) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
    const runIdAtAbort = currentRunIdRef.current;
    adapter
      .cancel(history.sessionKey, runIdAtAbort ?? undefined)
      .catch((err) => {
        dbg(`Abort failed: ${String(err)}`);
      });
    // Local fallback: if no terminal event clears the run within 5s,
    // force-clear the stuck state so the UI becomes responsive.
    setTimeout(() => {
      if (!currentRunIdRef.current) return; // Already cleared
      if (runIdAtAbort && currentRunIdRef.current !== runIdAtAbort)
        return; // Different run
      const sessionKey = sessionKeyRef.current;
      if (sessionKey) {
        sessionRunStateRef.current.delete(sessionKey);
      }
      currentRunIdRef.current = null;
      streamStartedAtRef.current = null;
      clearTransientRunPresentation();
      setIsSending(false);
      setActivityLabel(null);
      dbg("Abort fallback: force-cleared stuck run state");
    }, 5000);
  }, [adapter, clearTransientRunPresentation, dbg, history.sessionKey]);

  const handleRefresh = useCallback(async () => {
    if (connectionState !== "ready") {
      const ok = await adapter?.probe();
      if (!ok) return;
    }
    await history.onRefresh();
  }, [adapter, connectionState, history]);

  return {
    connectionState,
    input,
    setInput,
    composerRef,
    isSending,
    sessionKey: history.sessionKey,
    sessions: history.sessions,
    agentAvatarUri: agentIdentity.avatarUri,
    agentDisplayName: agentIdentity.displayName,
    agentEmoji: agentIdentity.emoji,
    refreshSessions: history.refreshSessions,
    refreshing: history.refreshing,
    refreshingSessions: history.refreshingSessions,
    hasMoreHistory: history.hasMoreHistory,
    loadingMoreHistory: history.loadingMoreHistory,
    historyLoaded: history.historyLoaded,
    scrollToBottomRequestAt,
    pairingPending,
    copied,
    debugLog,
    keyboardVisible,
    compactionNotice,
    pendingImages,
    setPendingImages,
    pickImage,
    takePhoto,
    pickFile,
    onPasteFiles,
    onPasteFailed,
    removePendingImage,
    canAddMoreImages,
    preview,
    showDebug,
    showAgentAvatar: showAgentAvatar ?? false,
    onRefresh: handleRefresh,
    onLoadMoreHistory: history.onLoadMoreHistory,
    canSend,
    onSend,
    voiceInputSupported,
    voiceInputState,
    voiceInputActive,
    voiceInputDisabled,
    voiceInputLevel,
    toggleVoiceInput,
    slashSuggestions,
    showSlashSuggestions,
    onSelectSlashCommand,
    dismissSlashSuggestions,
    openSlashMenu,
    modelPickerVisible,
    setModelPickerVisible,
    modelPickerLoading,
    modelPickerError,
    availableModels,
    availableProviders,
    retryModelPickerLoad,
    onSelectModel,
    openModelPicker,
    currentModel,
    currentModelHeaderLabel,
    currentModelProvider,
    thinkingLevel: history.thinkingLevel,
    openThinkPicker: openStaticThinkPicker,
    staticThinkPickerVisible,
    closeStaticThinkPicker,
    onSelectStaticThinkLevel,
    commandPickerVisible,
    commandPickerTitle,
    commandPickerLoading,
    commandPickerError,
    commandPickerOptions,
    retryCommandPickerLoad,
    closeCommandPicker,
    onSelectCommandOption,
    switchSession,
    reloadSession,
    handleCopyCommand,
    handlePairingRetry,
    listData,
    approveCommand: APPROVE_COMMAND,
    activityLabel,
    thinkingLevelOptions,
    abortCurrentRun,
    canAbortCurrentRun: adapter?.capabilities.abort === true,
    resolveApproval,
    agentActivityRef,
    agentActiveCount,
    childSessionActivityRef,
    childSessionActivityVersion,
    clearChildSessionActivities,
  };
}
