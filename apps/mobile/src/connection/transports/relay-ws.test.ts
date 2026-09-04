import {
  FRAME_TOO_LARGE_CLOSE_CODE,
  FRAME_TOO_LARGE_ERROR_CODE,
  WEBSOCKET_FRAME_LIMIT_BYTES,
  WebSocketFrameTooLargeError,
} from './frame-limit';
import { RELAY_CLIENT_PONG_CAPABILITY, RelayWsTransport } from './relay-ws';
import type { WebSocketCloseEventLike, WebSocketLike } from './types';

class FakeWebSocket implements WebSocketLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event?: { message?: string; type?: string }) => void) | null = null;
  onclose: ((event?: WebSocketCloseEventLike) => void) | null = null;
  readonly sent: unknown[] = [];
  readonly closeCalls: Array<[number | undefined, string | undefined]> = [];

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push([code, reason]);
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(data: unknown): void {
    this.onmessage?.({ data });
  }

  serverClose(event: WebSocketCloseEventLike = {}): void {
    this.readyState = 3;
    this.onclose?.(event);
  }
}

describe('RelayWsTransport', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not reset reconnect backoff until the adapter confirms ready', () => {
    const sockets: FakeWebSocket[] = [];
    const transport = new RelayWsTransport({
      url: 'wss://relay.example/ws',
      reconnectJitter: false,
      webSocketFactory: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    transport.connect();
    sockets[0].open();
    expect(transport.state).toBe('handshaking');
    expect(transport.reconnectAttempt).toBe(0);

    sockets[0].serverClose({ code: 1012, reason: 'restart' });
    expect(transport.state).toBe('reconnecting');
    expect(transport.reconnectAttempt).toBe(1);

    jest.advanceTimersByTime(800);
    sockets[1].open();
    expect(transport.state).toBe('handshaking');
    expect(transport.reconnectAttempt).toBe(1);

    transport.markReady();
    expect(transport.state).toBe('ready');
    expect(transport.reconnectAttempt).toBe(0);
  });

  it('answers only ticks that negotiate relay.client-pong.v1', () => {
    const socket = new FakeWebSocket();
    const received: unknown[] = [];
    const transport = new RelayWsTransport({
      url: 'wss://relay.example/ws',
      webSocketFactory: () => socket,
    });
    transport.onMessage((frame) => received.push(frame));
    transport.connect();
    socket.open();

    socket.receive(JSON.stringify({ type: 'tick', ts: 12, extra: 'allowed' }));
    socket.receive(JSON.stringify({
      type: 'tick',
      ts: 13,
      ack: RELAY_CLIENT_PONG_CAPABILITY,
      futureField: { ok: true },
    }));
    socket.receive(JSON.stringify({
      type: 'tick',
      ts: '14',
      ack: RELAY_CLIENT_PONG_CAPABILITY,
    }));

    expect(socket.sent).toEqual([JSON.stringify({ type: 'pong', ts: 13 })]);
    expect(received).toHaveLength(3);
    expect(transport.advertisedCapabilities).toEqual([RELAY_CLIENT_PONG_CAPABILITY]);
  });

  it('accepts exactly 8 MiB outbound and rejects a larger frame before send', () => {
    const socket = new FakeWebSocket();
    const transport = new RelayWsTransport({
      url: 'wss://relay.example/ws',
      webSocketFactory: () => socket,
    });
    transport.connect();
    socket.open();
    const atLimit = 'a'.repeat(WEBSOCKET_FRAME_LIMIT_BYTES);
    const overLimit = `${atLimit}b`;

    transport.send(atLimit);
    expect(() => transport.send(overLimit)).toThrow(WebSocketFrameTooLargeError);
    expect(socket.sent).toEqual([atLimit]);
  });

  it('closes an oversized inbound frame with the stable wire error', () => {
    const socket = new FakeWebSocket();
    const errors: string[] = [];
    const transport = new RelayWsTransport({
      url: 'wss://relay.example/ws',
      reconnectJitter: false,
      webSocketFactory: () => socket,
    });
    transport.onError((error) => errors.push(error.code));
    transport.connect();
    socket.open();

    socket.receive('a'.repeat(WEBSOCKET_FRAME_LIMIT_BYTES + 1));

    expect(errors).toEqual([FRAME_TOO_LARGE_ERROR_CODE]);
    expect(socket.closeCalls).toContainEqual([
      FRAME_TOO_LARGE_CLOSE_CODE,
      FRAME_TOO_LARGE_ERROR_CODE,
    ]);
    expect(transport.state).toBe('reconnecting');
  });

  it('recycles a socket whose handshake never becomes ready', () => {
    const socket = new FakeWebSocket();
    const errors: string[] = [];
    const transport = new RelayWsTransport({
      url: 'wss://relay.example/ws',
      handshakeTimeoutMs: 25,
      reconnectJitter: false,
      webSocketFactory: () => socket,
    });
    transport.onError((error) => errors.push(error.code));
    transport.connect();
    socket.open();

    jest.advanceTimersByTime(25);

    expect(errors).toEqual(['challenge_timeout']);
    expect(socket.closeCalls).toHaveLength(1);
    expect(transport.state).toBe('reconnecting');
  });

  it('recycles a ready socket after the negotiated heartbeat goes stale', () => {
    const socket = new FakeWebSocket();
    const errors: string[] = [];
    const transport = new RelayWsTransport({
      url: 'wss://relay.example/ws',
      tickIntervalMs: 10,
      missedTickTolerance: 2,
      reconnectJitter: false,
      webSocketFactory: () => socket,
    });
    transport.onError((error) => errors.push(error.code));
    transport.connect();
    socket.open();
    transport.markReady();

    jest.advanceTimersByTime(15);
    socket.receive(JSON.stringify({ type: 'tick', ts: 1 }));
    jest.advanceTimersByTime(19);
    expect(transport.state).toBe('ready');

    jest.advanceTimersByTime(6);
    expect(errors).toContain('heartbeat_timeout');
    expect(transport.state).toBe('reconnecting');
  });

  it('treats unknown close codes as reconnectable transport failures', () => {
    const socket = new FakeWebSocket();
    const transport = new RelayWsTransport({
      url: 'wss://relay.example/ws',
      reconnectJitter: false,
      webSocketFactory: () => socket,
    });
    transport.connect();
    socket.open();
    socket.serverClose({ code: 4999, reason: 'future-code' });

    expect(transport.state).toBe('reconnecting');
    expect(transport.reconnectAttempt).toBe(1);
  });
});
