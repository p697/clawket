import {
  FEATURED_MODEL_COUNT,
  estimateLabelWidth,
  featuredModels,
  isCurrentModel,
  modelRowKey,
  resolveThinkingLayout,
} from './model-sheet-data';
import type { ModelInfo } from './ModelPickerModal';

const model = (id: string, provider = 'openai', extra: Partial<ModelInfo> = {}): ModelInfo => ({ id, name: id.toUpperCase(), provider, ...extra });

describe('featured models', () => {
  const catalog = [
    model('d', 'openai', { sortOrder: 3 }), model('a', 'openai', { sortOrder: 0 }), model('c', 'openai', { sortOrder: 2 }),
    model('b', 'openai', { sortOrder: 1 }), model('e', 'openai', { sortOrder: 4 }), model('f', 'openai', { sortOrder: 5 }),
  ];

  it('offers the current model, then recent ones, then the default, then the native order — at least three', () => {
    expect(FEATURED_MODEL_COUNT).toBe(3);
    const current = catalog.find((item) => item.id === 'e')!;
    expect(featuredModels({ models: catalog, current, recentRefs: ['openai/c', 'openai/e', 'gone/x'], defaultRef: 'OPENAI/F' })
      .map((item) => item.id)).toEqual(['e', 'c', 'f']);
    expect(featuredModels({ models: catalog, current }).map((item) => item.id)).toEqual(['e', 'a', 'b']);
    expect(featuredModels({ models: catalog }).map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('lists a small catalog whole, in its own order', () => {
    const small = catalog.slice(0, 4);
    expect(featuredModels({ models: small, current: small[0], recentRefs: ['openai/c'] }).map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keys rows by provider and id, and falls back to the name for id-less rows', () => {
    expect(modelRowKey(model('gpt', 'OpenAI'))).toBe('OpenAI:gpt');
    expect(modelRowKey({ id: '', name: 'Alias', provider: '' })).toBe('unknown:Alias');
  });
});

describe('current model matching', () => {
  it('accepts native ids, resolved models and provider references, honoring an explicit provider', () => {
    const native = model('native-alias', 'provider', { resolvedModel: 'resolved-model' });
    expect(isCurrentModel(native, 'native-alias', 'provider')).toBe(true);
    expect(isCurrentModel(native, 'resolved-model')).toBe(true);
    expect(isCurrentModel(native, 'provider/native-alias')).toBe(true);
    expect(isCurrentModel(native, 'native-alias', 'other')).toBe(false);
    expect(isCurrentModel(native, null)).toBe(false);
    expect(isCurrentModel({ id: '', name: 'Haiku', provider: 'anthropic' }, 'haiku')).toBe(true);
  });
});

describe('thinking layout', () => {
  const card = 358;
  const row = '思考';

  it('keeps a few short options beside their label', () => {
    expect(resolveThinkingLayout({ labels: ['低', '中', '高', '极高'], cardWidth: card, rowLabel: row, fontScale: 1 })).toEqual({ kind: 'inline', fontSize: 13 });
  });

  it('gives seven short options the full card width, stepping their labels down to fit', () => {
    expect(resolveThinkingLayout({ labels: ['自适应', '关闭', '最低', '低', '中', '高', '极高'], cardWidth: card, rowLabel: row, fontScale: 1 }))
      .toEqual({ kind: 'segments', fontSize: 13 });
    expect(resolveThinkingLayout({ labels: ['Low', 'Medium', 'High', 'Extra High'], cardWidth: card, rowLabel: row, fontScale: 1 }))
      .toEqual({ kind: 'segments', fontSize: 13 });
  });

  it('wraps into chips when large text no longer fits the segments', () => {
    expect(resolveThinkingLayout({ labels: ['自适应', '关闭', '最低', '低', '中', '高', '极高'], cardWidth: card, rowLabel: row, fontScale: 1.3 }).kind)
      .toBe('chips');
  });

  it('wraps long translations instead of squeezing them into segments', () => {
    expect(resolveThinkingLayout({ labels: ['Adaptive', 'Off', 'Minimal', 'Low', 'Medium', 'High', 'Extra High'], cardWidth: card, rowLabel: row, fontScale: 1 }).kind).toBe('chips');
    expect(resolveThinkingLayout({ labels: [], cardWidth: card, rowLabel: row, fontScale: 1 }).kind).toBe('chips');
  });

  it('measures CJK glyphs square and Latin ones narrower', () => {
    expect(estimateLabelWidth('极高', 14)).toBe(28);
    expect(estimateLabelWidth('High', 10)).toBeCloseTo(23.2);
  });
});
