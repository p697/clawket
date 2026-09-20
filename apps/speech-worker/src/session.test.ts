import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serveSession } from './session';
class Socket extends EventTarget {
  sent: Array<string | ArrayBuffer> = [];
  send(data: string | ArrayBuffer) { this.sent.push(data); }
  close = vi.fn();
  message(data: string | ArrayBuffer) { const event = new Event('message'); Object.assign(event, { data }); this.dispatchEvent(event); }
}
const providerEvent = (event: string, text?: string) => JSON.stringify({ header: { task_id: 'task', event }, payload: { output: { sentence: { sentence_id: 0, text, sentence_end: true } } } });
describe('bounded duplex session', () => {
  beforeEach(() => vi.useFakeTimers()); afterEach(() => vi.useRealTimers());
  function setup() {
    const client = new Socket(), provider = new Socket(), release = vi.fn();
    serveSession(client as unknown as WebSocket, provider as unknown as WebSocket, 'task', release);
    return { client, provider, release };
  }
  it('streams PCM after ready and returns completed text once after finish', async () => {
    const { client, provider, release } = setup();
    provider.message(providerEvent('task-started')); client.message(new ArrayBuffer(6400));
    provider.message(providerEvent('result-generated', 'hello'));
    client.message('{"type":"finish"}'); provider.message(providerEvent('task-finished'));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(client.sent.map((v) => JSON.parse(v as string).type)).toEqual(['ready', 'transcript', 'result']);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(release).toHaveBeenCalledTimes(1); expect(provider.close).toHaveBeenCalled();
  });
  it.each(['cancel', 'close', 'timeout', 'oversized', 'early', 'provider-close'])('cleans both sockets and admission after %s', async (mode) => {
    const { client, provider, release } = setup();
    if (mode !== 'early') provider.message(providerEvent('task-started'));
    if (mode === 'cancel') client.message('{"type":"cancel"}');
    if (mode === 'close') client.dispatchEvent(new Event('close'));
    if (mode === 'provider-close') provider.dispatchEvent(new Event('close'));
    if (mode === 'timeout') vi.advanceTimersByTime(16000);
    if (mode === 'oversized') client.message(new ArrayBuffer(32002));
    if (mode === 'early') client.message(new ArrayBuffer(2));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(release).toHaveBeenCalledTimes(1); expect(provider.close).toHaveBeenCalled(); expect(client.close).toHaveBeenCalled();
    client.dispatchEvent(new Event('close')); expect(release).toHaveBeenCalledTimes(1);
  });
  it('rejects unsolicited provider completion instead of sending a prompt', async () => {
    const { client, provider } = setup(); provider.message(providerEvent('task-finished'));
    expect(client.sent).not.toContainEqual(expect.stringContaining('"type":"result"'));
  });
  it('does not acknowledge completion until the exclusive device lease has been released', async () => {
    let resolve!: () => void;
    const released = new Promise<void>((done) => { resolve = done; });
    const client = new Socket(), provider = new Socket();
    serveSession(client as unknown as WebSocket, provider as unknown as WebSocket, 'task', () => released);
    provider.message(providerEvent('task-started')); client.message(new ArrayBuffer(6400));
    provider.message(providerEvent('result-generated', 'private transcript'));
    client.message('{"type":"finish"}'); provider.message(providerEvent('task-finished'));
    await Promise.resolve();
    expect(client.sent.some(value => typeof value === 'string' && value.includes('"type":"result"'))).toBe(false);
    resolve(); for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(client.sent.some(value => typeof value === 'string' && value.includes('"type":"result"'))).toBe(true);
  });

  it('acknowledges cumulative received bytes only when negotiated by a v2 client', () => {
    const client = new Socket(), provider = new Socket();
    serveSession(client as unknown as WebSocket, provider as unknown as WebSocket, 'task', () => {}, undefined, true);
    provider.message(providerEvent('task-started')); client.message(new ArrayBuffer(6400)); client.message(new ArrayBuffer(3200));
    expect(client.sent.map(value => JSON.parse(value as string))).toEqual([
      { type: 'ready', maxSeconds: 120, requestId: 'task', flowControl: 'ack.v1' },
      { type: 'ack', bytes: 6400 }, { type: 'ack', bytes: 9600 },
    ]);
  });

});
