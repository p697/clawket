import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { expect, it } from 'vitest';
import { PiServer } from './server.js';
import type { PiService } from './service.js';
import { WEBSOCKET_FRAME_LIMIT_BYTES } from '../frame-limit.js';

it('authenticates before exposing events and enforces the wire limit with sanitized diagnostics', async () => {
  const service = Object.assign(new EventEmitter(), {
    health: async () => ({ backend: 'pi' }), request: async () => ({ backend: 'pi' }), stop: async () => {},
  });
  const logs: string[] = [], token = 'private-token-'.repeat(4);
  const server = new PiServer(service as unknown as PiService, token, message => logs.push(message));
  const sockets: WebSocket[] = [];
  try {
    const port = await server.start(0);
    const open = async () => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/pi/ws`); sockets.push(socket);
      await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
      return socket;
    };
    const bad = await open(), unauthenticated: string[] = [];
    bad.on('message', data => unauthenticated.push(data.toString()));
    service.emit('update', { type: 'run_started', sessionKey: 'private-session' });
    const badClose = new Promise<number>(resolve => bad.once('close', resolve));
    bad.send(JSON.stringify({ type: 'req', id: 'bad', method: 'connect', params: { token: 'invalid' } }));
    expect(await badClose).toBe(1008); expect(unauthenticated).toEqual([]);
    const good = await open();
    const response = new Promise<string>(resolve => good.once('message', data => resolve(data.toString())));
    good.send(JSON.stringify({ type: 'req', id: 'auth', method: 'connect', params: { token } }));
    expect(JSON.parse(await response)).toMatchObject({ ok: true, payload: { backend: 'pi' } });
    const oversized = new Promise<number>(resolve => good.once('close', resolve));
    good.send('x'.repeat(WEBSOCKET_FRAME_LIMIT_BYTES + 1));
    expect(await oversized).toBe(1009); expect(logs.join()).toContain('frame_too_large'); expect(logs.join()).not.toContain(token);
  } finally { sockets.forEach(socket => socket.terminate()); await server.stop(); }
});
