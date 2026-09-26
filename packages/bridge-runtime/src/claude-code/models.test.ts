import { expect, it } from 'vitest';
import { claudeModels } from './models.js';

it('preserves default/explicit aliases separately while exposing their actual native model', () => {
  const models = claudeModels([
    { value: 'default', resolvedModel: 'claude-opus-5-5[1m]', displayName: 'Default (recommended)', description: '' },
    { value: 'opus[1m]', resolvedModel: 'claude-opus-5-5[1m]', displayName: 'Opus (1M context)', description: '' },
    { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku', description: '' },
  ]);
  expect(models.map(model => model.id)).toEqual(['default', 'opus[1m]', 'haiku']);
  expect(models.map(model => model.resolvedModel)).toEqual(['claude-opus-5-5[1m]', 'claude-opus-5-5[1m]', 'claude-haiku-4-5-20251001']);
  expect(models.map(model => model.sortOrder)).toEqual([0, 1, 2]);
});
it('does not guess model versions when an older native CLI omits them', () => {
  expect(claudeModels([{ value: 'sonnet', displayName: 'Sonnet', description: '' }])[0]).not.toHaveProperty('resolvedModel');
});
