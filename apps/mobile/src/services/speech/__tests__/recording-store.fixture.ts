// Imported only by Jest suites; real persistence is covered separately against file operations.
export class MemoryRecording {
  data = new Uint8Array();
  results = new Map<number, string>();
  constructor(readonly metadata: { id: string; scope: string; draft: string; createdAt: number }) {}
  get bytes() { return this.data.length; }
  append(bytes: Uint8Array) { const data = new Uint8Array(this.bytes + bytes.length); data.set(this.data); data.set(bytes, this.bytes); this.data = data; }
  read(offset: number, length: number) { return this.data.slice(offset, offset + length); }
  close() {}
  result(index: number) { return this.results.get(index) ?? null; }
  checkpoint(index: number, text: string) { this.results.set(index, text); }
  discard() { recordings.delete(this.metadata.id); }
}
export const recordings = new Map<string, MemoryRecording>();
export const RECORDING_SECONDS = 600, PCM_BYTES_PER_SECOND = 32000, SEGMENT_BYTES = 110 * 32000;
export function createRecording(scope: string, draft: string) {
  const recording = new MemoryRecording({ id: String(recordings.size + 1), scope, draft, createdAt: Date.now() });
  recordings.set(recording.metadata.id, recording); return recording;
}
export function savedRecordings(scope: string) { return [...recordings.values()].filter((value) => value.metadata.scope === scope && value.bytes); }
