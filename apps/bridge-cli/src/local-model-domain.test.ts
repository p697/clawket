import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const mock = vi.hoisted(() => ({ relay: vi.fn() }));
vi.mock('./runtime-owner.js', () => ({ registerRuntimeOwner: vi.fn(async () => async () => {}) }));
vi.mock('qrcode', () => ({ default: { toString: vi.fn(async () => '[synthetic QR]') } }));
vi.mock('@clawket/bridge-runtime', () => ({
  LocalModelConversation: class { selection = 'test'; async select() {} },
  LocalModelService: class {},
  LocalModelServer: class { async start() {} async stop() {} },
  LocalModelRelay: class { constructor(_service: unknown, config: unknown) { mock.relay(config); } start() {} async waitUntilReady() {} stop() {} },
}));
import { handleLocalModelCommand } from './local-model.js';
let directory: string;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); rmSync(directory, { recursive: true, force: true }); mock.relay.mockClear(); });

it.each(['pair', 'run'])('migrates saved local-model Relay credentials during %s without allocating a new pairing', async command => {
  directory = mkdtempSync(join(tmpdir(), 'local-domain-'));
  const configPath = join(directory, 'runtime.json');
  const endpointsPath = join(directory, 'endpoints.json');
  writeFileSync(endpointsPath, '[]');
  writeFileSync(configPath, JSON.stringify({ endpoints: [], token: 'preserved-local-token', relay: {
    gatewayId: 'preserved-id', relaySecret: 'preserved-secret', relayUrl: 'wss://clawket-local-model-relay-preview.clawket.workers.dev/ws',
    invitation: { qrPayload: JSON.stringify({ s: 'https://clawket-local-model-registry-preview.clawket.workers.dev' }) },
  } }));
  const fetchMock = vi.fn(async (url: string) => url.endsWith('/access-code') ? Response.json({ accessCode: 'ABC234' })
    : Response.json({ sessionId: `ps_${'a'.repeat(64)}`, expiresAt: new Date(Date.now() + 60_000).toISOString(), capabilities: ['pairing.secure-short-code.v2'] }));
  vi.stubGlobal('fetch', fetchMock);
  if (typeof process.disconnect === 'function') vi.spyOn(process, 'disconnect').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
  const once = process.once.bind(process);
  vi.spyOn(process, 'once').mockImplementation(((event: string, listener: (...args: unknown[]) => void) => {
    if (event === 'SIGTERM') { setTimeout(listener, 10); return process; }
    return once(event, listener);
  }) as typeof process.once);
  await handleLocalModelCommand([command, '--config', configPath, '--endpoints', endpointsPath]);
  expect(mock.relay.mock.calls[0][0]).toMatchObject({ gatewayId: 'preserved-id', relaySecret: 'preserved-secret',
    relayUrl: 'wss://local-model-relay.clawket.ai/ws' });
  if (command === 'pair') {
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      'https://local-model-registry.clawket.ai/v1/pair/access-code', 'https://local-model-registry.clawket.ai/v1/pair/session']);
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toMatchObject({ token: 'preserved-local-token', relay: {
      registryUrl: 'https://local-model-registry.clawket.ai', gatewayId: 'preserved-id', relaySecret: 'preserved-secret',
    } });
  } else expect(fetchMock).not.toHaveBeenCalled();
});
