import { ClaudeFault } from './errors.js';
import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import { getSessionMessages, listSessions, type SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import type { ProjectDescriptor, SessionDescriptor, SessionHistory } from '@clawket/agent-protocol';
import { claudeHistoryPage } from './history-page.js';
import { claudeHistory } from './history.js';
import { lastVisiblePreview } from '../session-preview.js';
import { claudePreviewTail, claudeTranscriptSize } from './preview-tail.js';
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
  private previews = new Map<string, { version: number; preview?: string; lastActivityAt: number | null }>();
  private previewFailures = new Map<string, { version: number; checkedAt: number }>();
  private refresh?: Promise<{ truncated: boolean; complete: boolean; sessions: SessionDescriptor[] }>;

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

  discover(): Promise<{ truncated: boolean; complete: boolean; sessions: SessionDescriptor[] }> {
    if (this.refresh) return this.refresh;
    const attempt = this.discoverOnce().finally(() => { if (this.refresh === attempt) this.refresh = undefined; });
    this.refresh = attempt;
    return attempt;
  }

  private async discoverOnce(): Promise<{ truncated: boolean; complete: boolean; sessions: SessionDescriptor[] }> {
    const next = new Map<string, NativeEntry>();
    await this.addProject(this.scope.project);
    if (this.scope.device) {
      for (const path of await this.savedProjects()) await this.addProject(path);
    }
    const refreshedProjects = new Map<string, ProjectDescriptor>();
    const seen = new Set<string>();
    let truncated = false, complete = true;
    const root = await canonical(this.scope.project);
    for (let offset = 0; offset < MAX_SESSIONS; offset += PAGE_SIZE) {
      const rows = await this.sdk.listSessions({ limit: PAGE_SIZE, offset,
        includeProgrammatic: false, includeWorktrees: false,
        ...(!this.scope.device ? { dir: root } : {}) });
      if (!Array.isArray(rows) || rows.length > PAGE_SIZE) throw new ClaudeFault('Invalid Claude discovery response');
      let scanned = 0;
      for (const info of rows) {
        if (!info || !UUID.test(info.sessionId) || typeof info.summary !== 'string'
          || !Number.isFinite(info.lastModified)) { complete = false; continue; }
        if (seen.has(info.sessionId)) { complete = false; continue; }
        seen.add(info.sessionId); scanned++;
        // cwd is optional in SDKSessionInfo. An unscoped row is not a corrupt
        // scan, but cannot authorize history or a writer in any project.
        if (info.cwd === undefined) continue;
        if (typeof info.cwd !== 'string' || !isAbsolute(info.cwd)) { complete = false; continue; }
        const cwd = await canonical(info.cwd);
        if (!this.scope.device && cwd !== root) continue;
        const key = `native:${opaqueId(info.sessionId)}`;
        if (next.has(key)) { complete = false; continue; }
        // Sequential directory reads keep native discovery cheap on a shared development computer.
        const project = refreshedProjects.get(cwd) ?? await this.addProject(cwd);
        refreshedProjects.set(cwd, project);
        next.set(key, { info, project });
      }
      if (rows.length < PAGE_SIZE) break;
      if (!scanned || offset + PAGE_SIZE >= MAX_SESSIONS) { truncated = true; break; }
    }
    if (complete && !truncated) this.entries = next;
    else {
      // Preserve known read-only lookups through a partial scan. Positive rows
      // still obey this pairing's cwd filter; never infer removal or takeover.
      for (const [key, entry] of next) {
        if (this.entries.has(key) || this.entries.size < MAX_SESSIONS) this.entries.set(key, entry);
        else next.delete(key);
      }
    }
    const recent = [...next.values()].sort((a, b) => b.info.lastModified - a.info.lastModified).slice(0, 12);
    for (let index = 0; index < recent.length; index += 2) await Promise.all(recent.slice(index, index + 2).map(({ info }) =>
      this.loadPreview(info.sessionId, info.cwd!, info.lastModified, info.fileSize)));
    // Bridge-owned sessions are intentionally excluded by listSessions; retain their cached tails too.
    while (this.previews.size > 3_000) this.previews.delete(this.previews.keys().next().value!);
    while (this.previewFailures.size > 3_000) this.previewFailures.delete(this.previewFailures.keys().next().value!);
    return { truncated, complete: complete && !truncated, sessions: [...next].map(([key, entry]) => this.descriptor(key, entry)) };
  }

  cachedPreview(sessionId: string): { preview: string; lastActivityAt: number } | undefined {
    const row = this.previews.get(sessionId);
    return row?.preview && row.lastActivityAt !== null ? { preview: row.preview, lastActivityAt: row.lastActivityAt } : undefined;
  }

  hasNativeEntry(sessionId: string): boolean { return this.entries.has(`native:${opaqueId(sessionId)}`); }

  async loadPreview(sessionId: string, cwd: string, version: number, fileSize?: number): Promise<void> {
    const cached = this.previews.get(sessionId);
    if (cached?.version === version) return;
    const failure = this.previewFailures.get(sessionId);
    if (failure?.version === version && Date.now() - failure.checkedAt < 30_000) return;
    try {
      const size = this.sdk.getSessionMessages === getSessionMessages
        ? fileSize ?? await claudeTranscriptSize(sessionId, cwd) : undefined;
      const visible = size !== undefined && size > 8 * 1024 * 1024
        ? await claudePreviewTail(sessionId, cwd)
        : lastVisiblePreview(claudeHistory(await this.sdk.getSessionMessages(sessionId, { dir: cwd })));
      this.previews.set(sessionId, { version, preview: visible?.preview, lastActivityAt: visible?.lastActivityAt ?? null });
      this.previewFailures.delete(sessionId);
    } catch { this.previewFailures.set(sessionId, { version, checkedAt: Date.now() }); }
  }

  private descriptor(key: string, { info, project }: NativeEntry): SessionDescriptor {
    const visible = this.previews.get(info.sessionId);
    return { connectionId: '', agentId: 'claude-code', key, kind: 'direct',
      title: (info.customTitle || info.summary || 'Claude Code').slice(0, 300),
      updatedAt: info.lastModified, ...(visible?.lastActivityAt != null ? { lastActivityAt: visible.lastActivityAt } : {}), preview: visible?.preview,
      hasActiveRun: false, project, source: 'native', canContinue: false,
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
