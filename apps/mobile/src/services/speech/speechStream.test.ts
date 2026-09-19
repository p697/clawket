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
    const two = setup(); jest.advanceTimersByTime(15000);
    await expect(two.connection.ready).rejects.toThrow('speech_timeout');
    await expect(two.connection.result).rejects.toThrow('speech_timeout');
  });
  it('does not retry a lost final acknowledgement', async () => {
    const { socket, connection } = setup(); socket.message({ type: 'ready', maxSeconds: 120 }); await connection.ready;
    connection.finish(); socket.onclose?.();
    await expect(connection.result).rejects.toThrow('speech_disconnected'); expect(socket.send).toHaveBeenCalledTimes(1);
  });
});
