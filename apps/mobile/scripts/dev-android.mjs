import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('npm run dev:android -- [Expo start arguments]\nSet ANDROID_HOME and optionally ANDROID_SERIAL, METRO_PORT. Install dependencies first.');
  process.exit(0);
}
const executable = process.platform === 'win32' ? 'adb.exe' : 'adb';
const candidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT,
  process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? homedir(), 'Android', 'Sdk') : join(homedir(), 'Library', 'Android', 'sdk'),
  '/opt/homebrew/share/android-commandlinetools',
].filter(Boolean).map(directory => join(directory, 'platform-tools', executable));
const adb = candidates.find(existsSync) ?? executable;
function run(command, argv, options = {}) {
  const result = spawnSync(command, argv, { cwd: root, windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
  return result.stdout;
}
const port = process.env.METRO_PORT ?? '8081';
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid METRO_PORT');
const devices = run(adb, ['devices'], { encoding: 'utf8' }).split(/\r?\n/)
  .map(line => line.trim().split(/\s+/)).filter(parts => parts[1] === 'device').map(parts => parts[0]);
const serial = process.env.ANDROID_SERIAL ?? (devices.length === 1 ? devices[0] : undefined);
if (!serial || !devices.includes(serial)) throw new Error('Connect and authorize an Android device; set ANDROID_SERIAL if multiple devices are connected.');
run(adb, ['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`], { stdio: 'inherit' });
console.log('Open the installed Android debug app. Metro supports hot reload.');
run(process.execPath, [require.resolve('expo/bin/cli'), 'start', '--port', port, ...args], {
  stdio: 'inherit', env: { ...process.env, PATH: `${dirname(adb)}${delimiter}${process.env.PATH ?? ''}` },
});
