import React, { useMemo } from 'react';
import {
  AiOutlineFile,
  AiOutlineFolderAdd,
  AiOutlineReload,
  AiOutlineFolderOpen,
} from 'react-icons/ai';
import LoadingSpinner from '../LoadingSpinner';
import EmptyState from '../EmptyState';
import FileTree from '../FileTree';
import type { ContextMenuEvent } from '../FileTree';
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
  onCollapse?: () => void;
  onContextMenu?: (event: ContextMenuEvent) => void;
  creatingType?: 'file' | 'directory' | null;
  createTargetPath?: string | null;
  onInlineCreate?: (type: 'file' | 'directory', name: string) => void;
  onCancelCreate?: () => void;
}

const FilePanel: React.FC<FilePanelProps> = React.memo(
  ({
    files,
    selectedFile,
    folderPath,
    isLoading,
    onFileSelect,
    onCreateFile,
    onCreateDirectory,
    onRefresh,
    onOpenFolder,
    onCollapse,
    onContextMenu,
    creatingType,
    createTargetPath,
    onInlineCreate,
    onCancelCreate,
  }) => {
    const folderName = useMemo(
      () =>
        folderPath
          ? folderPath.split('/').pop() || folderPath.split('\\').pop() || folderPath
          : null,
      [folderPath]
    );

    return (
      <div className={styles.filePanel}>
        <div className={styles.explorerHeader}>
          <span className={styles.explorerTitle}>资源管理器</span>
          <div className={styles.headerActions}>
            <button
              className={styles.explorerAction}
              onClick={onOpenFolder}
              disabled={isLoading}
              title={folderPath ? '更换文件夹' : '打开文件夹'}
            >
              <AiOutlineFolderOpen />
            </button>
            {onCollapse && (
              <button className={styles.explorerAction} onClick={onCollapse} title="折叠侧边栏">
                ◀
              </button>
            )}
          </div>
        </div>

        <div className={styles.filePanelContent}>
          {isLoading ? (
            <LoadingSpinner message="正在加载..." />
          ) : folderPath ? (
            <>
              <div className={styles.workspaceSection}>
                <div className={styles.workspaceHeader}>
                  <span className={styles.workspaceName}>{folderName?.toUpperCase()}</span>
                  <div className={styles.workspaceActions}>
                    <button
                      className={styles.workspaceAction}
                      onClick={onCreateFile}
                      title="新建文件"
                      disabled={isLoading}
                    >
                      <AiOutlineFile />
                    </button>
                    <button
                      className={styles.workspaceAction}
                      onClick={onCreateDirectory}
                      title="新建目录"
                      disabled={isLoading}
                    >
                      <AiOutlineFolderAdd />
                    </button>
                    <button
                      className={styles.workspaceAction}
                      onClick={onRefresh}
                      title="刷新"
                      disabled={isLoading}
                    >
                      <AiOutlineReload />
                    </button>
                  </div>
                </div>
                <FileTree
                  files={files}
                  onFileSelect={onFileSelect}
                  selectedFile={selectedFile}
                  onContextMenu={onContextMenu}
                  creatingType={creatingType}
                  createTargetPath={createTargetPath}
                  onInlineCreate={onInlineCreate}
                  onCancelCreate={onCancelCreate}
                />
              </div>
            </>
          ) : (
            <EmptyState variant="folder" />
          )}
        </div>
      </div>
    );
  }
);

export default FilePanel;
