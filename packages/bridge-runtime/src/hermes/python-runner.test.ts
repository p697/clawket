import { describe, expect, it } from 'vitest';
import { HermesPythonRunner } from './python-runner.js';

const runner = new HermesPythonRunner({ hermesSourcePath: '/nonexistent-hermes-fixture',
  hermesHomePath: '/nonexistent-hermes-home', hermesPythonPath: 'python3' });

describe('Hermes subprocess error boundary', () => {
  it('keeps Python source and sensitive exception values out of client error messages', async () => {
    const script = 'raise ValueError("private-fixture-sentinel")';
    try {
      await runner.run(script);
      throw new Error('Expected subprocess failure');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('Hermes operation failed (ValueError). Check Bridge diagnostics.');
      expect((error as Error).message).not.toContain('private-fixture-sentinel');
      expect((error as Error).message).not.toContain(script);
      expect((error as Error).cause).toBeDefined();
    }
  });
});
