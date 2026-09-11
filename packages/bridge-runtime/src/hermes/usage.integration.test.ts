import { execFileSync } from 'node:child_process';
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


describe('Hermes usage integration', () => {
  it('aggregates Hermes usage and cost from state.db without modifying Hermes source', async () => {
    const hermesStateDbPath = await createHermesStateDbPath();
    execFileSync((process.platform === 'win32' ? 'python' : 'python3'), [
      '-c',
      [
        'import datetime',
        'import sqlite3, sys',
        'db_path = sys.argv[1]',
        'started_at = datetime.datetime(2026, 4, 10, 12, 0, 0).timestamp()',
        'ended_at = started_at + 60',
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
        '  tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL NOT NULL',
        ')""")',
        'conn.execute("INSERT INTO sessions (id, source, model, started_at, ended_at, title, message_count, tool_call_count, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, estimated_cost_usd, actual_cost_usd, cost_status, cost_source, billing_provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ("sess_1", "api_server", "gpt-5.4", started_at, ended_at, "Today Session", 2, 1, 1000, 500, 200, 100, 1.8, None, "estimated", "pricing", "openai"))',
        'conn.execute("INSERT INTO messages (session_id, role, content, tool_calls, timestamp) VALUES (?, ?, ?, ?, ?)", ("sess_1", "user", "hello", None, started_at + 1))',
        'conn.execute("INSERT INTO messages (session_id, role, content, tool_calls, timestamp) VALUES (?, ?, ?, ?, ?)", ("sess_1", "assistant", "working", \'[{\\"id\\":\\"call_1\\",\\"function\\":{\\"name\\":\\"search\\",\\"arguments\\":\\"{}\\"}}]\', started_at + 2))',
        'conn.execute("INSERT INTO messages (session_id, role, content, tool_call_id, tool_name, timestamp) VALUES (?, ?, ?, ?, ?, ?)", ("sess_1", "tool", "{\\"ok\\": true}", "call_1", "search", started_at + 3))',
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

    await expect((bridge as any).dispatchRequest('sessions.usage', {
      startDate: '2026-04-10',
      endDate: '2026-04-10',
    })).resolves.toMatchObject({
      startDate: '2026-04-10',
      endDate: '2026-04-10',
      costPresentation: {
        mode: 'estimated',
      },
      totals: {
        totalTokens: 1800,
        totalCost: 1.8,
      },
      aggregates: {
        messages: {
          total: 3,
          user: 1,
          assistant: 1,
          toolCalls: 1,
          toolResults: 1,
        },
        tools: {
          totalCalls: 1,
          uniqueTools: 1,
          tools: [{ name: 'search', count: 1 }],
        },
      },
      sessions: [
        expect.objectContaining({
          key: 'sess_1',
          label: 'Today Session',
          channel: 'api_server',
          model: 'gpt-5.4',
          modelProvider: 'openai',
          usage: expect.objectContaining({
            totalTokens: 1800,
            totalCost: 1.8,
            costStatus: 'estimated',
          }),
        }),
      ],
    });

    await expect((bridge as any).dispatchRequest('usage.cost', {
      startDate: '2026-04-10',
      endDate: '2026-04-10',
    })).resolves.toMatchObject({
      costPresentation: {
        mode: 'estimated',
      },
      totals: {
        totalTokens: 1800,
        totalCost: 1.8,
      },
      daily: [
        expect.objectContaining({
          date: '2026-04-10',
          totalTokens: 1800,
          totalCost: 1.8,
        }),
      ],
    });
  });

  it('uses the Clawket Hermes usage ledger for long-lived sessions that started before today', async () => {
    const hermesStateDbPath = await createHermesStateDbPath();
    const usageLedgerPath = await createUsageLedgerPath();
    execFileSync((process.platform === 'win32' ? 'python' : 'python3'), [
      '-c',
      [
        'import datetime',
        'import sqlite3, sys',
        'db_path = sys.argv[1]',
        'started_at = datetime.datetime(2026, 4, 10, 21, 5, 34).timestamp()',
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
        '  tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL NOT NULL',
        ')""")',
        'conn.execute("INSERT INTO sessions (id, source, model, started_at, title, input_tokens, output_tokens, cache_read_tokens, estimated_cost_usd, cost_status, cost_source, billing_provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ("clawket-hermes:agent:main:main", "api_server", "gpt-5.4", started_at, "Hermes", 1200, 300, 100, 0.0, "included", "none", "openai-codex"))',
        'conn.execute("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)", ("clawket-hermes:agent:main:main", "user", "today hello", datetime.datetime(2026, 4, 12, 10, 21, 9).timestamp()))',
        'conn.execute("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)", ("clawket-hermes:agent:main:main", "assistant", "today reply", datetime.datetime(2026, 4, 12, 10, 21, 15).timestamp()))',
        'conn.commit()',
        'conn.close()',
      ].join('\n'),
      hermesStateDbPath,
    ]);
    await writeFile(usageLedgerPath, JSON.stringify({
      version: 1,
      snapshots: {
        'clawket-hermes:agent:main:main': {
          sessionId: 'clawket-hermes:agent:main:main',
          key: 'main',
          label: 'Hermes',
          agentId: 'main',
          channel: 'api_server',
          model: 'gpt-5.4',
          modelProvider: 'openai-codex',
          costStatus: 'included',
          costSource: 'none',
          updatedAt: 1775962074000,
          startedAtMs: 1775826334000,
          totals: {
            input: 1200,
            output: 300,
            cacheRead: 100,
            cacheWrite: 0,
            totalTokens: 1600,
            totalCost: 0,
            inputCost: 0,
            outputCost: 0,
            cacheReadCost: 0,
            cacheWriteCost: 0,
            missingCostEntries: 0,
          },
        },
      },
      days: {
        '2026-04-12': {
          date: '2026-04-12',
          sessions: {
            'clawket-hermes:agent:main:main': {
              key: 'main',
              label: 'Hermes',
              agentId: 'main',
              channel: 'api_server',
              model: 'gpt-5.4',
              modelProvider: 'openai-codex',
              costStatus: 'included',
              costSource: 'none',
              updatedAt: 1775962074000,
              totals: {
                input: 120,
                output: 30,
                cacheRead: 10,
                cacheWrite: 0,
                totalTokens: 160,
                totalCost: 0,
                inputCost: 0,
                outputCost: 0,
                cacheReadCost: 0,
                cacheWriteCost: 0,
                missingCostEntries: 0,
              },
            },
          },
        },
      },
    }, null, 2), 'utf8');

    const bridge = new HermesLocalBridge({
      hermesStateDbPath,
      usageLedgerPath,
      sessionStorePath: await createSessionStorePath(),
      startHermesIfNeeded: false,
    });

    await expect((bridge as any).dispatchRequest('sessions.usage', {
      startDate: '2026-04-12',
      endDate: '2026-04-12',
    })).resolves.toMatchObject({
      totals: {
        totalTokens: 160,
        totalCost: 0,
      },
      costPresentation: {
        mode: 'included',
      },
      sessions: [
        expect.objectContaining({
          key: 'clawket-hermes:agent:main:main',
          usage: expect.objectContaining({
            totalTokens: 160,
            totalCost: 0,
            costStatus: 'included',
          }),
        }),
      ],
    });

    await expect((bridge as any).dispatchRequest('usage.cost', {
      startDate: '2026-04-12',
      endDate: '2026-04-12',
    })).resolves.toMatchObject({
      totals: {
        totalTokens: 160,
        totalCost: 0,
      },
      daily: [
        expect.objectContaining({
          date: '2026-04-12',
          totalTokens: 160,
          totalCost: 0,
        }),
      ],
      costPresentation: {
        mode: 'included',
      },
    });
  });

});
