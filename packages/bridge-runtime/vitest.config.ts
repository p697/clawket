import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['../../tests/isolated-node-home.ts'],
    maxWorkers: 2,
    // These tests start real Python/SQLite children; Windows runner startup can
    // exceed Vitest's 5-second default even when the assertions finish promptly.
    testTimeout: process.platform === 'win32' ? 15_000 : 5_000,
    hookTimeout: process.platform === 'win32' ? 15_000 : 10_000,
  },
});
