import React, { useEffect, useState } from 'react';
import styles from './styles.module.scss';

export interface BatchChapterValues {
  count: number;
  titlePrefix: string;
}

interface BatchChapterDialogProps {
  visible: boolean;
  nextChapterNumber: number;
  targetDirLabel: string;
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (values: BatchChapterValues) => void;
}

export const BatchChapterDialog: React.FC<BatchChapterDialogProps> = ({
  visible,
  nextChapterNumber,
  targetDirLabel,
  submitting = false,
  onClose,
  onSubmit,
}) => {
  const [count, setCount] = useState('3');
  const [titlePrefix, setTitlePrefix] = useState('章节');

  useEffect(() => {
    if (!visible) return;
    setCount('3');
    setTitlePrefix('章节');
  }, [visible]);

  if (!visible) return null;

  const parsedCount = Number.parseInt(count, 10);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!Number.isFinite(parsedCount) || parsedCount <= 0) return;
    onSubmit({
      count: Math.min(parsedCount, 30),
      titlePrefix: titlePrefix.trim() || '章节',
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
            <h2 className={styles.title}>批量创建章节骨架</h2>
            <p className={styles.subtitle}>一次生成连续章节，后续直接进入写作和重命名。</p>
          </div>
          <button className={styles.closeButton} onClick={onClose} type="button">
            ×
          </button>
        </div>

        <form className={styles.body} onSubmit={handleSubmit}>
          <div className={styles.infoCard}>
            <span className={styles.infoLabel}>创建位置</span>
            <span className={styles.infoValue}>{targetDirLabel}</span>
          </div>

          <div className={styles.grid}>
            <label className={styles.field}>
              <span className={styles.label}>起始章节</span>
              <input
                className={styles.input}
                value={`第${String(nextChapterNumber).padStart(2, '0')}章`}
                readOnly
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>创建数量</span>
              <input
                className={styles.input}
                type="number"
                min={1}
                max={30}
                value={count}
                onChange={(event) => setCount(event.target.value)}
              />
            </label>

            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.label}>标题前缀</span>
              <input
                className={styles.input}
                value={titlePrefix}
                onChange={(event) => setTitlePrefix(event.target.value)}
                placeholder="例如：场景、推进、冲突"
              />
              <span className={styles.hint}>会生成类似“第03章 章节 03”这样的骨架文件名。</span>
            </label>
          </div>

          <div className={styles.footer}>
            <button className={styles.secondaryButton} type="button" onClick={onClose}>
              取消
            </button>
            <button
              className={styles.primaryButton}
              type="submit"
              disabled={submitting || !Number.isFinite(parsedCount) || parsedCount <= 0}
            >
              {submitting ? '正在创建...' : '批量创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default BatchChapterDialog;
