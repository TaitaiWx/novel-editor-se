import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/src/**/*.spec.ts',
      'apps/pc/test/**/*.test.ts',
      'apps/pc/test/**/*.spec.ts',
    ],
  },
});
