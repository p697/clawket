import { expect, it, vi } from 'vitest';
import { hermesFileRoots } from './session-files.js';
it('adds only configured roots and the user-owned output directory', async () => {
  const run = vi.fn().mockResolvedValue(['/work']);
  expect(await hermesFileRoots(run, '/home/hermes')).toEqual(['/work', '/home/hermes/outputs']);
});
it('rejects malformed native configuration results', async () => {
  for (const value of [null, {}, [2], ['/one', '/two']]) await expect(hermesFileRoots(vi.fn().mockResolvedValue(value), '/home/hermes')).rejects.toThrow();
});
