import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// 轻量测试方案：默认 node 环境；需要 DOM 的用例在文件头加
// `// @vitest-environment happy-dom`，配合 @testing-library/react 测组件与 hooks。
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'apps/pc/src'),
    },
  },
  test: {
    // 开启 globals 让 @testing-library/react 在每个用例后自动 cleanup
    globals: true,
    include: [
      'packages/*/src/**/*.{test,spec}.{ts,tsx}',
      'packages/*/test/**/*.{test,spec}.{ts,tsx}',
      'apps/cli/test/**/*.{test,spec}.{ts,tsx}',
      'apps/pc/test/**/*.{test,spec}.{ts,tsx}',
    ],
    css: {
      modules: { classNameStrategy: 'non-scoped' },
    },
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**', 'apps/cli/src/**', 'apps/pc/src/**'],
      reporter: ['text-summary', 'html'],
    },
  },
});
