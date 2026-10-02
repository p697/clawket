import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
const control = vi.hoisted(() => ({ codex: vi.fn(), claude: vi.fn(), pi: vi.fn() }));
vi.mock('./codex-lifecycle.js', () => ({ codexControl: control.codex }));
vi.mock('./claude-code-lifecycle.js', () => ({ claudeControl: control.claude }));
vi.mock('./pi-lifecycle.js', () => ({ piControl: control.pi }));
import { discoverAgentTargets, inspectAgent, inspectAgents, selectAgentTarget } from './agent-inventory.js';

const scope = 'a'.repeat(16);
const config = () => ({ project: homedir(), command: 'native', token: 'secret-token', host: '127.0.0.1', port: 19501, relay: { relaySecret: 'secret-relay', invitation: { qrPayload: 'secret-qr' } } });
function save(backend = 'codex', environment = 'production', value: unknown = config(), folder = 'device') {
  const path = join(homedir(), '.clawket', backend, folder, ...(backend === 'pi' ? [] : [environment]), 'runtime.json');
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value)); return path;
}
beforeEach(() => { Object.values(control).forEach(fn => fn.mockReset().mockResolvedValue({ modelReady: true })); });
afterEach(() => { rmSync(join(homedir(), '.clawket'), { recursive: true, force: true }); });

it('discovers every saved device/project/environment without scanning native histories or following symlinks', () => {
  save(); save('codex', 'preview'); save('claude-code', 'production', config(), scope); save('pi', 'custom', config(), scope);
  save('codex', 'production', config(), 'native-history');
  if (process.platform !== 'win32') symlinkSync(join(homedir(), '.clawket', 'codex', 'device'), join(homedir(), '.clawket', 'codex', 'b'.repeat(16)), 'dir');
  const targets = discoverAgentTargets();
  expect(targets.map(t => `${t.backend}:${t.environment}`)).toEqual(['codex:production', 'codex:preview', 'claude-code:production', 'pi:custom']);
  expect(discoverAgentTargets('codex', true)).toHaveLength(1);
});
it('selects missing device state without creating a fallback project or configuration directory', async () => {
  const target = selectAgentTarget('codex', []);
  expect((await inspectAgent(target)).state).toBe('unpaired');
  expect(existsSync(join(homedir(), 'Documents'))).toBe(false);
  expect(existsSync(join(homedir(), '.clawket'))).toBe(false);
  expect(control.codex).not.toHaveBeenCalled();
});
it('rejects conflicting scope and refuses an inferred Pi Preview configuration', () => {
  expect(() => selectAgentTarget('codex', ['--device', '--project', homedir(), '--config', '/config'])).toThrow('Choose --device');
  expect(() => selectAgentTarget('pi', ['--preview'])).toThrow('original isolated --config');
  expect(selectAgentTarget('pi', ['--preview', '--config', join(homedir(), 'pi-preview.json')]).environment).toBe('custom');
});
it('fails explicitly instead of silently dropping excess inventory', () => {
  for (let index = 0; index < 33; index++) save('codex', 'production', config(), index.toString(16).padStart(16, '0'));
  expect(() => discoverAgentTargets()).toThrow('More than 32');
});
it('keeps an explicit configuration diagnosable after its project was removed', async () => {
  const path = save('codex', 'production', { ...config(), project: join(homedir(), 'removed') });
  const result = await inspectAgent(selectAgentTarget('codex', ['--config', path]));
  expect(result).toMatchObject({ state: 'ready', projectAvailable: false, environment: 'custom' });
  expect(result.finding).toContain('unavailable');
});
it.each(['codex', 'claude-code', 'pi'] as const)('reports %s with bounded authenticated health and never exposes config credentials', async backend => {
  const path = save(backend, 'production', config(), scope), before = readFileSync(path, 'utf8');
  const result = await inspectAgents([{ backend, configPath: path, environment: 'production' }]);
  expect(result[0]).toMatchObject({ state: 'ready', modelConfigured: true, transport: 'relay' });
  expect(JSON.stringify(result)).not.toMatch(/secret-token|secret-relay|secret-qr/);
  expect(readFileSync(path, 'utf8')).toBe(before);
});
it.each(['ECONNRESET', 'ETIMEDOUT', undefined])('does not equate uncertain health (%s) with offline', async code => {
  const path = save(); control.codex.mockRejectedValue(Object.assign(new Error('private-native-error'), { code }));
  const result = await inspectAgent({ backend: 'codex', configPath: path, environment: 'production' });
  expect(result.state).toBe('unverified'); expect(JSON.stringify(result)).not.toContain('private-native-error');
});
it('classifies only connection refusal as stopped', async () => {
  const path = save(); control.codex.mockRejectedValue(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }));
  expect((await inspectAgent({ backend: 'codex', configPath: path, environment: 'production' })).state).toBe('stopped');
});
it.each([null, {}, { ...config(), port: 70000 }, { ...config(), token: 12 }])('fails closed on corrupt configuration %# without probing', async value => {
  const path = save('codex', 'production', value);
  expect((await inspectAgent({ backend: 'codex', configPath: path, environment: 'production' })).state).toBe('invalid');
  expect(control.codex).not.toHaveBeenCalled();
});
