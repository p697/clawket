import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { updateStoppedService } from './service.js';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(), spawn: vi.fn() }));
const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
const state = join(homedir(), '.clawket');
const launcher = join(state, 'clawket-launcher.sh');
const plist = join(homedir(), 'Library/LaunchAgents/ai.clawket.bridge.cli.plist');
const unit = join(homedir(), '.config/systemd/user/ai.clawket.bridge.cli.service');
const context = { nodePath: process.execPath, scriptPath: join(homedir(), 'new bridge/index.js') };
afterEach(() => {
  Object.defineProperty(process, 'platform', descriptor); vi.resetAllMocks();
  for (const path of [state, join(homedir(), 'Library'), join(homedir(), '.config')]) rmSync(path, { recursive: true, force: true });
});
function setup(platform: string, registration: string) {
  Object.defineProperty(process, 'platform', { ...descriptor, value: platform });
  mkdirSync(state, { recursive: true }); mkdirSync(dirname(registration), { recursive: true });
  writeFileSync(launcher, 'original launcher', { mode: 0o700 }); writeFileSync(registration, 'original registration');
}
it.each([['darwin', plist], ['linux', unit]])('refreshes a stopped %s registration and can restore it without starting a process', (platform, path) => {
  setup(platform, path);
  vi.mocked(execFileSync).mockImplementation((command, args) => {
    if (command === 'launchctl') return 'active count = 0' as any;
    if (command === 'systemctl' && (args as string[]).includes('is-active')) throw new Error('inactive');
    return '' as any;
  });
  const restore = updateStoppedService(context)!;
  expect(readFileSync(launcher, 'utf8')).toContain(context.scriptPath);
  expect(readFileSync(path, 'utf8')).toContain('clawket-launcher.sh');
  expect(spawn).not.toHaveBeenCalled();
  const commands = vi.mocked(execFileSync).mock.calls;
  expect(commands.some(([, args]) => (args as string[]).some(arg => ['load', 'enable', 'start', 'restart'].includes(arg)))).toBe(false);
  restore(); expect(readFileSync(launcher, 'utf8')).toBe('original launcher'); expect(readFileSync(path, 'utf8')).toBe('original registration');
});
it('updates only the existing Windows Run value and restores it without spawning', () => {
  Object.defineProperty(process, 'platform', { ...descriptor, value: 'win32' });
  vi.mocked(execFileSync).mockReturnValue('ClawketBridgeCli    REG_SZ    original command' as any);
  const restore = updateStoppedService(context)!;
  expect(vi.mocked(execFileSync).mock.calls.at(-1)?.[1]).toContainEqual(expect.stringContaining('new bridge'));
  expect(spawn).not.toHaveBeenCalled(); restore();
  expect(vi.mocked(execFileSync).mock.calls.at(-1)?.[1]).toContain('original command');
});
it('preserves unrelated cron entries, refreshes only Clawket, and restores the registration', () => {
  setup('linux', join(state, 'bridge-service.cron'));
  let cron = '0 * * * * unrelated-job\n@reboot old-bridge # clawket-bridge-cli\n';
  vi.mocked(execFileSync).mockImplementation((command, args, options) => {
    if (command === 'crontab' && (args as string[])[0] === '-l') return cron as any;
    if (command === 'crontab' && (args as string[])[0] === '-') cron = (options as { input: string }).input;
    return '' as any;
  });
  const restore = updateStoppedService(context)!;
  expect(cron).toContain('unrelated-job'); expect(cron).toContain('clawket-launcher.sh'); expect(spawn).not.toHaveBeenCalled();
  restore(); expect(cron).toContain('old-bridge'); expect(cron).toContain('unrelated-job');
});
it('does not install absent registrations or touch a running service', () => {
  Object.defineProperty(process, 'platform', { ...descriptor, value: 'darwin' });
  expect(updateStoppedService(context)).toBeNull(); expect(existsSync(launcher)).toBe(false);
  setup('darwin', plist); vi.mocked(execFileSync).mockReturnValue('active count = 1' as any);
  writeFileSync(join(state, 'bridge-service.json'), JSON.stringify({ pid: process.pid }));
  expect(() => updateStoppedService(context)).toThrow('started during update'); expect(readFileSync(launcher, 'utf8')).toBe('original launcher');
});
it('restores files when reloading the stopped systemd registration fails', () => {
  setup('linux', unit); let reload = 0;
  vi.mocked(execFileSync).mockImplementation((command, args) => {
    if (command === 'systemctl' && (args as string[]).includes('is-active')) throw new Error('inactive');
    if ((args as string[]).includes('daemon-reload') && reload++ === 0) throw new Error('reload failed');
    return '' as any;
  });
  expect(() => updateStoppedService(context)).toThrow('reload failed'); expect(readFileSync(launcher, 'utf8')).toBe('original launcher'); expect(readFileSync(unit, 'utf8')).toBe('original registration');
});
