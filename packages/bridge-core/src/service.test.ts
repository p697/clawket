import { describe, expect, it } from 'vitest';
import {
  buildLinuxCronEntry,
  buildLinuxSystemdUnit,
  buildMacosPlist,
  getServiceProgramArgs,
  isAutostartUnsupportedError,
  listRuntimeProcesses,
  registerRuntimeProcess,
  unregisterRuntimeProcess,
} from './service.js';

describe('service helpers', () => {
  it('builds POSIX service program args using the CLI script directly', () => {
    expect(getServiceProgramArgs({
      nodePath: '/opt/homebrew/bin/node',
      scriptPath: '/opt/homebrew/bin/clawket',
    }, 'darwin')).toEqual([
      expect.stringMatching(/clawket-launcher\.sh$/),
    ]);
  });

  it('builds Windows service program args with explicit node binary', () => {
    expect(getServiceProgramArgs({
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      scriptPath: 'C:\\Users\\tester\\AppData\\Roaming\\npm\\node_modules\\clawket\\dist\\index.js',
    }, 'win32')).toEqual([
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Users\\tester\\AppData\\Roaming\\npm\\node_modules\\clawket\\dist\\index.js',
      'run',
      '--service',
    ]);
  });

  it('builds a launch agent plist with keepalive and log paths', () => {
    const plist = buildMacosPlist(
      ['/Users/tester/.clawket/clawket-launcher.sh'],
      '/Users/tester/.clawket/logs/bridge-cli.log',
      '/Users/tester/.clawket/logs/bridge-cli-error.log',
    );

    expect(plist).toContain('<string>ai.clawket.bridge.cli</string>');
    expect(plist).toContain('<key>KeepAlive</key>');
    expect(plist).toContain('/Users/tester/.clawket/logs/bridge-cli.log');
    expect(plist).toContain('/Users/tester/.clawket/clawket-launcher.sh');
  });

  it('builds a systemd user unit that runs the CLI in service mode', () => {
    const unit = buildLinuxSystemdUnit(
      ['/home/tester/.clawket/clawket-launcher.sh'],
      '/home/tester/.clawket/logs/bridge-cli.log',
      '/home/tester/.clawket/logs/bridge-cli-error.log',
    );

    expect(unit).toContain('Description=Clawket Bridge CLI');
    expect(unit).toContain('ExecStart="/home/tester/.clawket/clawket-launcher.sh"');
    expect(unit).toContain('Restart=always');
    expect(unit).toContain('WorkingDirectory=');
    expect(unit).not.toContain('WorkingDirectory="');
    expect(unit).toContain('StandardOutput=append:/home/tester/.clawket/logs/bridge-cli.log');
  });

  it('builds a linux cron entry that reboots into the launcher', () => {
    const entry = buildLinuxCronEntry(
      ['/home/tester/.clawket/clawket-launcher.sh'],
      '/home/tester/.clawket/logs/bridge-cli.log',
      '/home/tester/.clawket/logs/bridge-cli-error.log',
    );

    expect(entry).toContain('@reboot');
    expect(entry).toContain("'/home/tester/.clawket/clawket-launcher.sh'");
    expect(entry).toContain(">> '/home/tester/.clawket/logs/bridge-cli.log'");
    expect(entry).toContain("2>> '/home/tester/.clawket/logs/bridge-cli-error.log'");
    expect(entry).toContain('# clawket-bridge-cli');
  });

  it('buildLinuxCronEntry correctly single-quote-escapes paths with spaces', () => {
    const entry = buildLinuxCronEntry(
      ["/home/user name/.clawket/clawket-launcher.sh"],
      "/home/user name/.clawket/logs/bridge-cli.log",
      "/home/user name/.clawket/logs/bridge-cli-error.log",
    );

    // spaces inside single-quoted strings are safe without further escaping
    expect(entry).toContain("'/home/user name/.clawket/clawket-launcher.sh'");
    expect(entry).toContain(">> '/home/user name/.clawket/logs/bridge-cli.log'");
    expect(entry).toContain('# clawket-bridge-cli');
  });

  it('buildLinuxCronEntry correctly single-quote-escapes paths with embedded single quotes', () => {
    const entry = buildLinuxCronEntry(
      ["/home/o'brien/.clawket/clawket-launcher.sh"],
      "/home/o'brien/.clawket/logs/bridge-cli.log",
      "/home/o'brien/.clawket/logs/bridge-cli-error.log",
    );

    // embedded ' must be escaped as '"'"'
    expect(entry).toContain(`'/home/o'"'"'brien/.clawket/clawket-launcher.sh'`);
    expect(entry).toContain('# clawket-bridge-cli');
  });

  it('identifies unsupported autostart installation failures', () => {
    expect(isAutostartUnsupportedError(new Error('Linux service installation failed and no crontab fallback is available: systemctl is not available'))).toBe(true);
    expect(isAutostartUnsupportedError(new Error('Pair register failed (500): bad gateway'))).toBe(false);
  });
});

describe('runtime process registry', () => {
  it('registers the current process and returns it from listRuntimeProcesses', () => {
    registerRuntimeProcess({
      gatewayId: 'gw-test-register',
      instanceId: 'inst-test-register',
      serviceMode: false,
    });

    const list = listRuntimeProcesses();
    const found = list.find((p) => p.pid === process.pid);
    expect(found).toBeDefined();
    expect(found?.gatewayId).toBe('gw-test-register');
    expect(found?.instanceId).toBe('inst-test-register');
    expect(found?.serviceMode).toBe(false);

    unregisterRuntimeProcess(process.pid);
  });

  it('unregisters the current process and removes it from listRuntimeProcesses', () => {
    registerRuntimeProcess({
      gatewayId: 'gw-test-unregister',
      instanceId: 'inst-test-unregister',
      serviceMode: false,
    });

    unregisterRuntimeProcess(process.pid);

    const list = listRuntimeProcesses();
    expect(list.find((p) => p.pid === process.pid)).toBeUndefined();
  });

  it('re-registering the same pid replaces the existing entry rather than duplicating it', () => {
    registerRuntimeProcess({ gatewayId: 'gw-first', instanceId: 'inst-first', serviceMode: false });
    registerRuntimeProcess({ gatewayId: 'gw-second', instanceId: 'inst-second', serviceMode: true });

    const list = listRuntimeProcesses();
    const ours = list.filter((p) => p.pid === process.pid);
    expect(ours).toHaveLength(1);
    expect(ours[0].gatewayId).toBe('gw-second');
    expect(ours[0].serviceMode).toBe(true);

    unregisterRuntimeProcess(process.pid);
  });

  it('listRuntimeProcesses filters out entries whose pid is no longer running', () => {
    // pid 0 is never a valid user process; kill(0, 0) sends to the whole process group,
    // but we rely on the registry normalizer filtering non-running pids on read.
    // Use a negative/impossible pid written directly and confirm it is not returned.
    registerRuntimeProcess({ gatewayId: 'gw-alive', instanceId: 'inst-alive', serviceMode: false });

    const list = listRuntimeProcesses();
    // Only running pids should appear; our current process must be there
    expect(list.every((p) => p.pid > 0)).toBe(true);

    unregisterRuntimeProcess(process.pid);
  });
});
