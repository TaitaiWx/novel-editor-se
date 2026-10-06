import React from 'react';
import type { PersistedOutlineVersionRow } from '@/render/types/electron-api';
import styles from '../../styles.module.scss';
import { InlineDiffView } from '../../../InlineDiffView';
import {
  buildStoryIdeaCardTitle,
  buildStoryIdeaTermsPreview,
  jumpToStoryIdeaCard,
} from '../helpers';
import type { OutlineVersionPreviewData } from '../useOutlineVersionCenter';

interface OutlineVersionsPanelProps {
  versions: PersistedOutlineVersionRow[];
  highlightedStoryIdeaVersionId: number | null;
  sourceLabels: Record<PersistedOutlineVersionRow['source'], string>;
  importing: boolean;
  compareBaseVersionId: number | null;
  compareTargetVersionId: number | null;
  previewData: OutlineVersionPreviewData | null;
  handleSetCompareBase: (versionId: number | null) => void;
  handleSetCompareTarget: (versionId: number) => void;
  handleEditVersion: (versionId: number, currentName: string, currentNote: string) => Promise<void>;
  handleApplyVersion: (versionId: number, name: string) => Promise<void>;
  handleDeleteVersion: (versionId: number, name: string) => Promise<void>;
}

/**
 * 大纲版本中心：版本列表、A/B 对比选择、应用/编辑/删除，以及差异预览。
 */
export const OutlineVersionsPanel: React.FC<OutlineVersionsPanelProps> = ({
  versions,
  highlightedStoryIdeaVersionId,
  sourceLabels,
  importing,
  compareBaseVersionId,
  compareTargetVersionId,
  previewData,
  handleSetCompareBase,
  handleSetCompareTarget,
  handleEditVersion,
  handleApplyVersion,
  handleDeleteVersion,
}) => {
  return (
    <div className={styles.outlineVersionsPanel}>
      <div className={styles.outlineVersionsHeader}>
        <span className={styles.outlineVersionsTitle}>大纲版本中心</span>
        <span className={styles.outlineVersionsCount}>{versions.length} 个版本</span>
      </div>
      {versions.length === 0 ? (
        <div className={styles.outlineVersionsEmpty}>暂未保存任何大纲版本</div>
      ) : (
        <div className={styles.outlineVersionsList}>
          {versions.map((version) => (
            <div
              key={version.id}
              className={`${styles.outlineVersionCard} ${highlightedStoryIdeaVersionId === version.id ? styles.outlineVersionCardHighlighted : ''}`}
            >
              <div className={styles.outlineVersionMain}>
                <div className={styles.outlineVersionName}>{version.name}</div>
                <div className={styles.outlineVersionMeta}>
                  <span className={styles.outlineVersionBadge}>{sourceLabels[version.source]}</span>
                  {version.story_idea_card_id !== null && (
                    <span className={styles.outlineVersionTraceBadge}>来自三签法</span>
                  )}
                  <span>{version.total_nodes} 节点</span>
                  <span>{new Date(version.created_at).toLocaleString()}</span>
                </div>
                {version.story_idea_card_id !== null && (
                  <div className={styles.outlineVersionTraceTitleRow}>
                    <span className={styles.outlineVersionTraceTitleLabel}>三签卡</span>
                    <span className={styles.outlineVersionTraceTitle}>
                      {buildStoryIdeaCardTitle(version)}
                    </span>
                  </div>
                )}
                {buildStoryIdeaTermsPreview(version).length > 0 && (
                  <div className={styles.outlineVersionTraceTerms}>
                    {buildStoryIdeaTermsPreview(version).map((term) => (
                      <span
                        key={`${version.id}-${term}`}
                        className={`${styles.outlineVersionTraceChip} ${highlightedStoryIdeaVersionId === version.id ? styles.outlineVersionTraceChipHighlighted : ''}`}
                      >
                        {term}
                      </span>
                    ))}
                  </div>
                )}
                {version.note?.trim() && (
                  <div className={styles.outlineVersionNote}>{version.note}</div>
                )}
              </div>
              <div className={styles.outlineVersionActions}>
                <button
                  className={styles.outlineSecondaryButton}
                  onClick={() => handleSetCompareBase(version.id)}
                  disabled={importing}
                >
                  {compareBaseVersionId === version.id ? '取消 A' : '设为 A'}
                </button>
                <button
                  className={styles.outlineSecondaryButton}
                  onClick={() => handleSetCompareTarget(version.id)}
                  disabled={importing}
                >
                  {compareTargetVersionId === version.id ? '取消 B' : '设为 B'}
                </button>
                <button
                  className={styles.outlineSecondaryButton}
                  onClick={() =>
                    void handleEditVersion(version.id, version.name, version.note || '')
                  }
                  disabled={importing}
                >
                  编辑
                </button>
                {version.story_idea_card_id !== null && (
                  <button
                    className={styles.outlineSecondaryButton}
                    onClick={() => jumpToStoryIdeaCard(version.story_idea_card_id)}
                    disabled={importing}
                  >
                    回到灵感
                  </button>
                )}
                <button
                  className={styles.outlineSecondaryButton}
                  onClick={() => void handleApplyVersion(version.id, version.name)}
                  disabled={importing}
                >
                  应用
                </button>
                <button
                  className={styles.outlineSecondaryButton}
                  onClick={() => void handleDeleteVersion(version.id, version.name)}
                  disabled={importing}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {previewData && (
        <div className={styles.outlineVersionPreviewPanel}>
          <div className={styles.outlineVersionPreviewHeader}>
            <div>
              <div className={styles.outlineVersionPreviewTitle}>
                {previewData.baseLabel} vs {previewData.targetLabel}
              </div>
              <div className={styles.outlineVersionPreviewMeta}>
                <span>+{previewData.adds}</span>
                <span>-{previewData.dels}</span>
                <span>{previewData.targetVersion.total_nodes} 节点</span>
              </div>
            </div>
            <button
              className={styles.outlineSecondaryButton}
              onClick={() => handleSetCompareBase(null)}
              disabled={importing}
            >
              与当前对比
            </button>
          </div>
          {previewData.identical ? (
            <div className={styles.outlineVersionPreviewEmpty}>所选版本与当前入库大纲一致</div>
          ) : (
            <InlineDiffView
              original={previewData.baseText}
              modified={previewData.targetText}
              title="版本预览差异"
              explanation="支持当前入库大纲与版本对比，也支持版本 A 与版本 B 直接比较"
              contextLines={1}
            />
          )}
        </div>
      )}
    </div>
  );
};
