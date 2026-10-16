import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['packages/ui/test/**/*.test.{ts,tsx}'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['packages/ui/src/**/*.{ts,tsx}'],
      exclude: ['**/*.d.ts'],
      reportsDirectory: './coverage/ui',
      reporter: ['text', 'json-summary', 'html'],
      thresholds: { statements: 90, branches: 85, functions: 90, lines: 95 },
    },
  },
});
