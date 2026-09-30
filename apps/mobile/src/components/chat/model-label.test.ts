import { shortModelLabel } from './model-label';

describe('shortModelLabel', () => {
  it('reads Claude ids and display names as the product name', () => {
    expect(shortModelLabel('claude-opus-5-5')).toBe('Opus 5.5');
    expect(shortModelLabel('anthropic/claude-sonnet-4-6')).toBe('Sonnet 4.6');
    expect(shortModelLabel('Claude Haiku 4.5')).toBe('Haiku 4.5');
    expect(shortModelLabel('claude-opus-4-1-20250805')).toBe('Opus 4.1');
    expect(shortModelLabel('claude-sonnet-4-20250514')).toBe('Sonnet 4');
  });

  it('keeps other names as given, without the provider path', () => {
    expect(shortModelLabel('GPT-6.1-Sol')).toBe('GPT-6.1-Sol');
    expect(shortModelLabel('openrouter/deepseek-flash')).toBe('deepseek-flash');
    expect(shortModelLabel('Qwen 3.5 Plus')).toBe('Qwen 3.5 Plus');
    expect(shortModelLabel('claude-3-5-sonnet-20241022')).toBe('claude-3-5-sonnet-20241022');
    expect(shortModelLabel(undefined)).toBe('');
    expect(shortModelLabel('  ')).toBe('');
  });
});
