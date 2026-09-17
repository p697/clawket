import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HermesLocalBridge as ProductionHermesLocalBridge,
  type HermesLocalBridgeOptions,
} from './index.js';
import { DEFAULT_HERMES_HOME_PATH, DEFAULT_HERMES_SOURCE_PATH } from './internal.js';
import { resolveHermesPythonPath } from './python-runner.js';

const HERMES_INTEGRATION_PYTHON_PATH = resolveHermesPythonPath({
  hermesSourcePath: DEFAULT_HERMES_SOURCE_PATH,
  hermesHomePath: DEFAULT_HERMES_HOME_PATH,
});

class HermesLocalBridge extends ProductionHermesLocalBridge {
  constructor(options: HermesLocalBridgeOptions = {}) {
    super({ ...options, hermesPythonPath: options.hermesPythonPath ?? HERMES_INTEGRATION_PYTHON_PATH });
  }
}

const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

async function createSessionStorePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'clawket-hermes-'));
  tempDirs.push(dir);
  return join(dir, 'sessions.json');
}

async function createUsageLedgerPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'clawket-hermes-usage-'));
  tempDirs.push(dir);
  return join(dir, 'usage-ledger.json');
}

async function createHermesStateDbPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'clawket-hermes-state-'));
  tempDirs.push(dir);
  return join(dir, 'state.db');
}

async function createHermesHomePath(config?: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'clawket-hermes-home-'));
  tempDirs.push(dir);
  if (config) {
    const configJson = JSON.stringify(config);
    execFileSync((process.platform === 'win32' ? 'python' : 'python3'), [
      '-c',
      [
        'import json, pathlib, sys',
        'home = pathlib.Path(sys.argv[1])',
        'cfg = json.loads(sys.argv[2])',
        'home.mkdir(parents=True, exist_ok=True)',
        'lines = []',
        'def write_mapping(mapping, indent=0):',
        '    for key, value in mapping.items():',
        '        prefix = " " * indent + f"{key}:"',
        '        if isinstance(value, dict):',
        '            lines.append(prefix)',
        '            write_mapping(value, indent + 2)',
        '        elif isinstance(value, list):',
        '            lines.append(prefix)',
        '            for item in value:',
        '                if isinstance(item, dict):',
        '                    lines.append(" " * (indent + 2) + "-")',
        '                    write_mapping(item, indent + 4)',
        '                else:',
        '                    lines.append(" " * (indent + 2) + f"- {json.dumps(item)}")',
        '        else:',
        '            lines.append(prefix + f" {json.dumps(value)}")',
        'write_mapping(cfg)',
        '(home / "config.yaml").write_text("\\n".join(lines) + "\\n", encoding="utf-8")',
      ].join('\n'),
      dir,
      configJson,
    ]);
  }
  return dir;
}


describe('Hermes history and stream integration', () => {
  it('lists Hermes native sessions from state.db and keeps bridge keys stable', async () => {
    const hermesStateDbPath = await createHermesStateDbPath();
    execFileSync((process.platform === 'win32' ? 'python' : 'python3'), [
      '-c',
      [
        'import sqlite3, sys',
        'db_path = sys.argv[1]',
        'conn = sqlite3.connect(db_path)',
        'conn.execute("""CREATE TABLE sessions (',
        '  id TEXT PRIMARY KEY, source TEXT NOT NULL, user_id TEXT, model TEXT, model_config TEXT, system_prompt TEXT,',
        '  parent_session_id TEXT, started_at REAL NOT NULL, ended_at REAL, end_reason TEXT,',
        '  message_count INTEGER DEFAULT 0, tool_call_count INTEGER DEFAULT 0,',
        '  input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0, reasoning_tokens INTEGER DEFAULT 0,',
        '  billing_provider TEXT, billing_base_url TEXT, billing_mode TEXT, estimated_cost_usd REAL, actual_cost_usd REAL, cost_status TEXT, cost_source TEXT, pricing_version TEXT, title TEXT',
        ')""")',
        'conn.execute("""CREATE TABLE messages (',
        '  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT,',
        '  tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL NOT NULL, token_count INTEGER, finish_reason TEXT, reasoning TEXT, reasoning_details TEXT, codex_reasoning_items TEXT',
        ')""")',
        'conn.execute("INSERT INTO sessions (id, source, model, billing_provider, started_at, title) VALUES (?, ?, ?, ?, ?, ?)", ("20260411_122441_d40735", "cli", "gpt-5.4", "openai", 1000, "CLI Session"))',
        'conn.execute("INSERT INTO sessions (id, source, model, billing_provider, started_at, title) VALUES (?, ?, ?, ?, ?, ?)", ("clawket-hermes:main", "api_server", "gpt-5.3-codex", "openai-codex", 1100, None))',
        'conn.execute("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)", ("20260411_122441_d40735", "assistant", "Native CLI reply", 1005))',
        'conn.execute("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)", ("clawket-hermes:main", "assistant", "Bridge reply", 1110))',
        'conn.commit()',
        'conn.close()',
      ].join('\n'),
      hermesStateDbPath,
    ]);

    const bridge = new HermesLocalBridge({
      hermesStateDbPath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    const result = await (bridge as any).dispatchRequest('sessions.list', { limit: 10 });
    expect(result).toMatchObject({
      sessions: [
        expect.objectContaining({
          key: '20260411_122441_d40735',
          sessionId: '20260411_122441_d40735',
          label: 'CLI Session',
          lastMessagePreview: 'Native CLI reply',
          source: 'native',
        }),
      ],
    });
    expect(result.sessions.map((session: { sessionId: string }) => session.sessionId))
      .not.toContain('clawket-hermes:main');
  });

  it('filters Bridge-owned namespace rows without hiding unrelated api_server sessions', async () => {
    const hermesStateDbPath = await createHermesStateDbPath();
    execFileSync((process.platform === 'win32' ? 'python' : 'python3'), [
      '-c',
      [
        'import sqlite3, sys',
        'db_path = sys.argv[1]',
        'conn = sqlite3.connect(db_path)',
        'conn.execute("""CREATE TABLE sessions (',
        '  id TEXT PRIMARY KEY, source TEXT NOT NULL, user_id TEXT, model TEXT, model_config TEXT, system_prompt TEXT,',
        '  parent_session_id TEXT, started_at REAL NOT NULL, ended_at REAL, end_reason TEXT,',
        '  message_count INTEGER DEFAULT 0, tool_call_count INTEGER DEFAULT 0,',
        '  input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0, reasoning_tokens INTEGER DEFAULT 0,',
        '  billing_provider TEXT, billing_base_url TEXT, billing_mode TEXT, estimated_cost_usd REAL, actual_cost_usd REAL, cost_status TEXT, cost_source TEXT, pricing_version TEXT, title TEXT',
        ')""")',
        'conn.execute("""CREATE TABLE messages (',
        '  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT,',
        '  tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL NOT NULL, token_count INTEGER, finish_reason TEXT, reasoning TEXT, reasoning_details TEXT, codex_reasoning_items TEXT',
        ')""")',
        'conn.execute("INSERT INTO sessions (id, source, model, billing_provider, started_at, title) VALUES (?, ?, ?, ?, ?, ?)", ("clawket-hermes:main", "api_server", "gpt-5.3-codex", "openai-codex", 1100, None))',
        'conn.execute("INSERT INTO sessions (id, source, model, billing_provider, started_at, title) VALUES (?, ?, ?, ?, ?, ?)", ("codex-debug-browser-output", "api_server", "gpt-5.4", "openai-codex", 1200, None))',
        'conn.commit()',
        'conn.close()',
      ].join('\n'),
      hermesStateDbPath,
    ]);

    const bridge = new HermesLocalBridge({
      hermesStateDbPath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    const result = await (bridge as any).dispatchRequest('sessions.list', { limit: 10 });
    expect(result).toMatchObject({
      sessions: [
        expect.objectContaining({
          key: 'codex-debug-browser-output',
          sessionId: 'codex-debug-browser-output',
          label: 'codex-debug-browser-output',
          source: 'native',
        }),
      ],
    });
    expect(result.sessions.map((session: { sessionId: string }) => session.sessionId))
      .not.toContain('clawket-hermes:main');
  });

  it('returns Hermes session context window as a shared default instead of resolving it per session row', async () => {
    const hermesStateDbPath = await createHermesStateDbPath();
    const hermesHomePath = await createHermesHomePath({
      model: {
        default: 'gpt-5.4',
        provider: 'openai-codex',
        base_url: 'https://chatgpt.com/backend-api/codex',
      },
    });
    execFileSync((process.platform === 'win32' ? 'python' : 'python3'), [
      '-c',
      [
        'import sqlite3, sys',
        'db_path = sys.argv[1]',
        'conn = sqlite3.connect(db_path)',
        'conn.execute("""CREATE TABLE sessions (',
        '  id TEXT PRIMARY KEY, source TEXT NOT NULL, user_id TEXT, model TEXT, model_config TEXT, system_prompt TEXT,',
        '  parent_session_id TEXT, started_at REAL NOT NULL, ended_at REAL, end_reason TEXT,',
        '  message_count INTEGER DEFAULT 0, tool_call_count INTEGER DEFAULT 0,',
        '  input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0, reasoning_tokens INTEGER DEFAULT 0,',
        '  billing_provider TEXT, billing_base_url TEXT, billing_mode TEXT, estimated_cost_usd REAL, actual_cost_usd REAL, cost_status TEXT, cost_source TEXT, pricing_version TEXT, title TEXT',
        ')""")',
        'conn.execute("""CREATE TABLE messages (',
        '  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT,',
        '  tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL NOT NULL, token_count INTEGER, finish_reason TEXT, reasoning TEXT, reasoning_details TEXT, codex_reasoning_items TEXT',
        ')""")',
        'conn.execute("INSERT INTO sessions (id, source, model, billing_provider, billing_base_url, started_at, title) VALUES (?, ?, ?, ?, ?, ?, ?)", ("main", "api_server", "gpt-5.4", "openai-codex", "https://chatgpt.com/backend-api/codex", 1100, None))',
        'conn.commit()',
        'conn.close()',
      ].join('\n'),
      hermesStateDbPath,
    ]);

    const bridge = new HermesLocalBridge({
      hermesHomePath,
      hermesStateDbPath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });
    vi.spyOn(bridge as any, 'resolveHermesContextWindow').mockReturnValue(1_050_000);

    const result = await (bridge as any).dispatchRequest('sessions.list', { limit: 10 });
    expect(result).toMatchObject({
      defaults: { contextTokens: 1_050_000 },
      sessions: [
        {
          key: 'main',
          sessionId: 'main',
          model: 'gpt-5.4',
          modelProvider: 'openai-codex',
        },
      ],
    });
    expect(result.sessions[0]).not.toHaveProperty('contextTokens');
  });

  it('loads Hermes native history from state.db and preserves tool calls', async () => {
    const hermesStateDbPath = await createHermesStateDbPath();
    const hermesHomePath = await createHermesHomePath();
    execFileSync((process.platform === 'win32' ? 'python' : 'python3'), [
      '-c',
      [
        'import sqlite3, sys',
        'db_path = sys.argv[1]',
        'conn = sqlite3.connect(db_path)',
        'conn.execute("""CREATE TABLE sessions (',
        '  id TEXT PRIMARY KEY, source TEXT NOT NULL, user_id TEXT, model TEXT, model_config TEXT, system_prompt TEXT,',
        '  parent_session_id TEXT, started_at REAL NOT NULL, ended_at REAL, end_reason TEXT,',
        '  message_count INTEGER DEFAULT 0, tool_call_count INTEGER DEFAULT 0,',
        '  input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0, reasoning_tokens INTEGER DEFAULT 0,',
        '  billing_provider TEXT, billing_base_url TEXT, billing_mode TEXT, estimated_cost_usd REAL, actual_cost_usd REAL, cost_status TEXT, cost_source TEXT, pricing_version TEXT, title TEXT',
        ')""")',
        'conn.execute("""CREATE TABLE messages (',
        '  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT,',
        '  tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL NOT NULL, token_count INTEGER, finish_reason TEXT, reasoning TEXT, reasoning_details TEXT, codex_reasoning_items TEXT',
        ')""")',
        'conn.execute("INSERT INTO sessions (id, source, model, billing_provider, started_at, title) VALUES (?, ?, ?, ?, ?, ?)", ("20260411_122441_d40735", "cli", "gpt-5.4", "openai", 1000, "CLI Session"))',
        'conn.execute("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)", ("20260411_122441_d40735", "user", "hello", 1001))',
        'conn.execute("INSERT INTO messages (session_id, role, content, tool_calls, timestamp) VALUES (?, ?, ?, ?, ?)", ("20260411_122441_d40735", "assistant", "working", \'[{\\"id\\":\\"call_1\\",\\"function\\":{\\"name\\":\\"search\\",\\"arguments\\":{\\"query\\":\\"hermes\\"}}}]\', 1002))',
        'conn.execute("INSERT INTO messages (session_id, role, content, tool_call_id, tool_name, timestamp) VALUES (?, ?, ?, ?, ?, ?)", ("20260411_122441_d40735", "tool", "{\\"ok\\": true}", "call_1", "search", 1003))',
        'conn.commit()',
        'conn.close()',
      ].join('\n'),
      hermesStateDbPath,
    ]);

    const bridge = new HermesLocalBridge({
      hermesStateDbPath,
      hermesHomePath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    await expect((bridge as any).dispatchRequest('chat.history', {
      sessionKey: '20260411_122441_d40735',
      limit: 50,
    })).resolves.toEqual({
      hasActiveRun: false,
      thinkingLevel: 'medium',
      sessionId: '20260411_122441_d40735',
      messages: [
        expect.objectContaining({
          role: 'user',
          content: 'hello',
        }),
        expect.objectContaining({
          role: 'assistant',
          content: [
            { type: 'text', text: 'working' },
            { type: 'toolCall', id: 'call_1', name: 'search', arguments: { query: 'hermes' } },
          ],
          model: 'gpt-5.4',
          provider: 'openai',
        }),
        expect.objectContaining({
          role: 'toolResult',
          content: '{"ok": true}',
          toolCallId: 'call_1',
          toolName: 'search',
        }),
      ],
    });
  });

  it('deduplicates bridge-appended final assistant replies when native Hermes history already has them', async () => {
    const hermesStateDbPath = await createHermesStateDbPath();
    const hermesHomePath = await createHermesHomePath();
    const sessionStorePath = await createSessionStorePath();
    const bridgeSessionId = `clawket-hermes:main:${randomUUID()}`;
    await writeFile(sessionStorePath, JSON.stringify({
      version: 1,
      sessions: [{
        key: 'main',
        sessionId: bridgeSessionId,
        title: 'Hermes',
        updatedAt: 1_000_000,
      }],
    }));
    execFileSync((process.platform === 'win32' ? 'python' : 'python3'), [
      '-c',
      [
        'import sqlite3, sys',
        'db_path, session_id = sys.argv[1:3]',
        'conn = sqlite3.connect(db_path)',
        'conn.execute("""CREATE TABLE sessions (',
        '  id TEXT PRIMARY KEY, source TEXT NOT NULL, user_id TEXT, model TEXT, model_config TEXT, system_prompt TEXT,',
        '  parent_session_id TEXT, started_at REAL NOT NULL, ended_at REAL, end_reason TEXT,',
        '  message_count INTEGER DEFAULT 0, tool_call_count INTEGER DEFAULT 0,',
        '  input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0, reasoning_tokens INTEGER DEFAULT 0,',
        '  billing_provider TEXT, billing_base_url TEXT, billing_mode TEXT, estimated_cost_usd REAL, actual_cost_usd REAL, cost_status TEXT, cost_source TEXT, pricing_version TEXT, title TEXT',
        ')""")',
        'conn.execute("""CREATE TABLE messages (',
        '  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT,',
        '  tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL NOT NULL, token_count INTEGER, finish_reason TEXT, reasoning TEXT, reasoning_details TEXT, codex_reasoning_items TEXT',
        ')""")',
        'conn.execute("INSERT INTO sessions (id, source, model, billing_provider, started_at, title) VALUES (?, ?, ?, ?, ?, ?)", (session_id, "api_server", "gpt-5.3-codex", "openai-codex", 1000, "Hermes"))',
        'conn.execute("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)", (session_id, "user", "hello", 1001))',
        'conn.execute("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)", (session_id, "assistant", "Same final reply", 1002))',
        'conn.commit()',
        'conn.close()',
      ].join('\n'),
      hermesStateDbPath,
      bridgeSessionId,
    ]);

    const bridge = new HermesLocalBridge({
      hermesStateDbPath,
      hermesHomePath,
      sessionStorePath,
      startHermesIfNeeded: false,
    });

    (bridge as any).sessionStore.appendMessage('main', {
      role: 'assistant',
      content: 'Same final reply',
      ts: 1_002_000,
      runId: 'run_dup',
    });

    await expect((bridge as any).dispatchRequest('chat.history', {
      sessionKey: 'main',
      limit: 50,
    })).resolves.toEqual({
      hasActiveRun: false,
      thinkingLevel: 'medium',
      sessionId: bridgeSessionId,
      messages: [
        expect.objectContaining({
          role: 'user',
          content: 'hello',
        }),
        expect.objectContaining({
          role: 'assistant',
          content: 'Same final reply',
          model: 'gpt-5.3-codex',
          provider: 'openai-codex',
        }),
      ],
    });
  });

  it('preserves timestamp and idempotencyKey for user history entries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ run_id: 'run_1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ));

    const bridge = new HermesLocalBridge({
      apiBaseUrl: 'http://127.0.0.1:8642',
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    await (bridge as any).handleChatSend({
      sessionKey: 'main',
      message: '你好',
      idempotencyKey: 'idem_123',
    });

    const history = await (bridge as any).dispatchRequest('chat.history', {
      sessionKey: 'main',
      limit: 50,
    });
    expect(history.sessionId).toMatch(/^clawket-hermes:main:/);
    expect(history.messages).toHaveLength(1);
    expect(history.messages[0]).toMatchObject({
      role: 'user',
      content: '你好',
      idempotencyKey: 'idem_123',
    });
    expect(history.messages[0]?.timestamp).toEqual(expect.any(Number));
    expect(history.messages[0]?.timestamp).toBeGreaterThan(0);
  });

  it('persists only Hermes session metadata to disk and never stores chat content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ run_id: 'run_1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ));

    const sessionStorePath = await createSessionStorePath();
    // Point hermesHomePath at an empty temp dir so readHermesNativeSessions
    // returns empty deterministically, regardless of the developer's local
    // ~/.hermes/state.db. Otherwise the persisted title can be either
    // 'Hermes' or 'Hermes Clawket' depending on the dev machine.
    const hermesHomePath = await mkdtemp(join(tmpdir(), 'clawket-hermes-home-'));
    tempDirs.push(hermesHomePath);
    const bridge = new HermesLocalBridge({
      apiBaseUrl: 'http://127.0.0.1:8642',
      sessionStorePath,
      hermesHomePath,
      startHermesIfNeeded: false,
    });

    await (bridge as any).handleChatSend({
      sessionKey: 'main',
      message: 'top secret prompt',
      idempotencyKey: 'idem_secret',
    });

    (bridge as any).sessionStore.appendMessage('main', {
      role: 'assistant',
      content: 'top secret reply',
      ts: 2_000,
      runId: 'run_1',
    });

    // Disk writes are debounced; force a flush so the assertions below see
    // the latest persisted content.
    await (bridge as any).sessionStore.flush();
    const persisted = await readFile(sessionStorePath, 'utf8');
    expect(persisted).not.toContain('top secret prompt');
    expect(persisted).not.toContain('top secret reply');
    expect(persisted).not.toContain('idem_secret');

    const parsed = JSON.parse(persisted) as {
      sessions?: Array<Record<string, unknown>>;
    };
    expect(parsed.sessions?.[0]).toMatchObject({
      key: 'main',
      sessionId: expect.stringMatching(/^clawket-hermes:main:/),
      // With an empty hermesHomePath there is no native state.db to read, so
      // the session falls back to the default 'Hermes' label set by
      // ensureSession. The exact label is not the focus of this test — the
      // assertion above already covers what we care about (no chat content
      // ends up on disk).
      title: 'Hermes',
    });
    expect(parsed.sessions?.[0]?.messages).toBeUndefined();

    const inMemoryHistory = (bridge as any).sessionStore.getHistory('main', 50);
    expect(inMemoryHistory.messages).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'top secret prompt',
      }),
      expect.objectContaining({
        role: 'assistant',
        content: 'top secret reply',
      }),
    ]);
  });

  it('includes assistant timestamps in history responses', async () => {
    const bridge = new HermesLocalBridge({
      apiBaseUrl: 'http://127.0.0.1:8642',
      hermesStateDbPath: await createHermesStateDbPath(),
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });
    const session = (bridge as any).sessionStore.createSession({ key: 'main' });

    (bridge as any).sessionStore.appendMessage('main', {
      role: 'assistant',
      content: 'Hello back',
      ts: 1_234,
      runId: 'run_1',
    });

    const history = await (bridge as any).dispatchRequest('chat.history', {
      sessionKey: 'main',
      limit: 50,
    });
    expect(history.messages).toEqual([
      expect.objectContaining({
        role: 'assistant',
        content: 'Hello back',
        timestamp: 1_234,
        runId: 'run_1',
      }),
    ]);
    expect(history.sessionId).toBe(session.sessionId);
  });

  it('persists tool results in history with a stable toolCallId', async () => {
    const bridge = new HermesLocalBridge({
      apiBaseUrl: 'http://127.0.0.1:8642',
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    const broadcastSpy = vi.spyOn(bridge as any, 'broadcastEvent');
    const sessionStore = (bridge as any).sessionStore;
    const session = sessionStore.createSession({ key: 'main' });

    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode([
              'data: {"event":"tool.started","timestamp":1,"tool":"search","preview":"query"}',
              '',
              'data: {"event":"tool.completed","timestamp":1.2,"tool":"search","result":{"items":["done"]},"duration":0.2}',
              '',
              'data: {"event":"run.completed","timestamp":1300,"output":"answer"}',
              '',
            ].join('\n')),
          );
          controller.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )));

    await (bridge as any).streamRunEvents(
      'run_1',
      'main',
      session.sessionId,
      900,
      new AbortController().signal,
    );

    const toolEvents = broadcastSpy.mock.calls
      .filter(([eventName]) => eventName === 'agent')
      .map(([, payload]) => payload)
      .filter((payload) => (payload as any).stream === 'tool');
    expect(toolEvents).toHaveLength(2);
    expect((toolEvents[0] as any).data.toolCallId).toBe((toolEvents[1] as any).data.toolCallId);
    expect((toolEvents[1] as any).data.output).toBe('{\n  "items": [\n    "done"\n  ]\n}');

    const history = await (bridge as any).dispatchRequest('chat.history', {
      sessionKey: 'main',
      limit: 50,
    });
    expect(history.messages).toContainEqual(expect.objectContaining({
      role: 'toolResult',
      content: '{\n  "items": [\n    "done"\n  ]\n}',
      timestamp: 1200,
      runId: 'run_1',
      idempotencyKey: undefined,
      toolName: 'search',
      toolCallId: 'run_1:tool:1',
      isError: false,
      toolArgs: 'query',
      toolDurationMs: 200,
      toolStartedAt: 1000,
      toolFinishedAt: 1200,
    }));
  });

  it('hydrates missing tool output from local Hermes state without changing Hermes source', async () => {
    const hermesStateDbPath = await createHermesStateDbPath();
    execFileSync((process.platform === 'win32' ? 'python' : 'python3'), [
      '-c',
      [
        'import json, sqlite3, sys',
        'db_path = sys.argv[1]',
        'conn = sqlite3.connect(db_path)',
        'conn.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, tool_call_id TEXT, tool_name TEXT, tool_calls TEXT, timestamp REAL)")',
        'tool_calls = json.dumps([{',
        '  "id": "call_123",',
        '  "function": {"name": "browser_navigate", "arguments": "{\\"url\\":\\"https://example.com\\"}"}',
        '}])',
        'conn.execute("INSERT INTO messages (session_id, role, content, tool_call_id, tool_name, tool_calls, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)", ("clawket-hermes:main", "assistant", "", None, None, tool_calls, 1.10))',
        'conn.execute("INSERT INTO messages (session_id, role, content, tool_call_id, tool_name, tool_calls, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)", ("clawket-hermes:main", "tool", "{\\"success\\":true,\\"snapshot\\":\\"Example Domain\\"}", "call_123", None, None, 1.35))',
        'conn.commit()',
        'conn.close()',
      ].join('\n'),
      hermesStateDbPath,
    ]);

    const bridge = new HermesLocalBridge({
      apiBaseUrl: 'http://127.0.0.1:8642',
      sessionStorePath: await createSessionStorePath(),
      hermesStateDbPath,
      startHermesIfNeeded: false,
    });

    const broadcastSpy = vi.spyOn(bridge as any, 'broadcastEvent');
    const sessionStore = (bridge as any).sessionStore;
    sessionStore.createSession({ key: 'main' });

    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode([
              'data: {"event":"tool.started","timestamp":1,"tool":"browser_navigate","preview":"https://example.com"}',
              '',
              'data: {"event":"tool.completed","timestamp":1.2,"tool":"browser_navigate","duration":0.2}',
              '',
              'data: {"event":"run.completed","timestamp":1300,"output":"DONE"}',
              '',
            ].join('\n')),
          );
          controller.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )));

    await (bridge as any).streamRunEvents('run_1', 'main', 'clawket-hermes:main', 900, new AbortController().signal);

    const history = sessionStore.getHistory('main', 50);
    expect(history.messages).toContainEqual(expect.objectContaining({
      role: 'toolResult',
      toolName: 'browser_navigate',
      toolCallId: 'run_1:tool:1',
      content: '{"success":true,"snapshot":"Example Domain"}',
    }));

    const hydratedResultEvent = broadcastSpy.mock.calls
      .filter(([eventName]) => eventName === 'agent')
      .map(([, payload]) => payload)
      .find((payload) => (payload as any).stream === 'tool'
        && (payload as any).data.phase === 'result'
        && (payload as any).data.output === '{"success":true,"snapshot":"Example Domain"}');
    expect(hydratedResultEvent).toBeTruthy();
  });

  it('finalizes a run when the Hermes events stream ends after assistant deltas without a terminal event', async () => {
    const bridge = new HermesLocalBridge({
      apiBaseUrl: 'http://127.0.0.1:8642',
      hermesStateDbPath: await createHermesStateDbPath(),
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    const broadcastSpy = vi.spyOn(bridge as any, 'broadcastEvent');
    const session = (bridge as any).sessionStore.createSession({ key: 'main' });

    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode([
              'data: {"event":"message.delta","timestamp":1000,"delta":"Hello"}',
              '',
              'data: {"event":"message.delta","timestamp":1100,"delta":" world"}',
              '',
              '',
            ].join('\n')),
          );
          controller.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )));

    await (bridge as any).streamRunEvents(
      'run_1',
      'main',
      session.sessionId,
      900,
      new AbortController().signal,
    );

    const chatEvents = broadcastSpy.mock.calls
      .filter(([eventName]) => eventName === 'chat')
      .map(([, payload]) => payload);
    expect(chatEvents).toEqual([
      expect.objectContaining({
        runId: 'run_1',
        sessionKey: 'main',
        seq: 1,
        state: 'delta',
        message: { role: 'assistant', content: 'Hello' },
      }),
      expect.objectContaining({
        runId: 'run_1',
        sessionKey: 'main',
        seq: 2,
        state: 'delta',
        message: { role: 'assistant', content: 'world' },
      }),
      expect.objectContaining({
        runId: 'run_1',
        sessionKey: 'main',
        seq: 3,
        state: 'final',
        message: { role: 'assistant', content: 'Helloworld' },
      }),
    ]);
  });

  it('finalizes a run when the Hermes events stream ends after tool completion without a terminal event', async () => {
    const bridge = new HermesLocalBridge({
      apiBaseUrl: 'http://127.0.0.1:8642',
      hermesStateDbPath: await createHermesStateDbPath(),
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    const broadcastSpy = vi.spyOn(bridge as any, 'broadcastEvent');
    const session = (bridge as any).sessionStore.createSession({ key: 'main' });

    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode([
              'data: {"event":"tool.started","timestamp":1,"tool":"search","preview":"query"}',
              '',
              'data: {"event":"tool.completed","timestamp":1.2,"tool":"search","result":{"items":["done"]},"duration":0.2}',
              '',
              '',
            ].join('\n')),
          );
          controller.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )));

    await (bridge as any).streamRunEvents(
      'run_1',
      'main',
      session.sessionId,
      900,
      new AbortController().signal,
    );

    const chatEvents = broadcastSpy.mock.calls
      .filter(([eventName]) => eventName === 'chat')
      .map(([, payload]) => payload);
    expect(chatEvents.at(-1)).toEqual(expect.objectContaining({
      runId: 'run_1',
      sessionKey: 'main',
      seq: 1,
      state: 'final',
    }));
  });

  it('emits an error when the Hermes events stream ends without recoverable output or tool results', async () => {
    const bridge = new HermesLocalBridge({
      apiBaseUrl: 'http://127.0.0.1:8642',
      hermesStateDbPath: await createHermesStateDbPath(),
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    const broadcastSpy = vi.spyOn(bridge as any, 'broadcastEvent');

    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )));

    await (bridge as any).streamRunEvents(
      'run_1',
      'main',
      'clawket-hermes:main',
      900,
      new AbortController().signal,
    );

    const chatEvents = broadcastSpy.mock.calls
      .filter(([eventName]) => eventName === 'chat')
      .map(([, payload]) => payload);
    expect(chatEvents).toEqual([
      expect.objectContaining({
        runId: 'run_1',
        sessionKey: 'main',
        seq: 1,
        state: 'error',
        errorMessage: 'Hermes events stream ended before a terminal event was received.',
      }),
    ]);
  });

  it('requests upstream stop and aborts bridge-side Hermes streams for a session', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/v1/runs/run_abort/stop')) return new Response('{"status":"stopping"}');
      if (url.endsWith('/v1/runs')) {
        return new Response(JSON.stringify({ run_id: 'run_abort' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/v1/runs/run_abort/events')) {
        return await new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const bridge = new HermesLocalBridge({
      apiBaseUrl: 'http://127.0.0.1:8642',
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    const broadcastSpy = vi.spyOn(bridge as any, 'broadcastEvent');

    await (bridge as any).handleChatSend({
      sessionKey: 'main',
      message: 'abort me',
    });
    await Promise.resolve();

    const abortResult = await (bridge as any).dispatchRequest('chat.abort', { sessionKey: 'main' });
    expect(abortResult).toEqual({
      ok: true,
      abortedRunIds: ['run_abort'],
      upstreamCancelled: false,
    });

    await Promise.resolve();

    const abortedEvent = broadcastSpy.mock.calls.find(([eventName, payload]) =>
      eventName === 'chat'
      && (payload as any).state === 'aborted'
      && (payload as any).runId === 'run_abort',
    );
    expect(abortedEvent).toBeTruthy();
    expect((bridge as any).activeRuns.size).toBe(0);
  });
});
