import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
const mock = vi.hoisted(() => ({ control: vi.fn(), background: vi.fn(), fetch: vi.fn(), name: vi.fn(), qr: vi.fn(), inspect: vi.fn(), serviceOptions: vi.fn(), home: '' }));
vi.mock('node:os', async (original) => ({ ...await original<typeof import('node:os')>(), homedir: () => mock.home }));
vi.mock('./claude-code-lifecycle.js', () => ({ claudeControl: mock.control, startClaudeBackground: mock.background }));
vi.mock('./device-connection-name.js', () => ({ defaultDeviceConnectionName: mock.name }));
vi.mock('qrcode', () => ({ default: { toString: mock.qr } }));
vi.mock('@clawket/bridge-runtime', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    inspectClaudeInstallation: mock.inspect,
    ClaudeService: class extends EventEmitter { constructor(options: unknown) { super(); mock.serviceOptions(options); } async health() { return { modelReady: true }; } async stop() {} },
    ClaudeServer: class { constructor(private service: any) {} async start() { setTimeout(() => this.service.emit('shutdown'), 30); } async stop() {} },
    ClaudeRelay: class { start() {} async waitUntilReady() {} stop() {} },
  };
});
import { handleClaudeCommand } from './claude-code.js';
let root: string, project: string, path: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'claude-code-cli-')); mock.home = root; project = join(root, 'project'); mkdirSync(project); path = join(root, 'runtime.json');
  mock.control.mockReset(); mock.background.mockReset(); mock.fetch.mockReset();
  mock.name.mockReset().mockReturnValue('Claude Code · 工作室 Mac'); mock.qr.mockReset().mockResolvedValue('[test QR]');
  mock.inspect.mockReset(); mock.serviceOptions.mockReset();
  mock.inspect.mockResolvedValue({ version: 'test', executable: '/desktop/claude' });
  mock.control.mockRejectedValue(new Error('offline'));
  if (process.send) vi.spyOn(process as unknown as { send: (...args: unknown[]) => boolean }, 'send').mockImplementation(() => true);
  vi.stubGlobal('fetch', mock.fetch); vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });
const saved = (relay: object) => writeFileSync(path, JSON.stringify({ project, command: 'claude-code', token: 'local-test-token', port: 18499, host: '127.0.0.1', relay }));
it('reuses one device label for Registry, QR and code invitations after a computer rename', async () => {
  mock.fetch.mockImplementation(async (url: string) => {
    if (url.endsWith('/register')) return Response.json({ gatewayId: 'new-id', relaySecret: 'new-secret', relayUrl: 'wss://relay.example', accessCode: 'code' });
    if (url.endsWith('/access-code')) return Response.json({ accessCode: 'refreshed-code' });
    return Response.json({ sessionId: `ps_${'a'.repeat(64)}`, expiresAt: new Date(Date.now() + 60_000).toISOString(), capabilities: ['pairing.secure-short-code.v2'] });
  });
  const args = ['pair', '--foreground', '--device', '--config', path, '--registry', 'https://claude-code.example'];
  await handleClaudeCommand(args);
  const initial = JSON.parse(readFileSync(path, 'utf8'));
  expect(JSON.parse(mock.fetch.mock.calls[0][1].body)).toEqual({ displayName: 'Claude Code · 工作室 Mac' });
  expect(initial.displayName).toBe('Claude Code · 工作室 Mac');
  expect(JSON.parse(initial.relay.invitation.qrPayload)).toMatchObject({ b: 'claude-code', n: initial.displayName });
  expect(JSON.parse(mock.qr.mock.calls[0][0]).n).toBe(initial.displayName);
  mock.name.mockReturnValue('Claude Code · Renamed computer');
  await handleClaudeCommand(args);
  expect(mock.name).toHaveBeenCalledTimes(1);
  expect(JSON.parse(mock.fetch.mock.calls[2][1].body)).toEqual({ gatewayId: initial.relay.gatewayId, relaySecret: initial.relay.relaySecret });
  expect(JSON.parse(mock.qr.mock.calls[1][0]).n).toBe(initial.displayName);
});

it.each([undefined, 'Studio laptop'])('preserves an existing local pairing label %s', async displayName => {
  saved({});
  const initial = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(path, JSON.stringify({ ...initial, displayName }));
  await handleClaudeCommand(['pair', '--foreground', '--local', '--address', '127.0.0.1', '--config', path]);
  expect(JSON.parse(mock.qr.mock.calls[0][0])).toMatchObject({ backendKind: 'claude-code', mode: 'local', displayName: displayName ?? 'Claude Code', token: initial.token });
  expect(mock.name).not.toHaveBeenCalled();
});
it('refreshes the same registration without invalidating existing client identity', async () => {
  saved({ registryUrl: 'https://claude-code.example', gatewayId: 'existing-id', relaySecret: 'existing-secret', relayUrl: 'wss://relay.example' });
  mock.fetch.mockImplementation(async (url: string) => url.endsWith('/access-code') ? Response.json({ accessCode: 'new-code' }) : Response.json({ sessionId: 'legacy' }));
  await handleClaudeCommand(['pair', '--foreground', '--project', project, '--config', path, '--registry', 'https://claude-code.example']);
  expect(mock.fetch.mock.calls.map(c => c[0])).toEqual(['https://claude-code.example/v1/pair/access-code', 'https://claude-code.example/v1/pair/session']);
  expect(JSON.parse(readFileSync(path, 'utf8')).relay).toMatchObject({ gatewayId: 'existing-id', relaySecret: 'existing-secret' });
});
it('uses a distinct registration when the requested environment changes', async () => {
  saved({ registryUrl: 'https://production.example', gatewayId: 'existing-id', relaySecret: 'existing-secret', relayUrl: 'wss://relay.example' });
  mock.fetch.mockImplementation(async (url: string) => url.endsWith('/register') ? Response.json({ gatewayId: 'preview-id', relaySecret: 'preview-secret', relayUrl: 'wss://preview.example', accessCode: 'code' }) : Response.json({ sessionId: 'legacy' }));
  await handleClaudeCommand(['pair', '--foreground', '--project', project, '--config', path, '--registry', 'https://preview.example']);
  expect(mock.fetch.mock.calls[0][0]).toBe('https://preview.example/v1/pair/register');
  expect(JSON.parse(mock.fetch.mock.calls[0][1].body)).toEqual({ displayName: 'Claude Code' });
  expect(JSON.parse(readFileSync(path, 'utf8')).relay.gatewayId).toBe('preview-id');
});
it('does not stop an active task to refresh pairing', async () => {
  saved({}); mock.control.mockImplementation(async (_config, method) => method === 'sessions.list' ? [{ hasActiveRun: true }] : { modelReady: true });
  await expect(handleClaudeCommand(['pair', '--project', project, '--config', path])).rejects.toThrow('Finish the current');
  expect(mock.control.mock.calls.some(c => c[1] === 'bridge.stop')).toBe(false);
  expect(mock.background).not.toHaveBeenCalled(); expect(mock.fetch).not.toHaveBeenCalled();
});
it('isolates the default Preview and Production pairing files', async () => {
  await handleClaudeCommand(['pair', '--project', project, '--preview']);
  await handleClaudeCommand(['pair', '--project', project]);
  const paths = mock.background.mock.calls.map(c => c[0][c[0].indexOf('--config') + 1]);
  expect(paths[0]).toContain(join('preview', 'runtime.json')); expect(paths[1]).toContain(join('production', 'runtime.json')); expect(paths[0]).not.toBe(paths[1]);
  await handleClaudeCommand(['pair', '--foreground', '--local', '--address', '127.0.0.1', '--project', project, '--preview']);
  await handleClaudeCommand(['pair', '--foreground', '--local', '--address', '127.0.0.1', '--project', project]);
  const configs = paths.map(p => JSON.parse(readFileSync(p, 'utf8')));
  expect(configs[0].port).not.toBe(configs[1].port);
  expect(configs[0].token).not.toBe(configs[1].token);
  // Remove only this temporary project's state in the isolated test home.
  for (const p of paths) rmSync(dirname(dirname(p)), { recursive: true, force: true });
});

it('refuses contradictory scope flags and never widens an existing project pairing', async () => {
  await expect(handleClaudeCommand(['pair', '--device', '--project', project])).rejects.toThrow('not both');
  saved({});
  await expect(handleClaudeCommand(['pair', '--device', '--config', path])).rejects.toThrow('different scope');
  expect(JSON.parse(readFileSync(path, 'utf8')).device).toBeUndefined();
  expect(mock.background).not.toHaveBeenCalled();
});

it('preserves default device discovery through the first background pairing launch', async () => {
  await handleClaudeCommand(['pair', '--local', '--address', '127.0.0.1', '--preview']);
  const childArgs = mock.background.mock.calls[0][0];
  expect(childArgs).toContain('--device');
  const childConfig = childArgs[childArgs.indexOf('--config') + 1];
  await handleClaudeCommand([...childArgs, '--foreground']);
  expect(JSON.parse(readFileSync(childConfig, 'utf8'))).toMatchObject({
    device: true, displayName: 'Claude Code · 工作室 Mac', project: realpathSync(join(root, 'Documents', 'Clawket', 'Chats')),
  });
  expect(JSON.parse(mock.qr.mock.calls[0][0])).toMatchObject({ backendKind: 'claude-code', mode: 'local', displayName: 'Claude Code · 工作室 Mac' });
});

it.each([undefined, '/explicit/claude'])('starts the SDK service with the inspected executable for command %s', async command => {
  await handleClaudeCommand(['pair', '--foreground', '--local', '--address', '127.0.0.1', '--project', project, '--config', path,
    ...(command ? ['--claude-command', command] : [])]);
  expect(mock.inspect).toHaveBeenCalledWith(command ?? 'claude');
  expect(mock.serviceOptions).toHaveBeenCalledWith(expect.objectContaining({ executable: '/desktop/claude', project: realpathSync(project) }));
  // Keep automatic selection symbolic so Desktop upgrades can be discovered on restart.
  expect(JSON.parse(readFileSync(path, 'utf8')).command).toBe(command ?? 'claude');
});
