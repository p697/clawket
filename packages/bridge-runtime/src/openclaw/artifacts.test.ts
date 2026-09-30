import { afterEach, expect, it, vi } from 'vitest';
import { OpenClawArtifacts, artifactDownloadUrl } from './artifacts.js';
import { SESSION_FILE_CHUNK, SESSION_FILE_LIMIT } from '../session-files.js';
const channels: OpenClawArtifacts[] = [];
afterEach(() => { channels.splice(0).forEach(c => c.dispose()); vi.useRealTimers(); });
function setup(payload: any, http = vi.fn(), scopes = ['operator.read']) {
  const frames: any[] = [];
  const channel = new OpenClawArtifacts({ gatewayUrl: 'ws://127.0.0.1:18789', nativeMethods: ['artifacts.get', 'artifacts.download'], scopes,
    fetch: http, sendClient: value => frames.push(JSON.parse(value)), sendGateway: value => {
      const frame = JSON.parse(value);
      channel.handleResponse(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload: frame.method === 'artifacts.get' ? { artifact: { ...payload.artifact, download: { mode: payload.url ? 'url' : 'bytes' } } } : payload }));
    } }); channels.push(channel);
  let id = 0;
  async function call(method: 'open' | 'read', params: object) {
    const requestId = String(++id);
    channel.handleRequest(JSON.stringify({ type: 'req', id: requestId, method: `clawket.artifacts.${method}`, params: { sessionKey: 'agent:main:test', ...params } }));
    await vi.waitFor(() => expect(frames.some(f => f.id === requestId)).toBe(true));
    return frames.find(f => f.id === requestId);
  }
  return { channel, frames, call, http };
}
it('downloads a ticket on the authenticated channel and streams exact bounded chunks', async () => {
  const bytes = Buffer.alloc(SESSION_FILE_CHUNK + 5, 42);
  const http = vi.fn().mockResolvedValue(new Response(bytes, { headers: { 'content-length': String(bytes.length), 'content-type': 'image/png' } }));
  const c = setup({ artifact: { id: 'art', title: 'test.png', mimeType: 'image/png', sizeBytes: bytes.length }, url: '/api/chat/media/outgoing/session/id/full?ticket=PRIVATE' }, http);
  const open = await c.call('open', { artifactId: 'art' }); expect(open.ok).toBe(true);
  expect(JSON.stringify(c.frames)).not.toContain('PRIVATE');
  expect(http.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  const a = await c.call('read', { id: open.payload.id, offset: 0 });
  const denied = await c.call('read', { id: open.payload.id, offset: 0, sessionKey: 'agent:other:test' }); expect(denied.ok).toBe(false);
  const b = await c.call('read', { id: open.payload.id, offset: SESSION_FILE_CHUNK });
  expect(Buffer.concat([Buffer.from(a.payload.data, 'base64'), Buffer.from(b.payload.data, 'base64')])).toEqual(bytes);
  expect(b.payload.done).toBe(true);
  expect((await c.call('read', { id: open.payload.id, offset: 0 })).ok).toBe(false);
});
it.each(['https://evil.test/api/chat/media/outgoing/a', 'http://127.0.0.1:8642/api/chat/media/outgoing/a', '/config', '//evil.test/api/chat/media/outgoing/a', 'http://user:pass@127.0.0.1:18789/api/chat/media/outgoing/a'])('rejects non-ticket target %s', value => {
  expect(() => artifactDownloadUrl(value, 'ws://127.0.0.1:18789')).toThrow();
});
it('rejects missing read scope, wrong artifact identity, oversize declarations and malformed base64', async () => {
  for (const [payload, scopes] of [
    [{ artifact: { id: 'art' }, encoding: 'base64', data: 'YQ==' }, []],
    [{ artifact: { id: 'other' }, encoding: 'base64', data: 'YQ==' }, ['operator.read']],
    [{ artifact: { id: 'art', sizeBytes: SESSION_FILE_LIMIT + 1 } }, ['operator.read']],
    [{ artifact: { id: 'art' }, encoding: 'base64', data: '#bad' }, ['operator.read']],
  ] as const) expect((await setup(payload, vi.fn(), [...scopes]).call('open', { artifactId: 'art' })).ok).toBe(false);
});
it('bounds streamed bodies even without content-length and redacts errors', async () => {
  const http = vi.fn().mockResolvedValue(new Response(new Uint8Array(SESSION_FILE_LIMIT + 1)));
  const c = setup({ artifact: { id: 'art' }, url: '/api/chat/media/outgoing/a/full?ticket=SECRET' }, http);
  expect((await c.call('open', { artifactId: 'art' })).ok).toBe(false);
  expect(JSON.stringify(c.frames)).not.toContain('SECRET');
});
it('supports inline bytes without HTTP, and rejects a mismatched size', async () => {
  const c = setup({ artifact: { id: 'art', mimeType: 'application/pdf', title: 'report.pdf', sizeBytes: 1 }, encoding: 'base64', data: 'YQ==' });
  const opened = await c.call('open', { artifactId: 'art' }); expect(opened.payload.name).toBe('report.pdf');
  expect((await c.call('read', { id: opened.payload.id, offset: 1 })).ok).toBe(false);
  expect((await c.call('read', { id: opened.payload.id, offset: 0 })).payload.data).toBe('YQ=='); expect(c.http).not.toHaveBeenCalled();
  expect((await setup({ artifact: { id: 'art', sizeBytes: 2 }, encoding: 'base64', data: 'YQ==' }).call('open', { artifactId: 'art' })).ok).toBe(false);
});
it('retires buffers and suppresses late responses after disposal', async () => {
  let finish!: (v: Response) => void;
  const http = vi.fn<typeof fetch>(() => new Promise<Response>(resolve => { finish = resolve; }));
  const c = setup({ artifact: { id: 'art' }, url: '/api/chat/media/outgoing/a/full' }, http);
  c.channel.handleRequest(JSON.stringify({ type: 'req', id: 'late', method: 'clawket.artifacts.open', params: { sessionKey: 'agent:main:test', artifactId: 'art' } }));
  await vi.waitFor(() => expect(http).toHaveBeenCalled()); c.channel.dispose();
  expect(http.mock.calls[0]?.[1]?.signal.aborted).toBe(true);
  finish(new Response('ok')); await new Promise(resolve => setTimeout(resolve, 0)); expect(c.frames).toEqual([]);
});

it('bounds retained downloads across isolated channels and frees admission after expiry', async () => {
  vi.useFakeTimers();
  const payload = { artifact: { id: 'art', sizeBytes: 1 }, encoding: 'base64', data: 'YQ==' };
  const first = setup(payload); const second = setup(payload); const third = setup(payload);
  expect((await first.call('open', { artifactId: 'art' })).ok).toBe(true);
  expect((await second.call('open', { artifactId: 'art' })).ok).toBe(true);
  expect((await third.call('open', { artifactId: 'art' })).ok).toBe(false);
  await vi.advanceTimersByTimeAsync(120_001);
  expect((await third.call('open', { artifactId: 'art' })).ok).toBe(true);
});
