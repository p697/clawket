import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {
  include: ['tests/release/*.test.ts'], fileParallelism: false,
  maxWorkers: 1, minWorkers: 1, hookTimeout: 30_000, testTimeout: 120_000,
} });
