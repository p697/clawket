import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';
import type { AgentAdapter, SessionDescriptor } from '@clawket/agent-protocol';

const STORAGE_KEY = 'clawket.manual-sessions.v1';
export type ManualSessionEntry = Readonly<{ connectionId: string; agentId: string; key: string }>;
type Entry = ManualSessionEntry;
let entries: readonly Entry[] = [];
let loaded = false;
let work: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();
type Creation = { session?: SessionDescriptor; flight?: Promise<SessionDescriptor> };
const creations = new WeakMap<AgentAdapter, Map<string, Creation>>();
const valid = (entry: Entry) => entry && ['connectionId', 'agentId', 'key'].every((key) => typeof entry[key as keyof Entry] === 'string' && entry[key as keyof Entry].length > 0 && entry[key as keyof Entry].length <= 512);
const same = (a: Entry, b: Entry) => a.connectionId === b.connectionId && a.agentId === b.agentId && a.key === b.key;
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const next = work.then(operation); work = next.catch(() => undefined); return next;
}
async function load(): Promise<void> {
  if (loaded) return;
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  const value: unknown = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(value) || value.length > 1000 || value.some((entry) => !valid(entry))) throw new Error('manual_sessions_invalid');
  entries = value; loaded = true; listeners.forEach((listener) => listener());
}
async function save(next: readonly Entry[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  entries = next; listeners.forEach((listener) => listener());
}
export const ManualSessions = {
  create: (adapter: AgentAdapter, agentId: string, operationId = 'manual', options?: { fromSession?: string }): Promise<SessionDescriptor> => {
    if (!adapter.capabilities.sessionCreate || !adapter.createSession) return Promise.reject(new Error('Session creation unavailable'));
    const scoped = creations.get(adapter) ?? new Map<string, Creation>();
    creations.set(adapter, scoped);
    const operationKey = JSON.stringify([agentId, operationId]);
    const attempt = scoped.get(operationKey) ?? {};
    if (attempt.flight) return attempt.flight;
    scoped.set(operationKey, attempt);
    const flight = (async () => {
      await serialize(async () => {
        await load();
        if (entries.length >= 1000) throw new Error('manual_sessions_full');
      });
      // If local persistence fails after backend creation, retry the same
      // returned session instead of creating another empty conversation.
      attempt.session ??= await adapter.createSession!(agentId, options);
      await ManualSessions.remember({ connectionId: adapter.connection.id, agentId, key: attempt.session.key });
      scoped.delete(operationKey);
      return attempt.session;
    })();
    attempt.flight = flight;
    void flight.finally(() => { if (attempt.flight === flight) attempt.flight = undefined; }).catch(() => undefined);
    return flight;
  },
  remember: (entry: Entry) => serialize(async () => {
    if (!valid(entry)) throw new Error('manual_sessions_invalid');
    await load();
    if (entries.some((candidate) => same(candidate, entry))) return;
    if (entries.length >= 1000) throw new Error('manual_sessions_full');
    await save([...entries, { ...entry }]);
  }),
  removeConnection: (connectionId: string) => serialize(async () => { await load(); await save(entries.filter((entry) => entry.connectionId !== connectionId)); }),
};
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
/** Only explicitly created sessions qualify. Never infer a free session from an untrusted key. */
export function useManualSession(connectionId: string, agentId: string, key: string): boolean {
  return useManualSessions().some((entry) => same(entry, { connectionId, agentId, key }));
}
export function useManualSessions(): readonly ManualSessionEntry[] {
  useEffect(() => { void serialize(load).catch(() => undefined); }, []);
  return useSyncExternalStore(subscribe, () => entries, () => entries);
}
