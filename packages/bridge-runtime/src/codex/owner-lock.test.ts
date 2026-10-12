import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireCodexOwnerLock } from './owner-lock.js';

let root: string, path: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'codex-owner-')); path = join(root, 'owner.lock'); });
afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

it('retains the legacy PID format and excludes another live owner', () => {
  const close = acquireCodexOwnerLock(path);
  expect(readFileSync(path, 'utf8')).toBe(String(process.pid));
  expect(() => acquireCodexOwnerLock(path)).toThrow('already managed');
  close(); expect(existsSync(path)).toBe(false);
});
it('reclaims a confirmed dead PID and releases its recovery guard', () => {
  writeFileSync(path, '12345');
  vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); });
  const close = acquireCodexOwnerLock(path);
  expect(readFileSync(path, 'utf8')).toBe(String(process.pid));
  expect(existsSync(path + '.recovery')).toBe(false); close();
});
it('does not let a concurrent recovery remove the first replacement', () => {
  writeFileSync(path, '12345');
  vi.spyOn(process, 'kill').mockImplementation(() => {
    expect(() => acquireCodexOwnerLock(path)).toThrow('recovery is already in progress');
    throw Object.assign(new Error('gone'), { code: 'ESRCH' });
  });
  const close = acquireCodexOwnerLock(path);
  expect(readFileSync(path, 'utf8')).toBe(String(process.pid)); close();
});
it('rejects a lock replaced during the PID probe without deleting the new owner', () => {
  writeFileSync(path, '12345');
  vi.spyOn(process, 'kill').mockImplementation(() => {
    unlinkSync(path); writeFileSync(path, '54321');
    throw Object.assign(new Error('gone'), { code: 'ESRCH' });
  });
  expect(() => acquireCodexOwnerLock(path)).toThrow('changed during recovery');
  expect(readFileSync(path, 'utf8')).toBe('54321');
});
it.each(['EPERM', 'EIO'])('keeps uncertain owner state on %s', code => {
  writeFileSync(path, '12345');
  vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('unverified'), { code }); });
  expect(() => acquireCodexOwnerLock(path)).toThrow('unverified');
  expect(readFileSync(path, 'utf8')).toBe('12345');
});
it.each(['invalid', '', '0', '-1', '9'.repeat(33)])('rejects malformed PID %j', text => {
  writeFileSync(path, text);
  const kill = vi.spyOn(process, 'kill');
  expect(() => acquireCodexOwnerLock(path)).toThrow('Invalid Codex owner lock');
  expect(kill).not.toHaveBeenCalled(); expect(readFileSync(path, 'utf8')).toBe(text);
});
it('does not remove another owner during late cleanup', () => {
  const close = acquireCodexOwnerLock(path); unlinkSync(path); writeFileSync(path, '54321');
  close(); expect(readFileSync(path, 'utf8')).toBe('54321');
});
it('preserves a replacement generation even when its PID text is unchanged', () => {
  const close = acquireCodexOwnerLock(path);
  writeFileSync(path + '.new', String(process.pid)); renameSync(path + '.new', path);
  close(); expect(readFileSync(path, 'utf8')).toBe(String(process.pid));
});
