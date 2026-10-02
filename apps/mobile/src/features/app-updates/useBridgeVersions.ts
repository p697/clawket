import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ConnectionDescriptor } from '@clawket/agent-protocol';
import type { ConnectionRuntimeDetails } from '../../connection/runtime-details';
import { stableVersion, usesBridge } from './bridge-release';
const KEY = 'clawket.bridgeVersions.v1';
export function parseVersions(raw: string | null): Record<string, string> {
  try { const value = JSON.parse(raw ?? '{}'); if (!value || Array.isArray(value) || typeof value !== 'object') return {};
    return Object.fromEntries(Object.entries(value).filter(([id, version]) => id.length > 0 && id.length <= 256 && stableVersion(version))) as Record<string, string>;
  } catch { return {}; }
}
export function useBridgeVersions(initialized: boolean, connections: readonly ConnectionDescriptor[], details: Readonly<Record<string, ConnectionRuntimeDetails>>) {
  const [saved, setSaved] = useState<Record<string, string> | null>(null);
  useEffect(() => { if (!initialized) return; let active = true; void AsyncStorage.getItem(KEY).catch(() => null).then(raw => { if (active) setSaved(parseVersions(raw)); }); return () => { active = false; }; }, [initialized]);
  const versions: Record<string, string> = {};
  for (const c of connections) if (usesBridge(c)) {
    const value = details[c.id]?.bridgeVersion;
    if (stableVersion(value)) versions[c.id] = value;
    else if (saved?.[c.id]) versions[c.id] = saved[c.id];
  }
  const serialized = JSON.stringify(versions);
  useEffect(() => { if (!initialized || saved === null || JSON.stringify(saved) === serialized) return;
    const next = parseVersions(serialized); setSaved(next); void AsyncStorage.setItem(KEY, serialized).catch(() => undefined);
  }, [initialized, saved, serialized]);
  return versions;
}
