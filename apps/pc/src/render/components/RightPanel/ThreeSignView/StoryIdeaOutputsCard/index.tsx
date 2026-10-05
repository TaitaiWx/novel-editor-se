import React from 'react';
import type {
  PersistedOutlineVersionRow,
  StoryIdeaCardRow,
  StoryIdeaOutputRow,
  StoryIdeaOutputType,
} from '@/render/types/electron-api';
import styles from '../../styles.module.scss';
import { FlowCard } from '../../FlowCards';
import {
  parseStoryIdeaSnapshot,
  STORY_IDEA_OUTPUT_LABELS,
  type StoryIdeaCardDraft,
} from '../../story-idea';
import type { useStoryIdeaCards } from '../../useStoryIdeaCards';
import { readOutputMeta, type StoryIdeaInteractionMode } from '../helpers';

type StoryIdeaCardsApi = ReturnType<typeof useStoryIdeaCards>;

interface StoryIdeaOutputsCardProps {
  interactionMode: StoryIdeaInteractionMode;
  outputTypeFilter: 'all' | StoryIdeaOutputType;
  setOutputTypeFilter: (filter: 'all' | StoryIdeaOutputType) => void;
  selectedOnly: boolean;
  setSelectedOnly: React.Dispatch<React.SetStateAction<boolean>>;
  outputsByType: StoryIdeaCardsApi['outputsByType'];
  outputCards: Array<{ type: StoryIdeaOutputType; output: StoryIdeaOutputRow }>;
  filteredOutputCards: Array<{ type: StoryIdeaOutputType; output: StoryIdeaOutputRow }>;
  acts: StoryIdeaCardsApi['acts'];
  boardTargetActIndex: number;
  setBoardTargetActIndex: (index: number) => void;
  activeCard: StoryIdeaCardRow;
  draft: StoryIdeaCardDraft;
  working: boolean;
  linkedOutlineVersions: PersistedOutlineVersionRow[];
  selectOutput: StoryIdeaCardsApi['selectOutput'];
  pushSceneHookToBoard: StoryIdeaCardsApi['pushSceneHookToBoard'];
  promoteToOutline: StoryIdeaCardsApi['promoteToOutline'];
  deleteOutput: StoryIdeaCardsApi['deleteOutput'];
}

/**
 * ⑤ 候选结果：筛选 logline / 场景钩子 / 大纲方向，采用、送情节板或转大纲。
 */
export const StoryIdeaOutputsCard: React.FC<StoryIdeaOutputsCardProps> = ({
  interactionMode,
  outputTypeFilter,
  setOutputTypeFilter,
  selectedOnly,
  setSelectedOnly,
  outputsByType,
  outputCards,
  filteredOutputCards,
  acts,
  boardTargetActIndex,
  setBoardTargetActIndex,
  activeCard,
  draft,
  working,
  linkedOutlineVersions,
  selectOutput,
  pushSceneHookToBoard,
  promoteToOutline,
  deleteOutput,
}) => {
  return (
    <FlowCard
      tone="plain"
      title="⑤ 候选结果"
      subtitle="收束产出的 logline、场景钩子和大纲方向，筛选后送出或继续迭代。"
      meta={
        interactionMode === 'advanced' ? (
          <div className={styles.storyIdeaOutputTypeSummary}>
            <button
              className={`${styles.storyIdeaOutputTypeChip} ${outputTypeFilter === 'all' ? styles.storyIdeaOutputTypeChipActive : ''}`}
              onClick={() => setOutputTypeFilter('all')}
              type="button"
            >
              全部 {outputCards.length}
            </button>
            {(['logline', 'scene_hook', 'outline_direction'] as const).map((type) => (
              <button
                key={type}
                className={`${styles.storyIdeaOutputTypeChip} ${outputTypeFilter === type ? styles.storyIdeaOutputTypeChipActive : ''}`}
                onClick={() => setOutputTypeFilter(type)}
                type="button"
              >
                {STORY_IDEA_OUTPUT_LABELS[type]} {outputsByType[type].length}
              </button>
            ))}
            <button
              className={`${styles.storyIdeaOutputTypeChip} ${selectedOnly ? styles.storyIdeaOutputTypeChipActive : ''}`}
              onClick={() => setSelectedOnly((current) => !current)}
              type="button"
            >
              只看已采用
            </button>
          </div>
        ) : undefined
      }
    >
      {(interactionMode === 'advanced' || acts.length > 0) && (
        <div className={styles.storyIdeaOutputControlBar}>
          <label className={styles.storyIdeaField}>
            <span className={styles.storyIdeaFieldLabel}>送情节板目标幕</span>
            <select
              className={styles.storyIdeaSelect}
              value={acts.length === 0 ? '' : String(boardTargetActIndex)}
              onChange={(event) => setBoardTargetActIndex(Number(event.target.value))}
              disabled={acts.length === 0}
            >
              {acts.length === 0 ? (
                <option value="">正文里还没有幕结构</option>
              ) : (
                acts.map((act) => (
                  <option key={act.index} value={act.index}>
                    {act.title}
                  </option>
                ))
              )}
            </select>
          </label>
        </div>
      )}
      {filteredOutputCards.length === 0 ? (
        <div className={styles.storyIdeaOutputEmpty}>
          {outputCards.length === 0 ? '先点“生成候选”' : '当前筛选下没有匹配结果'}
        </div>
      ) : (
        <div className={styles.storyIdeaOutputWaterfall}>
          {filteredOutputCards.map(({ type, output }) => {
            const meta = readOutputMeta(output);
            const metaText =
              typeof meta.reason === 'string'
                ? meta.reason
                : typeof meta.focus === 'string'
                  ? meta.focus
                  : typeof meta.summary === 'string'
                    ? meta.summary
                    : '';

            return (
              <article
                key={output.id}
                className={`${styles.storyIdeaOutputCard} ${output.is_selected === 1 ? styles.storyIdeaOutputCardSelected : ''}`}
              >
                <div className={styles.storyIdeaOutputCardTop}>
                  <span className={styles.storyIdeaOutputTypeBadge}>
                    {STORY_IDEA_OUTPUT_LABELS[type]}
                  </span>
                  {output.is_selected === 1 && (
                    <span className={styles.storyIdeaOutputSelectedBadge}>当前采用</span>
                  )}
                </div>
                <div className={styles.storyIdeaOutputContent}>{output.content}</div>
                {metaText && <div className={styles.storyIdeaOutputMeta}>{metaText}</div>}
                <div className={styles.storyIdeaOutputActions}>
                  <button
                    className={styles.outlineSecondaryButton}
                    onClick={() => void selectOutput(activeCard, output)}
                    disabled={working}
                  >
                    {output.is_selected === 1 ? '已采用' : '采用'}
                  </button>
                  {type === 'scene_hook' && (
                    <button
                      className={styles.outlineSecondaryButton}
                      onClick={() =>
                        void pushSceneHookToBoard(activeCard, output, boardTargetActIndex)
                      }
                      disabled={working || acts.length === 0}
                    >
                      送情节板
                    </button>
                  )}
                  {type === 'outline_direction' && (
                    <button
                      className={styles.outlineSecondaryButton}
                      onClick={() => void promoteToOutline(activeCard, draft, output)}
                      disabled={working}
                    >
                      转大纲
                    </button>
                  )}
                  <button
                    className={styles.outlineSecondaryButton}
                    onClick={() => void deleteOutput(output.id, activeCard.id)}
                    disabled={working}
                  >
                    删除
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {(interactionMode === 'advanced' || linkedOutlineVersions.length > 0) && (
        <div className={styles.storyIdeaVersionTraceSection}>
          <div className={styles.storyIdeaOutputHeader}>
            <span className={styles.storyIdeaOutputTitle}>关联大纲版本</span>
            <span className={styles.storyIdeaOutputCount}>{linkedOutlineVersions.length} 个</span>
          </div>
          {linkedOutlineVersions.length === 0 ? (
            <div className={styles.storyIdeaOutputEmpty}>这张卡还没有转出任何大纲版本</div>
          ) : (
            linkedOutlineVersions.map((version) => {
              const snapshot = parseStoryIdeaSnapshot(version.story_idea_snapshot_json);
              return (
                <div key={version.id} className={styles.storyIdeaTraceCard}>
                  <div className={styles.storyIdeaTraceTitle}>{version.name}</div>
                  <div className={styles.storyIdeaOutputMeta}>
                    {new Date(version.created_at).toLocaleString()} / {version.total_nodes} 节点
                  </div>
                  {snapshot && (
                    <div className={styles.storyIdeaTraceTerms}>
                      {[...snapshot.themeTerms, ...snapshot.conflictTerms, ...snapshot.twistTerms]
                        .slice(0, 9)
                        .map((term) => (
                          <span key={`${version.id}-${term}`} className={styles.storyIdeaTermChip}>
                            {term}
                          </span>
                        ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </FlowCard>
  );
};
