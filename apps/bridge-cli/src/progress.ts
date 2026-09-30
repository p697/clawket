/**
 * Live status for pairing waits. It draws only on an interactive terminal;
 * JSON, pipes, CI, dumb terminals and detached children keep their existing
 * output byte-for-byte, so scripts and agents never receive spinner frames.
 */
export interface Progress {
  /** Replaces the step text and redraws at once, so a following synchronous call still shows it. */
  update(text: string): void;
  /** Ends the live line with a success mark and the total elapsed time. */
  succeed(text?: string): void;
  /** Ends the live line with a failure mark on the step that was running. */
  fail(): void;
  /** Ends the live line without leaving output. */
  stop(): void;
}

export interface ProgressOutput {
  write(chunk: string): boolean;
  isTTY?: boolean;
  columns?: number;
  hasColors?: () => boolean;
}

export interface ProgressOptions {
  /** Text for succeed() without an argument. */
  doneText?: string;
  enabled?: boolean;
  stream?: ProgressOutput;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Streams that share the terminal; their writes clear the live line first. */
  outputs?: ProgressOutput[];
}

export const noProgress: Progress = Object.freeze({ update() {}, succeed() {}, fail() {}, stop() {} });

export function startProgress(text: string, options: ProgressOptions = {}): Progress {
  const stream = options.stream ?? process.stderr;
  const env = options.env ?? process.env;
  if (options.enabled === false || !stream.isTTY || 'CI' in env || env.TERM === 'dumb') return noProgress;
  return new TerminalProgress(text, stream, env, options);
}

/** A detached pairing child reports its steps to the terminal that launched it. */
function forwardProgress(type: string): Progress {
  return {
    update(text) { if (process.connected) process.send?.({ type, text }); },
    succeed() {}, fail() {}, stop() {},
  };
}

/**
 * Agent pairing progress: the launching terminal draws it, a detached child
 * forwards it over IPC, and every other command stays silent.
 */
export function agentPairProgress(args: readonly string[], ipcPrefix: string, agent: string): Progress {
  if ((args[0] ?? 'pair') !== 'pair' || args.includes('--json')) return noProgress;
  if (process.send) return forwardProgress(`${ipcPrefix}.progress`);
  return startProgress(`Checking ${agent}…`, { doneText: `${agent} is ready to pair` });
}

/** Closes the live line with ✔ or ✖ before the caller prints any result or error. */
export async function track<T>(progress: Progress, task: () => Promise<T>): Promise<T> {
  try {
    const value = await task();
    progress.succeed();
    return value;
  } catch (error) {
    progress.fail();
    throw error;
  }
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const ASCII_FRAMES = ['-', '\\', '|', '/'];
const FRAME_MS = 80;
const CLEAR_LINE = '\r\x1b[2K';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

class TerminalProgress implements Progress {
  private readonly write: (chunk: string) => boolean;
  private readonly stream: ProgressOutput;
  private readonly doneText?: string;
  private readonly unicode: boolean;
  private readonly color: boolean;
  private readonly startedAt = Date.now();
  private readonly timer: NodeJS.Timeout;
  private readonly releaseOutputs: () => void;
  private text: string;
  private frame = 0;
  private visible = false;
  private done = false;

  constructor(text: string, stream: ProgressOutput, env: NodeJS.ProcessEnv, options: ProgressOptions) {
    this.write = stream.write.bind(stream);
    this.stream = stream;
    this.doneText = options.doneText;
    this.unicode = supportsUnicode(env, options.platform ?? process.platform);
    this.color = stream.hasColors?.() ?? false;
    this.text = clean(text);
    this.releaseOutputs = interceptOutputs(options.outputs ?? [process.stdout, process.stderr].filter(output => output.isTTY), () => this.clear());
    process.once('exit', this.onExit);
    process.once('SIGINT', this.onSignal);
    process.once('SIGTERM', this.onSignal);
    this.write(HIDE_CURSOR);
    this.render();
    this.timer = setInterval(() => { this.frame += 1; this.render(); }, FRAME_MS);
    this.timer.unref();
  }

  update(text: string): void {
    const next = clean(text);
    if (this.done || next === this.text) return;
    this.text = next;
    this.render();
  }

  succeed(text = this.doneText): void {
    const duration = this.paint('2', '22', `  ${formatDuration(Date.now() - this.startedAt)}`);
    this.finish(`${this.paint('32', '39', this.unicode ? '✔' : '√')} ${this.label(text ? clean(text) : withoutEllipsis(this.text))}${duration}`);
  }

  fail(): void {
    this.finish(`${this.paint('31', '39', this.unicode ? '✖' : '×')} ${this.label(withoutEllipsis(this.text))}`);
  }

  stop(): void {
    this.finish('');
  }

  private render(): void {
    if (this.done) return;
    const frames = this.unicode ? FRAMES : ASCII_FRAMES;
    const room = Math.max(20, (this.stream.columns || 80) - 1) - 2;
    const elapsed = formatElapsed(Date.now() - this.startedAt);
    const label = this.label(this.text);
    const suffix = elapsed && displayWidth(label) + elapsed.length + 2 <= room ? `  ${elapsed}` : '';
    const line = fit(label, room - suffix.length, this.unicode);
    this.write(`${CLEAR_LINE}${this.paint('36', '39', frames[this.frame % frames.length])} ${line}${suffix && this.paint('2', '22', suffix)}`);
    this.visible = true;
  }

  private clear(): void {
    if (!this.visible || this.done) return;
    this.write(CLEAR_LINE);
    this.visible = false;
  }

  private finish(line: string): void {
    if (this.done) return;
    this.done = true;
    clearInterval(this.timer);
    this.releaseOutputs();
    process.off('exit', this.onExit);
    process.off('SIGINT', this.onSignal);
    process.off('SIGTERM', this.onSignal);
    this.write(`${CLEAR_LINE}${line ? `${line}\n` : ''}${SHOW_CURSOR}`);
  }

  private label(text: string): string {
    return this.unicode ? text : text.replace(/…/g, '...');
  }

  private paint(open: string, close: string, text: string): string {
    return this.color ? `\x1b[${open}m${text}\x1b[${close}m` : text;
  }

  private readonly onExit = (): void => { this.stop(); };

  // Restore the cursor, then keep the default signal outcome when nothing else handles it.
  private readonly onSignal = (signal: NodeJS.Signals): void => {
    this.stop();
    if (process.listeners(signal).length === 0) process.kill(process.pid, signal);
  };
}

function interceptOutputs(outputs: ProgressOutput[], beforeWrite: () => void): () => void {
  const releases = outputs.map((output) => {
    const own = Object.prototype.hasOwnProperty.call(output, 'write');
    const original = output.write;
    const wrapper = function (this: ProgressOutput, ...args: unknown[]): boolean {
      beforeWrite();
      return (original as (...values: unknown[]) => boolean).apply(this, args);
    };
    output.write = wrapper;
    return () => {
      if (output.write !== wrapper) return;
      if (own) output.write = original;
      else delete (output as { write?: unknown }).write;
    };
  });
  return () => { for (const release of releases) release(); };
}

function supportsUnicode(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  if (platform !== 'win32') return env.TERM !== 'linux';
  return Boolean(env.WT_SESSION || env.TERMINUS_SUBLIME)
    || env.ConEmuTask === '{cmd::Cmder}'
    || env.TERM_PROGRAM === 'Terminus-Sublime'
    || env.TERM_PROGRAM === 'vscode'
    || env.TERM === 'xterm-256color'
    || env.TERM === 'alacritty'
    || env.TERMINAL_EMULATOR === 'JetBrains-JediTerm';
}

function clean(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
}

function withoutEllipsis(text: string): string {
  return text.replace(/(?:…|\.\.\.)$/, '');
}

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u;

function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += WIDE.test(char) ? 2 : 1;
  return width;
}

/** Keeps the live line on one terminal row; a wrapped line cannot be cleared in place. */
function fit(text: string, max: number, unicode: boolean): string {
  if (displayWidth(text) <= max) return text;
  const ellipsis = unicode ? '…' : '...';
  let width = 0;
  let fitted = '';
  for (const char of text) {
    const next = WIDE.test(char) ? 2 : 1;
    if (width + next + ellipsis.length > max) break;
    fitted += char;
    width += next;
  }
  return `${fitted.trimEnd()}${ellipsis}`;
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 1) return '';
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function formatDuration(ms: number): string {
  if (ms < 10_000) return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}
