import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';

const HTTP_TIMEOUT_MS = 15_000;

export async function runHermesPreviewSmoke({
  env = process.env,
  fetchImpl = globalThis.fetch,
  WebSocketCtor = WebSocket,
  httpTimeoutMs = HTTP_TIMEOUT_MS,
  stdout = process.stdout,
} = {}) {
  const registryBaseUrl = normalizeBaseUrl(
    env.CLAWKET_HERMES_PREVIEW_REGISTRY_URL
      ?? 'https://clawket-hermes-registry-preview.clawket.workers.dev',
  );
  const requestJson = (url, init, label) => requireOkJson(
    url,
    init,
    label,
    { fetchImpl, timeoutMs: httpTimeoutMs },
  );
  const checks = [];
  let bridge = null;
  let client = null;

  try {
    await requestJson(new URL('/v1/health', registryBaseUrl), undefined, 'Hermes Preview Registry health');
    checks.push('hermes-preview-registry-health');

    const registered = await requestJson(
      new URL('/v1/hermes/pair/register', registryBaseUrl),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: 'Hermes Preview smoke bridge',
          preferredRegion: 'us',
        }),
      },
      'Hermes Preview register',
    );
    requireString(registered, 'bridgeId', /^hbg_/);
    requireString(registered, 'relaySecret');
    requireString(registered, 'relayUrl', /^wss?:\/\//);
    requireString(registered, 'accessCode');
    checks.push('hermes-preview-register');

    const claimed = await requestJson(
      new URL('/v1/hermes/pair/claim-code', registryBaseUrl),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accessCode: registered.accessCode,
          clientLabel: 'Hermes Preview smoke client',
        }),
      },
      'Hermes Preview code claim',
    );
    requireString(claimed, 'clientToken');
    requireString(claimed, 'relayUrl', /^wss?:\/\//);
    if (claimed.bridgeId !== registered.bridgeId) {
      throw new Error('Hermes Preview code claim returned a different bridge identity');
    }
    checks.push('hermes-preview-code-claim');

    await requestJson(
      relayHttpUrl(registered.relayUrl, '/v1/health'),
      undefined,
      'Hermes Preview Relay health',
    );
    checks.push('hermes-preview-relay-health');

    bridge = await openSocket(
      relaySocketUrl(registered.relayUrl, {
        bridgeId: registered.bridgeId,
        role: 'gateway',
        clientId: `preview-hermes-bridge-${randomUUID()}`,
      }),
      { authorization: `Bearer ${registered.relaySecret}` },
      'Hermes Preview bridge',
      WebSocketCtor,
    );
    client = await openSocket(
      relaySocketUrl(claimed.relayUrl, {
        bridgeId: registered.bridgeId,
        role: 'client',
        clientId: `preview-hermes-client-${randomUUID()}`,
        token: claimed.clientToken,
        capabilities: 'relay.client-pong.v1',
      }),
      undefined,
      'Hermes Preview client',
      WebSocketCtor,
    );
    checks.push('hermes-preview-relay-auth');

    const requestId = `preview-hermes-sessions-${randomUUID()}`;
    const request = {
      type: 'req',
      id: requestId,
      method: 'sessions.list',
      params: {
        limit: 100,
        includeLastMessage: true,
        includeDerivedTitles: true,
      },
    };
    client.send(JSON.stringify(request));
    const forwardedRequest = await bridge.nextJson(
      (frame) => frame.type === 'req' && frame.id === requestId,
      'Hermes Preview sessions.list did not reach the bridge',
    );
    if (forwardedRequest.method !== 'sessions.list') {
      throw new Error('Hermes Preview changed the forwarded sessions.list method');
    }
    bridge.send(JSON.stringify({
      type: 'res',
      id: requestId,
      ok: true,
      payload: { sessions: [] },
    }));
    const forwardedResponse = await client.nextJson(
      (frame) => frame.type === 'res' && frame.id === requestId,
      'Hermes Preview sessions.list response did not reach the client',
    );
    if (forwardedResponse.ok !== true || !Array.isArray(forwardedResponse.payload?.sessions)) {
      throw new Error('Hermes Preview returned an invalid sessions.list response');
    }
    checks.push('hermes-preview-sessions-forwarding');

    const bridgeStatus = await requestJson(
      relayHttpUrl(
        registered.relayUrl,
        '/v1/internal/hermes/bridge-status',
        { bridgeId: registered.bridgeId },
      ),
      { headers: { authorization: `Bearer ${registered.relaySecret}` } },
      'Hermes Preview bridge status',
    );
    if (bridgeStatus.hasBridge !== true || bridgeStatus.bridgeId !== registered.bridgeId) {
      throw new Error('Hermes Preview bridge status did not report the connected bridge');
    }
    checks.push('hermes-preview-bridge-status');

    stdout.write(`${JSON.stringify({ ok: true, checks })}\n`);
    return checks;
  } finally {
    client?.close();
    bridge?.close();
  }
}

export function normalizeBaseUrl(value) {
  const url = new URL(value.trim());
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url;
}

export async function requireOkJson(
  url,
  init,
  label,
  { fetchImpl = globalThis.fetch, timeoutMs = HTTP_TIMEOUT_MS } = {},
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`${label} requires a positive HTTP timeout`);
  }

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeoutController.signal])
    : timeoutController.signal;

  try {
    let response;
    try {
      response = await fetchImpl(url, { ...init, signal });
    } catch (error) {
      if (timeoutController.signal.aborted) {
        throw new Error(`${label} timed out after ${timeoutMs} ms`, { cause: error });
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`${label} request failed: ${detail}`, { cause: error });
    }

    if (!response.ok) throw new Error(`${label} failed with status ${response.status}`);
    try {
      return await response.json();
    } catch (error) {
      if (timeoutController.signal.aborted) {
        throw new Error(`${label} timed out after ${timeoutMs} ms`, { cause: error });
      }
      throw new Error(`${label} returned invalid JSON`, { cause: error });
    }
  } finally {
    clearTimeout(timeout);
  }
}

function requireString(record, key, pattern) {
  const value = record?.[key];
  if (typeof value !== 'string' || !value || (pattern && !pattern.test(value))) {
    throw new Error(`Hermes Preview response is missing a valid ${key}`);
  }
  return value;
}

function relaySocketUrl(relayUrl, query) {
  const url = new URL(relayUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url;
}

function relayHttpUrl(relayUrl, pathname, query = {}) {
  const url = new URL(relayUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = pathname;
  url.search = '';
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url;
}

async function openSocket(url, headers, label, WebSocketCtor = WebSocket) {
  const socket = new WebSocketCtor(url, headers ? { headers } : undefined);
  const received = [];
  const waiters = new Set();
  socket.on('message', (data, isBinary) => {
    if (isBinary) return;
    let frame;
    try {
      frame = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (frame?.type === 'tick' && frame.ack === 'relay.client-pong.v1') {
      socket.send(JSON.stringify({ type: 'pong', ts: frame.ts }));
    }
    received.push(frame);
    for (const wake of waiters) wake();
    waiters.clear();
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} connection timed out`)), 15_000);
    socket.once('open', () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once('error', () => {
      clearTimeout(timeout);
      reject(new Error(`${label} connection failed`));
    });
  });
  socket.on('error', () => {});
  return {
    send: (value) => socket.send(value),
    close: () => socket.close(1000, 'preview_hermes_smoke_complete'),
    async nextJson(predicate, failureMessage, timeoutMs = 15_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const index = received.findIndex(predicate);
        if (index >= 0) return received.splice(index, 1)[0];
        await new Promise((resolve) => {
          const remaining = Math.max(1, deadline - Date.now());
          const timeout = setTimeout(() => {
            waiters.delete(wake);
            resolve();
          }, Math.min(remaining, 100));
          const wake = () => {
            clearTimeout(timeout);
            resolve();
          };
          waiters.add(wake);
        });
      }
      throw new Error(failureMessage);
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runHermesPreviewSmoke();
}
