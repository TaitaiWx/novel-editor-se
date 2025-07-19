import React from 'react';
import {
  AiOutlineFile,
  AiOutlineFolderAdd,
  AiOutlineReload,
  AiOutlineFolderOpen,
  AiOutlineLoading3Quarters,
} from 'react-icons/ai';
import styles from './styles.module.scss';
import { ActionButtonsProps } from './type';

const ActionButtons: React.FC<ActionButtonsProps> = ({
  onCreateFile,
  onCreateDirectory,
  onRefresh,
  onOpenFolder,
  isLoading = false,
  hasFolder = false,
  folderButtonTitle = '选择文件夹',
}) => {
  return (
    <div className={styles.actionButtons}>
      {onCreateFile && (
        <button
          onClick={onCreateFile}
          className={styles.actionButton}
          disabled={isLoading || !hasFolder}
          title="创建文件"
        >
          <AiOutlineFile />
        </button>
      )}

      {onCreateDirectory && (
        <button
          onClick={onCreateDirectory}
          className={styles.actionButton}
          disabled={isLoading || !hasFolder}
          title="创建目录"
        >
          <AiOutlineFolderAdd />
        </button>
      )}

      {onRefresh && (
        <button
          onClick={onRefresh}
          className={styles.actionButton}
          disabled={isLoading || !hasFolder}
          title="刷新"
        >
          <AiOutlineReload />
        </button>
      )}

      {onOpenFolder && (
        <button
          onClick={onOpenFolder}
          className={styles.actionButton}
          disabled={isLoading}
          title={folderButtonTitle}
        >
          {isLoading ? (
            <AiOutlineLoading3Quarters className={styles.loadingIcon} />
          ) : (
            <AiOutlineFolderOpen />
          )}
        </button>
      )}
    </div>
  );
};

export default ActionButtons;
