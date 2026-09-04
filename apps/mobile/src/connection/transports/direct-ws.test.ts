import { DirectWsTransport } from './direct-ws';
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

describe('DirectWsTransport', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resets backoff on the first valid frame, not on raw open or invalid JSON', () => {
    const sockets: FakeWebSocket[] = [];
    const transport = new DirectWsTransport({
      url: 'ws://bridge.example/ws',
      reconnectJitter: false,
      webSocketFactory: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket;
      },
    });

    transport.connect();
    sockets[0].open();
    sockets[0].serverClose({ code: 1006 });
    jest.advanceTimersByTime(800);
    sockets[1].open();

    expect(transport.reconnectAttempt).toBe(1);
    sockets[1].receive('not-json');
    expect(transport.reconnectAttempt).toBe(1);
    expect(transport.hasReceivedValidFrame).toBe(false);

    sockets[1].receive(JSON.stringify({ type: 'event', event: 'health' }));
    expect(transport.reconnectAttempt).toBe(0);
    expect(transport.hasReceivedValidFrame).toBe(true);
    expect(transport.state).toBe('handshaking');
  });

  it('can enter ready on first valid frame when configured by an adapter', () => {
    const socket = new FakeWebSocket();
    const transport = new DirectWsTransport({
      url: 'ws://bridge.example/ws',
      autoReadyOnFirstFrame: true,
      webSocketFactory: () => socket,
    });
    transport.connect();
    socket.open();
    expect(transport.state).toBe('handshaking');

    socket.receive(JSON.stringify({ type: 'event', event: 'health' }));

    expect(transport.state).toBe('ready');
  });

  it('allows an adapter to define a backend-neutral valid-frame predicate', () => {
    const socket = new FakeWebSocket();
    const transport = new DirectWsTransport({
      url: 'ws://bridge.example/ws',
      autoReadyOnFirstFrame: true,
      isValidFrame: (frame) => frame === 'READY',
      webSocketFactory: () => socket,
    });
    transport.connect();
    socket.open();
    socket.receive('{}');
    expect(transport.state).toBe('handshaking');
    socket.receive('READY');
    expect(transport.state).toBe('ready');
  });

  it('recycles a socket if no valid frame arrives within the configured timeout', () => {
    const socket = new FakeWebSocket();
    const errors: string[] = [];
    const transport = new DirectWsTransport({
      url: 'ws://bridge.example/ws',
      firstFrameTimeoutMs: 25,
      reconnectJitter: false,
      webSocketFactory: () => socket,
    });
    transport.onError((error) => errors.push(error.code));
    transport.connect();
    socket.open();
    socket.receive('invalid');

    jest.advanceTimersByTime(25);

    expect(errors).toEqual(['first_frame_timeout']);
    expect(socket.closeCalls).toHaveLength(1);
    expect(transport.state).toBe('reconnecting');
  });

  it('does not reconnect after an explicit disconnect', () => {
    const socket = new FakeWebSocket();
    const factory = jest.fn(() => socket);
    const transport = new DirectWsTransport({
      url: 'ws://bridge.example/ws',
      reconnectJitter: false,
      webSocketFactory: factory,
    });
    transport.connect();
    socket.open();
    transport.disconnect(1000, 'switch connection');
    jest.advanceTimersByTime(60_000);

    expect(transport.state).toBe('closed');
    expect(factory).toHaveBeenCalledTimes(1);
  });
});

