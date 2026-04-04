import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { builtinModules } from 'node:module';
import { copyFileSync, mkdirSync } from 'node:fs';

const MAIN_RUNTIME_EXTERNAL_PACKAGES = new Set([
  'electron',
  'better-sqlite3',
  'bindings',
  'file-uri-to-path',
]);

function getPackageRoot(id: string) {
  if (id.startsWith('@')) {
    const [scope, name] = id.split('/');
    return scope && name ? `${scope}/${name}` : id;
  }
  return id.split('/')[0];
}

function isKnownSafeEvalWarning(warning: { code?: string; id?: string; message?: string }) {
  return (
    warning.code === 'EVAL' &&
    typeof warning.id === 'string' &&
    warning.id.includes('bluebird/js/release/util.js')
  );
}

export default defineConfig(({ mode }) => {
  const isElectronMain = process.env.VITE_ELECTRON_MAIN === 'true';
  const isPreload = process.env.VITE_PRELOAD === 'true';

  if (isPreload) {
    // Preload 脚本构建配置 - 使用 CommonJS 格式
    return {
      build: {
        outDir: './dist',
        emptyOutDir: false,
        // Preload 不清空 dist，main 已经清过了
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
            const packageRoot = getPackageRoot(id);
            if (MAIN_RUNTIME_EXTERNAL_PACKAGES.has(packageRoot)) return true;
            if (id.startsWith('node:')) return true;
            return builtinModules.includes(packageRoot);
          },
          onwarn(warning, warn) {
            // bluebird 的内部 util 仍使用 eval；这是上游实现细节，
            // 不影响我们当前 Electron 主进程构建，开发期不必反复提示。
            if (isKnownSafeEvalWarning(warning)) {
              return;
            }
            warn(warning);
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
      watch: {
        // main/preload 构建会持续写 dist；这些都是生成物，不应触发 renderer 热刷新。
        ignored: ['**/dist/**', '**/build/**'],
      },
    },
    build: {
      outDir: './dist',
      emptyOutDir: false,
      // Renderer 不清空 dist（main 已经清过了），避免删除 main.mjs 和 preload.js
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
