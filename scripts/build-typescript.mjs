import { rmSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

// npm runs workspace scripts with the package directory as cwd.
const root = resolve(process.cwd());
const output = resolve(root, 'dist');
const child = relative(root, output);
if (!existsSync(resolve(root, 'tsconfig.json')) || !child || child.startsWith('..') || isAbsolute(child)) {
  throw new Error('Refusing to clean outside a TypeScript workspace');
}
rmSync(output, { recursive: true, force: true });
const require = createRequire(import.meta.url);
const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.json'], {
  stdio: 'inherit', windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
