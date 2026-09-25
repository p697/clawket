import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/pi-cli/*.test.ts'], fileParallelism: false, testTimeout: 90000 } });
