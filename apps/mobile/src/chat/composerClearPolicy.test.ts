import { shouldClearComposerInput } from './composerClearPolicy';

describe('shouldClearComposerInput', () => {
  it('returns true only for send button trigger', () => {
    expect(shouldClearComposerInput('send-button')).toBe(true);
    expect(shouldClearComposerInput('slash-command')).toBe(false);
    expect(shouldClearComposerInput('model-picker')).toBe(false);
    expect(shouldClearComposerInput('command-picker')).toBe(false);
  });
});
