import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** npm's JS entrypoint avoids .cmd execution and shell interpolation on Windows. */
export function npmInvocation(args, env = process.env) {
  const candidates = [
    env.npm_execpath,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const entry = candidates.find((value) => value && /npm-cli\.js$/.test(value) && existsSync(value));
  if (!entry) throw new Error('Cannot locate npm-cli.js; run this command through npm');
  return [process.execPath, [entry, ...args]];
}

export function spawnNpm(args, options = {}) {
  const [command, argv] = npmInvocation(args, options.env ?? process.env);
  return spawnSync(command, argv, { windowsHide: true, ...options });
}
