import { beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ exec: vi.fn(), hostname: vi.fn(), platform: vi.fn() }));
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), execFileSync: mock.exec }));
vi.mock('node:os', async original => ({ ...await original<typeof import('node:os')>(), hostname: mock.hostname, platform: mock.platform }));
import { defaultDeviceConnectionName } from './device-connection-name.js';

beforeEach(() => {
  mock.exec.mockReset().mockReturnValue(' 工作室的 Mac mini\n');
  mock.hostname.mockReset().mockReturnValue('studio-mac.local');
  mock.platform.mockReset().mockReturnValue('darwin');
});

it.each(['Codex', 'Claude Code'] as const)('uses the macOS friendly name for %s', product => {
  expect(defaultDeviceConnectionName(product)).toBe(`${product} · 工作室的 Mac mini`);
  expect(mock.exec).toHaveBeenCalledWith('/usr/sbin/scutil', ['--get', 'ComputerName'], {
    encoding: 'utf8', timeout: 1_000, maxBuffer: 4_096, stdio: ['ignore', 'pipe', 'ignore'],
  });
  expect(mock.hostname).not.toHaveBeenCalled();
});

it.each(['win32', 'linux'])('uses the hostname on %s without running macOS tools', platform => {
  mock.platform.mockReturnValue(platform);
  mock.hostname.mockReturnValue('STUDIO-PC');
  expect(defaultDeviceConnectionName('Claude Code')).toBe('Claude Code · STUDIO-PC');
  expect(mock.exec).not.toHaveBeenCalled();
});

it('falls back silently after an unavailable or timed-out macOS lookup', () => {
  mock.exec.mockImplementation(() => { throw new Error('private native error'); });
  expect(defaultDeviceConnectionName('Codex')).toBe('Codex · studio-mac');
});

it('falls back when the friendly name is empty', () => {
  mock.exec.mockReturnValue('\u0000\r\n ');
  expect(defaultDeviceConnectionName('Codex')).toBe('Codex · studio-mac');
});

it('normalizes Unicode and whitespace, removes controls and bounds the device name', () => {
  mock.exec.mockReturnValue('  Cafe\u0301\t\u0000工作室\n Mac  ');
  expect(defaultDeviceConnectionName('Codex')).toBe('Codex · Café 工作室 Mac');
  mock.exec.mockReturnValue('💻'.repeat(200));
  expect(defaultDeviceConnectionName('Codex')).toBe(`Codex · ${'💻'.repeat(96)}`);
});

it('keeps plain product defaults when no device name is available', () => {
  mock.exec.mockReturnValue('');
  mock.hostname.mockReturnValue('');
  expect(defaultDeviceConnectionName('Codex')).toBe('Codex');
  mock.hostname.mockImplementation(() => { throw new Error('private hostname error'); });
  expect(defaultDeviceConnectionName('Claude Code')).toBe('Claude Code');
});
