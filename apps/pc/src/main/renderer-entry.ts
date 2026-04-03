import { BrowserWindow } from 'electron';
import { join } from 'path';

const devServerUrl = process.env.VITE_DEV_SERVER_URL?.trim() || '';

function buildRendererUrl(query?: Record<string, string>) {
  const url = new URL(devServerUrl);

  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  return url.toString();
}

export function isRendererDevServerEnabled() {
  return devServerUrl.length > 0;
}

export function getRendererIndexPath(distDir: string) {
  return join(distDir, 'index.html');
}

export function loadRendererPage(
  window: BrowserWindow,
  distDir: string,
  query?: Record<string, string>
) {
  // 开发态优先加载 Vite dev server，避免构建产物热更新后 chunk 名漂移导致运行时找不到文件。
  if (isRendererDevServerEnabled()) {
    return window.loadURL(buildRendererUrl(query));
  }

  return window.loadFile(getRendererIndexPath(distDir), query ? { query } : undefined);
}
