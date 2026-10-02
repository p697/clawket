import { afterEach, expect, it } from 'vitest';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { codexControl } from './codex-lifecycle.js';
import { claudeControl } from './claude-code-lifecycle.js';
import { piControl } from './pi-lifecycle.js';
let server: WebSocketServer | undefined;
afterEach(async () => {
  if (!server) return;
  for (const socket of server.clients) socket.terminate();
  await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined;
});
async function listen() {
  server = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await once(server, 'listening');
  return { port: (server.address() as { port: number }).port, token: 'test-token' };
}
const backends = [['codex', codexControl], ['claude-code', claudeControl], ['pi', piControl]] as const;
it.each(backends)('%s recovers only an authenticated legacy owner after native-health rejection', async (backend, control) => {
  const config = await listen(), methods: string[] = [];
  server!.on('connection', socket => socket.on('message', raw => {
    const frame = JSON.parse(raw.toString()); methods.push(frame.method);
    socket.send(JSON.stringify(frame.method === 'connect'
      ? { type: 'res', id: frame.id, ok: false, error: { code: `${backend}_error`, message: 'private-native-body' } }
      : { type: 'res', id: frame.id, ok: true, payload: frame.method === 'agents.list' ? [{ agentId: backend }] : { stopped: true } }));
  }));
  await expect(control(config, 'bridge.stop')).resolves.toEqual({ stopped: true });
  expect(methods).toEqual(['connect', 'agents.list', 'bridge.stop']);
});
it.each(backends)('%s never stops a wrong authenticated legacy identity', async (backend, control) => {
  const config = await listen(), methods: string[] = [];
  server!.on('connection', socket => socket.on('message', raw => {
    const frame = JSON.parse(raw.toString()); methods.push(frame.method);
    socket.send(JSON.stringify(frame.method === 'connect'
      ? { type: 'res', id: frame.id, ok: false, error: { code: `${backend}_error` } }
      : { type: 'res', id: frame.id, ok: true, payload: [{ agentId: 'different' }] }));
  }));
  await expect(control(config, 'bridge.stop')).rejects.toThrow('Endpoint is not');
  expect(methods).toEqual(['connect', 'agents.list']);
});
it.each(backends)('%s ignores an unsolicited lifecycle response before authentication', async (_backend, control) => {
  const config = await listen();
  server!.on('connection', socket => socket.on('message', () => {
    socket.send(JSON.stringify({ type: 'res', id: 'control', ok: true, payload: { stopped: true } })); socket.close();
  }));
  await expect(control(config, 'bridge.stop')).rejects.toThrow('closed');
});
it.each(backends)('%s preserves refusal distinctly from authentication/native failure', async (backend, control) => {
  const config = await listen();
  server!.on('connection', socket => socket.on('message', () => {
    socket.send(JSON.stringify({ type: 'res', id: 'auth', ok: false, error: { code: `${backend}_error`, message: 'private-native-body' } }));
  }));
  const error = await control(config).catch(error => error);
  expect(error.code).not.toBe('ECONNREFUSED'); expect(error.message).not.toContain('private-native-body');
  await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined;
  await expect(control(config)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
});
