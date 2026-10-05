import React from 'react';
import styles from '../../styles.module.scss';
import { FlowCard } from '../../FlowCards';
import {
  normalizeIdeaTags,
  STORY_IDEA_SOURCE_LABELS,
  STORY_IDEA_STATUS_LABELS,
  STORY_IDEA_TERM_SECTION_LABELS,
  type StoryIdeaCardDraft,
} from '../../story-idea';
import {
  STORY_IDEA_TERM_CARD_DESCRIPTIONS,
  STORY_IDEA_TERM_ORDER,
  type StoryIdeaInteractionMode,
} from '../helpers';
import { StoryIdeaTermEditor } from '../StoryIdeaTermEditor';
import type { StoryIdeaTermsController } from '../useStoryIdeaTerms';

interface StoryIdeaTermsCardProps {
  interactionMode: StoryIdeaInteractionMode;
  showOptionalInputs: boolean;
  setShowOptionalInputs: React.Dispatch<React.SetStateAction<boolean>>;
  hasOptionalConstraints: boolean;
  draft: StoryIdeaCardDraft;
  setField: <K extends keyof StoryIdeaCardDraft>(key: K, value: StoryIdeaCardDraft[K]) => void;
  working: boolean;
  aiActionsReady: boolean;
  poolSourceFilter: 'all' | 'history' | 'ai' | 'manual';
  setPoolSourceFilter: (filter: 'all' | 'history' | 'ai' | 'manual') => void;
  handleDeleteCard: () => Promise<void>;
  handleGenerateOutputs: () => Promise<void>;
  terms: StoryIdeaTermsController;
}

/**
 * ③ 三张签卡：可选限定、词池来源筛选，以及新手向导 / 高级三签并列编辑。
 */
export const StoryIdeaTermsCard: React.FC<StoryIdeaTermsCardProps> = ({
  interactionMode,
  showOptionalInputs,
  setShowOptionalInputs,
  hasOptionalConstraints,
  draft,
  setField,
  working,
  aiActionsReady,
  poolSourceFilter,
  setPoolSourceFilter,
  handleDeleteCard,
  handleGenerateOutputs,
  terms,
}) => {
  const {
    activeTermSection,
    setActiveTermSection,
    filteredTermPool,
    activeTermStepIndex,
    activeTermValue,
    guidedTermSteps,
    activeGuidedTermStep,
    handleAddCurrentTermsToPool,
    handleRequestRelatedTerms,
    handleRedrawRandom,
    handlePickPoolTerm,
    handleToggleTermSection,
    handleQuickFillFromPool,
    handleGoToNextTermStep,
    handleGoToPrevTermStep,
  } = terms;

  return (
    <FlowCard
      tone="default"
      title="③ 三张签卡"
      subtitle="顶部始终先看这组三签。你只需要盯住当前一张，反复扩它，直到觉得可以收束。"
      actions={
        <div className={styles.storyIdeaEditorActions}>
          {!showOptionalInputs && hasOptionalConstraints && interactionMode === 'advanced' && (
            <span className={styles.storyIdeaConstraintPill}>这张卡带有限定</span>
          )}
          {interactionMode === 'advanced' && (
            <button
              className={styles.outlineSecondaryButton}
              onClick={() => setShowOptionalInputs((current) => !current)}
            >
              {showOptionalInputs ? '收起限定' : '补充限定（可选）'}
            </button>
          )}
        </div>
      }
    >
      {interactionMode === 'advanced' && hasOptionalConstraints && !showOptionalInputs && (
        <div className={styles.storyIdeaConstraintSummary}>
          {draft.premise.trim() || '这张卡已带有补充限定'}
        </div>
      )}

      {interactionMode === 'advanced' && showOptionalInputs && (
        <div className={styles.storyIdeaOptionalPanel}>
          <label className={styles.storyIdeaField}>
            <span className={styles.storyIdeaFieldLabel}>标题</span>
            <input
              className={styles.storyIdeaInput}
              value={draft.title}
              onChange={(event) => setField('title', event.target.value)}
            />
          </label>

          <label className={styles.storyIdeaField}>
            <span className={styles.storyIdeaFieldLabel}>一句话 premise</span>
            <textarea
              className={styles.storyIdeaTextarea}
              value={draft.premise}
              onChange={(event) => setField('premise', event.target.value)}
              rows={2}
              placeholder="可选：补一句你想要的故事方向"
            />
          </label>

          <label className={styles.storyIdeaField}>
            <span className={styles.storyIdeaFieldLabel}>标签</span>
            <input
              className={styles.storyIdeaInput}
              value={draft.tags.join('，')}
              onChange={(event) => setField('tags', normalizeIdeaTags(event.target.value))}
              placeholder="悬疑，校园，双线"
            />
          </label>

          <label className={styles.storyIdeaField}>
            <span className={styles.storyIdeaFieldLabel}>联想备注</span>
            <textarea
              className={styles.storyIdeaTextarea}
              value={draft.note}
              onChange={(event) => setField('note', event.target.value)}
              rows={2}
              placeholder="可选：只在你想主动加限定时再写"
            />
          </label>

          <div className={styles.storyIdeaFilterRow}>
            <label className={styles.storyIdeaField}>
              <span className={styles.storyIdeaFieldLabel}>状态</span>
              <select
                className={styles.storyIdeaSelect}
                value={draft.status}
                onChange={(event) =>
                  setField('status', event.target.value as StoryIdeaCardDraft['status'])
                }
              >
                {Object.entries(STORY_IDEA_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.storyIdeaField}>
              <span className={styles.storyIdeaFieldLabel}>来源</span>
              <select
                className={styles.storyIdeaSelect}
                value={draft.source}
                onChange={(event) =>
                  setField('source', event.target.value as StoryIdeaCardDraft['source'])
                }
              >
                {Object.entries(STORY_IDEA_SOURCE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className={styles.storyIdeaEditorActions}>
            <button
              className={styles.outlineSecondaryButton}
              onClick={() =>
                window.dispatchEvent(new CustomEvent('open-settings-tab', { detail: 'ai' }))
              }
              disabled={working}
              type="button"
            >
              AI 设置
            </button>
            <button
              className={styles.outlineSecondaryButton}
              onClick={() => void handleDeleteCard()}
              disabled={working}
              type="button"
            >
              删除卡片
            </button>
          </div>
        </div>
      )}

      <div className={styles.storyIdeaSignatureStack}>
        <div className={styles.storyIdeaSignatureIntro}>
          {interactionMode === 'guided'
            ? '每张签只要先写 2 到 3 个词就够了。不要试图一次填满三张，先盯住你最有感觉的那一张继续补。'
            : '三签的本质，不是按流程填表，而是先抓题眼、冲突、变形三种不同张力，再让其中一张被你不断掰开。真正的使用节奏是：先扩一张，再看是否值得收束，而不是从上到下机械填完。'}
        </div>
        {interactionMode === 'advanced' && (
          <div className={styles.storyIdeaPoolFilterRow}>
            <div className={styles.storyIdeaPoolFilterHeader}>
              <span className={styles.storyIdeaFieldLabel}>词池来源</span>
              <span className={styles.storyIdeaPoolFilterHint}>记住上次筛选，下次打开沿用</span>
            </div>
            <div className={styles.storyIdeaTagCloud}>
              {[
                { value: 'all', label: '全部' },
                { value: 'history', label: '历史' },
                { value: 'ai', label: 'AI' },
                { value: 'manual', label: '手动' },
              ].map((item) => (
                <button
                  key={item.value}
                  className={`${styles.storyIdeaTagChip} ${poolSourceFilter === item.value ? styles.storyIdeaTagChipActive : ''}`}
                  onClick={() =>
                    setPoolSourceFilter(item.value as 'all' | 'history' | 'ai' | 'manual')
                  }
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {interactionMode === 'guided' ? (
          <div className={styles.storyIdeaWizardColumn}>
            <div className={styles.storyIdeaWizardProgress}>
              {guidedTermSteps.map((step, index) => {
                const isActive = step.section === activeTermSection;
                const isDone = step.value.length >= 2;
                return (
                  <button
                    key={step.section}
                    className={`${styles.storyIdeaWizardStep} ${isActive ? styles.storyIdeaWizardStepActive : ''} ${isDone ? styles.storyIdeaWizardStepDone : ''}`}
                    onClick={() => setActiveTermSection(step.section)}
                    type="button"
                  >
                    <span className={styles.storyIdeaWizardStepIndex}>{index + 1}</span>
                    <span className={styles.storyIdeaWizardStepText}>{step.label}</span>
                  </button>
                );
              })}
            </div>

            {activeGuidedTermStep && (
              <StoryIdeaTermEditor
                section={activeGuidedTermStep.section}
                label={activeGuidedTermStep.label}
                description={activeGuidedTermStep.description}
                isExpanded
                value={activeGuidedTermStep.value}
                poolTerms={activeGuidedTermStep.poolTerms}
                compactMode
                placeholder={activeGuidedTermStep.placeholder}
                working={working}
                onToggle={handleToggleTermSection}
                onChange={(next) => {
                  if (activeGuidedTermStep.section === 'theme') setField('themeTerms', next);
                  else if (activeGuidedTermStep.section === 'conflict') {
                    setField('conflictTerms', next);
                  } else {
                    setField('twistTerms', next);
                  }
                }}
                onAddCurrentToPool={handleAddCurrentTermsToPool}
                onQuickFillFromPool={handleQuickFillFromPool}
                onRequestRelated={handleRequestRelatedTerms}
                onRedrawRandom={handleRedrawRandom}
                onPickPoolTerm={handlePickPoolTerm}
              />
            )}

            <div className={styles.storyIdeaWizardFooter}>
              <div className={styles.storyIdeaQuickGuideHint}>
                当前这一步先凑够 2 到 3 个词就行，不需要想太满。
              </div>
              <div className={styles.storyIdeaWizardActions}>
                <button
                  className={styles.outlineSecondaryButton}
                  onClick={() => void handleGoToPrevTermStep()}
                  disabled={activeTermStepIndex <= 0}
                  type="button"
                >
                  上一步
                </button>
                {activeTermStepIndex < STORY_IDEA_TERM_ORDER.length - 1 ? (
                  <button
                    className={styles.outlineActionButton}
                    onClick={() => void handleGoToNextTermStep()}
                    disabled={working || activeTermValue.length === 0}
                    type="button"
                  >
                    下一步
                  </button>
                ) : (
                  <button
                    className={styles.outlineActionButton}
                    onClick={() => void handleGenerateOutputs()}
                    disabled={working || !aiActionsReady}
                    type="button"
                  >
                    去生成候选
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.storyIdeaSignatureDeck}>
            <StoryIdeaTermEditor
              section="theme"
              label={STORY_IDEA_TERM_SECTION_LABELS.theme}
              description={STORY_IDEA_TERM_CARD_DESCRIPTIONS.theme}
              isExpanded={activeTermSection === 'theme'}
              value={draft.themeTerms}
              poolTerms={filteredTermPool.theme}
              compactMode={false}
              placeholder="例如：雨夜，失约，旧校舍，借名人生"
              working={working}
              onToggle={handleToggleTermSection}
              onChange={(next) => setField('themeTerms', next)}
              onAddCurrentToPool={handleAddCurrentTermsToPool}
              onQuickFillFromPool={handleQuickFillFromPool}
              onRequestRelated={handleRequestRelatedTerms}
              onRedrawRandom={handleRedrawRandom}
              onPickPoolTerm={handlePickPoolTerm}
            />
            <StoryIdeaTermEditor
              section="conflict"
              label={STORY_IDEA_TERM_SECTION_LABELS.conflict}
              description={STORY_IDEA_TERM_CARD_DESCRIPTIONS.conflict}
              isExpanded={activeTermSection === 'conflict'}
              value={draft.conflictTerms}
              poolTerms={filteredTermPool.conflict}
              compactMode={false}
              placeholder="例如：冒名顶替，被迫合作，证词作废，代价升级"
              working={working}
              onToggle={handleToggleTermSection}
              onChange={(next) => setField('conflictTerms', next)}
              onAddCurrentToPool={handleAddCurrentTermsToPool}
              onQuickFillFromPool={handleQuickFillFromPool}
              onRequestRelated={handleRequestRelatedTerms}
              onRedrawRandom={handleRedrawRandom}
              onPickPoolTerm={handlePickPoolTerm}
            />
            <StoryIdeaTermEditor
              section="twist"
              label={STORY_IDEA_TERM_SECTION_LABELS.twist}
              description={STORY_IDEA_TERM_CARD_DESCRIPTIONS.twist}
              isExpanded={activeTermSection === 'twist'}
              value={draft.twistTerms}
              poolTerms={filteredTermPool.twist}
              compactMode={false}
              placeholder="例如：救人者才是幕后人，胜利即暴露，记忆被嫁接"
              working={working}
              onToggle={handleToggleTermSection}
              onChange={(next) => setField('twistTerms', next)}
              onAddCurrentToPool={handleAddCurrentTermsToPool}
              onQuickFillFromPool={handleQuickFillFromPool}
              onRequestRelated={handleRequestRelatedTerms}
              onRedrawRandom={handleRedrawRandom}
              onPickPoolTerm={handlePickPoolTerm}
            />
          </div>
        )}
      </div>
    </FlowCard>
  );
};
