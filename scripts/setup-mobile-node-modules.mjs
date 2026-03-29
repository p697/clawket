import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const mobileNodeModules = path.join(repoRoot, 'apps', 'mobile', 'node_modules');
const mobilePackageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'apps', 'mobile', 'package.json'), 'utf8'),
);
const copiedPackages = new Set(['react-native']);

const links = new Set([
  ...Object.keys(mobilePackageJson.dependencies ?? {}),
  ...Object.keys(mobilePackageJson.devDependencies ?? {}),
  'react-native-safe-area-context',
]);

for (const pkg of links) {
  const source = path.join(repoRoot, 'node_modules', pkg);
  const target = path.join(mobileNodeModules, pkg);

  if (!fs.existsSync(source)) {
    continue;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });

  try {
    const stat = fs.lstatSync(target);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      continue;
    }
    if (stat.isSymbolicLink() && sameRealPath(source, target)) {
      continue;
    }
    fs.rmSync(target, { recursive: true, force: true });
  } catch {}

  if (copiedPackages.has(pkg)) {
    fs.cpSync(source, target, { recursive: true });
    continue;
  }

  fs.symlinkSync(path.relative(path.dirname(target), source), target, 'junction');
}

function sameRealPath(sourcePath, targetPath) {
  try {
    return fs.realpathSync(sourcePath) === fs.realpathSync(targetPath);
  } catch {
    return false;
  }
}
