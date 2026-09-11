import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeWebSocket, getFreePort, openWebSocket, waitForMessage, WranglerDevProcess } from './harness';

let registry: WranglerDevProcess;
let relay: WranglerDevProcess;
let servicePersistence = '';
const ACCESS_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{6}$/;

beforeAll(async () => {
  const relayPort = await getFreePort();
  const registryPort = await getFreePort();
  const relayWsUrl = `ws://127.0.0.1:${relayPort}/ws`;
  servicePersistence = await mkdtemp(join(tmpdir(), 'clawket-relay-it-services-'));

  registry = await WranglerDevProcess.start({
    cwd: process.cwd(),
    configPath: 'apps/relay-registry/wrangler.toml',
    port: registryPort,
    persistencePath: servicePersistence,
    envVars: {
      RELAY_REGION_MAP: JSON.stringify({
        us: relayWsUrl,
        sg: relayWsUrl,
        eu: relayWsUrl,
        cn: relayWsUrl,
      }),
      PAIR_ACCESS_CODE_TTL_SEC: '600',
      PAIR_CLIENT_TOKEN_MAX: '8',
    },
  });

  relay = await WranglerDevProcess.start({
    cwd: process.cwd(),
    configPath: 'apps/relay-worker/wrangler.toml',
    port: relayPort,
    persistencePath: servicePersistence,
    envVars: {
      REGISTRY_VERIFY_URL: registry.baseUrl,
      GATEWAY_OWNER_LEASE_MS: '30000',
    },
  });
}, 60_000);

afterAll(async () => {
  await Promise.allSettled([registry?.stop(), relay?.stop()]);
  if (servicePersistence) {
    await rm(servicePersistence, { recursive: true, force: true });
  }
});

describe('registry + relay integration', () => {
  it('supports pair/register -> claim -> websocket forwarding', async () => {
    const paired = await pairGateway('Studio Mac');
    expect(paired.accessCode).toMatch(ACCESS_CODE_PATTERN);
    const claimed = await claimGateway(paired.gatewayId, paired.accessCode, 'iPhone');

    const gateway = await openWebSocket(
      `${paired.relayUrl}?gatewayId=${encodeURIComponent(paired.gatewayId)}&role=gateway&clientId=gw-main&token=${encodeURIComponent(paired.relaySecret)}`,
    );
    const client = await openWebSocket(
      `${claimed.relayUrl}?gatewayId=${encodeURIComponent(paired.gatewayId)}&role=client&clientId=ios-main&token=${encodeURIComponent(claimed.clientToken)}`,
    );

    client.send('hello-from-client');
    expect(await waitForAppMessage(gateway)).toBe('hello-from-client');

    gateway.send('hello-from-gateway');
    expect(await waitForMessage(client)).toBe('hello-from-gateway');

    closeWebSocket(client);
    closeWebSocket(gateway);
  }, 60_000);

  it('does not replay gateway messages that were sent before a client connected', async () => {
    const paired = await pairGateway('Cache Host');
    const gateway = await openWebSocket(
      `${paired.relayUrl}?gatewayId=${encodeURIComponent(paired.gatewayId)}&role=gateway&clientId=gw-cache&token=${encodeURIComponent(paired.relaySecret)}`,
    );

    gateway.send('cached-first-message');

    const claim1 = await claimGateway(paired.gatewayId, paired.accessCode, 'iPhone');
    const client1 = await openWebSocket(
      `${claim1.relayUrl}?gatewayId=${encodeURIComponent(paired.gatewayId)}&role=client&clientId=ios-cache-1&token=${encodeURIComponent(claim1.clientToken)}`,
    );
    await expect(waitForAppMessage(client1, 250)).rejects.toThrow('Timed out waiting for websocket message');
    closeWebSocket(client1);

    const refreshed = await refreshAccessCode(paired.gatewayId, paired.relaySecret);
    const claim2 = await claimGateway(paired.gatewayId, refreshed.accessCode, 'iPad');
    const client2 = await openWebSocket(
      `${claim2.relayUrl}?gatewayId=${encodeURIComponent(paired.gatewayId)}&role=client&clientId=ios-cache-2&token=${encodeURIComponent(claim2.clientToken)}`,
    );
    await expect(waitForAppMessage(client2, 250)).rejects.toThrow('Timed out waiting for websocket message');

    closeWebSocket(client2);
    closeWebSocket(gateway);
  }, 60_000);

  it('updates displayName when refreshing the access code', async () => {
    const paired = await pairGateway('Old Name');
    const refreshed = await refreshAccessCode(paired.gatewayId, paired.relaySecret, 'Lucy');
    expect(refreshed.accessCode).toMatch(ACCESS_CODE_PATTERN);
    expect(refreshed.displayName).toBe('Lucy');

    const claimed = await claimGateway(paired.gatewayId, refreshed.accessCode, 'iPhone');
    expect(claimed.displayName).toBe('Lucy');
  });

  it('routes bootstrap v2 control frames between client and targeted client sockets', async () => {
    const paired = await pairGateway('Bootstrap V2 Host');
    const claim1 = await claimGateway(paired.gatewayId, paired.accessCode, 'iPhone');
    const refreshed = await refreshAccessCode(paired.gatewayId, paired.relaySecret);
    const claim2 = await claimGateway(paired.gatewayId, refreshed.accessCode, 'iPad');

    const gateway = await openWebSocket(
      `${paired.relayUrl}?gatewayId=${encodeURIComponent(paired.gatewayId)}&role=gateway&clientId=gw-bootstrap&token=${encodeURIComponent(paired.relaySecret)}`,
    );
    const client1 = await openWebSocket(
      `${claim1.relayUrl}?gatewayId=${encodeURIComponent(paired.gatewayId)}&role=client&clientId=ios-bootstrap-1&token=${encodeURIComponent(claim1.clientToken)}`,
    );
    const client2 = await openWebSocket(
      `${claim2.relayUrl}?gatewayId=${encodeURIComponent(paired.gatewayId)}&role=client&clientId=ios-bootstrap-2&token=${encodeURIComponent(claim2.clientToken)}`,
    );

    client1.send(`${CONTROL_PREFIX}${JSON.stringify({
      type: 'control',
      event: 'bootstrap.hello',
      sourceClientId: 'spoofed',
    })}`);
    expect(await waitForControlMessage(gateway, (message) => message.event === 'bootstrap.hello')).toMatchObject({
      type: 'control',
      event: 'bootstrap.hello',
      sourceClientId: 'ios-bootstrap-1',
    });

    gateway.send(`${CONTROL_PREFIX}${JSON.stringify({
      type: 'control',
      event: 'bootstrap.challenge',
      targetClientId: 'ios-bootstrap-2',
    })}`);
    expect(await waitForControlMessage(client2, (message) => message.event === 'bootstrap.challenge')).toMatchObject({
      type: 'control',
      event: 'bootstrap.challenge',
      targetClientId: 'ios-bootstrap-2',
    });

    closeWebSocket(client1);
    closeWebSocket(client2);
    closeWebSocket(gateway);
  }, 60_000);
});

const CONTROL_PREFIX = '__clawket_relay_control__:';

async function pairGateway(displayName: string): Promise<{
  gatewayId: string;
  relaySecret: string;
  relayUrl: string;
  accessCode: string;
}> {
  const response = await fetch(`${registry.baseUrl}/v1/pair/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName, preferredRegion: 'us' }),
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<{
    gatewayId: string;
    relaySecret: string;
    relayUrl: string;
    accessCode: string;
  }>;
}

async function claimGateway(gatewayId: string, accessCode: string, clientLabel: string): Promise<{
  clientToken: string;
  relayUrl: string;
  displayName?: string | null;
}> {
  const response = await fetch(`${registry.baseUrl}/v1/pair/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gatewayId, accessCode, clientLabel }),
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<{ clientToken: string; relayUrl: string; displayName?: string | null }>;
}

async function refreshAccessCode(gatewayId: string, relaySecret: string, displayName?: string): Promise<{
  accessCode: string;
  displayName?: string | null;
}> {
  const response = await fetch(`${registry.baseUrl}/v1/pair/access-code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gatewayId, relaySecret, displayName }),
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<{ accessCode: string; displayName?: string | null }>;
}

async function waitForAppMessage(socket: WebSocket, timeoutMs = 5_000): Promise<string> {
  while (true) {
    const message = await waitForMessage(socket, timeoutMs);
    if (!message.startsWith(CONTROL_PREFIX)) {
      return message;
    }
  }
}

async function waitForControlMessage(
  socket: WebSocket,
  predicate: (message: Record<string, unknown>) => boolean = () => true,
): Promise<Record<string, unknown>> {
  while (true) {
    const message = await waitForMessage(socket);
    if (!message.startsWith(CONTROL_PREFIX)) continue;
    const parsed = JSON.parse(message.slice(CONTROL_PREFIX.length)) as Record<string, unknown>;
    if (predicate(parsed)) return parsed;
  }
}
