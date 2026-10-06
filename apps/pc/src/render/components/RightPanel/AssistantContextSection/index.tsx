import React, { useMemo, useState } from 'react';
import type {
  AssistantScopeTarget,
  AssistantScopedCharacter,
  AssistantScopedLore,
  AssistantScopedMaterial,
} from '@/render/app/types';
import {
  formatAssistantGenerationMetrics,
  formatAssistantGenerationProgress,
  type AssistantArtifactGenerationStatus,
} from '@/render/utils/assistantGeneration';
import styles from './styles.module.scss';

export type AssistantContextKind = 'characters' | 'lore' | 'materials';

export interface AssistantContextSectionProps {
  /** 当前作用域（作品 / 卷 / 章）；为空时不显示本分区 */
  scope: AssistantScopeTarget | null;
  characters: AssistantScopedCharacter[];
  loreEntries: AssistantScopedLore[];
  materials: AssistantScopedMaterial[];
  characterGenerationStatus?: AssistantArtifactGenerationStatus | null;
  /** 资料目录中的全部文件（用于关联到当前章） */
  materialFiles?: Array<{ path: string; name: string }>;
  /** 已关联到当前章的资料路径 */
  linkedMaterialPaths?: string[];
  onGenerate?: (kind: AssistantContextKind) => void;
  onOpenMaterial?: (path: string) => void;
  onAddMaterial?: (path: string) => void;
  onRemoveMaterial?: (path: string) => void;
}

const SCOPE_PREFIX: Record<AssistantScopeTarget['kind'], string> = {
  chapter: '当前章',
  volume: '当前卷',
  project: '当前作品',
};

function joinMeta(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' · ') || '暂无补充说明';
}

function GenerationStatus({ status }: { status: AssistantArtifactGenerationStatus }) {
  const meta = [formatAssistantGenerationProgress(status), formatAssistantGenerationMetrics(status)]
    .filter(Boolean)
    .join(' · ');
  const percent =
    status.state === 'running' && status.totalSteps > 0
      ? Math.max(6, Math.min(100, Math.round((status.completedSteps / status.totalSteps) * 100)))
      : 0;
  const stateClass = {
    running: styles.statusRunning,
    success: styles.statusSuccess,
    empty: styles.statusEmpty,
    error: styles.statusError,
  }[status.state];
  return (
    <div className={`${styles.status} ${stateClass}`} role="status">
      <div className={styles.statusMessage}>{status.message}</div>
      {meta && <div className={styles.statusMeta}>{meta}</div>}
      {status.state === 'running' && (
        <div className={styles.progressTrack}>
          <div className={styles.progressBar} style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  );
}

/**
 * AI 助手的「上下文」分区：当前作用域下 AI 整理出的人物 / 设定 / 资料，以及章节关联资料。
 * 默认折叠，只显示计数；展开后可生成上下文、关联或移除资料。
 */
export const AssistantContextSection: React.FC<AssistantContextSectionProps> = ({
  scope,
  characters,
  loreEntries,
  materials,
  characterGenerationStatus = null,
  materialFiles = [],
  linkedMaterialPaths = [],
  onGenerate,
  onOpenMaterial,
  onAddMaterial,
  onRemoveMaterial,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [pendingMaterialPath, setPendingMaterialPath] = useState('');
  const addableMaterials = useMemo(
    () => materialFiles.filter((item) => !linkedMaterialPaths.includes(item.path)),
    [linkedMaterialPaths, materialFiles]
  );
  if (!scope) return null;

  const isChapter = scope.kind === 'chapter';
  const materialCount = (isChapter ? linkedMaterialPaths.length : 0) + materials.length;
  const summary = `人物 ${characters.length} · 设定 ${loreEntries.length} · 资料 ${materialCount}`;

  const blockHeader = (title: string, count: number, kind: AssistantContextKind) => (
    <div className={styles.blockHeader}>
      <span className={styles.blockTitle}>{title}</span>
      <span className={styles.blockCount}>{count} 项</span>
      {onGenerate && (
        <button
          type="button"
          className={styles.linkButton}
          disabled={kind === 'characters' && characterGenerationStatus?.state === 'running'}
          onClick={() => onGenerate(kind)}
        >
          AI 生成
        </button>
      )}
    </div>
  );

  return (
    <section className={styles.section} aria-label="上下文">
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className={styles.caret} aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
        <span className={styles.toggleTitle}>上下文</span>
        <span className={styles.toggleScope}>
          {SCOPE_PREFIX[scope.kind]}：{scope.label}
        </span>
        <span className={styles.toggleSummary}>{summary}</span>
      </button>

      {expanded && (
        <div className={styles.body}>
          <div className={styles.block}>
            {blockHeader('人物', characters.length, 'characters')}
            {characterGenerationStatus && <GenerationStatus status={characterGenerationStatus} />}
            {characters.length > 0 ? (
              <ul className={styles.list}>
                {characters.map((item, index) => (
                  <li key={`${item.name}-${index}`} className={styles.item}>
                    <div className={styles.itemTitle}>{item.name}</div>
                    <div className={styles.itemMeta}>{joinMeta([item.role, item.description])}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={styles.empty}>还没有为这个范围整理人物。</div>
            )}
          </div>

          <div className={styles.block}>
            {blockHeader('设定', loreEntries.length, 'lore')}
            {loreEntries.length > 0 ? (
              <ul className={styles.list}>
                {loreEntries.map((item, index) => (
                  <li key={`${item.title}-${index}`} className={styles.item}>
                    <div className={styles.itemTitle}>{item.title}</div>
                    <div className={styles.itemMeta}>{joinMeta([item.category, item.summary])}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={styles.empty}>还没有为这个范围整理设定。</div>
            )}
          </div>

          <div className={styles.block}>
            {blockHeader('资料', materialCount, 'materials')}
            {isChapter && linkedMaterialPaths.length > 0 && (
              <ul className={styles.list} aria-label="本章关联资料">
                {linkedMaterialPaths.map((path) => {
                  const label =
                    materialFiles.find((item) => item.path === path)?.name ||
                    path.split('/').pop() ||
                    path;
                  return (
                    <li key={path} className={styles.materialItem}>
                      <button
                        type="button"
                        className={styles.materialLink}
                        onClick={() => onOpenMaterial?.(path)}
                      >
                        {label}
                      </button>
                      {onRemoveMaterial && (
                        <button
                          type="button"
                          className={styles.linkButton}
                          aria-label={`从当前章移除 ${label}`}
                          onClick={() => onRemoveMaterial(path)}
                        >
                          移除
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {isChapter && onAddMaterial && addableMaterials.length > 0 && (
              <div className={styles.addRow}>
                <select
                  className={styles.select}
                  aria-label="选择要关联到当前章的资料"
                  value={pendingMaterialPath}
                  onChange={(event) => setPendingMaterialPath(event.target.value)}
                >
                  <option value="">选择一份资料关联到当前章</option>
                  {addableMaterials.map((item) => (
                    <option key={item.path} value={item.path}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={!pendingMaterialPath}
                  onClick={() => {
                    onAddMaterial(pendingMaterialPath);
                    setPendingMaterialPath('');
                  }}
                >
                  关联
                </button>
              </div>
            )}
            {materials.length > 0 && (
              <ul className={styles.list}>
                {materials.map((item, index) => (
                  <li key={`${item.title}-${index}`} className={styles.item}>
                    <div className={styles.itemTitle}>{item.title}</div>
                    <div className={styles.itemMeta}>
                      {joinMeta([item.kind, item.relatedChapter, item.summary])}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {materialCount === 0 && (
              <div className={styles.empty}>
                {isChapter
                  ? '可以把图片、文档或 PDF 关联到这一章，或让 AI 整理资料。'
                  : '还没有为这个范围整理资料。'}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

export default AssistantContextSection;
