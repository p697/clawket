import { constants } from 'node:fs';
import { open, lstat, realpath, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { ProfileDefaults, ProfileDocument, ProfileInstruction, ProfileMcp, ProfilePlugin, ProfileProject, ProfileSkill, ProfileSkills, ProfileUsage } from '@clawket/agent-protocol';

const LIMIT = 128 * 1024;
const stable = (value: any): any => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const text = (value: unknown, max = 256): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid native profile data');
  return value;
};
const optional = (value: unknown): string | null => value == null ? null : text(value);
const rows = (value: unknown, max = 500): any[] => {
  if (!Array.isArray(value) || value.length > max) throw new Error('Invalid native profile list');
  return value;
};
type DocumentHandle = { path: string; projectId: string; kind: 'instruction' | 'skill'; editable: boolean; userRoot?: string };
type DefaultSnapshot = { nativeVersion: string; fingerprint: string };
export interface ProfileHost {
  current?(): boolean;
  request(method: string, params?: object): Promise<any>;
  projects(): Promise<Array<ProfileProject & { path: string }>>;
  models(): Promise<any[]>;
}

/** Native management is separate from thread ownership and never resumes or starts a turn. */
export class CodexProfile {
  private handles = new Map<string, DocumentHandle>();
  private snapshots = new Map<string, DefaultSnapshot>();
  private write: Promise<unknown> = Promise.resolve();
  constructor(private readonly host: ProfileHost) {}
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.write.then(operation, operation);
    this.write = result.catch(() => {});
    return result;
  }
  async projects(): Promise<ProfileProject[]> {
    return (await this.host.projects()).map(({ id, name, available }) => ({ id, name, available }));
  }
  private guard() { if (this.host.current && !this.host.current()) throw new Error('Reconnect and refresh before continuing'); }
  private async project(id: unknown) {
    const project = (await this.host.projects()).find(row => row.id === id);
    if (!project?.available || await realpath(project.path) !== project.path) throw new Error('Project unavailable; refresh the project list');
    return project;
  }
  private handle(handle: DocumentHandle): string {
    const existing = [...this.handles].find(([, row]) => row.path === handle.path && row.projectId === handle.projectId);
    if (existing) { this.handles.set(existing[0], handle); return existing[0]; }
    if (this.handles.size >= 2000) this.handles.delete(this.handles.keys().next().value!);
    const id = randomUUID(); this.handles.set(id, handle); return id;
  }
  private async config() {
    const result = await this.host.request('config/read', { includeLayers: true });
    if (!result?.config || typeof result.config !== 'object' || Array.isArray(result.config)) throw new Error('Invalid native configuration');
    const user = rows(result.layers, 50).find(layer => layer?.name?.type === 'user' && !layer.name.profile);
    // A versioned writable user layer is required; never perform an unguarded config overwrite.
    const version = text(user?.version, 512);
    return { config: result.config, userFile: text(user?.name?.file, 4096), version, fingerprint: hash(JSON.stringify(stable(result.config))) };
  }
  async defaults(): Promise<ProfileDefaults> {
    const config = await this.config();
    const editable = config.config.model_provider == null || config.config.model_provider === 'openai';
    const models = editable ? rows(await this.host.models(), 2000).map(model => ({
      id: text(model.model), isDefault: model.isDefault === true, name: text(model.displayName ?? model.model),
      levels: rows(model.supportedReasoningEfforts ?? [], 16).map(row => text(row.reasoningEffort, 32)),
      ...(model.defaultReasoningEffort ? { defaultLevel: text(model.defaultReasoningEffort, 32) } : {}),
    })) : [];
    this.guard();
    const token = randomUUID();
    if (this.snapshots.size >= 32) this.snapshots.delete(this.snapshots.keys().next().value!);
    this.snapshots.set(token, { nativeVersion: config.version, fingerprint: config.fingerprint });
    return { model: optional(config.config.model), thinking: optional(config.config.model_reasoning_effort), version: token, editable, models: editable ? models : [] };
  }
  setDefaults(input: Record<string, unknown>): Promise<ProfileDefaults> {
    return this.serial(async () => {
      const snapshot = this.snapshots.get(String(input.version));
      if (!snapshot) throw new Error('Settings changed; refresh before saving');
      const latest = await this.config();
      if (latest.version !== snapshot.nativeVersion || latest.fingerprint !== snapshot.fingerprint) throw new Error('Settings changed; refresh before saving');
      if (latest.config.model_provider != null && latest.config.model_provider !== 'openai') throw new Error('Manage custom provider defaults on the computer');
      if (input.model !== null && typeof input.model !== 'string' || input.thinking !== null && typeof input.thinking !== 'string') throw new Error('Invalid model defaults');
      const catalog = rows(await this.host.models(), 2000);
      const model = input.model === null ? catalog.find(row => row.isDefault) : catalog.find(row => row.model === input.model);
      if (!model || input.thinking !== null && !rows(model.supportedReasoningEfforts ?? [], 16).some(row => row.reasoningEffort === input.thinking)) throw new Error('Choose an available model and reasoning level');
      // Session-static defaults: never hot-reload or modify already-owned native threads.
      this.guard();
      this.snapshots.delete(String(input.version));
      await this.host.request('config/batchWrite', { expectedVersion: latest.version, reloadUserConfig: false, edits: [
        { keyPath: 'model', value: input.model, mergeStrategy: 'upsert' },
        { keyPath: 'model_reasoning_effort', value: input.thinking, mergeStrategy: 'upsert' },
      ] });
      const confirmed = await this.defaults();
      if (confirmed.model !== input.model || confirmed.thinking !== input.thinking) throw new Error('Default settings could not be confirmed; refresh before continuing');
      return confirmed;
    });
  }
  async usage(): Promise<ProfileUsage> {
    const account = await this.host.request('account/read', { refreshToken: false });
    const plan = optional(account?.account?.planType);
    // API-key-only installations have no ChatGPT quota; unknown values remain unknown.
    if (!account?.account || account.account.type === 'apiKey') return { plan, quotas: [], lifetimeTokens: null, daily: [] };
    const response = await this.host.request('account/rateLimits/read');
    const quotas: ProfileUsage['quotas'] = [];
    const catalog = response.rateLimitsByLimitId && typeof response.rateLimitsByLimitId === 'object' && !Array.isArray(response.rateLimitsByLimitId)
      ? Object.entries(response.rateLimitsByLimitId) : response.rateLimits ? [[response.rateLimits.limitId ?? 'codex', response.rateLimits]] : [];
    if (catalog.length > 32) throw new Error('Invalid native quota list');
    for (const [id, raw] of catalog as [string, any][]) {
      const windows: ProfileUsage['quotas'][number]['windows'] = [];
      for (const value of [raw.primary, raw.secondary]) if (value != null) {
        if (!Number.isFinite(value.usedPercent) || value.usedPercent < 0 || !Number.isInteger(value.windowDurationMins) || value.windowDurationMins <= 0
          || value.resetsAt != null && (!Number.isSafeInteger(value.resetsAt) || value.resetsAt < 0 || value.resetsAt > 8640000000000)) throw new Error('Invalid native quota window');
        windows.push({ minutes: value.windowDurationMins, usedPercent: value.usedPercent, resetsAt: value.resetsAt ?? null });
      }
      quotas.push({ id: text(id), name: optional(raw.limitName) ?? text(id), windows });
    }
    // Token summaries are optional for native accounts without usage support.
    let summary: any = null;
    try { summary = await this.host.request('account/usage/read'); } catch { /* Quotas remain authoritative, tokens remain unknown. */ }
    const lifetime = summary?.summary?.lifetimeTokens;
    const daily = rows(summary?.dailyUsageBuckets ?? [], 400).map(row => {
      if (typeof row.startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.startDate) || !Number.isSafeInteger(row.tokens) || row.tokens < 0) throw new Error('Invalid native usage bucket');
      return { date: row.startDate, tokens: row.tokens };
    });
    return { plan, quotas, lifetimeTokens: Number.isSafeInteger(lifetime) && lifetime >= 0 ? lifetime : null, daily };
  }
  async skills(projectId: unknown, forceReload = false): Promise<ProfileSkills> {
    const project = await this.project(projectId);
    const response = await this.host.request('skills/list', { cwds: [project.path], forceReload });
    const data = rows(response?.data, 10);
    if (data.length !== 1 || data[0]?.cwd !== project.path) throw new Error('Native skill project mismatch');
    const skills = rows(data[0].skills).map(row => {
      const scope: ProfileSkill['scope'] = row.pluginId ? 'plugin' : row.scope === 'repo' ? 'project' : row.scope === 'user' ? 'user' : 'system';
      const path = text(row.path, 4096);
      if (basename(path) !== 'SKILL.md' || typeof row.enabled !== 'boolean') throw new Error('Invalid native skill');
      const editable = scope !== 'plugin' && scope !== 'system';
      return { id: this.handle({ path, projectId: project.id, kind: 'skill', editable }), name: text(row.name), description: typeof row.description === 'string' ? row.description.slice(0, 2000) : '', scope, enabled: row.enabled, editable };
    });
    return { skills, errorCount: rows(data[0].errors ?? [], 500).length };
  }
  setSkillEnabled(id: unknown, enabled: unknown): Promise<ProfileSkills> {
    return this.serial(async () => {
      const handle = this.handles.get(String(id));
      if (!handle || handle.kind !== 'skill' || typeof enabled !== 'boolean') throw new Error('Skill unavailable; refresh the skill list');
      const latest = await this.skills(handle.projectId, true);
      if (!latest.skills.some(row => row.id === id)) throw new Error('Skill unavailable; refresh the skill list');
      this.guard();
      await this.host.request('skills/config/write', { path: handle.path, enabled });
      const confirmed = await this.skills(handle.projectId, true);
      if (confirmed.skills.find(row => row.id === id)?.enabled !== enabled) throw new Error('Skill setting could not be confirmed');
      return confirmed;
    });
  }
  async instructions(projectId: unknown): Promise<ProfileInstruction[]> {
    const project = await this.project(projectId);
    const output: ProfileInstruction[] = [];
    const userRoot = dirname((await this.config()).userFile);
    if (await realpath(userRoot) !== userRoot) throw new Error('Linked instruction directories are unsupported');
    for (const root of [userRoot, project.path]) for (const name of ['AGENTS.md', 'AGENTS.override.md']) {
      const path = join(root, name);
      let exists = false;
      try { const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsupported instruction file'); exists = true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (!exists && name !== 'AGENTS.md') continue;
      output.push({ id: this.handle({ path, projectId: project.id, kind: 'instruction', editable: true, ...(root === userRoot ? { userRoot } : {}) }), name, exists, scope: root === userRoot ? 'user' : 'project' });
    }
    return output;
  }
  private async read(handle: DocumentHandle) {
    const project = await this.project(handle.projectId);
    if (handle.kind === 'instruction') {
      const root = handle.userRoot ? dirname((await this.config()).userFile) : project.path;
      if (dirname(handle.path) !== root || handle.userRoot && root !== handle.userRoot) throw new Error('Document project mismatch');
    }
    if (handle.kind === 'skill' && !(await this.skills(handle.projectId)).skills.some(row => this.handles.get(row.id)?.path === handle.path)) throw new Error('Skill unavailable');
    if (await realpath(dirname(handle.path)) !== dirname(handle.path)) throw new Error('Linked document directories are unsupported');
    let file;
    try { file = await open(handle.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && handle.kind === 'instruction') return { content: '', version: 'missing', missing: true, size: 0, mode: 0o600 }; throw new Error('Document unavailable'); }
    try {
      const before = await file.stat();
      if (!before.isFile() || before.nlink !== 1 || before.size > LIMIT || (await lstat(handle.path)).isSymbolicLink()) throw new Error('Unsupported document');
      const bytes = await file.readFile(); const after = await file.stat();
      if (bytes.length > LIMIT || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('Document changed; refresh before continuing');
      const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (content.includes('\0')) throw new Error('Unsupported document');
      return { content, version: hash(bytes), missing: false, size: bytes.length, mode: before.mode & 0o777 };
    } finally { await file.close(); }
  }
  async document(id: unknown): Promise<ProfileDocument> {
    const handle = this.handles.get(String(id));
    if (!handle) throw new Error('Document unavailable; refresh the list');
    const { mode: _mode, ...data } = await this.read(handle);
    this.guard();
    return { id: String(id), name: basename(handle.path), editable: handle.editable, ...data };
  }
  saveDocument(input: Record<string, unknown>): Promise<ProfileDocument> {
    return this.serial(async () => {
      const handle = this.handles.get(String(input.id));
      if (!handle?.editable || typeof input.content !== 'string' || input.content.includes('\0') || Buffer.byteLength(input.content) > LIMIT) throw new Error('Document is not editable');
      const current = await this.read(handle);
      if (input.version !== current.version) throw new Error('Document changed; refresh before saving');
      const temporary = join(dirname(handle.path), `.clawket-document-${randomUUID()}`);
      try {
        const file = await open(temporary, 'wx', current.mode);
        try { await file.chmod(current.mode); await file.writeFile(input.content, 'utf8'); await file.sync(); } finally { await file.close(); }
        const latest = await this.read(handle);
        if (latest.version !== input.version) throw new Error('Document changed; refresh before saving');
        this.guard();
        await rename(temporary, handle.path);
        return this.document(input.id);
      } finally { await unlink(temporary).catch(() => {}); }
    });
  }
  async mcp(): Promise<ProfileMcp[]> {
    const result: ProfileMcp[] = []; const cursors = new Set<string>(); let totalTools = 0; const names = new Set<string>(); let cursor: string | undefined;
    do {
      const page = await this.host.request('mcpServerStatus/list', { limit: 100, detail: 'toolsAndAuthOnly', ...(cursor ? { cursor } : {}) });
      for (const row of rows(page.data, 100)) {
        if (!row.tools || typeof row.tools !== 'object' || Array.isArray(row.tools)) throw new Error('Invalid MCP tools');
        const tools = Object.values(row.tools);
        totalTools += tools.length;
        const name = text(row.name);
        if (names.has(name) || totalTools > 4000) throw new Error('Invalid or oversized MCP catalog');
        names.add(name);
        result.push({ name, toolsAvailable: row.toolsError == null, auth: row.authStatus === 'oAuth' || row.authStatus === 'bearerToken' ? 'authenticated' : row.authStatus === 'notLoggedIn' ? 'required' : row.authStatus === 'unsupported' ? 'unsupported' : 'unknown',
          tools: rows(tools, 2000).map(tool => ({ name: text(tool.name), description: typeof tool.description === 'string' ? tool.description.slice(0, 2000) : '' })) });
      }
      if (result.length > 500) throw new Error('MCP catalog too large');
      cursor = page.nextCursor == null ? undefined : text(page.nextCursor, 4096);
      if (cursor && cursors.has(cursor)) throw new Error('Invalid MCP cursor');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    if (Buffer.byteLength(JSON.stringify(result)) > 6 * 1024 * 1024) throw new Error('MCP catalog too large');
    return result;
  }
  async plugins(projectId: unknown): Promise<ProfilePlugin[]> {
    const project = await this.project(projectId);
    const response = await this.host.request('plugin/installed', { cwds: [project.path] });
    if (rows(response.marketplaceLoadErrors ?? [], 500).length) throw new Error('Plugin list could not be fully loaded');
    const result = new Map<string, ProfilePlugin>();
    for (const marketplace of rows(response.marketplaces, 50)) for (const row of rows(marketplace.plugins)) {
      if (!row.installed) continue;
      const id = text(row.id);
      if (typeof row.enabled !== 'boolean') throw new Error('Invalid plugin state');
      result.set(id, { id, name: text(row.interface?.displayName ?? row.name), description: typeof row.interface?.shortDescription === 'string' ? row.interface.shortDescription.slice(0, 2000) : '', enabled: row.enabled });
      if (result.size > 500) throw new Error('Plugin catalog too large');
    }
    return [...result.values()];
  }
  clear(): void { this.handles.clear(); this.snapshots.clear(); }
}
