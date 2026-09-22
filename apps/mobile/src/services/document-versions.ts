import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256 } from 'js-sha256';

const KEY = 'clawket.document-versions.v1';
const MAX_DOCUMENTS = 40;
const MAX_VERSIONS = 12;
const MAX_CONTENT = 50_000;
const MAX_TOTAL = 200_000;
export type DocumentVersion = Readonly<{ id: string; savedAt: number; content: string; ownerHash?: string }>;
type Archive = Record<string, DocumentVersion[]>;
let pending: Promise<unknown> = Promise.resolve();
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation); pending = result.catch(() => undefined); return result;
}
async function read(): Promise<Archive> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return {};
  if (raw.length > MAX_TOTAL * 6 + 100_000) throw new Error('document_versions_invalid');
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length > MAX_DOCUMENTS) throw new Error('document_versions_invalid');
  let total = 0;
  for (const [key, versions] of Object.entries(data)) {
    if (!/^[a-f0-9]{64}$/.test(key) || !Array.isArray(versions) || versions.length > MAX_VERSIONS
      || versions.some((v) => !v || typeof v.content !== 'string' || v.content.length > MAX_CONTENT
        || (v.ownerHash !== undefined && !/^[a-f0-9]{64}$/.test(v.ownerHash))
        || !Number.isFinite(v.savedAt) || v.savedAt <= 0 || v.id !== sha256(v.content))) throw new Error('document_versions_invalid');
    total += versions.reduce((sum, version) => sum + version.content.length, 0);
  }
  if (total > MAX_TOTAL) throw new Error('document_versions_invalid');
  return data as Archive;
}

/** Local restore points only. Scope includes connection, Agent and document. */
export const DocumentVersions = {
  canCapture: (content: string) => content.length <= MAX_CONTENT,
  list: (scope: string) => serialize(async () => (await read())[sha256(scope)] ?? []),
  capture: (scope: string, content: string, connectionId?: string) => serialize(async () => {
    // Large files remain editable; their original content cannot fit the bounded local archive.
    if (content.length > MAX_CONTENT) return;
    const data = await read(); const key = sha256(scope); const id = sha256(content);
    if (data[key]?.[0]?.id === id) {
      if (connectionId && data[key].some(version => version.ownerHash !== sha256(connectionId))) {
        data[key] = data[key].map(version => ({ ...version, ownerHash: sha256(connectionId) }));
        await AsyncStorage.setItem(KEY, JSON.stringify(data));
      }
      return;
    }
    data[key] = [{ id, content, savedAt: Date.now() }, ...(data[key] ?? []).filter((v) => v.id !== id)].slice(0, MAX_VERSIONS)
      .map(version => connectionId ? { ...version, ownerHash: sha256(connectionId) } : version);
    const ordered = Object.entries(data).sort((a, b) => (b[1][0]?.savedAt ?? 0) - (a[1][0]?.savedAt ?? 0));
    const bounded: Archive = {}; let total = 0;
    for (const [document, versions] of ordered.slice(0, MAX_DOCUMENTS)) {
      bounded[document] = versions.filter((version) => {
        if (total + version.content.length > MAX_TOTAL) return false;
        total += version.content.length; return true;
      });
    }
    await AsyncStorage.setItem(KEY, JSON.stringify(bounded));
  }),
  clear: (scope: string) => serialize(async () => {
    const data = await read(); delete data[sha256(scope)];
    await AsyncStorage.setItem(KEY, JSON.stringify(data));
  }),
  clearConnection: (connectionId: string) => serialize(async () => {
    const data = await read(); const owner = sha256(connectionId);
    for (const key of Object.keys(data)) {
      data[key] = data[key].filter(version => version.ownerHash !== owner);
      if (!data[key].length) delete data[key];
    }
    await AsyncStorage.setItem(KEY, JSON.stringify(data));
  }),
};

export function documentDiff(current: string, previous: string): ReadonlyArray<{ kind: 'same' | 'removed' | 'added'; text: string }> {
  const a = current.split('\n'); const b = previous.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return [
    ...a.slice(Math.max(0, start - 2), start).map((text) => ({ kind: 'same' as const, text })),
    ...a.slice(start, a.length - end).map((text) => ({ kind: 'removed' as const, text })),
    ...b.slice(start, b.length - end).map((text) => ({ kind: 'added' as const, text })),
    ...b.slice(b.length - end, b.length - end + 2).map((text) => ({ kind: 'same' as const, text })),
  ];
}
