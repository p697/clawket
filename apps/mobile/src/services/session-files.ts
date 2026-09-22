import type { SessionFile, SessionFilesOperations } from '@clawket/agent-protocol';

const CHUNK = 128 * 1024;
export function validateSessionFiles(value: unknown): SessionFile[] {
  if (!value || typeof value !== 'object' || !('files' in value) || !Array.isArray(value.files) || value.files.length > 64) throw new Error('invalid_files');
  const ids = new Set<string>();
  return value.files.map((file: SessionFile) => {
    if (!file || typeof file.id !== 'string' || !file.id || file.id.length > 128 || ids.has(file.id)
      || typeof file.name !== 'string' || !file.name || file.name.length > 255 || /[/\\\x00-\x1f]/.test(file.name) || file.name.startsWith('.')
      || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 10 * 1024 * 1024
      || typeof file.mimeType !== 'string' || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(file.mimeType)) throw new Error('invalid_files');
    ids.add(file.id); return file;
  });
}

/** Writes one bounded chunk at a time; the caller owns temporary-file cleanup. */
export async function receiveSessionFile(operations: SessionFilesOperations, key: string, file: SessionFile,
  signal: AbortSignal, write: (bytes: Uint8Array) => void, progress: (fraction: number) => void): Promise<void> {
  validateSessionFiles({ files: [file] });
  let offset = 0;
  const check = () => { if (signal.aborted) throw new Error('cancelled'); };
  do {
    check();
    const chunk = await operations.read(key, file.id, offset);
    check();
    const length = Math.min(CHUNK, file.size - offset);
    if (!chunk || chunk.offset !== offset || chunk.total !== file.size || chunk.done !== (offset + length === file.size)
      || typeof chunk.data !== 'string' || chunk.data.length !== 4 * Math.ceil(length / 3)
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(chunk.data)) throw new Error('invalid_chunk');
    const bytes = Uint8Array.from(atob(chunk.data), char => char.charCodeAt(0));
    if (bytes.length !== length) throw new Error('invalid_chunk');
    write(bytes); offset += length; progress(file.size ? offset / file.size : 1);
    if (chunk.done) return;
  } while (offset < file.size);
  throw new Error('incomplete_file');
}
