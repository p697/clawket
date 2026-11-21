import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mock = vi.hoisted(() => ({ home: '' }));
vi.mock('node:os', async (original) => ({ ...await original<typeof import('node:os')>(), homedir: () => mock.home }));
import { deviceChatsRoot } from './device-chats.js';

let root: string, config: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'device-chats-')); mock.home = root; mkdirSync(join(root, 'state')); config = join(root, 'state', 'runtime.json'); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

it('puts a new device pairing outside the folders macOS guards', () => {
  expect(deviceChatsRoot(config)).toBe(join(root, 'Clawket', 'Chats'));
});

it('keeps the folder a saved device pairing was created with', () => {
  const saved = join(root, 'Documents', 'Clawket', 'Chats');
  writeFileSync(config, JSON.stringify({ device: true, project: saved }));
  expect(deviceChatsRoot(config)).toBe(saved);
});

it.each([
  ['a project-scoped pairing', JSON.stringify({ project: '/work/app' })],
  ['a relative folder', JSON.stringify({ device: true, project: 'Documents/Clawket/Chats' })],
  ['a missing folder', JSON.stringify({ device: true })],
  ['an empty file', ''],
  ['corrupted JSON', '{"device": true, "project": '],
  ['a non-object', 'null'],
])('falls back to the new default for %s', (_name, content) => {
  writeFileSync(config, content);
  expect(deviceChatsRoot(config)).toBe(join(root, 'Clawket', 'Chats'));
});
