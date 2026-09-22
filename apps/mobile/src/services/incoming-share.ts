import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import type { SharePayload } from 'expo-sharing';
import { sha256 } from 'js-sha256';

const KEY = 'clawket.incoming-shares.v1';
export const SHARED_BYTE_LIMIT = 5 * 1024 * 1024;
export const SHARED_TEXT_LIMIT = 100_000;
const MAX_PENDING = 20;
const MAX_STORED_BYTES = 100 * 1024 * 1024;
const MAX_STORED_SHARES = 200;
const ownedRoot = () => new Directory(Paths.document, 'incoming-share');

/** Count actual owned files, including copies retained by already-sent messages. */
function retainedBytes(): number {
  const root = ownedRoot();
  if (!root.exists) return 0;
  const entries = root.list();
  if (entries.length >= MAX_STORED_SHARES) throw new Error('share_storage_full');
  let bytes = 0;
  for (const directory of entries) {
    if (!(directory instanceof Directory) || !/^[a-f0-9]{32}$/.test(directory.name)) throw new Error('share_storage_invalid');
    const files = directory.list();
    if (files.length > 6) throw new Error('share_storage_invalid');
    for (const file of files) {
      if (!(file instanceof File) || !/^[0-5]\.[a-z0-9]{1,10}$/i.test(file.name)
        || !Number.isFinite(file.size) || file.size < 0) throw new Error('share_storage_invalid');
      bytes += file.size;
      if (bytes >= MAX_STORED_BYTES) throw new Error('share_storage_full');
    }
  }
  return bytes;
}
export type IncomingShare = Readonly<{
  id: string; fingerprint: string; text: string; createdAt: number;
  files: ReadonlyArray<{ uri: string; mimeType: string; name: string; size: number }>;
}>;
let work: Promise<unknown> = Promise.resolve();
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const next = work.then(operation); work = next.catch(() => undefined); return next;
}

export function validateSharedPayloads(payloads: readonly SharePayload[]): void {
  if (!payloads.length || payloads.length > 12) throw new Error('share_invalid');
  let textLength = 0; let fileCount = 0; let textCount = 0;
  for (const payload of payloads) {
    if (!payload || typeof payload.value !== 'string' || !payload.value.trim()) throw new Error('share_invalid');
    if (payload.shareType === 'text' || payload.shareType === 'url') {
      textLength += payload.value.length + (textCount++ ? 2 : 0);
      if (payload.shareType === 'url' && !/^https?:\/\//i.test(payload.value)) throw new Error('share_invalid');
    } else if (['image', 'file', 'audio', 'video'].includes(payload.shareType)) {
      fileCount += 1;
      if (!/^(file|content):\/\//i.test(payload.value)) throw new Error('share_invalid');
      const mime = payload.mimeType?.split(';')[0]?.trim();
      if (mime && !/^[\w.+-]+\/[\w.+-]+$/.test(mime)) throw new Error('share_invalid');
    } else throw new Error('share_invalid');
  }
  if (textLength > SHARED_TEXT_LIMIT || fileCount > 6) throw new Error('share_too_large');
}

async function read(): Promise<IncomingShare[]> {
  const value = await AsyncStorage.getItem(KEY);
  if (!value) return [];
  const data: unknown = JSON.parse(value);
  if (!Array.isArray(data) || data.length > MAX_PENDING) throw new Error('share_storage_invalid');
  const ids = new Set<string>();
  for (const entry of data) {
    if (!entry || typeof entry.id !== 'string' || !/^[a-f0-9]{32}$/.test(entry.id) || ids.has(entry.id)
      || typeof entry.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(entry.fingerprint)
      || !Number.isFinite(entry.createdAt) || entry.createdAt <= 0
      || typeof entry.text !== 'string' || entry.text.length > SHARED_TEXT_LIMIT
      || !Array.isArray(entry.files) || entry.files.length > 6 || (!entry.text && !entry.files.length)) throw new Error('share_storage_invalid');
    ids.add(entry.id);
    const root = new Directory(Paths.document, 'incoming-share', entry.id).uri.replace(/\/$/, '') + '/';
    let bytes = 0;
    for (const file of entry.files) {
      // Persist a sandbox-relative leaf so an iOS container move cannot strand a draft.
      if (file && typeof file.path === 'string' && /^[0-5]\.[a-z0-9]{1,10}$/i.test(file.path)) file.uri = root + file.path;
      if (!file || typeof file.uri !== 'string' || !file.uri.startsWith(root)
        || !/^[0-5]\.[a-z0-9]{1,10}$/i.test(file.uri.slice(root.length))
        || typeof file.name !== 'string' || file.name.length > 200 || typeof file.mimeType !== 'string'
        || !/^[\w.+-]+\/[\w.+-]+$/.test(file.mimeType) || !Number.isFinite(file.size) || file.size <= 0
        || (bytes += file.size) > SHARED_BYTE_LIMIT) throw new Error('share_storage_invalid');
    }
  }
  return data as IncomingShare[];
}

function persist(entries: readonly IncomingShare[]): Promise<void> {
  return AsyncStorage.setItem(KEY, JSON.stringify(entries.map((entry) => ({ ...entry,
    files: entry.files.map(({ uri, ...file }) => ({ ...file, path: uri.split('/').pop() })),
  }))));
}

export const IncomingShareStore = {
  list: () => serialize(read),
  capture: (payloads: readonly SharePayload[]) => serialize(async () => {
    validateSharedPayloads(payloads);
    const pending = await read();
    const fingerprint = sha256(JSON.stringify(payloads));
    const previous = pending.find((entry) => entry.fingerprint === fingerprint);
    if (previous) return previous;
    if (pending.length >= MAX_PENDING) throw new Error('share_inbox_full');
    const id = sha256(`${fingerprint}:${Date.now()}:${Math.random()}`).slice(0, 32);
    const directory = new Directory(Paths.document, 'incoming-share', id);
    const hasFiles = payloads.some(item => item.shareType !== 'text' && item.shareType !== 'url');
    const retained = hasFiles ? retainedBytes() : 0;
    if (hasFiles) directory.create({ intermediates: true, idempotent: true });
    try {
      const files: IncomingShare['files'][number][] = []; const text: string[] = []; let bytes = 0;
      for (const payload of payloads) {
        if (payload.shareType === 'text' || payload.shareType === 'url') { text.push(payload.value); continue; }
        const source = new File(payload.value);
        const size = source.size;
        if (!Number.isFinite(size) || size <= 0 || (bytes += size) > SHARED_BYTE_LIMIT) throw new Error('share_too_large');
        if (retained + bytes > MAX_STORED_BYTES) throw new Error('share_storage_full');
        const extension = /\.([a-z0-9]{1,10})$/i.exec(source.name)?.[1] ?? (payload.shareType === 'image' ? 'jpg' : 'bin');
        const destination = new File(directory, `${files.length}.${extension}`);
        await source.copy(destination);
        if (destination.size !== size || destination.size > SHARED_BYTE_LIMIT) throw new Error('share_copy_failed');
        files.push({ uri: destination.uri, name: source.name.slice(0, 200), size,
          mimeType: payload.mimeType?.split(';')[0]?.trim().toLowerCase() || (payload.shareType === 'image' ? 'image/jpeg' : 'application/octet-stream') });
      }
      const result: IncomingShare = { id, fingerprint, text: text.join('\n\n'), files, createdAt: Date.now() };
      await persist([...pending, result]);
      return result;
    } catch (error) { if (directory.exists) directory.delete(); throw error; }
  }),
  remove: (id: string, discardFiles = false) => serialize(async () => {
    const pending = await read();
    if (!pending.some((entry) => entry.id === id)) return;
    await persist(pending.filter((entry) => entry.id !== id));
    if (discardFiles) {
      const directory = new Directory(Paths.document, 'incoming-share', id);
      if (directory.exists) directory.delete();
    }
    // Sent chat attachments retain their owned copies until explicit cache cleanup.
  }),
  clearConsumedAfter: (clearCache: () => Promise<void>) => serialize(async () => {
    // Hold capture/acknowledgement while removing cache references, so a concurrent
    // send stays pending and its files cannot be collected underneath it.
    const pending = new Set((await read()).map(entry => entry.id));
    await clearCache();
    const root = ownedRoot();
    if (!root.exists) return;
    for (const directory of root.list()) {
      if (directory instanceof Directory && /^[a-f0-9]{32}$/.test(directory.name) && !pending.has(directory.name)) directory.delete();
    }
  }),
};
