import { ClaudeFault } from './errors.js';
import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import { getSessionMessages, listSessions, type SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import type { ProjectDescriptor, SessionDescriptor, SessionHistory } from '@clawket/agent-protocol';
import { claudeHistoryPage } from './history-page.js';
import { savedClaudeProjects } from './saved-projects.js';

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const PAGE_SIZE = 100;
const MAX_SESSIONS = 2_000;
type NativeApi = { listSessions: typeof listSessions; getSessionMessages: typeof getSessionMessages };
type NativeEntry = { info: SDKSessionInfo; project: ProjectDescriptor };

function opaqueId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

async function canonical(path: string): Promise<string> {
  try { return await realpath(path); } catch { return resolve(path); }
}

/** Authentication and device/project authorization belong to the owning service, never RPC paths. */
export class ClaudeCatalog {
  private entries = new Map<string, NativeEntry>();
  private projects = new Map<string, ProjectDescriptor>();
  private refresh?: Promise<{ truncated: boolean; sessions: SessionDescriptor[] }>;

  constructor(private readonly scope: { project: string; device: boolean },
    private readonly sdk: NativeApi = { listSessions, getSessionMessages },
    private readonly savedProjects: () => Promise<string[]> = savedClaudeProjects) {
    if (!isAbsolute(scope.project)) throw new ClaudeFault('Claude project must be an absolute directory');
  }

  async addProject(path: string): Promise<ProjectDescriptor> {
    if (!isAbsolute(path)) throw new ClaudeFault('Invalid Claude project');
    const canonicalPath = await canonical(path);
    const allowed = await canonical(this.scope.project);
    if (!this.scope.device && canonicalPath !== allowed) throw new ClaudeFault('Claude project is outside this pairing');
    const id = opaqueId(canonicalPath);
    let available = false;
    try { available = (await stat(canonicalPath)).isDirectory(); } catch { /* Preserve unavailable project history. */ }
    const project = { id, name: basename(canonicalPath) || canonicalPath, path: canonicalPath, available };
    this.projects.set(id, project);
    return project;
  }

  listProjects(): ProjectDescriptor[] { return [...this.projects.values()].sort((a, b) => a.name.localeCompare(b.name)); }
  project(id: string): ProjectDescriptor {
    const project = this.projects.get(id);
    if (!project) throw new ClaudeFault('Unknown Claude project');
    return project;
  }

  discover(): Promise<{ truncated: boolean; sessions: SessionDescriptor[] }> {
    if (this.refresh) return this.refresh;
    const attempt = this.discoverOnce().finally(() => { if (this.refresh === attempt) this.refresh = undefined; });
    this.refresh = attempt;
    return attempt;
  }

  private async discoverOnce(): Promise<{ truncated: boolean; sessions: SessionDescriptor[] }> {
    const next = new Map<string, NativeEntry>();
    await this.addProject(this.scope.project);
    if (this.scope.device) {
      for (const path of await this.savedProjects()) await this.addProject(path);
    }
    const refreshedProjects = new Map<string, ProjectDescriptor>();
    let truncated = false;
    const root = await canonical(this.scope.project);
    for (let offset = 0; offset < MAX_SESSIONS; offset += PAGE_SIZE) {
      const rows = await this.sdk.listSessions({ limit: PAGE_SIZE, offset,
        includeProgrammatic: false, includeWorktrees: false,
        ...(!this.scope.device ? { dir: root } : {}) });
      if (!Array.isArray(rows) || rows.length > PAGE_SIZE) throw new ClaudeFault('Invalid Claude discovery response');
      let added = 0;
      for (const info of rows) {
        if (!info || !UUID.test(info.sessionId) || typeof info.cwd !== 'string' || !isAbsolute(info.cwd)
          || typeof info.summary !== 'string' || !Number.isFinite(info.lastModified)) continue;
        const cwd = await canonical(info.cwd);
        if (!this.scope.device && cwd !== root) continue;
        const key = `native:${opaqueId(info.sessionId)}`;
        if (next.has(key)) continue;
        // Sequential directory reads keep native discovery cheap on a shared development computer.
        const project = refreshedProjects.get(cwd) ?? await this.addProject(cwd);
        refreshedProjects.set(cwd, project);
        next.set(key, { info, project });
        added++;
      }
      if (rows.length < PAGE_SIZE) break;
      if (!added || offset + PAGE_SIZE >= MAX_SESSIONS) { truncated = true; break; }
    }
    this.entries = next;
    return { truncated, sessions: [...next].map(([key, entry]) => this.descriptor(key, entry)) };
  }

  private descriptor(key: string, { info, project }: NativeEntry): SessionDescriptor {
    return { connectionId: '', agentId: 'claude-code', key, kind: 'direct',
      title: (info.customTitle || info.summary || 'Claude Code').slice(0, 300),
      updatedAt: info.lastModified, hasActiveRun: false, project, source: 'native', canContinue: false,
      allowedActions: { rename: false, reset: false, delete: false, pin: true } };
  }

  native(key: string): { sessionId: string; cwd: string; title: string } {
    const entry = this.entries.get(key);
    if (!entry) throw new ClaudeFault('Unknown Claude session');
    return { sessionId: entry.info.sessionId, cwd: entry.project.path, title: entry.info.customTitle || entry.info.summary };
  }

  async history(key: string, cursor?: unknown): Promise<SessionHistory> {
    const entry = this.entries.get(key);
    if (!entry) throw new ClaudeFault('Unknown Claude session');
    return { key, ...await claudeHistoryPage(entry.info.sessionId, entry.project.path, cursor, this.sdk.getSessionMessages), hasActiveRun: false };
  }
}
