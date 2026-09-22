import AsyncStorage from '@react-native-async-storage/async-storage';
import { IncomingShareStore, SHARED_TEXT_LIMIT, validateSharedPayloads } from './incoming-share';
import { Directory } from 'expo-file-system';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const mockFiles = new Map<string, number>();
const mockDirectories = new Set<string>();
jest.mock('expo-file-system', () => ({
  Paths: { document: 'file:///owned' },
  Directory: class MockDirectory {
    uri: string;
    constructor(...parts: any[]) { this.uri = parts.map(part => part.uri ?? part).join('/'); }
    get name() { return this.uri.split('/').pop()!; }
    get exists() { return mockDirectories.has(this.uri); }
    create() { mockDirectories.add(this.uri); mockDirectories.add('file:///owned/incoming-share'); }
    delete() { for (const key of mockFiles.keys()) if (key.startsWith(this.uri + '/')) mockFiles.delete(key); mockDirectories.delete(this.uri); }
    list() {
      const direct = (key: string) => key.startsWith(this.uri + '/') && !key.slice(this.uri.length + 1).includes('/');
      const { File } = require('expo-file-system');
      return [...[...mockDirectories].filter(direct).map(key => new MockDirectory(key)), ...[...mockFiles.keys()].filter(direct).map(key => new File(key))];
    }
  },
  File: class {
    uri: string;
    constructor(...parts: any[]) { this.uri = parts.map(part => part.uri ?? part).join('/'); }
    get name() { return this.uri.split('/').pop()!; }
    get size() { return mockFiles.get(this.uri) ?? 0; }
    copy(target: { uri: string }) { mockFiles.set(target.uri, this.size); }
  },
}));
const payload = (value: string) => ({ value, shareType: 'text' as const, mimeType: 'text/plain' });

beforeEach(async () => { await AsyncStorage.clear(); mockFiles.clear(); mockDirectories.clear(); });

test('retains text privately and deduplicates concurrent OS deliveries until explicit consumption', async () => {
  const [first, repeated] = await Promise.all([IncomingShareStore.capture([payload('hello')]), IncomingShareStore.capture([payload('hello')])]);
  expect(first.id).toBe(repeated.id);
  expect(await IncomingShareStore.list()).toHaveLength(1);
  await IncomingShareStore.remove(first.id);
  expect(await IncomingShareStore.list()).toEqual([]);
  expect((await IncomingShareStore.capture([payload('hello')])).text).toBe('hello');
});

test('counts separators and refuses executable URLs and unowned file schemes', () => {
  expect(() => validateSharedPayloads([payload('x'.repeat(SHARED_TEXT_LIMIT))])).not.toThrow();
  expect(() => validateSharedPayloads([payload('x'.repeat(SHARED_TEXT_LIMIT - 1)), payload('y')])).toThrow('share_too_large');
  expect(() => validateSharedPayloads([{ value: 'javascript:alert(1)', shareType: 'url' }])).toThrow('share_invalid');
  expect(() => validateSharedPayloads([{ value: 'https://remote/file', shareType: 'file' }])).toThrow('share_invalid');
  expect(() => validateSharedPayloads([])).toThrow('share_invalid');
});

test('rejects corrupted stored file metadata instead of opening arbitrary local paths', async () => {
  const first = await IncomingShareStore.capture([payload('hello')]);
  await AsyncStorage.setItem('clawket.incoming-shares.v1', JSON.stringify([{ ...first,
    files: [{ uri: 'file:///private/secret', size: 12, name: 'secret', mimeType: 'text/plain' }],
  }]));
  await expect(IncomingShareStore.list()).rejects.toThrow('share_storage_invalid');
});

test('bounds retained sent files and only collects them after explicit successful cache cleanup', async () => {
  mockFiles.set('file:///source/report.pdf', 5 * 1024 * 1024);
  const makeShare = (index: number) => IncomingShareStore.capture([
    payload(String(index)), { value: 'file:///source/report.pdf', shareType: 'file', mimeType: 'application/pdf' },
  ]);
  for (let index = 0; index < 20; index++) {
    const item = await makeShare(index);
    await IncomingShareStore.remove(item.id);
  }
  await expect(makeShare(21)).rejects.toThrow('share_storage_full');
  await expect(IncomingShareStore.clearConsumedAfter(async () => { throw new Error('cache failed'); })).rejects.toThrow('cache failed');
  expect(new Directory('file:///owned/incoming-share').list()).toHaveLength(20);
  await IncomingShareStore.clearConsumedAfter(async () => undefined);
  expect(new Directory('file:///owned/incoming-share').list()).toHaveLength(0);
  const pending = await makeShare(22);
  await IncomingShareStore.clearConsumedAfter(async () => undefined);
  expect((await IncomingShareStore.list())[0].id).toBe(pending.id);
  expect(mockFiles.has(pending.files[0].uri)).toBe(true);
});

test('text shares create no file directories and pending acknowledgements wait for cache cleanup', async () => {
  const pending = await IncomingShareStore.capture([payload('retain me')]);
  expect(mockDirectories.size).toBe(0);
  let finish!: () => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const cleanup = IncomingShareStore.clearConsumedAfter(async () => {
    started(); await new Promise<void>(resolve => { finish = resolve; });
  });
  await entered;
  let acknowledged = false;
  const acknowledgement = IncomingShareStore.remove(pending.id).then(() => { acknowledged = true; });
  await Promise.resolve();
  expect(acknowledged).toBe(false);
  finish(); await cleanup; await acknowledgement;
  expect(await IncomingShareStore.list()).toEqual([]);
});
