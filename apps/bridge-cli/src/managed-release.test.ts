import { isRuntimeCommand } from './managed-release.js';
import { expect, it } from 'vitest';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
it.each([
  { interpreter: 'current', argv: ['codex', 'run'] },
  { interpreter: 'missing', argv: ['codex', 'run'] },
  { interpreter: 'unusable', argv: ['codex', 'run'] },
  { interpreter: 'unusable', argv: ['run', '--service'] },
  { interpreter: 'unusable', argv: ['hermes', 'relay', 'run'] },
])('delegates $argv with the calling Node when the recorded interpreter is $interpreter, preserving IPC', async ({ interpreter, argv }) => {
  const root = join(homedir(), '.clawket', 'runtime');
  const candidate = join(root, 'releases', 'test', 'dist', 'index.mjs'), original = join(homedir(), 'original', 'dist', 'index.mjs');
  mkdirSync(dirname(candidate), { recursive: true }); mkdirSync(dirname(original), { recursive: true });
  const metadata = { name: '@p697/clawket', version: '3.1.10', clawket: { updateProtocol: 1 } };
  writeFileSync(join(dirname(candidate), '../package.json'), JSON.stringify(metadata)); writeFileSync(join(dirname(original), '../package.json'), JSON.stringify(metadata));
  writeFileSync(candidate, `process.on('disconnect', () => process.exit(0)); process.send({ type: 'ready', pid: process.pid, node: process.execPath, argv: process.argv.slice(2) });`);
  const recordedNode = interpreter === 'current' ? process.execPath : join(root, interpreter + '-node');
  if (interpreter === 'unusable') writeFileSync(recordedNode, 'not a working Node executable');
  writeFileSync(join(root, 'active.json'), JSON.stringify({ version: '3.1.10', entry: realpathSync(candidate), node: recordedNode }));
  await build({ stdin: { contents: `import { delegateManagedRuntime } from ${JSON.stringify(fileURLToPath(new URL('./managed-release.ts', import.meta.url)))}; await delegateManagedRuntime(${JSON.stringify(argv)});`, resolveDir: dirname(original) }, outfile: original, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
  const child = spawn(process.execPath, [original], { env: { ...process.env, HOME: homedir(), USERPROFILE: homedir(), CLAWKET_UPDATE_ACTIVATION: '' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = ''; child.stdout!.on('data', value => { output += value; }); child.stderr!.on('data', () => {});
  const timeout = setTimeout(() => child.kill(), 5000);
  try {
    const exit = new Promise<number | null>(resolve => child.once('exit', resolve));
    const message = await new Promise<any>((resolve, reject) => { child.once('message', resolve); child.once('exit', () => reject(new Error('No background readiness'))); });
    expect(message.type).toBe('ready'); expect(message.pid).not.toBe(child.pid);
    expect(message.node).toBe(process.execPath);
    expect(message.argv).toEqual(argv);
    child.disconnect(); expect(await exit).toBe(0); expect(output).toBe('');
    expect(() => process.kill(message.pid, 0)).toThrow();
  } finally { clearTimeout(timeout); child.kill(); }
}, 10_000);

it('does not interpret a config value as a runtime command', () => {
  expect(isRuntimeCommand(['status', '--config', 'run'])).toBe(false);
  expect(isRuntimeCommand(['codex', 'run', '--config', 'saved'])).toBe(true);
  expect(isRuntimeCommand(['hermes', 'relay', 'run'])).toBe(true);
});
