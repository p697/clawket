import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeCatalog } from './catalog.js';

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'clawket-claude-catalog-')); dirs.push(root);
  const project = join(root, 'project'); await mkdir(project);
  const other = join(root, 'other'); await mkdir(other);
  const listSessions = vi.fn<(...args: unknown[]) => Promise<SDKSessionInfo[]>>().mockResolvedValue([]);
  const getSessionMessages = vi.fn().mockResolvedValue([]);
  return { root, project, other, sdk: { listSessions, getSessionMessages } };
}
function row(cwd: string, index: number): SDKSessionInfo {
  return { sessionId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, cwd, summary: `Task ${index}`, lastModified: index };
}

describe('Claude project and native session discovery', () => {
  it.each([false, true])('excludes SDK rows with optional cwd absent without failing the authorized catalog (device=%s)', async device => {
    const { project, sdk } = await fixture();
    const unscoped = row(project, 2); delete unscoped.cwd;
    sdk.listSessions.mockResolvedValue([row(project, 1), unscoped]);
    const catalog = new ClaudeCatalog({ project, device }, sdk, async () => []);
    const result = await catalog.discover();
    expect(result).toMatchObject({ complete: true, truncated: false });
    expect(result.sessions.map(session => session.title)).toEqual(['Task 1']);
    expect(sdk.getSessionMessages).toHaveBeenCalledTimes(1);
    expect(sdk.getSessionMessages).toHaveBeenCalledWith(row(project, 1).sessionId, { dir: project });
    expect(catalog.listProjects()).toHaveLength(1);
    expect(catalog.hasNativeEntry(unscoped.sessionId)).toBe(false);
  });

  it('continues past a full page with no eligible projects and excludes later unscoped entries', async () => {
    const { project, other, sdk } = await fixture();
    const unscoped = Array.from({ length: 100 }, (_, index) => { const info = row(project, index); delete info.cwd; return info; });
    sdk.listSessions.mockResolvedValueOnce(unscoped).mockResolvedValueOnce([row(other, 100), row(project, 101)]);
    const catalog = new ClaudeCatalog({ project, device: false }, sdk, async () => []);
    const result = await catalog.discover();
    expect(result).toMatchObject({ complete: true, truncated: false });
    expect(result.sessions.map(session => session.title)).toEqual(['Task 101']);
    expect(sdk.listSessions).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 100, dir: await realpath(project) }));
    expect(sdk.getSessionMessages).toHaveBeenCalledTimes(1);
    expect(sdk.getSessionMessages).toHaveBeenCalledWith(row(project, 101).sessionId, { dir: project });
  });

  it('withdraws an unscoped native lookup instead of borrowing its former project', async () => {
    const { project, sdk } = await fixture();
    const catalog = new ClaudeCatalog({ project, device: true }, sdk, async () => []);
    sdk.listSessions.mockResolvedValue([row(project, 1)]);
    const key = (await catalog.discover()).sessions[0].key;
    const unscoped = row(project, 1); delete unscoped.cwd;
    sdk.listSessions.mockResolvedValue([unscoped]); sdk.getSessionMessages.mockClear();
    expect(await catalog.discover()).toMatchObject({ complete: true, sessions: [] });
    expect(() => catalog.native(key)).toThrow('Unknown');
    await expect(catalog.history(key)).rejects.toThrow('Unknown');
    expect(sdk.getSessionMessages).not.toHaveBeenCalled();
  });

  it('detects repeated identities even when one occurrence has no cwd', async () => {
    const { project, sdk } = await fixture();
    const unscoped = row(project, 1); delete unscoped.cwd;
    sdk.listSessions.mockResolvedValue([row(project, 1), unscoped]);
    const result = await new ClaudeCatalog({ project, device: true }, sdk, async () => []).discover();
    expect(result.complete).toBe(false);
    expect(result.sessions).toHaveLength(1);
  });

  it('retains the scan cap when every page has fresh unscoped identities', async () => {
    const { project, sdk } = await fixture();
    sdk.listSessions.mockImplementation(async (...args) => {
      const { offset } = args[0] as { offset: number };
      return Array.from({ length: 100 }, (_, index) => { const info = row(project, offset + index); delete info.cwd; return info; });
    });
    expect(await new ClaudeCatalog({ project, device: true }, sdk, async () => []).discover())
      .toMatchObject({ complete: false, truncated: true, sessions: [] });
    expect(sdk.listSessions).toHaveBeenCalledTimes(20);
    expect(sdk.getSessionMessages).not.toHaveBeenCalled();
  });

  it.each([null, '', 'relative/project', 42])('keeps malformed present cwd incomplete (%s)', async cwd => {
    const { project, sdk } = await fixture();
    const catalog = new ClaudeCatalog({ project, device: true }, sdk, async () => []);
    sdk.listSessions.mockResolvedValue([row(project, 1)]);
    const key = (await catalog.discover()).sessions[0].key;
    sdk.listSessions.mockResolvedValue([{ ...row(project, 1), cwd } as SDKSessionInfo]);
    expect(await catalog.discover()).toMatchObject({ complete: false, sessions: [] });
    await expect(catalog.history(key)).resolves.toMatchObject({ messages: [] });
  });

  it('preserves known history through incomplete scans while admitting only bounded positive same-scope entries', async () => {
    const { project, other, sdk } = await fixture();
    const catalog = new ClaudeCatalog({ project, device: false }, sdk, async () => []);
    sdk.listSessions.mockResolvedValue([row(project, 1)]);
    const first = await catalog.discover(), knownKey = first.sessions[0].key;
    sdk.listSessions.mockResolvedValue([row(project, 2), row(other, 3), { sessionId: 'invalid' } as SDKSessionInfo]);
    const incomplete = await catalog.discover();
    expect(incomplete.complete).toBe(false); expect(incomplete.sessions).toHaveLength(1);
    await expect(catalog.history(knownKey)).resolves.toMatchObject({ messages: [] });
    await expect(catalog.history(incomplete.sessions[0].key)).resolves.toMatchObject({ messages: [] });
    expect(sdk.getSessionMessages.mock.calls.every(call => call[1].dir !== other)).toBe(true);
    sdk.listSessions.mockResolvedValue([]);
    expect(await catalog.discover()).toMatchObject({ complete: true, sessions: [] });
    await expect(catalog.history(knownKey)).rejects.toThrow('Unknown');
    await expect(catalog.history(incomplete.sessions[0].key)).rejects.toThrow('Unknown');
  });
  it('enforces project scope even if native discovery returns an unrelated path', async () => {
    const { project, other, sdk } = await fixture();
    sdk.listSessions.mockResolvedValue([row(project, 1), row(other, 2)]);
    const catalog = new ClaudeCatalog({ project, device: false }, sdk, async () => []);
    const { sessions } = await catalog.discover();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ source: 'native', canContinue: false, allowedActions: { delete: false, reset: false } });
    await expect(catalog.history('unlisted-client-id')).rejects.toThrow('Unknown');
    expect(sdk.getSessionMessages).toHaveBeenCalledTimes(1);
    expect(sdk.getSessionMessages).toHaveBeenCalledWith(row(project, 1).sessionId, { dir: project });
  });

  it('discovers more than one page, hides native IDs and keeps a missing project visible', async () => {
    const { root, project, sdk } = await fixture();
    sdk.listSessions.mockResolvedValueOnce(Array.from({ length: 100 }, (_, n) => row(project, n)))
      .mockResolvedValueOnce([row(join(root, 'gone'), 101)]);
    const catalog = new ClaudeCatalog({ project, device: true }, sdk, async () => []);
    const result = await catalog.discover();
    expect(result.truncated).toBe(false);
    expect(result.sessions).toHaveLength(101);
    expect(result.sessions[100].project?.available).toBe(false);
    expect(result.sessions[0].key).not.toContain('00000000-');
    expect(sdk.listSessions).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 100, includeProgrammatic: false }));
  });

  it('includes saved projects without conversations only for device pairing', async () => {
    const { project, other, sdk } = await fixture();
    const saved = vi.fn().mockResolvedValue([other]);
    const device = new ClaudeCatalog({ project, device: true }, sdk, saved);
    await device.discover();
    expect(device.listProjects().map(p => p.name)).toContain('other');
    saved.mockClear();
    const scoped = new ClaudeCatalog({ project, device: false }, sdk, saved);
    await scoped.discover();
    expect(saved).not.toHaveBeenCalled();
    expect(scoped.listProjects()).toHaveLength(1);
  });

  it('bounds an SDK that ignores pagination and retains the previous snapshot on a failed refresh', async () => {
    const { project, sdk } = await fixture();
    sdk.listSessions.mockResolvedValue(Array.from({ length: 100 }, (_, n) => row(project, n)));
    const catalog = new ClaudeCatalog({ project, device: true }, sdk, async () => []);
    const first = await catalog.discover();
    expect(first.truncated).toBe(true);
    expect(sdk.listSessions).toHaveBeenCalledTimes(2);
    sdk.listSessions.mockRejectedValueOnce(new Error('fixture failure'));
    await expect(catalog.discover()).rejects.toThrow();
    await expect(catalog.history(first.sessions[0].key)).resolves.toMatchObject({ messages: [] });
  });
  it('shows the latest visible native reply and reuses the cached transcript while unchanged', async () => {
    const { project, sdk } = await fixture();
    sdk.listSessions.mockResolvedValue([row(project, 1)]);
    sdk.getSessionMessages.mockResolvedValue([
      { uuid: 'first', type: 'user', timestamp: '2026-09-27T10:00:00.000Z', message: { content: 'First prompt' } },
      { uuid: 'last', type: 'assistant', timestamp: '2026-09-27T10:01:00.000Z', message: { content: [{ type: 'text', text: '**Latest reply**' }] } },
    ]);
    const catalog = new ClaudeCatalog({ project, device: false }, sdk, async () => []);
    expect((await catalog.discover()).sessions[0]).toMatchObject({ preview: 'Latest reply', lastActivityAt: Date.parse('2026-09-27T10:01:00.000Z') });
    await catalog.discover();
    expect(sdk.getSessionMessages).toHaveBeenCalledTimes(1);
  });

  it('projects native model metadata and rereads the selected conversation without a cached default', async () => {
    const { project, sdk } = await fixture(); const info = row(project, 1);
    sdk.listSessions.mockResolvedValue([info]);
    sdk.getSessionMessages.mockResolvedValue([{ uuid: 'reply', type: 'assistant', message: { model: 'claude-old', content: [] } }]);
    const catalog = new ClaudeCatalog({ project, device: false }, sdk, async () => []);
    expect((await catalog.discover()).sessions[0].model).toBe('claude-old');
    sdk.getSessionMessages.mockResolvedValue([{ uuid: 'new', type: 'assistant', message: { model: 'claude-new', content: [] } }]);
    expect(await catalog.readModel(info.sessionId, project)).toBe('claude-new');
    sdk.getSessionMessages.mockResolvedValue([{ uuid: 'synthetic', type: 'assistant', message: { model: '<synthetic>', content: [] } }]);
    expect(await catalog.readModel(info.sessionId, project)).toBeUndefined();
  });
});
