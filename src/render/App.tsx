import React, { useState } from 'react';
import FileTree from './components/FileTree';
import CodeViewer from './components/CodeViewer';
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

  const handleOpenLocal = async () => {
    setIsLoading(true);
    try {
      const result = await window.electron.ipcRenderer.invoke('open-local-folder');
      if (result) {
        setFolderPath(result.path);
        setFiles(result.files);
        setSelectedFile(null); // 清除之前选择的文件
      }
    } catch (error) {
      console.error('Error opening folder:', error);
    } finally {
      setIsLoading(false);
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
              <button
                onClick={handleOpenLocal}
                className="open-folder-icon"
                disabled={isLoading}
                title={folderPath ? '更换文件夹' : '选择文件夹'}
              >
                {isLoading ? '⏳' : '📁'}
              </button>
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
                <div className="empty-icon">📂</div>
                <h4>暂无文件</h4>
                <p>点击上方 📁 图标选择一个文件夹开始使用</p>
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
