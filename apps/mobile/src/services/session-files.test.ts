import { receiveSessionFile, validateSessionFiles } from './session-files';
const file = { id: 'handle', name: 'report.pdf', size: 3, mimeType: 'application/pdf' };
const signal = () => new AbortController();
it('requires safe bounded metadata before writing', () => {
  for (const change of [{ name: '../a.pdf' }, { name: '.env' }, { size: 11 * 1024 * 1024 }, { id: '' }, { mimeType: 'bad' }]) expect(() => validateSessionFiles({ files: [{ ...file, ...change }] })).toThrow();
  expect(() => validateSessionFiles({ files: [file, file] })).toThrow();
});
it('writes only verified chunks in order and reports completion', async () => {
  const read = jest.fn().mockResolvedValue({ offset: 0, total: 3, data: 'YWJj', done: true });
  const write = jest.fn(); const progress = jest.fn();
  await receiveSessionFile({ read, list: jest.fn() }, 'session', file, signal().signal, write, progress);
  expect(read).toHaveBeenCalledWith('session', 'handle', 0);
  expect(write).toHaveBeenCalledWith(new Uint8Array([97, 98, 99])); expect(progress).toHaveBeenLastCalledWith(1);
});
it.each([{ offset: 1 }, { total: 4 }, { done: false }, { data: '!!!!' }, { data: 'YQ==' }])('rejects malformed transfer %j without writing', async change => {
  const write = jest.fn();
  await expect(receiveSessionFile({ read: jest.fn().mockResolvedValue({ offset: 0, total: 3, data: 'YWJj', done: true, ...change }), list: jest.fn() }, 'session', file, signal().signal, write, jest.fn())).rejects.toThrow();
  expect(write).not.toHaveBeenCalled();
});
it('cancellation during a request discards the response', async () => {
  const controller = signal(); const write = jest.fn();
  const read = jest.fn(async () => { controller.abort(); return { offset: 0, total: 3, data: 'YWJj', done: true }; });
  await expect(receiveSessionFile({ read, list: jest.fn() }, 'session', file, controller.signal, write, jest.fn())).rejects.toThrow('cancelled');
  expect(write).not.toHaveBeenCalled();
});
