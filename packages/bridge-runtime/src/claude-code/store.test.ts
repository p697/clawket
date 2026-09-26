import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeStore } from './store.js';
const cleanups: (() => void)[] = [];
afterEach(() => { for (const close of cleanups.splice(0).reverse()) close(); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'clawket-claude-store-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const scope = { project: dir, device: false };
  const open = () => { const store = new ClaudeStore(dir, scope); cleanups.push(() => store.close()); return store; };
  return { dir, scope, open };
}
describe('Claude durable metadata ownership', () => {
  it('rejects a second live writer and preserves accepted message identities across restart', () => {
    const { dir, open } = fixture(); const store = open();
    store.records.push({ key: randomUUID(), cwd: dir, title: 'QA', createdAt: 1, fingerprints: {
      ['a'.repeat(64)]: { hash: 'b'.repeat(64), runId: randomUUID(), clientKey: 'retry-key' },
    } }); store.save();
    expect(() => open()).toThrow('already has');
    const expected = structuredClone(store.records); store.close();
    expect(open().records).toEqual(expected);
  });
  it('rejects corrupt state without replacing it or stranding an owner lock', () => {
    const { dir, open } = fixture(); writeFileSync(join(dir, 'sessions.json'), '{broken');
    expect(() => open()).toThrow();
    expect(readFileSync(join(dir, 'sessions.json'), 'utf8')).toBe('{broken');
    rmSync(join(dir, 'sessions.json'));
    expect(open().records).toEqual([]);
  });
  it('never follows an index symlink or silently widens the recorded scope', () => {
    const { dir, scope, open } = fixture(); const target = join(dir, 'external.json');
    writeFileSync(target, JSON.stringify({ version: 1, ...scope, sessions: [] }));
    symlinkSync(target, join(dir, 'sessions.json'));
    expect(() => open()).toThrow('index file');
    rmSync(join(dir, 'sessions.json'));
    writeFileSync(join(dir, 'sessions.json'), JSON.stringify({ version: 1, ...scope, device: true, sessions: [] }));
    expect(() => open()).toThrow('scope');
  });
});
