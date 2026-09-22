import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ConnectionDescriptor } from '@clawket/agent-protocol';
import type { ConnectionRuntimeDetails } from '../../connection/runtime-details';
import { bridgeCapabilityStore } from '../../connection/registry/bridge-capability-store';
import { bridgeUpgradeIds, parseBridgeEvidence, type BridgeGeneration } from '../../connection/bridge-upgrade';

const KEY = 'clawket.bridgeGeneration.v1';
type Evidence = Record<string, BridgeGeneration>;

/** Retain credential-free authenticated evidence, including the existing OpenClaw negotiation cache. */
export function useBridgeUpgrade(
  initialized: boolean,
  connections: readonly ConnectionDescriptor[],
  details: Readonly<Record<string, ConnectionRuntimeDetails>>,
) {
  const scope = JSON.stringify(connections.map(c => [c.id, c.backendKind, c.transportKind]));
  const [saved, setSaved] = useState<{ scope: string; evidence: Evidence } | null>(null);
  useEffect(() => {
    if (!initialized) return;
    let active = true;
    const descriptors = JSON.parse(scope) as [string, string, string][];
    void Promise.all([
      AsyncStorage.getItem(KEY).then(parseBridgeEvidence, () => ({} as Evidence)),
      Promise.all(descriptors.map(async ([id, backend, transport]) => {
        if (backend !== 'openclaw' || transport !== 'relay') return null;
        const mode = await bridgeCapabilityStore.get(id).catch(() => null);
        return mode ? [id, mode === 'legacy' ? 'legacy' : 'current'] as const : null;
      })),
    ]).then(([evidence, previous]) => {
      if (!active) return;
      // An explicit Bridge generation takes precedence over older capability-only evidence.
      const migrated: Evidence = {};
      for (const entry of previous) if (entry) migrated[entry[0]] = entry[1];
      setSaved({ scope, evidence: { ...migrated, ...evidence } });
    });
    return () => { active = false; };
  }, [initialized, scope]);

  useEffect(() => {
    if (!initialized || !saved || saved.scope !== scope) return;
    const next: Evidence = {};
    for (const connection of connections) {
      const value = details[connection.id]?.bridgeGeneration ?? saved.evidence[connection.id];
      if (value) next[connection.id] = value;
    }
    if (JSON.stringify(next) === JSON.stringify(saved.evidence)) return;
    setSaved({ scope, evidence: next });
    void AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => undefined);
  }, [initialized, scope, connections, details, saved]);

  return initialized ? bridgeUpgradeIds(connections, details, saved?.evidence ?? {}) : [];
}
