import { defineConfig } from 'vitest/config';

// Explicit integration commands may use native authentication. Ordinary tests
// retain vitest.config.ts's disposable profile and cannot read the owner's state.
export default defineConfig({ test: { include: ['src/**/*.integration.test.ts'], maxWorkers: 2, fileParallelism: false } });
