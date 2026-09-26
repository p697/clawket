import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const mock = vi.hoisted(() => ({ control: vi.fn(), background: vi.fn(), fetch: vi.fn() }));
vi.mock('./codex-lifecycle.js', () => ({ codexControl: mock.control, startCodexBackground: mock.background }));
vi.mock('qrcode', () => ({ default: { toString: async () => '[test QR]' } }));
vi.mock('@clawket/bridge-runtime', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    inspectCodexInstallation: async () => ({ version: 'test' }),
    CodexService: class extends EventEmitter { async health() { return { modelReady: true }; } async stop() {} },
    CodexServer: class { constructor(private service: any) {} async start() { setTimeout(() => this.service.emit('shutdown'), 30); } async stop() {} },
    CodexRelay: class { start() {} async waitUntilReady() {} stop() {} },
  };
});
import { handleCodexCommand } from './codex.js';
let root: string, project: string, path: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'codex-cli-')); project = join(root, 'project'); mkdirSync(project); path = join(root, 'runtime.json');
  mock.control.mockReset(); mock.background.mockReset(); mock.fetch.mockReset();
  mock.control.mockRejectedValue(new Error('offline'));
  if (process.send) vi.spyOn(process as unknown as { send: (...args: unknown[]) => boolean }, 'send').mockImplementation(() => true);
  vi.stubGlobal('fetch', mock.fetch); vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });
const saved = (relay: object) => writeFileSync(path, JSON.stringify({ project, command: 'codex', token: 'local-test-token', port: 18499, host: '127.0.0.1', relay }));
it('refreshes the same registration without invalidating existing client identity', async () => {
  saved({ registryUrl: 'https://codex.example', gatewayId: 'existing-id', relaySecret: 'existing-secret', relayUrl: 'wss://relay.example' });
  mock.fetch.mockImplementation(async (url: string) => url.endsWith('/access-code') ? Response.json({ accessCode: 'new-code' }) : Response.json({ sessionId: 'legacy' }));
  await handleCodexCommand(['pair', '--foreground', '--project', project, '--config', path, '--registry', 'https://codex.example']);
  expect(mock.fetch.mock.calls.map(c => c[0])).toEqual(['https://codex.example/v1/pair/access-code', 'https://codex.example/v1/pair/session']);
  expect(JSON.parse(readFileSync(path, 'utf8')).relay).toMatchObject({ gatewayId: 'existing-id', relaySecret: 'existing-secret' });
});
it('uses a distinct registration when the requested environment changes', async () => {
  saved({ registryUrl: 'https://production.example', gatewayId: 'existing-id', relaySecret: 'existing-secret', relayUrl: 'wss://relay.example' });
  mock.fetch.mockImplementation(async (url: string) => url.endsWith('/register') ? Response.json({ gatewayId: 'preview-id', relaySecret: 'preview-secret', relayUrl: 'wss://preview.example', accessCode: 'code' }) : Response.json({ sessionId: 'legacy' }));
  await handleCodexCommand(['pair', '--foreground', '--project', project, '--config', path, '--registry', 'https://preview.example']);
  expect(mock.fetch.mock.calls[0][0]).toBe('https://preview.example/v1/pair/register');
  expect(JSON.parse(readFileSync(path, 'utf8')).relay.gatewayId).toBe('preview-id');
});
it('does not stop an active task to refresh pairing', async () => {
  saved({}); mock.control.mockImplementation(async (_config, method) => method === 'sessions.list' ? [{ hasActiveRun: true }] : { modelReady: true });
  await expect(handleCodexCommand(['pair', '--project', project, '--config', path])).rejects.toThrow('Finish the current');
  expect(mock.control.mock.calls.some(c => c[1] === 'bridge.stop')).toBe(false);
  expect(mock.background).not.toHaveBeenCalled(); expect(mock.fetch).not.toHaveBeenCalled();
});
it('isolates the default Preview and Production pairing files', async () => {
  await handleCodexCommand(['pair', '--project', project, '--preview']);
  await handleCodexCommand(['pair', '--project', project]);
  const paths = mock.background.mock.calls.map(c => c[0][c[0].indexOf('--config') + 1]);
  expect(paths[0]).toContain('/preview/runtime.json'); expect(paths[1]).toContain('/production/runtime.json'); expect(paths[0]).not.toBe(paths[1]);
  await handleCodexCommand(['pair', '--foreground', '--local', '--address', '127.0.0.1', '--project', project, '--preview']);
  await handleCodexCommand(['pair', '--foreground', '--local', '--address', '127.0.0.1', '--project', project]);
  const configs = paths.map(p => JSON.parse(readFileSync(p, 'utf8')));
  expect(configs[0].port).not.toBe(configs[1].port);
  expect(configs[0].token).not.toBe(configs[1].token);
  // Remove only this temporary project's state in the isolated test home.
  for (const p of paths) rmSync(p.replace(/\/(preview|production)\/runtime.json$/, ''), { recursive: true, force: true });
});

it('refuses contradictory scope flags and never widens an existing project pairing', async () => {
  await expect(handleCodexCommand(['pair', '--device', '--project', project])).rejects.toThrow('not both');
  saved({});
  await expect(handleCodexCommand(['pair', '--device', '--config', path])).rejects.toThrow('different scope');
  expect(JSON.parse(readFileSync(path, 'utf8')).device).toBeUndefined();
  expect(mock.background).not.toHaveBeenCalled();
});
