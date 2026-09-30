import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, realpathSync, writeFileSync, rmSync, symlinkSync, linkSync, truncateSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeliveredArtifacts } from './delivered-artifacts.js';
import { SESSION_FILE_CHUNK, SESSION_FILE_LIMIT } from './session-files.js';
import { codexMessages } from './codex/history.js';
import { HermesArtifacts } from './hermes/artifacts.js';

const dirs: string[] = [], stores: DeliveredArtifacts[] = [];
const root = () => { const path = realpathSync(mkdtempSync(join(tmpdir(), 'clawket-artifacts-'))); dirs.push(path); return path; };
const store = () => { const value = new DeliveredArtifacts(); stores.push(value); return value; };
const message = (text: string) => ({ id: 'reply', role: 'assistant' as const, text });
afterEach(() => { stores.splice(0).forEach(s => s.clear()); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); vi.useRealTimers(); });

it('uses stable session-scoped references across restart, streams exact bytes and rejects mutation', async () => {
  const dir = root(), path = join(dir, 'image.png'), bytes = Buffer.alloc(SESSION_FILE_CHUNK + 17, 7); writeFileSync(path, bytes);
  const first = store(), text = `![image](<${path}>)`;
  const id = first.project('one', [message(text)], [dir])[0].attachments![0].artifactId!;
  expect(first.project('two', [message(text)], [dir])[0].attachments![0].artifactId).not.toBe(id);
  const second = store();
  const file = await second.resolve('one', id, async () => second.project('one', [message(text)], [dir]));
  expect(file).toMatchObject({ id, name: 'image.png', size: bytes.length });
  expect(() => second.read('two', id, 0)).toThrow();
  expect(Buffer.concat([0, SESSION_FILE_CHUNK].map(offset => Buffer.from(second.read('one', id, offset).data, 'base64')))).toEqual(bytes);
  writeFileSync(path, 'changed'); expect(() => second.read('one', id, 0)).toThrow();
});

it('refuses user/tool paths, examples, external roots, private files, links, oversize files and arbitrary client paths', async () => {
  const dir = root(), other = root(), s = store();
  writeFileSync(join(other, 'outside.txt'), 'outside'); writeFileSync(join(dir, 'secret.txt'), 'private');
  symlinkSync(join(other, 'outside.txt'), join(dir, 'symlink.txt')); linkSync(join(dir, 'secret.txt'), join(dir, 'hard.txt'));
  mkdirSync(join(dir, '.private')); writeFileSync(join(dir, '.private', 'data.txt'), 'private');
  writeFileSync(join(dir, 'credentials.json'), '{}'); writeFileSync(join(dir, 'big.txt'), ''); truncateSync(join(dir, 'big.txt'), SESSION_FILE_LIMIT + 1);
  const refs = ['../outside.txt', join(other, 'outside.txt'), 'symlink.txt', 'hard.txt', '.private/data.txt', 'credentials.json', 'big.txt', 'https://example.com/x.png'];
  for (const ref of refs) expect(s.project('one', [message(`[file](<${ref}>)`)], [dir])[0].attachments).toBeUndefined();
  writeFileSync(join(dir, 'ok.txt'), 'ok');
  const text = '[file](ok.txt)';
  expect(s.project('one', [{ ...message(text), role: 'user' }, { ...message(text), role: 'tool' }, message('```\n'+text+'\n```')], [dir]).some(m => m.attachments)).toBe(false);
  const refresh = vi.fn(); await expect(s.resolve('one', join(dir, 'ok.txt'), refresh)).rejects.toThrow(); expect(refresh).not.toHaveBeenCalled();
});

it('does not revive handles through pending history after reset or stop', async () => {
  const dir = root(), s = store(); writeFileSync(join(dir, 'ok.txt'), 'ok');
  const epoch = s.epoch; s.forget('one');
  expect(() => s.project('one', [message('[file](ok.txt)')], [dir], epoch)).toThrow('changed');
  const id = s.project('one', [message('[file](ok.txt)')], [dir])[0].attachments![0].artifactId!;
  s.clear(); expect(() => s.read('one', id, 0)).toThrow();
});

it('converts only successful native generated images to bounded transient attachments, not viewed images', async () => {
  vi.useFakeTimers(); const s = store();
  const bytes = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(30)]);
  const item = { type: 'imageGeneration', id: 'native-image', status: 'completed', result: bytes.toString('base64') };
  const messages = codexMessages([{ id: 'turn', items: [item, { type: 'imageView', id: 'view', path: '/private/file.png' }] }]);
  const result = s.project('one', messages, []), attachment = result.find(m => m.attachments)?.attachments![0];
  expect(result.filter(m => m.attachments)).toHaveLength(1);
  expect(attachment?.content).toBeUndefined(); expect(JSON.stringify(result)).not.toContain(item.result);
  expect(Buffer.from(s.read('one', attachment!.artifactId!, 0).data, 'base64')).toEqual(bytes);
  expect(() => s.open('two', attachment!.artifactId!)).toThrow();
  vi.advanceTimersByTime(120_001); expect(() => s.open('one', attachment!.artifactId!)).toThrow();
  expect(codexMessages([{ items: [{ ...item, status: 'failed' }] }]).some(m => m.attachments)).toBe(false);
});

it('Hermes preserves native content while adding authorized image/file blocks and fences root lookups', async () => {
  const dir = root(); writeFileSync(join(dir, 'image.png'), 'image'); writeFileSync(join(dir, 'report.txt'), 'report');
  let generation = 0; const loadRoots = vi.fn(async () => [dir]);
  const s = new HermesArtifacts(loadRoots, () => generation); stores.push(s);
  const load = async () => ({ messages: [{ role: 'assistant' as const, content: 'MEDIA:image.png\n[Report](report.txt)', timestamp: 1 }] });
  const result = await s.history('one', load), content = result.messages[0].content as any[];
  expect(content.filter(p => p.artifactId)).toHaveLength(2); expect(content[0].text).toContain('MEDIA:'); expect(content[0].artifactDisplayText).not.toContain('MEDIA:'); expect((await load()).messages[0].content).toContain('MEDIA:');
  await s.history('one', load); expect(loadRoots).toHaveBeenCalledTimes(1);
  let finish!: (value: Awaited<ReturnType<typeof load>>) => void;
  const pending = s.history('one', () => new Promise(resolve => { finish = resolve; })); generation++; finish(await load());
  await expect(pending).rejects.toThrow('changed');
});

it('removes only delivered links, preserves fenced examples and external links, and treats SVG as a file', () => {
  const dir = root(), s = store(); writeFileSync(join(dir, 'report.svg'), '<svg/>');
  const text = 'Here is the result.\n![Plot](report.svg)\n[Website](https://example.com/report.svg)\n~~~\n[Example](report.svg)\n~~~';
  const projected = s.project('one', [message(text)], [dir])[0];
  expect(projected.attachments).toEqual([expect.objectContaining({ type: 'file', mimeType: 'image/svg+xml' })]);
  expect(projected.text).toBe(text);
  expect(projected.artifactDisplayText).not.toContain('![Plot]'); expect(projected.artifactDisplayText).toContain('[Website]'); expect(projected.artifactDisplayText).toContain('[Example]');
  const final = s.final({ type: 'run_finished', sessionKey: 'one', runId: 'run', stopReason: 'end_turn', message: { role: 'assistant', content: text } }, [dir]);
  expect((final as any).message.content).toBe(text);
  expect((final as any).message.artifactDisplayText).toBe(projected.artifactDisplayText);
});
it('converts a full-size image without leaking Base64 and retains user images unchanged', () => {
  const s = store(), content = Buffer.alloc(5 * 1024 * 1024, 5).toString('base64');
  const attachment = { type: 'image' as const, mimeType: 'image/png', content };
  const [assistant, user] = s.project('one', [{ ...message(''), attachments: [attachment] }, { ...message(''), role: 'user', attachments: [attachment] }], []);
  expect(assistant.attachments![0].content).toBeUndefined();
  expect(s.open('one', assistant.attachments![0].artifactId!).size).toBe(5 * 1024 * 1024);
  expect(user.attachments![0].content).toBe(content);
});
it('reauthorizes an expired historical handle through its original bounded native page', async () => {
  vi.useFakeTimers(); const dir = root(), s = store(); writeFileSync(join(dir, 'older.txt'), 'older');
  const messages = [message('[Older](older.txt)')];
  const id = s.project('one', messages, [dir], s.epoch, 'older-page')[0].attachments![0].artifactId!;
  vi.advanceTimersByTime(15 * 60_000 + 1);
  const refresh = vi.fn(async cursor => { expect(cursor).toBe('older-page'); s.project('one', messages, [dir], s.epoch, cursor); });
  expect(await s.resolve('one', id, refresh)).toMatchObject({ id, name: 'older.txt' });
  expect(refresh).toHaveBeenCalledTimes(1);
});
