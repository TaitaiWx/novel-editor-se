import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { builtinModules } from 'node:module';
import { copyFileSync, mkdirSync } from 'node:fs';

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
      plugins: [
        {
          name: 'copy-splash',
          writeBundle() {
            // 将 splash 窗口的静态文件复制到 dist/splash
            const srcDir = resolve(__dirname, 'src/main/static/splash');
            const outDir = resolve(__dirname, 'dist/splash');
            mkdirSync(outDir, { recursive: true });
            copyFileSync(resolve(srcDir, 'splash.html'), resolve(outDir, 'splash.html'));
            copyFileSync(resolve(srcDir, 'splash.css'), resolve(outDir, 'splash.css'));
          },
        },
      ],
      build: {
        outDir: './dist',
        emptyOutDir: false,
        lib: {
          entry: resolve(__dirname, 'src/main/index.ts'),
          formats: ['es'],
          fileName: () => 'main.mjs',
        },
        rollupOptions: {
          external: (id: string) => {
            if (id === 'electron' || id === 'better-sqlite3') return true;
            // bindings / file-uri-to-path 是 better-sqlite3 的运行时依赖，一并 external
            if (id === 'bindings' || id === 'file-uri-to-path') return true;
            // mammoth 必须 external：Vite 默认打包浏览器入口，其内部 JSZip 不兼容 Node Buffer
            if (id === 'mammoth') return true;
            // jszip 在主进程中直接使用，需要 external
            if (id === 'jszip') return true;
            // exceljs 依赖 fs.constants 等 Node API，必须 external
            if (id === 'exceljs') return true;
            if (id.startsWith('node:')) return true;
            return builtinModules.includes(id.split('/')[0]);
          },
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

            if (id.includes('@codemirror') || id.includes('@lezer/')) {
              return 'vendor-editor';
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
