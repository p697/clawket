import { hermesToolResultFailed } from './tool-result.js';
import { existsSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { HermesPythonRunner } from './python-runner.js';
import {
  NATIVE_SESSION_ACTIONS,
  type HermesBridgeSessionMessage,
  type HermesSessionListEntry,
} from './session-store.js';
import { isRecord, readBoolean, readNumber, readString } from './internal.js';

const BRIDGE_SESSION_PREFIX = 'clawket-hermes:';

export type HermesHistoryMessage = {
  role: string;
  content: unknown;
  timestamp: number;
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
  model?: string;
  provider?: string;
  _cursorId?: string;
  _nativeId?: string;
  _nativeBoundaryId?: string;
  _imageCount?: number;
};

export type HermesNativeHistory = {
  sessionId: string;
  title: string;
  updatedAt: number;
  messages: HermesHistoryMessage[];
};

export type HermesHistoryCursor = {
  version: 1;
  sessionId: string;
  beforeTimestamp: number;
  beforeId: string;
};

export function encodeHermesHistoryCursor(cursor: HermesHistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeHermesHistoryCursor(raw: unknown, sessionId: string): HermesHistoryCursor | null {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') throw new Error('chat.history cursor must be a string.');
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (!isRecord(parsed)
      || parsed.version !== 1
      || parsed.sessionId !== sessionId
      || typeof parsed.beforeTimestamp !== 'number'
      || !Number.isFinite(parsed.beforeTimestamp)
      || typeof parsed.beforeId !== 'string'
      || !parsed.beforeId) {
      throw new Error('invalid cursor payload');
    }
    return parsed as HermesHistoryCursor;
  } catch {
    throw new Error('chat.history cursor is invalid or belongs to another session.');
  }
}

export function normalizeHermesHistoryContent(content: unknown): string {
  if (typeof content === 'string') return content.replace(/\s+/g, ' ').trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((entry) => {
      if (!isRecord(entry)) return '';
      const type = readString(entry.type)?.toLowerCase();
      if (type === 'text') return readString(entry.text) || '';
      if (type === 'toolcall') {
        return JSON.stringify({
          type,
          id: readString(entry.id) || null,
          name: readString(entry.name) || null,
          arguments: entry.arguments ?? null,
        });
      }
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();
}

export class HermesNativeSessionReader {
  private warnings: string[] = [];

  constructor(
    private readonly stateDbPath: string,
    private readonly python: HermesPythonRunner,
  ) {}

  consumeWarnings(): string[] {
    const warnings = this.warnings;
    this.warnings = [];
    return warnings;
  }

  async listSessions(limit: number, isActive: (key: string) => boolean = () => false): Promise<HermesSessionListEntry[]> {
    if (!existsSync(this.stateDbPath)) return [];
    try {
      const parsed = (await this.python.run<unknown>(LIST_SESSIONS_SCRIPT, {
        dbPath: this.stateDbPath,
        limit: Math.max(1, limit),
        excludedPrefix: BRIDGE_SESSION_PREFIX,
      }));
      if (!Array.isArray(parsed)) throw new Error('native session query returned a non-array payload');
      return parsed.flatMap((entry) => {
        const normalized = normalizeNativeSessionEntry(entry, isActive);
        return normalized ? [normalized] : [];
      });
    } catch (error) {
      this.warn(`Hermes native sessions are unavailable (read-only query failed): ${formatReaderError(error)}`);
      return [];
    }
  }

  async findSession(key: string, isActive: (key: string) => boolean = () => false): Promise<HermesSessionListEntry | null> {
    if (!key || key.startsWith(BRIDGE_SESSION_PREFIX) || !existsSync(this.stateDbPath)) return null;
    try {
      const parsed = (await this.python.run<unknown>(FIND_SESSION_SCRIPT, {
        dbPath: this.stateDbPath,
        sessionId: key,
      }));
      return normalizeNativeSessionEntry(parsed, isActive);
    } catch (error) {
      this.warn(`Hermes native session lookup is unavailable (read-only query failed): ${formatReaderError(error)}`);
      return null;
    }
  }

  async readHistoryBySessionId(sessionId: string): Promise<HermesNativeHistory | null> {
    if (!existsSync(this.stateDbPath)) return null;
    try {
      const parsed = (await this.python.run<unknown>(READ_HISTORY_SCRIPT, {
        dbPath: this.stateDbPath,
        sessionId,
      }));
      if (parsed == null) return null;
      if (!isRecord(parsed)) throw new Error('native history query returned a malformed payload');
      const resolvedSessionId = readString(parsed.sessionId);
      if (!resolvedSessionId || resolvedSessionId !== sessionId) return null;
      return {
        sessionId: resolvedSessionId,
        title: readString(parsed.title) || sessionId,
        updatedAt: readNumber(parsed.updatedAt) ?? 0,
        messages: normalizeHistoryMessages(parsed.messages),
      };
    } catch (error) {
      this.warn(`Hermes native history is unavailable (read-only query failed): ${formatReaderError(error)}`);
      return null;
    }
  }

  private warn(message: string): void {
    if (!this.warnings.includes(message)) this.warnings.push(message);
  }
}

function normalizeNativeSessionEntry(
  entry: unknown,
  isActive: (key: string) => boolean,
): HermesSessionListEntry | null {
  if (!isRecord(entry)) return null;
  const key = readString(entry.key);
  const sessionId = readString(entry.sessionId);
  if (!key || !sessionId || sessionId.startsWith(BRIDGE_SESSION_PREFIX)) return null;
  const title = readString(entry.title) || key;
  const preview = readString(entry.lastMessagePreview) || '';
  return {
    key,
    sessionId,
    title,
    label: title,
    updatedAt: readNumber(entry.updatedAt) ?? 0,
    lastMessagePreview: preview,
    preview,
    channel: readString(entry.channel) || undefined,
    model: readString(entry.model) || undefined,
    modelProvider: readString(entry.modelProvider) || undefined,
    source: 'native',
    kind: key === 'main' ? 'main' : 'direct',
    hasActiveRun: isActive(key),
    allowedActions: { ...NATIVE_SESSION_ACTIONS },
    warnings: [],
  };
}

function normalizeHistoryMessages(value: unknown): HermesHistoryMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const role = readString(entry.role);
    const timestamp = readNumber(entry.timestamp);
    if (!role || timestamp == null) return [];
    return [{
      role,
      content: entry.content ?? '',
      timestamp,
      toolName: readString(entry.toolName) || undefined,
      toolCallId: readString(entry.toolCallId) || undefined,
      isError: entry.role === 'toolResult'
        ? readBoolean(entry.isError) === true || hermesToolResultFailed(entry.content)
        : readBoolean(entry.isError) ?? undefined,
      model: readString(entry.model) || undefined,
      provider: readString(entry.provider) || undefined,
      _cursorId: readString(entry._cursorId) || undefined,
      _nativeId: readString(entry._nativeId) || undefined,
    }];
  });
}

function formatReaderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const READ_ONLY_DB_PREAMBLE = [
  'import json, pathlib, sqlite3, sys',
  'payload = json.loads(sys.stdin.read() or "{}")',
  'db_path = str(payload.get("dbPath") or "")',
  'db_uri = pathlib.Path(db_path).resolve().as_uri() + "?mode=ro"',
  'conn = sqlite3.connect(db_uri, uri=True)',
  'conn.execute("PRAGMA query_only = ON")',
  'conn.row_factory = sqlite3.Row',
  'cur = conn.cursor()',
];

const LIST_SESSIONS_SCRIPT = [
  ...READ_ONLY_DB_PREAMBLE,
  'limit = max(1, int(payload.get("limit") or 1))',
  'excluded_prefix = str(payload.get("excludedPrefix") or "")',
  'cur.execute("""',
  'SELECT s.id, s.source, s.model, s.billing_provider, s.title,',
  ' COALESCE((SELECT MAX(m.timestamp) FROM messages m WHERE m.session_id=s.id), s.ended_at, s.started_at, 0) AS updated_ts,',
  ' COALESCE((SELECT m.content FROM messages m WHERE m.session_id=s.id AND m.content IS NOT NULL AND TRIM(m.content) != "" ORDER BY m.timestamp DESC, m.id DESC LIMIT 1), "") AS last_message_preview',
  'FROM sessions s WHERE (? = "" OR s.id NOT LIKE ?)',
  'ORDER BY updated_ts DESC, s.started_at DESC LIMIT ?',
  '""", (excluded_prefix, excluded_prefix + "%", limit))',
  'rows = []',
  'for row in cur.fetchall():',
  ' session_id = str(row["id"] or "")',
  ' title = str(row["title"] or "").strip() or ("Hermes" if session_id == "main" else session_id)',
  ' rows.append({"key":session_id,"sessionId":session_id,"title":title,"updatedAt":int(float(row["updated_ts"] or 0)*1000),"lastMessagePreview":str(row["last_message_preview"] or ""),"channel":str(row["source"] or "") or None,"model":str(row["model"] or "") or None,"modelProvider":str(row["billing_provider"] or "") or None})',
  'print(json.dumps(rows))',
].join('\n');

const FIND_SESSION_SCRIPT = [
  ...READ_ONLY_DB_PREAMBLE,
  'session_id = str(payload.get("sessionId") or "")',
  'cur.execute("""',
  'SELECT s.id, s.source, s.model, s.billing_provider, s.title,',
  ' COALESCE((SELECT MAX(m.timestamp) FROM messages m WHERE m.session_id=s.id), s.ended_at, s.started_at, 0) AS updated_ts,',
  ' COALESCE((SELECT m.content FROM messages m WHERE m.session_id=s.id AND m.content IS NOT NULL AND TRIM(m.content) != "" ORDER BY m.timestamp DESC, m.id DESC LIMIT 1), "") AS last_message_preview',
  'FROM sessions s WHERE s.id = ? LIMIT 1',
  '""", (session_id,))',
  'row = cur.fetchone()',
  'if row is None: print("null"); raise SystemExit(0)',
  'title = str(row["title"] or "").strip() or ("Hermes" if session_id == "main" else session_id)',
  'print(json.dumps({"key":session_id,"sessionId":session_id,"title":title,"updatedAt":int(float(row["updated_ts"] or 0)*1000),"lastMessagePreview":str(row["last_message_preview"] or ""),"channel":str(row["source"] or "") or None,"model":str(row["model"] or "") or None,"modelProvider":str(row["billing_provider"] or "") or None}))',
].join('\n');

const READ_HISTORY_SCRIPT = [
  ...READ_ONLY_DB_PREAMBLE,
  'import ast, re',
  'def bridge_tool_blocks(content):',
  ' if len(content) > 262144 or not content.startswith("[{\'type\': \'toolCall\'"): return None',
  ' try: blocks = ast.literal_eval(content)',
  ' except (ValueError, SyntaxError, RecursionError, MemoryError): return None',
  ' if not isinstance(blocks, list) or not 1 <= len(blocks) <= 64: return None',
  ' for block in blocks:',
  '  if not isinstance(block, dict) or block.get("type") != "toolCall": return None',
  '  if not re.fullmatch(r"run_[0-9a-f]{32}:tool:[0-9]+", str(block.get("id") or "")): return None',
  '  if not isinstance(block.get("name"), str) or not block["name"] or not isinstance(block.get("arguments"), (str, dict)): return None',
  ' return blocks',
  'session_id = str(payload.get("sessionId") or "")',
  'cur.execute("""SELECT id, title, model, billing_provider, COALESCE((SELECT MAX(m.timestamp) FROM messages m WHERE m.session_id=sessions.id), ended_at, started_at, 0) AS updated_ts FROM sessions WHERE id=? LIMIT 1""", (session_id,))',
  'row = cur.fetchone()',
  'if row is None: print("null"); raise SystemExit(0)',
  'cur.execute("""SELECT id, role, content, tool_call_id, tool_calls, tool_name, timestamp, finish_reason FROM messages WHERE session_id=? ORDER BY timestamp ASC, id ASC""", (session_id,))',
  'messages = []',
  'for message in cur.fetchall():',
  ' role = str(message["role"] or "")',
  ' timestamp = int(float(message["timestamp"] or 0)*1000)',
  ' content = str(message["content"] or "")',
  ' if role == "assistant":',
  '  blocks = []',
  '  recovered = bridge_tool_blocks(content) if not message["tool_calls"] else None',
  '  if recovered: blocks.extend(recovered)',
  '  elif content.strip(): blocks.append({"type":"text","text":content})',
  '  try: tool_calls = json.loads(message["tool_calls"] or "[]")',
  '  except Exception: tool_calls = []',
  '  for call in tool_calls if isinstance(tool_calls, list) else []:',
  '   if not isinstance(call, dict): continue',
  '   fn = call.get("function") if isinstance(call.get("function"), dict) else {}',
  '   blocks.append({"type":"toolCall","id":call.get("id") or call.get("call_id"),"name":fn.get("name") or call.get("name"),"arguments":fn.get("arguments")})',
  ' cursor_id = "native:" + str(message["id"]).zfill(20)',
  ' if role == "assistant":',
  '  if blocks: messages.append({"role":"assistant","content":blocks if len(blocks)>1 or any(b.get("type")=="toolCall" for b in blocks) else blocks[0].get("text", ""),"timestamp":timestamp,"model":str(row["model"] or "") or None,"provider":str(row["billing_provider"] or "") or None,"_cursorId":cursor_id,"_nativeId":str(message["id"])})',
  ' elif role == "tool": messages.append({"role":"toolResult","content":content,"timestamp":timestamp,"toolCallId":message["tool_call_id"] or None,"toolName":message["tool_name"] or None,"_cursorId":cursor_id,"_nativeId":str(message["id"])})',
  ' elif role in ("user", "system"): messages.append({"role":role,"content":content,"timestamp":timestamp,"_cursorId":cursor_id,"_nativeId":str(message["id"])})',
  'title = str(row["title"] or "").strip() or ("Hermes" if session_id == "main" else session_id)',
  'print(json.dumps({"sessionId":session_id,"title":title,"updatedAt":int(float(row["updated_ts"] or 0)*1000),"messages":messages}))',
].join('\n');
