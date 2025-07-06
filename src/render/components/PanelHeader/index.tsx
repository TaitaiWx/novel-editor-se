import React from 'react';
import ActionButtons from '../ActionButtons';
import styles from './styles.module.scss';

interface PanelHeaderProps {
  title: string;
  subtitle?: string;
  actions?: {
    onCreateFile?: () => void;
    onCreateDirectory?: () => void;
    onRefresh?: () => void;
    onOpenFolder?: () => void;
    isLoading?: boolean;
    hasFolder?: boolean;
    folderButtonTitle?: string;
  };
  folderInfo?: {
    path: string;
    fileCount: number;
  };
  indicator?: {
    text: string;
    type?: 'info' | 'success' | 'warning' | 'error';
  };
  settingsComponent?: React.ReactNode;
}

const PanelHeader: React.FC<PanelHeaderProps> = ({
  title,
  subtitle,
  actions,
  folderInfo,
  indicator,
  settingsComponent,
}) => {
  const getFolderName = (path: string) => {
    return path.split('/').pop() || path.split('\\').pop() || path;
  };

  return (
    <div className={styles.panelHeader}>
      <div className={styles.headerContent}>
        <div className={styles.headerTitle}>
          <h3>{title}</h3>
          {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
          {indicator && (
            <span className={`${styles.indicator} ${styles[indicator.type || 'info']}`}>
              {indicator.text}
            </span>
          )}
        </div>

        <div className={styles.headerActions}>
          {actions && (
            <ActionButtons
              onCreateFile={actions.onCreateFile}
              onCreateDirectory={actions.onCreateDirectory}
              onRefresh={actions.onRefresh}
              onOpenFolder={actions.onOpenFolder}
              isLoading={actions.isLoading}
              hasFolder={actions.hasFolder}
              folderButtonTitle={actions.folderButtonTitle}
            />
          )}
          {settingsComponent}
        </div>
      </div>

      {folderInfo && (
        <div className={styles.folderInfo}>
          <span className={styles.folderPath} title={folderInfo.path}>
            {getFolderName(folderInfo.path)}
          </span>
          {folderInfo.fileCount > 0 && (
            <span className={styles.fileCount}>{folderInfo.fileCount} 项</span>
          )}
        </div>
      )}
    </div>
  );
};

export default PanelHeader;
