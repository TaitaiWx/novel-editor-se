import React from 'react';
import type { KnowledgeExportOptions } from '@/render/app/types';
import styles from './styles.module.scss';

interface KnowledgeExportDialogProps {
  options: KnowledgeExportOptions;
  onOptionsChange: React.Dispatch<React.SetStateAction<KnowledgeExportOptions>>;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * 导出角色卡、设定与资料的预览确认弹窗
 */
const KnowledgeExportDialog: React.FC<KnowledgeExportDialogProps> = ({
  options,
  onOptionsChange,
  onClose,
  onConfirm,
}) => (
  <div className={styles.exportPreviewOverlay} onClick={onClose}>
    <div className={styles.exportPreviewModal} onClick={(event) => event.stopPropagation()}>
      <h3 className={styles.exportPreviewTitle}>导出预览</h3>
      <p className={styles.exportPreviewDescription}>
        支持单独导出人物、设定或资料，也可以按需组合导出。
      </p>
      <label className={styles.exportPreviewOption}>
        <input
          type="checkbox"
          checked={options.includeCharacters}
          onChange={(event) =>
            onOptionsChange((prev) => ({
              ...prev,
              includeCharacters: event.target.checked,
            }))
          }
        />
        <span>角色卡</span>
      </label>
      <label className={styles.exportPreviewOption}>
        <input
          type="checkbox"
          checked={options.includeLore}
          onChange={(event) =>
            onOptionsChange((prev) => ({
              ...prev,
              includeLore: event.target.checked,
            }))
          }
        />
        <span>设定资料</span>
      </label>
      <label className={styles.exportPreviewOption}>
        <input
          type="checkbox"
          checked={options.includeMaterials}
          onChange={(event) =>
            onOptionsChange((prev) => ({
              ...prev,
              includeMaterials: event.target.checked,
            }))
          }
        />
        <span>资料卡</span>
      </label>
      <div className={styles.exportPreviewActions}>
        <button type="button" className={styles.exportPreviewCancel} onClick={onClose}>
          取消
        </button>
        <button type="button" className={styles.exportPreviewConfirm} onClick={onConfirm}>
          开始导出
        </button>
      </div>
    </div>
  </div>
);

export default KnowledgeExportDialog;
