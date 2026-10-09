import { registerWorkspaceHandler } from '../workspace-ipc';
import { guardWindowClose } from '../graceful-shutdown';
/**
 * AI IPC Handlers
 *
 * Handles: AI API requests, analysis report saving, AI assistant window
 * Provider 配置、流式输出见 ./ai-providers.ts；视频任务见 ./video.ts
 */
import { BrowserWindow } from 'electron';
import { devToolsAllowed } from '../devtools-policy';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { assertDirectoryAccess, grantPathAccess } from '../path-access';
import { fileURLToPath } from 'url';
import { getAIService } from '../ai/runtime';
import type { AIRequestPayload } from '../ai/service';
import { establishPortChannel } from '../message-port-bridge';
import { PortChannel } from '../../shared/portChannels';
import { isRendererDevServerEnabled, loadRendererPage } from '../renderer-entry';

const __handler_filename = fileURLToPath(import.meta.url);
const __handler_dirname = path.dirname(__handler_filename);
// After Vite bundling, all code lives in dist/main.mjs,
// so __handler_dirname already points to dist/. No need to go up a level.
const __dist_dir = __handler_dirname;

export type { AIRequestPayload } from '../ai/service';

/**
 * 调用设置中心配置的默认 AI（openai-compatible，一次性补全）。
 * 实现已移到 @novel-editor/ai + main/ai/service.ts（密钥来自 safeStorage）；
 * 签名、默认值与错误文案保持不变，供成长推演、ai-request 等调用方使用。
 */
export function invokeConfiguredAI(payload: AIRequestPayload) {
  return getAIService().invokeConfiguredAI(payload);
}

export function registerAIHandlers(): void {
  registerWorkspaceHandler('ai-request', async (_event, payload: AIRequestPayload) =>
    invokeConfiguredAI(payload)
  );

  registerWorkspaceHandler(
    'save-analysis-file',
    async (_event, folderPath: string, fileName: string, content: string) => {
      try {
        const reportsDir = path.join(folderPath, 'ai-reports');
        await mkdir(reportsDir, { recursive: true });
        const filePath = path.join(reportsDir, fileName);
        await writeFile(filePath, content, 'utf-8');
        return { success: true, filePath };
      } catch (error) {
        throw new Error(`保存分析报告失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    }
  );

  registerWorkspaceHandler('open-ai-assistant-window', async (event, folderPath: string) => {
    if (folderPath) await assertDirectoryAccess(event.sender.id, folderPath);
    const existing = BrowserWindow.getAllWindows().find(
      (w) => !w.isDestroyed() && w.webContents.getURL().includes('mode=ai-assistant')
    );
    if (existing) {
      if (folderPath) await grantPathAccess(existing.webContents, folderPath, true);
      existing.focus();
      return { success: true, reused: true };
    }

    const mainWin = BrowserWindow.getAllWindows()[0];
    const bounds = mainWin?.getBounds();

    const aiWindow = new BrowserWindow({
      width: 860,
      height: 720,
      minWidth: 600,
      minHeight: 500,
      x: bounds ? bounds.x + 60 : undefined,
      y: bounds ? bounds.y + 40 : undefined,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dist_dir, 'preload.js'),
        webSecurity: true,
        devTools: devToolsAllowed(),
      },
      backgroundColor: '#1e1e1e',
      title: 'AI 助手',
      autoHideMenuBar: true,
      frame: false,
    });

    guardWindowClose(aiWindow);
    if (folderPath) await grantPathAccess(aiWindow.webContents, folderPath, true);
    void loadRendererPage(aiWindow, __dist_dir, {
      mode: 'ai-assistant',
      folderPath: folderPath || '',
    });

    aiWindow.once('ready-to-show', () => {
      aiWindow.show();
      // 开发模式下打开 DevTools
      if (isRendererDevServerEnabled() || process.env.NODE_ENV === 'development') {
        aiWindow.webContents.openDevTools();
      }
    });

    aiWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    return { success: true, reused: false };
  });

  // ── 右侧面板独立窗口 ──────────────────────────────────────
  registerWorkspaceHandler(
    'open-right-panel-window',
    async (event, folderPath: string, _content?: string, hasActiveTab?: boolean) => {
      if (folderPath) await assertDirectoryAccess(event.sender.id, folderPath);
      const existing = BrowserWindow.getAllWindows().find(
        (w) => !w.isDestroyed() && w.webContents.getURL().includes('mode=right-panel')
      );
      if (existing) {
        if (folderPath) await grantPathAccess(existing.webContents, folderPath, true);
        // 重新建立 MessagePort 通道（旧端口在窗口 reload 时已失效）
        const mainWin = BrowserWindow.getAllWindows().find(
          (w) =>
            !w.isDestroyed() &&
            !w.webContents.getURL().includes('mode=right-panel') &&
            !w.webContents.getURL().includes('mode=ai-assistant')
        );
        if (mainWin) {
          establishPortChannel(mainWin, existing, PortChannel.ContentSync);
          establishPortChannel(mainWin, existing, PortChannel.CrdtOps);
        }
        existing.focus();
        return { success: true, reused: true };
      }

      const mainWin =
        BrowserWindow.getAllWindows().find(
          (w) =>
            !w.isDestroyed() &&
            !w.webContents.getURL().includes('mode=right-panel') &&
            !w.webContents.getURL().includes('mode=ai-assistant')
        ) ?? BrowserWindow.getAllWindows()[0];
      const bounds = mainWin?.getBounds();

      const panelWindow = new BrowserWindow({
        width: 520,
        height: 720,
        minWidth: 380,
        minHeight: 500,
        x: bounds ? bounds.x + bounds.width - 540 : undefined,
        y: bounds ? bounds.y + 40 : undefined,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dist_dir, 'preload.js'),
          webSecurity: true,
          devTools: devToolsAllowed(),
        },
        backgroundColor: '#1e1e1e',
        title: '大纲',
        autoHideMenuBar: true,
        frame: false,
      });

      guardWindowClose(panelWindow);
      if (folderPath) await grantPathAccess(panelWindow.webContents, folderPath, true);
      void loadRendererPage(panelWindow, __dist_dir, {
        mode: 'right-panel',
        folderPath: folderPath || '',
        hasActiveTab: hasActiveTab ? '1' : '0',
      });

      panelWindow.once('ready-to-show', () => {
        panelWindow.show();
        // 建立 MessagePort 直连通道：主窗口 ↔ 面板窗口
        // 后续内容同步全部走 MessagePort，不再经过 main process
        if (mainWin) {
          establishPortChannel(mainWin, panelWindow, PortChannel.ContentSync);
          establishPortChannel(mainWin, panelWindow, PortChannel.CrdtOps);
        }
        if (isRendererDevServerEnabled() || process.env.NODE_ENV === 'development') {
          panelWindow.webContents.openDevTools();
        }
      });

      panelWindow.on('closed', () => {
        // 通知主窗口恢复三栏布局
        const mw = BrowserWindow.getAllWindows().find(
          (w) =>
            !w.isDestroyed() &&
            !w.webContents.getURL().includes('mode=right-panel') &&
            !w.webContents.getURL().includes('mode=ai-assistant')
        );
        if (mw) {
          mw.webContents.send('right-panel-window-closed');
        }
      });

      panelWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

      return { success: true, reused: false };
    }
  );

  // AI 独立窗口请求主窗口打开文件
  registerWorkspaceHandler('ai-window-request-open-file', (_event, filePath: string) => {
    const mainWin = BrowserWindow.getAllWindows().find(
      (w) => !w.isDestroyed() && !w.webContents.getURL().includes('mode=ai-assistant')
    );
    if (mainWin) {
      mainWin.focus();
      mainWin.webContents.send('open-file-from-ai', filePath);
    }
    return { success: true };
  });

  // AI 独立窗口请求主窗口打开设置
  registerWorkspaceHandler('ai-window-request-open-settings', () => {
    const mainWin = BrowserWindow.getAllWindows().find(
      (w) => !w.isDestroyed() && !w.webContents.getURL().includes('mode=ai-assistant')
    );
    if (mainWin) {
      mainWin.focus();
      mainWin.webContents.send('open-settings-from-ai');
    }
    return { success: true };
  });

  // AI 独立窗口提交修复到主窗口（展示 diff 确认）
  registerWorkspaceHandler(
    'ai-window-apply-fix',
    (
      _event,
      payload: {
        filePath: string;
        original: string;
        modified: string;
        explanation?: string;
        proposedFullContent?: string;
        targetLine?: number;
      }
    ) => {
      const mainWin = BrowserWindow.getAllWindows().find(
        (w) => !w.isDestroyed() && !w.webContents.getURL().includes('mode=ai-assistant')
      );
      if (mainWin) {
        mainWin.focus();
        mainWin.webContents.send('ai-apply-fix-request', payload);
      }
      return { success: true };
    }
  );

  // 保存/读取 AI 会话状态（用于窗口间状态同步）
  registerWorkspaceHandler('ai-save-session-state', (_event, state: string) => {
    if (state === '__read__') {
      // 读取模式：返回当前保存的状态
      const saved = (global as Record<string, unknown>).__aiSessionState as string | undefined;
      return { success: true, state: saved || null };
    }
    // 写入模式：存储在主进程内存中
    (global as Record<string, unknown>).__aiSessionState = state;
    return { success: true };
  });
}
