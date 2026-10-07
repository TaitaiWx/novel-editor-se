/**
 * 「微调」里的动作库：列出预演可用的动作片段（内置 + 作品动作库 资料/动作库/*.bvh），可导入 .bvh。
 * AI 生成预演时从这里按 id 挑选动作；BVH 来自动作捕捉或「文字 → 动作」模型。
 */
import React, { useRef } from 'react';
import type { MotionLibraryApi } from './useMotionLibrary';
import styles from './styles.module.scss';

interface MotionLibrarySectionProps {
  library: Pick<MotionLibraryApi, 'entries' | 'loading' | 'importing' | 'error' | 'importFile'>;
  /** 没有打开作品时不能导入 */
  canImport: boolean;
}

const MotionLibrarySection: React.FC<MotionLibrarySectionProps> = ({ library, canImport }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const usable = library.entries.filter((entry) => !entry.error).length;
  return (
    <div className={styles.group} data-testid="previz-motion-library">
      <div className={styles.motionHead}>
        <span>动作库 · {usable}</span>
        <button
          type="button"
          className={styles.tool}
          disabled={!canImport || library.importing}
          onClick={() => inputRef.current?.click()}
        >
          {library.importing ? '导入中…' : '导入 .bvh'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".bvh"
          aria-label="导入 BVH 动作文件"
          className={styles.hiddenInput}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void library.importFile(file);
          }}
        />
      </div>
      <ul className={styles.motionList} aria-label="可用动作">
        {library.entries.map((entry) => (
          <li
            key={entry.id}
            className={entry.error ? styles.motionChipError : styles.motionChip}
            data-source={entry.source}
            data-clip-id={entry.id}
            title={entry.error ? `${entry.id}：${entry.error}` : entry.id}
          >
            {entry.label}
          </li>
        ))}
      </ul>
      <span className={styles.fieldHint}>
        生成预演时 AI 会从这里挑选动作；导入的动作保存在作品的 资料/动作库
      </span>
      {library.error && (
        <span className={styles.error} role="status">
          {library.error}
        </span>
      )}
    </div>
  );
};

export default MotionLibrarySection;
