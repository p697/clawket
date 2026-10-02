import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { option } from './agent-inventory.js';
import { parseLookbackToMs } from './log-parse.js';

export type LogSource = { name: string; path: string };
export type LogEntry = { source: string; timestamp: number | null; text: string };
type Cursor = { offset: number; identity: string; pending: string; decoder: StringDecoder };
const WINDOW = 256 * 1024;

export function logTimestamp(line: string): number | null {
  const epoch = line.match(/^\[(\d{13})\]\s/);
  if (epoch) return Number(epoch[1]);
  try {
    const value = JSON.parse(line);
    const stamp = value?.ts ?? value?.at;
    const ts = typeof stamp === 'number' ? stamp : typeof stamp === 'string' ? Date.parse(stamp) : NaN;
    return Number.isFinite(ts) ? ts : null;
  } catch { return null; }
}

export function logOptions(args: string[]) {
  const count = option(args, '--lines') ?? '200';
  if (!/^\d+$/.test(count) || Number(count) < 1 || Number(count) > 2000) throw new Error('--lines must be an integer from 1 to 2000');
  const lastMs = parseLookbackToMs(option(args, '--last') ?? option(args, '-l'));
  if (lastMs !== null && (!Number.isSafeInteger(lastMs) || lastMs < 1)) throw new Error('--last must be a positive, finite duration');
  return { lines: Number(count), lastMs, follow: args.includes('--follow') || args.includes('-f'), json: args.includes('--json') };
}

function identity(info: { dev: number; ino: number }): string { return `${info.dev}:${info.ino}`; }
function chunk(fd: number, start: number, length: number): Buffer {
  const buffer = Buffer.alloc(length);
  return buffer.subarray(0, readSync(fd, buffer, 0, length, start));
}

export function readLogSnapshot(sources: LogSource[], input: ReturnType<typeof logOptions>) {
  const cursors = new Map<string, Cursor>();
  const entries: LogEntry[] = [], warnings: string[] = [];
  for (const source of sources) {
    let fd: number | undefined;
    try {
      fd = openSync(source.path, 'r');
      const info = fstatSync(fd);
      if (!info.isFile()) throw new Error('Not a log file');
      const start = Math.max(0, info.size - WINDOW);
      const decoder = new StringDecoder('utf8');
      let raw = decoder.write(chunk(fd, start, info.size - start));
      if (start > 0) {
        if (chunk(fd, start - 1, 1)[0] !== 10) raw = raw.includes('\n') ? raw.slice(raw.indexOf('\n') + 1) : '';
        warnings.push(`${source.name}: showing the final 256 KiB; older lines were not read.`);
      }
      const lines = raw.split(/\r?\n/);
      const pending = input.follow ? lines.pop() ?? '' : '';
      cursors.set(source.path, { offset: info.size, identity: identity(info), pending, decoder });
      for (const text of lines.filter(Boolean)) entries.push({ source: source.name, timestamp: logTimestamp(text), text });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') warnings.push(`${source.name}: log file could not be read.`);
      cursors.set(source.path, { offset: 0, identity: '', pending: '', decoder: new StringDecoder('utf8') });
    } finally { if (fd !== undefined) closeSync(fd); }
  }
  const cutoff = input.lastMs === null ? null : Date.now() - input.lastMs;
  const filtered = entries.filter(entry => cutoff === null || entry.timestamp === null || entry.timestamp >= cutoff);
  if (cutoff !== null && filtered.some(entry => entry.timestamp === null)) warnings.push('Untimestamped legacy lines are retained; their age cannot be verified.');
  // Sort timestamped entries within their existing slots so legacy lines keep source order.
  const dated = filtered.filter(entry => entry.timestamp !== null).sort((a, b) => a.timestamp! - b.timestamp!);
  let next = 0;
  return { entries: filtered.map(entry => entry.timestamp === null ? entry : dated[next++]).slice(-input.lines), warnings, cursors };
}

/** Poll appended bytes, retaining partial UTF-8/lines and following rotation without rereading whole files. */
export function readLogUpdates(sources: LogSource[], cursors: Map<string, Cursor>): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const source of sources) {
    let fd: number | undefined;
    try {
      fd = openSync(source.path, 'r');
      const info = fstatSync(fd);
      if (!info.isFile()) continue;
      let cursor = cursors.get(source.path);
      if (!cursor || cursor.identity !== identity(info) || info.size < cursor.offset) {
        cursor = { offset: 0, identity: identity(info), pending: '', decoder: new StringDecoder('utf8') };
        cursors.set(source.path, cursor);
      }
      const bytes = chunk(fd, cursor.offset, Math.min(WINDOW, info.size - cursor.offset));
      cursor.offset += bytes.length;
      const lines = (cursor.pending + cursor.decoder.write(bytes)).split(/\r?\n/);
      cursor.pending = lines.pop() ?? '';
      if (cursor.pending.length > WINDOW) { cursor.pending = ''; entries.push({ source: source.name, timestamp: null, text: '[oversized log line omitted]' }); }
      for (const text of lines.filter(Boolean)) entries.push({ source: source.name, timestamp: logTimestamp(text), text });
    } catch { /* A rotating/missing file can reappear on the next poll. */ }
    finally { if (fd !== undefined) closeSync(fd); }
  }
  return entries;
}

export async function showLogs(sources: LogSource[], args: string[]): Promise<void> {
  const input = logOptions(args);
  const snapshot = readLogSnapshot(sources, input);
  if (args.includes('--verbose') && !input.json) sources.forEach(source => console.error(`[${source.name}] ${source.path}`));
  const print = (entry: LogEntry) => console.log(input.json ? JSON.stringify(entry) : `[${entry.source}] ${entry.text}`);
  if (input.json && !input.follow) console.log(JSON.stringify({ ok: snapshot.warnings.every(w => !w.includes('could not be read')), lines: snapshot.entries.map(e => e.text), entries: snapshot.entries, sources, warnings: snapshot.warnings }, null, 2));
  else {
    snapshot.entries.forEach(print);
    snapshot.warnings.forEach(warning => console.error(warning));
    if (!input.json && !snapshot.entries.length) console.log('No matching Bridge logs found.');
  }
  if (!input.follow) return;
  if (!input.json) console.error('Following logs. Press Ctrl+C to stop.');
  let running = true;
  const stop = () => { running = false; };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    while (running) {
      readLogUpdates(sources, snapshot.cursors).forEach(print);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
