import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ensureLocalModelRouter } from './local-model-launcher.js';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('reuses a live router and never starts over an occupied or unresponsive port', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'clawket-launcher-'));
  const executable = join(directory, 'server');
  const preset = join(directory, 'models.ini');
  writeFileSync(executable, 'fixture'); writeFileSync(preset, 'fixture');
  const config = { executable, preset, baseUrl: 'http://127.0.0.1:8082' };
  try {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ id: 'test', status: { value: 'unloaded' } }] })));
    await ensureLocalModelRouter(config, directory);
    expect(spawn).not.toHaveBeenCalled();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [] })));
    await expect(ensureLocalModelRouter(config, directory)).rejects.toThrow('not a llama.cpp router');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('timeout', 'TimeoutError'); }));
    await expect(ensureLocalModelRouter(config, directory)).rejects.toThrow('timeout');
    expect(spawn).not.toHaveBeenCalled();
    await expect(ensureLocalModelRouter({ ...config, baseUrl: 'http://example.com' }, directory)).rejects.toThrow('loopback');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
