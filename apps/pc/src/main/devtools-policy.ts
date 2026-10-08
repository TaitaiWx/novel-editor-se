import { app } from 'electron';

/**
 * 是否允许打开开发者工具：只在开发模式（未打包）允许。
 * 生产版本菜单、快捷键、IPC 都没有入口，窗口的 webPreferences.devTools 也关闭；
 * 内部排查问题时可用环境变量 NOVEL_EDITOR_ENABLE_DEVTOOLS=1 临时打开（不对用户展示）。
 */
export function devToolsAllowed(
  isPackaged: boolean = isPackagedApp(),
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return !isPackaged || env.NOVEL_EDITOR_ENABLE_DEVTOOLS === '1';
}

function isPackagedApp(): boolean {
  try {
    return Boolean(app?.isPackaged);
  } catch {
    // 单测里部分 electron mock 没有 app
    return false;
  }
}
