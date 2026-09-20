import { openSpeechSocket } from './speechStream';
jest.mock('../gateway-auth', () => ({ bytesToHex: jest.fn(), ensureIdentity: jest.fn(), generateId: jest.fn(), hexToBytes: jest.fn() }));
class Socket {
  readyState = 1; bufferedAmount = 0; send = jest.fn(); close = jest.fn();
  onmessage?: (event: { data: string }) => void;
  onerror?: () => void; onclose?: () => void;
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
describe('speech stream', () => {
  beforeEach(() => jest.useFakeTimers()); afterEach(() => jest.useRealTimers());
  function setup() { const socket = new Socket(); return { socket, connection: openSpeechSocket(socket as unknown as WebSocket) }; }
  it('splits PCM frames and accepts a final only after finish', async () => {
    const { socket, connection } = setup();
    socket.message({ type: 'ready', maxSeconds: 120 }); await connection.ready;
    connection.audio(new Uint8Array(16000)); expect(socket.send).toHaveBeenCalledTimes(3);
    connection.finish(); connection.finish(); expect(socket.send).toHaveBeenCalledTimes(4);
    socket.message({ type: 'result', text: ' hello ' }); expect(await connection.result).toBe('hello');
    expect(socket.close).toHaveBeenCalled();
  });
  it('rejects a premature final and unknown frames', async () => {
    const { socket, connection } = setup(); socket.message({ type: 'result', text: 'unsafe' });
    await expect(connection.result).rejects.toThrow('speech_protocol');
  });
  it('fails on backpressure instead of retaining unlimited native buffers', async () => {
    const { socket, connection } = setup(); socket.message({ type: 'ready', maxSeconds: 120 }); await connection.ready;
    socket.bufferedAmount = 256001;
    expect(() => connection.audio(new Uint8Array(6400))).toThrow();
    await expect(connection.result).rejects.toThrow('speech_disconnected');
  });
  it('cancel and timeout settle both promises and close the socket', async () => {
    const one = setup(); one.connection.cancel();
    await expect(one.connection.ready).rejects.toThrow('speech_cancelled');
    await expect(one.connection.result).rejects.toThrow('speech_cancelled');
    const two = setup(); jest.advanceTimersByTime(20000);
    await expect(two.connection.ready).rejects.toThrow('speech_connect_timeout');
    await expect(two.connection.result).rejects.toThrow('speech_connect_timeout');
  });
  it('does not retry a lost final acknowledgement', async () => {
    const { socket, connection } = setup(); socket.message({ type: 'ready', maxSeconds: 120 }); await connection.ready;
    connection.finish(); socket.onclose?.();
    await expect(connection.result).rejects.toThrow('speech_disconnected'); expect(socket.send).toHaveBeenCalledTimes(1);
  });
  it('preserves negotiated error codes, request IDs and cooldown instead of flattening failures', async () => {
    const { socket, connection } = setup();
    socket.message({ type: 'error', code: 'speech_busy', requestId: '1807edd7-7c32-4a12-935b-b98f2d8d2237', retryAfterMs: 2000 });
    await expect(connection.ready).rejects.toMatchObject({ code: 'speech_busy', retryAfterMs: 2000, requestId: '1807edd7-7c32-4a12-935b-b98f2d8d2237' });
  });
  it('does not expose arbitrary provider text or peer supplied identifiers', async () => {
    const { socket, connection } = setup();
    socket.message({ type: 'error', code: 'secret arbitrary text', requestId: 'raw credential', retryAfterMs: -100 });
    await expect(connection.result).rejects.toMatchObject({ code: 'speech_failed', requestId: '', retryAfterMs: 0 });
  });

  it('uses received-byte acknowledgements on React Native where bufferedAmount is absent', async () => {
    const { socket, connection } = setup();
    delete (socket as Partial<Socket>).bufferedAmount;
    socket.message({ type: 'ready', maxSeconds: 120, flowControl: 'ack.v1' }); await connection.ready;
    expect(connection.writable!()).toBe(true);
    for (let i = 0; i < 10; i++) connection.audio(new Uint8Array(6400));
    expect(connection.writable!()).toBe(false);
    socket.message({ type: 'ack', bytes: 32000 }); expect(connection.writable!()).toBe(true);
    expect(connection.replayRate!()).toBe(5);
    socket.message({ type: 'ack', bytes: 999999 }); await expect(connection.result).rejects.toThrow('speech_protocol');
  });
  it('keeps older speech services usable without assuming a browser send buffer', async () => {
    const { socket, connection } = setup(); delete (socket as Partial<Socket>).bufferedAmount;
    socket.message({ type: 'ready', maxSeconds: 120 }); await connection.ready;
    expect(connection.writable!()).toBe(true); expect(connection.replayRate!()).toBe(1);
    connection.audio(new Uint8Array(6400)); expect(socket.send).toHaveBeenCalledTimes(1);
  });

});
