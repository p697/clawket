import { AgentQuestions } from './AgentQuestions';
import { ConversationEntry } from './ConversationEntry';
import { SessionPreferencesService } from '../../services/session-preferences';
import type { SessionPanelProps } from '../SessionPanel/SessionPanel';
import { SessionFilesSheet } from './components/SessionFilesSheet';
import { Button } from '../../components/ui/Button';
import { Banner } from '../../components/ui/Banner';
import { Space } from '../../theme/tokens';
import { Alert, View } from 'react-native';
import { createReplyConversation, replyConversationDraft } from '../../services/reply-conversation';
import { readSkillDraft } from '../../chat/skill-draft';
import { ManualSessions, useManualSession } from '../../services/manual-sessions';
import { RunInputSheet } from './components/RunInputSheet';
import { DraftRecoverySheet } from './components/DraftRecoverySheet';
import { useVoiceShortcut } from './useVoiceShortcut';
import { SelectedSkill } from './components/SelectedSkill';
import { useSharedDraft } from '../../features/sharing/useSharedDraft';
import { SkillPickerSheet } from './components/SkillPickerSheet';
import { scheduledConversationPrompt } from '../../chat/scheduled-conversation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  CAPABILITY_KEYS,
  isImageAttachmentMimeType,
  sessionActivityAt,
  supportsFileAttachments,
  type AdapterErrorCode,
  type Capabilities,
  type SessionKind,
  type CronRunLogEntry,
} from '@clawket/agent-protocol';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppContextProvider, useAppContext } from '../../contexts/AppContext';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import {
  getConnectionRuntime,
  useConnections,
} from '../../connection';
import type { RootStackParamList, ThreadOrigin } from '../../navigation/root-stack';
import { useChatController } from '../../chat/useChatController';
import { MAX_IMAGES } from '../../chat/constants';
import { SLASH_COMMANDS } from '../../data/slash-commands';
import {
  buildChildSessionActivityCards,
  getChildSessionStatusLabel,
  type ChildSessionActivityStatus,
} from '../../chat/childSessionActivity';
import { useChildRunRecords } from '../../chat/useChildRunRecords';
import { useMessageFavorites } from '../../chat/useMessageFavorites';
import { analyticsEvents } from '../../services/analytics/events';
import type { UiMessage } from '../../types/chat';
import {
  sanitizeDisplayText,
  sanitizeUserMessageText,
  sessionLabel,
} from '../../utils/chat-message';
import {
  ThreadView,
  type ThreadCopy,
  type ThreadViewProps,
} from './ThreadView';
import {
  areThreadRunSeedsEqual,
  deriveThreadContentState,
  formatThreadLocalTime,
  isThreadErrorCode,
  loadThreadCronRunSeeds,
  resolveThreadErrorCode,
  resolveThreadErrorDetail,
  type ThreadErrorInput,
  type ThreadRunCard,
  type ThreadRunSeed,
} from './model';
import { isMainConversation, projectSessionPreview, type SessionPreviewSnapshot } from '../../utils/session-preview';
import { ThreadOverlays } from './components/ThreadOverlays';
import { CronRunSheet } from '../AgentSettings/CronRunSheet';
import { ThreadActivityCacheService } from '../../services/thread-activity-cache';
import type { ThreadAddAction, ThreadAddSheetProps } from './components/ThreadAddSheet';

const NO_CAPABILITIES = Object.freeze(Object.fromEntries(
  CAPABILITY_KEYS.map((capability) => [capability, false]),
)) as unknown as Capabilities;

const EMPTY_RUN_SEEDS: ReadonlyArray<ThreadRunSeed> = Object.freeze([]);
const EMPTY_RUN_CARDS: ReadonlyArray<ThreadRunCard> = Object.freeze([]);
/** The first frame waits at most this long for the local activity snapshot. */
const THREAD_ACTIVITY_HYDRATION_TIMEOUT_MS = 300;
/** A refreshed activity result waits at most this long for the history refresh. */
const THREAD_ACTIVITY_SETTLE_TIMEOUT_MS = 300;

type ThreadCronActivity = Readonly<{
  scope: string;
  runs: ReadonlyArray<ThreadRunSeed>;
  /** Where the visible snapshot came from; a network result never yields to a later cache read. */
  source: 'none' | 'cache' | 'network';
}>;

const NO_CRON_ACTIVITY: ThreadCronActivity = { scope: '', runs: EMPTY_RUN_SEEDS, source: 'none' };

function runCardSignature(card: ThreadRunCard): string {
  return [
    card.id,
    card.kind,
    card.status,
    card.statusLabel,
    card.timeLabel,
    card.title,
    card.updatedAt,
    card.sessionKey ?? '',
    card.sessionAvailable === false ? 'missing' : '',
    card.jobId ?? '',
    card.agentId ?? '',
    card.summary ?? '',
    card.canOpenLogs ? '1' : '0',
    card.cronRun ? '1' : '0',
  ].join('\u0001');
}

function areThreadRunCardsEqual(
  left: ReadonlyArray<ThreadRunCard>,
  right: ReadonlyArray<ThreadRunCard>,
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (runCardSignature(left[index]!) !== runCardSignature(right[index]!)) return false;
  }
  return true;
}

type NavigationProps = NativeStackScreenProps<RootStackParamList, 'Thread'>;

export type ThreadScreenProps = NavigationProps & Readonly<{
  onSessionAction?: SessionPanelProps['onSessionAction'];
  onSessionPanelAfterClose?: () => void;
  pinnedSessionKeys?: SessionPanelProps['pinnedSessionKeys'];
  locked?: boolean;
  sessionHistoryGraceActive?: boolean;
  lockedReason?: 'gatewayConnections' | 'agents';
  onOpenSessionPanel?: () => void;
  onOpenAddMenu?: () => void;
  onOpenRunSession?: (
    sessionKey: string,
    agentId: string | undefined,
    kind: ThreadRunCard['kind'],
  ) => void;
  onOpenRunLogs?: (jobId: string, agentId?: string) => void;
  onOpenAttachments?: ThreadViewProps['onOpenAttachments'];
  onThreadOpened?: (context: {
    connectionId: string;
    agentId: string;
    sessionKey: string;
    from: ThreadOrigin;
  }) => void;
}>;

export function ThreadScreen(props: ThreadScreenProps): React.JSX.Element {
  const app = useAppContext();
  const snapshot = useConnections();
  const focused = useIsFocused();
  const { connectionId, agentId, sessionKey } = props.route.params;
  const agent = snapshot.roster.find((group) => group.connection.id === connectionId)
    ?.agents.find((row) => row.agent.agentId === agentId)?.agent;
  const scoped = useMemo(() => ({
    ...app,
    currentAgentId: agentId,
    mainSessionKey: agent?.mainSessionKey ?? `agent:${agentId}:main`,
    initialChatPreview: null,
    pendingAgentSwitch: null,
    chatSessionRequest: focused && app.chatSessionRequest?.sessionKey === sessionKey ? app.chatSessionRequest : null,
    pendingChatInput: focused ? app.pendingChatInput : null,
    pendingMainSessionSwitch: focused && app.pendingMainSessionSwitch,
  }), [app, agentId, agent?.mainSessionKey, connectionId, focused, sessionKey]);
  useEffect(() => {
    if (focused && app.currentAgentId !== agentId) app.setCurrentAgentId(agentId);
  }, [focused, app.currentAgentId, app.setCurrentAgentId, agentId]);
  const sessionExists = snapshot.roster.find(group => group.connection.id === connectionId)?.agents
    .find(row => row.agent.agentId === agentId)?.sessions?.some(session => session.key === sessionKey) === true;
  useEffect(() => {
    if (!focused || props.locked || agent?.entryMode !== 'sessions' || !sessionKey || !sessionExists) return;
    void SessionPreferencesService.setLastSession(connectionId, agentId, sessionKey).catch(() => {});
  }, [focused, props.locked, agent?.entryMode, connectionId, agentId, sessionKey, sessionExists]);
  if (!sessionKey) return <ConversationEntry {...props} />;
  return <AppContextProvider value={scoped}>
    <ThreadScreenContent key={`${connectionId}:${agentId}`} {...props} focused={focused} />
  </AppContextProvider>;
}

function ThreadScreenContent({
  navigation,
  route,
  focused,
  locked = false,
  sessionHistoryGraceActive = false,
  lockedReason = 'agents',
  onOpenSessionPanel,
  onOpenAddMenu,
  onOpenRunSession,
  onOpenRunLogs,
  onOpenAttachments,
  onThreadOpened,
}: ThreadScreenProps & { focused: boolean }): React.JSX.Element {
  const app = useAppContext();
  const { isPro, isLoading: subscriptionLoading, showPaywall } = useProPaywall();
  const connections = useConnections();
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation(['chat', 'common', 'settings']);
  const [activationFailure, setActivationFailure] = useState<Readonly<{
    error: unknown;
  }> | null>(null);
  const [draftRecoveryVisible, setDraftRecoveryVisible] = useState(false);
  const [recoveringDraft, setRecoveringDraft] = useState(false);
  const [addSheetVisible, setAddSheetVisible] = useState(false);
  const [commandsSheetVisible, setCommandsSheetVisible] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<{ scope: string; name: string; prefix: string } | null>(null);
  const [runInputId, setRunInputId] = useState<string | null>(null);
  const [sessionFilesVisible, setSessionFilesVisible] = useState(false);
  const [skillPickerVisible, setSkillPickerVisible] = useState(false);
  const [shareMessage, setShareMessage] = useState<UiMessage | null>(null);
  const [cronActivity, setCronActivity] = useState<ThreadCronActivity>(NO_CRON_ACTIVITY);
  const [cronHydratedScope, setCronHydratedScope] = useState<string | null>(null);
  const [selectedCronRun, setSelectedCronRun] = useState<CronRunLogEntry | null>(null);
  const openedKeyRef = useRef<string | null>(null);
  const analyticsOpenedKeyRef = useRef<string | null>(null);
  const { connectionId, agentId, sessionKey, from } = route.params;
  const routeIsActive = connections.activeConnectionId === connectionId;
  const adapter = routeIsActive && !locked ? connections.activeAdapter : null;
  const capabilities = adapter?.capabilities ?? NO_CAPABILITIES;
  const fileAttachmentsEnabled = supportsFileAttachments(capabilities);
  const paused = connections.pausedConnectionIds?.includes(connectionId) ?? false;
  const copy = useMemo(() => ({
    ...createThreadCopy(t),
    ...(paused ? { offline: t('Connection paused', { ns: 'config' }), reconnect: t('Resume connection', { ns: 'config' }) } : {}),
  }), [paused, t]);

  useEffect(() => {
    if (!focused || !connections.initialized || routeIsActive || locked) return;
    let cancelled = false;
    setActivationFailure(null);
    void getConnectionRuntime().activate(connectionId).catch((error: unknown) => {
      if (cancelled) return;
      setActivationFailure({ error });
    });
    return () => {
      cancelled = true;
    };
  }, [connectionId, connections.initialized, focused, locked, routeIsActive]);

  useEffect(() => {
    if (app.currentAgentId !== agentId) app.setCurrentAgentId(agentId);
  }, [agentId, app.currentAgentId, app.setCurrentAgentId]);


  useEffect(() => {
    const openedKey = `${connectionId}:${sessionKey}:${from}`;
    if (openedKeyRef.current === openedKey) return;
    openedKeyRef.current = openedKey;
    onThreadOpened?.({ connectionId, agentId, sessionKey, from });
  }, [agentId, connectionId, from, onThreadOpened, sessionKey]);

  useEffect(() => {
    setShareMessage(null);
    setRunInputId(null);
    setSkillPickerVisible(false);
    setSessionFilesVisible(false);
    setDraftRecoveryVisible(false);
    setAddSheetVisible(false);
    setCommandsSheetVisible(false);
  }, [connectionId, sessionKey]);

  const rosterSession = connections.roster.find((group) => group.connection.id === connectionId)
    ?.agents.find((row) => row.agent.agentId === agentId)?.sessions?.find((session) => session.key === sessionKey);
  const nativeReadOnly = capabilities.sessionBranch === true && rosterSession?.source === 'native' && rosterSession.canContinue !== true;
  // A stable object, so streamed chunks do not hand the timeline a new row renderer.
  const timelineCapabilities = useMemo(
    () => (nativeReadOnly ? { ...capabilities, chat: false } : capabilities),
    [capabilities, nativeReadOnly],
  );
  const [branching, setBranching] = useState(false);
  const [branchError, setBranchError] = useState(false);
  const nativeBranchBusy = useRef(false);
  const mainConversation = isMainConversation({ sessionKey, mainSessionKey: app.mainSessionKey, kind: rosterSession?.kind });
  const manualSession = useManualSession(connectionId, agentId, sessionKey);
  const ownedConversation = connections.roster.find(group => group.connection.id === connectionId)?.agents
    .find(row => row.agent.agentId === agentId)?.agent.entryMode === 'sessions' && rosterSession?.source === 'bridge';
  const sessionPreview = !locked && !manualSession && !ownedConversation && !mainConversation && !isPro && !sessionHistoryGraceActive;
  const previewSnapshot = useRef<SessionPreviewSnapshot | null>(null);
  const controller = useChatController({
    adapter,
    routeSessionKey: sessionKey,
    readOnly: sessionPreview || nativeReadOnly,
    debugMode: app.debugMode,
    showAgentAvatar: app.showAgentAvatar,
    chatSessionRequest: app.chatSessionRequest,
    clearChatSessionRequest: app.clearChatSessionRequest,
  });
  const consumedComposerDraft = useRef<string | null>(null);
  useEffect(() => {
    const draft = route.params.composerDraft;
    if (!draft || !focused || !controller.draftReady || controller.sessionKey !== sessionKey || !routeIsActive || locked || sessionPreview) return;
    const key = JSON.stringify([connectionId, agentId, sessionKey, draft.id]);
    if (consumedComposerDraft.current === key) return;
    consumedComposerDraft.current = key;
    // Restore the session's own draft first and preserve any existing unsent text.
    if (draft.skill) {
      const currentSkill = selectedSkill?.scope === `${connectionId}:${agentId}:${sessionKey}`
        && controller.input.startsWith(selectedSkill.prefix) ? selectedSkill : readSkillDraft(controller.input);
      const text = currentSkill ? controller.input.slice(currentSkill.prefix.length) : controller.input;
      const prefix = `${draft.skill.invocation}\n\n`;
      setSelectedSkill({ scope: `${connectionId}:${agentId}:${sessionKey}`, name: draft.skill.name, prefix });
      controller.setInput(`${prefix}${text}`);
      controller.composerRef.current?.focus();
    } else {
      controller.setInput(controller.input ? `${controller.input}\n\n${draft.text}` : draft.text);
    }
    navigation.setParams({ composerDraft: undefined });
  }, [route.params.composerDraft, controller.draftReady, controller.sessionKey, controller.input, controller.setInput,
    connectionId, agentId, sessionKey, routeIsActive, focused, locked, sessionPreview, navigation, selectedSkill, controller.composerRef]);
  const skillScope = `${connectionId}:${agentId}:${sessionKey}`;
  const activeSkill = selectedSkill?.scope === skillScope && controller.input.startsWith(selectedSkill.prefix) ? selectedSkill
    : controller.draftReady && controller.sessionKey === sessionKey ? readSkillDraft(controller.input) : null;
  const displayInput = activeSkill ? controller.input.slice(activeSkill.prefix.length) : controller.input;
  const sharedDraft = useSharedDraft({ shareId: route.params.shareId, scope: `${connectionId}:${agentId}:${sessionKey}`,
    ready: controller.draftReady && !locked && !sessionPreview && routeIsActive && controller.sessionKey === sessionKey,
    capabilities, input: controller.input, images: controller.pendingImages, submittedAt: controller.messageSubmittedAt, acceptedAt: controller.messageAcceptedAt, acceptedSubmission: controller.acceptedSubmission,
    setInput: controller.setInput, setImages: controller.setPendingImages });
  useVoiceShortcut({
    requested: route.params.shortcut === 'voice',
    scope: `${connectionId}:${agentId}:${sessionKey}`,
    ready: focused && controller.draftReady && controller.sessionKey === sessionKey && routeIsActive
      && !locked && !sessionPreview && controller.voiceInputSupported,
    start: controller.startVoiceInput,
    consume: () => navigation.setParams({ shortcut: undefined }),
  });
  useEffect(() => {
    const shortcut = route.params.shortcut;
    if (!shortcut || shortcut === 'voice' || !controller.draftReady || controller.sessionKey !== sessionKey || !routeIsActive || locked || sessionPreview) return;
    if ((shortcut === 'camera' || shortcut === 'photos') && capabilities.attachments && controller.canAddMoreImages) {
      controller.composerRef.current?.blur();
      // Let the native navigation transition settle before presenting the system picker.
      const timer = setTimeout(() => {
        navigation.setParams({ shortcut: undefined });
        void (shortcut === 'camera' ? controller.takePhoto() : controller.pickImage()).catch(() => {
          Alert.alert(t('Failed'));
        });
      }, 350);
      return () => clearTimeout(timer);
    }
    navigation.setParams({ shortcut: undefined });
    if (shortcut === 'skills' && capabilities.skills) setSkillPickerVisible(true);
    else controller.composerRef.current?.focus();
  }, [route.params.shortcut, controller.draftReady, controller.sessionKey, sessionKey, routeIsActive, locked, sessionPreview, capabilities.skills, capabilities.attachments, navigation, controller.composerRef, controller.voiceInputSupported, controller.canAddMoreImages, controller.takePhoto, controller.pickImage, t]);
  const currentSession = controller.sessions.find((session) => session.key === sessionKey);
  const lastReadRevisionRef = useRef<string | null>(null);
  // Read watermarks follow the same human-activity clock as roster unread, so a
  // heartbeat or metadata patch neither re-flags this thread nor re-marks it.
  const readActivityAt = Math.max(
    currentSession
      ? sessionActivityAt({
        updatedAt: currentSession.updatedAt ?? null,
        lastActivityAt: currentSession.lastActivityAt,
      }) ?? 0
      : 0,
    rosterSession ? sessionActivityAt(rosterSession) ?? 0 : 0,
  );
  useEffect(() => {
    if (!focused) {
      lastReadRevisionRef.current = null;
      return;
    }
    if (!routeIsActive || locked || !controller.historyLoaded || controller.sessionKey !== sessionKey) return;
    const revision = `${connectionId}:${sessionKey}:${readActivityAt}`;
    if (lastReadRevisionRef.current === revision) return;
    lastReadRevisionRef.current = revision;
    void getConnectionRuntime().markSessionOpened({
      connectionId,
      key: sessionKey,
      updatedAt: readActivityAt || null,
      lastActivityAt: readActivityAt || null,
    }).catch(() => {
      if (lastReadRevisionRef.current === revision) lastReadRevisionRef.current = null;
    });
  }, [connectionId, sessionKey, readActivityAt, focused, routeIsActive, locked, controller.historyLoaded, controller.sessionKey]);

  const analyticsBackend = adapter?.connection.backendKind
    ?? connections.connections.find((connection) => connection.id === connectionId)?.backendKind;
  useEffect(() => {
    if (!analyticsBackend) return;
    const kind = normalizeAnalyticsSessionKind(currentSession?.kind, sessionKey);
    const openedKey = `${connectionId}:${sessionKey}:${from}:${analyticsBackend}:${kind}`;
    if (analyticsOpenedKeyRef.current === openedKey) return;
    analyticsOpenedKeyRef.current = openedKey;
    analyticsEvents.threadOpened({ backend: analyticsBackend, kind, from });
  }, [analyticsBackend, connectionId, currentSession?.kind, from, sessionKey]);
  const currentRosterAgent = connections.roster
    .find((group) => group.connection.id === connectionId)
    ?.agents.find((candidate) => candidate.agent.agentId === agentId)
    ?.agent;
  const agent = app.agents.find((candidate) => (
    candidate.id === agentId && candidate.connectionId === connectionId
  )) ?? app.agents.find((candidate) => (
    candidate.id === agentId && !candidate.connectionId
  ));
  const agentName = currentRosterAgent?.name?.trim()
    || controller.agentDisplayName?.trim()
    || agent?.identity?.name?.trim()
    || agent?.name?.trim()
    || agentId;
  const agentEmoji = currentRosterAgent?.emoji
    ?? controller.agentEmoji
    ?? agent?.identity?.emoji;
  const agentAvatarUrl = currentRosterAgent?.avatarUrl
    ?? controller.agentAvatarUri
    ?? agent?.identity?.avatarUrl;
  const locale = i18n.resolvedLanguage || i18n.language;
  const isMainThread = mainConversation;
  const cronFallbackTitle = t('Cron', { ns: 'common' });
  const cronScope = `${connectionId}:${agentId}:${sessionKey}`;
  const cronOperations = adapter?.management?.cron;
  const cronSupported = isMainThread
    && capabilities.cron
    && Boolean(cronOperations?.list && cronOperations?.runs);
  const cronRunSeeds = cronActivity.scope === cronScope && isMainThread ? cronActivity.runs : EMPTY_RUN_SEEDS;
  // The local snapshot is read once per thread; the first frame waits for it so
  // cached messages and cached scheduled cards land in the same commit.
  const cronHydrating = cronSupported && cronHydratedScope !== cronScope;
  const persistedCronRunsRef = useRef<ReadonlyArray<ThreadRunSeed> | null>(null);
  useEffect(() => {
    if (!cronSupported || cronHydratedScope === cronScope) return undefined;
    const scope = cronScope;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setCronHydratedScope(scope);
    };
    // A slow store must not hold the timeline; a late read is simply dropped.
    const timer = setTimeout(finish, THREAD_ACTIVITY_HYDRATION_TIMEOUT_MS);
    void ThreadActivityCacheService.read({ connectionId, agentId, sessionKey }).then((runs) => {
      if (done) return;
      if (runs && runs.length > 0) {
        persistedCronRunsRef.current = runs;
        setCronActivity((previous) => (
          previous.scope === scope && previous.source === 'network'
            ? previous
            : { scope, runs, source: 'cache' }
        ));
      }
      finish();
    }, finish);
    return () => {
      done = true;
      clearTimeout(timer);
    };
  }, [agentId, connectionId, cronHydratedScope, cronScope, cronSupported, sessionKey]);
  // Chat token/preview updates must not reload every job or clear the timeline.
  const cronSessionsRevision = controller.sessions
    .filter((session) => session.key.includes(':cron:'))
    .map((session) => `${session.key}:${session.updatedAt ?? ''}`)
    .sort().join('|');
  const historyLoadedRef = useRef(controller.historyLoaded);
  historyLoadedRef.current = controller.historyLoaded;
  const pendingCronResultRef = useRef<{ scope: string; runs: ThreadRunSeed[] } | null>(null);
  const pendingCronTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitCronRuns = useCallback((scope: string, runs: ThreadRunSeed[]) => {
    setCronActivity((previous) => {
      // An unchanged result keeps the rendered cards' identity: no rebuild, no jump.
      if (previous.scope === scope && areThreadRunSeedsEqual(previous.runs, runs)) {
        return previous.source === 'network' ? previous : { ...previous, source: 'network' };
      }
      return { scope, runs, source: 'network' };
    });
  }, []);
  const flushPendingCronResult = useCallback(() => {
    if (pendingCronTimerRef.current) {
      clearTimeout(pendingCronTimerRef.current);
      pendingCronTimerRef.current = null;
    }
    const pending = pendingCronResultRef.current;
    if (!pending) return;
    pendingCronResultRef.current = null;
    commitCronRuns(pending.scope, pending.runs);
  }, [commitCronRuns]);
  useEffect(() => {
    if (controller.historyLoaded) flushPendingCronResult();
  }, [controller.historyLoaded, flushPendingCronResult]);
  useEffect(() => () => {
    if (pendingCronTimerRef.current) clearTimeout(pendingCronTimerRef.current);
  }, []);
  // Persist only a changed network result; the cache read and an equal refresh
  // already match what is on disk.
  useEffect(() => {
    if (cronActivity.source !== 'network' || cronActivity.scope !== cronScope) return;
    if (persistedCronRunsRef.current === cronActivity.runs) return;
    persistedCronRunsRef.current = cronActivity.runs;
    void ThreadActivityCacheService.write({ connectionId, agentId, sessionKey }, cronActivity.runs).catch(() => {
      // A failed write only costs the next open its first-frame cards.
    });
  }, [agentId, connectionId, cronActivity, cronScope, sessionKey]);
  const childSessionCards = useMemo(() => buildChildSessionActivityCards({
    currentSessionKey: controller.sessionKey,
    currentAgentId: agentId,
    currentAgentName: agentName,
    sessions: controller.sessions,
    activityMap: controller.childSessionActivityRef.current,
    resolveSessionTitle: (session, options) => sessionLabel(session, {
      currentAgentName: options?.currentAgentName,
    }),
  }), [
    agentId,
    agentName,
    controller.childSessionActivityRef,
    controller.childSessionActivityVersion,
    controller.sessionKey,
    controller.sessions,
  ]);
  useEffect(() => {
    const operations = cronOperations;
    if (
      !routeIsActive
      || controller.connectionState !== 'ready'
      || controller.sessionKey !== sessionKey
      || !cronSupported
      || !operations
    ) {
      return undefined;
    }
    let cancelled = false;
    void loadThreadCronRunSeeds({
      operations,
      currentSessionKey: sessionKey,
      currentAgentId: agentId,
      isMainAgent: currentRosterAgent?.isMain ?? agentId === 'main',
      fallbackTitle: cronFallbackTitle,
    }).then((runs) => {
      if (cancelled) return;
      // History and scheduled results refresh in parallel after connect; a result
      // that lands first waits briefly for history so both settle in one frame.
      pendingCronResultRef.current = { scope: cronScope, runs };
      if (historyLoadedRef.current) {
        flushPendingCronResult();
        return;
      }
      if (!pendingCronTimerRef.current) {
        pendingCronTimerRef.current = setTimeout(flushPendingCronResult, THREAD_ACTIVITY_SETTLE_TIMEOUT_MS);
      }
    }).catch(() => {
      // Keep the last successful activity snapshot during transient failures.
    });
    return () => {
      cancelled = true;
    };
  }, [
    agentId,
    app.foregroundEpoch,
    controller.connectionState,
    controller.sessionKey,
    cronOperations,
    cronSessionsRevision,
    cronScope,
    cronFallbackTitle,
    cronSupported,
    currentRosterAgent?.isMain,
    flushPendingCronResult,
    routeIsActive,
    sessionKey,
  ]);
  const { runs: childRunRecords, hydrated: childrenHydrated } = useChildRunRecords({ connectionId, agentId, sessionKey },
    controller.sessionKey === sessionKey ? childSessionCards : []);
  // Assemble local messages and both kinds of cards before mounting the list.
  // Once shown, never hide it for a refresh or a capability/subscription update.
  const activityRevealRef = useRef({ scope: cronScope, revealed: false });
  if (activityRevealRef.current.scope !== cronScope) activityRevealRef.current = { scope: cronScope, revealed: false };
  const [activityTimeout, setActivityTimeout] = useState<typeof activityRevealRef.current | null>(null);
  if (sessionPreview || (!cronHydrating && childrenHydrated) || activityTimeout === activityRevealRef.current) {
    activityRevealRef.current.revealed = true;
  }
  const activityHydrating = !activityRevealRef.current.revealed;
  useEffect(() => {
    if (!activityHydrating) return;
    const entry = activityRevealRef.current;
    const timer = setTimeout(() => setActivityTimeout(entry), THREAD_ACTIVITY_HYDRATION_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [activityHydrating, cronScope]);
  const nextRunCards = useMemo<ThreadRunCard[]>(() => [
    ...childRunRecords.map((run) => ({
      ...run,
      title: run.title === 'Subagent' ? t('Subagent', { ns: 'chat' }) : run.title,
      sessionAvailable: controller.sessions.some(session => session.key === run.sessionKey),
      statusLabel: getChildSessionStatusLabel(
        run.status as ChildSessionActivityStatus,
        null,
        childSessionCards.find(card => card.sessionKey === run.sessionKey)?.toolName ?? null,
        t,
      ),
      timeLabel: formatThreadLocalTime(run.updatedAt, locale),
    })),
    ...cronRunSeeds.map((run) => ({
      ...run,
      statusLabel: run.status === 'failed'
        ? t('Failed', { ns: 'chat' })
        : run.status === 'skipped'
          ? t('Skipped', { ns: 'settings' })
          : run.status === 'succeeded'
            ? t('Succeeded', { ns: 'settings' })
            : t('Completed', { ns: 'chat' }),
      timeLabel: formatThreadLocalTime(run.updatedAt, locale),
      canOpenLogs: run.status === 'failed'
        && capabilities.logs
        && isPro
        && Boolean(onOpenRunLogs),
    })),
  ].sort((left, right) => (
    right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)
  )), [capabilities.logs, childSessionCards, childRunRecords, controller.sessions, cronRunSeeds, isPro, locale, onOpenRunLogs, t]);
  // Session token/preview updates rebuild the child cards; the timeline only
  // receives a new array when a card would actually render differently.
  const runCardsRef = useRef<ReadonlyArray<ThreadRunCard>>(EMPTY_RUN_CARDS);
  const runCards = areThreadRunCardsEqual(runCardsRef.current, nextRunCards)
    ? runCardsRef.current
    : nextRunCards;
  runCardsRef.current = runCards;

  const previewReady = controller.historyLoaded && controller.sessionKey === sessionKey;
  // Scoped cache is usable before the network refresh finishes.
  // Free preview is safe before billing resolves. Subscription lookup must not
  // hide already-loaded messages or masquerade as a history/network request.
  const previewContentAvailable = controller.sessionKey === sessionKey;
  const projection = sessionPreview && previewContentAvailable
    ? projectSessionPreview(`${connectionId}:${agentId}:${sessionKey}`, controller.listData, previewSnapshot.current, controller.hasMoreHistory)
    : null;
  if (projection) previewSnapshot.current = projection.snapshot;
  else if (!sessionPreview) previewSnapshot.current = null;
  const visibleMessages = sessionPreview ? projection?.messages ?? [] : controller.listData;
  const previewEventScope = useRef<string | null>(null);
  useEffect(() => {
    if (!sessionPreview || !previewReady || !focused || !analyticsBackend) return;
    const scope = `${connectionId}:${sessionKey}`;
    if (previewEventScope.current === scope) return;
    previewEventScope.current = scope;
    analyticsEvents.sessionPreviewViewed({ backend: analyticsBackend, kind: normalizeAnalyticsSessionKind(currentSession?.kind, sessionKey) });
  }, [sessionPreview, previewReady, focused, analyticsBackend, connectionId, sessionKey, currentSession?.kind]);
  // Present over this session: a modal route plus the global native Modal race on iOS.
  const openSessionPaywall = () => { showPaywall('sessionHistory'); };
  const returnToMain = () => {
    const stack = navigation.getState();
    for (let index = stack.index - 1; index >= 0; index--) {
      const previous = stack.routes[index];
      if (previous.name !== 'Thread') continue;
      const params = previous.params as RootStackParamList['Thread'] | undefined;
      if (params?.connectionId === connectionId && params.agentId === agentId
        && params.sessionKey === app.mainSessionKey) {
        navigation.pop(stack.index - index);
        return;
      }
    }
    navigation.replace('Thread', {
      connectionId, agentId, sessionKey: app.mainSessionKey, from: 'panel',
    });
  };
  const gatewayConfigId = adapter?.connection.id ?? null;
  const favorites = useMessageFavorites({
    agentEmoji: agent?.identity?.emoji,
    agentId,
    agentName,
    gatewayConfigId,
    listData: visibleMessages,
    sessionKey: controller.sessionKey,
    sessionLabel: currentSession?.title ?? currentSession?.label,
  });
  const connectionError = connections.error
    && (connections.error.operation === 'connect' || connections.error.operation === 'probe')
    && (!connections.error.connectionId || connections.error.connectionId === connectionId)
    ? connections.error.message
    : null;
  const error = activationFailure
    ? createThreadError(t, activationFailure.error)
    : connectionError
      ? createThreadError(t, connectionError)
      : null;
  const state = deriveThreadContentState({
    locked,
    paused,
    recovering: routeIsActive && connections.recovering,
    switching: connections.switching || !routeIsActive,
    targetSessionReady: controller.sessionKey === sessionKey,
    // Cached cards never paint alone ahead of cached messages, and the first
    // frame waits for the local snapshot instead of inserting it a beat later.
    hydrating: activityHydrating,
    historyLoaded: controller.historyLoaded,
    hasMessages: visibleMessages.length > 0
      || (!sessionPreview && runCards.length > 0 && controller.historyLoaded)
      || (previewReady && Boolean(projection?.hasHiddenHistory)),
    connectionState: connections.recoveryFailed ? 'offline' : controller.connectionState,
    error,
  });

  const loadDiagnosticRef = useRef<{ scope: string; signature: string; startedAt: number } | null>(null);
  const targetSessionReady = controller.sessionKey === sessionKey;
  useEffect(() => {
    if (!focused || !analyticsBackend) return;
    const scope = `${connectionId}:${agentId}:${sessionKey}`;
    const signature = [state.kind, controller.historyLoaded, subscriptionLoading, targetSessionReady, sessionPreview].join(':');
    const previous = loadDiagnosticRef.current;
    if (previous?.scope === scope && previous.signature === signature) return;
    const startedAt = previous?.scope === scope ? previous.startedAt : Date.now();
    loadDiagnosticRef.current = { scope, signature, startedAt };
    analyticsEvents.threadLoadState({
      backend: analyticsBackend,
      phase: state.kind,
      history_loaded: controller.historyLoaded,
      subscription_loading: subscriptionLoading,
      target_session_ready: targetSessionReady,
      preview_only: sessionPreview,
      elapsed_ms: Math.max(0, Date.now() - startedAt),
    });
  }, [focused, analyticsBackend, connectionId, agentId, sessionKey, state.kind, controller.historyLoaded, subscriptionLoading, targetSessionReady, sessionPreview]);

  const retryInFlight = useRef(false);
  const retry = () => {
    if (retryInFlight.current) return;
    retryInFlight.current = true;
    setActivationFailure(null);
    void (async () => {
      if (paused) {
        await getConnectionRuntime().reconnectConnection(connectionId);
        return;
      }
      if (getConnectionRuntime().getSnapshot().activeConnectionId !== connectionId) {
        await getConnectionRuntime().activate(connectionId);
        return;
      }
      await getConnectionRuntime().reconnectConnection(connectionId);
    })().catch((retryError: unknown) => {
      setActivationFailure({ error: retryError });
    }).finally(() => { retryInFlight.current = false; });
  };
  const cancelCurrentRun = useCallback(() => {
    if (analyticsBackend) analyticsEvents.chatAbortTapped({ backend: analyticsBackend });
    controller.abortCurrentRun();
  }, [analyticsBackend, controller]);
  const requestCancelCurrentRun = controller.canAbortCurrentRun && controller.sessionKey
    ? cancelCurrentRun
    : undefined;
  const openRunSession = useCallback((
    targetSessionKey: string,
    targetAgentId: string | undefined,
    kind: ThreadRunCard['kind'],
  ) => {
    analyticsEvents.runCardOpened({ kind });
    onOpenRunSession?.(targetSessionKey, targetAgentId, kind);
  }, [onOpenRunSession]);
  const openCronRun = useCallback((run: ThreadRunCard) => {
    if (!run.cronRun) return;
    analyticsEvents.runCardOpened({ kind: 'cron' });
    setSelectedCronRun(run.cronRun);
  }, []);

  const handleCopyMessage = useCallback((message: UiMessage) => {
    const text = message.role === 'assistant'
      ? sanitizeDisplayText(message.text)
      : message.role === 'user'
        ? sanitizeUserMessageText(message.text)
        : message.text;
    if (text.trim()) void Clipboard.setStringAsync(text.trim());
  }, []);

  // Depend on the stable callback, not the per-render favorites object, so
  // the timeline's renderItem identity survives streaming re-renders.
  const toggleFavorite = favorites.toggleFavorite;
  const handleToggleFavorite = useCallback((message: UiMessage) => (
    toggleFavorite(message)
  ), [toggleFavorite]);

  const handleShareMessage = useCallback((message: UiMessage) => {
    setShareMessage(message);
  }, []);

  const branchBusy = useRef(false);
  const branchScope = useMemo(() => ({ active: true }), [connectionId, agentId, sessionKey, focused, locked, adapter]);
  useEffect(() => () => { branchScope.active = false; }, [branchScope]);
  const handleBranchMessage = useCallback((message: UiMessage) => {
    if (!adapter || !focused || locked || sessionPreview || branchBusy.current || !branchScope.active) return;
    branchBusy.current = true;
    controller.composerRef.current?.blur();
    void createReplyConversation(adapter, agentId, sessionKey, message).then(session => {
      if (!branchScope.active || getConnectionRuntime().getSnapshot().activeAdapter !== adapter) return;
      navigation.push('Thread', { connectionId, agentId, sessionKey: session.key, from: 'panel' });
    }).catch(() => {
      if (branchScope.active) Alert.alert(t('Error', { ns: 'common' }), t('Unable to start a new chat'));
    }).finally(() => { branchBusy.current = false; });
  }, [adapter, focused, locked, sessionPreview, branchScope, controller.composerRef, agentId, sessionKey, connectionId, navigation, t]);

  const messageActions = useMemo(() => ({
    onCopy: handleCopyMessage,
    onToggleFavorite: handleToggleFavorite,
    onShare: handleShareMessage,
    onBranch: capabilities.sessionCreate && !sessionPreview ? handleBranchMessage : undefined,
    canBranch: (message: UiMessage) => Boolean(replyConversationDraft(message)),
    canSchedule: (message: UiMessage) => Boolean(scheduledConversationPrompt(visibleMessages, message.id)),
    onSchedule: capabilities.cronCreate && !sessionPreview ? (message: UiMessage) => {
      const cronPrompt = scheduledConversationPrompt(visibleMessages, message.id);
      if (cronPrompt) navigation.navigate('AgentSettingsSection', { connectionId, agentId, section: 'cron', action: 'create-cron', cronPrompt });
    } : undefined,
  }), [handleBranchMessage, capabilities.sessionCreate, handleCopyMessage, handleShareMessage, handleToggleFavorite, capabilities.cronCreate, sessionPreview, visibleMessages, navigation, connectionId, agentId]);

  const {
    canSendQueuedNow,
    editQueuedMessage,
    removeQueuedMessage,
    sendQueuedMessageNow,
  } = controller;
  const queuedMessageActions = useMemo(() => ({
    canSendNow: canSendQueuedNow,
    onSendNow: (message: UiMessage) => sendQueuedMessageNow(message.id),
    onEdit: (message: UiMessage) => editQueuedMessage(message.id),
    onRemove: (message: UiMessage) => removeQueuedMessage(message.id),
  }), [canSendQueuedNow, editQueuedMessage, removeQueuedMessage, sendQueuedMessageNow]);

  const handleOpenMessageAttachments = useCallback((message: UiMessage, index = 0) => {
    if (onOpenAttachments) {
      onOpenAttachments(message, index);
      return;
    }
    const uris = message.imageUris ?? [];
    if (uris.length > 0) controller.preview.openPreview(uris, Math.min(Math.max(index, 0), uris.length - 1));
  }, [controller.preview, onOpenAttachments]);

  const handleOpenPendingAttachment = useCallback((index: number) => {
    const selected = controller.pendingImages[index];
    if (!selected || !isImageAttachmentMimeType(selected.mimeType)) return;
    const images = controller.pendingImages.filter((item) => (
      isImageAttachmentMimeType(item.mimeType)
    ));
    const selectedIndex = images.findIndex((item) => item.uri === selected.uri);
    if (selectedIndex >= 0) {
      controller.preview.openPreview(images.map((item) => item.uri), selectedIndex);
    }
  }, [controller.pendingImages, controller.preview]);

  const handleOpenAddMenu = useCallback(() => {
    controller.composerRef.current?.blur();
    if (onOpenAddMenu) {
      onOpenAddMenu();
      return;
    }
    setAddSheetVisible(true);
  }, [onOpenAddMenu, controller.composerRef]);

  const handleAddPresented = useCallback<NonNullable<ThreadAddSheetProps['onPresented']>>(({ photoAccess }) => {
    analyticsEvents.chatAddMenuOpened({ backend: analyticsBackend, photo_access: photoAccess });
  }, [analyticsBackend]);

  const handleAddAction = useCallback((action: ThreadAddAction, count?: number) => {
    analyticsEvents.chatAddMenuAction({ backend: analyticsBackend, action, count });
  }, [analyticsBackend]);

  const openAgentSection = useCallback((section: 'skills' | 'tools' | 'cron' | 'models', action?: 'create-cron', cronPrompt?: string) => {
    navigation.navigate('AgentSettingsSection', { connectionId, agentId, section, action, cronPrompt });
  }, [agentId, connectionId, navigation]);

  const openCommandsSheet = useCallback(() => setCommandsSheetVisible(true), []);

  // Every Add sheet entry is capability-gated here so the sheet never offers
  // an action the active backend cannot serve.
  const addSheetActions = useMemo(() => ({
    onOpenSessionFiles: capabilities.sessionFiles && !sessionPreview ? () => setSessionFilesVisible(true) : undefined,
    onOpenSkills: capabilities.skills && !sessionPreview ? () => setSkillPickerVisible(true) : undefined,
    onOpenCommands: capabilities.slashCommands && !sessionPreview ? openCommandsSheet : undefined,
    onCreateScheduledTask: capabilities.cronCreate
      ? () => openAgentSection('cron', 'create-cron', controller.input.trim() || undefined)
      : undefined,
    onOpenTools: capabilities.tools ? () => openAgentSection('tools') : undefined,
  }), [
    capabilities.cronCreate,
    capabilities.sessionFiles,
    capabilities.skills,
    capabilities.slashCommands,
    capabilities.tools,
    controller.input,
    openAgentSection,
    openCommandsSheet,
    sessionPreview,
  ]);
  const addMenuAvailable = capabilities.attachments
    || Boolean(addSheetActions.onOpenSessionFiles)
    || Boolean(addSheetActions.onOpenSkills)
    || Boolean(addSheetActions.onOpenCommands)
    || Boolean(addSheetActions.onCreateScheduledTask)
    || Boolean(addSheetActions.onOpenTools);

  const shareProductLabel = connections.connections.find((connection) => (
    connection.id === connectionId
  ))?.label;

  return (
    <>
      <ThreadView
        connectionFailure={{
          scope: `${connectionId}:${agentId}`,
          name: connections.connections.find((item) => item.id === connectionId)?.label ?? agentName,
          lastReadyAt: connections.connectionDetails[connectionId]?.lastReadyAt,
          onManage: () => navigation.navigate('Connection', { connectionId }),
          message: paused ? t('Connection paused', { ns: 'config' }) : undefined,
        }}
        connectingLabel={controller.connectionState !== 'ready' ? t('Connecting', { ns: 'common' }) : undefined}
        chatAppearance={app.chatAppearance}
        chatFontSize={app.chatFontSize}
        showAgentAvatar={app.showAgentAvatar}
        onOpenModelPicker={!sessionPreview && capabilities.models ? () => { controller.openModelPicker(); } : undefined}
        agentId={agentId}
        agentName={agentName}
        sessionKey={controller.sessionKey ?? sessionKey}
        scrollToBottomRequestAt={controller.scrollToBottomRequestAt}
        messageSubmittedAt={controller.messageSubmittedAt}
        agentEmoji={agentEmoji}
        agentAvatarUrl={agentAvatarUrl}
        sessionTitle={currentSession?.title ?? currentSession?.label}
        projectPath={rosterSession?.project?.path}
        isMainSession={mainConversation}
        model={controller.currentModelHeaderLabel}
        modelDisplayName={controller.currentModelDisplayName}
        contextUsed={currentSession?.totalTokensFresh === false
          ? undefined
          : currentSession?.totalTokens}
        contextWindow={currentSession?.contextTokens}
        activityLabel={controller.activityLabel}
        capabilities={timelineCapabilities}
        readOnlyFooter={nativeReadOnly && !sessionPreview ? <View style={{ padding: Space.lg, paddingBottom: Math.max(insets.bottom, Space.lg) }}>
          <Button label={t('Continue in a new session')} loading={branching} disabled={adapter?.state !== 'ready'} onPress={() => {
            if (nativeBranchBusy.current || !adapter?.createSession) return;
            nativeBranchBusy.current = true; setBranching(true); setBranchError(false);
            void ManualSessions.create(adapter, agentId, `native-branch:${sessionKey}`, { fromSession: sessionKey }).then(created => {
              if (getConnectionRuntime().getSnapshot().activeAdapter !== adapter || !branchScope.active) return;
              navigation.replace('Thread', { connectionId, agentId, sessionKey: created.key, from: 'panel' });
            }).catch(() => { if (branchScope.active) setBranchError(true); }).finally(() => { nativeBranchBusy.current = false; if (branchScope.active) setBranching(false); });
          }} />
          {branchError ? <Banner tone="bad" message={t('Could not update this request. Try again.')} /> : null}
        </View> : undefined}
        state={state}
        messages={visibleMessages}
        sessionPreview={sessionPreview ? {
          hasHiddenHistory: Boolean(projection?.hasHiddenHistory),
          loading: state.kind === 'loading' || (state.kind === 'reconnecting' && visibleMessages.length === 0),
          onUpgrade: openSessionPaywall,
          onMain: app.mainSessionKey ? returnToMain : onOpenSessionPanel ?? (() => navigation.goBack()),
          mainLabel: app.mainSessionKey ? undefined : t('Sessions', { ns: 'common' }),
        } : undefined}
        compactionNotice={sessionPreview ? undefined : controller.compactionNotice}
        sendFailure={sharedDraft.failed ? t('Unable to attach shared content') : controller.sendFailure}
        sendFailureDetails={controller.sendFailureDetails}
        onDismissSendFailure={() => { sharedDraft.dismissError(); controller.clearSendFailure(); }}
        runCards={sessionPreview ? EMPTY_RUN_CARDS : runCards}
        locale={locale}
        input={displayInput}
        pendingQuestions={adapter && capabilities.agentQuestions && !nativeReadOnly ? <AgentQuestions key={`${connectionId}:${sessionKey}`} adapter={adapter} sessionKey={sessionKey} /> : undefined}
        selectedSkill={activeSkill ? <SelectedSkill name={activeSkill.name} onRemove={() => {
          controller.setInput(displayInput); setSelectedSkill(null);
        }} /> : undefined}
        composerRef={controller.composerRef}
        isRunning={controller.isSending}
        pendingReplyRenderKey={controller.pendingReplyRenderKey}
        canSend={!sessionPreview && controller.canSend}
        loadingMoreHistory={!sessionPreview && controller.loadingMoreHistory}
        topInset={insets.top}
        bottomInset={insets.bottom}
        copy={copy}
        onBack={() => navigation.goBack()}
        onOpenSessionPanel={onOpenSessionPanel ? () => { controller.composerRef.current?.blur(); onOpenSessionPanel(); } : undefined}
        onOpenSettings={() => { controller.composerRef.current?.blur(); navigation.navigate('AgentSettings', { connectionId, agentId }); }}
        onChangeInput={(value) => {
          // Composer clears after submission too; never turn that clear back
          // into a hidden skill-only draft that can be sent a second time.
          if (!value) { setSelectedSkill(null); controller.setInput(''); }
          else controller.setInput(activeSkill ? `${activeSkill.prefix}${value}` : value);
        }}
        onSend={sessionPreview ? openSessionPaywall : controller.canSteer ? () => { controller.composerRef.current?.blur(); setRunInputId(controller.activeRunId); } : controller.onSend}
        onCancel={requestCancelCurrentRun}
        onOpenAddMenu={addMenuAvailable ? handleOpenAddMenu : undefined}
        onVoice={controller.voiceInputSupported ? controller.toggleVoiceInput : undefined}
        onVoiceStart={controller.startVoiceInput}
        onVoiceStop={controller.stopVoiceInput}
        onVoiceCancel={controller.cancelVoiceInput}
        onVoiceRecover={controller.recoverVoiceInput}
        voiceRecoveryCount={controller.voiceRecoveryCount}
        voiceRecordingSaved={controller.voiceRecordingSaved}
        voiceState={controller.voiceInputState}
        voiceLevel={controller.voiceInputLevel}
        onRetry={retry}
        onOpenPaywall={() => { showPaywall(lockedReason); }}
        onErrorAction={(failure) => {
          if (failure.code === 'pairing_required' || failure.code === 'pairing_expired' || failure.code === 'unauthorized') {
            navigation.navigate('Onboarding', {
              presentation: 'modal',
              initialBackend: connections.connections.find((item) => item.id === connectionId)?.backendKind,
            });
          } else if (failure.code === 'bridge_offline') {
            navigation.navigate('HelpCenter');
          } else retry();
        }}
        onLoadMoreHistory={!sessionPreview && controller.hasMoreHistory ? controller.onLoadMoreHistory : undefined}
        onOpenRunSession={onOpenRunSession ? openRunSession : undefined}
        onOpenCronRun={openCronRun}
        onOpenRunLogs={onOpenRunLogs}
        onOpenAttachments={handleOpenMessageAttachments}
        messageActions={messageActions}
        queuedMessageActions={sessionPreview ? undefined : queuedMessageActions}
        favoriteMessageIds={favorites.favoriteMessageIdSet}
        unconfirmedMessageIds={controller.unconfirmedMessageIds}
        runAcknowledged={controller.runAcknowledged}
        pendingAttachments={controller.pendingImages}
        canAddMoreAttachments={controller.canAddMoreImages}
        onOpenPendingAttachment={handleOpenPendingAttachment}
        onRemovePendingAttachment={controller.removePendingImage}
        onPickImage={controller.pickImage}
        onTakePhoto={controller.takePhoto}
        onChooseFile={fileAttachmentsEnabled ? controller.pickFile : undefined}
        onPasteFiles={controller.onPasteFiles}
        onPasteFailed={controller.onPasteFailed}
        slashSuggestions={controller.slashSuggestions}
        showSlashSuggestions={controller.showSlashSuggestions}
        onSelectSlashCommand={controller.onSelectSlashCommand}
        onDismissSlashSuggestions={controller.dismissSlashSuggestions}
        thinkingLevel={controller.thinkingLevel}
        thinkingLevelOptions={controller.thinkingLevelOptions}
        onSelectThinkingLevel={controller.onSelectStaticThinkLevel}
        onResolveApproval={controller.resolveApproval}
      />
      <RunInputSheet visible={Boolean(runInputId) && !sessionPreview} scope={`${connectionId}:${agentId}:${sessionKey}`}
        onClose={() => setRunInputId(null)} onCurrent={() => { if (runInputId) controller.onSteer(runInputId); }} onNext={controller.onSend} canSteer={controller.canSteer && controller.activeRunId === runInputId} />
      <SessionFilesSheet visible={sessionFilesVisible && focused && !locked && !sessionPreview && routeIsActive} adapter={adapter} sessionKey={sessionKey}
        online={adapter?.state === 'ready'} onClose={() => setSessionFilesVisible(false)} />
      <SkillPickerSheet visible={skillPickerVisible && !sessionPreview} adapter={adapter} agentId={agentId}
        online={adapter?.state === 'ready'} onClose={() => setSkillPickerVisible(false)}
        onManage={() => openAgentSection('skills')}
        onSelect={(skill) => {
          if (!skill.invocation) return;
          const prefix = `${skill.invocation}\n\n`;
          setSelectedSkill({ scope: skillScope, name: skill.name, prefix });
          controller.setInput(`${prefix}${displayInput}`);
          controller.composerRef.current?.focus();
        }} />
      <DraftRecoverySheet visible={draftRecoveryVisible && focused && !locked && !sessionPreview}
        text={controller.recoverableDraft ?? ''} busy={recoveringDraft} disabled={Boolean(controller.input.trim()) || !controller.recoverableDraft}
        onClose={() => setDraftRecoveryVisible(false)} onRecover={() => {
          if (!branchScope.active || !focused || locked || recoveringDraft) return;
          setRecoveringDraft(true);
          void controller.recoverLegacyDraft().then((recovered) => {
            if (recovered && branchScope.active) setDraftRecoveryVisible(false);
          }).catch(() => { if (branchScope.active) Alert.alert(t('Error', { ns: 'common' }), t('Failed to save', { ns: 'settings' })); })
            .finally(() => setRecoveringDraft(false));
        }} />
      <ThreadOverlays
        addVisible={!sessionPreview && addSheetVisible}
        attachmentsEnabled={capabilities.attachments}
        skillsEnabled={capabilities.skills}
        remainingAttachmentSlots={Math.max(0, MAX_IMAGES - controller.pendingImages.length)}
        onCloseAdd={() => setAddSheetVisible(false)}
        onPickImage={controller.pickImage}
        onTakePhoto={controller.takePhoto}
        onChooseFile={fileAttachmentsEnabled ? controller.pickFile : undefined}
        onAttachRecentPhotos={capabilities.attachments ? controller.attachLocalImages : undefined}
        onOpenSessionFiles={addSheetActions.onOpenSessionFiles}
        onOpenSkills={addSheetActions.onOpenSkills}
        onOpenCommands={addSheetActions.onOpenCommands}
        onCreateScheduledTask={addSheetActions.onCreateScheduledTask}
        onOpenTools={addSheetActions.onOpenTools}
        onRecoverDraft={controller.recoverableDraft && !controller.input.trim() ? () => setDraftRecoveryVisible(true) : undefined}
        onAddPresented={handleAddPresented}
        onAddAction={handleAddAction}
        shareMessage={shareMessage && visibleMessages.some((message) => message.id === shareMessage.id) ? shareMessage : null}
        agentName={agentName}
        agentEmoji={agent?.identity?.emoji}
        agentAvatarUri={controller.agentAvatarUri ?? undefined}
        shareProductLabel={shareProductLabel}
        onCloseShare={() => setShareMessage(null)}
        preview={{
          visible: controller.preview.previewVisible && (!sessionPreview || visibleMessages.some((message) => message.imageUris?.some((uri) => controller.preview.previewUris.includes(uri)))),
          uris: controller.preview.previewUris,
          index: controller.preview.previewIndex,
          width: controller.preview.screenWidth,
          height: controller.preview.screenHeight,
          topInset: insets.top,
          bottomInset: insets.bottom,
          onClose: controller.preview.closePreview,
          onIndexChange: controller.preview.setPreviewIndex,
        }}
        modelPicker={{
          visible: !sessionPreview && controller.modelPickerVisible,
          loading: controller.modelPickerLoading,
          error: controller.modelPickerError,
          models: controller.availableModels,
          configuredDefaultModel: controller.configuredDefaultModel,
          onManage: () => openAgentSection('models'),
          providers: controller.availableProviders,
          defaultModel: controller.currentModel ?? undefined,
          defaultProvider: controller.currentModelProvider ?? undefined,
          onClose: () => controller.setModelPickerVisible(false),
          onRetry: controller.retryModelPickerLoad,
          onSelect: controller.onSelectModel,
        }}
        commandPicker={{
          visible: !sessionPreview && controller.commandPickerVisible,
          title: controller.commandPickerTitle,
          loading: controller.commandPickerLoading,
          error: controller.commandPickerError,
          options: controller.commandPickerOptions,
          isSending: controller.isSending,
          onClose: controller.closeCommandPicker,
          onRetry: controller.retryCommandPickerLoad,
          onSelect: controller.onSelectCommandOption,
        }}
        commandsSheet={{
          visible: !sessionPreview && commandsSheetVisible,
          commands: SLASH_COMMANDS,
          onClose: () => setCommandsSheetVisible(false),
          onSelect: (command) => controller.onSelectSlashCommand(command, 'commands_sheet'),
        }}
        thinkingPicker={{
          visible: !sessionPreview && controller.staticThinkPickerVisible,
          current: controller.thinkingLevel ?? '',
          options: controller.thinkingLevelOptions,
          onClose: controller.closeStaticThinkPicker,
          onSelect: controller.onSelectStaticThinkLevel,
        }}
      />
      <CronRunSheet
        run={selectedCronRun}
        loadContent={adapter?.management?.cron?.runContent}
        onOpenSession={onOpenRunSession ? (targetSessionKey) => onOpenRunSession(targetSessionKey, agentId, 'cron') : undefined}
        onClose={() => setSelectedCronRun(null)}
      />
    </>
  );
}

function inferAnalyticsSessionKind(sessionKey: string): SessionKind {
  if (sessionKey === 'main' || /^agent:[^:]+:main$/.test(sessionKey)) return 'main';
  if (sessionKey.includes(':subagent:')) return 'subagent';
  if (sessionKey.includes(':cron:')) return 'cron';
  return 'other';
}

function normalizeAnalyticsSessionKind(
  kind: SessionKind | 'global' | 'unknown' | undefined,
  sessionKey: string,
): SessionKind {
  if (kind === 'global' || kind === 'unknown') return 'other';
  return kind ?? inferAnalyticsSessionKind(sessionKey);
}

function translateThreadErrorMessage(t: TFunction, code: AdapterErrorCode): string {
  if (code === 'bridge_offline') return t('Bridge is not running on your computer', { ns: 'chat' });
  if (code === 'pairing_required') return t('Pairing required', { ns: 'chat' });
  if (code === 'gateway_offline') return t('Agent is not responding', { ns: 'chat' });
  if (code === 'pairing_expired') return t('Pairing expired, pair again', { ns: 'chat' });
  if (code === 'unauthorized') return t('Sign-in expired', { ns: 'chat' });
  if (code === 'timeout') return t('Connection timed out', { ns: 'chat' });
  if (code === 'rate_limited') return t('Too many requests, try again later', { ns: 'chat' });
  if (code === 'frame_too_large') return t('Message too large to send', { ns: 'chat' });
  if (code === 'unsupported') return t('Not supported by this backend', { ns: 'chat' });
  if (code === 'server') return t('Server error', { ns: 'chat' });
  return t('No network', { ns: 'chat' });
}

function translateThreadErrorAction(t: TFunction, code: AdapterErrorCode): string | undefined {
  if (code === 'bridge_offline') return t('Help', { ns: 'common' });
  if (code === 'pairing_required' || code === 'pairing_expired') {
    return t('Pair again', { ns: 'common' });
  }
  if (code === 'unauthorized') return t('Sign in', { ns: 'common' });
  if (code === 'gateway_offline' || code === 'network' || code === 'timeout' || code === 'server') {
    return t('Retry', { ns: 'common' });
  }
  return undefined;
}

export function createThreadError(t: TFunction, error?: unknown): ThreadErrorInput {
  const code = resolveThreadErrorCode(error);
  const rawCode = error && typeof error === 'object' && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined;
  const useAdapterCopy = isThreadErrorCode(rawCode);
  return {
    code,
    message: useAdapterCopy
      ? translateThreadErrorMessage(t, code)
      : resolveThreadErrorDetail(error) || translateThreadErrorMessage(t, code),
    actionLabel: translateThreadErrorAction(t, code),
  };
}

export function createThreadCopy(t: TFunction): ThreadCopy {
  return {
    back: t('Back', { ns: 'common' }),
    close: t('Close', { ns: 'common' }),
    settings: t('Agent settings', { ns: 'chat' }),
    openSessions: t('Open sessions', { ns: 'chat' }),
    add: t('Add', { ns: 'common' }),
    voice: t('Voice input', { ns: 'chat' }),
    stopVoice: t('Stop voice input', { ns: 'chat' }),
    listening: t('Listening…', { ns: 'chat' }),
    send: t('Send', { ns: 'chat' }),
    stop: t('Stop', { ns: 'chat' }),
    queueSend: t('Send after this reply', { ns: 'chat' }),
    queued: t('Queued', { ns: 'chat' }),
    sending: t('Sending…', { ns: 'chat' }),
    paused: t('Paused', { ns: 'chat' }),
    sent: t('Sent', { ns: 'chat' }),
    delivered: t('Delivered', { ns: 'chat' }),
    uncertain: t('Send unconfirmed', { ns: 'chat' }),
    reconnect: t('Reconnect', { ns: 'chat' }),
    offline: t('Offline · reconnecting', { ns: 'chat' }),
    thinking: t('Thinking…', { ns: 'chat' }),
    loadingHistory: t('Loading history', { ns: 'chat' }),
    locked: t('Multiple agents require Pro', { ns: 'chat' }),
    viewPro: t('View Pro', { ns: 'chat' }),
    retry: t('Retry', { ns: 'common' }),
    file: t('File', { ns: 'chat' }),
    tool: t('Tool', { ns: 'chat' }),
    toolRunning: t('Running', { ns: 'chat' }),
    toolCompleted: t('Completed', { ns: 'chat' }),
    toolFailed: t('Failed', { ns: 'chat' }),
    approvalTitle: t('Allow exec?', { ns: 'chat' }),
    approvalError: t('Could not update this request. Try again.', { ns: 'chat' }),
    pairApprovalDetail: t('Allow this device to connect to OpenClaw?', { ns: 'chat' }),
    device: t('Device', { ns: 'chat' }),
    node: t('Node', { ns: 'chat' }),
    allow: t('Allow', { ns: 'chat' }),
    reject: t('Reject', { ns: 'chat' }),
    allowed: t('Allowed', { ns: 'chat' }),
    denied: t('Denied', { ns: 'chat' }),
    expired: t('Expired', { ns: 'chat' }),
    placeholder: t('Message...', { ns: 'chat' }),
    formatEmpty: (name) => t('Start a conversation with {{name}}', { ns: 'chat', name }),
    formatAttachments: (count) => t('{{count}} attachments', { ns: 'chat', count }),
    formatPhotoPosition: (index, count) => t('Photo {{index}} of {{count}}', { ns: 'chat', index, count }),
    formatRunDetail: (status, time) => time
      ? t('{{status}} · {{time}}', { ns: 'chat', status, time })
      : status,
    logs: t('Logs', { ns: 'common' }),
    chooseModel: t('Models', { ns: 'settings' }),
    formatModelContext: (model, remainingPercent) => t('{{model}} · {{percent}}% left', {
      ns: 'chat',
      model,
      percent: remainingPercent,
    }),
    formatThinkingLevel: (level) => t(`thinking_${level}`, { ns: 'chat' }),
  };
}
