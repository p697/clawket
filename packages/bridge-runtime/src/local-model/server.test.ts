import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { expect, it } from 'vitest';
import { LocalModelConversation } from './conversation.js';
import { LocalModelServer } from './server.js';

it('rejects unauthenticated clients and serves authenticated health without leaking tokens', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'clawket-local-auth-'));
  const conversation = new LocalModelConversation([{ id: 'test', name: 'Test', baseUrl: 'http://localhost:1', contextWindow: 8192 }], join(directory, 'history.json'),
    async () => Response.json({ data: [{ id: 'test' }] }));
  const token = 'private-test-token-'.repeat(3);
  const server = new LocalModelServer(conversation, token);
  const sockets: WebSocket[] = [];
  try {
    const port = await server.start(0);
    const open = async () => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/local-model/ws`);
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
      return socket;
    };
    const bad = await open();
    const closed = new Promise<number>(resolve => bad.once('close', resolve));
    bad.send(JSON.stringify({ type: 'req', id: 'bad', method: 'health' }));
    expect(await closed).toBe(1008);
    const good = await open();
    const response = new Promise<string>(resolve => good.once('message', data => resolve(data.toString())));
    good.send(JSON.stringify({ type: 'req', id: 'good', method: 'connect', params: { token } }));
    const raw = await response;
    expect(raw).not.toContain(token);
    expect(JSON.parse(raw)).toMatchObject({ id: 'good', ok: true, payload: { backend: 'local-model', model: 'test', vision: false } });
  } finally {
    for (const socket of sockets) socket.terminate();
    await server.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
