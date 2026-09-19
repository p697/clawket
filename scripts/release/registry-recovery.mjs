import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const digest = data => createHash('sha256').update(data).digest('hex');
export function validateSnapshot(content, entry, name) {
  if (!content?.trim() || !entry || entry.name !== name || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')
    || digest(content) !== entry.sha256 || !content.includes('export')) throw new Error(`Invalid production snapshot: ${name}`);
}
export function recoveryConfig(config, name, main) {
  if (!new RegExp(`^name\\s*=\\s*"${name}"\\s*$`, 'm').test(config)
    || (config.match(/^main\s*=/gm) ?? []).length !== 1
    || !config.includes('class_name = "PairRegisterRateLimiter"')
    || !config.includes('new_sqlite_classes = ["PairRegisterRateLimiter"]')) throw new Error('Recovery requires the matching candidate Registry config and migration');
  return config.replace(/^main\s*=.*$/m, `main = ${JSON.stringify(main)}`);
}

/** No deployment: pin the previous production bundle and retain the new pairing-write safety boundary. */
export async function prepareRecovery({ snapshots, output, configs }) {
  if (!snapshots || !output || !configs || configs.length !== 2) throw new Error('Snapshots, output and both Registry configs are required');
  const manifest = JSON.parse(await readFile(join(snapshots, 'manifest.json'), 'utf8'));
  if (!Array.isArray(manifest) || !manifest.length) throw new Error('Invalid snapshot manifest');
  await mkdir(output, { recursive: false }); // Never silently replace a rehearsed artifact.
  const artifacts = [];
  for (const [index, name] of ['clawket-registry', 'clawket-hermes-registry'].entries()) {
    const content = await readFile(join(snapshots, `${name}.js`), 'utf8');
    validateSnapshot(content, manifest.find(item => item.name === name), name);
    const dir = join(output, name);
    await mkdir(dir);
    await writeFile(join(dir, 'production.js'), content);
    const source = `import legacy from './production.js';
import candidate from ${JSON.stringify(join(root, 'apps/relay-registry/src/index.ts'))};
export { PairRegisterRateLimiter } from ${JSON.stringify(join(root, 'apps/relay-registry/src/index.ts'))};
export default { fetch(request, env, ctx) {
  const path = new URL(request.url).pathname;
  // Keep the SQLite limit, unclaimed TTL and invitation invalidation across every pairing write.
  const base = env.RELAY_BACKEND === 'hermes' ? '/v1/hermes/pair' : '/v1/pair';
  const safeWrite = request.method === 'POST' && ['register', 'access-code', 'claim'].some(action => path === base + '/' + action);
  return (safeWrite ? candidate : legacy).fetch(request, env, ctx);
} };
`;
    await writeFile(join(dir, 'index.ts'), source);
    const config = await readFile(configs[index], 'utf8');
    await writeFile(join(dir, 'build.toml'), recoveryConfig(config, name, './index.ts'));
    execFileSync(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), 'deploy', '--dry-run', '--config', join(dir, 'build.toml'), '--outdir', join(dir, 'bundle')], { cwd: root, stdio: 'pipe' });
    const bundle = await readFile(join(dir, 'bundle/index.js'));
    const deploymentConfig = 'no_bundle = true\n' + recoveryConfig(config, name, './bundle/index.js');
    await writeFile(join(dir, 'wrangler.toml'), deploymentConfig);
    artifacts.push({ name, productionSha256: digest(content), recoverySha256: digest(bundle),
      sourceConfigSha256: digest(config), deploymentConfigSha256: digest(deploymentConfig),
      sourceDeployments: manifest.find(item => item.name === name).deployments, bytes: bundle.length });
  }
  await writeFile(join(output, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), artifacts }, null, 2) + '\n');
  console.log(`Prepared ${artifacts.length} Registry recovery bundles; no services deployed. Output: ${output}`);
  return artifacts;
}
export async function verifyRecovery(output) {
  const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
  const names = ['clawket-registry', 'clawket-hermes-registry'];
  if (manifest.artifacts?.length !== 2) throw new Error('Expected both recovery artifacts');
  for (const name of names) {
    const item = manifest.artifacts.find(entry => entry.name === name);
    if (!item) throw new Error(`Missing recovery artifact: ${name}`);
    const dir = join(output, name);
    for (const [file, hash] of [['production.js', item.productionSha256], ['bundle/index.js', item.recoverySha256], ['wrangler.toml', item.deploymentConfigSha256]]) {
      if (!hash || digest(await readFile(join(dir, file))) !== hash) throw new Error(`Recovery integrity mismatch: ${name}/${file}`);
    }
    recoveryConfig(await readFile(join(dir, 'wrangler.toml'), 'utf8'), name, './bundle/index.js');
  }
  console.log('Verified 2 recovery bundles, 2 source snapshots and 2 deployment configs');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [snapshots, output, openclawConfig, hermesConfig] = process.argv.slice(2);
  if (snapshots === '--verify') await verifyRecovery(resolve(output));
  else await prepareRecovery({ snapshots, output: output && resolve(output), configs: [openclawConfig, hermesConfig] });
}
