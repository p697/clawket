import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/codex-relay/*.test.ts'], fileParallelism: false, hookTimeout: 60000, testTimeout: 60000 } });
