import AsyncStorage from '@react-native-async-storage/async-storage';
import { DocumentVersions, documentDiff } from './document-versions';
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
beforeEach(async () => { await AsyncStorage.clear(); });

test('serializes local snapshots, deduplicates content and isolates documents', async () => {
  await Promise.all([DocumentVersions.capture('one:main:memory', 'first'), DocumentVersions.capture('one:main:memory', 'second')]);
  await DocumentVersions.capture('one:main:memory', 'second');
  expect((await DocumentVersions.list('one:main:memory')).map(v => v.content)).toEqual(['second', 'first']);
  expect(await DocumentVersions.list('two:main:memory')).toEqual([]);
  await DocumentVersions.clear('one:main:memory');
  expect(await DocumentVersions.list('one:main:memory')).toEqual([]);
});

test('bounds history and refuses corrupt archives', async () => {
  for (let i = 0; i < 20; i++) await DocumentVersions.capture('one', `${i}`);
  expect(await DocumentVersions.list('one')).toHaveLength(12);
  await DocumentVersions.capture('one', 'x'.repeat(50_001));
  expect(await DocumentVersions.list('one')).toHaveLength(12);
  await AsyncStorage.setItem('clawket.document-versions.v1', '{"bad":[]}');
  await expect(DocumentVersions.list('one')).rejects.toThrow('invalid');
});

test('shows the changes that restoring a previous version would make', () => {
  expect(documentDiff('Title\nnew\nEnd', 'Title\nold\nEnd')).toEqual([
    { kind: 'same', text: 'Title' }, { kind: 'removed', text: 'new' },
    { kind: 'added', text: 'old' }, { kind: 'same', text: 'End' },
  ]);
  expect(documentDiff('same', 'same')).toEqual([{ kind: 'same', text: 'same' }]);
});


test('connection removal clears only its owned document versions', async () => {
  await DocumentVersions.capture('one:memory', 'private one', 'one');
  await DocumentVersions.capture('two:memory', 'private two', 'two');
  await DocumentVersions.clearConnection('one');
  expect(await DocumentVersions.list('one:memory')).toEqual([]);
  expect((await DocumentVersions.list('two:memory'))[0]?.content).toBe('private two');
});

test('recapturing identical legacy content attaches its connection for cleanup', async () => {
  await DocumentVersions.capture('one:memory', 'earlier');
  await DocumentVersions.capture('one:memory', 'latest');
  await DocumentVersions.capture('one:memory', 'latest', 'one');
  expect(await DocumentVersions.list('one:memory')).toHaveLength(2);
  await DocumentVersions.clearConnection('one');
  expect(await DocumentVersions.list('one:memory')).toEqual([]);
});
