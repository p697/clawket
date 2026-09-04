import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export type HermesPythonRunnerOptions = {
  hermesSourcePath: string;
  hermesHomePath: string;
  hermesPythonPath?: string | null;
  env?: NodeJS.ProcessEnv;
};

export function buildHermesPythonPath(sourcePath: string, existing: string | undefined): string {
  return [sourcePath, existing].filter(Boolean).join(delimiter);
}

export function resolveHermesPythonPath(options: HermesPythonRunnerOptions): string {
  const explicit = options.hermesPythonPath?.trim();
  if (explicit) return explicit;
  const env = options.env ?? process.env;
  const fromEnv = env.HERMES_PYTHON_PATH?.trim();
  if (fromEnv) return fromEnv;
  const candidates = [
    join(options.hermesSourcePath, '.venv', 'bin', 'python'),
    join(options.hermesSourcePath, 'venv', 'bin', 'python'),
    join(options.hermesHomePath, 'venvs', 'hermes-dev', 'bin', 'python'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? 'python3';
}

export class HermesPythonRunner {
  readonly pythonPath: string;

  constructor(private readonly options: HermesPythonRunnerOptions) {
    this.pythonPath = resolveHermesPythonPath(options);
  }

  run<T>(script: string, stdinPayload?: unknown): T {
    const output = execFileSync(this.pythonPath, ['-c', script], {
      cwd: existsSync(this.options.hermesSourcePath) ? this.options.hermesSourcePath : undefined,
      env: {
        ...(this.options.env ?? process.env),
        HERMES_HOME: this.options.hermesHomePath,
        PYTHONPATH: buildHermesPythonPath(
          this.options.hermesSourcePath,
          (this.options.env ?? process.env).PYTHONPATH,
        ),
      },
      encoding: 'utf8',
      input: stdinPayload === undefined ? undefined : JSON.stringify(stdinPayload),
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return JSON.parse(output) as T;
  }
}
