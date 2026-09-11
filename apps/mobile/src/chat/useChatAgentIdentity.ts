import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentAdapter } from '@clawket/agent-protocol';
import { StorageService, LastOpenedSessionSnapshot } from '../services/storage';
import { SessionInfo } from '../types';
import { AgentInfo } from '../types/agent';
import { sessionLabel } from '../utils/chat-message';
import {
  isBackendScopedMainSessionKey,
  isSessionKeyInAgentScope,
  sanitizeSnapshotForAgent,
} from '../connection/session-scope';
import { agentIdFromSessionKey } from './agentActivity';
import { buildInitialAgentIdentity } from './chatControllerUtils';
import { pickAgentIdentityAvatarUri, resolveAgentAvatarUri } from '../utils/agent-avatar-uri';

export type ChatAgentIdentity = {
  displayName: string;
  avatarUri: string | null;
  emoji: string | null;
};

const READY_IDENTITY_FETCH_DELAY_MS = 1500;
const EMPTY_AGENT_IDENTITY: ChatAgentIdentity = Object.freeze({
  displayName: 'Assistant',
  avatarUri: null,
  emoji: null,
});

type ScopedAgentIdentity = Readonly<{
  scopeKey: string | null;
  identity: ChatAgentIdentity;
  source: 'initial' | 'loading' | 'cache' | 'live';
  persistable: boolean;
}>;

function identityScopeKey(gatewayConfigId: string | null, agentId: string): string | null {
  return gatewayConfigId ? `${gatewayConfigId}\u0000${agentId}` : null;
}

function hasPersistableAgentIdentity(
  snapshot: Pick<LastOpenedSessionSnapshot, 'agentName' | 'agentEmoji' | 'agentAvatarUri'> | null | undefined,
): boolean {
  return Boolean(
    snapshot?.agentName?.trim()
    || snapshot?.agentEmoji?.trim()
    || snapshot?.agentAvatarUri?.trim(),
  );
}

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
  adapter: AgentAdapter | null;
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
  adapter,
  gatewayConfigId,
  initialPreview,
  mainSessionKey,
  sessionKey,
}: Params): ChatAgentIdentity {
  const scopeKey = identityScopeKey(gatewayConfigId, currentAgentId);
  const [scopedIdentity, setScopedIdentity] = useState<ScopedAgentIdentity>(() => ({
    scopeKey,
    identity: buildInitialAgentIdentity(initialPreview),
    source: 'initial',
    persistable: hasPersistableAgentIdentity(initialPreview),
  }));
  const agentIdentity = scopedIdentity.scopeKey === scopeKey
    ? scopedIdentity.identity
    : EMPTY_AGENT_IDENTITY;
  const sessionSnapshotUpdatedAtRef = useRef(Date.now());
  const lastPersistedSessionSnapshotRef = useRef<string | null>(null);
  const lastPersistedAgentIdentityRef = useRef<string | null>(null);

  const resolveAvatarUri = useCallback(
    (avatar: string | null | undefined): string | null => resolveAgentAvatarUri(avatar, () => null),
    [],
  );

  useEffect(() => {
    setScopedIdentity((previous) => previous.scopeKey === scopeKey
      ? previous
      : {
          scopeKey,
          identity: EMPTY_AGENT_IDENTITY,
          source: 'loading',
          persistable: false,
        });
    sessionSnapshotUpdatedAtRef.current = Date.now();
    lastPersistedSessionSnapshotRef.current = null;
    lastPersistedAgentIdentityRef.current = null;
  }, [scopeKey]);

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
        const allowCachedIdentityFallback = !isBackendScopedMainSessionKey(mainSessionKey) || Boolean(snapshot);
        const hasStoredIdentity = hasPersistableAgentIdentity(snapshot)
          || (allowCachedIdentityFallback && hasPersistableAgentIdentity(cachedIdentity));
        setScopedIdentity((previous) => {
          if (previous.scopeKey !== scopeKey || previous.source === 'live') return previous;
          const prev = previous.identity;
          const nextDisplayName = snapshot?.agentName?.trim()
            || (allowCachedIdentityFallback ? cachedIdentity?.agentName?.trim() : undefined)
            || prev.displayName;
          const nextAvatarUri = snapshot?.agentAvatarUri?.trim()
            || (allowCachedIdentityFallback ? cachedIdentity?.agentAvatarUri?.trim() : undefined)
            || prev.avatarUri;
          const nextEmoji = snapshot?.agentEmoji?.trim()
            || (allowCachedIdentityFallback ? cachedIdentity?.agentEmoji?.trim() : undefined)
            || prev.emoji;
          if (
            nextDisplayName === prev.displayName
            && nextAvatarUri === prev.avatarUri
            && nextEmoji === prev.emoji
          ) {
            if (!hasStoredIdentity) return previous;
            return previous.persistable && previous.source === 'cache'
              ? previous
              : { ...previous, source: 'cache', persistable: true };
          }
          return {
            scopeKey,
            identity: {
              displayName: nextDisplayName,
              avatarUri: nextAvatarUri,
              emoji: nextEmoji,
            },
            source: 'cache',
            persistable: hasStoredIdentity,
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
    const agentInfoBelongsToCurrentScope = Boolean(
      gatewayConfigId && agentInfo?.connectionId === gatewayConfigId,
    );
    let displayName = 'Assistant';
    if (agentInfo?.identity?.name?.trim()) {
      displayName = agentInfo.identity.name.trim();
    } else if (agentInfo?.name?.trim()) {
      displayName = agentInfo.name.trim();
    }

    const emoji = agentInfo?.identity?.emoji ?? null;
    const avatarUri = pickAgentIdentityAvatarUri(agentInfo?.identity, () => null);

    if (agentInfoBelongsToCurrentScope) {
      setScopedIdentity((previous) => {
        if (previous.scopeKey !== scopeKey) return previous;
        const identity = mergeAgentIdentity(previous.identity, {
          displayName,
          avatarUri,
          emoji,
        });
        if (identity === previous.identity && previous.source === 'live' && previous.persistable) {
          return previous;
        }
        return {
          scopeKey,
          identity,
          source: 'live',
          persistable: true,
        };
      });
    }

    if (adapter?.state !== 'ready') return undefined;
    let cancelled = false;

    const timer = setTimeout(() => {
      adapter.listAgents()
        .then((listedAgents) => {
          if (cancelled) return;
          const identity = listedAgents.find((agent) => agent.agentId === currentAgentId);
          if (!identity) return;
          setScopedIdentity((previous) => {
            if (previous.scopeKey !== scopeKey) return previous;
            return {
              scopeKey,
              identity: {
                displayName: identity.name?.trim() || 'Assistant',
                avatarUri: identity.avatarUrl
                  ? resolveAvatarUri(identity.avatarUrl)
                  : null,
                emoji: identity.emoji?.trim() || null,
              },
              source: 'live',
              persistable: true,
            };
          });
        })
        .catch(() => {});
    }, READY_IDENTITY_FETCH_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [adapter, adapter?.state, agents, cacheAgentName, currentAgentId, gatewayConfigId, resolveAvatarUri, scopeKey]);

  useEffect(() => {
    if (sessionKey) {
      sessionSnapshotUpdatedAtRef.current = Date.now();
    }
  }, [sessionKey]);

  useEffect(() => {
    if (!gatewayConfigId || !sessionKey) return;
    if (scopedIdentity.scopeKey !== scopeKey || !scopedIdentity.persistable) return;
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
    const signature = JSON.stringify({ scope: gatewayConfigId, snapshot });
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
    scopeKey,
    scopedIdentity.persistable,
    scopedIdentity.scopeKey,
    sessionKey,
  ]);

  useEffect(() => {
    if (!gatewayConfigId) return;
    if (scopedIdentity.scopeKey !== scopeKey || !scopedIdentity.persistable) return;
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
    scopeKey,
    scopedIdentity.persistable,
    scopedIdentity.scopeKey,
    sessionKey,
  ]);

  return agentIdentity;
}
