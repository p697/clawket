import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { BridgeRuntime } from '../../packages/bridge-runtime/dist/index.js';

const required = [
  'CLAWKET_PREVIEW_RELAY_URL',
  'CLAWKET_PREVIEW_GATEWAY_ID',
  'CLAWKET_PREVIEW_GATEWAY_SECRET',
  'CLAWKET_PREVIEW_CLIENT_TOKEN',
  'CLAWKET_PREVIEW_OPENCLAW_TOKEN',
];

for (const key of required) {
  if (!process.env[key]?.trim()) throw new Error(`Missing required environment variable: ${key}`);
}

const relayUrl = process.env.CLAWKET_PREVIEW_RELAY_URL.trim();
const gatewayId = process.env.CLAWKET_PREVIEW_GATEWAY_ID.trim();
const gatewaySecret = process.env.CLAWKET_PREVIEW_GATEWAY_SECRET.trim();
const clientToken = process.env.CLAWKET_PREVIEW_CLIENT_TOKEN.trim();
const openClawToken = process.env.CLAWKET_PREVIEW_OPENCLAW_TOKEN.trim();
const relaySockets = [];
const logs = [];

const runtime = new BridgeRuntime({
  config: {
    serverUrl: 'https://preview.invalid',
    gatewayId,
    relaySecret: gatewaySecret,
    relayUrl,
    instanceId: `preview-${randomUUID()}`,
    displayName: 'Clawket Preview E2E',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  gatewayUrl: 'ws://127.0.0.1:18789',
  reconnectBaseDelayMs: 250,
  reconnectMaxDelayMs: 1_000,
  heartbeatIntervalMs: 1_000,
  heartbeatTimeoutMs: 5_000,
  createWebSocket: (url, options) => {
    const socket = new WebSocket(url, options);
    if (url.startsWith(relayUrl)) relaySockets.push(socket);
    return socket;
  },
  onLog: (line) => logs.push(line),
});

try {
  runtime.start();
  await waitFor(() => runtime.getSnapshot().relayConnected, 10_000, 'Bridge did not connect to Preview Relay');

  await assertIdleClient({ label: 'legacy', advertisePong: false, answerPong: false, durationMs: 9_000 });
  await assertIdleClient({ label: 'pong', advertisePong: true, answerPong: true, durationMs: 9_000 });
  await assertMissedPongDisconnect();

  await callGateway('health');
  await callGateway('sessions.list', { limit: 2 });

  const firstRelay = relaySockets.at(-1);
  if (!firstRelay) throw new Error('Preview Relay socket was not captured');
  firstRelay.terminate();
  await waitFor(() => relaySockets.length >= 2, 5_000, 'Bridge did not create a replacement Relay socket');
  await waitFor(() => runtime.getSnapshot().relayConnected, 10_000, 'Bridge did not recover its Preview Relay connection');
  await callGateway('health');

  const resetObserved = logs.some((line) => line.includes('reconnect backoff reset'));
  process.stdout.write(JSON.stringify({
    ok: true,
    checks: [
      'legacy-idle-preserved',
      'capable-client-pong-preserved',
      'missed-pong-disconnected',
      'openclaw-health-through-preview',
      'openclaw-sessions-through-preview',
      'bridge-relay-recovery',
    ],
    relayReconnects: relaySockets.length - 1,
    resetObserved,
  }) + '\n');
} finally {
  await runtime.stop();
}

async function assertIdleClient({ label, advertisePong, answerPong, durationMs }) {
  const socket = await openClient(label, advertisePong);
  let ticks = 0;
  socket.on('message', (data) => {
    let frame;
    try {
      frame = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (frame?.type !== 'tick') return;
    ticks += 1;
    if (answerPong && frame.ack === 'relay.client-pong.v1') {
      socket.send(JSON.stringify({ type: 'pong', ts: frame.ts }));
    }
  });
  await delay(durationMs);
  if (socket.readyState !== WebSocket.OPEN) {
    throw new Error(`${label} idle client closed unexpectedly`);
  }
  if (ticks < 2) throw new Error(`${label} idle client did not receive Relay ticks`);
  socket.close(1000, 'preview_check_complete');
  await waitForSocketClose(socket, 3_000);
}

async function assertMissedPongDisconnect() {
  const socket = await openClient('missed-pong', true);
  const close = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Capable client was not closed after missed pongs')), 12_000);
    socket.once('close', (code, reason) => {
      clearTimeout(timeout);
      resolve({ code, reason: reason.toString() });
    });
  });
  if (close.code !== 4009 || close.reason !== 'client_pong_timeout') {
    throw new Error(`Unexpected missed-pong close: ${close.code} ${close.reason}`);
  }
}

async function openClient(label, advertisePong) {
  const url = new URL(relayUrl);
  url.searchParams.set('gatewayId', gatewayId);
  url.searchParams.set('role', 'client');
  url.searchParams.set('clientId', `preview-${label}-${randomUUID()}`);
  url.searchParams.set('token', clientToken);
  if (advertisePong) url.searchParams.set('capabilities', 'relay.client-pong.v1');
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} client open timed out`)), 10_000);
    socket.once('open', () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  return socket;
}

async function callGateway(method, params = {}) {
  const url = new URL(relayUrl);
  url.searchParams.set('gatewayId', gatewayId);
  url.searchParams.set('role', 'client');
  url.searchParams.set('clientId', `preview-openclaw-${randomUUID()}`);
  url.searchParams.set('token', clientToken);
  const result = await spawnCapture('openclaw', [
    'gateway',
    'call',
    method,
    '--json',
    '--url',
    url.toString(),
    '--token',
    openClawToken,
    '--params',
    JSON.stringify(params),
    '--timeout',
    '15000',
  ]);
  if (result.code !== 0) {
    throw new Error(`${method} failed: ${redact(result.stderr || result.stdout)}`);
  }
  try {
    JSON.parse(result.stdout);
  } catch {
    throw new Error(`${method} returned non-JSON output: ${redact(result.stdout)}`);
  }
}

function spawnCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

async function waitFor(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(50);
  }
  throw new Error(message);
}

function waitForSocketClose(socket, timeoutMs) {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    socket.once('close', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redact(text) {
  return text
    .replaceAll(gatewaySecret, '<redacted>')
    .replaceAll(clientToken, '<redacted>')
    .replaceAll(openClawToken, '<redacted>');
}
