vi.mock('./runtime-owner.js', () => ({ registerRuntimeOwner: vi.fn(async () => async () => {}) }));
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mock = vi.hoisted(() => ({ control: vi.fn(), background: vi.fn(), fetch: vi.fn(), service: vi.fn(), qr: vi.fn(), file: vi.fn(), home: '' }));
vi.mock('node:os', async original => ({ ...await original<typeof import('node:os')>(), homedir: () => mock.home }));
vi.mock('./pi-lifecycle.js', () => ({ piControl: mock.control, startPiBackground: mock.background }));
vi.mock('qrcode', () => ({ default: { toString: mock.qr, toFile: mock.file } }));
vi.mock('@clawket/bridge-runtime', () => ({
  inspectPiInstallation: vi.fn(), PiService: mock.service, PiServer: vi.fn(), PiRelay: vi.fn(),
}));
import { handlePiCommand } from './pi.js';

let root: string, project: string, path: string, config: any, original: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-pair-unit-'))); mock.home = root;
  project = join(root, 'project'); mkdirSync(project); path = join(root, 'runtime.json');
  mkdirSync(join(root, 'sessions')); writeFileSync(join(root, 'sessions', 'owner.lock'), '12345');
  for (const fn of [mock.control, mock.background, mock.fetch, mock.service, mock.qr, mock.file]) fn.mockReset();
  mock.control.mockResolvedValue({ backend: 'pi', modelReady: true, hasActiveRun: true });
  mock.qr.mockResolvedValue('[test QR]'); mock.file.mockResolvedValue(undefined);
  mock.fetch.mockResolvedValue(Response.json({ gatewayId: 'existing-id', relayUrl: 'wss://relay.example/ws', accessCode: 'ABC234' }));
  config = { project, command: 'pi', token: 'local-test-token', port: 18499, host: '127.0.0.1',
    relay: { registryUrl: 'https://pi.example', gatewayId: 'existing-id', relaySecret: 'existing-secret', relayUrl: 'wss://relay.example/ws',
      invitation: { sessionId: 'old-session', codeKeyHex: 'old-key', qrPayload: JSON.stringify({ v: 2, k: 'cp', b: 'pi', s: 'https://pi.example', g: 'existing-id', a: 'old-code' }), expiresAt: '2099-01-01T00:00:00Z', attempts: 2 } } };
  save();
  vi.stubGlobal('fetch', mock.fetch); vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
  if (process.send) vi.spyOn(process as unknown as { send: (...args: unknown[]) => boolean }, 'send').mockImplementation(() => true);
});
afterEach(() => { process.exitCode = 0; vi.unstubAllGlobals(); vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });
function save() { original = JSON.stringify(config, null, 2); writeFileSync(path, original); }
const pair = (...args: string[]) => handlePiCommand(['pair', '--config', path, ...args]);
it('does not launch another Pi runtime while a refused owner retains its writer lock', async () => {
  mock.control.mockRejectedValue(Object.assign(new Error('offline'), { code: 'ECONNREFUSED' }));
  await expect(handlePiCommand(['start', '--config', path])).rejects.toThrow('locked without verified health');
  expect(mock.background).not.toHaveBeenCalled(); expect(readFileSync(path, 'utf8')).toBe(original);
});
it.each(['start', 'restart', 'stop', 'reset'])('does not change Pi state after an uncertain %s control request', async command => {
  const error = new Error('control did not answer'); mock.control.mockRejectedValue(error);
  await expect(handlePiCommand([command, '--config', path])).rejects.toBe(error);
  expect(readFileSync(path, 'utf8')).toBe(original); expect(mock.background).not.toHaveBeenCalled(); expect(mock.service).not.toHaveBeenCalled();
});
it('restarts Pi using authenticated lifecycle control independent of native health', async () => {
  unlinkSync(join(root, 'sessions', 'owner.lock'));
  mock.control.mockImplementation(async (_config, method) => { if (method !== 'bridge.stop') throw new Error('native health failed'); return { ok: true }; });
  await handlePiCommand(['restart', '--config', path]);
  expect(mock.control).toHaveBeenCalledTimes(1); expect(mock.control.mock.calls[0][1]).toBe('bridge.stop'); expect(mock.background).toHaveBeenCalledTimes(1);
});
function unchanged() {
  expect(readFileSync(path, 'utf8')).toBe(original);
  expect(readFileSync(join(root, 'sessions', 'owner.lock'), 'utf8')).toBe('12345');
  expect(mock.background).not.toHaveBeenCalled(); expect(mock.service).not.toHaveBeenCalled();
  expect(mock.control.mock.calls.every(call => call[1] === undefined)).toBe(true);
}

it.each([false, true])('refreshes a live Pi identity without stopping active tasks or spawning another owner (foreground=%s)', async foreground => {
  await pair(...(foreground ? ['--foreground'] : []), '--project', project, '--registry', 'https://pi.example/', '--qr-file', join(root, 'qr.png'));
  expect(mock.control).toHaveBeenCalledTimes(1);
  expect(mock.fetch.mock.calls.map(call => call[0])).toEqual(['https://pi.example/v1/pair/access-code']);
  expect(JSON.parse(mock.fetch.mock.calls[0][1].body)).toEqual({ gatewayId: 'existing-id', relaySecret: 'existing-secret' });
  const qr = JSON.parse(mock.qr.mock.calls[0][0]);
  expect(qr).toMatchObject({ v: 2, k: 'cp', b: 'pi', s: 'https://pi.example', g: 'existing-id', a: 'ABC234' });
  expect(mock.file).toHaveBeenCalledWith(join(root, 'qr.png'), mock.qr.mock.calls[0][0]);
  unchanged();
});

it('recovers legacy registry provenance only from the matching Pi invitation', async () => {
  delete config.relay.registryUrl; save(); await pair();
  expect(mock.fetch.mock.calls[0][0]).toBe('https://pi.example/v1/pair/access-code'); unchanged();
});

it('can refresh a QR using saved Registry provenance when invitation creation was unavailable', async () => {
  delete config.relay.invitation; save(); await pair();
  expect(mock.fetch.mock.calls.map(call => call[0])).toEqual(['https://pi.example/v1/pair/access-code']);
  expect(JSON.parse(mock.qr.mock.calls[0][0]).g).toBe('existing-id'); unchanged();
});

it.each(['missing', 'foreign-backend', 'foreign-id', 'credentials', 'insecure', 'contradictory'])('refuses unverified registry provenance: %s', async mode => {
  delete config.relay.registryUrl;
  const payload = JSON.parse(config.relay.invitation.qrPayload);
  if (mode === 'missing') delete config.relay.invitation;
  if (mode === 'foreign-backend') payload.b = 'codex';
  if (mode === 'foreign-id') payload.g = 'other-id';
  if (mode === 'credentials') payload.s = 'https://user:password@pi.example';
  if (mode === 'insecure') payload.s = 'http://pi.example';
  if (mode === 'contradictory') config.relay.registryUrl = 'https://other.example';
  if (config.relay.invitation) config.relay.invitation.qrPayload = JSON.stringify(payload);
  save();
  await expect(pair()).rejects.toThrow(/Registry/); expect(mock.fetch).not.toHaveBeenCalled(); unchanged();
});

it.each(['project', 'agent-dir', 'sessions-dir', 'pi-command', 'port', 'host', 'registry', 'local', 'preview', 'address'])('refuses changing the live pairing target: %s', async flag => {
  const other = join(root, 'other'); mkdirSync(other);
  const values: Record<string, string> = {
    project: other, 'agent-dir': other, 'sessions-dir': other, 'pi-command': 'another-pi', port: '19000', host: '0.0.0.0', registry: 'https://other.example', address: '192.0.2.1',
  };
  const args = flag === 'local' ? ['--local'] : flag === 'preview' ? ['--preview'] : [`--${flag}`, values[flag]];
  await expect(pair(...args)).rejects.toThrow(/same|scope|Registry|Preview|running/i);
  expect(mock.fetch).not.toHaveBeenCalled(); unchanged();
  expect(mock.control.mock.calls[0][0].port).toBe(18499);
});

it('accepts explicit unchanged target options without changing the owner configuration', async () => {
  config.agentDirectory = 'agent'; config.nativeSessionDirectory = 'native'; save();
  await pair('--agent-dir', join(project, 'agent'), '--sessions-dir', join(project, 'native'), '--pi-command', 'pi', '--port', '18499', '--host', '127.0.0.1');
  expect(mock.fetch).toHaveBeenCalledTimes(1); unchanged();
});

it.each(['authentication', 'timeout', 'closed'])('does not treat uncertain owner verification as permission to replace it: %s', async message => {
  mock.control.mockRejectedValue(new Error(message));
  await expect(pair()).rejects.toThrow('verify'); expect(mock.fetch).not.toHaveBeenCalled(); unchanged();
});

it('does not replace a locked owner when its local listener is temporarily unavailable', async () => {
  mock.control.mockRejectedValue(Object.assign(new Error('unreachable'), { code: 'ECONNREFUSED' }));
  await expect(pair()).rejects.toThrow('verify'); expect(mock.fetch).not.toHaveBeenCalled(); unchanged();
});

it('does not fall back to a new registration when refreshing the existing identity fails', async () => {
  mock.fetch.mockResolvedValue(Response.json({}, { status: 404 }));
  await expect(pair()).rejects.toThrow('HTTP 404');
  expect(mock.fetch.mock.calls.map(call => call[0])).toEqual(['https://pi.example/v1/pair/access-code']); unchanged();
});

it.each([{ accessCode: '' }, { accessCode: 'ABC234', gatewayId: 'other-id' }, { accessCode: 'ABC234', relayUrl: 'wss://other.example/ws' }])('rejects an invalid refresh response without exposing a wrong QR', async response => {
  mock.fetch.mockResolvedValue(Response.json(response));
  await expect(pair()).rejects.toThrow('Invalid Pi'); expect(mock.qr).not.toHaveBeenCalled(); unchanged();
});

it('reprints a live local pairing without Registry calls or a second owner', async () => {
  delete config.relay; config.host = '0.0.0.0'; save();
  await pair('--local', '--address', '192.0.2.1');
  expect(JSON.parse(mock.qr.mock.calls[0][0])).toEqual({ version: 1, backendKind: 'pi', mode: 'local', url: 'ws://192.0.2.1:18499/v1/pi/ws', token: 'local-test-token' });
  expect(mock.fetch).not.toHaveBeenCalled(); unchanged();
});

it('does not turn an existing local connection into Relay implicitly', async () => {
  delete config.relay; config.host = '0.0.0.0'; save();
  await expect(pair()).rejects.toThrow('scope'); expect(mock.fetch).not.toHaveBeenCalled(); unchanged();
});

it('preserves the first-time detached pairing path', async () => {
  unlinkSync(path); unlinkSync(join(root, 'sessions', 'owner.lock'));
  await pair('--project', project);
  expect(mock.control).not.toHaveBeenCalled(); expect(mock.background).toHaveBeenCalledTimes(1);
  expect(mock.fetch).not.toHaveBeenCalled(); expect(mock.service).not.toHaveBeenCalled();
});

it('leaves the existing offline pairing startup path unchanged after explicit refusal without an owner lock', async () => {
  unlinkSync(join(root, 'sessions', 'owner.lock'));
  mock.control.mockRejectedValue(Object.assign(new Error('offline'), { code: 'ECONNREFUSED' }));
  await pair('--project', project);
  expect(mock.background).toHaveBeenCalledTimes(1); expect(mock.fetch).not.toHaveBeenCalled();
  expect(readFileSync(path, 'utf8')).toBe(original);
});

it.each(['wss://clawket-pi-relay.clawket.workers.dev/ws', 'wss://pi-relay.clawket.ai/ws'])('refreshes an official alias without replacing its live Pi owner (%s)', async relayUrl => {
  config.relay.registryUrl = 'https://clawket-pi-registry.clawket.workers.dev';
  config.relay.relayUrl = 'wss://clawket-pi-relay.clawket.workers.dev/ws';
  config.relay.invitation.qrPayload = JSON.stringify({ v: 2, k: 'cp', b: 'pi', s: config.relay.registryUrl, g: 'existing-id', a: 'old-code' });
  mock.fetch.mockResolvedValue(Response.json({ gatewayId: 'existing-id', relayUrl, accessCode: 'ABC234' }));
  save(); await pair('--registry', 'https://pi-registry.clawket.ai');
  expect(mock.fetch.mock.calls[0][0]).toBe('https://pi-registry.clawket.ai/v1/pair/access-code');
  expect(JSON.parse(mock.qr.mock.calls[0][0])).toMatchObject({ s: 'https://pi-registry.clawket.ai', g: 'existing-id' });
  unchanged();
});
