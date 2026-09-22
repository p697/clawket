import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256 } from 'js-sha256';
import type { ConversationExport } from './conversation-export';

const KEY = 'clawket.conversation-archives.v1';
const MAX_RECORDS = 100;
const MAX_TEXT = 1_000_000;
const MAX_RECORD_TEXT = 500_000;
export type ConversationArchive = Readonly<{
  id: string; connectionId: string; agentId: string; sessionKey: string;
  savedAt: number; transcript: ConversationExport;
  name?: string; pinned?: boolean;
}>;
let pending: Promise<unknown> = Promise.resolve();
function serialize<T>(action: () => Promise<T>): Promise<T> {
  const result = pending.then(action); pending = result.catch(() => undefined); return result;
}
const boundedString = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
function validate(value: unknown): asserts value is ConversationArchive[] {
  if (!Array.isArray(value) || value.length > MAX_RECORDS) throw new Error('archive_invalid');
  let total = 0;
  const ids = new Set<string>();
  for (const entry of value) {
    if (!entry || !/^[a-f0-9]{64}$/.test(entry.id) || ids.has(entry.id)
      || !boundedString(entry.connectionId, 1000) || !boundedString(entry.agentId, 1000) || !boundedString(entry.sessionKey, 2000)
      || !Number.isFinite(entry.savedAt) || entry.savedAt <= 0 || !entry.transcript
      || (entry.name !== undefined && (!boundedString(entry.name, 200) || entry.name !== entry.name.trim()))
      || (entry.pinned !== undefined && typeof entry.pinned !== 'boolean')
      || typeof entry.transcript.title !== 'string' || entry.transcript.title.length > 200
      || !Array.isArray(entry.transcript.messages) || entry.transcript.messages.length > 10_000) throw new Error('archive_invalid');
    ids.add(entry.id);
    let size = entry.transcript.title.length + (entry.name?.length ?? 0);
    for (const message of entry.transcript.messages) {
      if (!message || !['user', 'assistant'].includes(message.role) || typeof message.text !== 'string'
        || (message.timestampMs !== undefined && (!Number.isFinite(message.timestampMs) || message.timestampMs <= 0))
        || !Array.isArray(message.attachments) || message.attachments.length > 100
        || message.attachments.some((name: unknown) => typeof name !== 'string' || name.length > 1000)) throw new Error('archive_invalid');
      size += message.text.length + message.attachments.reduce((sum: number, name: string) => sum + name.length, 0);
    }
    if (size > MAX_RECORD_TEXT) throw new Error('archive_full');
    total += size;
  }
  if (total > MAX_TEXT) throw new Error('archive_full');
}
async function read(): Promise<ConversationArchive[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  if (raw.length > 4_000_000) throw new Error('archive_invalid');
  const value: unknown = JSON.parse(raw); validate(value); return value;
}

async function update(id: string, patch: Pick<ConversationArchive, 'name' | 'pinned'>): Promise<ConversationArchive> {
  const entries = await read();
  const index = entries.findIndex(entry => entry.id === id);
  if (index < 0) throw new Error('archive_missing');
  const entry = { ...entries[index], ...patch };
  const next = [...entries]; next[index] = entry; validate(next);
  const raw = JSON.stringify(next);
  if (raw.length > 4_000_000) throw new Error('archive_full');
  await AsyncStorage.setItem(KEY, raw);
  return entry;
}

/** Explicit local snapshots, independent of backend deletion and cache eviction. Never evict saved work. */
export const ConversationArchives = {
  list: () => serialize(read),
  rename: (id: string, name: string) => serialize(() => update(id, { name: name.trim() })),
  setPinned: (id: string, pinned: boolean) => serialize(() => update(id, { pinned })),
  save: (scope: { connectionId: string; agentId: string; sessionKey: string }, transcript: ConversationExport) => serialize(async () => {
    // Project the public transcript; callers cannot persist wire data or attachment bytes here.
    const safe: ConversationExport = { title: transcript.title, messages: transcript.messages.map(message => ({
      role: message.role, text: message.text, ...(message.timestampMs !== undefined ? { timestampMs: message.timestampMs } : {}), attachments: [...message.attachments],
    })) };
    const id = sha256(JSON.stringify([scope.connectionId, scope.agentId, scope.sessionKey, safe]));
    const entries = await read();
    const existing = entries.find(entry => entry.id === id);
    if (existing) return existing;
    if (entries.length >= MAX_RECORDS) throw new Error('archive_full');
    const entry: ConversationArchive = { id, connectionId: scope.connectionId, agentId: scope.agentId, sessionKey: scope.sessionKey, savedAt: Date.now(), transcript: safe };
    const next = [entry, ...entries]; validate(next);
    const raw = JSON.stringify(next);
    if (raw.length > 4_000_000) throw new Error('archive_full');
    await AsyncStorage.setItem(KEY, raw); return entry;
  }),
  remove: (id: string) => serialize(async () => { await AsyncStorage.setItem(KEY, JSON.stringify((await read()).filter(entry => entry.id !== id))); }),
  clearConnection: (connectionId: string) => serialize(async () => { await AsyncStorage.setItem(KEY, JSON.stringify((await read()).filter(entry => entry.connectionId !== connectionId))); }),
};

export const conversationArchiveTitle = (entry: ConversationArchive): string => entry.name ?? entry.transcript.title;
export type ArchiveFilter = 'all' | 'pinned' | 'files';

export function searchConversationArchives(entries: readonly ConversationArchive[], query: string, filter: ArchiveFilter = 'all'): ConversationArchive[] {
  const normalized = query.trim().toLocaleLowerCase();
  return entries.filter(entry => (filter !== 'pinned' || entry.pinned)
    && (filter !== 'files' || entry.transcript.messages.some(message => message.attachments.length > 0)))
    .filter(entry => !normalized || conversationArchiveTitle(entry).toLocaleLowerCase().includes(normalized)
    || entry.transcript.title.toLocaleLowerCase().includes(normalized)
    || entry.transcript.messages.some(message => message.text.toLocaleLowerCase().includes(normalized)
      || message.attachments.some(name => name.toLocaleLowerCase().includes(normalized))))
    .sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true) || b.savedAt - a.savedAt || a.id.localeCompare(b.id));
}
