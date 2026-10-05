import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { buildTmpEnv } from './vitest.shared';

// 轻量测试方案：默认 node 环境；需要 DOM 的用例在文件头加
// `// @vitest-environment happy-dom`，配合 @testing-library/react 测组件与 hooks。
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'apps/pc/src'),
    },
  },
  test: {
    // 运行前自动清理临时目录（覆盖率报告由 coverage.clean 清空）；用例的临时文件统一落在 novel-editor-tests/ut 下
    globalSetup: ['./vitest.global-setup.ts'],
    env: buildTmpEnv('ut'),
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
    // 覆盖率默认开启：每次 pnpm test:ut 都会输出覆盖率摘要与 HTML 报告（coverage/）
    coverage: {
      enabled: true,
      provider: 'v8',
      reportsDirectory: './coverage',
      // 每次运行前自动清空上一次的覆盖率报告
      clean: true,
      // 只统计源码（ts/tsx），排除 html/css 等静态资源与纯类型声明
      include: [
        'packages/*/src/**/*.{ts,tsx}',
        'apps/cli/src/**/*.{ts,tsx}',
        'apps/pc/src/**/*.{ts,tsx}',
      ],
      exclude: ['**/*.d.ts'],
      reporter: ['text-summary', 'html'],
    },
  },
});
