import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { inspectClaudeInstallation, inspectCodexInstallation, inspectPiInstallation } from '@clawket/bridge-runtime';

export type PairChoiceBackend = 'openclaw' | 'hermes' | 'codex' | 'claude-code' | 'pi';
export type PairChoice = Readonly<{
  backend: PairChoiceBackend;
  name: string;
  available: boolean;
  configured: boolean;
  detail: string;
}>;

type DiscoveryInput = Readonly<{
  openclaw: { available: boolean; configured: boolean };
  hermes: { available: boolean; configured: boolean };
  home?: string;
  cwd?: string;
  inspect?: Readonly<{
    codex: (command: string) => Promise<unknown>;
    claude: (command: string) => Promise<unknown>;
    pi: (command: string) => Promise<unknown>;
  }>;
}>;

function savedCommand(file: string, key: string): string | undefined {
  try {
    if (!existsSync(file) || statSync(file).size > 1024 * 1024) return undefined;
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (value && typeof value === 'object' && key in value) {
      const command = (value as Record<string, unknown>)[key];
      if (typeof command === 'string' && command.trim()) return command;
    }
  } catch { /* A malformed saved config is diagnosed by its own pairing command. */ }
  return undefined;
}

function piConfigCount(home: string): number {
  try {
    return readdirSync(join(home, '.clawket', 'pi'), { withFileTypes: true })
      .filter(entry => entry.isDirectory() && existsSync(join(home, '.clawket', 'pi', entry.name, 'runtime.json'))).length;
  } catch { return 0; }
}

/** Discovery reads Clawket state and native CLI versions; it never creates a pairing or project. */
export async function discoverPairChoices(input: DiscoveryInput): Promise<PairChoice[]> {
  const home = input.home ?? homedir();
  const cwd = input.cwd ?? process.cwd();
  const codexConfig = join(home, '.clawket', 'codex', 'device', 'production', 'runtime.json');
  const claudeConfig = join(home, '.clawket', 'claude-code', 'device', 'production', 'runtime.json');
  let piProject = cwd;
  try { piProject = realpathSync(cwd); } catch { /* The selected Pi folder is checked later. */ }
  const piId = createHash('sha256').update(piProject).digest('hex').slice(0, 16);
  const piConfig = join(home, '.clawket', 'pi', piId, 'runtime.json');
  const inspect = input.inspect ?? {
    codex: inspectCodexInstallation,
    claude: inspectClaudeInstallation,
    pi: inspectPiInstallation,
  };
  const native = await Promise.allSettled([
    inspect.codex(savedCommand(codexConfig, 'command') ?? 'codex'),
    inspect.claude(savedCommand(claudeConfig, 'command') ?? 'claude'),
    inspect.pi(savedCommand(piConfig, 'command') ?? 'pi'),
  ]);
  const nativeChoice = (index: number, backend: PairChoiceBackend, name: string, config: string, detail: string): PairChoice => ({
    backend, name, available: native[index].status === 'fulfilled', configured: existsSync(config),
    detail: native[index].status === 'fulfilled' ? detail : backend === 'codex' ? 'Codex CLI or supported desktop app unavailable'
      : backend === 'claude-code' ? 'Claude Desktop runtime or CLI unavailable or unsupported' : 'CLI unavailable or unsupported',
  });
  const piCount = piConfigCount(home);
  return [
    { backend: 'openclaw', name: 'OpenClaw', ...input.openclaw, detail: 'Gateway' },
    { backend: 'hermes', name: 'Hermes', ...input.hermes, detail: 'Agent' },
    nativeChoice(0, 'codex', 'Codex', codexConfig, 'Computer'),
    nativeChoice(1, 'claude-code', 'Claude Code', claudeConfig, 'Computer'),
    nativeChoice(2, 'pi', 'Pi', piConfig, piCount ? `${piCount} configured project${piCount === 1 ? '' : 's'}` : 'Choose a project'),
  ];
}

export async function promptPairChoice(
  choices: readonly PairChoice[],
  io: Readonly<{ ask: (prompt: string) => Promise<string>; write: (line: string) => void }>,
  cwd = process.cwd(),
): Promise<{ backend: PairChoiceBackend; project?: string } | null> {
  io.write('Agents on this computer:');
  choices.forEach((choice, index) => {
    const status = !choice.available ? 'Not ready' : choice.configured ? 'Configured here' : 'Ready to pair';
    io.write(`${index + 1}. ${choice.name} — ${status} · ${choice.detail}`);
  });
  io.write('Configured here means Clawket has local pairing state; it does not mean this phone is paired.');
  if (!choices.some(choice => choice.available)) return null;
  while (true) {
    const answer = (await io.ask('Choose a number (q to quit): ')).trim().toLowerCase();
    if (answer === 'q' || answer === '') return null;
    const index = Number(answer) - 1;
    if (!/^\d+$/.test(answer) || !choices[index]) { io.write('Enter a listed number, or q to quit.'); continue; }
    const choice = choices[index];
    if (!choice.available) { io.write(`${choice.name} is not ready to pair on this computer.`); continue; }
    if (choice.backend !== 'pi') return { backend: choice.backend };
    const entered = (await io.ask(`Pi project folder [${cwd}]: `)).trim();
    const project = resolve(cwd, entered || '.');
    try {
      const canonical = realpathSync(project);
      if (!statSync(canonical).isDirectory()) throw new Error('not a directory');
      io.write(`Pairing Pi for ${basename(canonical)} (${canonical}).`);
      return { backend: 'pi', project: canonical };
    } catch { io.write('That project folder does not exist or is not a directory.'); }
  }
}
