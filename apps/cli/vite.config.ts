/**
 * CLI 构建配置：打包为单文件 ESM（dist/index.mjs），内联所有 workspace 包与第三方依赖，
 * 只保留 Node 内置模块为外部依赖，因此安装后无需额外 node_modules 即可运行。
 */
import { chmodSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as {
  version: string;
};

export default defineConfig({
  plugins: [
    {
      name: 'ne-cli-executable',
      // 产物需要可执行权限，便于直接通过 shebang 运行
      writeBundle(options) {
        chmodSync(resolve(options.dir ?? 'dist', 'index.mjs'), 0o755);
      },
    },
  ],
  define: {
    __NE_CLI_VERSION__: JSON.stringify(pkg.version),
  },
  ssr: {
    // 把所有依赖打进 bundle
    noExternal: true,
  },
  build: {
    ssr: resolve(__dirname, 'src/index.ts'),
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
      output: {
        format: 'es',
        entryFileNames: 'index.mjs',
        banner: '#!/usr/bin/env node',
        inlineDynamicImports: true,
      },
    },
  },
});
