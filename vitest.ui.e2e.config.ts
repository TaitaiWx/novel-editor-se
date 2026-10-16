import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/ui/e2e/**/*.e2e.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    teardownTimeout: 15_000,
    reporters: ['verbose'],
  },
});
