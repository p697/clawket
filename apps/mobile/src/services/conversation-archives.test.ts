import AsyncStorage from '@react-native-async-storage/async-storage';
import { ConversationArchives, searchConversationArchives } from './conversation-archives';
import type { ConversationExport } from './conversation-export';
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const scope = { connectionId: 'one', agentId: 'main', sessionKey: 'main' };
const transcript: ConversationExport = { title: 'A report', messages: [{ role: 'user', text: 'Find sources', attachments: ['Research.pdf'] }, { role: 'assistant', text: 'A complete answer', attachments: [] }] };
beforeEach(async () => { await AsyncStorage.clear(); });
test('saves full snapshots, deduplicates exact scopes and retains distinct backend/Agent identities', async () => {
  const [a, b] = await Promise.all([ConversationArchives.save(scope, transcript), ConversationArchives.save(scope, transcript)]);
  expect(a.id).toBe(b.id);
  await ConversationArchives.save({ ...scope, connectionId: 'two' }, transcript);
  await ConversationArchives.save({ ...scope, agentId: 'other' }, transcript);
  expect(await ConversationArchives.list()).toHaveLength(3);
  await ConversationArchives.clearConnection('one');
  expect((await ConversationArchives.list()).map(v => v.connectionId)).toEqual(['two']);
});
test('projects safe public fields and exports no hidden attachment bytes or private metadata', async () => {
  const value = { ...transcript, privateToken: 'secret', messages: [{ ...transcript.messages[0], base64: 'secret', localUri: 'file:///private' }] };
  await ConversationArchives.save(scope, value);
  const raw = await AsyncStorage.getItem('clawket.conversation-archives.v1');
  expect(raw).not.toMatch(/secret|file:\/\/\/private/);
  const entries = await ConversationArchives.list();
  expect(searchConversationArchives(entries, 'RESEARCH')).toHaveLength(1);
  expect(searchConversationArchives(entries, 'missing')).toHaveLength(0);
  await ConversationArchives.remove(entries[0].id);
  expect(await ConversationArchives.list()).toEqual([]);
});
test('refuses oversized writes without evicting a saved conversation', async () => {
  await ConversationArchives.save(scope, transcript);
  await expect(ConversationArchives.save(scope, { title: 'Big', messages: [{ role: 'assistant', text: 'x'.repeat(500_001), attachments: [] }] })).rejects.toThrow('archive_full');
  expect(await ConversationArchives.list()).toHaveLength(1);
});
test('bounds total retained content and record count without silent truncation', async () => {
  const message = { role: 'assistant' as const, text: 'x'.repeat(400_000), attachments: [] };
  await ConversationArchives.save(scope, { title: 'One', messages: [message] });
  await ConversationArchives.save(scope, { title: 'Two', messages: [message] });
  await expect(ConversationArchives.save(scope, { title: 'Three', messages: [message] })).rejects.toThrow('archive_full');
  expect(await ConversationArchives.list()).toHaveLength(2);
  await AsyncStorage.clear();
  for (let i = 0; i < 100; i++) await ConversationArchives.save(scope, { ...transcript, title: `${i}` });
  await expect(ConversationArchives.save(scope, transcript)).rejects.toThrow('archive_full');
  expect(await ConversationArchives.list()).toHaveLength(100);
});
test('fails closed on corrupt persisted records and preserves them for recovery', async () => {
  await AsyncStorage.setItem('clawket.conversation-archives.v1', '[{"id":"bad"}]');
  await expect(ConversationArchives.list()).rejects.toThrow('archive_invalid');
  await expect(ConversationArchives.save(scope, transcript)).rejects.toThrow('archive_invalid');
  expect(await AsyncStorage.getItem('clawket.conversation-archives.v1')).toBe('[{"id":"bad"}]');
});

test('renames and pins without changing snapshot identity, content, or exact-save deduplication', async () => {
  const entry = await ConversationArchives.save(scope, transcript);
  await Promise.all([ConversationArchives.rename(entry.id, '  Final report  '), ConversationArchives.setPinned(entry.id, true)]);
  const saved = await ConversationArchives.save(scope, transcript);
  expect(saved).toEqual({ ...entry, name: 'Final report', pinned: true });
  expect(saved.transcript).toEqual(transcript);
  expect(await ConversationArchives.list()).toHaveLength(1);
  expect(searchConversationArchives([saved], 'final')).toEqual([saved]);
  expect(searchConversationArchives([saved], 'A report')).toEqual([saved]);
});

test('filters files and pins, sorts stably, and does not mutate saved input order', async () => {
  const first = await ConversationArchives.save(scope, transcript);
  const second = await ConversationArchives.save({ ...scope, connectionId: 'two' }, { title: 'Text', messages: [] });
  const pinned = await ConversationArchives.setPinned(first.id, true);
  const input = [{ ...second, savedAt: 99999 }, { ...pinned, savedAt: 1 }];
  expect(searchConversationArchives(input, '').map(value => value.id)).toEqual([first.id, second.id]);
  expect(searchConversationArchives(input, '', 'files').map(value => value.id)).toEqual([first.id]);
  expect(searchConversationArchives(input, 'missing', 'pinned')).toEqual([]);
  expect(input[0].id).toBe(second.id);
  const unpinned = await ConversationArchives.setPinned(first.id, false);
  expect(searchConversationArchives([unpinned], '', 'pinned')).toEqual([]);
});

test('rejects invalid metadata and deleted-record updates without damaging saved work', async () => {
  const entry = await ConversationArchives.save(scope, transcript);
  const before = await AsyncStorage.getItem('clawket.conversation-archives.v1');
  for (const name of ['', '  ', 'x'.repeat(201)]) await expect(ConversationArchives.rename(entry.id, name)).rejects.toThrow('archive_invalid');
  await expect(ConversationArchives.rename('unknown', 'Title')).rejects.toThrow('archive_missing');
  expect(await AsyncStorage.getItem('clawket.conversation-archives.v1')).toBe(before);
  await ConversationArchives.remove(entry.id);
  await expect(ConversationArchives.setPinned(entry.id, true)).rejects.toThrow('archive_missing');
  expect(await ConversationArchives.list()).toEqual([]);
});

test.each([{ pinned: 'true' }, { name: '  title' }, { name: 'x'.repeat(201) }])('fails closed on corrupt saved organization metadata %j', async patch => {
  const entry = await ConversationArchives.save(scope, transcript);
  const raw = JSON.stringify([{ ...entry, ...patch }]);
  await AsyncStorage.setItem('clawket.conversation-archives.v1', raw);
  await expect(ConversationArchives.list()).rejects.toThrow('archive_invalid');
  expect(await AsyncStorage.getItem('clawket.conversation-archives.v1')).toBe(raw);
});
