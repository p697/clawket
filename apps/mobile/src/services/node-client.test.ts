import { NodeClient } from './node-client';
import {
  FRAME_TOO_LARGE_CLOSE_CODE,
  FRAME_TOO_LARGE_ERROR_CODE,
  WEBSOCKET_FRAME_LIMIT_BYTES,
} from './websocket-frame-limit';

// Mock tweetnacl
jest.mock('tweetnacl', () => ({
  sign: {
    keyPair: jest.fn(() => ({
      publicKey: new Uint8Array(32).fill(1),
      secretKey: new Uint8Array(64).fill(2),
    })),
    detached: jest.fn(() => new Uint8Array(64).fill(3)),
  },
}));

// Mock js-sha256
jest.mock('js-sha256', () => ({
  sha256: jest.fn(() => 'a'.repeat(64)),
}));

// Mock StorageService
jest.mock('./storage', () => ({
  StorageService: {
    getIdentity: jest.fn(() => Promise.resolve(null)),
    setIdentity: jest.fn(() => Promise.resolve()),
    clearIdentity: jest.fn(() => Promise.resolve()),
    setDeviceToken: jest.fn(() => Promise.resolve()),
  },
}));

// MockWebSocket
class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;
  OPEN = 1;
  CONNECTING = 0;
  CLOSING = 2;
  CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  send = jest.fn();
  close = jest.fn((_code?: number, _reason?: string) => {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose();
  });
}

(globalThis as any).WebSocket = MockWebSocket;

describe('NodeClient', () => {
  let client: NodeClient;

  beforeEach(() => {
    client = new NodeClient();
  });

  afterEach(() => {
    client.disconnect();
  });

  it('starts in idle state', () => {
    expect(client.getConnectionState()).toBe('idle');
  });

  it('emits error when connecting without config', () => {
    const errors: Array<{ code: string; message: string }> = [];
    client.on('error', (e) => errors.push(e));
    client.connect();
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('config_missing');
  });

  it('transitions to connecting then challenging on open', () => {
    const states: string[] = [];
    client.on('connection', ({ state }) => states.push(state));
    client.configure({ url: 'ws://localhost:18789' });
    client.connect();
    expect(states).toContain('connecting');

    // Simulate WebSocket open
    const ws = (client as any).ws as MockWebSocket;
    ws.onopen?.();
    expect(states).toContain('challenging');
  });

  it('transitions to closed on disconnect', () => {
    const states: string[] = [];
    client.on('connection', ({ state }) => states.push(state));
    client.configure({ url: 'ws://localhost:18789' });
    client.connect();
    client.disconnect();
    expect(states).toContain('closed');
  });

  it('emits invokeRequest event from node.invoke.request', () => {
    client.configure({ url: 'ws://localhost:18789' });
    client.connect();

    const ws = (client as any).ws as MockWebSocket;
    ws.onopen?.();

    const events: any[] = [];
    client.on('invokeRequest', (e) => events.push(e));

    // Simulate incoming invoke request
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'event',
        event: 'node.invoke.request',
        payload: {
          id: 'inv-1',
          nodeId: 'node-abc',
          command: 'device.info',
          paramsJSON: '{}',
          timeoutMs: 5000,
        },
      }),
    });

    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('inv-1');
    expect(events[0].command).toBe('device.info');
    expect(events[0].timeoutMs).toBe(5000);
  });

  it('sendInvokeResult sends frame over WebSocket', async () => {
    client.configure({ url: 'ws://localhost:18789' });
    client.connect();

    const ws = (client as any).ws as MockWebSocket;
    ws.onopen?.();

    // Simulate challenge → ready to set deviceId
    // We need to set deviceId manually since challenge flow is async
    (client as any).deviceId = 'device-123';

    client.sendInvokeResult('inv-1', { ok: true, payload: { platform: 'ios' } });

    expect(ws.send).toHaveBeenCalled();
    const sent = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0]);
    expect(sent.method).toBe('node.invoke.result');
    expect(sent.params.id).toBe('inv-1');
    expect(sent.params.nodeId).toBe('device-123');
    expect(sent.params.ok).toBe(true);
    expect(sent.params.payload.platform).toBe('ios');
  });

  it('handles res frames for pending requests', () => {
    client.configure({ url: 'ws://localhost:18789' });
    client.connect();

    const ws = (client as any).ws as MockWebSocket;
    ws.onopen?.();

    // Create a pending request by accessing the sendRequest method
    const promise = (client as any).sendRequest('test.method', {});
    const sentData = JSON.parse(ws.send.mock.calls[0][0]);
    const requestId = sentData.id;

    // Simulate response
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'res',
        id: requestId,
        result: { success: true },
      }),
    });

    return expect(promise).resolves.toEqual({ success: true });
  });

  it('rejects pending requests on error response', () => {
    client.configure({ url: 'ws://localhost:18789' });
    client.connect();

    const ws = (client as any).ws as MockWebSocket;
    ws.onopen?.();

    const promise = (client as any).sendRequest('test.method', {});
    const sentData = JSON.parse(ws.send.mock.calls[0][0]);
    const requestId = sentData.id;

    ws.onmessage?.({
      data: JSON.stringify({
        type: 'res',
        id: requestId,
        error: { code: 'FAIL', message: 'Something went wrong' },
      }),
    });

    return expect(promise).rejects.toThrow('Something went wrong');
  });

  it('does not send invoke result without deviceId', () => {
    client.configure({ url: 'ws://localhost:18789' });
    client.connect();

    const ws = (client as any).ws as MockWebSocket;
    ws.onopen?.();

    // deviceId is null by default
    const sendCallsBefore = ws.send.mock.calls.length;
    client.sendInvokeResult('inv-1', { ok: true, payload: {} });
    expect(ws.send.mock.calls.length).toBe(sendCallsBefore);
  });

  it('rejects oversized invoke results before WebSocket.send', () => {
    client.configure({ url: 'ws://localhost:18789' });
    client.connect();
    const ws = (client as any).ws as MockWebSocket;
    (client as any).deviceId = 'device-123';
    const errors: Array<{ code: string; message: string }> = [];
    client.on('error', (error) => errors.push(error));

    client.sendInvokeResult('inv-1', {
      ok: true,
      payload: { value: '😀'.repeat(WEBSOCKET_FRAME_LIMIT_BYTES / 4) },
    });

    expect(ws.send).not.toHaveBeenCalled();
    expect(errors).toContainEqual({
      code: FRAME_TOO_LARGE_ERROR_CODE,
      message: FRAME_TOO_LARGE_ERROR_CODE,
    });
  });

  it('rejects oversized inbound frames before parsing', () => {
    client.configure({ url: 'ws://localhost:18789' });
    client.connect();
    const ws = (client as any).ws as MockWebSocket;
    const errors: Array<{ code: string; message: string }> = [];
    client.on('error', (error) => errors.push(error));

    ws.onmessage?.({ data: new ArrayBuffer(WEBSOCKET_FRAME_LIMIT_BYTES + 1) });

    expect(errors).toContainEqual({
      code: FRAME_TOO_LARGE_ERROR_CODE,
      message: FRAME_TOO_LARGE_ERROR_CODE,
    });
    expect(ws.close).toHaveBeenCalledWith(
      FRAME_TOO_LARGE_CLOSE_CODE,
      FRAME_TOO_LARGE_ERROR_CODE,
    );
  });
});
