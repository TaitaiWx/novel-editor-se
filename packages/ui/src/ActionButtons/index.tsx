import UiButton from '../Button';
import React from 'react';
import {
  AiOutlineFile,
  AiOutlineFolderAdd,
  AiOutlineReload,
  AiOutlineFolderOpen,
  AiOutlineLoading3Quarters,
} from 'react-icons/ai';
import styles from './styles.module.scss';

export interface ActionButtonsProps {
  onCreateFile?: () => void;
  onCreateDirectory?: () => void;
  onRefresh?: () => void;
  onOpenFolder?: () => void;
  isLoading?: boolean;
  hasFolder?: boolean;
  folderButtonTitle?: string;
}

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
        <UiButton
          unstyled
          onClick={onCreateFile}
          className={styles.actionButton}
          disabled={isLoading || !hasFolder}
          title="创建文件"
        >
          <AiOutlineFile />
        </UiButton>
      )}

      {onCreateDirectory && (
        <UiButton
          unstyled
          onClick={onCreateDirectory}
          className={styles.actionButton}
          disabled={isLoading || !hasFolder}
          title="创建目录"
        >
          <AiOutlineFolderAdd />
        </UiButton>
      )}

      {onRefresh && (
        <UiButton
          unstyled
          onClick={onRefresh}
          className={styles.actionButton}
          disabled={isLoading || !hasFolder}
          title="刷新"
        >
          <AiOutlineReload />
        </UiButton>
      )}

      {onOpenFolder && (
        <UiButton
          unstyled
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
        </UiButton>
      )}
    </div>
  );
};

export default ActionButtons;
