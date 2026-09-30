import { OpenClawArtifactReader } from './openclaw-artifacts';
const readers: OpenClawArtifactReader[] = [];
afterEach(() => { readers.splice(0).forEach(r => r.clear()); jest.restoreAllMocks(); });
function setup(result: unknown) {
  const request = jest.fn().mockImplementation(async (method: string) => method === 'artifacts.get' ? { artifact: { ...(result as any).artifact, download: { mode: (result as any).url ? 'url' : 'bytes' } } } : result);
  const reader = new OpenClawArtifactReader(request, 'wss://gateway.example'); readers.push(reader); return { request, reader, ops: reader.operations };
}
it('reads inline files with exact session identity and retires completed buffers', async () => {
  const { ops, request } = setup({ artifact: { id: 'a', mimeType: 'application/pdf', title: 'report.pdf', sizeBytes: 1 }, encoding: 'base64', data: 'YQ==' });
  const file = await ops.open('session', 'a'); expect(file.name).toBe('report.pdf');
  expect(request).toHaveBeenCalledWith('artifacts.download', { sessionKey: 'session', artifactId: 'a' });
  await expect(ops.read('other', file.id, 0)).rejects.toThrow();
  expect(await ops.read('session', file.id, 0)).toEqual({ offset: 0, total: 1, data: 'YQ==', done: true });
  await expect(ops.read('session', file.id, 0)).rejects.toThrow();
});
it.each(['https://evil.example/api/chat/media/outgoing/a', '/config', 'https://user:pass@gateway.example/api/chat/media/outgoing/a'])('does not fetch arbitrary URLs %s', url => {
  return expect(setup({ artifact: { id: 'a' }, url }).ops.open('session', 'a')).rejects.toThrow();
});
it('rejects stale response after connection retirement', async () => {
  let resolve!: (value: unknown) => void;
  const reader = new OpenClawArtifactReader(() => new Promise(r => { resolve = r; }), 'wss://gateway.example'); readers.push(reader);
  const promise = reader.operations.open('session', 'a'); reader.clear();
  resolve({ artifact: { id: 'a' }, encoding: 'base64', data: 'YQ==' }); await expect(promise).rejects.toThrow();
});
it('rejects malformed content and declared oversize before decoding', async () => {
  for (const value of [{ artifact: { id: 'wrong' }, encoding: 'base64', data: 'YQ==' }, { artifact: { id: 'a', sizeBytes: 11 * 1024 * 1024 }, encoding: 'base64', data: 'YQ==' }, { artifact: { id: 'a' }, encoding: 'base64', data: '%%%invalid' }]) await expect(setup(value).ops.open('session', 'a')).rejects.toThrow();
});
