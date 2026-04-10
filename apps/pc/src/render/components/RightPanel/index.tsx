import React, { useMemo, useState } from 'react';
import { VscMultipleWindows } from 'react-icons/vsc';
import styles from './styles.module.scss';
import type { RightPanelProps } from './types';
import { StorylineView } from './StorylineView';
import {
  formatAssistantGenerationMetrics,
  formatAssistantGenerationProgress,
} from '../../utils/assistantGeneration';

const RightPanel: React.FC<RightPanelProps> = ({
  content,
  collapsed,
  onToggle,
  onPopOut,
  onScrollToLine,
  onReplaceLineText,
  folderPath,
  dbReady,
  currentLine,
  enabled = true,
  scopeKind = 'project',
  scopeLabel = '当前作品',
  outlineScope = null,
  materialFiles = [],
  linkedMaterialPaths = [],
  scopedCharacterGenerationStatus = null,
  scopedCharacters = [],
  scopedLoreEntries = [],
  scopedMaterials = [],
  onOpenMaterial,
  onAddMaterial,
  onRemoveMaterial,
}) => {
  const [pendingMaterialPath, setPendingMaterialPath] = useState('');
  const addableMaterials = useMemo(
    () => materialFiles.filter((item) => !linkedMaterialPaths.includes(item.path)),
    [linkedMaterialPaths, materialFiles]
  );
  const scopeText =
    scopeKind === 'chapter'
      ? `当前章：${scopeLabel}`
      : scopeKind === 'volume'
        ? `当前卷：${scopeLabel}`
        : `当前作品：${scopeLabel}`;
  const characterGenerationProgress = useMemo(
    () => formatAssistantGenerationProgress(scopedCharacterGenerationStatus),
    [scopedCharacterGenerationStatus]
  );
  const characterGenerationMetrics = useMemo(
    () => formatAssistantGenerationMetrics(scopedCharacterGenerationStatus),
    [scopedCharacterGenerationStatus]
  );
  const characterProgressPercent =
    scopedCharacterGenerationStatus?.state === 'running' &&
    scopedCharacterGenerationStatus.totalSteps > 0
      ? Math.max(
          6,
          Math.min(
            100,
            Math.round(
              (scopedCharacterGenerationStatus.completedSteps /
                scopedCharacterGenerationStatus.totalSteps) *
                100
            )
          )
        )
      : 0;

  if (collapsed) {
    return (
      <div className={styles.collapsedPanel}>
        <button className={styles.expandButton} onClick={onToggle} title="展开面板">
          ◀
        </button>
      </div>
    );
  }

  return (
    <div className={styles.rightPanel}>
      <div className={styles.panelHeader}>
        <div className={styles.tabs}>
          <span className={`${styles.tab} ${styles.active}`}>作品助手</span>
        </div>
        <div className={styles.headerActions}>
          {onPopOut && (
            <button className={styles.popOutButton} onClick={onPopOut} title="在新窗口中打开">
              <VscMultipleWindows />
            </button>
          )}
          <button className={styles.collapseButton} onClick={onToggle} title="折叠面板">
            ▶
          </button>
        </div>
      </div>
      <div className={styles.panelContent}>
        {enabled ? (
          <>
            <div className={styles.assistantScopeHint}>
              {scopeText} · 作品级规划与当前作用域上下文
            </div>
            <div className={styles.scopeContextSection}>
              <div className={styles.scopeContextCard}>
                <div className={styles.chapterMaterialsHeader}>
                  <span>{scopeKind === 'chapter' ? '当前章人物' : 'AI 人物上下文'}</span>
                  <span className={styles.chapterMaterialsCount}>{scopedCharacters.length} 项</span>
                </div>
                {scopedCharacterGenerationStatus && (
                  <div
                    className={`${styles.scopeGenerationStatus} ${
                      scopedCharacterGenerationStatus.state === 'running'
                        ? styles.scopeGenerationStatusRunning
                        : scopedCharacterGenerationStatus.state === 'error'
                          ? styles.scopeGenerationStatusError
                          : scopedCharacterGenerationStatus.state === 'empty'
                            ? styles.scopeGenerationStatusEmpty
                            : styles.scopeGenerationStatusSuccess
                    }`}
                  >
                    <div className={styles.scopeGenerationStatusMessage}>
                      {scopedCharacterGenerationStatus.message}
                    </div>
                    {(characterGenerationProgress || characterGenerationMetrics) && (
                      <div className={styles.scopeGenerationStatusMeta}>
                        {[characterGenerationProgress, characterGenerationMetrics]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    )}
                    {scopedCharacterGenerationStatus.state === 'running' && (
                      <div className={styles.scopeGenerationProgressTrack}>
                        <div
                          className={styles.scopeGenerationProgressBar}
                          style={{ width: `${characterProgressPercent}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}
                {scopedCharacters.length > 0 ? (
                  <div className={styles.scopeContextList}>
                    {scopedCharacters.map((item, index) => (
                      <div key={`${item.name}-${index}`} className={styles.scopeContextItem}>
                        <div className={styles.scopeContextTitle}>{item.name}</div>
                        <div className={styles.scopeContextMeta}>
                          {[item.role, item.description].filter(Boolean).join(' · ') ||
                            '暂无补充说明'}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.emptyHint}>这个作用域还没有生成人物上下文。</div>
                )}
              </div>
              <div className={styles.scopeContextCard}>
                <div className={styles.chapterMaterialsHeader}>
                  <span>{scopeKind === 'chapter' ? '当前章设定' : 'AI 设定上下文'}</span>
                  <span className={styles.chapterMaterialsCount}>
                    {scopedLoreEntries.length} 项
                  </span>
                </div>
                {scopedLoreEntries.length > 0 ? (
                  <div className={styles.scopeContextList}>
                    {scopedLoreEntries.map((item, index) => (
                      <div key={`${item.title}-${index}`} className={styles.scopeContextItem}>
                        <div className={styles.scopeContextTitle}>{item.title}</div>
                        <div className={styles.scopeContextMeta}>
                          {[item.category, item.summary].filter(Boolean).join(' · ') ||
                            '暂无补充说明'}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.emptyHint}>这个作用域还没有生成设定上下文。</div>
                )}
              </div>
              <div className={styles.scopeContextCard}>
                <div className={styles.chapterMaterialsHeader}>
                  <span>{scopeKind === 'chapter' ? '当前章资料' : 'AI 资料上下文'}</span>
                  <span className={styles.chapterMaterialsCount}>
                    {scopeKind === 'chapter'
                      ? linkedMaterialPaths.length + scopedMaterials.length
                      : scopedMaterials.length}{' '}
                    项
                  </span>
                </div>
                {scopeKind === 'chapter' && (
                  <>
                    {linkedMaterialPaths.length > 0 ? (
                      <div className={styles.chapterMaterialsList}>
                        {linkedMaterialPaths.map((path) => {
                          const material = materialFiles.find((item) => item.path === path);
                          const label = material?.name || path.split('/').pop() || path;
                          return (
                            <div key={path} className={styles.chapterMaterialItem}>
                              <button
                                type="button"
                                className={styles.chapterMaterialLink}
                                onClick={() => onOpenMaterial?.(path)}
                              >
                                {label}
                              </button>
                              <button
                                type="button"
                                className={styles.chapterMaterialAction}
                                onClick={() => onRemoveMaterial?.(path)}
                              >
                                移除
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    {addableMaterials.length > 0 && (
                      <div className={styles.chapterMaterialsAddRow}>
                        <select
                          className={styles.chapterMaterialsSelect}
                          value={pendingMaterialPath}
                          onChange={(event) => setPendingMaterialPath(event.target.value)}
                        >
                          <option value="">选择一份资料加入当前章</option>
                          {addableMaterials.map((item) => (
                            <option key={item.path} value={item.path}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className={styles.chapterMaterialPrimary}
                          disabled={!pendingMaterialPath}
                          onClick={() => {
                            if (!pendingMaterialPath) return;
                            onAddMaterial?.(pendingMaterialPath);
                            setPendingMaterialPath('');
                          }}
                        >
                          关联
                        </button>
                      </div>
                    )}
                  </>
                )}
                {scopedMaterials.length > 0 ? (
                  <div className={styles.scopeContextList}>
                    {scopedMaterials.map((item, index) => (
                      <div key={`${item.title}-${index}`} className={styles.scopeContextItem}>
                        <div className={styles.scopeContextTitle}>{item.title}</div>
                        <div className={styles.scopeContextMeta}>
                          {[item.kind, item.relatedChapter, item.summary]
                            .filter(Boolean)
                            .join(' · ') || '暂无补充说明'}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : scopeKind !== 'chapter' && linkedMaterialPaths.length === 0 ? (
                  <div className={styles.emptyHint}>这个作用域还没有生成资料上下文。</div>
                ) : null}
                {scopeKind === 'chapter' &&
                  linkedMaterialPaths.length === 0 &&
                  scopedMaterials.length === 0 && (
                    <div className={styles.emptyHint}>
                      先把图片、文档或 PDF 关联到这一章，或为当前章生成资料上下文。
                    </div>
                  )}
              </div>
            </div>
            <StorylineView
              content={content}
              onScrollToLine={onScrollToLine}
              onReplaceLineText={onReplaceLineText}
              folderPath={folderPath}
              dbReady={dbReady}
              currentLine={currentLine}
              scopeKind={scopeKind}
              scopeLabel={scopeLabel}
              outlineScope={outlineScope}
            />
          </>
        ) : (
          <div className={styles.emptyHint}>
            打开作品后，可在这里查看作品规划，以及当前作品、卷或章节的人物、设定、资料上下文。
          </div>
        )}
      </div>
    </div>
  );
};

export default RightPanel;
