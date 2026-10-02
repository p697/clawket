import { afterEach, expect, it } from 'vitest';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { codexControl } from './codex-lifecycle.js';

let server: WebSocketServer | undefined;
afterEach(async () => {
  if (!server) return;
  for (const socket of server.clients) socket.terminate();
  await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
});

async function listen() {
  server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  return { port: (server.address() as { port: number }).port, token: 'local-test-token' };
}

it('stops an authenticated Bridge without requesting unavailable native health', async () => {
  const config = await listen();
  const methods: string[] = [];
  server!.on('connection', socket => socket.on('message', raw => {
    const frame = JSON.parse(raw.toString());
    methods.push(frame.method);
    const authenticated = frame.params?.token === config.token && frame.params?.controlOnly === true;
    socket.send(JSON.stringify({ type: 'res', id: frame.id, ok: frame.method === 'bridge.stop' || authenticated,
      payload: frame.method === 'connect' ? { backend: 'codex', controlReady: true } : { stopped: true } }));
  }));
  await expect(codexControl(config, 'bridge.stop')).resolves.toEqual({ stopped: true });
  expect(methods).toEqual(['connect', 'bridge.stop']);
});

it('keeps ordinary health on the existing native-health handshake', async () => {
  const config = await listen();
  let params: unknown;
  server!.on('connection', socket => socket.on('message', raw => {
    const frame = JSON.parse(raw.toString()); params = frame.params;
    socket.send(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload: { backend: 'codex', modelReady: true } }));
  }));
  await expect(codexControl(config)).resolves.toMatchObject({ backend: 'codex', modelReady: true });
  expect(params).toEqual({ token: config.token });
});

it('reports native health failure with explicit restart guidance and no native error body', async () => {
  const config = await listen();
  const methods: string[] = [];
  server!.on('connection', socket => socket.on('message', raw => {
    const frame = JSON.parse(raw.toString()); methods.push(frame.method);
    socket.send(JSON.stringify({ type: 'res', id: frame.id, ok: false,
      error: { code: 'codex_error', message: 'private-native-error-body' } }));
  }));
  const error = await codexControl(config).catch(error => error);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toContain('existing Codex Bridge failed its native health check');
  expect(error.message).toContain('clawket codex restart');
  expect(error.message).not.toContain('private-native-error-body');
  expect(methods).toEqual(['connect']);
});

it('never sends a stop after authentication rejection', async () => {
  const config = await listen();
  const methods: string[] = [];
  server!.on('connection', socket => socket.on('message', raw => {
    const frame = JSON.parse(raw.toString()); methods.push(frame.method);
    socket.send(JSON.stringify({ type: 'res', id: frame.id, ok: false }));
  }));
  await expect(codexControl(config, 'bridge.stop')).rejects.toThrow('rejected');
  expect(methods).toEqual(['connect']);
});

it('recovers an older authenticated Bridge after native health failed', async () => {
  const config = await listen();
  const methods: string[] = [];
  server!.on('connection', socket => socket.on('message', raw => {
    const frame = JSON.parse(raw.toString()); methods.push(frame.method);
    socket.send(JSON.stringify(frame.method === 'connect'
      ? { type: 'res', id: frame.id, ok: false, error: { code: 'codex_error' } }
      : { type: 'res', id: frame.id, ok: true, payload: frame.method === 'agents.list' ? [{ agentId: 'codex' }] : { stopped: true } }));
  }));
  await expect(codexControl(config, 'bridge.stop')).resolves.toEqual({ stopped: true });
  expect(methods).toEqual(['connect', 'agents.list', 'bridge.stop']);
});

it('refuses legacy recovery when the authenticated identity is a different backend', async () => {
  const config = await listen();
  const methods: string[] = [];
  server!.on('connection', socket => socket.on('message', raw => {
    const frame = JSON.parse(raw.toString()); methods.push(frame.method);
    socket.send(JSON.stringify(frame.method === 'connect'
      ? { type: 'res', id: frame.id, ok: false, error: { code: 'codex_error' } }
      : { type: 'res', id: frame.id, ok: true, payload: [{ agentId: 'other' }] }));
  }));
  await expect(codexControl(config, 'bridge.stop')).rejects.toThrow('not a Codex Bridge');
  expect(methods).toEqual(['connect', 'agents.list']);
});
