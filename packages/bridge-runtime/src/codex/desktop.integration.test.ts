import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodexService } from './service.js';
import { resolveCodexExecutable } from './executable.js';

it('uses the discovered desktop runtime for both the catalog and a completed new conversation', async () => {
  if (process.env.CLAWKET_CODEX_DESKTOP_LIVE !== '1' || process.platform !== 'darwin') {
    throw new Error('Set CLAWKET_CODEX_DESKTOP_LIVE=1 on macOS with an authenticated Codex desktop installation. This test uses real model access.');
  }
  const executable = resolveCodexExecutable();
  expect(executable.command).toMatch(/\/(?:Codex|ChatGPT)\.app\/Contents\//);
  const root = mkdtempSync(join(tmpdir(), 'clawket-desktop-smoke-'));
  const project = join(root, 'project'); mkdirSync(project);
  const service = new CodexService({ project: realpathSync(project), directory: join(root, 'state') });
  const events: any[] = []; service.on('update', event => events.push(event));
  const request = (method: string, params: object = {}) => service.request({ type: 'req', id: randomUUID(), method, params }) as Promise<any>;
  let key: string | undefined;
  try {
    expect(await service.health()).toMatchObject({ backend: 'codex', modelReady: true });
    key = (await request('sessions.create')).key;
    const selection = await request('models.list', { sessionKey: key });
    const nativeCatalog = (await (service as any).rpc.request('model/list', { limit: 100, includeHidden: false })).data;
    expect(nativeCatalog.some((model: any) => model.model === selection.currentModel)).toBe(true);
    expect(selection.models.map((model: any) => model.id)).toEqual(nativeCatalog.map((model: any) => model.model));
    expect(selection.permissions.mode).toBe('workspace');
    const run = await request('chat.send', { sessionKey: key, text: 'Reply exactly CLAWKET_DESKTOP_RUNTIME_OK. Do not use tools.', idempotencyKey: randomUUID() });
    const deadline = Date.now() + 90000;
    while (!events.some(event => event.type === 'run_finished' && event.runId === run.runId)) {
      if (Date.now() >= deadline) throw new Error('Desktop runtime smoke timed out');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(events.find(event => event.type === 'run_finished' && event.runId === run.runId).stopReason).toBe('end_turn');
    const history = await request('chat.history', { sessionKey: key });
    expect(history.messages.some((message: any) => message.role === 'assistant' && message.text.trim() === 'CLAWKET_DESKTOP_RUNTIME_OK')).toBe(true);
    console.log(`Verified desktop runtime ${(service as any).rpc.nativeVersion}: native catalog, default model, workspace permissions and completed new turn.`);
  } finally {
    if (key) await request('sessions.delete', { sessionKey: key }).catch(() => {});
    await service.stop(); rmSync(root, { recursive: true, force: true });
  }
}, 120000);
