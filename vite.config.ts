import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const isElectronMain = process.env.VITE_ELECTRON_MAIN === 'true';

  if (isElectronMain) {
    // 主进程和预加载脚本构建配置
    return {
      build: {
        outDir: './dist',
        emptyOutDir: false,
        lib: {
          entry: {
            main: resolve(__dirname, 'src/main/index.ts'),
            preload: resolve(__dirname, 'src/main/preload.ts'),
          },
          formats: ['es'],
        },
        rollupOptions: {
          external: [
            'electron',
            'path',
            'url',
            'fs/promises',
            'directory-tree',
            'fs-extra',
            /^node:/,
          ],
          output: {
            entryFileNames: '[name].mjs',
          },
        },
      },
      resolve: {
        alias: {
          '@': resolve(__dirname, 'src'),
        },
      },
    };
  }

  // 渲染进程构建配置
  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      hmr: true,
    },
    build: {
      outDir: './dist',
      emptyOutDir: false,
      sourcemap: mode === 'development',
      minify: mode === 'production',
      rollupOptions: {
        input: resolve(__dirname, 'index.html'),
        output: {
          entryFileNames: 'render.js',
          chunkFileNames: '[name].[hash].js',
          assetFileNames: (assetInfo) => {
            const name = assetInfo.name || '';
            if (name.endsWith('.css')) {
              return '[name].[hash].css';
            }
            return '[name].[hash].[ext]';
          },
        },
      },
    },
    base: './',
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
  };
});
