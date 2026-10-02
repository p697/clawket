import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { codexControl } from './codex-lifecycle.js';
import { claudeControl } from './claude-code-lifecycle.js';
import { piControl } from './pi-lifecycle.js';

export const AGENT_BACKENDS = ['codex', 'claude-code', 'pi'] as const;
export type AgentBackend = typeof AGENT_BACKENDS[number];
export type AgentConfig = { project: string; device?: boolean; token: string; port: number; command: string; host: string; relay?: object };
export type AgentTarget = { backend: AgentBackend; configPath: string; environment: string };
export type AgentStatus = AgentTarget & {
  scope: string; transport: 'local' | 'relay' | 'unknown';
  state: 'ready' | 'stopped' | 'unverified' | 'invalid' | 'unpaired';
  modelConfigured: boolean | null; projectAvailable: boolean | null; logPath: string; finding: string | null;
};
export const agentLabels: Record<AgentBackend, string> = { codex: 'Codex', 'claude-code': 'Claude Code', pi: 'Pi' };
const controls = { codex: codexControl, 'claude-code': claudeControl, pi: piControl };

export function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('-')) throw new Error(`${name} requires a value`);
  return value;
}

/** Match pairing's saved scope without creating directories or requiring a surviving cwd. */
export function selectAgentTarget(backend: AgentBackend, args: string[]): AgentTarget {
  const environment = args.includes('--preview') ? 'preview' : 'production';
  const explicit = option(args, '--config');
  if (backend === 'pi' && args.includes('--preview') && !explicit) throw new Error('Pi uses its original isolated --config for Preview; no default Preview scope exists.');
  if (args.includes('--device') && option(args, '--project')) throw new Error('Choose --device or --project, not both');
  if (explicit) return { backend, configPath: resolve(explicit), environment: 'custom' };
  const projectOption = option(args, '--project');
  const device = backend !== 'pi' && !projectOption;
  let project = resolve(projectOption ?? process.cwd());
  try { project = realpathSync(project); } catch { /* A removed project must remain diagnosable. */ }
  const id = createHash('sha256').update(project).digest('hex').slice(0, 16);
  return { backend, environment: backend === 'pi' ? 'custom' : environment,
    configPath: backend === 'pi'
      ? join(homedir(), '.clawket', backend, id, 'runtime.json')
      : join(homedir(), '.clawket', backend, device ? 'device' : id, environment, 'runtime.json') };
}

function children(path: string): string[] {
  if (!existsSync(path)) return [];
  if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) throw new Error('Agent state directory is not a regular directory');
  const entries = readdirSync(path, { withFileTypes: true });
  if (entries.length > 256) throw new Error('Too many Agent state directories; select --backend and --config explicitly');
  return entries.filter(entry => entry.isDirectory() && /^(device|[a-f0-9]{16})$/.test(entry.name)).map(entry => entry.name).sort();
}

/** Inspect only Clawket's fixed state layout, never native histories or arbitrary directories. */
export function discoverAgentTargets(backend?: AgentBackend, previewOnly = false): AgentTarget[] {
  const targets: AgentTarget[] = [];
  for (const kind of backend ? [backend] : AGENT_BACKENDS) {
    if (previewOnly && kind === 'pi') {
      if (backend === 'pi') throw new Error('Pi uses its original isolated --config for Preview; no default Preview scope exists.');
      continue;
    }
    const root = join(homedir(), '.clawket', kind);
    for (const scope of children(root)) {
      for (const environment of kind === 'pi' ? ['custom'] : previewOnly ? ['preview'] : ['production', 'preview']) {
        const directory = kind === 'pi' ? join(root, scope) : join(root, scope, environment);
        if (!existsSync(directory) || !lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) continue;
        const configPath = join(directory, 'runtime.json');
        if (existsSync(configPath)) targets.push({ backend: kind, environment, configPath });
      }
    }
  }
  if (targets.length > 32) throw new Error('More than 32 Agent configurations; select --backend and --config explicitly');
  return targets;
}

export function readAgentConfig(path: string): AgentConfig {
  const info = lstatSync(path);
  if (!info.isFile() || info.size > 256 * 1024) throw new Error('Invalid Agent configuration');
  let value: AgentConfig;
  try { value = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new Error('Invalid Agent configuration'); }
  if (!value || typeof value.project !== 'string' || !value.project || typeof value.token !== 'string' || !value.token
    || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 || typeof value.command !== 'string' || !value.command
    || typeof value.host !== 'string' || !value.host || (value.device !== undefined && typeof value.device !== 'boolean')
    || (value.relay !== undefined && (!value.relay || typeof value.relay !== 'object' || Array.isArray(value.relay)))) {
    throw new Error('Invalid Agent configuration');
  }
  return value;
}

export async function inspectAgent(target: AgentTarget): Promise<AgentStatus> {
  const result: AgentStatus = { ...target, scope: 'unknown', transport: 'unknown', state: 'unpaired', modelConfigured: null,
    projectAvailable: null, logPath: join(dirname(target.configPath), `${target.backend}.log`), finding: null };
  if (!existsSync(target.configPath)) { result.finding = 'Pair this connection first.'; return result; }
  let config: AgentConfig;
  try { config = readAgentConfig(target.configPath); }
  catch { return { ...result, state: 'invalid', finding: 'Saved configuration is invalid; inspect it locally before changing pairing.' }; }
  result.scope = config.device ? 'device' : basename(config.project).replace(/[\x00-\x1f\x7f]/g, '?').slice(0, 128);
  result.transport = config.relay ? 'relay' : 'local';
  try { result.projectAvailable = statSync(config.project).isDirectory(); } catch { result.projectAvailable = false; }
  try {
    const health = await controls[target.backend](config);
    if (!health || typeof health !== 'object') throw new Error('Invalid health response');
    result.state = 'ready';
    result.modelConfigured = typeof health.modelReady === 'boolean' ? health.modelReady : null;
    if (result.modelConfigured === false) result.finding = 'Model is not configured; complete native sign-in/model setup on this computer.';
  } catch (error) {
    result.state = (error as NodeJS.ErrnoException)?.code === 'ECONNREFUSED' ? 'stopped' : 'unverified';
    result.finding = result.state === 'stopped' ? 'Bridge is stopped; start this saved connection.'
      : 'Bridge health could not be verified. Inspect logs; an unanswered or rejected probe does not prove it is stopped.';
  }
  if (!result.projectAvailable) result.finding = 'Saved project directory is unavailable; restore it before starting new work.';
  return result;
}

export async function inspectAgents(targets: AgentTarget[]): Promise<AgentStatus[]> {
  const results: AgentStatus[] = [];
  // At most four bounded loopback probes; no native processes are launched here.
  for (let index = 0; index < targets.length; index += 4) results.push(...await Promise.all(targets.slice(index, index + 4).map(inspectAgent)));
  return results;
}
