import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { expect, it } from 'vitest';
import { LocalModelConversation } from './conversation.js';
import { LocalModelServer, LocalModelService } from './server.js';

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
    expect(JSON.parse(raw)).toMatchObject({ id: 'good', ok: true, payload: { sessionActivity: 1, backend: 'local-model', model: 'test', vision: false } });
    const activity = new Promise<string>(resolve => good.once('message', data => resolve(data.toString())));
    good.send(JSON.stringify({ type: 'req', id: 'activity', method: 'sessions.activity', params: { keys: ['main', 'unknown'] } }));
    expect(JSON.parse(await activity)).toMatchObject({ ok: true, payload: [{ key: 'main', state: 'idle' }, { key: 'unknown', state: 'unknown' }] });
    expect(conversation.running).toBe(false);

  } finally {
    for (const socket of sockets) socket.terminate();
    await server.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('shares update admission across local and Relay service dispatchers', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'clawket-local-update-'));
  const conversation = new LocalModelConversation([{ id: 'test', name: 'Test', baseUrl: 'http://localhost:1', contextWindow: 8192 }], join(directory, 'history.json'), async () => Response.json({ data: [{ id: 'test' }] }));
  const local = new LocalModelService(conversation, '3.1.11'), relay = new LocalModelService(conversation, '3.1.11');
  try {
    expect(await local.request({ type: 'req', id: 'v', method: 'health' })).toMatchObject({ bridgeVersion: '3.1.11' });
    (conversation as any).mutation = true; expect(conversation.prepareForUpdate()).toBe(false); (conversation as any).mutation = false;
    expect(conversation.prepareForUpdate()).toBe(true);
    await expect(relay.request({ type: 'req', id: 'new', method: 'chat.send' })).rejects.toThrow('restarting');
  } finally { await conversation.stop(); rmSync(directory, { recursive: true, force: true }); }
});
