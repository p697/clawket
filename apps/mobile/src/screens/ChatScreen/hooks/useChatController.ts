import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
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
import { ChatComposerHandle } from "../../../components/chat/ChatComposer";
import { SLASH_COMMANDS, SlashCommand } from "../../../data/slash-commands";
import { useChatImagePicker } from "../../../hooks/useChatImagePicker";
import * as DocumentPicker from "expo-document-picker";

import { useChatImagePreview } from "../../../hooks/useChatImagePreview";
import { analyticsEvents } from "../../../services/analytics/events";
import { getGatewayThinkingLevels } from "../../../services/gateway-backends";
import { resolveGatewayCacheScopeId } from "../../../services/gateway-cache-scope";
import { cacheMessageImages } from "../../../services/image-cache";
import { stopSpeechRecognitionAsync } from "../../../services/speech/speechRecognition";
import { StorageService } from "../../../services/storage";
import { ConnectionState, SessionInfo } from "../../../types";
import { PendingImage, UiMessage } from "../../../types/chat";
import {
  extractAssistantDisplayText,
  extractText,
  isAssistantDeliveryMirrorMessage,
  isAssistantSilentReplyMessage,
  parseMessageTimestamp,
  sessionLabel,
  shouldHideMessage,
} from "../../../utils/chat-message";
import { sessionKeysMatch } from "../../../utils/session-key";
import { useChatAutoCache } from "../../../hooks/useChatAutoCache";
import { APPROVE_COMMAND, HISTORY_PAGE_SIZE, MAX_IMAGES } from "../constants";
import { ChatScreenProps } from "../types";
import { useAppContext } from "../../../contexts/AppContext";
import {
  AgentActivity,
  agentIdFromSessionKey,
  applyRunStart,
} from "./agentActivity";
import { ChildSessionActivity } from "./childSessionActivity";
import { resolveCachedAgentIdentity } from "./cacheAgentIdentity";
import { shouldClearComposerInput } from "./composerClearPolicy";
import { canSendMessage } from "./composerInteractionPolicy";
import { deriveCurrentSessionActivity } from "./currentSessionActivity";
import { hasCompletedAssistantForRememberedRun } from "./runStateValidation";
import { hasActiveGatewayConfig } from "./chatSyncPolicy";
import { useChatHistoryState } from "./useChatHistoryState";
import { useGatewayChatEvents } from "./useGatewayChatEvents";
import { buildLiveRunListData, StreamSegment } from "./liveRunThread";
import { SessionRunState } from "./sessionRunState";
import {
  FOREGROUND_REFRESH_AFTER_RECONNECT_TIMEOUT_MS,
  getForegroundRefreshDelayMs,
  shouldReconnectBeforeForegroundRefresh,
} from "./foregroundRefreshPolicy";
import { formatToolActivity } from "../../../utils/tool-display";
import { useChatVoiceInput } from "./useChatVoiceInput";
import { useChatModelPicker } from "./useChatModelPicker";
import { useChatCommandPicker } from "./useChatCommandPicker";
import { isMacCatalyst } from "../../../utils/platform";
import {
  extractSlashCommand,
  readFileAsBase64,
  sanitizeVisibleStreamText,
  summarizeAttachmentFormats,
} from "./chatControllerUtils";
import { useChatComposerDraft } from "./useChatComposerDraft";
import { useChatAgentIdentity } from "./useChatAgentIdentity";
import { useBufferedDebugLog } from "./useBufferedDebugLog";
import { preparePendingImagesForSend } from "./preparePendingImagesForSend";

type PendingImageWithFile = PendingImage & { fileName?: string };

export function useChatController({
  gateway,
  config,
  debugMode,
  showAgentAvatar,
  officeChatRequest,
  clearOfficeChatRequest,
}: ChatScreenProps) {
  const appContext = useAppContext();
  const { t, i18n } = useTranslation("chat");
  const { speechRecognitionLanguage } = appContext;
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    gateway.getConnectionState(),
  );
  const [input, setInput] = useState("");
  const composerRef = useRef<ChatComposerHandle>(null);
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

  const pickFile = useCallback(async () => {
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
        mimeType: asset.mimeType ?? "application/octet-stream",
        fileName: asset.name,
      };
      setPendingImages((prev: PendingImage[]) =>
        [...prev, img].slice(0, MAX_IMAGES),
      );
    } catch {
      /* skip */
    }
  }, [setPendingImages]);

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
            mimeType: a.mimeType ?? "image/jpeg",
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
  const hasGatewayConfig = hasActiveGatewayConfig(config);
  const backendKind = gateway.getBackendKind();
  const thinkingLevelOptions = useMemo(
    () => getGatewayThinkingLevels(backendKind),
    [backendKind],
  );

  const sessionKeyRef = useRef<string | null>(null);
  const lastConnStateRef = useRef<ConnectionState>(
    gateway.getConnectionState(),
  );
  const sendPreflightInFlightRef = useRef(false);

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
  const silentCommandRunIdsRef = useRef<Set<string>>(new Set());

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
    activeGatewayConfigId,
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
  const gatewayConfigId = resolveGatewayCacheScopeId({
    activeConfigId: activeGatewayConfigId,
    config,
  });
  const history = useChatHistoryState({
    gateway,
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
    gateway,
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
        const historyResult = await gateway.fetchHistory(sessionKey, 12);
        if (sessionKeyRef.current !== sessionKey) return;

        let latestAssistantTs = 0;
        let latestAssistantText = "";
        for (
          let index = historyResult.messages.length - 1;
          index >= 0;
          index--
        ) {
          const message = historyResult.messages[index];
          if (message.role !== "assistant") continue;
          if (isAssistantDeliveryMirrorMessage(message)) continue;
          if (isAssistantSilentReplyMessage(message)) continue;
          const text = extractAssistantDisplayText(message.content);
          if (!text.trim()) continue;
          latestAssistantText = text;
          latestAssistantTs = parseMessageTimestamp(message);
          break;
        }

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
      gateway,
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
    if (!hasGatewayConfig) {
      dbg("autoRefresh:skip no gateway config");
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
    hasGatewayConfig,
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
      if (!hasGatewayConfig) {
        dbg("foregroundRefresh:skip no gateway config");
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
          connectionState: gateway.getConnectionState(),
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
          const ok = await gateway.probeConnection(
            FOREGROUND_REFRESH_AFTER_RECONNECT_TIMEOUT_MS,
          );
          if (foregroundRefreshProbeSeqRef.current !== probeSeq) return;
          if (ok) {
            autoRefresh();
          }
        })();
      }, delayMs);
    },
    [autoRefresh, clearForegroundRefreshWait, dbg, gateway, hasGatewayConfig],
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
      gateway.reconnect();
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
    gateway,
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
          if (awayMs >= 12_000 || gateway.getConnectionState() !== "ready") {
            void gateway.probeConnection();
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
    gateway,
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
    if (isFocused && !wasFocused && hasGatewayConfig) {
      autoRefresh();
    }
  }, [isFocused, autoRefresh, hasGatewayConfig]);

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
        gateway.reconnect();
      }
    }, 4_000);

    return () => clearInterval(interval);
  }, [
    clearActiveRunState,
    connectionState,
    dbg,
    gateway,
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

  const shouldIgnoreRunId = useCallback((runId: string) => {
    return silentCommandRunIdsRef.current.has(runId);
  }, []);

  useGatewayChatEvents({
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
    setMessages: history.setMessages,
    setToolMessages: setChatToolMessages,
    commitCurrentStreamSegment,
    clearTransientRunPresentation,
    setCompactionNotice,
    loadSessionsAndHistory: history.loadSessionsAndHistory,
    reconcileLatestAssistantFromHistory:
      history.reconcileLatestAssistantFromHistory,
    currentAgentId,
    onAgentsLoaded: setAgents,
    onDefaultAgentId: useCallback(
      (defaultId: string) => {
        // Apply gateway's default agent only if user hasn't persisted a choice
        StorageService.getCurrentAgentId()
          .then((persisted) => {
            if (!persisted) setCurrentAgentId(defaultId);
          })
          .catch(() => {});
      },
      [setCurrentAgentId],
    ),
    shouldIgnoreRunId,
    onStreamFinished: useCallback(() => {
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
    ]),
    execApprovalEnabled,
    setActivityLabel,
    agentActivityRef,
    childSessionActivityRef,
    onChildSessionActivityChange,
    onAgentActiveCountChange,
    resetAgentActiveCount,
    onRunSignal: useCallback(() => {
      clearPostStreamHistoryRefreshTimer();
      lastRunSignalAtRef.current = Date.now();
      lastRunRecoveryProbeAtRef.current = 0;
      armPendingRunTimeout();
    }, [armPendingRunTimeout, clearPostStreamHistoryRefreshTimer]),
    onToolSettled: useCallback(
      ({
        runId,
        sessionKey,
        toolName,
        status,
      }: {
        runId: string;
        sessionKey: string | null;
        toolName: string;
        status: "success" | "error";
      }) => {
        if (!sessionKey || sessionKey !== history.sessionKey) return;
        if (currentRunIdRef.current !== runId) return;
        clearToolSettledRecoveryTimer();
        if (showDebug)
          dbg(
            `toolSettled:schedule session=${sessionKey} runId=${runId.slice(0, 8)} tool=${toolName} status=${status}`,
          );
        toolSettledRecoveryTimerRef.current = setTimeout(() => {
          toolSettledRecoveryTimerRef.current = null;
          if (
            currentRunIdRef.current !== runId ||
            history.sessionKey !== sessionKey
          )
            return;
          if (showDebug)
            dbg(
              `toolSettled:recover session=${sessionKey} runId=${runId.slice(0, 8)} tool=${toolName} status=${status}`,
            );
          void requestRunRecovery(sessionKey, "tool-settled");
        }, 1800);
      },
      [
        clearToolSettledRecoveryTimer,
        dbg,
        history.sessionKey,
        requestRunRecovery,
        showDebug,
      ],
    ),
    onToolResult: useCallback(
      ({
        runId,
        sessionKey,
      }: {
        runId: string;
        sessionKey: string | null;
        toolName: string;
        status: "success" | "error";
      }) => {
        if (!sessionKey || sessionKey !== history.sessionKey) return;
        if (currentRunIdRef.current !== runId) return;
        requestVisibleHistoryReload(sessionKey, "tool-result").catch(() => {});
      },
      [
        history.sessionKey,
        requestVisibleHistoryReload,
      ],
    ),
  });

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

  const markTransportConfirmed = useCallback((timestampMs = Date.now()) => {
    lastConfirmedTransportAtRef.current = timestampMs;
    forceSendProbeUntilRef.current = 0;
  }, []);

  useEffect(() => {
    if (connectionState === "ready") return;
    forceSendProbeUntilRef.current = Date.now() + SEND_FORCE_PROBE_GRACE_MS;
  }, [connectionState, SEND_FORCE_PROBE_GRACE_MS]);

  useEffect(() => {
    const markIfReady = () => {
      if (gateway.getConnectionState() === "ready") {
        markTransportConfirmed();
      }
    };

    const offTick = gateway.on("tick", markIfReady);
    const offHealth = gateway.on("health", markIfReady);
    const offDelta = gateway.on("chatDelta", markIfReady);
    const offFinal = gateway.on("chatFinal", markIfReady);
    const offErr = gateway.on("error", () => {
      forceSendProbeUntilRef.current = Date.now() + SEND_FORCE_PROBE_GRACE_MS;
    });

    return () => {
      offTick();
      offHealth();
      offDelta();
      offFinal();
      offErr();
    };
  }, [gateway, markTransportConfirmed, SEND_FORCE_PROBE_GRACE_MS]);

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
        const ok =
          connectionState === "ready"
            ? await gateway.probeConnection(SEND_FAST_PROBE_TIMEOUT_MS)
            : await gateway.probeConnection();
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
      gateway,
      isNetworkLikelyOffline,
      markTransportConfirmed,
      SEND_FAST_PROBE_TIMEOUT_MS,
      SEND_FORCE_PROBE_GRACE_MS,
      SEND_HEALTH_WINDOW_MS,
    ]);

  const submitMessage = useCallback(
    (text: string, images: PendingImage[]) => {
      const sessionKey = history.sessionKey;
      if (!sessionKey) return;
      const localTimestamp = Date.now();
      const idempotencyKey = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const realImages = images.filter((i) => i.mimeType.startsWith("image/"));
      const files = images.filter((i) => !i.mimeType.startsWith("image/"));
      const fileNames = files
        .map((f) => (f as PendingImageWithFile).fileName ?? "File")
        .join(", ");
      const autoText = [
        realImages.length > 0
          ? `📷 ${realImages.length} image${realImages.length > 1 ? "s" : ""}`
          : "",
        files.length > 0 ? `📎 ${fileNames}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const uiMsg: UiMessage = {
        id: `usr_${localTimestamp}`,
        role: "user",
        text: text || autoText || "",
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

      if (images.length > 0 && !shouldHideMessage(uiMsg)) {
        cacheMessageImages(
          sessionKey,
          uiMsg.text,
          images.map((image) => ({
            base64: image.base64,
            mimeType: image.mimeType,
            width: image.width,
            height: image.height,
          })),
          { timestamp: localTimestamp, role: "user", idempotencyKey },
        )
          .then(() =>
            dbg(`cache write ok: ts=${localTimestamp} images=${images.length}`),
          )
          .catch((err) => dbg(`cache write failed: ${String(err)}`));
      }

      const attachments =
        images.length > 0
          ? images.map((image) => ({
              type: (image as PendingImageWithFile).fileName ? "file" : "image",
              mimeType: image.mimeType,
              content: image.base64,
              ...((image as PendingImageWithFile).fileName
                ? { fileName: (image as PendingImageWithFile).fileName }
                : {}),
            }))
          : undefined;

      const effectiveText = text || (attachments ? "Look at this image" : " ");
      gateway
        .sendChat(sessionKey, effectiveText, attachments, { idempotencyKey })
        .then(({ runId: serverRunId }) => {
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
    [dbg, gateway, history, markTransportConfirmed],
  );

  const submitMessageWithConnectionCheck = useCallback(
    async (text: string, images: PendingImage[]): Promise<boolean> => {
      if (sendPreflightInFlightRef.current) return false;
      if (!history.sessionKey) return false;

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
        return true;
      } finally {
        sendPreflightInFlightRef.current = false;
        setIsPreparingSend(false);
      }
    },
    [
      ensureConnectionReadyForSend,
      history.sessionKey,
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
    gateway,
    sessionKey: history.sessionKey,
    setInput,
    setSessions: history.setSessions,
    submitMessage: submitMessageWithConnectionCheck,
  });

  const runSilentCommandProbe = useCallback(
    (commandText: string): Promise<string> => {
      const sessionKey = history.sessionKey;
      if (!sessionKey) {
        return Promise.reject(new Error("No active session."));
      }

      const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      let latestText = "";
      let finished = false;

      return new Promise<string>((resolve, reject) => {
        let timeoutRef: ReturnType<typeof setTimeout> | null = null;

        const cleanup = (
          offDelta: () => void,
          offFinal: () => void,
          offAborted: () => void,
          offChatError: () => void,
        ) => {
          offDelta();
          offFinal();
          offAborted();
          offChatError();
          silentCommandRunIdsRef.current.delete(runId);
          if (timeoutRef) {
            clearTimeout(timeoutRef);
            timeoutRef = null;
          }
        };

        const offDelta = gateway.on(
          "chatDelta",
          ({ runId: evtRunId, sessionKey: evtKey, text }) => {
            if (evtRunId !== runId || evtKey !== sessionKey) return;
            latestText = text;
          },
        );

        const offFinal = gateway.on(
          "chatFinal",
          ({ runId: evtRunId, sessionKey: evtKey }) => {
            if (evtRunId !== runId || evtKey !== sessionKey || finished) return;
            finished = true;
            void (async () => {
              let finalText = latestText;
              if (!finalText.trim()) {
                try {
                  const historyResult = await gateway.fetchHistory(
                    sessionKey,
                    8,
                  );
                  const assistant = [...historyResult.messages]
                    .reverse()
                    .find((item) => (
                      item.role === "assistant"
                      && !isAssistantDeliveryMirrorMessage(item)
                    ));
                  finalText = extractAssistantDisplayText(assistant?.content);
                } catch {
                  finalText = latestText;
                }
              }
              cleanup(offDelta, offFinal, offAborted, offChatError);
              resolve(finalText);
            })();
          },
        );

        const offAborted = gateway.on(
          "chatAborted",
          ({ runId: evtRunId, sessionKey: evtKey }) => {
            if (evtRunId !== runId || evtKey !== sessionKey || finished) return;
            finished = true;
            cleanup(offDelta, offFinal, offAborted, offChatError);
            reject(new Error("Command probe aborted."));
          },
        );

        const offChatError = gateway.on(
          "chatError",
          ({ runId: evtRunId, sessionKey: evtKey, message }) => {
            if (evtRunId !== runId || evtKey !== sessionKey || finished) return;
            finished = true;
            cleanup(offDelta, offFinal, offAborted, offChatError);
            reject(new Error(message || "Command probe failed."));
          },
        );

        silentCommandRunIdsRef.current.add(runId);
        void (async () => {
          const ready = await ensureConnectionReadyForSend();
          if (!ready) {
            if (finished) return;
            finished = true;
            cleanup(offDelta, offFinal, offAborted, offChatError);
            reject(new Error("Gateway is not connected."));
            return;
          }
          gateway
            .sendChat(sessionKey, commandText, undefined, {
              idempotencyKey: runId,
            })
            .catch((err: unknown) => {
              if (finished) return;
              finished = true;
              cleanup(offDelta, offFinal, offAborted, offChatError);
              reject(err instanceof Error ? err : new Error(String(err)));
            });
        })();

        timeoutRef = setTimeout(() => {
          if (finished) return;
          finished = true;
          cleanup(offDelta, offFinal, offAborted, offChatError);
          reject(new Error("Timed out while loading command options."));
        }, 15_000);
      });
    },
    [ensureConnectionReadyForSend, gateway, history.sessionKey],
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

      if (voiceInputActive) {
        void stopSpeechRecognitionAsync().catch(() => {});
      }

      analyticsEvents.chatSendTapped({
        has_text: text.length > 0,
        text_length: text.length,
        attachment_count: images.length,
        image_count: images.filter((image) => image.mimeType.startsWith("image/")).length,
        file_count: images.filter((image) => !image.mimeType.startsWith("image/")).length,
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
        setInput("");
        clearPendingImages();
        return;
      }

      if (
        text.toLowerCase() === "/think" &&
        images.length === 0 &&
        openCommandPicker("think")
      ) {
        setInput("");
        clearPendingImages();
        return;
      }

      if (
        text.toLowerCase() === "/fast" &&
        images.length === 0 &&
        openCommandPicker("fast")
      ) {
        setInput("");
        clearPendingImages();
        return;
      }

      if (
        text.toLowerCase() === "/reasoning" &&
        images.length === 0 &&
        openCommandPicker("reasoning")
      ) {
        setInput("");
        clearPendingImages();
        return;
      }

      // Haptic feedback — crisp impact
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);

      const sent = await submitMessageWithConnectionCheck(text, images);
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
    history.sessionKey,
    input,
    openCommandPicker,
    openModelPicker,
    pendingImages,
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

  // React to agent switches from outside Chat (e.g. AgentDetailScreen)
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
    const targetKey = officeChatRequest?.sessionKey?.trim();
    if (!targetKey) return;
    if (history.sessionKey === targetKey) {
      clearOfficeChatRequest?.();
      return;
    }

    let cancelled = false;

    const openFromOffice = async () => {
      let latestSessions = history.sessions;
      let targetSession = latestSessions.find(
        (session) => session.key === targetKey,
      );
      if (!targetSession) {
        try {
          latestSessions = await gateway.listSessions({ limit: 200 });
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
      clearOfficeChatRequest?.();
    };

    void openFromOffice();
    return () => {
      cancelled = true;
    };
  }, [
    clearOfficeChatRequest,
    gateway,
    history.sessionKey,
    history.sessions,
    history.setSessions,
    officeChatRequest,
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
          latestSessions = await gateway.listSessions({ limit: 200 });
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
    gateway,
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
    gateway.reconnect();
  }, [gateway]);

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
      analyticsEvents.chatExecApprovalResolved({
        decision,
        source: "approval_card",
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
      gateway.resolveExecApproval(id, decision).catch(() => {});
    },
    [gateway, history],
  );

  const abortCurrentRun = useCallback(() => {
    if (!history.sessionKey) return;
    if (!gateway.getBackendCapabilities().chatAbort) return;

    Alert.alert(
      t("Stop Agent"),
      t(
        "Are you sure you want to stop the agent? This will interrupt the current task.",
      ),
      [
        { text: t("Cancel"), style: "cancel" },
        {
          text: t("Stop"),
          style: "destructive",
          onPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
            const runIdAtAbort = currentRunIdRef.current;
            gateway
              .abortChat(history.sessionKey!, runIdAtAbort ?? undefined)
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
          },
        },
      ],
    );
  }, [gateway, history.sessionKey, dbg]);

  const handleRefresh = useCallback(async () => {
    if (connectionState !== "ready") {
      const ok = await gateway.probeConnection();
      if (!ok) return;
    }
    await history.onRefresh();
  }, [connectionState, gateway, history]);

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
    canAbortCurrentRun: gateway.getBackendCapabilities().chatAbort,
    resolveApproval,
    agentActivityRef,
    agentActiveCount,
    childSessionActivityRef,
    childSessionActivityVersion,
    clearChildSessionActivities,
  };
}
