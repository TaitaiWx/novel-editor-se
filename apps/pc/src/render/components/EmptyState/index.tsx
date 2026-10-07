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
  /** 描述下方的自定义操作区（如空编辑器的「灵感抽签」） */
  actions?: React.ReactNode;
}

const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionText,
  onAction,
  variant = 'generic',
  actions,
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
          title: '暂无内容',
          description: '没有找到相关内容',
        };
    }
  };

  // 显式传入的 title / description 优先于 variant 的默认文案
  const defaults = getDefaultContent();
  const content = {
    title: title ?? defaults.title,
    description: description ?? defaults.description,
  };

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
      {actions && <div className={styles.emptyActions}>{actions}</div>}
    </div>
  );
};

export default EmptyState;
