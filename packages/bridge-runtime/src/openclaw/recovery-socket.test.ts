import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { expect, it } from 'vitest';
import { BridgeRuntime } from './runtime.js';

it('recovers a lost challenge over real sockets without waiting for repeated Gateway timeouts', async () => {
  const relay = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  const gateway = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await Promise.all([once(relay, 'listening'), once(gateway, 'listening')]);
  const address = (server: WebSocketServer) => {
    const value = server.address();
    if (!value || typeof value === 'string') throw new Error('Missing listening port');
    return `ws://127.0.0.1:${value.port}`;
  };
  let relayConnections = 0;
  const logs: string[] = [];
  let resolveRecovered!: () => void;
  const recovered = new Promise<void>((resolve) => { resolveRecovered = resolve; });
  relay.on('connection', (socket) => {
    relayConnections += 1;
    socket.send('__clawket_relay_control__:{"event":"client_connected","count":1}');
    socket.on('message', (data) => {
      const text = data.toString();
      if (text.startsWith('__clawket_relay_control__:')) return;
      const frame = JSON.parse(text);
      // Deliberately lose the first challenge, as on a stale Relay route.
      if (frame.event === 'connect.challenge' && relayConnections > 1) {
        socket.send('{"type":"req","method":"connect","id":"recovery-test","params":{}}');
      }
      if (frame.type === 'res' && frame.id === 'recovery-test' && frame.ok) resolveRecovered();
    });
  });
  gateway.on('connection', (socket) => {
    socket.send('{"type":"event","event":"connect.challenge","payload":{"nonce":"test-only"}}');
    socket.on('message', (data) => {
      const frame = JSON.parse(data.toString());
      if (frame.method === 'connect') socket.send(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload: {} }));
    });
  });
  const runtime = new BridgeRuntime({
    gatewayUrl: address(gateway),
    config: { serverUrl: 'https://registry.example.com', gatewayId: 'gw_test', relaySecret: 'test-secret',
      relayUrl: address(relay), instanceId: 'test', displayName: 'Test', createdAt: '', updatedAt: '' },
    reconnectBaseDelayMs: 10,
    onLog: (line) => logs.push(line),
  });
  try {
    runtime.start();
    await recovered;
    expect(relayConnections).toBe(2);
    expect(logs.some((line) => line.includes('connect_request_missing'))).toBe(true);
    expect(logs.some((line) => line.includes('gateway reconnect scheduled'))).toBe(false);
  } finally {
    await runtime.stop();
    for (const server of [relay, gateway]) {
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}, 20_000);
