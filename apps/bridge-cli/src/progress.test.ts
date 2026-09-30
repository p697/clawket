import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startClaudeBackground } from './claude-code-lifecycle.js';
import { startCodexBackground } from './codex-lifecycle.js';
import { startPiBackground } from './pi-lifecycle.js';
import { agentPairProgress, noProgress, startProgress, track, type Progress } from './progress.js';

class Terminal {
  readonly chunks: string[] = [];
  readonly isTTY = true;
  columns = 80;
  constructor(private readonly colors = false) {}
  write(chunk: string): boolean { this.chunks.push(chunk); return true; }
  hasColors(): boolean { return this.colors; }
  get output(): string { return this.chunks.join(''); }
  /** Rows as a terminal would show them: every redraw clears its row before writing. */
  get rows(): string[] {
    const rows = [''];
    for (const token of this.output.split(/(\n|\x1b\[[0-9;?]*[A-Za-z])/)) {
      if (token === '\n') rows.push('');
      else if (token === '\x1b[2K') rows[rows.length - 1] = '';
      else if (!token.startsWith('\x1b')) rows[rows.length - 1] += token.replace(/\r/g, '');
    }
    return rows;
  }
}

const unix = { env: { TERM: 'xterm-256color' }, platform: 'darwin' as const, outputs: [] };
const cells = (text: string) => [...text].reduce((width, char) => width + (/[　-鿿＀-￯]/.test(char) ? 2 : 1), 0);

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('stays silent unless it can redraw an interactive terminal', () => {
  const pipe = { isTTY: false, write: vi.fn(() => true) };
  const terminal = new Terminal();
  expect(startProgress('Waiting…', { stream: pipe, env: {} })).toBe(noProgress);
  for (const env of [{ CI: 'true' }, { CI: '' }, { TERM: 'dumb' }]) expect(startProgress('Waiting…', { stream: terminal, env })).toBe(noProgress);
  expect(startProgress('Waiting…', { ...unix, stream: terminal, enabled: false })).toBe(noProgress);
  expect(pipe.write).not.toHaveBeenCalled();
  expect(terminal.chunks).toEqual([]);
});

it('animates one row with the elapsed time and closes it with a success line', () => {
  vi.useFakeTimers();
  const terminal = new Terminal();
  const progress = startProgress('Checking Codex…', { ...unix, stream: terminal, doneText: 'Codex is ready to pair' });
  expect(terminal.chunks[0]).toBe('\x1b[?25l');
  expect(terminal.rows).toEqual(['⠋ Checking Codex…']);
  vi.advanceTimersByTime(80);
  expect(terminal.rows).toEqual(['⠙ Checking Codex…']);
  progress.update('Starting Codex…');
  expect(terminal.rows).toEqual(['⠙ Starting Codex…']);
  vi.advanceTimersByTime(1_200);
  expect(terminal.rows).toEqual([expect.stringMatching(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Starting Codex…  1s$/)]);
  progress.succeed();
  expect(terminal.rows).toEqual(['✔ Codex is ready to pair  1.3s', '']);
  expect(terminal.output.endsWith('\x1b[?25h')).toBe(true);
  const written = terminal.chunks.length;
  vi.advanceTimersByTime(1_000);
  progress.update('Late step…');
  progress.fail();
  expect(terminal.chunks).toHaveLength(written);
});

it('names the step that was running when pairing fails', () => {
  const terminal = new Terminal();
  const progress = startProgress('Checking Pi…', { ...unix, stream: terminal });
  progress.update('Connecting to Clawket Relay…');
  progress.fail();
  expect(terminal.rows).toEqual(['✖ Connecting to Clawket Relay', '']);
});

it('keeps the live line on one row for narrow terminals and multi-line text', () => {
  const terminal = new Terminal();
  terminal.columns = 24;
  const progress = startProgress('Requesting a pairing code for Claude Code…\nsecond line', { ...unix, stream: terminal });
  expect(terminal.rows).toHaveLength(1);
  expect(cells(terminal.rows[0])).toBeLessThanOrEqual(23);
  expect(terminal.rows[0]).toMatch(/^⠋ Requesting a .*…$/);
  progress.update('正在为 Claude Code 请求配对码，请稍候');
  expect(cells(terminal.rows[0])).toBeLessThanOrEqual(23);
  expect(terminal.rows[0].endsWith('…')).toBe(true);
  progress.stop();
  expect(terminal.rows).toEqual(['']);
});

it('falls back to ASCII glyphs on legacy Windows consoles', () => {
  const terminal = new Terminal();
  const progress = startProgress('Starting Hermes…', { stream: terminal, env: {}, platform: 'win32', outputs: [] });
  expect(terminal.rows).toEqual(['- Starting Hermes...']);
  progress.succeed('Hermes is ready to pair');
  expect(terminal.rows[0]).toMatch(/^√ Hermes is ready to pair {2}\d\.\ds$/);
  const failed = new Terminal();
  startProgress('Starting Hermes…', { stream: failed, env: {}, platform: 'win32', outputs: [] }).fail();
  expect(failed.rows[0]).toBe('× Starting Hermes');
});

it('paints only terminals that report color support', () => {
  const plain = new Terminal(false);
  startProgress('Starting Pi…', { ...unix, stream: plain }).succeed('Pi is ready to pair');
  expect(plain.output).not.toMatch(/\x1b\[(?:2|3[0-9])m/);
  const colored = new Terminal(true);
  const progress = startProgress('Starting Pi…', { ...unix, stream: colored });
  expect(colored.output).toContain('\x1b[36m⠋\x1b[39m Starting Pi…');
  progress.succeed('Pi is ready to pair');
  expect(colored.output).toMatch(/\x1b\[32m✔\x1b\[39m Pi is ready to pair\x1b\[2m {2}\d+\.\ds\x1b\[22m\n/);
});

it('clears the live line before other terminal output and releases the streams afterwards', () => {
  class Output { readonly isTTY = true; readonly chunks: string[] = []; write(chunk: string): boolean { this.chunks.push(chunk); return true; } }
  const terminal = new Terminal();
  const other = new Output();
  const progress = startProgress('Starting the Hermes bridge…', { ...unix, stream: terminal, outputs: [terminal, other] });
  const before = terminal.chunks.length;
  other.write('[hermes] diagnostic\n');
  expect(terminal.chunks.slice(before)).toEqual(['\r\x1b[2K']);
  expect(other.chunks).toEqual(['[hermes] diagnostic\n']);
  terminal.write('warning\n');
  expect(terminal.chunks.slice(before)).toEqual(['\r\x1b[2K', 'warning\n']);
  progress.stop();
  expect(Object.hasOwn(other, 'write')).toBe(false);
  expect(Object.hasOwn(terminal, 'write')).toBe(false);
  const after = terminal.chunks.length;
  other.write('later\n');
  expect(terminal.chunks).toHaveLength(after);
});

it('restores the cursor and releases its listeners however the wait ends', () => {
  const events = ['exit', 'SIGINT', 'SIGTERM'] as const;
  const counts = () => events.map(event => process.listenerCount(event));
  const before = counts();
  const finished = new Terminal();
  startProgress('Starting Codex…', { ...unix, stream: finished }).succeed('Codex is ready to pair');
  expect(counts()).toEqual(before);

  const exited = new Terminal();
  startProgress('Starting Codex…', { ...unix, stream: exited });
  expect(counts()).toEqual(before.map(count => count + 1));
  (process.listeners('exit').at(-1) as () => void)();
  expect(exited.output.endsWith('\r\x1b[2K\x1b[?25h')).toBe(true);
  expect(counts()).toEqual(before);

  // Ctrl+C keeps its default outcome when nothing else handles it.
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
  const interrupted = new Terminal();
  startProgress('Starting Codex…', { ...unix, stream: interrupted });
  const onSignal = process.listeners('SIGINT').at(-1) as (signal: NodeJS.Signals) => void;
  vi.spyOn(process, 'listeners').mockReturnValue([]);
  onSignal('SIGINT');
  expect(interrupted.output.endsWith('\r\x1b[2K\x1b[?25h')).toBe(true);
  expect(kill).toHaveBeenCalledWith(process.pid, 'SIGINT');
});

it('closes the line with the task outcome before results or errors print', async () => {
  const recorder = () => ({ update: vi.fn(), succeed: vi.fn(), fail: vi.fn(), stop: vi.fn() });
  const paired = recorder();
  await expect(track(paired, async () => 'paired')).resolves.toBe('paired');
  expect(paired.succeed).toHaveBeenCalledOnce();
  expect(paired.fail).not.toHaveBeenCalled();
  const failed = recorder();
  await expect(track(failed, async () => { throw new Error('Registry returned HTTP 500'); })).rejects.toThrow('HTTP 500');
  expect(failed.fail).toHaveBeenCalledOnce();
  expect(failed.succeed).not.toHaveBeenCalled();
});

it('forwards detached pairing steps over IPC only while the launching terminal is connected', () => {
  const saved = (['send', 'connected'] as const).map(key => [key, Object.getOwnPropertyDescriptor(process, key)] as const);
  const send = vi.fn(() => true);
  let connected = true;
  Object.defineProperty(process, 'send', { configurable: true, writable: true, value: send });
  Object.defineProperty(process, 'connected', { configurable: true, get: () => connected });
  try {
    expect(agentPairProgress(['status'], 'codex', 'Codex')).toBe(noProgress);
    expect(agentPairProgress(['pair', '--json'], 'codex', 'Codex')).toBe(noProgress);
    const progress = agentPairProgress(['pair', '--foreground'], 'codex', 'Codex');
    progress.update('Requesting a pairing code for Codex…');
    progress.succeed();
    progress.fail();
    progress.stop();
    connected = false;
    progress.update('Connecting to Clawket Relay…');
    expect(send.mock.calls).toEqual([[{ type: 'codex.progress', text: 'Requesting a pairing code for Codex…' }]]);
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(process, key, descriptor);
      else delete (process as unknown as Record<string, unknown>)[key];
    }
  }
});

it.each([
  ['codex', startCodexBackground],
  ['claude-code', startClaudeBackground],
  ['pi', startPiBackground],
] as const)('shows %s child steps and closes them before the first pairing line', async (prefix, start) => {
  const directory = mkdtempSync(join(tmpdir(), 'clawket-progress-'));
  const entry = join(directory, 'child.mjs');
  writeFileSync(entry, [
    `process.send({ type: '${prefix}.progress', text: 'Requesting a pairing code…' });`,
    `process.send({ type: '${prefix}.display', text: 'Pairing code: 123456' });`,
    `process.send({ type: '${prefix}.display', text: '[QR]' });`,
    `process.send({ type: '${prefix}.ready' });`,
    "process.on('disconnect', () => process.exit(0));",
  ].join('\n'));
  const events: string[] = [];
  const progress: Progress = {
    update: text => { events.push(`step ${text}`); },
    succeed: () => { events.push('ready'); },
    fail: () => { events.push('failed'); },
    stop: () => { events.push('stopped'); },
  };
  vi.spyOn(console, 'log').mockImplementation((text: string) => { events.push(`print ${text}`); });
  try {
    await start(['pair'], join(directory, 'child.log'), progress, process.execPath, entry);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  expect(events).toEqual(['step Requesting a pairing code…', 'ready', 'print Pairing code: 123456', 'ready', 'print [QR]']);
});
