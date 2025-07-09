import React, { useState } from 'react';
import type { FileNode } from './types';
import TitleBar from './components/TitleBar';
import FilePanel from './components/FilePanel';
import ContentPanel from './components/ContentPanel';
import styles from './App.module.scss';
import { initKeyboardShortcuts } from './components/ShortcutsHelp/shortcuts/initKeyboardShortcuts';
import { cleanupKeyboardShortcuts } from './components/ShortcutsHelp/shortcuts/cleanupKeyboardShortcuts';

const App: React.FC = () => {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // 组件挂载时加载默认路径和初始化快捷键
  React.useEffect(() => {
    // 初始化键盘快捷键
    initKeyboardShortcuts();

    // 延迟一点时间确保 Electron 完全初始化
    const timer = setTimeout(() => {
      loadDefaultPath();
    }, 100);

    // 清理函数
    return () => {
      clearTimeout(timer);
      cleanupKeyboardShortcuts();
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

    const fileName = prompt('请输入文件名（如：note.txt）：');
    if (!fileName) return;

    try {
      await window.electron.ipcRenderer.invoke('create-file', folderPath, fileName);
      await refreshCurrentFolder();
    } catch (error) {
      alert(`创建文件失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleCreateDirectory = async () => {
    if (!folderPath) return;

    if (!window.electron?.ipcRenderer) {
      alert('Electron IPC 不可用');
      return;
    }

    const dirName = prompt('请输入目录名：');
    if (!dirName) return;

    try {
      await window.electron.ipcRenderer.invoke('create-directory', folderPath, dirName);
      await refreshCurrentFolder();
    } catch (error) {
      alert(`创建目录失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleFileSelect = async (filePath: string) => {
    try {
      setSelectedFile(filePath);
    } catch (error) {
      console.error('Error selecting file:', error);
    }
  };

  return (
    <div className={styles.app}>
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

        {/* 右侧内容面板 */}
        <div className={styles.rightPanel}>
          <ContentPanel selectedFile={selectedFile} />
        </div>
      </div>
    </div>
  );
};

export default App;
