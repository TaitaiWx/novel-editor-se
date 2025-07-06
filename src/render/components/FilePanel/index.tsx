import React from 'react';
import PanelHeader from '../PanelHeader';
import LoadingSpinner from '../LoadingSpinner';
import EmptyState from '../EmptyState';
import FileTree from '../FileTree';
import { FileNode } from '../../types';
import styles from './styles.module.scss';

interface FilePanelProps {
  files: FileNode[];
  selectedFile: string | null;
  folderPath: string | null;
  isLoading: boolean;
  onFileSelect: (filePath: string) => void;
  onCreateFile: () => void;
  onCreateDirectory: () => void;
  onRefresh: () => void;
  onOpenFolder: () => void;
}

const FilePanel: React.FC<FilePanelProps> = ({
  files,
  selectedFile,
  folderPath,
  isLoading,
  onFileSelect,
  onCreateFile,
  onCreateDirectory,
  onRefresh,
  onOpenFolder,
}) => {
  return (
    <div className={styles.filePanel}>
      <PanelHeader
        title="文件浏览器"
        actions={{
          onCreateFile,
          onCreateDirectory,
          onRefresh,
          onOpenFolder,
          isLoading,
          hasFolder: !!folderPath,
          folderButtonTitle: folderPath ? '更换文件夹' : '选择文件夹',
        }}
        folderInfo={
          folderPath
            ? {
                path: folderPath,
                fileCount: files.length,
              }
            : undefined
        }
      />

      <div className={styles.filePanelContent}>
        {isLoading ? (
          <LoadingSpinner message="正在加载文件夹..." />
        ) : files.length > 0 ? (
          <FileTree files={files} onFileSelect={onFileSelect} selectedFile={selectedFile} />
        ) : (
          <EmptyState variant="folder" />
        )}
      </div>
    </div>
  );
};

export default FilePanel;
