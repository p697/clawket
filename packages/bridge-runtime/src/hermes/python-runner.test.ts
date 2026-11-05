import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HermesPythonRunner, resolveHermesPythonPath } from './python-runner.js';

const systemPython = process.platform === 'win32' ? 'python' : 'python3';

const runner = new HermesPythonRunner({ hermesSourcePath: '/nonexistent-hermes-fixture',
  hermesHomePath: '/nonexistent-hermes-home', hermesPythonPath: systemPython });

describe('Hermes subprocess error boundary', () => {
  it('keeps Python source and sensitive exception values out of client error messages', async () => {
    const script = 'raise ValueError("private-fixture-sentinel")';
    try {
      await runner.run(script);
      throw new Error('Expected subprocess failure');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('Hermes operation failed (ValueError). Check Bridge diagnostics.');
      expect((error as Error).message).not.toContain('private-fixture-sentinel');
      expect((error as Error).message).not.toContain(script);
      expect((error as Error).cause).toBeDefined();
    }
  });

  it('still runs scripts when hermes_bootstrap is not importable', async () => {
    const result = await runner.run<{ ok: boolean }>('import json\nprint(json.dumps({"ok": True}))');
    expect(result).toEqual({ ok: true });
  });
});

describe('resolveHermesPythonPath', () => {
  const skipOnWindows = process.platform === 'win32' ? it.skip : it;

  skipOnWindows('uses the interpreter from a packaged Hermes launcher when no venv exists', () => {
    const home = mkdtempSync(join(tmpdir(), 'clawket-hermes-home-'));
    const source = join(home, 'hermes-agent');
    const python = join(home, 'tools', 'python-3.14.9+20261021-linux-x64', 'bin', 'python3');
    mkdirSync(join(source, '.hermes', 'bin'), { recursive: true });
    mkdirSync(join(python, '..'), { recursive: true });
    writeFileSync(python, '');
    writeFileSync(join(source, '.hermes', 'bin', 'hermes'),
      `#!/bin/sh\nexec ${python} -I -c 'import os, re, sys\nsys.exit(0)' "$@"\n`);

    expect(resolveHermesPythonPath({ hermesSourcePath: source, hermesHomePath: home })).toBe(python);
  });

  skipOnWindows('falls back to the newest managed interpreter under <home>/tools', () => {
    const home = mkdtempSync(join(tmpdir(), 'clawket-hermes-home-'));
    const older = join(home, 'tools', 'python-3.13.2+20250101-linux-x64', 'bin', 'python3');
    const newer = join(home, 'tools', 'python-3.14.9+20261021-linux-x64', 'bin', 'python3');
    for (const file of [older, newer]) {
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, '');
    }

    expect(resolveHermesPythonPath({ hermesSourcePath: join(home, 'hermes-agent'), hermesHomePath: home })).toBe(newer);
  });

  it('prefers an explicit venv over the packaged interpreter', () => {
    const home = mkdtempSync(join(tmpdir(), 'clawket-hermes-home-'));
    const source = join(home, 'hermes-agent');
    const venvPython = process.platform === 'win32'
      ? join(source, '.venv', 'Scripts', 'python.exe')
      : join(source, '.venv', 'bin', 'python');
    mkdirSync(join(venvPython, '..'), { recursive: true });
    writeFileSync(venvPython, '');

    expect(resolveHermesPythonPath({ hermesSourcePath: source, hermesHomePath: home })).toBe(venvPython);
  });

  it('falls back to the system interpreter when nothing is installed', () => {
    expect(resolveHermesPythonPath({ hermesSourcePath: '/nonexistent-hermes-fixture', hermesHomePath: '/nonexistent-hermes-home' }))
      .toBe(systemPython);
  });
});
