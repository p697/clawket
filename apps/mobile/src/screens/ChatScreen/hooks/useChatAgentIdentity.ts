import { useCallback, useEffect, useRef, useState } from 'react';
import { StorageService, LastOpenedSessionSnapshot } from '../../../services/storage';
import { SessionInfo } from '../../../types';
import { AgentInfo } from '../../../types/agent';
import { sessionLabel } from '../../../utils/chat-message';
import {
  isSessionKeyInAgentScope,
  sanitizeSnapshotForAgent,
} from '../../../utils/agent-session-scope';
import { agentIdFromSessionKey } from './agentActivity';
import { buildInitialAgentIdentity } from './chatControllerUtils';
import { pickAgentIdentityAvatarUri, resolveAgentAvatarUri } from '../../../utils/agent-avatar-uri';

type GatewayLike = {
  fetchIdentity: (agentId: string) => Promise<{
    name?: string;
    emoji?: string;
    avatar?: string;
  }>;
  getBaseUrl: () => string | null;
  getConnectionState: () => string;
};

export type ChatAgentIdentity = {
  displayName: string;
  avatarUri: string | null;
  emoji: string | null;
};

const READY_IDENTITY_FETCH_DELAY_MS = 1500;

function mergeAgentIdentity(
  prev: ChatAgentIdentity,
  next: Partial<ChatAgentIdentity>,
): ChatAgentIdentity {
  const merged = {
    displayName: next.displayName !== undefined ? next.displayName : prev.displayName,
    avatarUri: next.avatarUri !== undefined ? next.avatarUri : prev.avatarUri,
    emoji: next.emoji !== undefined ? next.emoji : prev.emoji,
  };

  if (
    merged.displayName === prev.displayName
    && merged.avatarUri === prev.avatarUri
    && merged.emoji === prev.emoji
  ) {
    return prev;
  }

  return merged;
}

type Params = {
  agents: AgentInfo[];
  cacheAgentName?: string;
  currentAgentId: string;
  currentSessionInfo?: SessionInfo;
  gateway: GatewayLike;
  gatewayConfigId: string | null;
  initialPreview?: LastOpenedSessionSnapshot | null;
  mainSessionKey: string;
  sessionKey: string | null;
};

export function useChatAgentIdentity({
  agents,
  cacheAgentName,
  currentAgentId,
  currentSessionInfo,
  gateway,
  gatewayConfigId,
  initialPreview,
  mainSessionKey,
  sessionKey,
}: Params): ChatAgentIdentity {
  const [agentIdentity, setAgentIdentity] = useState<ChatAgentIdentity>(
    buildInitialAgentIdentity(initialPreview),
  );
  const sessionSnapshotUpdatedAtRef = useRef(Date.now());
  const lastPersistedSessionSnapshotRef = useRef<string | null>(null);
  const lastPersistedAgentIdentityRef = useRef<string | null>(null);

  const resolveAvatarUri = useCallback(
    (avatar: string | null | undefined): string | null => resolveAgentAvatarUri(avatar, gateway.getBaseUrl.bind(gateway)),
    [gateway],
  );

  useEffect(() => {
    if (!gatewayConfigId) return;
    if (sessionKey && !isSessionKeyInAgentScope(sessionKey, currentAgentId, { mainSessionKey })) return;
    let cancelled = false;

    Promise.all([
      StorageService.getLastOpenedSessionSnapshot(gatewayConfigId, currentAgentId)
        .then((snapshot) => sanitizeSnapshotForAgent(snapshot, currentAgentId, { mainSessionKey }))
        .catch(() => null),
      StorageService.getCachedAgentIdentity(gatewayConfigId, currentAgentId).catch(() => null),
    ])
      .then(([snapshot, cachedIdentity]) => {
        if (cancelled) return;
        setAgentIdentity((prev) => {
          const nextDisplayName = snapshot?.agentName?.trim()
            || cachedIdentity?.agentName?.trim()
            || prev.displayName;
          const nextAvatarUri = snapshot?.agentAvatarUri?.trim()
            || cachedIdentity?.agentAvatarUri?.trim()
            || prev.avatarUri;
          const nextEmoji = snapshot?.agentEmoji?.trim()
            || cachedIdentity?.agentEmoji?.trim()
            || prev.emoji;
          if (
            nextDisplayName === prev.displayName
            && nextAvatarUri === prev.avatarUri
            && nextEmoji === prev.emoji
          ) {
            return prev;
          }
          return {
            displayName: nextDisplayName,
            avatarUri: nextAvatarUri,
            emoji: nextEmoji,
          };
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [currentAgentId, gatewayConfigId, mainSessionKey, sessionKey]);

  useEffect(() => {
    const agentInfo = agents.find((agent) => agent.id === currentAgentId);
    let displayName = 'Assistant';
    if (agentInfo?.identity?.name?.trim()) {
      displayName = agentInfo.identity.name.trim();
    } else if (agentInfo?.name?.trim()) {
      displayName = agentInfo.name.trim();
    }

    const emoji = agentInfo?.identity?.emoji ?? null;
    const avatarUri = pickAgentIdentityAvatarUri(agentInfo?.identity, gateway.getBaseUrl.bind(gateway));

    if (agents.length > 0) {
      setAgentIdentity((prev) => mergeAgentIdentity(prev, {
        displayName,
        avatarUri,
        emoji,
      }));
    } else {
      setAgentIdentity((prev) => {
        const fallbackName = cacheAgentName?.trim();
        const nextDisplayName = fallbackName && prev.displayName === 'Assistant'
          ? fallbackName
          : prev.displayName;
        return mergeAgentIdentity(prev, { displayName: nextDisplayName });
      });
    }

    if (gateway.getConnectionState() !== 'ready') return undefined;

    const timer = setTimeout(() => {
      gateway.fetchIdentity(currentAgentId)
        .then((identity) => {
          setAgentIdentity((prev) => {
            const name = identity.name?.trim() || prev.displayName;
            const nextEmoji = identity.emoji || prev.emoji;
            let nextAvatar = prev.avatarUri;
            if (!nextAvatar && identity.avatar) {
              const resolved = resolveAvatarUri(identity.avatar);
              if (resolved) nextAvatar = resolved;
            }
            return mergeAgentIdentity(prev, {
              displayName: name,
              avatarUri: nextAvatar,
              emoji: nextEmoji,
            });
          });
        })
        .catch(() => {});
    }, READY_IDENTITY_FETCH_DELAY_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [agents, cacheAgentName, currentAgentId, gateway, resolveAvatarUri]);

  useEffect(() => {
    if (sessionKey) {
      sessionSnapshotUpdatedAtRef.current = Date.now();
    }
  }, [sessionKey]);

  useEffect(() => {
    if (!gatewayConfigId || !sessionKey) return;
    if (!isSessionKeyInAgentScope(sessionKey, currentAgentId, { mainSessionKey })) return;
    const snapshotAgentId = agentIdFromSessionKey(sessionKey) ?? currentAgentId;
    const snapshotLabel = currentSessionInfo
      ? sessionLabel(currentSessionInfo, {
        currentAgentName: agentIdentity.displayName || cacheAgentName,
      })
      : undefined;
    const snapshot = {
      sessionKey,
      sessionId: currentSessionInfo?.sessionId,
      sessionLabel: snapshotLabel,
      updatedAt: currentSessionInfo?.updatedAt ?? sessionSnapshotUpdatedAtRef.current,
      agentId: snapshotAgentId,
      agentName: agentIdentity.displayName || undefined,
      agentEmoji: agentIdentity.emoji || undefined,
      agentAvatarUri: agentIdentity.avatarUri || undefined,
    };
    const signature = JSON.stringify(snapshot);
    if (lastPersistedSessionSnapshotRef.current === signature) return;
    lastPersistedSessionSnapshotRef.current = signature;
    StorageService.setLastOpenedSessionSnapshot(gatewayConfigId, snapshot).catch(() => {
      if (lastPersistedSessionSnapshotRef.current === signature) {
        lastPersistedSessionSnapshotRef.current = null;
      }
    });
  }, [
    agentIdentity.avatarUri,
    agentIdentity.displayName,
    agentIdentity.emoji,
    cacheAgentName,
    currentAgentId,
    currentSessionInfo,
    gatewayConfigId,
    mainSessionKey,
    sessionKey,
  ]);

  useEffect(() => {
    if (!gatewayConfigId) return;
    if (sessionKey && !isSessionKeyInAgentScope(sessionKey, currentAgentId, { mainSessionKey })) return;
    const cachedIdentity = {
      agentId: currentAgentId,
      updatedAt: Date.now(),
      agentName: agentIdentity.displayName || undefined,
      agentEmoji: agentIdentity.emoji || undefined,
      agentAvatarUri: agentIdentity.avatarUri || undefined,
    };
    const signature = JSON.stringify({
      scope: gatewayConfigId,
      agentId: currentAgentId,
      agentName: cachedIdentity.agentName,
      agentEmoji: cachedIdentity.agentEmoji,
      agentAvatarUri: cachedIdentity.agentAvatarUri,
    });
    if (lastPersistedAgentIdentityRef.current === signature) return;
    lastPersistedAgentIdentityRef.current = signature;
    StorageService.setCachedAgentIdentity(gatewayConfigId, cachedIdentity).catch(() => {
      if (lastPersistedAgentIdentityRef.current === signature) {
        lastPersistedAgentIdentityRef.current = null;
      }
    });
  }, [
    agentIdentity.avatarUri,
    agentIdentity.displayName,
    agentIdentity.emoji,
    currentAgentId,
    gatewayConfigId,
    mainSessionKey,
    sessionKey,
  ]);

  return agentIdentity;
}
