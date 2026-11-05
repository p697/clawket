import { execFile, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export type HermesPythonRunnerOptions = {
  hermesSourcePath: string;
  hermesHomePath: string;
  hermesPythonPath?: string | null;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
};

function buildHermesPythonPath(sourcePath: string, existing: string | undefined): string {
  return [sourcePath, existing].filter(Boolean).join(delimiter);
}

// Packaged Hermes installs (v0.22+, `hermes pm`) ship no venv. The `hermes` launcher in
// <source>/.hermes/bin is a one-line shell wrapper that execs the managed interpreter, and
// the Python dependencies only become importable after `import hermes_bootstrap`.
const PYTHON_PREAMBLE = 'try:\n    import hermes_bootstrap  # noqa: F401\nexcept ImportError:\n    pass\n';

function pythonFromLauncher(launcherPath: string): string | undefined {
  let launcher: string;
  try { launcher = readFileSync(launcherPath, 'utf8'); }
  catch { return undefined; }
  const match = launcher.match(/^exec\s+(?:"([^"]+)"|'([^']+)'|(\S+))/m);
  const candidate = match?.[1] ?? match?.[2] ?? match?.[3];
  return candidate && existsSync(candidate) ? candidate : undefined;
}

function managedPythonCandidates(hermesHomePath: string): string[] {
  const toolsDir = join(hermesHomePath, 'tools');
  let entries: string[];
  try { entries = readdirSync(toolsDir); }
  catch { return []; }
  const exe = process.platform === 'win32' ? ['python.exe'] : ['bin', 'python3'];
  return entries
    .filter((name) => name.startsWith('python-'))
    .sort()
    .reverse()
    .map((name) => join(toolsDir, name, ...exe));
}

export function resolveHermesPythonPath(options: HermesPythonRunnerOptions): string {
  const explicit = options.hermesPythonPath?.trim();
  if (explicit) return explicit;
  const env = options.env ?? process.env;
  const fromEnv = env.HERMES_PYTHON_PATH?.trim();
  if (fromEnv) return fromEnv;
  const pythonParts = process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python'];
  const candidates = [
    join(options.hermesSourcePath, '.venv', ...pythonParts),
    join(options.hermesSourcePath, 'venv', ...pythonParts),
    join(options.hermesHomePath, 'venvs', 'hermes-dev', ...pythonParts),
  ];
  const venv = candidates.find((candidate) => existsSync(candidate));
  if (venv) return venv;
  const launcherName = process.platform === 'win32' ? 'hermes.cmd' : 'hermes';
  const fromLauncher = pythonFromLauncher(join(options.hermesSourcePath, '.hermes', 'bin', launcherName));
  if (fromLauncher) return fromLauncher;
  const managed = managedPythonCandidates(options.hermesHomePath).find((candidate) => existsSync(candidate));
  return managed ?? (process.platform === 'win32' ? 'python' : 'python3');
}

export class HermesPythonRunner {
  readonly pythonPath: string;

  constructor(private readonly options: HermesPythonRunnerOptions) {
    this.pythonPath = resolveHermesPythonPath(options);
  }

  private readonly children = new Set<ChildProcess>();
  private stopped = false;
  private generation = 0;

  resume(): void { this.stopped = false; }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
    for (const child of this.children) child.kill('SIGKILL');
  }

  async run<T>(script: string, stdinPayload?: unknown): Promise<T> {
    if (this.stopped) throw new Error('Hermes operation cancelled.');
    if (this.children.size >= 8) throw new Error('Hermes is busy. Try again shortly.');
    const generation = this.generation;
    const input = stdinPayload === undefined ? undefined : JSON.stringify(stdinPayload);
    return new Promise<T>((resolve, reject) => {
      const child = execFile(this.pythonPath, ['-c', PYTHON_PREAMBLE + script], {
        cwd: existsSync(this.options.hermesSourcePath) ? this.options.hermesSourcePath : undefined,
        env: {
          ...(this.options.env ?? process.env),
          HERMES_HOME: this.options.hermesHomePath,
          PYTHONPATH: buildHermesPythonPath(this.options.hermesSourcePath, (this.options.env ?? process.env).PYTHONPATH),
        },
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        timeout: this.options.timeoutMs ?? 60_000,
        killSignal: 'SIGKILL',
      }, (cause, output, stderr) => {
        this.children.delete(child);
        if (generation !== this.generation) {
          reject(new Error('Hermes operation cancelled.'));
          return;
        }
        if (cause) {
          const category = stderr.match(/^([A-Za-z]+(?:Error|Exception)):/m)?.[1];
          reject(new Error(this.stopped ? 'Hermes operation cancelled.'
            : `Hermes operation failed${category ? ` (${category})` : ''}. Check Bridge diagnostics.`, { cause }));
          return;
        }
        try { resolve(JSON.parse(output) as T); }
        catch (cause) { reject(new Error('Hermes returned an invalid operation response.', { cause })); }
      });
      this.children.add(child);
      // A child that exits before consuming stdin can close the pipe normally.
      child.stdin?.on('error', () => undefined);
      child.stdin?.end(input);
    });
  }
}
