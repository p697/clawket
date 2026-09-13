import { test } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('failed Windows reinstallation leaves the active snapshot and rollback untouched', t => {
  assert.equal(process.platform, 'win32', 'Run this integration check on Windows');
  const root = mkdtempSync(join(tmpdir(), 'clawket-install-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin'); mkdirSync(bin);
  const node = join(bin, 'node.exe'); copyFileSync(process.execPath, node);
  // Simulate npm modifying the target before failing (e.g. interrupted install).
  writeFileSync(join(bin, 'npm.cmd'), '@echo off\r\necho partial-install> "%~3\\partial.txt"\r\nexit /b 1\r\n');
  const config = join(root, 'runtime.json'); writeFileSync(config, JSON.stringify({ relay: { relaySecret: 'fixture' } }));
  const cli = join(root, 'index.js'); writeFileSync(cli, 'process.exit(0);');
  for (const name of ['ws', 'qrcode', 'qrcode-terminal', 'tweetnacl']) {
    const directory = join(root, 'node_modules', name); mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0' }));
  }
  const service = join(root, 'windows-service'); mkdirSync(service);
  const oldName = createHash('sha256').update(readFileSync(cli)).digest('hex').slice(0, 16).toUpperCase();
  const old = join(service, 'releases', oldName); mkdirSync(old, { recursive: true });
  writeFileSync(join(old, 'index.mjs'), 'known-good');
  const manifest = JSON.stringify({ node, cli: join(old, 'index.mjs'), config });
  writeFileSync(join(service, 'installation.json'), manifest);
  writeFileSync(join(service, 'installation.json.previous'), 'previous-manifest');
  const installer = fileURLToPath(new URL('./windows-local-model.ps1', import.meta.url));
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer,
      '-Action', 'Install', '-ConfigPath', config, '-NodePath', node, '-CliPath', cli], { encoding: 'utf8' });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Cannot install CLI dependencies/);
    assert.equal(readFileSync(join(service, 'installation.json'), 'utf8'), manifest);
    assert.equal(readFileSync(join(service, 'installation.json.previous'), 'utf8'), 'previous-manifest');
    assert.equal(readFileSync(join(old, 'index.mjs'), 'utf8'), 'known-good');
    const fresh = readdirSync(join(service, 'releases')).filter(name => name !== oldName);
    assert.equal(fresh.length, attempt + 1);
    for (const name of fresh) assert.match(readFileSync(join(service, 'releases', name, 'partial.txt'), 'utf8'), /partial-install/);
  }
});
