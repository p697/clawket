import { buildModelSections, resolveProviderModel } from './model-picker-data';

describe('ModelPickerModal helpers', () => {
  it.each([undefined, [{ slug: 'openai', name: 'OpenAI' }]])('retains backend recommendations through grouping and search', providers => {
    const models = [
      { id: 'gpt-5.5', name: 'GPT-5.5', provider: 'openai', sortOrder: 3 },
      { id: 'gpt-6-luna', name: 'GPT-6-Luna', provider: 'openai', sortOrder: 2 },
      { id: 'gpt-6-astra', name: 'GPT-6-Astra', provider: 'openai', sortOrder: 0 },
      { id: 'gpt-6-sol', name: 'GPT-6-Sol', provider: 'openai', sortOrder: 1 },
    ];
    expect(buildModelSections(models, '', providers)[0].data.map(m => m.id)).toEqual(['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.5']);
    expect(buildModelSections(models, 'gpt-6', providers)[0].data.map(m => m.id)).toEqual(['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna']);
  });
  it('groups models by provider and sorts providers and models', () => {
    const sections = buildModelSections([
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', provider: 'anthropic' },
      { id: 'gpt-5', name: 'GPT-5', provider: 'openai' },
      { id: 'claude-opus-4-1', name: 'Claude Opus 4.1', provider: 'anthropic' },
    ], '');

    expect(sections.map((section) => section.provider)).toEqual(['anthropic', 'openai']);
    expect(sections[0]?.data.map((model) => model.id)).toEqual([
      'claude-opus-4-1',
      'claude-sonnet-4-5',
    ]);
  });

  it('keeps provider grouping when filtering by search query', () => {
    const sections = buildModelSections([
      { id: 'gpt-5', name: 'GPT-5', provider: 'openai' },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 mini', provider: 'openai' },
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', provider: 'anthropic' },
    ], 'gpt');

    expect(sections).toHaveLength(1);
    expect(sections[0]?.provider).toBe('openai');
    expect(sections[0]?.data).toHaveLength(2);
  });

  it('builds provider-qualified model ids when missing from source id', () => {
    expect(resolveProviderModel({
      id: 'gpt-5',
      name: 'GPT-5',
      provider: 'openai',
    })).toBe('openai/gpt-5');
  });
});

it('searches the resolved native model without changing the selectable alias', () => {
  const models = [{ id: 'haiku', name: 'Haiku', provider: 'anthropic', resolvedModel: 'claude-haiku-4-5-20251001' }];
  expect(buildModelSections(models, '20251001')[0].data[0]).toEqual(models[0]);
  expect(resolveProviderModel(models[0])).toBe('anthropic/haiku');
});
