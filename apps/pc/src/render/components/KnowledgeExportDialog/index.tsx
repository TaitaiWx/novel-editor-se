import React from 'react';
import type { KnowledgeExportOptions } from '@/render/app/types';
import Checkbox from '../Checkbox';
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
      <Checkbox
        className={styles.exportPreviewOption}
        checked={options.includeCharacters}
        onChange={(checked) => onOptionsChange((prev) => ({ ...prev, includeCharacters: checked }))}
        label="角色卡"
      />
      <Checkbox
        className={styles.exportPreviewOption}
        checked={options.includeLore}
        onChange={(checked) => onOptionsChange((prev) => ({ ...prev, includeLore: checked }))}
        label="设定资料"
      />
      <Checkbox
        className={styles.exportPreviewOption}
        checked={options.includeMaterials}
        onChange={(checked) => onOptionsChange((prev) => ({ ...prev, includeMaterials: checked }))}
        label="资料卡"
      />
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
