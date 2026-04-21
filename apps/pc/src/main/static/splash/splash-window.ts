import { BrowserWindow } from 'electron';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let splashWindow: BrowserWindow | null = null;
let splashReady = false;
/** 在 splash 渲染完成前缓存待写入的文案，渲染完成后立即同步 */
let pendingHint: string | null = null;

export function createSplashWindow(): BrowserWindow {
  splashWindow = new BrowserWindow({
    width: 320,
    height: 240,
    frame: false,
    transparent: false,
    resizable: false,
    movable: false,
    center: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#1e1e1e',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  splashReady = false;
  pendingHint = null;

  splashWindow.loadFile(join(__dirname, 'splash', 'splash.html'));
  splashWindow.once('ready-to-show', () => {
    splashWindow?.show();
  });
  splashWindow.webContents.once('did-finish-load', () => {
    splashReady = true;
    if (pendingHint !== null) {
      const hint = pendingHint;
      pendingHint = null;
      void writeSplashHint(hint);
    }
  });
  splashWindow.on('closed', () => {
    splashWindow = null;
    splashReady = false;
    pendingHint = null;
  });

  return splashWindow;
}

/**
 * 更新 splash 副提示文案。低配机启动较慢时，给用户阶段性反馈，避免“一直转圈不动”的错觉
 */
export function setSplashHint(text: string): void {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  if (!splashReady) {
    pendingHint = text;
    return;
  }
  void writeSplashHint(text);
}

async function writeSplashHint(text: string): Promise<void> {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  // 通过字面量字符串注入，避免 XSS：先 JSON.stringify 转义
  const safe = JSON.stringify(text);
  try {
    await splashWindow.webContents.executeJavaScript(
      `(()=>{const el=document.getElementById('splash-hint');if(el){el.textContent=${safe};}})();`,
      true
    );
  } catch {
    // splash 已关闭或上下文已销毁，忽略
  }
}

export function closeSplashWindow(): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
  splashReady = false;
  pendingHint = null;
}
