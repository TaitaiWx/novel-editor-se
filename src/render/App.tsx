import React, { useState } from 'react';
import FileTree from './components/FileTree';
import CodeViewer from './components/CodeViewer';
import {
  AiOutlineFile,
  AiOutlineFolderAdd,
  AiOutlineReload,
  AiOutlineFolderOpen,
  AiOutlineFolder,
  AiOutlineLoading3Quarters,
} from 'react-icons/ai';
import './App.scss';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

const App: React.FC = () => {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // 组件挂载时加载默认路径
  React.useEffect(() => {
    // 延迟一点时间确保 Electron 完全初始化
    const timer = setTimeout(() => {
      loadDefaultPath();
    }, 100);

    return () => clearTimeout(timer);
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

  const getFolderName = (path: string) => {
    return path.split('/').pop() || path.split('\\').pop() || path;
  };

  return (
    <div className="app">
      {/* 两栏布局 - 无 header */}
      <div className="app-main">
        {/* 左侧文件树 */}
        <div className="left-panel">
          <div className="panel-header">
            <div className="header-content">
              <h3>文件浏览器</h3>
              <div className="header-actions">
                <button
                  onClick={handleCreateFile}
                  className="action-icon"
                  disabled={isLoading || !folderPath}
                  title="创建文件"
                >
                  <AiOutlineFile />
                </button>
                <button
                  onClick={handleCreateDirectory}
                  className="action-icon"
                  disabled={isLoading || !folderPath}
                  title="创建目录"
                >
                  <AiOutlineFolderAdd />
                </button>
                <button
                  onClick={refreshCurrentFolder}
                  className="action-icon"
                  disabled={isLoading || !folderPath}
                  title="刷新"
                >
                  <AiOutlineReload />
                </button>
                <button
                  onClick={handleOpenLocal}
                  className="action-icon"
                  disabled={isLoading}
                  title={folderPath ? '更换文件夹' : '选择文件夹'}
                >
                  {isLoading ? (
                    <AiOutlineLoading3Quarters className="loading-icon" />
                  ) : (
                    <AiOutlineFolderOpen />
                  )}
                </button>
              </div>
            </div>
            {folderPath && (
              <div className="current-folder">
                <span className="folder-path" title={folderPath}>
                  {getFolderName(folderPath)}
                </span>
                {files.length > 0 && <span className="file-count">{files.length} 项</span>}
              </div>
            )}
          </div>
          <div className="panel-content">
            {isLoading ? (
              <div className="loading-state">
                <div className="loading-spinner"></div>
                <p>正在加载文件夹...</p>
              </div>
            ) : files.length > 0 ? (
              <FileTree files={files} onFileSelect={handleFileSelect} selectedFile={selectedFile} />
            ) : (
              <div className="empty-state">
                <div className="empty-icon">
                  <AiOutlineFolder />
                </div>
                <h4>暂无文件</h4>
                <p>
                  点击上方{' '}
                  <AiOutlineFolderOpen style={{ display: 'inline', verticalAlign: 'middle' }} />{' '}
                  图标选择一个文件夹开始使用
                </p>
              </div>
            )}
          </div>
        </div>

        {/* 右侧内容展示 */}
        <div className="right-panel">
          <div className="panel-header">
            <h3>
              {selectedFile
                ? `${selectedFile.split('/').pop() || selectedFile.split('\\').pop()}`
                : '请选择文件'}
            </h3>
            {selectedFile && <span className="file-indicator">已选择</span>}
          </div>
          <div className="panel-content">
            <CodeViewer filePath={selectedFile} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
