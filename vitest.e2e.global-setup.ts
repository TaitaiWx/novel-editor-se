/**
 * E2E globalSetup
 *
 * 1. 清理上一次运行留下的临时目录（novel-editor-tests/e2e）与截图 / 日志（e2e/.artifacts）
 * 2. 通过 Vite build() API 构建 main / preload / renderer（不依赖 shell 串联 `pnpm build`）
 *    - 构建产物比所有源码都新时自动跳过，反复运行 E2E 不重复构建
 *    - NOVEL_EDITOR_E2E_SKIP_BUILD=1 时强制跳过（例如发布流程已用生产配置构建过）
 */
import { existsSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { E2E_ARTIFACT_DIRS, REPO_ROOT, cleanTestArtifacts } from './vitest.shared';

const PC_ROOT = path.join(REPO_ROOT, 'apps/pc');
const DIST_DIR = path.join(PC_ROOT, 'dist');
const DIST_ENTRIES = ['main.mjs', 'preload.js', 'index.html'].map((name) =>
  path.join(DIST_DIR, name)
);

/** 影响构建产物的源码位置 */
const SOURCE_ROOTS = [
  path.join(PC_ROOT, 'src'),
  path.join(PC_ROOT, 'index.html'),
  path.join(PC_ROOT, 'vite.config.ts'),
  ...readdirSync(path.join(REPO_ROOT, 'packages')).map((name) =>
    path.join(REPO_ROOT, 'packages', name, 'src')
  ),
];

/** 递归取目录下最新的修改时间 */
function newestMtime(target: string): number {
  if (!existsSync(target)) return 0;
  const stat = statSync(target);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = stat.mtimeMs;
  for (const entry of readdirSync(target)) {
    if (entry === 'node_modules') continue;
    newest = Math.max(newest, newestMtime(path.join(target, entry)));
  }
  return newest;
}

function isDistUpToDate(): boolean {
  if (!DIST_ENTRIES.every((file) => existsSync(file))) return false;
  const oldestOutput = Math.min(...DIST_ENTRIES.map((file) => statSync(file).mtimeMs));
  const newestSource = Math.max(...SOURCE_ROOTS.map(newestMtime));
  return oldestOutput >= newestSource;
}

type ViteModule = typeof import('vite');

/** vite 只安装在 apps/pc 下，按 apps/pc 的依赖解析 */
async function loadVite(): Promise<ViteModule> {
  const requireFromPc = createRequire(path.join(PC_ROOT, 'package.json'));
  return (await import(pathToFileURL(requireFromPc.resolve('vite')).href)) as ViteModule;
}

/**
 * 与 apps/pc 的 `pnpm build` 等价：main → preload → renderer，三者共用 vite.config.ts。
 * 先构建到临时目录，全部成功后再整体替换 dist：构建过程中 dist 始终完整可用。
 * 以前是先删 dist 再构建，正在运行的应用（pnpm dev、其他 E2E 进程）此时加载页面会得到
 * ERR_FILE_NOT_FOUND，重试用完后进入「启动失败，已进入安全模式」
 */
async function buildApp(): Promise<void> {
  const vite = await loadVite();
  const staging = path.join(PC_ROOT, `.dist-staging-${process.pid}-${Date.now()}`);
  rmSync(staging, { recursive: true, force: true });
  const targets: Array<{ label: string; env: Record<string, string> }> = [
    { label: 'main', env: { VITE_ELECTRON_MAIN: 'true' } },
    { label: 'preload', env: { VITE_PRELOAD: 'true' } },
    { label: 'renderer', env: {} },
  ];
  try {
    for (const target of targets) {
      const previous = { ...process.env };
      Object.assign(process.env, target.env);
      try {
        await vite.build({
          root: PC_ROOT,
          configFile: path.join(PC_ROOT, 'vite.config.ts'),
          logLevel: 'warn',
          build: { outDir: staging, emptyOutDir: false },
        });
      } finally {
        for (const key of Object.keys(target.env)) {
          if (previous[key] === undefined) delete process.env[key];
          else process.env[key] = previous[key];
        }
      }
      console.info(`[e2e] 已构建 ${target.label}`);
    }
    swapDirectory(staging, DIST_DIR);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** 用新构建替换 dist：两次 rename（同一磁盘内为原子操作），dist 缺失的时间只有一瞬 */
export function swapDirectory(source: string, target: string): void {
  const retired = `${target}.retired-${process.pid}-${Date.now()}`;
  if (existsSync(target)) renameSync(target, retired);
  renameSync(source, target);
  rmSync(retired, { recursive: true, force: true });
}

/** `pnpm dev` 的 Vite 开发服务器端口；被占用说明开发模式正在运行 */
const DEV_SERVER_PORT = 5173;

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export default async function setup(): Promise<void> {
  cleanTestArtifacts('e2e', E2E_ARTIFACT_DIRS);

  if (await isPortInUse(DEV_SERVER_PORT)) {
    // pnpm dev 的 nodemon 会在主进程源码变化时重建 apps/pc/dist 并重启 Electron，
    // 与 E2E 争用同一份构建产物和 CPU，容易造成偶发超时
    console.warn(
      '[e2e] 检测到 pnpm dev 正在运行（127.0.0.1:5173）：它会与 E2E 争用 apps/pc/dist 和 CPU，' +
        '可能导致偶发失败。建议先停止 pnpm dev 再运行 E2E。'
    );
  }

  if (process.env.NOVEL_EDITOR_E2E_SKIP_BUILD === '1') {
    console.info('[e2e] NOVEL_EDITOR_E2E_SKIP_BUILD=1，跳过构建');
    return;
  }
  if (isDistUpToDate()) {
    console.info('[e2e] dist 已是最新，跳过构建');
    return;
  }
  await buildApp();
}
