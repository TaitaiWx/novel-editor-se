import React from 'react';
import './styles.scss';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

interface FileTreeProps {
  files: FileNode[];
  onFileSelect: (path: string) => void;
  selectedFile?: string | null;
}

// 获取文件图标
const getFileIcon = (name: string, type: 'file' | 'directory') => {
  if (type === 'directory') {
    return { icon: '📁', className: 'folder' };
  }

  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js':
      return { icon: '🟨', className: 'js' };
    case 'ts':
      return { icon: '🔷', className: 'ts' };
    case 'jsx':
    case 'tsx':
      return { icon: '⚛️', className: 'jsx' };
    case 'json':
      return { icon: '📄', className: 'json' };
    case 'md':
      return { icon: '📝', className: 'md' };
    case 'css':
    case 'scss':
      return { icon: '🎨', className: 'css' };
    case 'html':
      return { icon: '🌐', className: 'html' };
    case 'txt':
      return { icon: '📄', className: 'txt' };
    case 'py':
      return { icon: '🐍', className: 'py' };
    default:
      return { icon: '📄', className: 'file' };
  }
};

// 格式化文件大小
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const FileTreeItem: React.FC<{
  node: FileNode;
  onFileSelect: (path: string) => void;
  selectedFile?: string | null;
  level?: number;
}> = ({ node, onFileSelect, selectedFile, level = 0 }) => {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [fileInfo, setFileInfo] = React.useState<any>(null);
  const isSelected = selectedFile === node.path;

  // 获取文件信息
  React.useEffect(() => {
    if (node.type === 'file') {
      window.electron.ipcRenderer
        .invoke('get-file-info', node.path)
        .then(setFileInfo)
        .catch(() => setFileInfo(null));
    }
  }, [node.path, node.type]);

  const handleClick = () => {
    if (node.type === 'directory') {
      setIsExpanded(!isExpanded);
    } else {
      onFileSelect(node.path);
    }
  };

  const { icon, className } = getFileIcon(node.name, node.type);

  return (
    <div className="file-tree-item">
      <div
        className={`item-header ${node.type} ${isSelected ? 'selected' : ''}`}
        onClick={handleClick}
        style={{ paddingLeft: `${8 + level * 16}px` }}
      >
        <span
          className={`expand-icon ${isExpanded ? 'expanded' : ''} ${
            node.type === 'file' ? 'hidden' : ''
          }`}
        >
          ▶
        </span>
        <span className={`file-icon ${className}`}>{icon}</span>
        <span className="item-name">{node.name}</span>
        {node.type === 'file' && fileInfo && (
          <span className="item-size">{formatFileSize(fileInfo.size)}</span>
        )}
      </div>
      {node.type === 'directory' && isExpanded && node.children && (
        <div className="item-children">
          {node.children.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              onFileSelect={onFileSelect}
              selectedFile={selectedFile}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const FileTree: React.FC<FileTreeProps> = ({ files, onFileSelect, selectedFile }) => {
  return (
    <div className="file-tree">
      {files.map((file) => (
        <FileTreeItem
          key={file.path}
          node={file}
          onFileSelect={onFileSelect}
          selectedFile={selectedFile}
        />
      ))}
    </div>
  );
};

export default FileTree;
