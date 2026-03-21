import React, { useEffect, useState, useCallback } from 'react';
import { AIView } from './components/RightPanel/AIView';
import type { AISessionState } from './components/RightPanel/AIView';
import { AiConfigProvider } from './components/RightPanel/useAiConfig';
import WindowControls from './components/WindowControls';

/**
 * AI 助手独立窗口模式 —— 通过 ?mode=ai-assistant&folderPath=... 参数启动。
 * 渲染一个全屏的 AIView，无需 TitleBar、FilePanel 等主应用组件。
 *
 * 数据驱动设计：
 * - 从主进程内存读取 AI 会话快照（由主窗口 AIAssistantDialog 保存）
 * - 修复操作通过 IPC 委托给主窗口展示 diff 确认
 */
export const AIStandaloneApp: React.FC = () => {
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [dbReady, setDbReady] = useState(false);
  const [initialState, setInitialState] = useState<AISessionState | undefined>(undefined);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fp = params.get('folderPath') || null;
    setFolderPath(fp);

    const init = async () => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return;
      let preferredPath: string | null = null;
      try {
        await ipc.invoke('db-init-default');
        if (fp) {
          const dbDir = `${fp}/.novel-editor`;
          await ipc.invoke('db-init', dbDir);
        }
      } catch {
        // 可能已初始化
      }

      // 从主进程内存恢复 AI 会话状态
      try {
        const raw = (await ipc.invoke('ai-save-session-state', '__read__')) as {
          success: boolean;
          state?: string;
        };
        if (raw?.state) {
          const parsed = JSON.parse(raw.state) as AISessionState;
          setInitialState(parsed);
          preferredPath = parsed.activeFilePath || parsed.snapshotFilePath || null;
          if (preferredPath) setActiveFilePath(preferredPath);
        }
      } catch {
        // 无会话状态可恢复
      }

      setDbReady(true);

      // 读取正文内容（如果有 folderPath）
      if (fp) {
        try {
          const novel = (await ipc.invoke('db-novel-get-by-folder', fp)) as {
            id: number;
          } | null;
          if (novel) {
            const tree = (await ipc.invoke('refresh-folder', fp)) as {
              files: Array<{ name: string; path: string; type: string }>;
            };
            const textFiles = tree.files?.filter(
              (f) => f.type === 'file' && (/\.txt$/i.test(f.name) || /\.md$/i.test(f.name))
            );
            const target =
              preferredPath || (textFiles && textFiles.length > 0 ? textFiles[0].path : null);
            if (target) {
              const raw = (await ipc.invoke('read-file', target)) as string;
              setContent(raw || '');
              setActiveFilePath(target);
            }
          }
        } catch {
          // 静默失败
        }
      }
    };
    void init();
  }, []);

  // 所有 hooks 必须在条件返回之前调用（React Rules of Hooks）
  const handleDelegateFix = useCallback(
    (payload: {
      filePath: string;
      original: string;
      modified: string;
      explanation?: string;
      proposedFullContent?: string;
      targetLine?: number;
    }) => {
      const ipc = window.electron?.ipcRenderer;
      if (ipc) {
        void ipc.invoke('ai-window-apply-fix', payload);
      }
    },
    []
  );

  if (!dbReady) {
    return (
      <div style={{ padding: 32, color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>正在初始化...</div>
    );
  }

  const handleApplyFix = (_newContent: string, _targetPath?: string) => {
    // 独立窗口：不在本地写盘，静默处理（实际修复通过 handleOpenFile 走 diff 流程）
    return;
  };

  const handleOpenFile = (filePath: string) => {
    setActiveFilePath(filePath);
    const ipc = window.electron?.ipcRenderer;
    if (ipc && filePath) {
      void ipc.invoke('read-file', filePath).then((raw) => {
        if (typeof raw === 'string') setContent(raw);
      });
    }
    // 通知主窗口打开文件
    if (ipc && filePath) {
      void ipc.invoke('ai-window-request-open-file', filePath);
    }
  };

  const handleOpenSettings = () => {
    const ipc = window.electron?.ipcRenderer;
    if (ipc) {
      void ipc.invoke('ai-window-request-open-settings');
    }
  };

  return (
    <AiConfigProvider>
      <div
        style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#1e1e1e' }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 32,
            borderBottom: '1px solid #2d2d2d',
            flexShrink: 0,
            // @ts-expect-error Electron-specific CSS property
            WebkitAppRegion: 'drag',
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--ui-fg-primary)',
              padding: '0 12px',
              // @ts-expect-error Electron-specific CSS property
              WebkitAppRegion: 'no-drag',
            }}
          >
            AI 助手
          </span>
          <div style={{ flex: 1 }} />
          <WindowControls />
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
          <AIView
            folderPath={folderPath}
            content={content}
            filePath={
              activeFilePath ||
              initialState?.activeFilePath ||
              initialState?.snapshotFilePath ||
              null
            }
            onApplyFix={handleApplyFix}
            onOpenFile={handleOpenFile}
            onOpenSettings={handleOpenSettings}
            initialState={initialState}
            skipDiskWrite
            onDelegateFix={handleDelegateFix}
          />
        </div>
      </div>
    </AiConfigProvider>
  );
};
