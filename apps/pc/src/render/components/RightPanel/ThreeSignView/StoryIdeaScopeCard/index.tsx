import React from 'react';
import styles from '../../styles.module.scss';
import { FlowCard } from '../../FlowCards';
import {
  STORY_IDEA_GENERATION_SCOPE_LABELS,
  type StoryIdeaGenerationScope,
} from '../../story-idea';
import type { StoryIdeaInteractionMode } from '../helpers';

interface StoryIdeaScopeCardProps {
  interactionMode: StoryIdeaInteractionMode;
  generationScope: StoryIdeaGenerationScope;
  setGenerationScope: (scope: StoryIdeaGenerationScope) => void;
  generationGuidance: string;
  setGenerationGuidance: (guidance: string) => void;
  working: boolean;
  aiActionsReady: boolean;
  hasContent: boolean;
  hasActiveCard: boolean;
  hasSelectedOutlineDirection: boolean;
  handleExtractFromContent: () => Promise<void>;
  handleCreateCard: () => Promise<void>;
  handleGenerateSeeds: () => Promise<void>;
  handleGenerateOutputs: () => Promise<void>;
  handlePromote: () => Promise<void>;
}

/**
 * ② 当前发想范围：设定生成范围与限定，并触发抓签 / 补签 / 收束。
 */
export const StoryIdeaScopeCard: React.FC<StoryIdeaScopeCardProps> = ({
  interactionMode,
  generationScope,
  setGenerationScope,
  generationGuidance,
  setGenerationGuidance,
  working,
  aiActionsReady,
  hasContent,
  hasActiveCard,
  hasSelectedOutlineDirection,
  handleExtractFromContent,
  handleCreateCard,
  handleGenerateSeeds,
  handleGenerateOutputs,
  handlePromote,
}) => {
  return (
    <FlowCard
      tone="accent"
      title="② 当前发想范围"
      subtitle="三签不必被当前章节锁死。先定范围，再决定这轮是向外发散还是开始收束。"
      actions={
        <div className={styles.storyIdeaEditorActions}>
          <button
            className={styles.outlineActionButton}
            onClick={() => void handleExtractFromContent()}
            disabled={working || !aiActionsReady || !hasContent}
            type="button"
          >
            从正文抓一轮标签
          </button>
          <button
            className={styles.outlineSecondaryButton}
            onClick={() => void handleCreateCard()}
            type="button"
          >
            新建空白灵感卡
          </button>
        </div>
      }
    >
      {interactionMode === 'advanced' ? (
        <>
          <div className={styles.storyIdeaTagCloud}>
            {Object.entries(STORY_IDEA_GENERATION_SCOPE_LABELS).map(([value, label]) => (
              <button
                key={value}
                className={`${styles.storyIdeaTagChip} ${generationScope === value ? styles.storyIdeaTagChipActive : ''}`}
                onClick={() => setGenerationScope(value as StoryIdeaGenerationScope)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <label className={styles.storyIdeaField}>
            <span className={styles.storyIdeaFieldLabel}>用户限定 / 自动返回范围</span>
            <textarea
              className={styles.storyIdeaTextarea}
              value={generationGuidance}
              onChange={(event) => setGenerationGuidance(event.target.value)}
              rows={2}
              placeholder="例如：先围绕师生关系与身份错位发散，但最后仍要能回到校园悬疑主线"
            />
          </label>
        </>
      ) : (
        <div className={styles.storyIdeaQuickGuideHint}>
          默认会同时参考当前正文和整张卡的方向。看不懂这些范围参数时，不用调，直接点下面按钮开始。
        </div>
      )}
      <div className={styles.storyIdeaDecisionBar}>
        <button
          className={styles.outlineActionButton}
          onClick={() => void handleExtractFromContent()}
          disabled={working || !aiActionsReady || !hasContent}
          type="button"
        >
          从正文抓三签
        </button>
        <button
          className={styles.outlineSecondaryButton}
          onClick={() => void handleGenerateSeeds()}
          disabled={working || !aiActionsReady}
          type="button"
        >
          AI 直接补三签
        </button>
        {interactionMode === 'advanced' && (
          <>
            <button
              className={styles.outlineSecondaryButton}
              onClick={() => void handleGenerateOutputs()}
              disabled={working || !aiActionsReady}
              type="button"
            >
              直接收束成候选
            </button>
            <button
              className={styles.outlineSecondaryButton}
              onClick={() => void handlePromote()}
              disabled={!hasActiveCard || working || !hasSelectedOutlineDirection}
              type="button"
            >
              转为大纲
            </button>
          </>
        )}
      </div>
    </FlowCard>
  );
};
