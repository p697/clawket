import { expect, it, vi } from 'vitest';
import { discoverLocalModelEndpoints } from './local-model.js';

const refused = () => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });

it('maps the model list onto endpoints and normalizes a trailing /v1 in the address', async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ data: [{ id: 'qwen3' }, { id: '' }, { object: 'model' }, { id: 'gemma' }] }));
  const endpoints = await discoverLocalModelEndpoints('http://127.0.0.1:11434/v1/', 'ollama', fetchImpl);
  expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:11434/v1/models', expect.objectContaining({ redirect: 'error' }));
  expect(endpoints).toEqual([
    { id: 'qwen3', name: 'qwen3', model: 'qwen3', baseUrl: 'http://127.0.0.1:11434', contextWindow: 8192, maxOutputTokens: 1024, engine: 'ollama' },
    { id: 'gemma', name: 'gemma', model: 'gemma', baseUrl: 'http://127.0.0.1:11434', contextWindow: 8192, maxOutputTokens: 1024, engine: 'ollama' },
  ]);
});

it('tells the user what to start or pass instead of a bare fetch failure', async () => {
  const fetchImpl = vi.fn(async () => { throw refused(); });
  await expect(discoverLocalModelEndpoints('http://127.0.0.1:8080', 'llamacpp', fetchImpl as unknown as typeof fetch))
    .rejects.toThrow('No model server answered at http://127.0.0.1:8080 (connection refused). Start llama.cpp, Ollama or another OpenAI-compatible server first, or pass --base-url and --engine');
  const slow = vi.fn(async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); });
  await expect(discoverLocalModelEndpoints('http://127.0.0.1:8080', 'llamacpp', slow as unknown as typeof fetch))
    .rejects.toThrow('no response within 10 seconds');
});

it('rejects servers that are not OpenAI-compatible, empty model lists and unknown engines', async () => {
  const notFound = vi.fn(async () => new Response('nope', { status: 404 }));
  await expect(discoverLocalModelEndpoints('http://127.0.0.1:3000', 'openai-compatible', notFound as unknown as typeof fetch))
    .rejects.toThrow('answered HTTP 404 for /v1/models, so it is not an OpenAI-compatible model server');
  const html = vi.fn(async () => new Response('<html></html>', { status: 200 }));
  await expect(discoverLocalModelEndpoints('http://127.0.0.1:3000', 'openai-compatible', html as unknown as typeof fetch))
    .rejects.toThrow('did not return a JSON model list');
  const empty = vi.fn(async () => Response.json({ data: [] }));
  await expect(discoverLocalModelEndpoints('http://127.0.0.1:11434', 'ollama', empty as unknown as typeof fetch))
    .rejects.toThrow('lists no models. Load a model first');
  const malformed = vi.fn(async () => Response.json({ data: 'oops' }));
  await expect(discoverLocalModelEndpoints('http://127.0.0.1:11434', 'ollama', malformed as unknown as typeof fetch))
    .rejects.toThrow('lists no models');
  const untouched = vi.fn();
  await expect(discoverLocalModelEndpoints('http://127.0.0.1:8080', 'vllm', untouched as unknown as typeof fetch))
    .rejects.toThrow('Unsupported model engine "vllm". Use --engine llamacpp, ollama or openai-compatible.');
  expect(untouched).not.toHaveBeenCalled();
});
