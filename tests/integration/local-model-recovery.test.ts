import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { expect, it } from 'vitest';
import { LocalModelConversation } from '../../packages/bridge-runtime/src/local-model/conversation';
import { LocalModelService } from '../../packages/bridge-runtime/src/local-model/server';
import { LocalModelRelay } from '../../packages/bridge-runtime/src/local-model/relay';
import { WebSocketInbox } from '../compat/live-harness';

// Explicit integration test: real model, real sockets, controlled local Relay
// outage. Never re-pairs or connects another owner to the user's cloud room.
it('recovers a real socket outage and successfully generates after recovery', async () => {
  if (!process.env.CLAWKET_RECOVERY_CONFIG) throw new Error('Set CLAWKET_RECOVERY_CONFIG to an existing local-model runtime.json');
  const config = JSON.parse(await readFile(process.env.CLAWKET_RECOVERY_CONFIG, 'utf8'));
  const directory = await mkdtemp(join(tmpdir(), 'clawket-recovery-'));
  const conversation = new LocalModelConversation(config.endpoints, join(directory, 'conversation.json'));
  let server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const relay = new LocalModelRelay(new LocalModelService(conversation),
    { relayUrl: `ws://127.0.0.1:${port}`, gatewayId: 'isolated-test', relaySecret: 'isolated-test' }, () => {});
  let connections = 0;
  const attach = () => new Promise<{ socket: WebSocket; inbox: WebSocketInbox }>(resolve => server.once('connection', socket => {
    connections++;
    const inbox = new WebSocketInbox(socket);
    socket.send('__clawket_relay_control__:{"event":"relay.ready"}');
    resolve({ socket, inbox });
  }));
  const generate = async ({ socket, inbox }: { socket: WebSocket; inbox: WebSocketInbox }) => {
    const started = Date.now();
    socket.send(JSON.stringify({ type: 'req', id: randomUUID(), method: 'chat.send', params: {
      sessionKey: 'main', idempotencyKey: randomUUID(), text: 'Translate to Chinese: The effect lasts for 5 seconds.',
    } }));
    const result = await inbox.nextJson(f => f.type === 'event' && f.payload?.type === 'run_finished', 90_000);
    expect(result.payload.stopReason).not.toBe('error');
    expect(result.payload.message.content).toMatch(/5/);
    return Date.now() - started;
  };
  try {
    const initial = attach(); const started = Date.now(); relay.start();
    let connection = await initial; await relay.waitUntilReady();
    const firstConnectMs = Date.now() - started;
    const firstModelMs = await generate(connection);
    connection.socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await new Promise(resolve => setTimeout(resolve, 7000));
    const restored = Date.now(); server = new WebSocketServer({ port, host: '127.0.0.1' });
    const next = attach(); await once(server, 'listening'); connection = await next;
    await relay.waitUntilReady(); const recoveryMs = Date.now() - restored;
    const recoveredModelMs = await generate(connection);
    relay.stop(); await conversation.stop();
    await new Promise<void>(resolve => server.close(() => resolve()));
    expect(connections).toBe(2);
    console.log(JSON.stringify({ firstConnectMs, firstModelMs, outageMs: 7000, recoveryMs, recoveredModelMs, connections, stopped: true }));
  } finally {
    relay.stop(); await conversation.stop();
    for (const socket of server.clients) socket.terminate(); server.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);
