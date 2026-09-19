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
  it('streams PCM after ready and returns completed text once after finish', () => {
    const { client, provider, release } = setup();
    provider.message(providerEvent('task-started')); client.message(new ArrayBuffer(6400));
    provider.message(providerEvent('result-generated', 'hello'));
    client.message('{"type":"finish"}'); provider.message(providerEvent('task-finished'));
    expect(client.sent.map((v) => JSON.parse(v as string).type)).toEqual(['ready', 'transcript', 'result']);
    expect(release).toHaveBeenCalledTimes(1); expect(provider.close).toHaveBeenCalled();
  });
  it.each(['cancel', 'close', 'timeout', 'oversized', 'early', 'provider-close'])('cleans both sockets and admission after %s', (mode) => {
    const { client, provider, release } = setup();
    if (mode !== 'early') provider.message(providerEvent('task-started'));
    if (mode === 'cancel') client.message('{"type":"cancel"}');
    if (mode === 'close') client.dispatchEvent(new Event('close'));
    if (mode === 'provider-close') provider.dispatchEvent(new Event('close'));
    if (mode === 'timeout') vi.advanceTimersByTime(16000);
    if (mode === 'oversized') client.message(new ArrayBuffer(32002));
    if (mode === 'early') client.message(new ArrayBuffer(2));
    expect(release).toHaveBeenCalledTimes(1); expect(provider.close).toHaveBeenCalled(); expect(client.close).toHaveBeenCalled();
    client.dispatchEvent(new Event('close')); expect(release).toHaveBeenCalledTimes(1);
  });
  it('rejects unsolicited provider completion instead of sending a prompt', () => {
    const { client, provider } = setup(); provider.message(providerEvent('task-finished'));
    expect(client.sent).not.toContainEqual(expect.stringContaining('"type":"result"'));
  });
});
