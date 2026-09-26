import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { ProjectDescriptor } from '@clawket/agent-protocol';

export function projectDescriptor(path: string): ProjectDescriptor {
  const absolute = canonicalProject(resolve(path));
  let available = false;
  try { available = lstatSync(absolute).isDirectory(); } catch { /* Missing worktrees remain readable. */ }
  return { id: createHash('sha256').update(absolute).digest('hex').slice(0, 32), name: basename(absolute), path: absolute, available };
}

/** Saved Codex project roots only; never a recursive filesystem scan. */
export function savedCodexProjects(env = process.env): ProjectDescriptor[] {
  const file = join(env.CODEX_HOME || join(homedir(), '.codex'), '.codex-global-state.json');
  if (!existsSync(file)) return [];
  if (lstatSync(file).size > 8 * 1024 * 1024) throw new Error('Codex project metadata is too large');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid Codex project metadata');
  const projects = new Map<string, ProjectDescriptor>();
  const remember = (root: unknown, name?: unknown) => {
    if (typeof root !== 'string' || !isAbsolute(root)) return;
    const descriptor = projectDescriptor(root);
    if (typeof name === 'string' && name.trim() && name.length <= 256) descriptor.name = name.trim();
    projects.set(descriptor.id, descriptor);
  };
  const roots = data['electron-saved-workspace-roots'];
  if (Array.isArray(roots)) for (const root of roots) remember(root, data['electron-workspace-root-labels']?.[root]);
  // Current Desktop stores named projects independently from its legacy root list.
  const local = data['local-projects'];
  if (local && typeof local === 'object' && !Array.isArray(local)) for (const project of Object.values(local) as any[]) {
    if (project && Array.isArray(project.rootPaths)) for (const root of project.rootPaths) remember(root, project.name);
  }
  return [...projects.values()];
}

export function canonicalProject(path: string): string {
  if (!isAbsolute(path)) throw new Error('Invalid Codex working directory');
  try { return realpathSync(path); } catch { return resolve(path); }
}
