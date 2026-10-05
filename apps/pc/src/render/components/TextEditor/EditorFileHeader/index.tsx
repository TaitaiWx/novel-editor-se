import React from 'react';
import { VscSave } from 'react-icons/vsc';
import Tooltip from '../../Tooltip';
import styles from './styles.module.scss';

interface EditorFileHeaderProps {
  fileName: string;
  language: string;
  hasChanges: boolean;
  isLargeFile: boolean;
  readOnly: boolean;
  isChangelog: boolean;
  autoSaving: boolean;
  lastSaved: Date | null;
  onSave: () => void;
  settingsComponent?: React.ReactNode;
}

/** 保存状态文案：保存中 / 未保存 / 上次保存时间 / 已保存 */
export function getSaveStatusLabel(
  autoSaving: boolean,
  hasChanges: boolean,
  lastSaved: Date | null
): string {
  return autoSaving
    ? '保存中...'
    : hasChanges
      ? '未保存'
      : lastSaved
        ? `${lastSaved.toLocaleTimeString()}`
        : '已保存';
}

/** 编辑器顶部的单行文件信息栏（文件名、语言、保存状态与操作） */
const EditorFileHeader: React.FC<EditorFileHeaderProps> = ({
  fileName,
  language,
  hasChanges,
  isLargeFile,
  readOnly,
  isChangelog,
  autoSaving,
  lastSaved,
  onSave,
  settingsComponent,
}) => (
  <div className={styles.fileHeader}>
    <div className={styles.fileInfo}>
      <span className={styles.fileName}>
        {fileName}
        {hasChanges && <span className={styles.unsavedIndicator}>*</span>}
      </span>
      <span className={styles.languageBadge}>{language}</span>
      {isLargeFile && <span className={styles.largeFileBadge}>大文件</span>}
      {!readOnly && (
        <span className={styles.autoSaveStatus}>
          {getSaveStatusLabel(autoSaving, hasChanges, lastSaved)}
        </span>
      )}
    </div>
    <div className={styles.fileActions}>
      {!readOnly && !isChangelog && (
        <Tooltip content="保存 (Cmd/Ctrl+S)" position="bottom">
          <button
            className={styles.saveButton}
            onClick={onSave}
            disabled={autoSaving}
            aria-label="保存"
          >
            <VscSave />
          </button>
        </Tooltip>
      )}
      {settingsComponent}
    </div>
  </div>
);

export default EditorFileHeader;
