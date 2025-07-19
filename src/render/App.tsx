import React, { useState, useCallback } from 'react';
import type { FileNode } from '../types/File';
import TitleBar from './components/TitleBar';
import FilePanel from './components/FilePanel';
import OutlinePanel from './components/OutlinePanel';
import ContentPanel from './components/ContentPanel';
import StatusBarV2 from './components/StatusBar/StatusBarV2';
import InputDialog from './components/InputDialog';
import { GlobalPreviewWindow } from './components/DocumentPreview';
import styles from './App.module.scss';
import { initKeyboardShortcuts } from './components/ShortcutsHelp/shortcuts/initKeyboardShortcuts';
import { cleanupKeyboardShortcuts } from './components/ShortcutsHelp/shortcuts/cleanupKeyboardShortcuts';
import { useFileEventEmitter } from './hooks/useFileEvents';

const App: React.FC = () => {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [documentContent, setDocumentContent] = useState<string>('');
  const [currentLine, setCurrentLine] = useState<number>(1);
  const [isOutlineVisible, setIsOutlineVisible] = useState<boolean>(true); // 默认开启
  const [cursorPosition, setCursorPosition] = useState<{ line: number; column: number } | null>(
    null
  );

  // 输入对话框状态
  const [inputDialog, setInputDialog] = useState<{
    isOpen: boolean;
    title: string;
    placeholder: string;
    onConfirm: (value: string) => void;
  } | null>(null);

  // 文件事件发射器
  const { emitFileSelected } = useFileEventEmitter();

  // 组件挂载时加载默认路径和初始化快捷键
  React.useEffect(() => {
    // 初始化键盘快捷键
    initKeyboardShortcuts();

    // 监听大纲切换快捷键 Ctrl+Alt+Q
    if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.on('toggle-outline', () => {
        setIsOutlineVisible((prev) => !prev);
      });
    }

    // 添加全局快捷键监听
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key === 'q') {
        e.preventDefault();
        setIsOutlineVisible((prev) => !prev);
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    // 延迟一点时间确保 Electron 完全初始化
    const timer = setTimeout(() => {
      loadDefaultPath();
    }, 100);

    // 清理函数
    return () => {
      clearTimeout(timer);
      cleanupKeyboardShortcuts();
      document.removeEventListener('keydown', handleKeyDown);
      if (window.electron?.ipcRenderer) {
        window.electron.ipcRenderer.removeAllListeners('toggle-outline');
      }
    };
  }, []);

  const loadDefaultPath = async () => {
    setIsLoading(true);
    try {
      // 检查 window.electron 是否可用
      if (!window.electron?.ipcRenderer) {
        console.warn('Electron IPC not available, skipping default path load');
        return;
      }

      const defaultPath = await window.electron.ipcRenderer.invoke('get-default-data-path');
      const result = await window.electron.ipcRenderer.invoke('refresh-folder', defaultPath);
      if (result) {
        setFolderPath(result.path);
        setFiles(result.files);
        setSelectedFile(null);
      }
    } catch (error) {
      console.error('Error loading default path:', error);
      // 如果默认路径加载失败，不阻止用户手动选择文件夹
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenLocal = async () => {
    setIsLoading(true);
    try {
      if (!window.electron?.ipcRenderer) {
        alert('Electron IPC 不可用');
        return;
      }

      const result = await window.electron.ipcRenderer.invoke('open-local-folder');
      if (result) {
        setFolderPath(result.path);
        setFiles(result.files);
        setSelectedFile(null); // 清除之前选择的文件
      }
    } catch (error) {
      console.error('Error opening folder:', error);
      alert(`打开文件夹失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshCurrentFolder = async () => {
    if (!folderPath) return;

    setIsLoading(true);
    try {
      if (!window.electron?.ipcRenderer) {
        alert('Electron IPC 不可用');
        return;
      }

      const result = await window.electron.ipcRenderer.invoke('refresh-folder', folderPath);
      if (result) {
        setFiles(result.files);
      }
    } catch (error) {
      console.error('Error refreshing folder:', error);
      alert(`刷新文件夹失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateFile = async () => {
    if (!folderPath) return;

    if (!window.electron?.ipcRenderer) {
      alert('Electron IPC 不可用');
      return;
    }

    setInputDialog({
      isOpen: true,
      title: '创建新文件',
      placeholder: '请输入文件名（如：note.txt）',
      onConfirm: async (fileName: string) => {
        try {
          await window.electron.ipcRenderer.invoke('create-file', folderPath, fileName);
          await refreshCurrentFolder();
        } catch (error) {
          alert(`创建文件失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
        setInputDialog(null);
      },
    });
  };

  const handleCreateDirectory = async () => {
    if (!folderPath) return;

    if (!window.electron?.ipcRenderer) {
      alert('Electron IPC 不可用');
      return;
    }

    setInputDialog({
      isOpen: true,
      title: '创建新目录',
      placeholder: '请输入目录名',
      onConfirm: async (dirName: string) => {
        try {
          await window.electron.ipcRenderer.invoke('create-directory', folderPath, dirName);
          await refreshCurrentFolder();
        } catch (error) {
          alert(`创建目录失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
        setInputDialog(null);
      },
    });
  };

  const handleFileSelect = async (filePath: string) => {
    try {
      setSelectedFile(filePath);
      setCurrentLine(1);

      // 立即读取文件内容以更新大纲
      if (window.electron?.ipcRenderer) {
        try {
          const content = await window.electron.ipcRenderer.invoke('read-file', filePath);
          setDocumentContent(content);
        } catch (error) {
          console.error('Error reading file for outline:', error);
          setDocumentContent('');
        }
      }

      // 发射文件选择事件
      emitFileSelected(filePath);
    } catch (error) {
      console.error('Error selecting file:', error);
    }
  };

  const handleNavigateToLine = (lineNumber: number) => {
    setCurrentLine(lineNumber);

    // 滚动到指定行的逻辑
    setTimeout(() => {
      const textarea = document.querySelector('textarea');
      if (textarea) {
        const lines = textarea.value.split('\n');
        let position = 0;

        // 计算到目标行的字符位置
        for (let i = 0; i < lineNumber - 1 && i < lines.length; i++) {
          position += lines[i].length + 1; // +1 for newline
        }

        // 设置光标位置
        textarea.setSelectionRange(position, position);
        textarea.focus();

        // 滚动到可见位置
        const lineHeight = 24; // 估计的行高
        const scrollTop = (lineNumber - 1) * lineHeight;
        textarea.scrollTop = Math.max(0, scrollTop - 100); // 留一些边距
      }
    }, 100);
  };

  const handleContentChange = useCallback((content: string) => {
    setDocumentContent(content);
  }, []);

  return (
    <div className={`${styles.app} ${isOutlineVisible ? styles.withOutline : ''}`}>
      {/* 自定义标题栏 */}
      <TitleBar title="小说编辑器" />

      <div className={styles.appMain}>
        {/* 左侧文件面板 */}
        <div className={styles.leftPanel}>
          <FilePanel
            files={files}
            selectedFile={selectedFile}
            folderPath={folderPath}
            isLoading={isLoading}
            onFileSelect={handleFileSelect}
            onCreateFile={handleCreateFile}
            onCreateDirectory={handleCreateDirectory}
            onRefresh={refreshCurrentFolder}
            onOpenFolder={handleOpenLocal}
          />
        </div>

        {/* 中间内容面板 */}
        <div className={styles.centerPanel}>
          <ContentPanel
            selectedFile={selectedFile}
            onContentChange={handleContentChange}
            onCursorPositionChange={setCursorPosition}
            currentLine={currentLine}
          />
        </div>

        {/* 右侧大纲面板 */}
        {isOutlineVisible && (
          <div className={styles.rightPanel}>
            <OutlinePanel
              selectedFile={selectedFile}
              documentContent={documentContent}
              currentLine={currentLine}
              onNavigateToLine={handleNavigateToLine}
              isVisible={isOutlineVisible}
              onToggleVisibility={() => setIsOutlineVisible(false)}
            />
          </div>
        )}
      </div>

      {/* 状态栏 - 应用级别的统计信息 */}
      <StatusBarV2
        selectedFile={selectedFile}
        content={documentContent}
        cursorPosition={cursorPosition || undefined}
      />

      {/* 全局预览窗 */}
      <GlobalPreviewWindow />

      {/* 输入对话框 */}
      {inputDialog && (
        <InputDialog
          isOpen={inputDialog.isOpen}
          title={inputDialog.title}
          placeholder={inputDialog.placeholder}
          onConfirm={inputDialog.onConfirm}
          onCancel={() => setInputDialog(null)}
        />
      )}
    </div>
  );
};

export default App;
