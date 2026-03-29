import { useEffect, useState } from 'react';
import { GatewayClient } from '../services/gateway';
import { resolveGatewayCacheScopeId } from '../services/gateway-cache-scope';
import { NodeClient } from '../services/node-client';
import { LastOpenedSessionSnapshot, StorageService } from '../services/storage';
import { DEFAULT_NODE_CAPABILITY_TOGGLES, NodeCapabilityToggles } from '../services/node-capabilities';
import { AccentColorId, ChatAppearanceSettings, GatewayConfig, SpeechRecognitionLanguage, ThemeMode } from '../types';
import { AccentScale, defaultAccentId } from '../theme';
import { DEFAULT_CHAT_APPEARANCE } from '../features/chat-appearance/defaults';
import {
  buildPrimarySessionPreview,
  PRIMARY_CACHED_AGENT_ID,
  sanitizePrimarySessionSnapshot,
} from '../utils/primary-session-cache';

type Props = {
  gateway: GatewayClient;
  nodeClient: NodeClient;
};

function buildAgentPreview(
  agentId: string,
  identity?: {
    agentName?: string;
    agentEmoji?: string;
    agentAvatarUri?: string;
  } | null,
): LastOpenedSessionSnapshot {
  if (agentId === PRIMARY_CACHED_AGENT_ID) {
    return buildPrimarySessionPreview(identity);
  }

  return {
    sessionKey: `agent:${agentId}:main`,
    updatedAt: Date.now(),
    agentId,
    agentName: identity?.agentName,
    agentEmoji: identity?.agentEmoji,
    agentAvatarUri: identity?.agentAvatarUri,
  };
}

export function useAppBootstrap({ gateway, nodeClient }: Props) {
  const [config, setConfig] = useState<GatewayConfig | null>(null);
  const [activeGatewayConfigId, setActiveGatewayConfigId] = useState<string | null>(null);
  const [nodeEnabled, setNodeEnabled] = useState(false);
  const [nodeCapabilityToggles, setNodeCapabilityToggles] = useState<NodeCapabilityToggles>(
    DEFAULT_NODE_CAPABILITY_TOGGLES,
  );
  const [debugMode, setDebugMode] = useState(false);
  const [showAgentAvatar, setShowAgentAvatar] = useState(true);
  const [showModelUsage, setShowModelUsage] = useState(true);
  const [execApprovalEnabled, setExecApprovalEnabled] = useState(false);
  const [canvasEnabled, setCanvasEnabled] = useState(true);
  const [chatFontSize, setChatFontSize] = useState(16);
  const [chatAppearance, setChatAppearance] = useState<ChatAppearanceSettings>(DEFAULT_CHAT_APPEARANCE);
  const [speechRecognitionLanguage, setSpeechRecognitionLanguage] = useState<SpeechRecognitionLanguage>('system');
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const [accentId, setAccentId] = useState<AccentColorId>(defaultAccentId);
  const [customAccent, setCustomAccent] = useState<AccentScale | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialAgentId, setInitialAgentId] = useState<string | null>(null);
  const [initialChatPreview, setInitialChatPreview] = useState<LastOpenedSessionSnapshot | null>(null);

  useEffect(() => {
    const gatewayConfigsStatePromise = StorageService.getGatewayConfigsState();
    const configPromise = StorageService.getGatewayConfig();
    configPromise.then((saved) => {
      setConfig(saved);
      gateway.configure(saved);
      if (saved?.url) {
        gateway.connect();
      }
    });

    Promise.all([
      gatewayConfigsStatePromise,
      configPromise,
      StorageService.getDebugMode(),
      StorageService.getShowAgentAvatar(),
      StorageService.getThemeMode(),
      StorageService.getAccentColor(),
      StorageService.getCustomAccentScale(),
      StorageService.getShowModelUsage(),
      StorageService.getExecApprovalEnabled(),
      StorageService.getCanvasEnabled(),
      StorageService.getChatFontSize(),
      StorageService.getChatAppearance(),
      StorageService.getSpeechRecognitionLanguage(),
      StorageService.getNodeEnabled(),
      StorageService.getNodeCapabilityToggles(),
      StorageService.getCurrentAgentId(),
    ])
      .then(([
        gatewayConfigsState,
        savedConfig,
        debug,
        showAvatar,
        savedThemeMode,
        savedAccentId,
        savedCustomAccent,
        savedShowModelUsage,
        savedExecApproval,
        savedCanvasEnabled,
        savedChatFontSize,
        savedChatAppearance,
        savedSpeechRecognitionLanguage,
        savedNodeEnabled,
        savedNodeCapabilityToggles,
        savedCurrentAgentId,
      ]) => {
        const gatewayScopeId = resolveGatewayCacheScopeId({
          activeConfigId: gatewayConfigsState.activeId,
          config: savedConfig,
        });
        const initialAgent = savedCurrentAgentId?.trim() || PRIMARY_CACHED_AGENT_ID;
        setActiveGatewayConfigId(gatewayScopeId);
        setDebugMode(debug);
        setShowAgentAvatar(showAvatar);
        setShowModelUsage(savedShowModelUsage);
        setExecApprovalEnabled(savedExecApproval);
        setCanvasEnabled(savedCanvasEnabled);
        setChatFontSize(savedChatFontSize);
        setChatAppearance(savedChatAppearance);
        setSpeechRecognitionLanguage(savedSpeechRecognitionLanguage);
        setThemeMode(savedThemeMode);
        setAccentId(savedAccentId);
        setCustomAccent(savedCustomAccent);
        setNodeEnabled(savedNodeEnabled);
        setNodeCapabilityToggles(savedNodeCapabilityToggles);
        return StorageService.getLastOpenedSessionSnapshot(gatewayScopeId, initialAgent)
          .catch(() => null)
          .then(async (rawSnapshot) => {
            const snapshot = initialAgent === PRIMARY_CACHED_AGENT_ID
              ? sanitizePrimarySessionSnapshot(rawSnapshot)
              : rawSnapshot;
            const cachedAgentIdentity = await StorageService.getCachedAgentIdentity(
              gatewayScopeId,
              initialAgent,
            ).catch(() => null);
            setInitialChatPreview(
              snapshot
                ? {
                  ...snapshot,
                  agentName: snapshot.agentName ?? cachedAgentIdentity?.agentName,
                  agentEmoji: snapshot.agentEmoji ?? cachedAgentIdentity?.agentEmoji,
                  agentAvatarUri: snapshot.agentAvatarUri ?? cachedAgentIdentity?.agentAvatarUri,
                }
                : buildAgentPreview(initialAgent, cachedAgentIdentity),
            );
            setInitialAgentId(initialAgent);
          })
          .catch(() => {
            setInitialAgentId(initialAgent);
          });
      })
      .finally(() => setLoading(false));

    return () => {
      gateway.disconnect();
      nodeClient.disconnect();
    };
  }, [gateway, nodeClient]);

  return {
    accentId,
    activeGatewayConfigId,
    canvasEnabled,
    chatFontSize,
    chatAppearance,
    config,
    customAccent,
    debugMode,
    execApprovalEnabled,
    initialAgentId,
    initialChatPreview,
    loading,
    nodeCapabilityToggles,
    nodeEnabled,
    setAccentId,
    setActiveGatewayConfigId,
    setCanvasEnabled,
    setChatFontSize,
    setChatAppearance,
    setConfig,
    setCustomAccent,
    setDebugMode,
    setExecApprovalEnabled,
    setNodeCapabilityToggles,
    setNodeEnabled,
    setShowAgentAvatar,
    setShowModelUsage,
    setSpeechRecognitionLanguage,
    setThemeMode,
    showAgentAvatar,
    showModelUsage,
    speechRecognitionLanguage,
    themeMode,
  };
}
