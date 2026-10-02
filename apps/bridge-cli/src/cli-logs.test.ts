import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { appendFileSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logOptions, logTimestamp, readLogSnapshot, readLogUpdates, showLogs } from './cli-logs.js';
const directory = join(homedir(), 'log-tests');
const sources = [{ name: 'codex', path: join(directory, 'codex.log') }, { name: 'hermes:stderr', path: join(directory, 'stderr.log') }];
beforeEach(() => { mkdirSync(directory, { recursive: true }); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); rmSync(directory, { recursive: true, force: true }); });
it.each(['0', 'NaN', '-1', '1.5', '2001', ''])('rejects invalid line count %s', value => { expect(() => logOptions(['--lines', value])).toThrow(); });
it.each(['0s', '99999999999999999999999d'])('rejects invalid duration %s', value => { expect(() => logOptions(['--last', value])).toThrow(); });
it('parses existing epoch, Codex JSON and Windows supervisor timestamps', () => {
  expect(logTimestamp('[1700000000000] ready')).toBe(1700000000000);
  expect(logTimestamp('{"ts":"2026-10-02T00:00:00Z"}')).toBe(Date.parse('2026-10-02T00:00:00Z'));
  expect(logTimestamp('{"at":"2026-10-02T00:00:00Z"}')).toBe(Date.parse('2026-10-02T00:00:00Z'));
  expect(logTimestamp('legacy native error')).toBeNull();
});
it('merges sources by timestamp and retains untimestamped legacy failures with a warning', () => {
  vi.spyOn(Date, 'now').mockReturnValue(1700000003000);
  writeFileSync(sources[0].path, '[1700000000000] old\n[1700000002900] ready\n');
  writeFileSync(sources[1].path, '[1700000002500] error\nlegacy failure\n');
  const result = readLogSnapshot(sources, logOptions(['--last', '1s']));
  expect(result.entries.map(e => e.text)).toEqual(['[1700000002500] error', '[1700000002900] ready', 'legacy failure']);
  expect(result.warnings.join()).toContain('Untimestamped');
  expect(result.entries[0].source).toBe('hermes:stderr');
});
it('bounds historical reads and never emits a partial first line', () => {
  writeFileSync(sources[0].path, 'x'.repeat(300000) + '\n[1700000000000] final\n');
  const result = readLogSnapshot(sources, logOptions([]));
  expect(result.entries.map(e => e.text)).toEqual(['[1700000000000] final']);
  expect(result.warnings.join()).toContain('256 KiB');
});
it('follows incremental bytes, split UTF-8, new files, truncation and rotation', () => {
  writeFileSync(sources[0].path, 'start\npartial');
  const snapshot = readLogSnapshot(sources, logOptions(['--follow']));
  expect(snapshot.entries.map(e => e.text)).toEqual(['start']);
  appendFileSync(sources[0].path, Buffer.concat([Buffer.from(' done\n'), Buffer.from('你好').subarray(0, 2)]));
  expect(readLogUpdates(sources, snapshot.cursors).map(e => e.text)).toEqual(['partial done']);
  appendFileSync(sources[0].path, Buffer.concat([Buffer.from('你好').subarray(2), Buffer.from('\n')]));
  writeFileSync(sources[1].path, 'new stderr\n');
  expect(readLogUpdates(sources, snapshot.cursors).map(e => e.text)).toEqual(['你好', 'new stderr']);
  writeFileSync(sources[0].path, 'reset\n');
  expect(readLogUpdates(sources, snapshot.cursors).map(e => e.text)).toEqual(['reset']);
  renameSync(sources[0].path, sources[0].path + '.previous'); writeFileSync(sources[0].path, 'rotated\n');
  expect(readLogUpdates(sources, snapshot.cursors).map(e => e.text)).toEqual(['rotated']);
  expect(readLogUpdates(sources, snapshot.cursors)).toEqual([]);
});
it('supports JSON follow and releases signal handlers when interrupted', async () => {
  vi.useFakeTimers(); const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  const before = process.listenerCount('SIGINT');
  const following = showLogs(sources, ['--json', '--follow']);
  writeFileSync(sources[0].path, 'event\n');
  await vi.advanceTimersByTimeAsync(500);
  expect(JSON.parse(output.mock.calls[0][0])).toEqual({ source: 'codex', timestamp: null, text: 'event' });
  process.emit('SIGINT'); await vi.advanceTimersByTimeAsync(500); await following;
  expect(process.listenerCount('SIGINT')).toBe(before);
});
