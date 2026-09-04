import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HermesLocalBridge } from './hermes/index.js';

const FIXTURE_ROOT = new URL('../../../tests/fixtures/hermes/', import.meta.url);
const HERMES_SOURCE_COMMIT = '7d426e6536910c5fedb7cd4a9a9010527b264de1';

type JsonRecord = Record<string, unknown>;

type RecordedPacket = {
  label: string;
  request: JsonRecord;
  expect: unknown;
  captureValues?: Record<string, string>;
};

type FixtureProvenance = {
  schema: string;
  source: { repository: string; commit: string; evidence: string[] };
  recordedAt: string;
  sanitization: string;
  capture: { kind: string; realDevice: boolean; note: string };
};

type NativeStateFixture = {
  sessions: Array<{
    id: string;
    source: string;
    model: string;
    billingProvider: string;
    startedAt: number;
    title: string;
  }>;
  messages: Array<{
    id: number;
    sessionId: string;
    role: string;
    content: string;
    timestamp: number;
  }>;
};

type MultiSessionFixture = FixtureProvenance & {
  nativeState: NativeStateFixture;
  firstFrame: unknown;
  packets: RecordedPacket[];
  assertions: {
    notEqualCaptures: Array<[string, string]>;
    historyOrder: string[];
  };
};

type AttachmentFixture = FixtureProvenance & {
  firstFrame: unknown;
  setup: {
    sessionKey: string;
    title: string;
    priorMessages: Array<{
      role: 'user' | 'assistant' | 'system' | 'toolResult';
      content: string;
      ts: number;
    }>;
  };
  sendPacket: RecordedPacket;
  expectedHermesRunBody: unknown;
  abortPacket: RecordedPacket;
  abortedEvent: unknown;
};

type FrameWaiter = {
  predicate: (frame: JsonRecord) => boolean;
  resolve: (frame: JsonRecord) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

class RecordedPacketClient {
  private readonly inbox: JsonRecord[] = [];
  private readonly waiters: FrameWaiter[] = [];

  constructor(readonly socket: WebSocket) {
    socket.on('message', (data) => {
      const frame = JSON.parse(data.toString()) as JsonRecord;
      const waiterIndex = this.waiters.findIndex((waiter) => waiter.predicate(frame));
      if (waiterIndex < 0) {
        this.inbox.push(frame);
        return;
      }
      const [waiter] = this.waiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(frame);
    });
    socket.on('error', (error) => {
      for (const waiter of this.waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    });
  }

  async request(request: JsonRecord): Promise<JsonRecord> {
    const id = request.id;
    const response = this.next((frame) => frame.type === 'res' && frame.id === id);
    this.socket.send(JSON.stringify(request));
    return response;
  }

  next(predicate: (frame: JsonRecord) => boolean): Promise<JsonRecord> {
    const frameIndex = this.inbox.findIndex(predicate);
    if (frameIndex >= 0) {
      return Promise.resolve(this.inbox.splice(frameIndex, 1)[0]);
    }
    return new Promise<JsonRecord>((resolve, reject) => {
      const waiter: FrameWaiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          const waiterIndex = this.waiters.indexOf(waiter);
          if (waiterIndex >= 0) this.waiters.splice(waiterIndex, 1);
          reject(new Error('Timed out waiting for recorded Hermes packet.'));
        }, 5_000),
      };
      this.waiters.push(waiter);
    });
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const closed = new Promise<void>((resolve) => this.socket.once('close', () => resolve()));
    this.socket.close();
    await Promise.race([
      closed,
      new Promise<void>((resolve) => setTimeout(resolve, 500)),
    ]);
  }
}

const bridges: HermesLocalBridge[] = [];
const clients: RecordedPacketClient[] = [];
const tempDirectories: string[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const bridge of bridges.splice(0)) await bridge.stop();
  vi.unstubAllGlobals();
  for (const directory of tempDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('Hermes M3 recorded packet contract', () => {
  it('replays multi-session CRUD and lossless cursor pagination over the WebSocket boundary', async () => {
    const fixture = readFixture<MultiSessionFixture>('m3-multi-session-v2.json');
    assertFixtureProvenance(fixture);
    const directory = await createTempDirectory();
    const stateDbPath = join(directory, 'state.db');
    createNativeStateDb(stateDbPath, fixture.nativeState);
    stubHermesHealthOnly();

    const bridge = await startControlledBridge(directory, stateDbPath);
    const client = await connectRecordedClient(bridge.getWsUrl());
    const captures = new Map<string, unknown>();
    const observed = new Map<string, JsonRecord>();

    const firstFrame = await client.next((frame) => frame.type === 'event');
    expect(firstFrame).toEqual(materializeFixtureValue(fixture.firstFrame, captures));

    for (const packet of fixture.packets) {
      const request = materializeFixtureValue(packet.request, captures) as JsonRecord;
      const response = await client.request(request);
      capturePacketValues(response, packet.captureValues, captures);
      expect(response, packet.label).toEqual(materializeFixtureValue(packet.expect, captures));
      observed.set(packet.label, response);
    }

    for (const [left, right] of fixture.assertions.notEqualCaptures) {
      expect(captures.get(left), `${left} must differ from ${right}`).not.toBe(captures.get(right));
    }

    const older = readMessages(observed.get('chat.history.page-2'));
    const newer = readMessages(observed.get('chat.history.page-1'));
    const combined = [...older, ...newer].map((message) => message.content);
    expect(combined).toEqual(fixture.assertions.historyOrder);
    expect(new Set(combined).size).toBe(combined.length);
  });

  it('locks the image run body and raw abort event over the WebSocket boundary', async () => {
    const fixture = readFixture<AttachmentFixture>('m3-attachment-abort-v2.json');
    assertFixtureProvenance(fixture);
    const directory = await createTempDirectory();
    const stateDbPath = join(directory, 'state.db');
    createNativeStateDb(stateDbPath, { sessions: [], messages: [] });

    let runRequestBody = '';
    let eventStreamSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'http://hermes.fixture/health') {
        return new Response('{"ok":true}', { status: 200 });
      }
      if (url === 'http://hermes.fixture/v1/runs') {
        runRequestBody = String(init?.body ?? '');
        return new Response(JSON.stringify({ run_id: `run_${randomUUID()}`, status: 'started' }), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (/\/v1\/runs\/run_[^/]+\/events$/.test(url)) {
        eventStreamSignal = init?.signal ?? undefined;
        return await new Promise<Response>((_resolve, reject) => {
          eventStreamSignal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          }, { once: true });
        });
      }
      throw new Error(`Unexpected controlled Hermes fetch: ${url}`);
    }));

    const bridge = await startControlledBridge(directory, stateDbPath);
    const seeded = bridge.sessionStore.createSession({
      key: fixture.setup.sessionKey,
      title: fixture.setup.title,
    });
    for (const message of fixture.setup.priorMessages) {
      bridge.sessionStore.appendMessage(fixture.setup.sessionKey, message);
    }

    const client = await connectRecordedClient(bridge.getWsUrl());
    const captures = new Map<string, unknown>([['session.id', seeded.sessionId]]);
    const firstFrame = await client.next((frame) => frame.type === 'event' && frame.event === 'health');
    expect(firstFrame).toEqual(materializeFixtureValue(fixture.firstFrame, captures));

    const sendRequest = materializeFixtureValue(fixture.sendPacket.request, captures) as JsonRecord;
    const sendResponse = await client.request(sendRequest);
    capturePacketValues(sendResponse, fixture.sendPacket.captureValues, captures);
    expect(sendResponse).toEqual(materializeFixtureValue(fixture.sendPacket.expect, captures));

    const expectedRunBody = materializeFixtureValue(fixture.expectedHermesRunBody, captures);
    expect(runRequestBody).toBe(JSON.stringify(expectedRunBody));
    const parsedRunBody = JSON.parse(runRequestBody) as {
      conversation_history: Array<{ content?: unknown }>;
    };
    const currentTurn = ((sendRequest.params as JsonRecord).message);
    expect(parsedRunBody.conversation_history.some((message) => message.content === currentTurn)).toBe(false);

    const abortRequest = materializeFixtureValue(fixture.abortPacket.request, captures) as JsonRecord;
    const abortResponse = await client.request(abortRequest);
    expect(abortResponse).toEqual(materializeFixtureValue(fixture.abortPacket.expect, captures));
    const abortedEvent = await client.next((frame) => (
      frame.type === 'event'
      && frame.event === 'chat'
      && (frame.payload as JsonRecord | undefined)?.state === 'aborted'
    ));
    expect(abortedEvent).toEqual(materializeFixtureValue(fixture.abortedEvent, captures));
    expect(eventStreamSignal?.aborted).toBe(true);
  });
});

function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(name, FIXTURE_ROOT), 'utf8')) as T;
}

function assertFixtureProvenance(fixture: FixtureProvenance): void {
  expect(fixture.schema).toBe('clawket.hermes.recorded-packets.v1');
  expect(fixture.source).toEqual({
    repository: 'https://github.com/NousResearch/hermes-agent.git',
    commit: HERMES_SOURCE_COMMIT,
    evidence: expect.arrayContaining(['hermes_state.py', 'gateway/platforms/api_server.py']),
  });
  expect(Number.isFinite(Date.parse(fixture.recordedAt))).toBe(true);
  expect(fixture.sanitization.length).toBeGreaterThan(40);
  expect(fixture.capture).toMatchObject({
    kind: 'controlled-local-websocket-replay',
    realDevice: false,
  });
  expect(fixture.capture.note).toContain('not a phone');
}

function materializeFixtureValue(value: unknown, captures: Map<string, unknown>): unknown {
  if (typeof value === 'string') {
    if (value === '{{any:number}}') return expect.any(Number);
    if (value === '{{any:string}}') return expect.any(String);
    const placeholder = /^\{\{([^{}]+)\}\}$/.exec(value);
    if (!placeholder) return value;
    if (!captures.has(placeholder[1])) {
      throw new Error(`Fixture references uncaptured value: ${placeholder[1]}`);
    }
    return captures.get(placeholder[1]);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => materializeFixtureValue(entry, captures));
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      materializeFixtureValue(entry, captures),
    ]));
  }
  return value;
}

function capturePacketValues(
  frame: JsonRecord,
  captureValues: Record<string, string> | undefined,
  captures: Map<string, unknown>,
): void {
  for (const [name, path] of Object.entries(captureValues ?? {})) {
    const captured = readPath(frame, path);
    if (captured === undefined || captured === null || captured === '') {
      throw new Error(`Recorded packet capture ${name} was empty at ${path}.`);
    }
    captures.set(name, captured);
  }
}

function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => (
    isRecord(current) ? current[segment] : undefined
  ), value);
}

function readMessages(frame: JsonRecord | undefined): Array<{ content: string }> {
  const messages = readPath(frame, 'payload.messages');
  if (!Array.isArray(messages)) throw new Error('Recorded history response omitted messages.');
  return messages.map((message) => {
    if (!isRecord(message) || typeof message.content !== 'string') {
      throw new Error('Recorded history message had an invalid content field.');
    }
    return { content: message.content };
  });
}

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'clawket-hermes-recorded-'));
  tempDirectories.push(directory);
  return directory;
}

async function startControlledBridge(directory: string, stateDbPath: string): Promise<HermesLocalBridge> {
  const port = await reservePort();
  const bridge = new HermesLocalBridge({
    host: '127.0.0.1',
    port,
    apiBaseUrl: 'http://hermes.fixture',
    bridgeToken: 'recorded-token',
    sessionStorePath: join(directory, 'bridge-sessions.json'),
    usageLedgerPath: join(directory, 'usage-ledger.json'),
    hermesStateDbPath: stateDbPath,
    hermesHomePath: join(directory, 'hermes-home'),
    hermesSourcePath: join(directory, 'hermes-source'),
    hermesPythonPath: 'python3',
    startHermesIfNeeded: false,
  });
  Object.assign(bridge, {
    prewarmBridgeState: async () => undefined,
    getHermesSessionListDefaults: () => undefined,
    getHermesThinkingLevel: () => 'medium',
    readHermesSessionUsageSnapshot: () => null,
    recordHermesRunUsageDelta: () => undefined,
  });
  await bridge.start();
  bridges.push(bridge);
  return bridge;
}

async function connectRecordedClient(url: string): Promise<RecordedPacketClient> {
  const socket = new WebSocket(url);
  const client = new RecordedPacketClient(socket);
  clients.push(client);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  return client;
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return port;
}

function stubHermesHealthOnly(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === 'http://hermes.fixture/health') {
      return new Response('{"ok":true}', { status: 200 });
    }
    throw new Error(`Unexpected controlled Hermes fetch: ${url}`);
  }));
}

function createNativeStateDb(path: string, state: NativeStateFixture): void {
  execFileSync('python3', ['-c', CREATE_NATIVE_STATE_DB, path], {
    encoding: 'utf8',
    input: JSON.stringify(state),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const CREATE_NATIVE_STATE_DB = String.raw`
import json, sqlite3, sys
payload = json.loads(sys.stdin.read() or "{}")
conn = sqlite3.connect(sys.argv[1])
conn.execute("""CREATE TABLE sessions (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, user_id TEXT, model TEXT, model_config TEXT,
  system_prompt TEXT, parent_session_id TEXT, started_at REAL NOT NULL, ended_at REAL,
  end_reason TEXT, message_count INTEGER DEFAULT 0, tool_call_count INTEGER DEFAULT 0,
  input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0,
  reasoning_tokens INTEGER DEFAULT 0, billing_provider TEXT, billing_base_url TEXT,
  billing_mode TEXT, estimated_cost_usd REAL, actual_cost_usd REAL, cost_status TEXT,
  cost_source TEXT, pricing_version TEXT, title TEXT
)""")
conn.execute("""CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL,
  content TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL NOT NULL,
  token_count INTEGER, finish_reason TEXT, reasoning TEXT, reasoning_details TEXT,
  codex_reasoning_items TEXT
)""")
for session in payload.get("sessions", []):
  conn.execute(
    "INSERT INTO sessions (id, source, model, billing_provider, started_at, title) VALUES (?, ?, ?, ?, ?, ?)",
    (session["id"], session["source"], session["model"], session["billingProvider"], session["startedAt"], session["title"]),
  )
for message in payload.get("messages", []):
  conn.execute(
    "INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)",
    (message["id"], message["sessionId"], message["role"], message["content"], message["timestamp"]),
  )
conn.commit()
conn.close()
`;
