import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const isElectronMain = process.env.VITE_ELECTRON_MAIN === 'true';
  const isPreload = process.env.VITE_PRELOAD === 'true';

  if (isPreload) {
    // Preload 脚本构建配置 - 使用 CommonJS 格式
    return {
      build: {
        outDir: './dist',
        emptyOutDir: false,
        lib: {
          entry: resolve(__dirname, 'src/main/preload.ts'),
          formats: ['cjs'],
          fileName: () => 'preload.js',
        },
        rollupOptions: {
          external: ['electron'],
          output: {
            format: 'cjs',
            entryFileNames: 'preload.js',
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

  if (isElectronMain) {
    // 主进程构建配置
    return {
      build: {
        outDir: './dist',
        emptyOutDir: false,
        lib: {
          entry: resolve(__dirname, 'src/main/index.ts'),
          formats: ['es'],
          fileName: () => 'main.mjs',
        },
        rollupOptions: {
          external: [
            'electron',
            'crypto',
            'fs',
            'path',
            'url',
            'os',
            'fs/promises',
            'directory-tree',
            'fs-extra',
            'electron-updater',
            'better-sqlite3',
            /^node:/,
          ],
          output: {
            format: 'es',
            entryFileNames: 'main.mjs',
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
          manualChunks: (id) => {
            if (id.includes('pdfjs-dist')) {
              return 'vendor-pdf';
            }

            if (id.includes('@codemirror/merge')) {
              return 'vendor-diff';
            }

            if (id.includes('@codemirror/lang-') || id.includes('@lezer/')) {
              return 'vendor-editor-lang';
            }

            if (
              id.includes('@codemirror/state') ||
              id.includes('@codemirror/view') ||
              id.includes('@codemirror/commands') ||
              id.includes('@codemirror/search') ||
              id.includes('@codemirror/language')
            ) {
              return 'vendor-editor-core';
            }

            if (id.includes('@codemirror')) {
              return 'vendor-editor-extra';
            }

            if (id.includes('react-icons')) {
              return 'vendor-icons';
            }

            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
              return 'vendor-react';
            }
          },
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
