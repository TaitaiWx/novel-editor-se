import React from 'react';
import { AiOutlineFolder, AiOutlineFolderOpen } from 'react-icons/ai';
import styles from './styles.module.scss';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: string;
  description?: string;
  actionText?: string;
  onAction?: () => void;
  variant?: 'folder' | 'file' | 'generic';
}

const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title = '暂无内容',
  description = '没有找到相关内容',
  actionText,
  onAction,
  variant = 'generic',
}) => {
  const getDefaultIcon = () => {
    switch (variant) {
      case 'folder':
        return <AiOutlineFolder />;
      case 'file':
        return <AiOutlineFolder />;
      default:
        return <AiOutlineFolder />;
    }
  };

  const getDefaultContent = () => {
    switch (variant) {
      case 'folder':
        return {
          title: '暂无文件',
          description: (
            <span>
              点击上方{' '}
              <AiOutlineFolderOpen style={{ display: 'inline', verticalAlign: 'middle' }} />{' '}
              图标选择一个文件夹开始使用
            </span>
          ),
        };
      case 'file':
        return {
          title: '暂无文件',
          description: '请选择一个文件夹查看内容',
        };
      default:
        return {
          title: title,
          description: description,
        };
    }
  };

  const content = getDefaultContent();

  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyIcon}>{icon || getDefaultIcon()}</div>
      <h4 className={styles.emptyTitle}>{content.title}</h4>
      <p className={styles.emptyDescription}>{content.description}</p>
      {actionText && onAction && (
        <button className={styles.emptyAction} onClick={onAction}>
          {actionText}
        </button>
      )}
    </div>
  );
};

export default EmptyState;
