import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_HERMES_API_BASE_URL = 'http://127.0.0.1:8642';
export const DEFAULT_HERMES_API_HEALTH_PATH = '/health';
export const DEFAULT_BRIDGE_HOST = '0.0.0.0';
export const DEFAULT_BRIDGE_PORT = 4319;
export const DEFAULT_SESSION_ID = 'main';
export const DEFAULT_AGENT_NAME = 'Hermes';
export const BRIDGE_TICK_INTERVAL_MS = 15_000;
export const HEALTH_POLL_INTERVAL_MS = 10_000;
export const WS_HEARTBEAT_INTERVAL_MS = 30_000;
export const HERMES_BOOT_TIMEOUT_MS = 20_000;
export const HERMES_MODEL_STATE_CACHE_TTL_MS = 60_000;
export const SLOW_BRIDGE_REQUEST_LOG_THRESHOLD_MS = 250;
export const SESSION_STORE_PATH = join(homedir(), '.clawket', 'hermes-bridge-sessions.json');
export const USAGE_LEDGER_PATH = join(homedir(), '.clawket', 'hermes-usage-ledger.json');
export const HERMES_STATE_DB_PATH = join(homedir(), '.hermes', 'state.db');
export const DEFAULT_HERMES_SOURCE_PATH = join(homedir(), '.hermes', 'hermes-agent');
export const DEFAULT_HERMES_HOME_PATH = join(homedir(), '.hermes');
export const HERMES_AGENT_FILE_NAMES = ['MEMORY.md', 'USER.md'] as const;

export const HERMES_BRIDGE_CAPABILITIES = [
  'bridge.capabilities.v2',
  'hermes.multi-session.v2',
] as const;

export type HermesBridgeRequest = {
  type?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

export class DebouncedFilePersister {
  private timer: NodeJS.Timeout | null = null;
  private pendingPayloadBuilder: (() => string) | null = null;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly filePath: string,
    private readonly debounceMs: number = 100,
    private readonly onError?: (error: unknown) => void,
  ) {}

  schedule(buildPayload: () => string): void {
    this.pendingPayloadBuilder = buildPayload;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runPendingWrite();
    }, this.debounceMs);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.runPendingWrite();
    if (this.inflight) await this.inflight;
  }

  private async runPendingWrite(): Promise<void> {
    if (this.inflight) await this.inflight;
    if (!this.pendingPayloadBuilder) return;
    const builder = this.pendingPayloadBuilder;
    this.pendingPayloadBuilder = null;
    let payload: string;
    try {
      payload = builder();
    } catch (error) {
      this.onError?.(error);
      return;
    }
    this.inflight = (async () => {
      try {
        await mkdir(dirname(this.filePath), { recursive: true });
        await writeFile(this.filePath, payload, 'utf8');
      } catch (error) {
        this.onError?.(error);
      } finally {
        this.inflight = null;
      }
    })();
    await this.inflight;
  }
}

export function normalizeHost(host?: string): string {
  return host?.trim() || DEFAULT_BRIDGE_HOST;
}

export function normalizePort(port?: number): number {
  if (!Number.isFinite(port) || !port || port < 1 || port > 65_535) return DEFAULT_BRIDGE_PORT;
  return Math.floor(port);
}

export function readRequestPathname(rawUrl: string | undefined): string {
  return new URL(rawUrl || '/', 'http://localhost').pathname;
}

export function normalizeHttpBase(url: string): string {
  return url.replace(/\/+$/, '');
}

export function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function buildHermesBridgeHttpUrl(host: string, port: number): string {
  return `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
}

export function buildHermesBridgeWsUrl(host: string, port: number, token: string): string {
  return `${buildHermesBridgeHttpUrl(host, port).replace(/^http/, 'ws')}/v1/hermes/ws?token=${encodeURIComponent(token)}`;
}

export function extractHostname(url: string): string {
  return new URL(url).hostname;
}

export function extractPort(url: string): number {
  const parsed = new URL(url);
  if (parsed.port) return Number(parsed.port);
  return parsed.protocol === 'https:' ? 443 : 80;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readPositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.trunc(value);
}

export function readNullablePositiveInt(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.trunc(value);
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const text = readString(entry);
    return text ? [text] : [];
  });
}

export function requireNonEmptyString(value: string | null | undefined, message: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(message);
  return normalized;
}

export function compareIsoTimestamps(left: string | null, right: string | null): number {
  const leftMs = left ? Date.parse(left) : 0;
  const rightMs = right ? Date.parse(right) : 0;
  return (Number.isFinite(leftMs) ? leftMs : 0) - (Number.isFinite(rightMs) ? rightMs : 0);
}

export function summarizeText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length <= 160 ? normalized : `${normalized.slice(0, 157)}...`;
}

export function mapHermesUsage(value: unknown): { input?: number; output?: number; total?: number } | undefined {
  if (!isRecord(value)) return undefined;
  const input = readNumber(value.input_tokens ?? value.prompt_tokens ?? value.input);
  const output = readNumber(value.output_tokens ?? value.completion_tokens ?? value.output);
  const total = readNumber(value.total_tokens ?? value.total) ?? ((input ?? 0) + (output ?? 0));
  if (input == null && output == null && !total) return undefined;
  return {
    ...(input != null ? { input } : {}),
    ...(output != null ? { output } : {}),
    ...(total != null ? { total } : {}),
  };
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function installHermesMethods(target: object, source: object): void {
  for (const name of Object.getOwnPropertyNames(source)) {
    if (name === 'constructor') continue;
    const descriptor = Object.getOwnPropertyDescriptor(source, name);
    if (descriptor) Object.defineProperty(target, name, descriptor);
  }
}
