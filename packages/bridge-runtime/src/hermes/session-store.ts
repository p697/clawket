import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_SESSION_ID,
  DebouncedFilePersister,
  isRecord,
  summarizeText,
} from './internal.js';

export type HermesBridgeSessionMessage = {
  role: 'user' | 'assistant' | 'system' | 'toolResult';
  content: string;
  ts: number;
  runId?: string;
  idempotencyKey?: string;
  toolName?: string;
  toolCallId?: string;
  _nativeToolCallId?: string;
  isError?: boolean;
  toolArgs?: string;
  toolDurationMs?: number;
  toolStartedAt?: number;
  toolFinishedAt?: number;
  _nativeBoundaryId?: string;
  /** In-memory projection metadata; never persist image bytes or native history. */
  _imageCount?: number;
};

export type HermesBridgeSession = {
  key: string;
  sessionId: string;
  title: string;
  updatedAt: number;
  messages: HermesBridgeSessionMessage[];
  toolAliases?: Record<string, { toolCallId: string; toolName?: string }>;
};

export type HermesSessionActions = {
  rename: boolean;
  reset: boolean;
  delete: boolean;
  pin: boolean;
};

export type HermesSessionListEntry = {
  key: string;
  sessionId: string;
  title: string;
  label: string;
  updatedAt: number;
  lastMessagePreview: string;
  preview: string;
  channel?: string;
  model?: string;
  modelProvider?: string;
  contextTokens?: number;
  source: 'bridge' | 'native';
  kind: 'main' | 'direct';
  hasActiveRun: boolean;
  allowedActions: HermesSessionActions;
  warnings: string[];
};

type HermesBridgeStoreState = {
  version: 1;
  sessions: HermesBridgeSession[];
};

type HermesBridgePersistedSession = {
  key: string;
  sessionId: string;
  title: string;
  updatedAt: number;
  toolAliases?: HermesBridgeSession['toolAliases'];
};

type HermesBridgePersistedState = {
  version: 1;
  sessions: HermesBridgePersistedSession[];
};

const BRIDGE_SESSION_ACTIONS: HermesSessionActions = Object.freeze({
  rename: true,
  reset: true,
  delete: true,
  pin: true,
});

export const NATIVE_SESSION_ACTIONS: HermesSessionActions = Object.freeze({
  rename: false,
  reset: false,
  delete: false,
  pin: true,
});

function createBridgeSessionId(key: string): string {
  return `clawket-hermes:${key}:${randomUUID()}`;
}

export class HermesBridgeSessionStore {
  private state: HermesBridgeStoreState;
  private readonly persister: DebouncedFilePersister;

  constructor(private readonly filePath: string) {
    this.state = this.load();
    this.persister = new DebouncedFilePersister(filePath);
  }

  async flush(): Promise<void> {
    return this.persister.flush();
  }

  count(): number {
    return this.state.sessions.length;
  }

  owns(key: string): boolean {
    return this.findSession(key) !== undefined;
  }

  findSession(key: string): HermesBridgeSession | undefined {
    return this.state.sessions.find((session) => session.key === key);
  }

  rememberToolAliases(key: string, aliases: NonNullable<HermesBridgeSession['toolAliases']>): void {
    const session = this.requireSession(key);
    const merged = cleanToolAliases({ ...session.toolAliases, ...aliases });
    if (JSON.stringify(merged) === JSON.stringify(session.toolAliases ?? {})) return;
    session.toolAliases = merged;
    this.save();
  }

  createSession(input: { key?: string | null; title?: string | null } = {}): HermesBridgeSession {
    const requestedKey = input.key?.trim();
    const key = requestedKey || randomUUID();
    if (this.findSession(key)) throw new Error(`Hermes session already exists: ${key}`);
    const now = Date.now();
    const created: HermesBridgeSession = {
      key,
      sessionId: createBridgeSessionId(key),
      title: input.title?.trim() || (key === DEFAULT_SESSION_ID ? 'Hermes' : key),
      updatedAt: now,
      messages: [],
    };
    this.state.sessions.unshift(created);
    this.save();
    return created;
  }

  ensureSession(key: string): HermesBridgeSession {
    return this.findSession(key) ?? this.createSession({ key });
  }

  renameSession(key: string, title: string): HermesBridgeSession {
    const session = this.requireSession(key);
    session.title = title.trim() || session.title;
    session.updatedAt = Date.now();
    this.save();
    return session;
  }

  appendMessage(key: string, message: HermesBridgeSessionMessage): void {
    const session = this.requireSession(key);
    session.messages.push(message);
    session.updatedAt = message.ts;
    this.save();
  }

  updateToolResult(
    key: string,
    toolCallId: string,
    patch: Partial<Pick<HermesBridgeSessionMessage, 'content' | '_nativeToolCallId'>>,
  ): boolean {
    const session = this.requireSession(key);
    for (let index = session.messages.length - 1; index >= 0; index--) {
      const message = session.messages[index];
      if (message.role !== 'toolResult' || message.toolCallId !== toolCallId) continue;
      session.messages[index] = {
        ...message,
        ...(patch.content !== undefined ? { content: patch.content } : {}),
        ...(patch._nativeToolCallId ? { _nativeToolCallId: patch._nativeToolCallId } : {}),
      };
      this.save();
      return true;
    }
    return false;
  }

  getHistory(key: string): {
    messages: HermesBridgeSessionMessage[];
    sessionId: string;
  } {
    const session = this.requireSession(key);
    return { messages: [...session.messages], sessionId: session.sessionId };
  }

  listSessions(limit: number, isActive: (key: string) => boolean = () => false): HermesSessionListEntry[] {
    return [...this.state.sessions]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, limit)
      .map((session) => ({
        key: session.key,
        sessionId: session.sessionId,
        title: session.title,
        label: session.title,
        updatedAt: session.updatedAt,
        lastMessagePreview: summarizeText(session.messages.at(-1)?.content ?? ''),
        preview: summarizeText(session.messages.at(-1)?.content ?? ''),
        source: 'bridge',
        kind: session.key === DEFAULT_SESSION_ID ? 'main' : 'direct',
        hasActiveRun: isActive(session.key),
        allowedActions: { ...BRIDGE_SESSION_ACTIONS },
        warnings: [],
      }));
  }

  resetSession(key: string): HermesBridgeSession {
    const session = this.requireSession(key);
    session.sessionId = createBridgeSessionId(key);
    session.messages = [];
    session.toolAliases = {};
    session.updatedAt = Date.now();
    this.save();
    return session;
  }

  deleteSession(key: string): boolean {
    const before = this.state.sessions.length;
    this.state.sessions = this.state.sessions.filter((session) => session.key !== key);
    if (this.state.sessions.length !== before) this.save();
    return this.state.sessions.length !== before;
  }

  private requireSession(key: string): HermesBridgeSession {
    const session = this.findSession(key);
    if (!session) throw new Error(`Hermes Bridge session not found: ${key}`);
    return session;
  }

  private load(): HermesBridgeStoreState {
    if (!existsSync(this.filePath)) return { version: 1, sessions: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<HermesBridgePersistedState>;
      const sessions = Array.isArray(parsed.sessions)
        ? parsed.sessions.filter(isPersistedSessionRecord).map((session) => ({ ...session, toolAliases: cleanToolAliases(session.toolAliases), messages: [] }))
        : [];
      return { version: 1, sessions };
    } catch {
      return { version: 1, sessions: [] };
    }
  }

  private save(): void {
    this.persister.schedule(() => {
      const persisted: HermesBridgePersistedState = {
        version: 1,
        sessions: this.state.sessions.map(({ key, sessionId, title, updatedAt, toolAliases }) => ({
          key,
          sessionId,
          title,
          updatedAt,
          ...(toolAliases && Object.keys(toolAliases).length ? { toolAliases } : {}),
        })),
      };
      return `${JSON.stringify(persisted, null, 2)}\n`;
    });
  }
}

function cleanToolAliases(value: unknown): NonNullable<HermesBridgeSession['toolAliases']> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([id, alias]) =>
    id.length > 0 && id.length <= 256 && isRecord(alias)
    && typeof alias.toolCallId === 'string' && alias.toolCallId.length > 0 && alias.toolCallId.length <= 256
    && (alias.toolName === undefined || (typeof alias.toolName === 'string' && alias.toolName.length <= 256)),
  ).slice(-512).map(([id, alias]) => {
    const record = alias as { toolCallId: string; toolName?: string };
    return [id, { toolCallId: record.toolCallId, ...(record.toolName ? { toolName: record.toolName } : {}) }];
  }));
}

function isPersistedSessionRecord(value: unknown): value is HermesBridgePersistedSession {
  if (!isRecord(value)) return false;
  return typeof value.key === 'string'
    && typeof value.sessionId === 'string'
    && value.sessionId.startsWith('clawket-hermes:')
    && typeof value.title === 'string'
    && typeof value.updatedAt === 'number'
    && Number.isFinite(value.updatedAt);
}
