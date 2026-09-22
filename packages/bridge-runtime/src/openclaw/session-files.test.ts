import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenClawSessionFiles } from './session-files.js';
const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
it('requires read scope and native workspace/history methods', () => {
  const channel = new OpenClawSessionFiles({ nativeMethods: ['chat.history'], scopes: ['operator.read'], sendClient: vi.fn(), sendGateway: vi.fn() });
  expect(channel.methods).toEqual([]); channel.dispose();
});
it('lists from authenticated native history and workspace, then reads by session handle', async () => {
  const root = mkdtempSync(join(tmpdir(), 'clawket-oc-files-')); roots.push(root); writeFileSync(join(root, 'answer.txt'), 'hello');
  const output: any[] = [];
  const channel = new OpenClawSessionFiles({ nativeMethods: ['chat.history', 'agents.files.list'], scopes: ['operator.read'],
    sendClient: text => output.push(JSON.parse(text)), sendGateway: text => {
      const frame = JSON.parse(text);
      channel.handleResponse(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload: frame.method === 'chat.history'
        ? { messages: [{ role: 'assistant', content: '[File](answer.txt)' }] } : { agentId: 'main', workspace: root } }));
    } });
  expect(channel.handleRequest(JSON.stringify({ type: 'req', id: 'list', method: 'clawket.files.list', params: { sessionKey: 'agent:main:one' } }))).toBe(true);
  await vi.waitFor(() => expect(output).toHaveLength(1));
  const file = output[0].payload.files[0]; expect(file.name).toBe('answer.txt'); expect(JSON.stringify(output)).not.toContain(root);
  channel.handleRequest(JSON.stringify({ type: 'req', id: 'read', method: 'clawket.files.read', params: { sessionKey: 'agent:main:one', id: file.id, offset: 0 } }));
  await vi.waitFor(() => expect(output).toHaveLength(2)); expect(output[1].payload.data).toBe(Buffer.from('hello').toString('base64'));
  channel.dispose(); expect(channel.handleRequest(JSON.stringify({ type: 'req', id: 'late', method: 'clawket.files.read' }))).toBe(false);
});
it('disposal cancels pending lookups without sending late frames', async () => {
  const gateway = vi.fn(); const client = vi.fn();
  const channel = new OpenClawSessionFiles({ nativeMethods: ['chat.history', 'agents.files.list'], scopes: ['operator.admin'], sendClient: client, sendGateway: gateway });
  channel.handleRequest(JSON.stringify({ type: 'req', id: 'x', method: 'clawket.files.list', params: { sessionKey: 'agent:main:one' } }));
  channel.dispose(); await Promise.resolve(); await Promise.resolve();
  expect(gateway).toHaveBeenCalledTimes(1); expect(client).not.toHaveBeenCalled();
});
