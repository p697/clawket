import { expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SessionUpdate } from '@clawket/agent-protocol';
import { inspectClaudeInstallation, resolveClaudeExecutable } from './executable.js';
import { ClaudeService } from './service.js';

it('uses the automatically discovered Desktop runtime for models and two completed SDK turns', async () => {
  if (process.env.CLAWKET_CLAUDE_DESKTOP_LIVE !== '1' || process.platform !== 'darwin') {
    throw new Error('Set CLAWKET_CLAUDE_DESKTOP_LIVE=1 on macOS with an authenticated Claude Desktop Code runtime. This test uses real model access.');
  }
  const installed = await inspectClaudeInstallation();
  expect(installed.executable).toContain('/Library/Application Support/Claude/claude-code/');
  expect(resolveClaudeExecutable('claude', { searchPath: '' })).toBe(installed.executable);
  const root = mkdtempSync(join(tmpdir(), 'clawket-claude-desktop-'));
  const project = join(root, 'project'); mkdirSync(project);
  const service = new ClaudeService({ project: realpathSync(project), directory: join(root, 'state'),
    ownershipDirectory: join(root, 'writers'), executable: installed.executable });
  const events: SessionUpdate[] = []; service.on('update', event => events.push(event));
  const request = (method: string, params: object = {}) => service.request({ type: 'req', id: randomUUID(), method, params }) as Promise<any>;
  let key: string | undefined;
  try {
    key = (await request('sessions.create')).key;
    const selection = await request('models.list', { sessionKey: key });
    expect(selection.models.length).toBeGreaterThan(0);
    const session = (service as any).sessions.get(key);
    let nativeId: string | undefined;
    for (const marker of ['CLAWKET_CLAUDE_DESKTOP_FIRST_OK', 'CLAWKET_CLAUDE_DESKTOP_SECOND_OK']) {
      const run = await request('chat.send', { sessionKey: key, text: `Reply exactly ${marker}. Do not use tools.`, idempotencyKey: randomUUID() });
      const deadline = Date.now() + 90000;
      while (!events.some(event => event.type === 'run_finished' && event.runId === run.runId)) {
        if (Date.now() >= deadline) throw new Error('Claude Desktop runtime smoke timed out');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      expect(events.find(event => event.type === 'run_finished' && event.runId === run.runId)).toMatchObject({ stopReason: 'end_turn' });
      expect((service as any).sessions.get(key)).toBe(session);
      expect(session.sessionId).toBeTruthy();
      if (nativeId) expect(session.sessionId).toBe(nativeId);
      else nativeId = session.sessionId;
      const history = await request('chat.history', { sessionKey: key });
      expect(history.messages.some((message: any) => message.role === 'assistant' && message.text.trim() === marker)).toBe(true);
    }
    console.log(`Verified Claude Desktop runtime ${installed.version}: ${selection.models.length} native models and two completed same-session turns; empty PATH discovery matches.`);
  } finally {
    if (key) await request('sessions.delete', { sessionKey: key }).catch(() => {});
    await service.stop(); rmSync(root, { recursive: true, force: true });
  }
}, 210000);
