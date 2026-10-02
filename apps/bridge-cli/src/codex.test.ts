import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
const mock = vi.hoisted(() => ({ control: vi.fn(), background: vi.fn(), fetch: vi.fn(), name: vi.fn(), qr: vi.fn(), home: '' }));
vi.mock('node:os', async (original) => ({ ...await original<typeof import('node:os')>(), homedir: () => mock.home }));
vi.mock('./codex-lifecycle.js', () => ({ codexControl: mock.control, startCodexBackground: mock.background }));
vi.mock('./device-connection-name.js', () => ({ defaultDeviceConnectionName: mock.name }));
vi.mock('qrcode', () => ({ default: { toString: mock.qr } }));
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
  root = mkdtempSync(join(tmpdir(), 'codex-cli-')); mock.home = root; project = join(root, 'project'); mkdirSync(project); path = join(root, 'runtime.json');
  mock.control.mockReset(); mock.background.mockReset(); mock.fetch.mockReset();
  mock.name.mockReset().mockReturnValue('Codex · 工作室 Mac'); mock.qr.mockReset().mockResolvedValue('[test QR]');
  mock.control.mockRejectedValue(Object.assign(new Error('offline'), { code: 'ECONNREFUSED' }));
  if (process.send) vi.spyOn(process as unknown as { send: (...args: unknown[]) => boolean }, 'send').mockImplementation(() => true);
  vi.stubGlobal('fetch', mock.fetch); vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });
const saved = (relay: object) => writeFileSync(path, JSON.stringify({ project, command: 'codex', token: 'local-test-token', port: 18499, host: '127.0.0.1', relay }));
it('reuses one device label for Registry, QR and code invitations after a computer rename', async () => {
  mock.fetch.mockImplementation(async (url: string) => {
    if (url.endsWith('/register')) return Response.json({ gatewayId: 'new-id', relaySecret: 'new-secret', relayUrl: 'wss://relay.example', accessCode: 'code' });
    if (url.endsWith('/access-code')) return Response.json({ accessCode: 'refreshed-code' });
    return Response.json({ sessionId: `ps_${'a'.repeat(64)}`, expiresAt: new Date(Date.now() + 60_000).toISOString(), capabilities: ['pairing.secure-short-code.v2'] });
  });
  const args = ['pair', '--foreground', '--device', '--config', path, '--registry', 'https://codex.example'];
  await handleCodexCommand(args);
  const initial = JSON.parse(readFileSync(path, 'utf8'));
  expect(JSON.parse(mock.fetch.mock.calls[0][1].body)).toEqual({ displayName: 'Codex · 工作室 Mac' });
  expect(initial.displayName).toBe('Codex · 工作室 Mac');
  expect(JSON.parse(initial.relay.invitation.qrPayload)).toMatchObject({ b: 'codex', n: initial.displayName });
  expect(JSON.parse(mock.qr.mock.calls[0][0]).n).toBe(initial.displayName);
  mock.name.mockReturnValue('Codex · Renamed computer');
  await handleCodexCommand(args);
  expect(mock.name).toHaveBeenCalledTimes(1);
  expect(JSON.parse(mock.fetch.mock.calls[2][1].body)).toEqual({ gatewayId: initial.relay.gatewayId, relaySecret: initial.relay.relaySecret });
  expect(JSON.parse(mock.qr.mock.calls[1][0]).n).toBe(initial.displayName);
});

it.each([undefined, 'Studio laptop'])('preserves an existing local pairing label %s', async displayName => {
  saved({});
  const initial = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(path, JSON.stringify({ ...initial, displayName }));
  await handleCodexCommand(['pair', '--foreground', '--local', '--address', '127.0.0.1', '--config', path]);
  expect(JSON.parse(mock.qr.mock.calls[0][0])).toMatchObject({ backendKind: 'codex', mode: 'local', displayName: displayName ?? 'Codex', token: initial.token });
  expect(mock.name).not.toHaveBeenCalled();
});
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
  expect(JSON.parse(mock.fetch.mock.calls[0][1].body)).toEqual({ displayName: 'Codex' });
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
  expect(paths[0]).toContain(join('preview', 'runtime.json')); expect(paths[1]).toContain(join('production', 'runtime.json')); expect(paths[0]).not.toBe(paths[1]);
  await handleCodexCommand(['pair', '--foreground', '--local', '--address', '127.0.0.1', '--project', project, '--preview']);
  await handleCodexCommand(['pair', '--foreground', '--local', '--address', '127.0.0.1', '--project', project]);
  const configs = paths.map(p => JSON.parse(readFileSync(p, 'utf8')));
  expect(configs[0].port).not.toBe(configs[1].port);
  expect(configs[0].token).not.toBe(configs[1].token);
  // Remove only this temporary project's state in the isolated test home.
  for (const p of paths) rmSync(dirname(dirname(p)), { recursive: true, force: true });
});

it('refuses contradictory scope flags and never widens an existing project pairing', async () => {
  await expect(handleCodexCommand(['pair', '--device', '--project', project])).rejects.toThrow('not both');
  saved({});
  await expect(handleCodexCommand(['pair', '--device', '--config', path])).rejects.toThrow('different scope');
  expect(JSON.parse(readFileSync(path, 'utf8')).device).toBeUndefined();
  expect(mock.background).not.toHaveBeenCalled();
});

it.each([false, true])('preserves default device scope on first detached pairing (preview=%s)', async (preview) => {
  const args = ['pair', '--local', '--address', '127.0.0.1', ...(preview ? ['--preview'] : [])];
  await handleCodexCommand(args);
  const childArgs = mock.background.mock.calls[0][0];
  const childConfig = childArgs[childArgs.indexOf('--config') + 1];
  await handleCodexCommand([...childArgs, '--foreground']);
  const initial = JSON.parse(readFileSync(childConfig, 'utf8'));
  expect(initial).toMatchObject({ device: true, displayName: 'Codex · 工作室 Mac', project: realpathSync(join(root, 'Documents', 'Clawket', 'Chats')) });
  expect(JSON.parse(mock.qr.mock.calls[0][0])).toMatchObject({ backendKind: 'codex', mode: 'local', displayName: initial.displayName });
  mock.name.mockReturnValue('Codex · Renamed computer');
  await handleCodexCommand(args);
  const repeatedArgs = mock.background.mock.calls[1][0];
  expect(repeatedArgs[repeatedArgs.indexOf('--config') + 1]).toBe(childConfig);
  await handleCodexCommand([...repeatedArgs, '--foreground']);
  expect(JSON.parse(readFileSync(childConfig, 'utf8'))).toMatchObject({ device: true, displayName: initial.displayName, token: initial.token, port: initial.port });
  expect(mock.name).toHaveBeenCalledTimes(1);
});

it('keeps explicit project scope through a first detached pairing', async () => {
  await handleCodexCommand(['pair', '--local', '--address', '127.0.0.1', '--project', project, '--config', path]);
  const childArgs = mock.background.mock.calls[0][0];
  await handleCodexCommand([...childArgs, '--foreground']);
  expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ device: false, project: realpathSync(project) });
});

it('restarts an authenticated Bridge without depending on native health', async () => {
  saved({});
  mock.control.mockImplementation(async (_config, method) => {
    if (method === 'bridge.stop') return { ok: true };
    throw new Error('Codex process is unavailable');
  });
  await handleCodexCommand(['restart', '--project', project, '--config', path]);
  expect(mock.control.mock.calls.map(c => c[1])).toEqual(['bridge.stop']);
  expect(mock.background).toHaveBeenCalledWith(['run', '--config', path], join(root, 'codex.log'));
});

it('does not start a replacement when authenticated stop is unconfirmed', async () => {
  saved({});
  mock.control.mockRejectedValue(new Error('Codex Bridge did not answer'));
  await expect(handleCodexCommand(['restart', '--project', project, '--config', path])).rejects.toThrow('did not answer');
  expect(mock.background).not.toHaveBeenCalled();
});

it.each(['pair', 'start', 'doctor', 'status'])('does not treat a failed %s health check as an absent owner', async command => {
  saved({});
  const before = readFileSync(path, 'utf8');
  const errors = [
    new Error('The existing Codex Bridge failed its native health check'),
    new Error('Codex Bridge rejected the control request'),
    new Error('Codex Bridge did not answer'),
    Object.assign(new Error('Codex Bridge is not reachable'), { code: 'ECONNRESET' }),
  ];
  for (const error of errors) {
    mock.control.mockReset().mockRejectedValue(error);
    await expect(handleCodexCommand([command, '--project', project, '--config', path])).rejects.toBe(error);
    expect(mock.control.mock.calls).toHaveLength(1);
    expect(mock.control.mock.calls[0][1]).toBeUndefined();
    expect(mock.background).not.toHaveBeenCalled();
    expect(mock.fetch).not.toHaveBeenCalled();
    expect(readFileSync(path, 'utf8')).toBe(before);
  }
});

it('allows start after an explicitly refused local connection', async () => {
  saved({}); mock.control.mockRejectedValue(Object.assign(new Error('offline'), { code: 'ECONNREFUSED' }));
  await handleCodexCommand(['restart', '--project', project, '--config', path]);
  expect(mock.background).toHaveBeenCalledTimes(1);
});
