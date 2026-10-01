import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexProfile } from './profile.js';
let root: string, project: string, user: string, skill: string, profile: CodexProfile, config: any, version: number, enabled: boolean;
let request: ReturnType<typeof vi.fn>, current: boolean;
const models = [{ model: 'one', displayName: 'One', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }] }, { model: 'two', displayName: 'Two', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }];
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'clawket-profile-'))); project = join(root, 'project'); user = join(root, 'user'); skill = join(project, '.agents', 'skills', 'example', 'SKILL.md');
  await mkdir(join(project, '.agents', 'skills', 'example'), { recursive: true }); await mkdir(user); await writeFile(skill, '---\nname: example\n---\nTest');
  config = { model: 'one', model_reasoning_effort: 'medium' }; version = 1; enabled = false; current = true;
  request = vi.fn(async (method: string, params: any = {}) => {
    if (method === 'config/read') return { config: { ...config }, layers: [{ name: { type: 'user', file: join(user, 'config.toml') }, version: String(version) }] };
    if (method === 'config/batchWrite') { if (params.expectedVersion !== String(version)) throw new Error('conflict'); for (const edit of params.edits) config[edit.keyPath] = edit.value; version++; return {}; }
    if (method === 'skills/list') return { data: [{ cwd: project, skills: [{ name: 'example', path: skill, scope: 'repo', description: 'A skill', enabled }], errors: [] }] };
    if (method === 'skills/config/write') { enabled = params.enabled; return {}; }
    if (method === 'account/read') return { account: { type: 'chatgpt', planType: 'pro' } };
    if (method === 'account/rateLimits/read') return { rateLimitsByLimitId: { codex: { primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1800000000 } }, review: { primary: { usedPercent: 110, windowDurationMins: 10080, resetsAt: null } } } };
    if (method === 'account/usage/read') return { summary: { lifetimeTokens: 42 }, dailyUsageBuckets: [{ startDate: '2026-10-01', tokens: 12 }] };
    if (method === 'mcpServerStatus/list') return { data: [{ name: 'search', authStatus: 'oAuth', tools: { search: { name: 'search', description: 'Find', inputSchema: { secret: true } } }, httpOrigin: 'private' }], nextCursor: null };
    if (method === 'plugin/installed') return { marketplaces: [{ plugins: [{ id: 'installed', name: 'Installed', installed: true, enabled: false }, { id: 'catalog', name: 'Uninstalled', installed: false }] }], marketplaceLoadErrors: [] };
    throw new Error('Unexpected native request');
  });
  profile = new CodexProfile({ current: () => current, request, projects: async () => [{ id: 'p', name: 'Project', path: project, available: true }], models: async () => models });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
it('writes model defaults with native CAS without modifying sessions', async () => {
  const initial = await profile.defaults(); config = { model_reasoning_effort: 'medium', model: 'one' }; expect(await profile.setDefaults({ model: 'two', thinking: 'low', version: initial.version })).toMatchObject({ model: 'two', thinking: 'low' });
  expect(request).toHaveBeenCalledWith('config/batchWrite', { expectedVersion: '1', reloadUserConfig: false, edits: [{ keyPath: 'model', value: 'two', mergeStrategy: 'upsert' }, { keyPath: 'model_reasoning_effort', value: 'low', mergeStrategy: 'upsert' }] });
  expect(request.mock.calls.every(([method]) => !method.startsWith('thread/') && !method.startsWith('turn/'))).toBe(true);
  await expect(profile.setDefaults({ model: 'one', thinking: 'medium', version: initial.version })).rejects.toThrow('refresh');
});
it('rejects stale config, incompatible levels and retries after uncertain writes', async () => {
  const first = await profile.defaults(); version++; await expect(profile.setDefaults({ model: 'two', thinking: 'low', version: first.version })).rejects.toThrow('changed');
  const second = await profile.defaults(); await expect(profile.setDefaults({ model: 'two', thinking: 'high', version: second.version })).rejects.toThrow('reasoning');
  const native = request.getMockImplementation()!;
  request.mockImplementation(async (method, params) => { if (method === 'config/batchWrite') throw new Error('uncertain'); return native(method, params); });
  await expect(profile.setDefaults({ model: 'two', thinking: 'low', version: second.version })).rejects.toThrow('uncertain');
  await expect(profile.setDefaults({ model: 'two', thinking: 'low', version: second.version })).rejects.toThrow('refresh');
  expect(request.mock.calls.filter(([method]) => method === 'config/batchWrite')).toHaveLength(1);
});
it('retains all quota buckets and optional usage without inventing API-key quotas', async () => {
  const result = await profile.usage(); expect(result).toMatchObject({ plan: 'pro', lifetimeTokens: 42 }); expect(result.quotas).toHaveLength(2); expect(result.quotas[1].windows[0].resetsAt).toBeNull();
  const native = request.getMockImplementation()!; request.mockImplementation(async (method, params) => method === 'account/usage/read' ? Promise.reject(new Error()) : native(method, params));
  expect((await profile.usage()).lifetimeTokens).toBeNull();
  request.mockResolvedValue({ account: { type: 'apiKey' } }); expect(await profile.usage()).toEqual({ plan: null, quotas: [], lifetimeTokens: null, daily: [] });
});
it('preserves disabled skills and authorizes source access from the native list', async () => {
  const result = await profile.skills('p'); expect(result.skills[0]).toMatchObject({ name: 'example', enabled: false, scope: 'project', editable: true }); expect(JSON.stringify(result)).not.toContain(project);
  const id = result.skills[0].id; expect((await profile.setSkillEnabled(id, true)).skills[0].enabled).toBe(true); expect(request).toHaveBeenCalledWith('skills/config/write', { path: skill, enabled: true });
  expect((await profile.document(id)).content).toContain('name: example'); await expect(profile.document(skill)).rejects.toThrow('unavailable'); await expect(profile.skills('../project')).rejects.toThrow('unavailable');
});
it('reads user/project instructions, creates missing files and rejects desktop edit conflicts', async () => {
  await writeFile(join(project, 'AGENTS.md'), 'Original'); const files = await profile.instructions('p'); expect(files.map(row => row.scope)).toEqual(['user', 'project']);
  const id = files.find(row => row.scope === 'project')!.id; const original = await profile.document(id); await writeFile(join(project, 'AGENTS.md'), 'Desktop changed');
  await expect(profile.saveDocument({ id, content: 'Phone', version: original.version })).rejects.toThrow('changed');
  const fresh = await profile.document(id); expect((await profile.saveDocument({ id, content: 'Phone', version: fresh.version })).content).toBe('Phone');
  const globalId = files.find(row => row.scope === 'user')!.id; const missing = await profile.document(globalId); expect(missing.missing).toBe(true);
  await profile.saveDocument({ id: globalId, content: 'Global', version: missing.version }); expect(await readFile(join(user, 'AGENTS.md'), 'utf8')).toBe('Global');
});
it('rejects linked, binary, oversized files and stale native generations', async () => {
  await writeFile(join(root, 'private'), 'Private'); await symlink(join(root, 'private'), join(project, 'AGENTS.md')); await expect(profile.instructions('p')).rejects.toThrow('Unsupported'); await rm(join(project, 'AGENTS.md'));
  const id = (await profile.instructions('p')).find(row => row.scope === 'project')!.id;
  await link(join(root, 'private'), join(project, 'AGENTS.md')); await expect(profile.document(id)).rejects.toThrow('Unsupported'); await rm(join(project, 'AGENTS.md'));
  await writeFile(join(project, 'AGENTS.md'), '\0'); await expect(profile.document(id)).rejects.toThrow('Unsupported');
  await writeFile(join(project, 'AGENTS.md'), 'x'.repeat(128 * 1024 + 1)); await expect(profile.document(id)).rejects.toThrow('Unsupported');
  await writeFile(join(project, 'AGENTS.md'), 'safe'); const original = await profile.document(id); current = false;
  await expect(profile.saveDocument({ id, content: 'new', version: original.version })).rejects.toThrow('Reconnect'); expect(await readFile(join(project, 'AGENTS.md'), 'utf8')).toBe('safe');
});
it('shows read-only MCP tools and installed plugins without private metadata', async () => {
  expect(await profile.mcp()).toEqual([{ name: 'search', auth: 'authenticated', toolsAvailable: true, tools: [{ name: 'search', description: 'Find' }] }]);
  expect(await profile.plugins('p')).toEqual([{ id: 'installed', name: 'Installed', description: '', enabled: false }]);
  expect(request.mock.calls.every(([method]) => method !== 'plugin/install' && !method.startsWith('mcpServer/'))).toBe(true);
});
it('rejects corrupt quota/project results and unfinished pagination', async () => {
  request.mockResolvedValue({ account: { type: 'chatgpt' }, rateLimits: { primary: { usedPercent: NaN, windowDurationMins: 300 } } }); await expect(profile.usage()).rejects.toThrow('quota');
  request.mockResolvedValue({ data: [{ cwd: user, skills: [] }] }); await expect(profile.skills('p')).rejects.toThrow('mismatch');
  request.mockResolvedValue({ data: [], nextCursor: 'repeated' }); await expect(profile.mcp()).rejects.toThrow('cursor');
  profile.clear(); await expect(profile.document('random')).rejects.toThrow('unavailable');
});

it('never writes the OpenAI catalog into a custom provider configuration', async () => {
  config = { model: 'custom-model', model_provider: 'custom' };
  const defaults = await profile.defaults();
  expect(defaults).toMatchObject({ model: 'custom-model', editable: false, models: [] });
  await expect(profile.setDefaults({ model: 'two', thinking: 'low', version: defaults.version })).rejects.toThrow('computer');
  expect(request.mock.calls.some(([method]) => method === 'config/batchWrite')).toBe(false);
});
