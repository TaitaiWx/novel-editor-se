/**
 * AI IPC Handlers
 *
 * Handles: AI API requests, analysis report saving, AI assistant window
 */
import { ipcMain, BrowserWindow } from 'electron';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { settingsOps } from '@novel-editor/store';
import { establishPortChannel } from '../message-port-bridge';
import { PortChannel } from '../../shared/portChannels';
import { isRendererDevServerEnabled, loadRendererPage } from '../renderer-entry';

const __handler_filename = fileURLToPath(import.meta.url);
const __handler_dirname = path.dirname(__handler_filename);
// After Vite bundling, all code lives in dist/main.mjs,
// so __handler_dirname already points to dist/. No need to go up a level.
const __dist_dir = __handler_dirname;

interface AIRequestPayload {
  prompt: string;
  systemPrompt?: string;
  context?: string;
  maxTokens?: number;
  temperature?: number;
}

interface PersistedAISettings {
  enabled?: boolean;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
}

async function invokeConfiguredAI(payload: AIRequestPayload) {
  const rawSettings = settingsOps.get('novel-editor:settings-center');
  const parsed = rawSettings ? (JSON.parse(rawSettings) as { ai?: PersistedAISettings }) : {};
  const ai = parsed.ai || {};

  if (!ai.enabled) {
    return { ok: false, error: 'AI 功能未启用，请先在设置中心开启' };
  }
  if (!ai.apiKey?.trim()) {
    return { ok: false, error: '未配置 AI Key，请先在设置中心填写 API Key' };
  }
  if (!ai.baseUrl?.trim() || !ai.model?.trim()) {
    return { ok: false, error: 'AI Base URL 或模型未配置完整' };
  }

  const endpoint = `${ai.baseUrl.replace(/\/$/, '')}/chat/completions`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ai.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: ai.model.trim(),
        temperature:
          typeof payload.temperature === 'number'
            ? payload.temperature
            : typeof ai.temperature === 'number'
              ? ai.temperature
              : 1.3,
        max_tokens:
          typeof payload.maxTokens === 'number'
            ? payload.maxTokens
            : typeof ai.maxTokens === 'number'
              ? ai.maxTokens
              : 8192,
        messages: [
          ...(payload.systemPrompt ? [{ role: 'system', content: payload.systemPrompt }] : []),
          {
            role: 'user',
            content: payload.context
              ? `项目上下文:\n${payload.context}\n\n用户请求:\n${payload.prompt}`
              : payload.prompt,
          },
        ],
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `无法连接 AI 服务 (${endpoint}): ${msg}` };
  }

  let json: {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  };
  try {
    json = (await response.json()) as typeof json;
  } catch {
    return { ok: false, error: `AI 服务返回了无效的响应 (HTTP ${response.status})` };
  }

  if (!response.ok) {
    return { ok: false, error: json.error?.message || `AI 请求失败 (HTTP ${response.status})` };
  }

  const content = json.choices?.[0]?.message?.content;
  const text = Array.isArray(content)
    ? content.map((item) => item.text || '').join('')
    : content || '';

  return { ok: true, text };
}

export function registerAIHandlers(): void {
  ipcMain.handle('ai-request', async (_event, payload: AIRequestPayload) =>
    invokeConfiguredAI(payload)
  );

  ipcMain.handle(
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

  ipcMain.handle('open-ai-assistant-window', (_event, folderPath: string) => {
    const existing = BrowserWindow.getAllWindows().find(
      (w) => !w.isDestroyed() && w.webContents.getURL().includes('mode=ai-assistant')
    );
    if (existing) {
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
      },
      backgroundColor: '#1e1e1e',
      title: 'AI 助手',
      autoHideMenuBar: true,
      frame: false,
    });

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
  ipcMain.handle(
    'open-right-panel-window',
    (_event, folderPath: string, _content?: string, hasActiveTab?: boolean) => {
      const existing = BrowserWindow.getAllWindows().find(
        (w) => !w.isDestroyed() && w.webContents.getURL().includes('mode=right-panel')
      );
      if (existing) {
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
        },
        backgroundColor: '#1e1e1e',
        title: '故事面板',
        autoHideMenuBar: true,
        frame: false,
      });

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
  ipcMain.handle('ai-window-request-open-file', (_event, filePath: string) => {
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
  ipcMain.handle('ai-window-request-open-settings', () => {
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
  ipcMain.handle(
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
  ipcMain.handle('ai-save-session-state', (_event, state: string) => {
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
