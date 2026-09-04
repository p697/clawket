import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDirectories: string[] = [];

export async function createTempDirectory(prefix = 'clawket-hermes-test-'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  tempDirectories.push(directory);
  return directory;
}

export async function cleanupTempDirectories(): Promise<void> {
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

export function initializeHermesStateDb(
  dbPath: string,
  sessions: Array<{ id: string; title?: string; source?: string }> = [],
  messages: Array<{
    sessionId: string;
    role: string;
    content: string;
    timestamp: number;
    toolCallId?: string;
    toolName?: string;
  }> = [],
): void {
  execFileSync('python3', ['-c', STATE_DB_SCRIPT, dbPath, JSON.stringify({ sessions, messages })]);
}

export function appendHermesMessage(
  dbPath: string,
  message: { sessionId: string; role: string; content: string; timestamp: number },
): void {
  execFileSync('python3', [
    '-c',
    [
      'import json, sqlite3, sys',
      'db_path, raw = sys.argv[1], sys.argv[2]',
      'item = json.loads(raw)',
      'conn = sqlite3.connect(db_path)',
      'conn.execute("INSERT INTO messages(session_id, role, content, timestamp) VALUES (?, ?, ?, ?)", (item["sessionId"], item["role"], item["content"], item["timestamp"]))',
      'conn.commit()',
      'conn.close()',
    ].join('\n'),
    dbPath,
    JSON.stringify(message),
  ]);
}

const STATE_DB_SCRIPT = [
  'import json, sqlite3, sys',
  'db_path, raw = sys.argv[1], sys.argv[2]',
  'payload = json.loads(raw)',
  'conn = sqlite3.connect(db_path)',
  'conn.executescript("""',
  'CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, model TEXT, billing_provider TEXT, billing_base_url TEXT, title TEXT, started_at REAL, ended_at REAL, message_count INTEGER DEFAULT 0, tool_call_count INTEGER DEFAULT 0, input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0, estimated_cost_usd REAL DEFAULT 0, actual_cost_usd REAL DEFAULT 0, cost_status TEXT, cost_source TEXT);',
  'CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL, finish_reason TEXT);',
  '""")',
  'for item in payload.get("sessions", []):',
  ' conn.execute("INSERT INTO sessions(id, source, title, started_at, ended_at) VALUES (?, ?, ?, ?, ?)", (item["id"], item.get("source", "cli"), item.get("title"), 1, 1))',
  'for item in payload.get("messages", []):',
  ' conn.execute("INSERT INTO messages(session_id, role, content, tool_call_id, tool_name, timestamp) VALUES (?, ?, ?, ?, ?, ?)", (item["sessionId"], item["role"], item["content"], item.get("toolCallId"), item.get("toolName"), item["timestamp"]))',
  'conn.commit()',
  'conn.close()',
].join('\n');
