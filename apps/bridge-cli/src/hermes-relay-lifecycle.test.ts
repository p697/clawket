import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('yielded Hermes relay process', () => {
  it.each(['SIGINT', 'SIGTERM'])('stays alive without sockets, then releases on %s', async (signal) => {
    const moduleUrl = new URL('./hermes-relay-lifecycle.ts', import.meta.url).href;
    const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `
      import { keepHermesRelayRuntimeAlive } from ${JSON.stringify(moduleUrl)};
      // An unref timer cannot keep this child alive by itself.
      setTimeout(() => process.emit(${JSON.stringify(signal)}), 100).unref();
      await keepHermesRelayRuntimeAlive({
        async stop() { process.stdout.write('runtime stopped'); }
      });
    `], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5_000);
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });
      expect(code, stderr).toBe(0);
      expect(stdout).toBe('runtime stopped');
    } finally { clearTimeout(timeout); child.kill(); }
  });
});
