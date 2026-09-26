import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { getFreePort } from '../integration/harness';

it('runs the built CLI against installed Pi: detached local pairing, authenticated control, restart and non-destructive reset', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'clawket-pi-cli-')));
  const config = join(root, 'bridge/runtime.json'), project = join(root, 'project'), agent = join(root, 'agent');
  mkdirSync(project); mkdirSync(agent);
  const command = (action: string, extra: string[] = []) => promisify(execFile)(process.execPath,
    [resolve('apps/bridge-cli/dist/index.js'), 'pi', action, '--project', project, '--config', config, ...extra],
    { timeout: 60000, maxBuffer: 256000, env: { ...process.env, HOME: root, USERPROFILE: root, PI_CODING_AGENT_DIR: agent } });
  try {
    const port = await getFreePort();
    const paired = await command('pair', ['--local', '--address', '127.0.0.1', '--host', '127.0.0.1', '--port', String(port)]);
    expect(paired.stdout).toContain('running in the background');
    expect((await command('status')).stdout).toContain('ready');
    expect((await command('doctor')).stdout).toContain('Pi RPC: ready');
    const token = JSON.parse(readFileSync(config, 'utf8')).token;
    const logs = await command('logs'); expect(logs.stdout).not.toContain(token);
    expect((await command('stop')).stdout).toContain('stopped');
    expect((await command('status')).stdout).toContain('offline');
    expect((await command('start')).stdout).toContain('running in the background');
    await command('restart'); expect((await command('status')).stdout).toContain('ready');
    await command('reset'); expect(existsSync(config)).toBe(false);
    expect(existsSync(join(root, 'bridge/sessions/sessions.json'))).toBe(true);
    expect(existsSync(join(root, 'bridge/sessions/owner.lock'))).toBe(false);
  } finally {
    await command('stop').catch(() => {});
    // Never erase a still-owned profile if a lifecycle regression leaves it running.
    if (!existsSync(join(root, 'bridge/sessions/owner.lock'))) rmSync(root, { recursive: true, force: true });
  }
});
