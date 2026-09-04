import { Platform } from 'react-native';
import { sha256 } from 'js-sha256';
import { publicYouMindAuthConfig } from '../../config/public';
import {
  StorageService,
  type YouMindAuthSession,
} from '../../services/storage';
import {
  HttpStreamError,
  HttpStreamTransport,
  type HttpStreamDecoder,
} from '../transports';
import type { YouMindCompletionChunk } from './youmind-sprite-codec';

const REFRESH_THRESHOLD_RATIO = 0.1;
const REFRESH_THRESHOLD_MIN_MS = 30_000;
const YOUMIND_APP_ID = '0';
const YOUMIND_NONCE_BYTES = 12;

export type YouMindSprite = {
  id: string;
  creatorId?: string;
  creator_id?: string;
  name?: string | null;
  avatarUrl?: string | null;
  avatar_url?: string | null;
  ownerPersona?: Record<string, unknown> | null;
  owner_persona?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export interface YouMindSpriteApi {
  getStoredSession(): Promise<YouMindAuthSession | null>;
  clearSession(): Promise<void>;
  sendOtp(email: string): Promise<void>;
  verifyOtp(email: string, code: string): Promise<YouMindAuthSession>;
  ensureDefaultSprite(signal?: AbortSignal): Promise<YouMindSprite>;
  loadSpriteSession(params: {
    spriteId: string;
    limit: number;
    cursor?: string;
    signal?: AbortSignal;
  }): Promise<Record<string, unknown>>;
  streamSpriteMessage(params: {
    spriteId: string;
    userId: string;
    text: string;
    signal?: AbortSignal;
  }): Promise<AsyncGenerator<YouMindCompletionChunk>>;
  abortSprite(params: {
    spriteId: string;
    personaId: string;
    signal?: AbortSignal;
  }): Promise<{ aborted: boolean; completionId?: string }>;
}

export class YouMindSpriteApiError extends Error {
  public constructor(
    message: string,
    public readonly status?: number,
    public readonly detailCode?: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'YouMindSpriteApiError';
  }
}

type SessionStorage = Pick<
  typeof StorageService,
  | 'getYouMindAuthSession'
  | 'setYouMindAuthSession'
  | 'clearYouMindAuthSession'
  | 'getYouMindDeviceId'
  | 'setYouMindDeviceId'
>;

type YouMindSpriteApiClientOptions = {
  storage?: SessionStorage;
  fetchImpl?: typeof fetch;
  streamTransport?: HttpStreamTransport;
  now?: () => number;
  timeZone?: () => string;
  platform?: string;
};

export class YouMindSpriteApiClient implements YouMindSpriteApi {
  private readonly baseUrl: string;
  private readonly authScopeKey: string;
  private readonly storage: SessionStorage;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeZone: () => string;
  private readonly platform: string;
  private readonly streamTransport: HttpStreamTransport;
  private refreshPromise: Promise<YouMindAuthSession | null> | null = null;

  public constructor(
    baseUrl: string,
    authScopeKey: string,
    options: YouMindSpriteApiClientOptions = {},
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.authScopeKey = authScopeKey.trim();
    this.storage = options.storage ?? StorageService;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeZone = options.timeZone
      ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    this.platform = options.platform ?? Platform.OS;
    this.streamTransport = options.streamTransport ?? new HttpStreamTransport({
      baseUrl: this.baseUrl,
      getHeaders: () => this.buildHeaders(),
      getAccessToken: async () => (await this.getValidSession())?.accessToken,
      refreshAccessToken: async () => Boolean(await this.refreshSession(true)),
    });
  }

  public getStoredSession(): Promise<YouMindAuthSession | null> {
    return this.storage.getYouMindAuthSession(this.baseUrl, this.authScopeKey, {
      allowLegacyFallback: true,
    });
  }

  public clearSession(): Promise<void> {
    return this.storage.clearYouMindAuthSession(this.baseUrl, this.authScopeKey);
  }

  public async sendOtp(email: string): Promise<void> {
    const path = '/api/v1/auth/signInWithOTP';
    const body = { email: email.trim(), timeZone: this.timeZone() };
    const bodyText = JSON.stringify(body);
    await this.requestJson(path, {
      bodyText,
      headers: buildYouMindHmacHeaders(path, bodyText, this.now()),
    });
  }

  public async verifyOtp(email: string, code: string): Promise<YouMindAuthSession> {
    const response = await this.requestJson<{
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      user?: YouMindAuthSession['user'];
    }>('/api/v1/auth/mobile/validateOTPToken', {
      body: {
        formData: {
          email: email.trim(),
          token: code.trim().split('').filter(Boolean),
        },
        timeZone: this.timeZone(),
      },
    });
    const session = toSession(response, this.now());
    await this.storage.setYouMindAuthSession(this.baseUrl, session, this.authScopeKey);
    return session;
  }

  public async ensureDefaultSprite(signal?: AbortSignal): Promise<YouMindSprite> {
    const response = await this.requestJson<{ sprite?: YouMindSprite | null }>(
      '/api/v1/sprite/ensureDefault',
      { auth: true, body: {}, signal },
    );
    if (!response.sprite?.id) {
      throw new YouMindSpriteApiError('YouMind default Sprite is missing.', 500);
    }
    return response.sprite;
  }

  public loadSpriteSession(params: {
    spriteId: string;
    limit: number;
    cursor?: string;
    signal?: AbortSignal;
  }): Promise<Record<string, unknown>> {
    return this.requestJson('/api/v1/sprite/sessionLoad', {
      auth: true,
      signal: params.signal,
      body: {
        spriteId: params.spriteId,
        limit: Math.max(1, Math.min(50, params.limit)),
        ...(params.cursor ? { cursor: params.cursor } : {}),
      },
    });
  }

  public async streamSpriteMessage(params: {
    spriteId: string;
    userId: string;
    text: string;
    signal?: AbortSignal;
  }): Promise<AsyncGenerator<YouMindCompletionChunk>> {
    const currentLocalTime = formatLocalTimestamp(new Date(this.now()));
    return this.streamTransport.stream('/api/v1/sprite/sessionPrompt', {
      method: 'POST',
      signal: params.signal,
      decoder: youMindSseDecoder,
      headers: { 'Content-Type': 'application/json' },
      body: {
        spriteId: params.spriteId,
        userId: params.userId,
        messages: [{
          role: 'user',
          content: params.text,
          currentLocalTime,
          messageContext: {
            schema: 'youmind.sprite.message_context.v1',
            currentLocalTime,
            timeZone: this.timeZone(),
            surface: 'saas',
            conversationType: 'direct',
          },
        }],
        useComputer: false,
      },
    });
  }

  public abortSprite(params: {
    spriteId: string;
    personaId: string;
    signal?: AbortSignal;
  }): Promise<{ aborted: boolean; completionId?: string }> {
    return this.requestJson('/api/v1/sprite/abort', {
      auth: true,
      signal: params.signal,
      body: { spriteId: params.spriteId, personaId: params.personaId },
    });
  }

  private async getValidSession(): Promise<YouMindAuthSession | null> {
    return this.refreshSession(false);
  }

  private async refreshSession(force: boolean): Promise<YouMindAuthSession | null> {
    const stored = await this.getStoredSession();
    if (!stored) return null;
    if (!force && !shouldRefresh(stored, this.now())) return stored;
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this.requestJson<{
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      user?: YouMindAuthSession['user'];
    }>('/api/v1/auth/mobile/refreshToken', {
      body: { refreshToken: stored.refreshToken },
      allowRefresh: false,
    }).then(async (response) => {
      const next = toSession(response, this.now(), stored.user);
      await this.storage.setYouMindAuthSession(this.baseUrl, next, this.authScopeKey);
      return next;
    }).catch(async (error: unknown) => {
      if (error instanceof YouMindSpriteApiError && error.status === 401) {
        await this.clearSession();
        throw error;
      }
      if (force) throw error;
      return stored;
    }).finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async requestJson<T>(
    path: string,
    options: {
      auth?: boolean;
      allowRefresh?: boolean;
      body?: unknown;
      bodyText?: string;
      headers?: Record<string, string>;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    let session = options.auth ? await this.getValidSession() : null;
    if (options.auth && !session) {
      throw new YouMindSpriteApiError('YouMind sign-in required.', 401);
    }
    const bodyText = options.bodyText
      ?? (options.body === undefined ? undefined : JSON.stringify(options.body));

    const send = async (accessToken?: string): Promise<Response> => this.fetchImpl(
      `${this.baseUrl}${path}`,
      {
        method: 'POST',
        headers: {
          ...(await this.buildHeaders()),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(options.headers ?? {}),
        },
        body: bodyText,
        signal: options.signal,
      },
    );

    let response: Response;
    try {
      response = await send(session?.accessToken);
      if (response.status === 401 && options.auth && options.allowRefresh !== false) {
        session = await this.refreshSession(true);
        if (session) response = await send(session.accessToken);
      }
    } catch (cause) {
      if (cause instanceof YouMindSpriteApiError) throw cause;
      throw new YouMindSpriteApiError(
        cause instanceof Error ? cause.message : 'YouMind network request failed.',
        undefined,
        undefined,
        cause,
      );
    }
    const text = await response.text().catch(() => '');
    if (!response.ok) {
      const detail = parseErrorPayload(text);
      throw new YouMindSpriteApiError(
        detail.message || response.statusText || 'YouMind request failed.',
        response.status,
        detail.code,
      );
    }
    if (!text.trim()) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new YouMindSpriteApiError('YouMind returned invalid JSON.', response.status, undefined, cause);
    }
  }

  private async buildHeaders(): Promise<Record<string, string>> {
    let deviceId = await this.storage.getYouMindDeviceId();
    if (!deviceId) {
      deviceId = randomHex(16);
      await this.storage.setYouMindDeviceId(deviceId);
    }
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-time-zone': this.timeZone(),
      'x-use-camel-case': 'true',
      'x-client-type': this.platform === 'android' ? 'mobile_android' : 'mobile_ios',
      'x-device-id': deviceId,
      'User-Agent': `Clawket/3.0 (${this.platform})`,
    };
  }
}

export const youMindSseDecoder: HttpStreamDecoder<YouMindCompletionChunk> = (
  buffer,
  { final },
) => {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const values: YouMindCompletionChunk[] = [];
  let cursor = 0;
  while (true) {
    const boundary = normalized.indexOf('\n\n', cursor);
    if (boundary < 0) break;
    values.push(...parseSseEvent(normalized.slice(cursor, boundary)));
    cursor = boundary + 2;
  }
  const rest = normalized.slice(cursor);
  if (final && rest.trim()) {
    values.push(...parseSseEvent(rest));
    return { values, rest: '' };
  }
  return { values, rest };
};

function parseSseEvent(rawEvent: string): YouMindCompletionChunk[] {
  const payload = rawEvent
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n');
  if (!payload || payload === '[DONE]') return [];
  return [JSON.parse(payload) as YouMindCompletionChunk];
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '') || 'https://youmind.com';
}

function formatLocalTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function shouldRefresh(session: YouMindAuthSession, now: number): boolean {
  const lifetimeMs = session.expiresIn * 1000;
  const thresholdMs = Math.max(REFRESH_THRESHOLD_MIN_MS, lifetimeMs * REFRESH_THRESHOLD_RATIO);
  return session.createdAtMs + lifetimeMs - now <= thresholdMs;
}

function toSession(
  value: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user?: YouMindAuthSession['user'];
  },
  createdAtMs: number,
  fallbackUser?: YouMindAuthSession['user'],
): YouMindAuthSession {
  if (!value.accessToken?.trim() || !value.refreshToken?.trim() || !(value.expiresIn > 0)) {
    throw new YouMindSpriteApiError('YouMind authentication response is invalid.', 500);
  }
  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    expiresIn: value.expiresIn,
    createdAtMs,
    user: value.user ?? fallbackUser ?? null,
  };
}

function buildYouMindHmacHeaders(
  path: string,
  bodyText: string,
  timestampMs: number,
): Record<string, string> {
  const secret = publicYouMindAuthConfig.appSecret?.trim();
  if (!secret) {
    throw new YouMindSpriteApiError(
      'YouMind app secret is not configured. Set EXPO_PUBLIC_YOUMIND_APP_SECRET.',
    );
  }
  const timestamp = String(timestampMs);
  const nonce = randomHex(YOUMIND_NONCE_BYTES);
  const encodedPath = path.split('/').map(encodeRfc3986Component).join('/');
  const signature = sha256.hmac(
    secret,
    ['POST', encodedPath, timestamp, nonce, sha256(bodyText)].join('\n'),
  );
  return {
    'x-app-id': YOUMIND_APP_ID,
    'x-timestamp': timestamp,
    'x-nonce': nonce,
    'x-signature': signature,
  };
}

function encodeRfc3986Component(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Encode the original segment when it contains malformed percent escapes.
  }
  return encodeURIComponent(decoded).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function randomHex(bytesCount: number): string {
  const bytes = new Uint8Array(bytesCount);
  if (!globalThis.crypto?.getRandomValues) {
    throw new YouMindSpriteApiError('Secure random generator unavailable.');
  }
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function parseErrorPayload(text: string): { message?: string; code?: string } {
  try {
    const value = JSON.parse(text) as {
      message?: unknown;
      code?: unknown;
      error?: { message?: unknown; code?: unknown };
    };
    return {
      message: readString(value.message) ?? readString(value.error?.message),
      code: readString(value.code) ?? readString(value.error?.code),
    };
  } catch {
    return {};
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function mapYouMindSpriteApiError(error: unknown): YouMindSpriteApiError {
  if (error instanceof YouMindSpriteApiError) return error;
  if (error instanceof HttpStreamError) {
    return new YouMindSpriteApiError(error.message, error.status, error.detailCode, error);
  }
  return new YouMindSpriteApiError(
    error instanceof Error ? error.message : 'YouMind request failed.',
    undefined,
    undefined,
    error,
  );
}
