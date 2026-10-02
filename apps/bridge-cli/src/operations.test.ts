import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CliDoctorReport } from './diagnostics.js';
const controls = vi.hoisted(() => ({ codex: vi.fn(), claude: vi.fn(), pi: vi.fn() }));
vi.mock('./codex-lifecycle.js', () => ({ codexControl: controls.codex }));
vi.mock('./claude-code-lifecycle.js', () => ({ claudeControl: controls.claude }));
vi.mock('./pi-lifecycle.js', () => ({ piControl: controls.pi }));
vi.mock('@clawket/bridge-core', () => ({
  getServicePaths: () => ({ logPath: '/openclaw.log', errorLogPath: '/openclaw-error.log' }),
  getHermesProcessLogPaths: () => ({ bridgeLogPath: '/hermes.log', relayLogPath: '/hermes-relay.log', bridgeErrorLogPath: '/hermes-error.log', relayErrorLogPath: '/hermes-relay-error.log' }),
}));
import { handleAgentDiagnostics, printOperations, productConnections, productLogSources, requestedBackend } from './operations.js';
const old = { paired: false, serviceRunning: false, localGatewayReachable: false, hermesBridgeConfigFound: false, hermesRelayPaired: false } as CliDoctorReport;
function save(backend = 'codex') {
  const path = join(homedir(), '.clawket', backend, backend === 'pi' ? 'a'.repeat(16) : 'device', ...(backend === 'pi' ? [] : ['production']), 'runtime.json');
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify({ project: homedir(), token: 'private-token', command: backend, port: 18499, host: '127.0.0.1', device: backend !== 'pi' })); return path;
}
beforeEach(() => { process.exitCode = 0; Object.values(controls).forEach(fn => fn.mockReset().mockResolvedValue({ modelReady: true })); });
afterEach(() => { process.exitCode = 0; vi.restoreAllMocks(); rmSync(join(homedir(), '.clawket'), { recursive: true, force: true }); });
it('covers the three new Agents on default status and doctor without a false missing legacy diagnosis', async () => {
  save(); save('claude-code'); save('pi');
  const rows = await productConnections(old, false, []);
  expect(rows.map(row => row.backend)).toEqual(['openclaw', 'hermes', 'codex', 'claude-code', 'pi']);
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  printOperations('doctor', rows, ['--json'], { paired: false });
  const result = JSON.parse(output.mock.calls[0][0]);
  expect(result).toMatchObject({ paired: false, summary: { overall: 'healthy', findings: [] } });
  expect(JSON.stringify(result)).not.toContain('private-token'); expect(process.exitCode).toBe(0);
});
it('keeps status concise and machine-readable on a single selected backend', async () => {
  save(); const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  const rows = await productConnections(undefined, false, ['--backend', 'codex']);
  printOperations('status', rows, []);
  expect(output.mock.calls.flat().join('\n')).toContain('Codex · device · production: ready (local)');
  expect(output.mock.calls.flat().join('\n')).not.toMatch(/private-token|runtime.json|Capabilities|Gateway ID/);
  expect(controls.claude).not.toHaveBeenCalled(); expect(controls.pi).not.toHaveBeenCalled();
});
it('returns a failing doctor result for uncertain health with actionable guidance', async () => {
  save(); controls.codex.mockRejectedValue(new Error('private-error'));
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  printOperations('doctor', await productConnections(undefined, false, ['--backend', 'codex']), ['--json']);
  const result = JSON.parse(output.mock.calls[0][0]);
  expect(result.connections[0].state).toBe('unverified'); expect(result.summary.overall).toBe('degraded');
  expect(result.summary.findings.join()).toContain('Inspect logs'); expect(process.exitCode).toBe(1);
});
it('logs remain usable with corrupt configuration and do not start or probe any Agent', async () => {
  const path = save(); writeFileSync(path, '{corrupt-private-content'); writeFileSync(join(dirname(path), 'codex.log'), 'diagnostic\n');
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  expect(await handleAgentDiagnostics('codex', ['logs', '--config', path, '--json'])).toBe(true);
  expect(JSON.parse(output.mock.calls[0][0]).entries[0].text).toBe('diagnostic');
  expect(controls.codex).not.toHaveBeenCalled(); expect(readFileSync(path, 'utf8')).toBe('{corrupt-private-content');
});
it('includes legacy stderr and all saved Agent logs by default, with precise filtering', () => {
  save(); save('claude-code'); save('pi');
  const sources = productLogSources([]);
  expect(sources.map(source => source.name)).toEqual(expect.arrayContaining(['openclaw:stderr', 'hermes:relay:stderr', 'codex:production:1', 'claude-code:production:2', 'pi:custom:3']));
  expect(productLogSources(['--backend', 'claude-code'])).toHaveLength(1);
  expect(productLogSources(['--backend', 'local-model'])[0].path).toBe(join(homedir(), '.clawket', 'local-model-preview', 'windows-service', 'supervisor.jsonl'));
});
it('does not enroll Hermes or Pi default state into Preview diagnostics', async () => {
  save('pi');
  const rows = await productConnections(old, true, ['--preview']);
  expect(rows.map(row => row.backend)).toEqual(['openclaw']);
  expect(() => productLogSources(['--backend', 'pi', '--preview'])).toThrow('original isolated --config');
});
it('rejects unknown backends and missing values before any default operation', () => {
  expect(() => requestedBackend(['--backend', 'claude'])).toThrow('Unknown --backend');
  expect(() => requestedBackend(['--backend'])).toThrow('requires a value');
});
