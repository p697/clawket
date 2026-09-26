import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/speech/*.test.ts'], fileParallelism: false, hookTimeout: 60000, testTimeout: 40000 } });
