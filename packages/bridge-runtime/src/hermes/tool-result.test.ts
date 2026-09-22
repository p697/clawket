import { describe, expect, it } from 'vitest';
import { hermesToolResultFailed } from './tool-result.js';
describe('native tool outcome recovery', () => {
  it.each([{ output: '[Command interrupted]', exit_code: 130, error: null }, { exit_code: '1' }, { success: false }, { error: 'denied' }, { status: 'cancelled' }, { is_error: true }])('recognizes structured failure %j', value => {
    expect(hermesToolResultFailed(value)).toBe(true);
    expect(hermesToolResultFailed(JSON.stringify(value))).toBe(true);
  });
  it.each(['the article discusses an error', { output: 'error', exit_code: 0, error: null }, { error: '' }, { results: [{ error: true }] }, [], null])('does not invent a failure from ordinary content %j', value => {
    expect(hermesToolResultFailed(value)).toBe(false);
  });
});
