import {
  AdapterError,
  CAPABILITY_MATRIX,
  type AgentAdapter,
  type AgentDescriptor,
  type ConnectionDescriptor,
  type ConnectionRecord,
  type ConnectionState,
  type PromptInput,
  type SessionDescriptor,
  type SessionHistory,
  type SessionUpdate,
} from '@clawket/agent-protocol';
import i18n from '../../i18n';
import { StorageService } from '../../services/storage';
import {
  createYouMindSpriteChunkState,
  mapYouMindSpriteChunk,
  mapYouMindSpriteHistory,
} from './youmind-sprite-codec';
import {
  mapYouMindSpriteApiError,
  YouMindSpriteApiClient,
  type YouMindSprite,
  type YouMindSpriteApi,
  type YouMindSpriteApiError,
} from './youmind-sprite-api';
import { resolveYouMindSpriteAvatarUrl } from './youmind-sprite-avatar';

const MAIN_SESSION_KEY = 'main';
const RECOVERY_DELAYS_MS = [3_000, 6_000, 12_000] as const;

type OpeningStore = {
  hasOpened(connectionId: string): Promise<boolean>;
  markOpened(connectionId: string): Promise<void>;
};

type YouMindSpriteAdapterOptions = {
  api?: YouMindSpriteApi;
  openingStore?: OpeningStore;
  language?: () => string;
  delay?: (milliseconds: number) => Promise<void>;
  isFreeSlot?: boolean;
  onGreetingSent?: () => void;
};

type AdapterListeners = {
  update: (update: SessionUpdate) => void;
  state: (state: ConnectionState, reason?: string) => void;
  sessions: (sessions: SessionDescriptor[]) => void;
};

export class YouMindSpriteAdapter implements AgentAdapter {
  public readonly connection: ConnectionDescriptor;
  public readonly capabilities = { ...CAPABILITY_MATRIX.youmind };

  readonly #api: YouMindSpriteApi;
  private readonly openingStore: OpeningStore;
  private readonly language: () => string;
  private readonly delay: (milliseconds: number) => Promise<void>;
  private readonly onGreetingSent?: () => void;
  private readonly listeners: {
    [K in keyof AdapterListeners]: Set<AdapterListeners[K]>;
  } = {
    update: new Set(),
    state: new Set(),
    sessions: new Set(),
  };
  private currentState: ConnectionState = 'idle';
  private sprite: YouMindSprite | null = null;
  private userId = '';
  private personaId = '';
  private latestUpdatedAt: number | null = null;
  private latestPreview: string | undefined;
  private activeRun: {
    runId: string;
    controller: AbortController;
    generation: number;
  } | null = null;
  private generation = 0;
  private connectPromise: Promise<void> | null = null;

  public constructor(record: ConnectionRecord, options: YouMindSpriteAdapterOptions = {}) {
    if (record.backendKind !== 'youmind') {
      throw new TypeError('YouMindSpriteAdapter requires a YouMind connection record.');
    }
    const authScopeKey = record.youmind?.authScopeKey?.trim();
    if (!authScopeKey) {
      throw new TypeError('YouMind connection is missing authScopeKey.');
    }
    this.#api = options.api ?? new YouMindSpriteApiClient(record.url, authScopeKey);
    this.openingStore = options.openingStore ?? createOpeningStore();
    this.language = options.language ?? (() => i18n.language || 'en');
    this.delay = options.delay ?? wait;
    this.onGreetingSent = options.onGreetingSent;
    this.connection = {
      id: record.id,
      backendKind: record.backendKind,
      transportKind: record.transportKind,
      label: record.label,
      environment: record.environment,
      createdAt: record.createdAt,
      isFreeSlot: options.isFreeSlot ?? false,
    };
  }

  public get state(): ConnectionState {
    return this.currentState;
  }

  public connect(): Promise<void> {
    if (this.currentState === 'ready') return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;
    this.setState('connecting');
    this.connectPromise = this.initialize()
      .then(() => this.setState('ready'))
      .catch((error: unknown) => {
        const mapped = toAdapterError(error);
        this.setState('error', mapped.message);
        throw mapped;
      })
      .finally(() => {
        this.connectPromise = null;
      });
    return this.connectPromise;
  }

  public disconnect(): void {
    this.generation += 1;
    this.activeRun?.controller.abort();
    this.activeRun = null;
    this.setState('idle');
  }

  public async probe(timeoutMs = 5_000): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
    try {
      const sprite = await this.#api.ensureDefaultSprite(controller.signal);
      this.cacheSprite(sprite);
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  public async listAgents(): Promise<AgentDescriptor[]> {
    await this.ensureReady();
    await this.refreshSprite();
    const sprite = this.requireSprite();
    return [{
      connectionId: this.connection.id,
      agentId: sprite.id,
      name: readString(sprite.name) || this.connection.label || 'YouMind',
      avatarUrl: resolveYouMindSpriteAvatarUrl(sprite),
      isMain: true,
      mainSessionKey: MAIN_SESSION_KEY,
    }];
  }

  public async listSessions(): Promise<SessionDescriptor[]> {
    await this.ensureReady();
    const detail = await this.#api.loadSpriteSession({
      spriteId: this.requireSprite().id,
      limit: 1,
    }).catch((error: unknown) => {
      throw toAdapterError(error);
    });
    const history = mapYouMindSpriteHistory(detail, MAIN_SESSION_KEY);
    this.updateHistoryMetadata(history);
    const sessions = [this.createMainSession(history.hasActiveRun)];
    this.emit('sessions', sessions);
    return sessions;
  }

  public async loadSession(
    key: string,
    options: { limit?: number; cursor?: string } = {},
  ): Promise<SessionHistory> {
    this.assertMainSession(key);
    await this.ensureReady();
    const detail = await this.#api.loadSpriteSession({
      spriteId: this.requireSprite().id,
      limit: Math.max(1, Math.min(50, options.limit ?? 50)),
      cursor: options.cursor,
    }).catch((error: unknown) => {
      throw toAdapterError(error);
    });
    const history = mapYouMindSpriteHistory(detail, MAIN_SESSION_KEY);
    this.updateHistoryMetadata(history);
    this.emit('sessions', [this.createMainSession(history.hasActiveRun)]);
    if (history.messages.length === 0 && !options.cursor) {
      await this.startOpeningIfNeeded();
    }
    return history;
  }

  public async prompt(key: string, input: PromptInput): Promise<{ runId: string }> {
    this.assertMainSession(key);
    await this.ensureReady();
    if (input.attachments?.length || input.skillId) {
      throw new AdapterError('unsupported', 'YouMind Sprite does not support attachments or skills.');
    }
    if (this.activeRun) {
      throw new AdapterError('server', 'A YouMind Sprite run is already active.');
    }
    const runId = input.idempotencyKey || createRunId();
    const controller = new AbortController();
    const generation = ++this.generation;
    const stream = await this.#api.streamSpriteMessage({
      spriteId: this.requireSprite().id,
      userId: this.requireUserId(),
      text: input.text,
      signal: controller.signal,
    }).catch((error: unknown) => {
      throw toAdapterError(error);
    });
    this.activeRun = { runId, controller, generation };
    void this.consumeStream(stream, runId, generation);
    return { runId };
  }

  public async cancel(key: string, runId?: string): Promise<void> {
    this.assertMainSession(key);
    await this.ensureReady();
    const active = this.activeRun;
    if (runId && active && active.runId !== runId) return;
    if (active) {
      this.generation += 1;
      this.activeRun = null;
      active.controller.abort();
      this.emit('update', {
        type: 'run_finished',
        sessionKey: MAIN_SESSION_KEY,
        runId: active.runId,
        stopReason: 'cancelled',
      });
    }
    try {
      await this.#api.abortSprite({
        spriteId: this.requireSprite().id,
        personaId: this.requirePersonaId(),
      });
    } catch (error) {
      throw toAdapterError(error);
    }
  }

  public on(
    event: 'update',
    listener: (update: SessionUpdate) => void,
  ): () => void;
  public on(
    event: 'state',
    listener: (state: ConnectionState, reason?: string) => void,
  ): () => void;
  public on(
    event: 'sessions',
    listener: (sessions: SessionDescriptor[]) => void,
  ): () => void;
  public on<K extends keyof AdapterListeners>(event: K, listener: AdapterListeners[K]): () => void {
    const listeners = this.listeners[event] as Set<AdapterListeners[K]>;
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  private async initialize(): Promise<void> {
    const sprite = await this.#api.ensureDefaultSprite();
    this.cacheSprite(sprite);
  }

  /**
   * The Sprite's name and avatar are edited on YouMind, not in Clawket. Every
   * roster refresh re-reads them so a rename or new avatar shows up without a
   * reconnect; a failed re-read keeps the last known identity.
   */
  private async refreshSprite(): Promise<void> {
    try {
      const sprite = await this.#api.ensureDefaultSprite();
      if (sprite?.id) this.cacheSprite(sprite);
    } catch {
      // Keep the connect-time Sprite; the next prompt or probe surfaces real failures.
    }
  }

  private cacheSprite(sprite: YouMindSprite): void {
    this.sprite = sprite;
    const persona = readRecord(sprite.ownerPersona) ?? readRecord(sprite.owner_persona);
    this.userId = readString(sprite.creatorId ?? sprite.creator_id);
    this.personaId = readString(persona?.personaId ?? persona?.persona_id ?? persona?.id);
  }

  private async ensureReady(): Promise<void> {
    if (this.currentState !== 'ready') await this.connect();
    if (!this.userId) {
      const session = await this.#api.getStoredSession();
      this.userId = readString(session?.user?.id)
        || readString(this.sprite?.creatorId ?? this.sprite?.creator_id);
    }
  }

  private async consumeStream(
    stream: AsyncGenerator<import('./youmind-sprite-codec').YouMindCompletionChunk>,
    initialRunId: string,
    generation: number,
  ): Promise<void> {
    const chunkState = createYouMindSpriteChunkState(initialRunId);
    let assistantPreview = '';
    try {
      for await (const chunk of stream) {
        if (this.generation !== generation) return;
        const updates = mapYouMindSpriteChunk(chunk, MAIN_SESSION_KEY, chunkState);
        for (const update of updates) {
          if (update.type === 'agent_message_chunk') {
            assistantPreview += update.text;
            this.latestPreview = assistantPreview;
            this.latestUpdatedAt = Date.now();
          }
          this.emit('update', update.type === 'agent_message_chunk' ? { ...update, textMode: 'delta' } : update);
        }
        if (updates.some((update) => update.type === 'run_finished')) {
          this.emit('sessions', [this.createMainSession(false)]);
        }
      }
      if (!chunkState.terminal && this.generation === generation) {
        await this.recoverRun(chunkState.runId, generation);
      }
    } catch (error) {
      if (this.generation !== generation || isAbortError(error)) return;
      const mapped = toAdapterError(error);
      if (mapped.code !== 'network' && mapped.code !== 'timeout') {
        await this.finishFailedRun(chunkState.runId, mapped, generation);
        return;
      }
      await this.recoverRun(chunkState.runId, generation, error);
    } finally {
      if (this.activeRun?.generation === generation) this.activeRun = null;
    }
  }

  private async recoverRun(runId: string, generation: number, streamError?: unknown): Promise<void> {
    let attempt = 0;
    while (this.generation === generation && this.currentState === 'ready') {
      await this.delay(RECOVERY_DELAYS_MS[Math.min(attempt, RECOVERY_DELAYS_MS.length - 1)]);
      if (this.generation !== generation) return;
      try {
        const detail = await this.#api.loadSpriteSession({
          spriteId: this.requireSprite().id,
          limit: 50,
        });
        const history = mapYouMindSpriteHistory(detail, MAIN_SESSION_KEY);
        this.updateHistoryMetadata(history);
        this.emit('sessions', [this.createMainSession(history.hasActiveRun)]);
        if (!history.hasActiveRun) {
          this.emit('update', {
            type: 'history_reconciled',
            sessionKey: MAIN_SESSION_KEY,
            history,
          });
          this.emit('update', {
            type: 'run_finished',
            sessionKey: MAIN_SESSION_KEY,
            runId,
            stopReason: 'end_turn',
          });
          return;
        }
      } catch (error) {
        const mapped = toAdapterError(error);
        if (mapped.code === 'unauthorized' || mapped.code === 'rate_limited') {
          await this.finishFailedRun(runId, mapped, generation);
          return;
        }
        // Recovery is deliberately tolerant: the next backoff performs a fresh read.
      }
      attempt += 1;
    }
    if (this.generation === generation) {
      const mapped = toAdapterError(streamError);
      await this.finishFailedRun(runId, mapped, generation);
    }
  }

  private async finishFailedRun(
    runId: string,
    error: AdapterError,
    generation: number,
  ): Promise<void> {
    if (error.code === 'unauthorized') {
      await this.#api.clearSession().catch(() => undefined);
      if (this.generation !== generation) return;
      this.setState('error', error.message);
    }
    if (this.generation !== generation) return;
    this.emit('update', {
      type: 'error',
      sessionKey: MAIN_SESSION_KEY,
      runId,
      code: error.code,
      message: error.message,
    });
    this.emit('update', {
      type: 'run_finished',
      sessionKey: MAIN_SESSION_KEY,
      runId,
      stopReason: 'error',
    });
  }

  private async startOpeningIfNeeded(): Promise<void> {
    if (await this.openingStore.hasOpened(this.connection.id)) return;
    await this.prompt(MAIN_SESSION_KEY, {
      text: this.language().toLowerCase().startsWith('zh') ? '\u9192\u6765\u5427' : 'WakeUp',
      idempotencyKey: `opening-${this.connection.id}`,
    });
    await this.openingStore.markOpened(this.connection.id);
    try {
      this.onGreetingSent?.();
    } catch {
      // Telemetry must never turn a successful greeting into a failed load.
    }
  }

  private createMainSession(hasActiveRun = Boolean(this.activeRun)): SessionDescriptor {
    const sprite = this.requireSprite();
    return {
      connectionId: this.connection.id,
      agentId: sprite.id,
      key: MAIN_SESSION_KEY,
      kind: 'main',
      title: readString(sprite.name) || this.connection.label || 'YouMind',
      updatedAt: this.latestUpdatedAt,
      preview: this.latestPreview,
      hasActiveRun,
      attention: null,
      source: 'native',
      allowedActions: {
        rename: false,
        reset: false,
        delete: false,
        pin: true,
      },
    };
  }

  private updateHistoryMetadata(history: SessionHistory): void {
    const latest = history.messages.reduce<(typeof history.messages)[number] | undefined>(
      (current, message) => {
        if (!current) return message;
        const currentTime = current.timestampMs ?? Number.NEGATIVE_INFINITY;
        const messageTime = message.timestampMs ?? Number.NEGATIVE_INFINITY;
        return messageTime >= currentTime ? message : current;
      },
      undefined,
    );
    if (!latest) return;
    if (
      latest.timestampMs != null
      && (this.latestUpdatedAt == null || latest.timestampMs >= this.latestUpdatedAt)
    ) {
      this.latestUpdatedAt = latest.timestampMs;
      this.latestPreview = latest.text.trim() || undefined;
      return;
    }
    if (this.latestPreview === undefined) {
      this.latestPreview = latest.text.trim() || undefined;
    }
  }

  private requireSprite(): YouMindSprite {
    if (!this.sprite) throw new AdapterError('server', 'YouMind Sprite is not initialized.');
    return this.sprite;
  }

  private requireUserId(): string {
    if (!this.userId) throw new AdapterError('unauthorized', 'YouMind user identity is missing.');
    return this.userId;
  }

  private requirePersonaId(): string {
    if (!this.personaId) throw new AdapterError('server', 'YouMind Sprite persona is missing.');
    return this.personaId;
  }

  private assertMainSession(key: string): void {
    if (key !== MAIN_SESSION_KEY) {
      throw new AdapterError('unsupported', 'YouMind Sprite only has one session.');
    }
  }

  private setState(state: ConnectionState, reason?: string): void {
    if (this.currentState === state && !reason) return;
    this.currentState = state;
    this.emit('state', state, reason);
  }

  private emit<K extends keyof AdapterListeners>(
    event: K,
    ...args: Parameters<AdapterListeners[K]>
  ): void {
    const listeners = this.listeners[event] as unknown as Set<(...values: Parameters<AdapterListeners[K]>) => void>;
    listeners.forEach((listener) => listener(...args));
  }
}

function createOpeningStore(): OpeningStore {
  const scope = (connectionId: string) => `youmind-opening:${connectionId}`;
  return {
    async hasOpened(connectionId) {
      const entry = await StorageService.getDashboardCache<{ opened?: boolean }>(scope(connectionId));
      return entry?.data.opened === true;
    },
    async markOpened(connectionId) {
      const cacheKey = scope(connectionId);
      await StorageService.setDashboardCache(cacheKey, {
        version: 2,
        cacheKey,
        savedAt: Date.now(),
        source: 'network',
        connectionStateAtSave: 'ready',
        data: { opened: true },
      });
    },
  };
}

function toAdapterError(error: unknown): AdapterError {
  if (error instanceof AdapterError) return error;
  const mapped: YouMindSpriteApiError = mapYouMindSpriteApiError(error);
  if (mapped.status === 401) return new AdapterError('unauthorized', mapped.message);
  if (mapped.status === 429) return new AdapterError('rate_limited', mapped.message);
  if (mapped.status === 408) return new AdapterError('timeout', mapped.message);
  if (mapped.status != null) return new AdapterError('server', mapped.message);
  if (isAbortError(error)) return new AdapterError('timeout', mapped.message);
  return new AdapterError('network', mapped.message);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /aborted?/i.test(error.message));
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function createRunId(): string {
  return `youmind-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
