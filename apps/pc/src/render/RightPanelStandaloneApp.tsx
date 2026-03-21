import React, { useEffect, useState } from 'react';
import RightPanel from './components/RightPanel';
import WindowControls from './components/WindowControls';

/**
 * 右侧面板独立窗口模式 —— 通过 ?mode=right-panel&folderPath=... 参数启动。
 * 渲染一个全屏的 RightPanel（故事线 / 人物 / 设定），无侧边栏和编辑器。
 */
export const RightPanelStandaloneApp: React.FC = () => {
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fp = params.get('folderPath') || null;
    setFolderPath(fp);

    const init = async () => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) return;

      try {
        await ipc.invoke('db-init-default');
        if (fp) {
          const dbDir = `${fp}/.novel-editor`;
          await ipc.invoke('db-init', dbDir);
        }
      } catch {
        // 可能已初始化
      }

      setDbReady(true);

      // 读取正文内容
      if (fp) {
        try {
          const novel = (await ipc.invoke('db-novel-get-by-folder', fp)) as { id: number } | null;
          if (novel) {
            const tree = (await ipc.invoke('refresh-folder', fp)) as {
              files: Array<{ name: string; path: string; type: string }>;
            };
            const textFiles = tree.files?.filter(
              (f) => f.type === 'file' && (/\.txt$/i.test(f.name) || /\.md$/i.test(f.name))
            );
            if (textFiles && textFiles.length > 0) {
              const raw = (await ipc.invoke('read-file', textFiles[0].path)) as string;
              setContent(raw || '');
            }
          }
        } catch {
          // 静默失败
        }
      }
    };
    void init();
  }, []);

  if (!dbReady) {
    return (
      <div style={{ padding: 32, color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>正在初始化...</div>
    );
  }

  return (
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
          故事面板
        </span>
        <div style={{ flex: 1 }} />
        <WindowControls />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <RightPanel
          content={content}
          collapsed={false}
          onToggle={() => {
            // 独立窗口中不支持折叠，直接关闭窗口
            window.electron?.ipcRenderer?.invoke('window-close');
          }}
          folderPath={folderPath}
          dbReady={dbReady}
        />
      </div>
    </div>
  );
};
