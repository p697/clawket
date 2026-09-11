import { describe, it, expect } from 'vitest';
import { LocalModelProvider, decodeSse, budgetMessages, userMessage } from './provider.js';

function bytes(parts: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({ start(controller) { for (const part of parts) controller.enqueue(part); controller.close(); } });
}

describe('local model protocol boundaries', () => {
  it('does not cold-load a router model during health or prompt validation', async () => {
    const calls: string[] = [];
    const provider = new LocalModelProvider({ id: 'a', name: 'A', model: 'a', baseUrl: 'http://localhost:1', contextWindow: 8192, engine: 'llamacpp' }, async input => {
      calls.push(String(input));
      return Response.json(String(input).includes('/props') ? { modalities: { vision: true } } : { data: [{ id: 'a', status: { value: 'unloaded' } }] });
    });
    await expect(provider.inspect()).rejects.toThrow('not loaded');
    expect(calls).toEqual(['http://localhost:1/v1/models']);
    expect(await provider.inspect(180_000, true)).toEqual({ models: ['a'], vision: true });
    expect(calls.at(-1)).toBe('http://localhost:1/props?model=a');
  });
  it('decodes Chinese split at every UTF-8 byte and CRLF boundary', async () => {
    const raw = new TextEncoder().encode(': heartbeat\r\ndata: {"text":"你好"}\r\n\r\ndata: [DONE]\r\n\r\n');
    const events = [];
    for await (const event of decodeSse(bytes([...raw].map(x => Uint8Array.of(x))))) events.push(event);
    expect(events).toEqual(['{"text":"你好"}', '[DONE]']);
  });

  it('does not accept a truncated completion as success', async () => {
    const provider = new LocalModelProvider({ id: 'test', name: 'test', baseUrl: 'http://localhost:1/v1', contextWindow: 8192 },
      async () => new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
    await expect((async () => {
      for await (const ignored of provider.complete([], 'test', new AbortController().signal)) void ignored;
    })()).rejects.toThrow('completion marker');
  });

  it('rejects unsupported images before sending a request', () => {
    expect(() => userMessage('look', [{ type: 'image', mimeType: 'image/png', content: 'aGVsbG8=' }], false)).toThrow('does not support');
    expect(() => userMessage('look', [{ type: 'image', mimeType: 'image/png', content: 'aGVsbG8=' }], true)).toThrow('MIME');
  });

  it('preserves complete recent turns and rejects oversized current input', () => {
    const history = [userMessage('x'.repeat(1000)), { role: 'assistant' as const, content: 'old' }, userMessage('recent'), { role: 'assistant' as const, content: 'reply' }];
    expect(budgetMessages(history, userMessage('now'), 1024, 512)).toEqual([...history.slice(2), userMessage('now')]);
    expect(() => budgetMessages([], userMessage('x'.repeat(1024)), 1024, 512)).toThrow('budget');
  });

  it('uses live llama.cpp capabilities instead of a configuration promise', async () => {
    const calls: string[] = [];
    const provider = new LocalModelProvider({ id: 'a', name: 'A', baseUrl: 'http://localhost:1/v1', contextWindow: 8192, engine: 'llamacpp', vision: true }, async input => {
      calls.push(String(input));
      return Response.json(String(input).endsWith('/props') ? { modalities: { vision: false } } : { data: [{ id: 'a' }] });
    });
    expect(await provider.inspect()).toEqual({ models: ['a'], vision: false });
    expect(calls).toEqual(['http://localhost:1/v1/models', 'http://localhost:1/props']);
  });
});
