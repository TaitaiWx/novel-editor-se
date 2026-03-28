import React, { useEffect, useState } from 'react';
import type { ProjectPreset } from '../../utils/chapterWorkspace';
import { PROJECT_PRESET_LABELS } from '../../utils/chapterWorkspace';
import styles from './styles.module.scss';

export interface ProjectWizardValues {
  projectName: string;
  parentDir: string;
  preset: ProjectPreset;
  createFirstChapter: boolean;
  firstChapterTitle: string;
}

interface ProjectWizardDialogProps {
  visible: boolean;
  parentDir: string;
  submitting?: boolean;
  onPickLocation: () => void;
  onClose: () => void;
  onSubmit: (values: ProjectWizardValues) => void;
}

const PRESET_DESCRIPTIONS: Record<ProjectPreset, string> = {
  focused: '只创建章节目录，入口更直接，适合先开始写。',
  standard: '额外预留 notes / materials 目录，适合后续整理资料。',
};

export const ProjectWizardDialog: React.FC<ProjectWizardDialogProps> = ({
  visible,
  parentDir,
  submitting = false,
  onPickLocation,
  onClose,
  onSubmit,
}) => {
  const [projectName, setProjectName] = useState('');
  const [preset, setPreset] = useState<ProjectPreset>('focused');
  const [createFirstChapter, setCreateFirstChapter] = useState(true);
  const [firstChapterTitle, setFirstChapterTitle] = useState('开篇');

  useEffect(() => {
    if (!visible) return;
    setProjectName('');
    setPreset('focused');
    setCreateFirstChapter(true);
    setFirstChapterTitle('开篇');
  }, [visible]);

  if (!visible) return null;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!projectName.trim() || !parentDir.trim()) return;
    onSubmit({
      projectName: projectName.trim(),
      parentDir: parentDir.trim(),
      preset,
      createFirstChapter,
      firstChapterTitle: firstChapterTitle.trim() || '未命名',
    });
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.dialog}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className={styles.header}>
          <div className={styles.titleWrap}>
            <h2 className={styles.title}>新建作品</h2>
            <p className={styles.subtitle}>先确定作品目录和章节结构，再直接开始写第一章。</p>
          </div>
          <button className={styles.closeButton} onClick={onClose} type="button">
            ×
          </button>
        </div>

        <form className={styles.body} onSubmit={handleSubmit}>
          <div className={styles.grid}>
            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.label}>作品名称</span>
              <input
                className={styles.input}
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="例如：长夜余烬"
                autoFocus
              />
            </label>

            <div className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.label}>存放位置</span>
              <div className={styles.inlineRow}>
                <input
                  className={styles.input}
                  value={parentDir}
                  placeholder="请选择作品保存目录"
                  readOnly
                />
                <button
                  className={styles.locationButton}
                  type="button"
                  onClick={onPickLocation}
                  disabled={submitting}
                >
                  选择位置
                </button>
              </div>
            </div>

            <div className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.label}>作品结构</span>
              <div className={styles.radioGroup}>
                {(['focused', 'standard'] as ProjectPreset[]).map((item) => (
                  <label key={item} className={styles.radioCard}>
                    <input
                      className={styles.radioInput}
                      type="radio"
                      name="project-preset"
                      checked={preset === item}
                      onChange={() => setPreset(item)}
                    />
                    <span className={styles.radioTitle}>
                      {PROJECT_PRESET_LABELS[item]}
                      {item === 'focused' ? '（推荐）' : ''}
                    </span>
                    <span className={styles.radioDesc}>{PRESET_DESCRIPTIONS[item]}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={createFirstChapter}
                  onChange={(event) => setCreateFirstChapter(event.target.checked)}
                />
                创建第一章
              </span>
            </label>

            {createFirstChapter && (
              <label className={`${styles.field} ${styles.fieldFull}`}>
                <span className={styles.label}>第一章标题</span>
                <input
                  className={styles.input}
                  value={firstChapterTitle}
                  onChange={(event) => setFirstChapterTitle(event.target.value)}
                  placeholder="例如：开篇"
                />
              </label>
            )}
          </div>

          <div className={styles.footer}>
            <button className={styles.secondaryButton} type="button" onClick={onClose}>
              取消
            </button>
            <button
              className={styles.primaryButton}
              type="submit"
              disabled={submitting || !projectName.trim() || !parentDir.trim()}
            >
              {submitting ? '正在创建...' : '创建作品'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProjectWizardDialog;
