import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalModelConversation } from './conversation.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function store() { const root = mkdtempSync(join(tmpdir(), 'clawket-model-')); roots.push(root); return join(root, 'conversation.json'); }
const endpoint = { id: 'test', name: 'Test', baseUrl: 'http://localhost:1', contextWindow: 8192 };
const input = { text: 'Hi', idempotencyKey: 'request-1' };

describe('durable local conversation', () => {
  it('persists completed history and never resends an acknowledged idempotency key', async () => {
    let completions = 0;
    const fetchImpl: typeof fetch = async url => {
      if (String(url).endsWith('/v1/models')) return Response.json({ data: [{ id: 'test' }] });
      completions++;
      return new Response('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: {"choices":[{"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    };
    const path = store();
    const conversation = new LocalModelConversation([endpoint], path, fetchImpl);
    const finished = new Promise<void>(resolve => conversation.on('update', e => { if (e.type === 'run_finished') resolve(); }));
    const first = await conversation.prompt(input);
    expect(await conversation.prompt(input)).toEqual(first);
    await expect(conversation.prompt({ ...input, text: 'Different message' })).rejects.toThrow('already used');
    await finished;
    await conversation.stop();
    const restored = new LocalModelConversation([endpoint], path, fetchImpl);
    expect(await restored.prompt(input)).toEqual(first);
    expect(restored.history().messages.map(m => m.text)).toEqual(['Hi', 'Hello']);
    await expect(restored.prompt({ ...input, text: 'Different message' })).rejects.toThrow('already used');
    expect(completions).toBe(1);
    await restored.stop();
  });

  it('cancels the actual upstream request and unlocks the model', async () => {
    let aborted = false;
    let started!: () => void;
    const startedPromise = new Promise<void>(resolve => { started = resolve; });
    const fetchImpl: typeof fetch = async (url, init) => {
      if (String(url).endsWith('/v1/models')) return Response.json({ data: [{ id: 'test' }] });
      return new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
        started();
      });
    };
    const conversation = new LocalModelConversation([endpoint], store(), fetchImpl);
    const result = await conversation.prompt(input);
    await startedPromise;
    await expect(conversation.select('test')).rejects.toThrow('current operation');
    await conversation.cancel(result.runId);
    expect(aborted).toBe(true);
    expect(conversation.running).toBe(false);
    await conversation.stop();
  });
});
