import React, { useEffect, useState } from 'react';
import type { ChapterMetadata, ChapterStatus } from '../../utils/chapterWorkspace';
import { CHAPTER_STATUS_LABELS, formatChapterIndex } from '../../utils/chapterWorkspace';
import { buildEffectiveReferenceIds } from '../../utils/chapterReferences';
import styles from './styles.module.scss';

export interface ChapterReferenceOption {
  id: number;
  name: string;
  meta?: string;
}

export interface ChapterDetailsValues {
  title: string;
  status: ChapterStatus;
  summary: string;
  plotNote: string;
  linkedCharacterIds: number[];
  linkedLoreIds: number[];
}

interface ChapterDetailsDialogProps {
  visible: boolean;
  chapterTitle: string;
  chapterNumber: number;
  chapterPath: string;
  metadata: ChapterMetadata;
  characterOptions: ChapterReferenceOption[];
  loreOptions: ChapterReferenceOption[];
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (values: ChapterDetailsValues) => void;
}

const STATUS_ORDER: ChapterStatus[] = ['draft', 'writing', 'revising', 'done'];

function toggleNumber(list: number[], value: number): number[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function hasId(list: number[] | undefined, value: number): boolean {
  return Array.isArray(list) && list.includes(value);
}

export const ChapterDetailsDialog: React.FC<ChapterDetailsDialogProps> = ({
  visible,
  chapterTitle,
  chapterNumber,
  chapterPath,
  metadata,
  characterOptions,
  loreOptions,
  submitting = false,
  onClose,
  onSubmit,
}) => {
  const [title, setTitle] = useState(chapterTitle);
  const [status, setStatus] = useState<ChapterStatus>(metadata.status || 'draft');
  const [summary, setSummary] = useState(metadata.summary || '');
  const [plotNote, setPlotNote] = useState(metadata.plotNote || '');
  const [linkedCharacterIds, setLinkedCharacterIds] = useState<number[]>(
    buildEffectiveReferenceIds(metadata, 'character')
  );
  const [linkedLoreIds, setLinkedLoreIds] = useState<number[]>(
    buildEffectiveReferenceIds(metadata, 'lore')
  );

  useEffect(() => {
    if (!visible) return;
    setTitle(chapterTitle);
    setStatus(metadata.status || 'draft');
    setSummary(metadata.summary || '');
    setPlotNote(metadata.plotNote || '');
    setLinkedCharacterIds(buildEffectiveReferenceIds(metadata, 'character'));
    setLinkedLoreIds(buildEffectiveReferenceIds(metadata, 'lore'));
  }, [visible, chapterTitle, metadata]);

  if (!visible) return null;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    onSubmit({
      title: title.trim(),
      status,
      summary: summary.trim(),
      plotNote: plotNote.trim(),
      linkedCharacterIds,
      linkedLoreIds,
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
            <h2 className={styles.title}>章节信息</h2>
            <p className={styles.subtitle}>把章节标题、状态和关联资料维护成一等信息。</p>
          </div>
          <button className={styles.closeButton} onClick={onClose} type="button">
            ×
          </button>
        </div>

        <form className={styles.body} onSubmit={handleSubmit}>
          <div className={styles.infoCard}>
            <span className={styles.infoLabel}>当前章节</span>
            <span className={styles.infoValue}>
              第{formatChapterIndex(chapterNumber)}章 · {chapterPath}
            </span>
          </div>

          <div className={styles.grid}>
            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.label}>章节标题</span>
              <input
                className={styles.input}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                autoFocus
              />
              <span className={styles.hint}>保存后会同步更新文件名和章节 H1 标题。</span>
            </label>

            <div className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.label}>章节状态</span>
              <div className={styles.statusGroup}>
                {STATUS_ORDER.map((item) => (
                  <button
                    key={item}
                    className={`${styles.statusButton} ${status === item ? styles.statusButtonActive : ''}`}
                    type="button"
                    onClick={() => setStatus(item)}
                  >
                    {CHAPTER_STATUS_LABELS[item]}
                  </button>
                ))}
              </div>
            </div>

            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.label}>本章摘要</span>
              <textarea
                className={styles.textarea}
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="一句话说明本章发生了什么。"
              />
            </label>

            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.label}>情节板焦点</span>
              <textarea
                className={styles.textarea}
                value={plotNote}
                onChange={(event) => setPlotNote(event.target.value)}
                placeholder="例如：目标、冲突、转折、回收点。"
              />
            </label>

            <div className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.label}>角色 / 设定引用</span>
              <div className={styles.referenceGrid}>
                <div className={styles.referenceBox}>
                  <span className={styles.referenceTitle}>人物引用</span>
                  <div className={styles.referenceList}>
                    {characterOptions.length === 0 ? (
                      <div className={styles.referenceEmpty}>当前作品还没有人物资料。</div>
                    ) : (
                      characterOptions.map((option) => (
                        <label key={option.id} className={styles.referenceItem}>
                          <input
                            type="checkbox"
                            checked={linkedCharacterIds.includes(option.id)}
                            onChange={() =>
                              setLinkedCharacterIds((prev) => toggleNumber(prev, option.id))
                            }
                          />
                          <span>
                            <span className={styles.referenceNameRow}>
                              <span>{option.name}</span>
                              <span className={styles.referenceTags}>
                                {hasId(metadata.autoLinkedCharacterIds, option.id) &&
                                  !hasId(metadata.dismissedCharacterIds, option.id) && (
                                    <span
                                      className={`${styles.referenceChip} ${styles.referenceChipAuto}`}
                                    >
                                      自动识别
                                    </span>
                                  )}
                                {hasId(metadata.linkedCharacterIds, option.id) && (
                                  <span
                                    className={`${styles.referenceChip} ${styles.referenceChipManual}`}
                                  >
                                    手动保留
                                  </span>
                                )}
                                {hasId(metadata.dismissedCharacterIds, option.id) &&
                                  !linkedCharacterIds.includes(option.id) && (
                                    <span
                                      className={`${styles.referenceChip} ${styles.referenceChipMuted}`}
                                    >
                                      已忽略
                                    </span>
                                  )}
                              </span>
                            </span>
                            {option.meta && (
                              <span className={styles.referenceMeta}>{option.meta}</span>
                            )}
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>

                <div className={styles.referenceBox}>
                  <span className={styles.referenceTitle}>设定引用</span>
                  <div className={styles.referenceList}>
                    {loreOptions.length === 0 ? (
                      <div className={styles.referenceEmpty}>当前作品还没有设定条目。</div>
                    ) : (
                      loreOptions.map((option) => (
                        <label key={option.id} className={styles.referenceItem}>
                          <input
                            type="checkbox"
                            checked={linkedLoreIds.includes(option.id)}
                            onChange={() =>
                              setLinkedLoreIds((prev) => toggleNumber(prev, option.id))
                            }
                          />
                          <span>
                            <span className={styles.referenceNameRow}>
                              <span>{option.name}</span>
                              <span className={styles.referenceTags}>
                                {hasId(metadata.autoLinkedLoreIds, option.id) &&
                                  !hasId(metadata.dismissedLoreIds, option.id) && (
                                    <span
                                      className={`${styles.referenceChip} ${styles.referenceChipAuto}`}
                                    >
                                      自动识别
                                    </span>
                                  )}
                                {hasId(metadata.linkedLoreIds, option.id) && (
                                  <span
                                    className={`${styles.referenceChip} ${styles.referenceChipManual}`}
                                  >
                                    手动保留
                                  </span>
                                )}
                                {hasId(metadata.dismissedLoreIds, option.id) &&
                                  !linkedLoreIds.includes(option.id) && (
                                    <span
                                      className={`${styles.referenceChip} ${styles.referenceChipMuted}`}
                                    >
                                      已忽略
                                    </span>
                                  )}
                              </span>
                            </span>
                            {option.meta && (
                              <span className={styles.referenceMeta}>{option.meta}</span>
                            )}
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className={styles.footer}>
            <button className={styles.secondaryButton} type="button" onClick={onClose}>
              取消
            </button>
            <button
              className={styles.primaryButton}
              type="submit"
              disabled={submitting || !title.trim()}
            >
              {submitting ? '正在保存...' : '保存章节信息'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ChapterDetailsDialog;
