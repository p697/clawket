import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true, env: { ...process.env, CI: '1' } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT) throw new Error('Set ANDROID_HOME to an installed Android SDK.');
const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
if (!existsSync(join(root, 'android', 'gradle', 'wrapper', 'gradle-wrapper.jar'))) {
  run(process.execPath, [require.resolve('expo/bin/cli'), 'prebuild', '--platform', 'android', '--no-install']);
}
run(java, ['-classpath', 'gradle/wrapper/gradle-wrapper.jar', 'org.gradle.wrapper.GradleWrapperMain', ':app:assembleDebug', '--no-daemon'], join(root, 'android'));
console.log('Debug APK: android/app/build/outputs/apk/debug/app-debug.apk. No publication performed.');
