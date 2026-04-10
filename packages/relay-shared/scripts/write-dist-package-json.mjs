import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, '..');
const sourcePackageJsonPath = path.join(packageDir, 'package.json');
const distDir = path.join(packageDir, 'dist');
const distPackageJsonPath = path.join(distDir, 'package.json');

const sourcePackageRaw = await readFile(sourcePackageJsonPath, 'utf8');
const sourcePackage = JSON.parse(sourcePackageRaw);

const distPackage = {
  name: sourcePackage.name,
  version: sourcePackage.version,
  private: sourcePackage.private,
  type: 'module',
  license: sourcePackage.license,
  main: './index.js',
  types: './index.d.ts',
  exports: {
    '.': {
      types: './index.d.ts',
      import: './index.js',
      default: './index.js',
    },
  },
};

await mkdir(distDir, { recursive: true });
await writeFile(distPackageJsonPath, `${JSON.stringify(distPackage, null, 2)}\n`, 'utf8');
