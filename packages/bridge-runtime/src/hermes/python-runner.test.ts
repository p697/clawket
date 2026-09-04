import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveHermesPythonPath } from './python-runner.js';
import { cleanupTempDirectories, createTempDirectory } from './test-helpers.js';

afterEach(cleanupTempDirectories);

describe('resolveHermesPythonPath', () => {
  it('honors explicit and environment overrides first', async () => {
    const root = await createTempDirectory();
    expect(resolveHermesPythonPath({
      hermesSourcePath: root,
      hermesHomePath: root,
      hermesPythonPath: '/explicit/python',
      env: { HERMES_PYTHON_PATH: '/env/python' },
    })).toBe('/explicit/python');
    expect(resolveHermesPythonPath({
      hermesSourcePath: root,
      hermesHomePath: root,
      env: { HERMES_PYTHON_PATH: '/env/python' },
    })).toBe('/env/python');
  });

  it('falls back through source venvs and the official Hermes home venv', async () => {
    const root = await createTempDirectory();
    const source = join(root, 'source');
    const home = join(root, 'home');
    const official = join(home, 'venvs', 'hermes-dev', 'bin', 'python');
    await mkdir(join(home, 'venvs', 'hermes-dev', 'bin'), { recursive: true });
    await writeFile(official, '');
    expect(resolveHermesPythonPath({ hermesSourcePath: source, hermesHomePath: home, env: {} })).toBe(official);
    const sourceVenv = join(source, '.venv', 'bin', 'python');
    await mkdir(join(source, '.venv', 'bin'), { recursive: true });
    await writeFile(sourceVenv, '');
    expect(resolveHermesPythonPath({ hermesSourcePath: source, hermesHomePath: home, env: {} })).toBe(sourceVenv);
  });
});
