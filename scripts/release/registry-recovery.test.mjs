import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateSnapshot, recoveryConfig } from './registry-recovery.mjs';
test('snapshot validation rejects missing, empty and modified exports', () => {
  const source = 'export default {}';
  const entry = { name: 'clawket-registry', sha256: createHash('sha256').update(source).digest('hex') };
  validateSnapshot(source, entry, entry.name);
  for (const data of ['', source + ';', undefined]) assert.throws(() => validateSnapshot(data, entry, entry.name));
  assert.throws(() => validateSnapshot(source, undefined, entry.name));
});
test('config preserves bindings and migration; refuses another backend or missing class', () => {
  const config = 'name = "clawket-registry"\nmain = "src/index.ts"\nclass_name = "PairRegisterRateLimiter"\nnew_sqlite_classes = ["PairRegisterRateLimiter"]\n';
  assert.equal(recoveryConfig(config, 'clawket-registry', './bundle/index.js'), config.replace('src/index.ts', './bundle/index.js'));
  assert.throws(() => recoveryConfig(config, 'clawket-hermes-registry', 'x'));
  assert.throws(() => recoveryConfig(config.replace('class_name', 'other'), 'clawket-registry', 'x'));
});

test('recovery verification refuses corrupted files and empty manifests', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { verifyRecovery } = await import('./registry-recovery.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'recovery-validation-'));
  try {
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ artifacts: [] }));
    await assert.rejects(() => verifyRecovery(dir));
    const artifacts = [];
    const hash = data => createHash('sha256').update(data).digest('hex');
    for (const name of ['clawket-registry', 'clawket-hermes-registry']) {
      await mkdir(join(dir, name, 'bundle'), { recursive: true });
      const config = `name = "${name}"\nmain = "./bundle/index.js"\nclass_name = "PairRegisterRateLimiter"\nnew_sqlite_classes = ["PairRegisterRateLimiter"]\n`;
      await writeFile(join(dir, name, 'production.js'), 'export default {}');
      await writeFile(join(dir, name, 'bundle/index.js'), 'export default {}');
      await writeFile(join(dir, name, 'wrangler.toml'), config);
      artifacts.push({ name, productionSha256: hash('export default {}'), recoverySha256: hash('export default {}'), deploymentConfigSha256: hash(config) });
    }
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ artifacts }));
    await verifyRecovery(dir);
    await writeFile(join(dir, 'clawket-registry/bundle/index.js'), 'corrupted');
    await assert.rejects(() => verifyRecovery(dir), /integrity mismatch/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
