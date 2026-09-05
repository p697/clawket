import type { ConnectionDescriptor } from '@clawket/agent-protocol';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getConnectionRuntime } from '../connection';
import type { RosterConnectionGroup } from '../connection/registry/roster-cache';
import { ChatCacheService } from '../services/chat-cache';
import { ensureIdentity } from '../services/gateway-auth';
import { hasCachedNonMainAgentSession } from '../services/pro-entitlement-bootstrap';
import {
  ProEntitlementStorageService,
  type FreeConnectionSwitchResult,
  type PersistedProEntitlementState,
} from '../services/pro-entitlement-storage';
import {
  FREE_CONNECTION_SWITCH_INTERVAL_MS,
  type Entitlement,
} from '../utils/pro';

const MAX_TIMER_DELAY_MS = 2_147_000_000;

type RuntimeState = Readonly<{
  deviceId: string | null;
  persisted: PersistedProEntitlementState | null;
  now: number;
  resolved: boolean;
  switching: boolean;
}>;

export type UseProEntitlementInput = Readonly<{
  isPro: boolean;
  subscriptionLoading: boolean;
  connections: ReadonlyArray<ConnectionDescriptor>;
  activeConnectionId: string | null;
  registryFreeConnectionId: string | null;
  roster: ReadonlyArray<RosterConnectionGroup>;
  foregroundEpoch: number;
}>;

export type ProEntitlementRuntime = Readonly<{
  entitlement: Entitlement;
  loading: boolean;
  switching: boolean;
  nextFreeConnectionSwitchAt: number | null;
  switchFreeConnection: (connectionId: string) => Promise<FreeConnectionSwitchResult>;
}>;

function initialRuntimeState(): RuntimeState {
  return {
    deviceId: null,
    persisted: null,
    now: Date.now(),
    resolved: false,
    switching: false,
  };
}

export function useProEntitlement({
  isPro,
  subscriptionLoading,
  connections,
  activeConnectionId,
  registryFreeConnectionId,
  roster,
  foregroundEpoch,
}: UseProEntitlementInput): ProEntitlementRuntime {
  const [runtime, setRuntime] = useState<RuntimeState>(initialRuntimeState);
  const mountedRef = useRef(true);
  const connectionIds = useMemo(() => connections.map(({ id }) => id), [connections]);
  const connectionSignature = connections.map(({ id, backendKind }) => (
    `${id}:${backendKind}`
  )).join('\u0000');
  const rosterSignature = useMemo(() => roster.flatMap((group) => group.agents.map(({ agent }) => (
    `${group.connection.id}:${agent.agentId}:${agent.isMain ? 'main' : 'secondary'}`
  ))).join('\u0000'), [roster]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (subscriptionLoading) return;
    let cancelled = false;
    const now = Date.now();
    setRuntime((current) => ({ ...current, now }));

    void (async () => {
      const [identity, cachedSessions] = await Promise.all([
        ensureIdentity(),
        ChatCacheService.listSessions(),
      ]);
      const resolved = await ProEntitlementStorageService.resolve({
        deviceId: identity.deviceId,
        isPro,
        connectionIds,
        activeConnectionId,
        hasNonMainAgentSession: hasCachedNonMainAgentSession({
          connections,
          roster,
          cachedSessions,
        }),
        now,
      });
      if (cancelled || !mountedRef.current) return;
      setRuntime((current) => ({
        ...current,
        deviceId: identity.deviceId,
        persisted: resolved.state,
        now,
        resolved: true,
      }));
      const nextFreeConnectionId = resolved.state.freeConnectionId;
      if (nextFreeConnectionId && nextFreeConnectionId !== registryFreeConnectionId) {
        await getConnectionRuntime().setFreeConnection(nextFreeConnectionId);
      }
    })().catch(() => {
      if (cancelled || !mountedRef.current) return;
      // Secure entitlement is fail-closed; a later input change or cold start retries.
      setRuntime((current) => ({ ...current, now, resolved: true }));
    });
    return () => {
      cancelled = true;
    };
  }, [
    activeConnectionId,
    connectionSignature,
    foregroundEpoch,
    isPro,
    registryFreeConnectionId,
    rosterSignature,
    subscriptionLoading,
  ]);

  const graceUntil = runtime.persisted?.graceUntil ?? null;
  useEffect(() => {
    if (graceUntil === null || runtime.now >= graceUntil) return;
    const timer = setTimeout(() => {
      if (mountedRef.current) {
        setRuntime((current) => ({ ...current, now: Date.now() }));
      }
    }, Math.min((graceUntil - runtime.now) + 25, MAX_TIMER_DELAY_MS));
    return () => clearTimeout(timer);
  }, [graceUntil, runtime.now]);

  const switchFreeConnection = useCallback(async (
    connectionId: string,
  ): Promise<FreeConnectionSwitchResult> => {
    const deviceId = runtime.deviceId;
    if (!deviceId || !runtime.persisted) {
      return {
        ok: false,
        reason: 'not_initialized',
        retryAt: null,
        state: null,
      };
    }
    setRuntime((current) => ({ ...current, switching: true, now: Date.now() }));
    try {
      const now = Date.now();
      const result = await ProEntitlementStorageService.switchFreeConnection({
        deviceId,
        isPro,
        connectionIds,
        targetConnectionId: connectionId,
        now,
      });
      if (!mountedRef.current) return result;
      if (result.state) {
        setRuntime((current) => ({
          ...current,
          persisted: result.state,
          now,
        }));
      }
      if (result.ok && result.changed) {
        try {
          await getConnectionRuntime().setFreeConnection(result.state.freeConnectionId ?? connectionId);
        } catch {
          // SecureStore is authoritative. Bootstrap, foreground, or registry changes retry the mirror.
        }
      }
      return result;
    } finally {
      if (mountedRef.current) {
        setRuntime((current) => ({ ...current, switching: false }));
      }
    }
  }, [connectionIds, isPro, runtime.deviceId, runtime.persisted]);

  const entitlement = useMemo<Entitlement>(() => ({
    isPro,
    graceUntil,
    now: runtime.now,
    freeConnectionId: runtime.persisted?.freeConnectionId ?? null,
  }), [graceUntil, isPro, runtime.now, runtime.persisted?.freeConnectionId]);
  const nextFreeConnectionSwitchAt = runtime.persisted?.lastFreeConnectionSwitchAt === null
    || runtime.persisted?.lastFreeConnectionSwitchAt === undefined
    ? null
    : runtime.persisted.lastFreeConnectionSwitchAt + FREE_CONNECTION_SWITCH_INTERVAL_MS;

  useEffect(() => {
    if (nextFreeConnectionSwitchAt === null || runtime.now >= nextFreeConnectionSwitchAt) return;
    const timer = setTimeout(() => {
      if (mountedRef.current) {
        setRuntime((current) => ({ ...current, now: Date.now() }));
      }
    }, Math.min((nextFreeConnectionSwitchAt - runtime.now) + 25, MAX_TIMER_DELAY_MS));
    return () => clearTimeout(timer);
  }, [nextFreeConnectionSwitchAt, runtime.now]);

  return {
    entitlement,
    loading: subscriptionLoading || !runtime.resolved,
    switching: runtime.switching,
    nextFreeConnectionSwitchAt,
    switchFreeConnection,
  };
}
