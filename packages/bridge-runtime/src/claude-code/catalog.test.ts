import { mkdtemp, mkdir, rm } from 'node:fs/promises';
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
  it('enforces project scope even if native discovery returns an unrelated path', async () => {
    const { project, other, sdk } = await fixture();
    sdk.listSessions.mockResolvedValue([row(project, 1), row(other, 2)]);
    const catalog = new ClaudeCatalog({ project, device: false }, sdk, async () => []);
    const { sessions } = await catalog.discover();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ source: 'native', canContinue: false, allowedActions: { delete: false, reset: false } });
    await expect(catalog.history('unlisted-client-id')).rejects.toThrow('Unknown');
    expect(sdk.getSessionMessages).not.toHaveBeenCalled();
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
});
