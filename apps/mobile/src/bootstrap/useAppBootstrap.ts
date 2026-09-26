import { useEffect, useRef, useState } from 'react';
import {
  resolveGlobalMainSessionKey,
  type ConnectionDescriptor,
} from '@clawket/agent-protocol';
import { NodeClient } from '../services/node-client';
import { LastOpenedSessionSnapshot, StorageService } from '../services/storage';
import { DEFAULT_NODE_CAPABILITY_TOGGLES, NodeCapabilityToggles } from '../services/node-capabilities';
import { AccentColorId, ChatAppearanceSettings, ThemeMode } from '../types';
import { defaultAccentId } from '../theme';
import { DEFAULT_CHAT_APPEARANCE, DEFAULT_CHAT_FONT_SIZE } from '../features/chat-appearance/defaults';
import {
  buildPrimarySessionPreview,
  PRIMARY_CACHED_AGENT_ID,
} from '../utils/primary-session-cache';
import {
  isBackendScopedMainSessionKey,
  resolveMainSessionKey,
  sanitizeSnapshotForAgent,
} from '../connection/session-scope';

type Props = {
  nodeClient: NodeClient;
  connection: ConnectionDescriptor | null;
  connectionsInitialized: boolean;
};

function buildAgentPreview(
  agentId: string,
  backendKind: 'openclaw' | 'hermes' | 'youmind' | 'local-model' | 'pi' | 'codex' | 'claude-code',
  identity?: {
    agentName?: string;
    agentEmoji?: string;
    agentAvatarUri?: string;
  } | null,
): LastOpenedSessionSnapshot {
  if (
    agentId === PRIMARY_CACHED_AGENT_ID
    && resolveGlobalMainSessionKey(backendKind) === null
  ) {
    return buildPrimarySessionPreview(identity);
  }

  return {
    sessionKey: resolveMainSessionKey(agentId, {
      mainSessionKey: resolveGlobalMainSessionKey(backendKind),
    }),
    updatedAt: Date.now(),
    agentId,
    agentName: identity?.agentName,
    agentEmoji: identity?.agentEmoji,
    agentAvatarUri: identity?.agentAvatarUri,
  };
}

export function useAppBootstrap({
  nodeClient,
  connection,
  connectionsInitialized,
}: Props) {
  const [nodeEnabled, setNodeEnabled] = useState(false);
  const [nodeCapabilityToggles, setNodeCapabilityToggles] = useState<NodeCapabilityToggles>(
    DEFAULT_NODE_CAPABILITY_TOGGLES,
  );
  const [debugMode, setDebugMode] = useState(false);
  const [showAgentAvatar, setShowAgentAvatar] = useState(false);
  const [showModelUsage, setShowModelUsage] = useState(true);
  const [execApprovalEnabled, setExecApprovalEnabled] = useState(false);
  const [chatFontSize, setChatFontSize] = useState(DEFAULT_CHAT_FONT_SIZE);
  const [chatAppearance, setChatAppearance] = useState<ChatAppearanceSettings>(DEFAULT_CHAT_APPEARANCE);
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const [accentId, setAccentId] = useState<AccentColorId>(defaultAccentId);
  const [loading, setLoading] = useState(true);
  const [initialAgentId, setInitialAgentId] = useState<string | null>(null);
  const [initialChatPreview, setInitialChatPreview] = useState<LastOpenedSessionSnapshot | null>(null);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [savedCurrentAgentId, setSavedCurrentAgentId] = useState<string | null>(null);
  const initialSessionHydratedRef = useRef(false);

  useEffect(() => {
    Promise.all([
      StorageService.getDebugMode(),
      StorageService.getShowAgentAvatar(),
      StorageService.getThemeMode(),
      StorageService.getAccentColor(),
      StorageService.getShowModelUsage(),
      StorageService.getExecApprovalEnabled(),
      StorageService.getChatFontSize(),
      StorageService.getChatAppearance(),
      StorageService.getNodeEnabled(),
      StorageService.getNodeCapabilityToggles(),
      StorageService.getCurrentAgentId(),
    ])
      .then(([
        debug,
        showAvatar,
        savedThemeMode,
        savedAccentId,
        savedShowModelUsage,
        savedExecApproval,
        savedChatFontSize,
        savedChatAppearance,
        savedNodeEnabled,
        savedNodeCapabilityToggles,
        currentAgentId,
      ]) => {
        setDebugMode(debug);
        setShowAgentAvatar(showAvatar);
        setShowModelUsage(savedShowModelUsage);
        setExecApprovalEnabled(savedExecApproval);
        setChatFontSize(savedChatFontSize);
        setChatAppearance(savedChatAppearance);
        setThemeMode(savedThemeMode);
        setAccentId(savedAccentId);
        setNodeEnabled(savedNodeEnabled);
        setNodeCapabilityToggles(savedNodeCapabilityToggles);
        setSavedCurrentAgentId(currentAgentId);
      })
      .finally(() => setPreferencesLoaded(true));

    return () => {
      nodeClient.disconnect();
    };
  }, [nodeClient]);

  useEffect(() => {
    if (
      !preferencesLoaded
      || !connectionsInitialized
      || initialSessionHydratedRef.current
    ) {
      return;
    }
    initialSessionHydratedRef.current = true;

    const backendKind = connection?.backendKind ?? 'openclaw';
    const globalMainSessionKey = resolveGlobalMainSessionKey(backendKind);
    const initialAgent = globalMainSessionKey
      ?? (savedCurrentAgentId?.trim() || PRIMARY_CACHED_AGENT_ID);
    const connectionId = connection?.id ?? null;

    if (!connectionId) {
      setInitialAgentId(initialAgent);
      setInitialChatPreview(buildAgentPreview(initialAgent, backendKind));
      setLoading(false);
      return;
    }

    void StorageService.getLastOpenedSessionSnapshot(connectionId, initialAgent)
      .catch(() => null)
      .then(async (rawSnapshot) => {
        const snapshot = sanitizeSnapshotForAgent(rawSnapshot, initialAgent, {
          mainSessionKey: globalMainSessionKey,
        });
        const cachedAgentIdentity = await StorageService.getCachedAgentIdentity(
          connectionId,
          initialAgent,
        ).catch(() => null);
        const allowCachedIdentityFallback = !isBackendScopedMainSessionKey(globalMainSessionKey)
          || Boolean(snapshot);
        setInitialChatPreview(
          snapshot
            ? {
              ...snapshot,
              agentName: snapshot.agentName ?? cachedAgentIdentity?.agentName,
              agentEmoji: snapshot.agentEmoji ?? cachedAgentIdentity?.agentEmoji,
              agentAvatarUri: snapshot.agentAvatarUri ?? cachedAgentIdentity?.agentAvatarUri,
            }
            : buildAgentPreview(
              initialAgent,
              backendKind,
              allowCachedIdentityFallback ? cachedAgentIdentity : null,
            ),
        );
        setInitialAgentId(initialAgent);
      })
      .catch(() => {
        setInitialAgentId(initialAgent);
      })
      .finally(() => setLoading(false));
  }, [
    connection,
    connectionsInitialized,
    preferencesLoaded,
    savedCurrentAgentId,
  ]);

  return {
    accentId,
    chatFontSize,
    chatAppearance,
    debugMode,
    execApprovalEnabled,
    initialAgentId,
    initialChatPreview,
    loading,
    nodeCapabilityToggles,
    nodeEnabled,
    setAccentId,
    setChatFontSize,
    setChatAppearance,
    setDebugMode,
    setExecApprovalEnabled,
    setNodeCapabilityToggles,
    setNodeEnabled,
    setShowAgentAvatar,
    setShowModelUsage,
    setThemeMode,
    showAgentAvatar,
    showModelUsage,
    themeMode,
  };
}
