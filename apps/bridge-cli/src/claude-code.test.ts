vi.mock('./runtime-owner.js', () => ({ registerRuntimeOwner: vi.fn(async () => async () => {}) }));
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
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
  mock.control.mockRejectedValue(Object.assign(new Error('offline'), { code: 'ECONNREFUSED' }));
  if (process.send) vi.spyOn(process as unknown as { send: (...args: unknown[]) => boolean }, 'send').mockImplementation(() => true);
  vi.stubGlobal('fetch', mock.fetch); vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { process.exitCode = 0; vi.unstubAllGlobals(); vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });
const saved = (relay: object) => writeFileSync(path, JSON.stringify({ project, command: 'claude-code', token: 'local-test-token', port: 18499, host: '127.0.0.1', relay }));
it('does not launch another Claude runtime while a refused owner retains its writer lock', async () => {
  saved({}); mkdirSync(join(root, 'sessions')); writeFileSync(join(root, 'sessions', 'owner.lock'), 'owned');
  await expect(handleClaudeCommand(['start', '--config', path])).rejects.toThrow('locked without verified health');
  expect(mock.background).not.toHaveBeenCalled(); expect(readFileSync(path, 'utf8')).toContain('local-test-token');
});
it.each(['pair', 'start', 'restart', 'stop', 'reset'])('does not change a Claude owner after an uncertain %s probe', async command => {
  saved({}); const before = readFileSync(path, 'utf8');
  const error = new Error('control did not answer'); mock.control.mockRejectedValue(error);
  await expect(handleClaudeCommand([command, '--config', path])).rejects.toBe(error);
  expect(readFileSync(path, 'utf8')).toBe(before); expect(mock.background).not.toHaveBeenCalled(); expect(mock.fetch).not.toHaveBeenCalled();
});
it('restarts Claude using authenticated lifecycle control even when native health is broken', async () => {
  saved({});
  mock.control.mockImplementation(async (_config, method) => { if (method !== 'bridge.stop') throw new Error('native health failed'); return { ok: true }; });
  await handleClaudeCommand(['restart', '--config', path]);
  expect(mock.control).toHaveBeenCalledTimes(1); expect(mock.control.mock.calls[0][1]).toBe('bridge.stop');
  expect(mock.background).toHaveBeenCalledTimes(1);
});
it('resets only saved Claude pairing after authenticated stop and retains history, even if its project is gone', async () => {
  saved({}); mkdirSync(join(root, 'sessions')); writeFileSync(join(root, 'sessions', 'history.json'), 'preserved');
  rmSync(project, { recursive: true }); mock.control.mockResolvedValue({ ok: true });
  await handleClaudeCommand(['reset', '--project', project, '--config', path, '--json']);
  expect(existsSync(path)).toBe(false); expect(readFileSync(join(root, 'sessions', 'history.json'), 'utf8')).toBe('preserved');
  expect(mock.control.mock.calls[0][1]).toBe('bridge.stop'); expect(mock.background).not.toHaveBeenCalled();
});
it('offline Claude doctor does not instantiate an SDK process', async () => {
  saved({}); await handleClaudeCommand(['doctor', '--config', path, '--json']);
  expect(mock.inspect).not.toHaveBeenCalled(); expect(mock.serviceOptions).not.toHaveBeenCalled(); expect(mock.background).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
});
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
  expect(JSON.parse(mock.fetch.mock.calls[2][1].body)).toEqual({ gatewayId: initial.relay.gatewayId, relaySecret: initial.relay.relaySecret, displayName: initial.displayName });
  expect(JSON.parse(mock.qr.mock.calls[1][0]).n).toBe(initial.displayName);
});

it.each([undefined, '', '   '])('backfills an unnamed existing local pairing (%s) once', async displayName => {
  saved({});
  const initial = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(path, JSON.stringify({ ...initial, displayName }));
  const args = ['pair', '--foreground', '--local', '--address', '127.0.0.1', '--config', path];
  await handleClaudeCommand(args);
  expect(JSON.parse(mock.qr.mock.calls[0][0])).toMatchObject({ backendKind: 'claude-code', mode: 'local', displayName: 'Claude Code · 工作室 Mac', token: initial.token });
  expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ displayName: 'Claude Code · 工作室 Mac', token: initial.token, project: initial.project, port: initial.port });
  mock.name.mockReturnValue('Claude Code · Renamed computer');
  await handleClaudeCommand(args);
  expect(JSON.parse(mock.qr.mock.calls[1][0]).displayName).toBe('Claude Code · 工作室 Mac');
  expect(mock.name).toHaveBeenCalledTimes(1);
});

it.each(['Studio laptop', 'Claude Code', 'Claude Code · Saved computer'])('preserves an existing local pairing label %s', async displayName => {
  saved({});
  const initial = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(path, JSON.stringify({ ...initial, displayName }));
  await handleClaudeCommand(['pair', '--foreground', '--local', '--address', '127.0.0.1', '--config', path]);
  expect(JSON.parse(mock.qr.mock.calls[0][0])).toMatchObject({ backendKind: 'claude-code', mode: 'local', displayName, token: initial.token });
  expect(mock.name).not.toHaveBeenCalled();
});

it.each([undefined, '   ', 'Studio laptop'])('synchronizes the saved label on same-identity Relay pairing (%s)', async savedName => {
  saved({ registryUrl: 'https://claude-code.example', gatewayId: 'existing-id', relaySecret: 'existing-secret', relayUrl: 'wss://relay.example' });
  const initial = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(path, JSON.stringify({ ...initial, displayName: savedName }));
  mock.fetch.mockImplementation(async (url: string) => url.endsWith('/access-code')
    ? Response.json({ accessCode: 'new-code' })
    : Response.json({ sessionId: `ps_${'a'.repeat(64)}`, expiresAt: new Date(Date.now() + 60_000).toISOString(), capabilities: ['pairing.secure-short-code.v2'] }));
  await handleClaudeCommand(['pair', '--foreground', '--project', project, '--config', path, '--registry', 'https://claude-code.example']);
  const displayName = savedName?.trim() || 'Claude Code · 工作室 Mac';
  expect(mock.fetch.mock.calls.map(c => c[0])).toEqual(['https://claude-code.example/v1/pair/access-code', 'https://claude-code.example/v1/pair/session']);
  expect(JSON.parse(mock.fetch.mock.calls[0][1].body)).toEqual({ gatewayId: initial.relay.gatewayId, relaySecret: initial.relay.relaySecret, displayName });
  const updated = JSON.parse(readFileSync(path, 'utf8'));
  expect(updated).toMatchObject({ displayName, token: initial.token, project: initial.project, port: initial.port,
    relay: { gatewayId: initial.relay.gatewayId, relaySecret: initial.relay.relaySecret } });
  expect(JSON.parse(mock.qr.mock.calls[0][0]).n).toBe(displayName);
  expect(JSON.parse(updated.relay.invitation.qrPayload).n).toBe(displayName);
  expect(mock.name).toHaveBeenCalledTimes(savedName?.trim() ? 0 : 1);
});

it('leaves the saved configuration intact when label synchronization fails', async () => {
  saved({ registryUrl: 'https://claude-code.example', gatewayId: 'existing-id', relaySecret: 'existing-secret', relayUrl: 'wss://relay.example' });
  const before = readFileSync(path, 'utf8');
  mock.fetch.mockResolvedValue(new Response(null, { status: 401 }));
  await expect(handleClaudeCommand(['pair', '--foreground', '--project', project, '--config', path, '--registry', 'https://claude-code.example'])).rejects.toThrow('HTTP 401');
  expect(readFileSync(path, 'utf8')).toBe(before);
  expect(mock.qr).not.toHaveBeenCalled();
});

it('does not generate a name or rewrite configuration during ordinary run', async () => {
  saved({});
  const before = readFileSync(path, 'utf8');
  await handleClaudeCommand(['run', '--config', path]);
  expect(readFileSync(path, 'utf8')).toBe(before);
  expect(mock.name).not.toHaveBeenCalled();
  expect(mock.fetch).not.toHaveBeenCalled();
});
it('uses a distinct registration when the requested environment changes', async () => {
  saved({ registryUrl: 'https://production.example', gatewayId: 'existing-id', relaySecret: 'existing-secret', relayUrl: 'wss://relay.example' });
  mock.fetch.mockImplementation(async (url: string) => url.endsWith('/register') ? Response.json({ gatewayId: 'preview-id', relaySecret: 'preview-secret', relayUrl: 'wss://preview.example', accessCode: 'code' }) : Response.json({ sessionId: 'legacy' }));
  await handleClaudeCommand(['pair', '--foreground', '--project', project, '--config', path, '--registry', 'https://preview.example']);
  expect(mock.fetch.mock.calls[0][0]).toBe('https://preview.example/v1/pair/register');
  expect(JSON.parse(mock.fetch.mock.calls[0][1].body)).toEqual({ displayName: 'Claude Code · 工作室 Mac' });
  expect(JSON.parse(readFileSync(path, 'utf8')).relay.gatewayId).toBe('preview-id');
});
it('restarts this Bridge to refresh pairing without waiting for running tasks', async () => {
  saved({}); mock.control.mockImplementation(async (_config, method) => method === 'sessions.list' ? [{ hasActiveRun: true }] : { modelReady: true });
  await handleClaudeCommand(['pair', '--project', project, '--config', path]);
  expect(mock.control.mock.calls.map(c => c[1])).toEqual([undefined, 'bridge.stop']);
  expect(mock.background).toHaveBeenCalledOnce();
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

it('refreshes an existing official Workers pairing through the custom domain', async () => {
  saved({ registryUrl: 'https://clawket-claude-code-registry.clawket.workers.dev',
    relayUrl: 'wss://clawket-claude-code-relay.clawket.workers.dev/ws', gatewayId: 'preserved-id', relaySecret: 'preserved-secret' });
  mock.fetch.mockImplementation(async (url: string) => url.endsWith('/access-code')
    ? Response.json({ accessCode: 'ABC234' })
    : Response.json({ sessionId: `ps_${'a'.repeat(64)}`, expiresAt: new Date(Date.now() + 60_000).toISOString(), capabilities: ['pairing.secure-short-code.v2'] }));
  await handleClaudeCommand(['pair', '--foreground', '--config', path]);
  expect(mock.fetch.mock.calls.map(call => call[0])).toEqual([
    'https://claude-code-registry.clawket.ai/v1/pair/access-code', 'https://claude-code-registry.clawket.ai/v1/pair/session']);
  expect(JSON.parse(mock.fetch.mock.calls[0][1].body)).toMatchObject({ gatewayId: 'preserved-id', relaySecret: 'preserved-secret' });
  expect(JSON.parse(readFileSync(path, 'utf8')).relay).toMatchObject({ gatewayId: 'preserved-id', relaySecret: 'preserved-secret',
    registryUrl: 'https://claude-code-registry.clawket.ai', relayUrl: 'wss://claude-code-relay.clawket.ai/ws' });
});
