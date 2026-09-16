import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { control, diagnostic, retryDelay } from './local-model-supervisor.mjs';

const supervisor = new URL('./local-model-supervisor.mjs', import.meta.url);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { try { const result = await fn(); if (result) return result; } catch {} await pause(50); }
  throw new Error('Timed out');
}
test('bounded retry and diagnostic redaction', () => {
  assert.deepEqual([1,2,3,4,5,100].map(retryDelay), [30000,60000,120000,240000,300000,300000]);
  assert.equal(diagnostic('secret token, pairing code and chat body'), 'child_output_redacted');
  assert.equal(diagnostic('error: Local model Bridge is running. secret'), 'child_output_redacted');
  assert.equal(diagnostic('local-model relay transport connected'), 'socket_open');
});
test('real processes: exclusive owner, ready-only reset, graceful stop and no retry after stop', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clawket-supervisor-'));
  const config = join(root, 'runtime.json');
  const dir = join(root, 'windows-service');
  mkdirSync(dir); writeFileSync(config, '{}');
  const fixture = join(root, 'child.mjs');
  writeFileSync(fixture, `
    import { existsSync, writeFileSync } from 'node:fs';
    console.log('local-model relay transport connected');
    console.log('sensitive payload must not be persisted');
    if (process.env.CLAWKET_TEST_FAIL === '1') process.exit(1);
    if (process.env.CLAWKET_TEST_FAIL === 'once' && !existsSync('failed-once')) { writeFileSync('failed-once',''); process.exit(1); }
    console.log('Local model Bridge is running. Keep this process open; press Ctrl+C to stop.');
    const stop = () => process.exit(0);
    process.on('disconnect', stop); process.on('message', stop);
    setInterval(() => {}, 1000);
  `);
  writeFileSync(join(dir, 'installation.json'), JSON.stringify({ node: process.execPath, cli: fixture, config }));
  const start = env => spawn(process.execPath, [fileURLToPath(supervisor), 'run', config], { stdio: 'ignore', env: { ...process.env, ...env } });
  let daemon = start();
  t.after(async () => { try { await control(config, 'stop'); } catch {} daemon.kill(); await pause(200); rmSync(root, { recursive: true, force: true }); });
  const status = await until(async () => { const s = await control(config, 'status'); return s.ready && s; });
  const duplicate = start();
  assert.equal((await once(duplicate, 'exit'))[0], 1);
  assert.equal((await control(config, 'status')).childPid, status.childPid);
  const exited = once(daemon, 'exit');
  await control(config, 'stop'); await exited;
  assert.throws(() => process.kill(status.childPid, 0));
  assert.equal(readFileSync(config, 'utf8'), '{}');
  assert.ok(!readFileSync(join(dir, 'supervisor.jsonl'), 'utf8').includes('sensitive payload'));
  daemon = start({ CLAWKET_TEST_FAIL: '1' });
  await until(async () => (await control(config, 'status')).attempts === 1);
  const failed = await control(config, 'status');
  assert.equal(failed.ready, false); assert.equal(failed.childPid, null);
  const stopped = once(daemon, 'exit'); await control(config, 'stop'); await stopped;
  const events = readFileSync(join(dir, 'supervisor.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.filter(e => e.event === 'child_started').length, 2);
  assert.equal(events.find(e => e.event === 'child_retry').delayMs, 30000);
  daemon = start({ CLAWKET_TEST_FAIL: 'once' });
  const retryStarted = Date.now();
  const recovered = await until(async () => { const s = await control(config, 'status'); return s.ready && s; }, 40_000);
  assert.ok(Date.now() - retryStarted >= 30_000);
  assert.equal(recovered.attempts, 0);
  const killed = once(daemon, 'exit'); daemon.kill(); await killed;
  await until(() => { try { process.kill(recovered.childPid, 0); return false; } catch { return true; } });
});


test('stop completion and immediate/concurrent start never leave the service offline', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clawket-restart-'));
  const config = join(root, 'runtime.json');
  const dir = join(root, 'windows-service');
  mkdirSync(dir); writeFileSync(config, '{}');
  const fixture = join(root, 'child.mjs');
  writeFileSync(fixture, `
    console.log('Local model Bridge is running. Keep this process open; press Ctrl+C to stop.');
    process.on('message', () => setTimeout(() => process.exit(0), 800));
    process.on('disconnect', () => process.exit(0));
    setInterval(() => {}, 1000);
  `);
  writeFileSync(join(dir, 'installation.json'), JSON.stringify({ node: process.execPath, cli: fixture, config }));
  const command = action => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [fileURLToPath(supervisor), action, config]);
    let output = ''; p.stdout.on('data', b => { output += b; });
    p.on('error', reject); p.on('close', code => code === 0 ? resolve(JSON.parse(output)) : reject(new Error(`command failed: ${code}`)));
  });
  t.after(async () => { try { await control(config, 'stop'); } catch {} await pause(200); rmSync(root, { recursive: true, force: true }); });
  await command('start');
  const original = await until(async () => { const s = await control(config, 'status'); return s.ready && s; });
  const stopping = control(config, 'stop');
  await until(async () => (await control(config, 'status')).stopping);
  const starts = Promise.all([command('start'), command('start')]);
  const stopped = await stopping;
  assert.equal(stopped.childPid, null);
  assert.throws(() => process.kill(original.childPid, 0));
  const [a, b] = await starts;
  assert.equal(a.pid, b.pid); assert.notEqual(a.pid, original.pid);
  await until(async () => (await control(config, 'status')).ready);
  // The documented sequential Stop -> Start flow must also restore a fresh owner.
  await command('stop'); await command('start');
  const final = await until(async () => { const s = await control(config, 'status'); return s.ready && s; });
  assert.notEqual(final.pid, a.pid);
});

// The existing desktop workflow runs this entry on both platforms.
if (process.platform === 'win32') await import('./windows-local-model-install.test.mjs');
