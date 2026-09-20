import { Directory, File, FileMode, Paths, type FileHandle } from 'expo-file-system';
import { generateId } from '../gateway-auth';
import { SpeechError } from './speechErrors';

export const RECORDING_SECONDS = 600;
export const PCM_BYTES_PER_SECOND = 32000;
export const SEGMENT_BYTES = 110 * PCM_BYTES_PER_SECOND;
const MAX_BYTES = RECORDING_SECONDS * PCM_BYTES_PER_SECOND;
const MAX_RECORDINGS = 10;
const activeWriters = new Set<string>();
const root = () => new Directory(Paths.document, 'voice-drafts-v1');
type Metadata = { version: 1; id: string; scope: string; draft: string; createdAt: number };
/** Immutable metadata + append-only PCM. File length, not a volatile counter, is authoritative after a crash. */
export class SpeechRecording {
  private handle?: FileHandle;
  constructor(readonly metadata: Metadata) {}
  private get directory() { return new Directory(root(), this.metadata.id); }
  private get audio() { return new File(this.directory, 'audio.pcm'); }
  get bytes() { return Math.min(MAX_BYTES, Math.floor(this.audio.size / 2) * 2); }
  append(bytes: Uint8Array) {
    try {
      if (bytes.length % 2 || this.bytes + bytes.length > MAX_BYTES) throw Error();
      this.handle ??= this.audio.open(FileMode.Append);
      this.handle.writeBytes(bytes);
    } catch { this.close(); throw new SpeechError('speech_storage'); }
  }
  read(offset: number, length: number) {
    if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || offset + length > this.bytes) throw new SpeechError('speech_storage');
    const handle = this.audio.open(FileMode.ReadOnly);
    try { handle.offset = offset; const bytes = handle.readBytes(length); if (bytes.length !== length) throw new SpeechError('speech_storage'); return bytes; }
    finally { handle.close(); }
  }
  close() { const handle = this.handle; this.handle = undefined; try { handle?.close(); } finally { activeWriters.delete(this.metadata.id); } }
  result(index: number): string | null {
    const file = new File(this.directory, `result-${index}.json`);
    if (!file.exists) return null;
    try {
      const value = JSON.parse(file.textSync());
      if (value.index === index && typeof value.text === 'string' && value.text.length <= 16000) return value.text;
    } catch { /* Keep the recording; this segment can be transcribed again. */ }
    return null;
  }
  checkpoint(index: number, text: string) {
    const file = new File(this.directory, `result-${index}.tmp`);
    file.write(JSON.stringify({ index, text }));
    file.moveSync(new File(this.directory, `result-${index}.json`), { overwrite: true });
  }
  discard() { this.close(); this.directory.delete(); }
}
export function savedRecordings(scope: string): SpeechRecording[] {
  const directory = root();
  if (!directory.exists) return [];
  return directory.list().flatMap((entry) => {
    if (!(entry instanceof Directory) || !/^[a-f0-9]{32}$/.test(entry.name)) return [];
    try {
      const data = JSON.parse(new File(entry, 'metadata.json').textSync());
      if (data.version !== 1 || data.id !== entry.name || data.scope !== scope || typeof data.draft !== 'string' ||
        data.draft.length > 100000 || !Number.isFinite(data.createdAt)) return [];
      const recording = new SpeechRecording(data);
      if (recording.bytes > 0) return [recording];
      if (!activeWriters.has(data.id)) recording.discard();
      return [];
    } catch { return []; }
  }).sort((a, b) => a.metadata.createdAt - b.metadata.createdAt);
}
export function createRecording(scope: string, draft: string) {
  try {
    const directory = root(); directory.create({ intermediates: true, idempotent: true });
    // Never silently evict unsent recordings to make room for a new one.
    if (directory.list().length >= MAX_RECORDINGS) throw new SpeechError('speech_storage_full');
    const metadata: Metadata = { version: 1, id: generateId(), scope, draft, createdAt: Date.now() };
    const target = new Directory(directory, metadata.id); target.create();
    try {
      new File(target, 'metadata.json').write(JSON.stringify(metadata));
      new File(target, 'audio.pcm').create();
    } catch (error) { target.delete(); throw error; }
    activeWriters.add(metadata.id);
    return new SpeechRecording(metadata);
  } catch (error) { if (error instanceof SpeechError) throw error; throw new SpeechError('speech_storage'); }
}
