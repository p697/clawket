import { resolveModelIconSource, resolveModelManufacturer } from './model-icons';

describe('model manufacturer artwork', () => {
  it.each([
    ['openai/gpt-5.4', 'openai'], ['openai-codex/gpt-5.3-codex', 'openai'],
    ['openrouter/anthropic/claude-sonnet-4.6', 'anthropic'],
    ['amazon-bedrock/us.anthropic.claude-sonnet-4-6-v1:0', 'anthropic'],
    ['ollama/gpt-oss:20b', 'openai'], ['azure/o3-mini', 'openai'],
    ['google/gemini-2.5-pro', 'google'], ['ollama/gemma3:27b', 'google'],
    ['deepseek/deepseek-chat', 'deepseek'], ['ollama/qwen3:32b', 'qwen'],
    ['xai/grok-4', 'xai'], ['moonshot/kimi-k2.5', 'moonshot'],
    ['minimax/ MiniMax-M2.5 ', 'minimax'], ['zai/glm-4.7', 'zhipu'],
  ])('recognizes %s', (id, expected) => {
    expect(resolveModelManufacturer({ id })).toBe(expected);
    expect(resolveModelIconSource({ id })).not.toBeNull();
  });

  it('uses model identity ahead of a compatible endpoint or display alias', () => {
    expect(resolveModelManufacturer({ provider: 'openai', id: 'claude-sonnet-4-6', name: 'GPT proxy' })).toBe('anthropic');
    expect(resolveModelManufacturer({ provider: 'openrouter', id: 'qwen/qwen3-32b' })).toBe('qwen');
  });

  it.each(['OpenRouter', 'groq', 'ollama', 'google-antigravity', 'together', 'custom', 'constructor', '__proto__'])('does not assign a manufacturer to %s', (provider) => {
    expect(resolveModelIconSource({ provider, id: 'my-model' })).toBeNull();
  });

  it.each(['my-gpt-proxy', 'not-claude', 'grokking', 'o42', 'glmcustom', 'llama-3.3', 'mistral-large', ''])('falls back for unknown or unsupported %s', (id) => {
    expect(resolveModelIconSource({ id })).toBeNull();
  });

  it('accepts exact provider aliases and bounded display names, but rejects conflicting weak evidence', () => {
    expect(resolveModelManufacturer({ provider: ' OpenAI-Codex ', id: 'deployment-1' })).toBe('openai');
    expect(resolveModelManufacturer({ id: 'deployment-1', name: 'Claude Sonnet 4.6' })).toBe('anthropic');
    expect(resolveModelManufacturer({ provider: 'openai', id: 'deployment-1', name: 'Claude Sonnet' })).toBeNull();
    expect(resolveModelManufacturer({ provider: 'openai', id: 'anthropic/deployment-1' })).toBeNull();
    expect(resolveModelIconSource({})).toBeNull();
  });
});
