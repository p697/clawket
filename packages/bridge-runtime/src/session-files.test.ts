import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, linkSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SESSION_FILE_CHUNK, SESSION_FILE_LIMIT, SessionFileStore, sessionFileReferences } from './session-files.js';
const roots: string[] = [];
const root = () => { const value = mkdtempSync(join(tmpdir(), 'clawket-files-')); roots.push(value); return value; };
const reply = (path: string) => [{ role: 'assistant', content: `[Download](<${path}>)` }];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
describe('on-demand session files', () => {
  it('accepts explicit assistant references only and ignores fenced examples', () => {
    expect(sessionFileReferences([{ role: 'user', content: '[x](/tmp/user.pdf)' }, { role: 'tool', content: '[x](/tmp/tool.pdf)' },
      { role: 'assistant', content: '```\n[x](/tmp/example.pdf)\n```\n[Result](<report one.pdf>)\nMEDIA:/tmp/image.png\n`/tmp/data.csv`' }])).toEqual(['report one.pdf', '/tmp/image.png', '/tmp/data.csv']);
  });
  it('streams a bounded file without accepting a caller filesystem path or crossing session scope', () => {
    const dir = root(); const path = join(dir, 'report.pdf'); const bytes = Buffer.alloc(SESSION_FILE_CHUNK + 13, 79); writeFileSync(path, bytes);
    const store = new SessionFileStore(); const [file] = store.list('one', reply(path), [dir]);
    for (let n = 0; n < 140; n++) expect(store.list('one', reply(path), [dir])[0].id).toBe(file.id);
    expect(file.name).toBe('report.pdf'); expect(file).not.toHaveProperty('path');
    expect(() => store.read('two', file.id, 0)).toThrow(); expect(() => store.read('one', path, 0)).toThrow();
    const a = store.read('one', file.id, 0); const b = store.read('one', file.id, SESSION_FILE_CHUNK);
    expect(a.done).toBe(false); expect(b.done).toBe(true);
    expect(Buffer.concat([Buffer.from(a.data, 'base64'), Buffer.from(b.data, 'base64')])).toEqual(bytes);
    expect(() => store.read('one', file.id, 1)).toThrow(); store.forget('one'); expect(() => store.read('one', file.id, 0)).toThrow();
    const [again] = store.list('one', reply(path), [dir]); store.clear(); expect(() => store.read('one', again.id, 0)).toThrow();
  });
  it('refuses traversal, links, hidden/private files, directories and oversized files', () => {
    const dir = root(); const outside = root(); writeFileSync(join(outside, 'outside.pdf'), 'private');
    writeFileSync(join(dir, 'good.pdf'), 'good'); symlinkSync(join(outside, 'outside.pdf'), join(dir, 'link.pdf'));
    linkSync(join(dir, 'good.pdf'), join(dir, 'hard.pdf')); mkdirSync(join(dir, '.private')); writeFileSync(join(dir, '.private', 'secret.txt'), 'secret');
    writeFileSync(join(dir, 'MEMORY.md'), 'secret'); mkdirSync(join(dir, 'folder.pdf')); writeFileSync(join(dir, 'large.pdf'), ''); truncateSync(join(dir, 'large.pdf'), SESSION_FILE_LIMIT + 1);
    const paths = [join(outside, 'outside.pdf'), 'link.pdf', 'hard.pdf', '.private/secret.txt', 'MEMORY.md', 'folder.pdf', 'large.pdf', 'https://example.com/a.pdf'];
    expect(new SessionFileStore().list('one', paths.flatMap(reply), [dir])).toEqual([]);
  });
  it('refuses replacement or modification after listing and permits empty files', () => {
    const dir = root(); const path = join(dir, 'result.csv'); writeFileSync(path, '');
    const store = new SessionFileStore(); const [file] = store.list('one', reply(path), [dir]);
    expect(store.read('one', file.id, 0)).toEqual({ offset: 0, total: 0, data: '', done: true });
    writeFileSync(path, 'changed'); expect(() => store.read('one', file.id, 0)).toThrow('changed');
  });
});
