import React from 'react';
import sharedStyles from '../../styles.module.scss';
import styles from './styles.module.scss';
import type { CharacterTimelineItem } from '../../types';
import { formatTimelineLineLabel } from '../helpers';
import type { CharacterTimelineController } from '../useCharacterTimeline';

/**
 * 人物经历时间线卡片：按章节顺序展示经历节点，支持拖拽排序、手工修订与跳回正文。
 */
export const CharacterTimelineSection: React.FC<{
  focusedTimeline: CharacterTimelineItem[];
  novelCorpusLoading: boolean;
  novelCorpusError: string;
  controller: CharacterTimelineController;
}> = ({ focusedTimeline, novelCorpusLoading, novelCorpusError, controller }) => {
  const {
    timelineEditor,
    timelineDraftChapterLabel,
    setTimelineDraftChapterLabel,
    timelineDraftTitle,
    setTimelineDraftTitle,
    timelineDraftSummary,
    setTimelineDraftSummary,
    timelineSaving,
    timelineDragIndex,
    timelineDropIndex,
    resetTimelineEditor,
    handleStartEditTimelineItem,
    handleStartCreateManualTimelineItem,
    hasTimelineOverride,
    handleSaveTimelineItem,
    handleRestoreAutoTimelineItem,
    handleDeleteManualTimelineItem,
    handleTimelineDragStart,
    handleTimelineDragEnd,
    handleTimelineDragOver,
    handleTimelineDrop,
    handleOpenTimelineSource,
  } = controller;

  return (
    <section className={sharedStyles.workspaceCardShell}>
      <div className={sharedStyles.workspaceCardHeader}>
        <span className={sharedStyles.workspaceSectionTitle}>经历时间线</span>
        <div className={sharedStyles.characterTimelineHeaderActions}>
          <span className={sharedStyles.workspaceListHint}>
            按整个作品目录的章节顺序自动提取，可拖动左侧手柄重排，也可直接手工修订和补充
          </span>
          <button
            type="button"
            className={sharedStyles.secondaryButton}
            onClick={handleStartCreateManualTimelineItem}
          >
            新增手工条目
          </button>
        </div>
      </div>
      {novelCorpusLoading ? (
        <div className={sharedStyles.workspaceBodyCopy}>正在汇总整个作品目录中的正文内容…</div>
      ) : novelCorpusError ? (
        <div className={sharedStyles.emptyHint}>作品语料加载失败：{novelCorpusError}</div>
      ) : focusedTimeline.length > 0 ? (
        <div className={styles.characterTimelineList}>
          {focusedTimeline.map((item, index) => {
            const isEditing = timelineEditor?.itemId === item.id;
            const isManualItem = item.source === 'manual';
            const hasManualRevision = item.source === 'auto' && hasTimelineOverride(item);
            const chapterBadgeLabel = item.chapterLabel || (isManualItem ? '手工补充' : '正文片段');
            const lineLabel = formatTimelineLineLabel(item.startLine, item.endLine);
            const canOpenTimelineSource =
              Boolean(item.sourcePath) && typeof item.startLine === 'number' && item.startLine > 0;

            return (
              <div
                key={item.id}
                className={`${styles.characterTimelineItem} ${
                  timelineDragIndex === index ? styles.characterTimelineDragging : ''
                } ${timelineDropIndex === index ? styles.characterTimelineDropTarget : ''}`}
                onDragOver={(event) => handleTimelineDragOver(event, index)}
                onDrop={(event) => void handleTimelineDrop(event, index)}
              >
                <div className={styles.characterTimelineMarker}>
                  <button
                    type="button"
                    className={styles.characterTimelineHandle}
                    title={isEditing ? '编辑中不可拖拽' : '拖拽排序'}
                    aria-label={isEditing ? '编辑中不可拖拽' : '拖拽排序'}
                    draggable={!isEditing}
                    disabled={isEditing}
                    onDragStart={(event) => handleTimelineDragStart(event, index)}
                    onDragEnd={handleTimelineDragEnd}
                  >
                    <span className={styles.characterTimelineHandleDots} aria-hidden="true">
                      <span className={styles.characterTimelineHandleDot} />
                      <span className={styles.characterTimelineHandleDot} />
                      <span className={styles.characterTimelineHandleDot} />
                      <span className={styles.characterTimelineHandleDot} />
                      <span className={styles.characterTimelineHandleDot} />
                      <span className={styles.characterTimelineHandleDot} />
                    </span>
                  </button>
                  <div className={styles.characterTimelineIndexBadge}>{chapterBadgeLabel}</div>
                </div>
                <div className={styles.characterTimelineBody}>
                  <div className={styles.characterTimelineHeader}>
                    <div>
                      <div className={styles.characterTimelineTitleRow}>
                        <div className={sharedStyles.workspaceListTitle}>{item.title}</div>
                        {isManualItem && (
                          <span className={styles.characterTimelineManualBadge}>手工整理</span>
                        )}
                        {hasManualRevision && (
                          <span className={styles.characterTimelineEditedBadge}>已手工修订</span>
                        )}
                      </div>
                      {item.sourceLabel && (
                        <div className={styles.characterTimelineSource}>
                          {[item.sourceLabel, lineLabel].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </div>
                    <div className={styles.characterTimelineMeta}>
                      {item.source === 'manual' ? '手工条目' : `提及 ${item.mentionCount || 0} 次`}
                    </div>
                  </div>
                  {timelineEditor?.itemId === item.id ? (
                    <div className={styles.characterTimelineEditor}>
                      <input
                        value={timelineDraftChapterLabel}
                        onChange={(event) => setTimelineDraftChapterLabel(event.target.value)}
                        placeholder="章节标签，例如：第23章"
                        className={sharedStyles.formInput}
                      />
                      <input
                        value={timelineDraftTitle}
                        onChange={(event) => setTimelineDraftTitle(event.target.value)}
                        placeholder="经历标题，例如：第三卷 · 身份暴露"
                        className={sharedStyles.formInput}
                      />
                      <textarea
                        value={timelineDraftSummary}
                        onChange={(event) => setTimelineDraftSummary(event.target.value)}
                        placeholder="补充这一段经历的真正变化、结果和影响"
                        className={sharedStyles.formTextarea}
                        rows={4}
                      />
                      <div className={styles.characterTimelineActionRow}>
                        <button
                          type="button"
                          className={sharedStyles.submitButton}
                          disabled={timelineSaving}
                          onClick={() => void handleSaveTimelineItem()}
                        >
                          {timelineSaving ? '保存中...' : '保存修订'}
                        </button>
                        <button
                          type="button"
                          className={sharedStyles.secondaryButton}
                          onClick={resetTimelineEditor}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className={sharedStyles.workspaceListDesc}>{item.summary}</div>
                      <div className={styles.characterTimelineActionRow}>
                        <button
                          type="button"
                          className={sharedStyles.secondaryButton}
                          onClick={() => handleStartEditTimelineItem(item)}
                        >
                          手工修订
                        </button>
                        {canOpenTimelineSource && (
                          <button
                            type="button"
                            className={sharedStyles.secondaryButton}
                            onClick={() => handleOpenTimelineSource(item)}
                          >
                            跳回正文
                          </button>
                        )}
                        {item.source === 'auto' && hasTimelineOverride(item) && (
                          <button
                            type="button"
                            className={sharedStyles.secondaryButton}
                            onClick={() => void handleRestoreAutoTimelineItem(item)}
                          >
                            恢复自动
                          </button>
                        )}
                        {item.source === 'manual' && (
                          <button
                            type="button"
                            className={sharedStyles.secondaryButton}
                            onClick={() => void handleDeleteManualTimelineItem(item.id)}
                          >
                            删除条目
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={sharedStyles.emptyHint}>整个作品目录里还没有抽取到这个人物的明确经历。</div>
      )}
    </section>
  );
};
