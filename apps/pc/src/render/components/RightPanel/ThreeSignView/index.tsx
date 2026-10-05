import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styles from '../styles.module.scss';
import { useAiConfig } from '../useAiConfig';
import { useDialog } from '../../Dialog';
import { useStoryIdeaCards } from '../useStoryIdeaCards';
import { FlowCard } from '../FlowCards';
import {
  createEmptyStoryIdeaDraft,
  pickSelectedOutput,
  type StoryIdeaGenerationConfig,
  type StoryIdeaGenerationScope,
} from '../story-idea';
import {
  OPEN_STORY_IDEA_CARD_EVENT,
  buildTransientStoryIdeaCard,
  createGeneratedCardTitle,
  type StoryIdeaInteractionMode,
} from './helpers';
import { useStoryIdeaFilterPersistence } from './useStoryIdeaFilterPersistence';
import { useStoryIdeaHistoryFilter } from './useStoryIdeaHistoryFilter';
import { useStoryIdeaDraft } from './useStoryIdeaDraft';
import { useStoryIdeaTerms } from './useStoryIdeaTerms';
import { StoryIdeaHistorySection } from './StoryIdeaHistorySection';
import { StoryIdeaScopeCard } from './StoryIdeaScopeCard';
import { StoryIdeaTermsCard } from './StoryIdeaTermsCard';
import { StoryIdeaOutputsCard } from './StoryIdeaOutputsCard';

export const ThreeSignView: React.FC<{
  content: string;
  folderPath: string | null;
  dbReady: boolean;
  currentLine?: number;
}> = React.memo(({ content, folderPath, dbReady, currentLine }) => {
  const aiConfig = useAiConfig();
  const dialog = useDialog();
  const {
    cards,
    outputsByType,
    outlineVersions,
    termPool,
    acts,
    suggestedBoardActIndex,
    loading,
    outputsLoading,
    working,
    statusMessage,
    loadOutputs,
    createCard,
    updateCard,
    deleteCard,
    selectOutput,
    deleteOutput,
    addTermsToPool,
    extractIdeaSeedsFromContent,
    generateIdeaSeeds,
    generateIdeaOutputs,
    requestRelatedTerms,
    redrawIdeaTermRandomly,
    promoteToOutline,
    pushSceneHookToBoard,
  } = useStoryIdeaCards(folderPath, content, dbReady, aiConfig.ready, currentLine);

  const [activeCardId, setActiveCardId] = useState<number | null>(null);
  const [boardTargetActIndex, setBoardTargetActIndex] = useState(0);
  const [showOptionalInputs, setShowOptionalInputs] = useState(false);
  const [generationScope, setGenerationScope] = useState<StoryIdeaGenerationScope>('hybrid');
  const [generationGuidance, setGenerationGuidance] = useState('');
  const [interactionMode, setInteractionMode] = useState<StoryIdeaInteractionMode>('guided');
  const [historyExpanded, setHistoryExpanded] = useState(false);

  useEffect(() => {
    if (cards.length === 0) {
      setActiveCardId(null);
      return;
    }
    if (activeCardId === null || !cards.some((card) => card.id === activeCardId)) {
      setActiveCardId(cards[0].id);
    }
  }, [activeCardId, cards]);

  useEffect(() => {
    if (interactionMode === 'guided') {
      setShowOptionalInputs(false);
      setHistoryExpanded(false);
    }
    if (interactionMode === 'advanced') {
      setHistoryExpanded(true);
    }
  }, [interactionMode]);

  useEffect(() => {
    const handleOpenStoryIdeaCard = (event: Event) => {
      const customEvent = event as CustomEvent<{
        cardId?: number;
        expandOptionalInputs?: boolean;
      }>;
      if (typeof customEvent.detail?.cardId === 'number') {
        setActiveCardId(customEvent.detail.cardId);
      }
      if (customEvent.detail?.expandOptionalInputs) {
        setShowOptionalInputs(true);
      }
    };

    window.addEventListener(OPEN_STORY_IDEA_CARD_EVENT, handleOpenStoryIdeaCard as EventListener);
    return () => {
      window.removeEventListener(
        OPEN_STORY_IDEA_CARD_EVENT,
        handleOpenStoryIdeaCard as EventListener
      );
    };
  }, []);

  // 词池来源 / 候选结果筛选（按作品目录持久化）
  const {
    poolSourceFilter,
    setPoolSourceFilter,
    outputTypeFilter,
    setOutputTypeFilter,
    selectedOnly,
    setSelectedOnly,
  } = useStoryIdeaFilterPersistence(folderPath);

  // 历史创意卡检索
  const history = useStoryIdeaHistoryFilter(cards, interactionMode);
  const { filteredCards } = history;

  const activeCard = useMemo(
    () =>
      filteredCards.find((card) => card.id === activeCardId) ||
      cards.find((card) => card.id === activeCardId) ||
      null,
    [activeCardId, cards, filteredCards]
  );

  // 当前卡草稿与自动保存
  const { draft, setDraft, saving, setField } = useStoryIdeaDraft({
    activeCard,
    loadOutputs,
    updateCard,
  });

  const selectedOutlineDirection = useMemo(
    () => pickSelectedOutput(outputsByType.outline_direction, 'outline_direction'),
    [outputsByType.outline_direction]
  );

  const linkedOutlineVersions = useMemo(
    () => outlineVersions.filter((version) => version.story_idea_card_id === activeCard?.id),
    [activeCard?.id, outlineVersions]
  );

  const outputCards = useMemo(
    () =>
      (['logline', 'scene_hook', 'outline_direction'] as const).flatMap((type) =>
        outputsByType[type].map((output) => ({ type, output }))
      ),
    [outputsByType]
  );

  const filteredOutputCards = useMemo(
    () =>
      outputCards.filter(({ type, output }) => {
        const matchesType = outputTypeFilter === 'all' || type === outputTypeFilter;
        const matchesSelected = !selectedOnly || output.is_selected === 1;
        return matchesType && matchesSelected;
      }),
    [outputCards, outputTypeFilter, selectedOnly]
  );

  useEffect(() => {
    if (boardTargetActIndex >= acts.length) {
      setBoardTargetActIndex(0);
    }
  }, [acts.length, boardTargetActIndex]);

  useEffect(() => {
    if (acts.length === 0) {
      setBoardTargetActIndex(0);
      return;
    }
    setBoardTargetActIndex(suggestedBoardActIndex);
  }, [acts.length, suggestedBoardActIndex]);

  const aiActionsReady = aiConfig.loaded && aiConfig.ready;
  const hasOptionalConstraints = Boolean(
    draft.premise.trim() || draft.tags.length > 0 || draft.note.trim()
  );
  const baseGenerationConfig = useMemo<StoryIdeaGenerationConfig>(
    () => ({
      scope: generationScope,
      guidance: generationGuidance.trim(),
    }),
    [generationGuidance, generationScope]
  );

  const divergentGenerationConfig = useMemo<StoryIdeaGenerationConfig>(
    () => ({
      scope: baseGenerationConfig.scope,
      guidance: [
        baseGenerationConfig.guidance,
        '当前目标：围绕用户正在编辑的这一签继续外扩，优先补充更有陌生感、对撞感和联想性的词。',
      ]
        .filter(Boolean)
        .join('\n'),
    }),
    [baseGenerationConfig.guidance, baseGenerationConfig.scope]
  );

  const convergentGenerationConfig = useMemo<StoryIdeaGenerationConfig>(
    () => ({
      scope: baseGenerationConfig.scope,
      guidance: [
        baseGenerationConfig.guidance,
        '当前目标：基于已有三签收束，优先输出更能落地为故事方案的结果。',
      ]
        .filter(Boolean)
        .join('\n'),
    }),
    [baseGenerationConfig.guidance, baseGenerationConfig.scope]
  );

  // 三签签词操作
  const terms = useStoryIdeaTerms({
    draft,
    setDraft,
    setField,
    termPool,
    poolSourceFilter,
    divergentGenerationConfig,
    addTermsToPool,
    requestRelatedTerms,
    redrawIdeaTermRandomly,
  });
  const { handleContinueDiverging } = terms;

  const handleCreateCard = useCallback(async () => {
    const nextId = await createCard({
      ...createEmptyStoryIdeaDraft(),
      title: createGeneratedCardTitle(),
      premise: '',
      tags: [],
    });
    if (nextId) {
      setActiveCardId(nextId);
    }
  }, [createCard]);

  const ensureActiveCardContext = useCallback(async () => {
    if (activeCard) {
      return { card: activeCard, draft };
    }
    const nextDraft = {
      ...createEmptyStoryIdeaDraft(),
      title: createGeneratedCardTitle(),
    };
    const nextId = await createCard(nextDraft);
    if (!nextId) return null;
    setActiveCardId(nextId);
    return {
      card: buildTransientStoryIdeaCard(nextId, nextDraft),
      draft: nextDraft,
    };
  }, [activeCard, createCard, draft]);

  const handleDeleteCard = useCallback(async () => {
    if (!activeCard) return;
    const confirmed = await dialog.confirm('删除三签创意卡', `确定删除「${activeCard.title}」吗？`);
    if (!confirmed) return;
    await deleteCard(activeCard.id);
  }, [activeCard, deleteCard, dialog]);

  const handleExtractFromContent = useCallback(async () => {
    const context = await ensureActiveCardContext();
    if (!context) return;
    await extractIdeaSeedsFromContent(context.card, context.draft, baseGenerationConfig);
  }, [baseGenerationConfig, ensureActiveCardContext, extractIdeaSeedsFromContent]);

  const handleGenerateSeeds = useCallback(async () => {
    const context = await ensureActiveCardContext();
    if (!context) return;
    await generateIdeaSeeds(context.card, context.draft, divergentGenerationConfig);
  }, [divergentGenerationConfig, ensureActiveCardContext, generateIdeaSeeds]);

  const handleGenerateOutputs = useCallback(async () => {
    const context = await ensureActiveCardContext();
    if (!context) return;
    await generateIdeaOutputs(context.card, context.draft, convergentGenerationConfig);
  }, [convergentGenerationConfig, ensureActiveCardContext, generateIdeaOutputs]);

  const handlePromote = useCallback(async () => {
    if (!activeCard || !selectedOutlineDirection) return;
    await promoteToOutline(activeCard, draft, selectedOutlineDirection);
  }, [activeCard, draft, promoteToOutline, selectedOutlineDirection]);

  const handleConvergeAgain = useCallback(() => {
    void handleGenerateOutputs();
  }, [handleGenerateOutputs]);

  if (!folderPath || !dbReady) {
    return <div className={styles.emptyHint}>项目数据库尚未就绪，无法使用三签创作法</div>;
  }

  return (
    <div className={styles.storyIdeaRoot}>
      <div className={styles.storyIdeaHeader}>
        <div>
          <div className={styles.storyIdeaTitle}>三签创作法</div>
          <div className={styles.storyIdeaSubtitle}>
            不懂理论也没关系。默认只做三步：抓三签，补一签，出候选。
          </div>
        </div>
        <div className={styles.storyIdeaHeaderActions}>
          <div className={styles.storyIdeaModeSwitch}>
            <button
              className={`${styles.storyIdeaModeChip} ${interactionMode === 'guided' ? styles.storyIdeaModeChipActive : ''}`}
              onClick={() => setInteractionMode('guided')}
              type="button"
            >
              新手模式
            </button>
            <button
              className={`${styles.storyIdeaModeChip} ${interactionMode === 'advanced' ? styles.storyIdeaModeChipActive : ''}`}
              onClick={() => setInteractionMode('advanced')}
              type="button"
            >
              高级模式
            </button>
          </div>
        </div>
      </div>

      <div className={styles.storyIdeaQuickGuide}>
        <div className={styles.storyIdeaQuickGuideTitle}>不会用时，按这个顺序就行</div>
        <div className={styles.storyIdeaQuickGuideSteps}>
          <span className={styles.storyIdeaQuickStep}>1. 先抓三张签</span>
          <span className={styles.storyIdeaQuickStep}>2. 只盯一张继续补词</span>
          <span className={styles.storyIdeaQuickStep}>3. 生成故事候选</span>
        </div>
        <div className={styles.storyIdeaQuickGuideHint}>
          新手模式会把词池筛选、范围参数和输出筛选先收起来，避免一上来就做太多决定。
        </div>
      </div>

      <StoryIdeaHistorySection
        interactionMode={interactionMode}
        historyExpanded={historyExpanded}
        setHistoryExpanded={setHistoryExpanded}
        cards={cards}
        activeCard={activeCard}
        activeCardId={activeCardId}
        setActiveCardId={setActiveCardId}
        draft={draft}
        saving={saving}
        loading={loading}
        outputsLoading={outputsLoading}
        working={working}
        aiConfig={aiConfig}
        history={history}
      />

      {statusMessage && <div className={styles.outlineImportStatus}>{statusMessage}</div>}

      <div className={styles.storyIdeaLayout}>
        {!activeCard ? (
          <div className={styles.storyIdeaEditorEmpty}>
            <div className={styles.storyIdeaEmptyTitle}>先别管设置，先起一张卡</div>
            <div className={styles.storyIdeaEmptyText}>
              最顺手的起步方式是从正文抓一轮签词；如果你还没写正文，就新建空白卡再让 AI 帮你补。
            </div>
            <div className={styles.storyIdeaQuickActions}>
              <button
                className={styles.outlineActionButton}
                onClick={() => void handleExtractFromContent()}
                disabled={working || !aiActionsReady || !content.trim()}
                type="button"
              >
                从正文抓三签
              </button>
              <button
                className={styles.outlineSecondaryButton}
                onClick={() => void handleCreateCard()}
                type="button"
              >
                新建空白卡
              </button>
              <button
                className={styles.outlineSecondaryButton}
                onClick={() => void handleGenerateSeeds()}
                disabled={working || !aiActionsReady}
                type="button"
              >
                AI 直接补三签
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.storyIdeaEditor}>
            <StoryIdeaScopeCard
              interactionMode={interactionMode}
              generationScope={generationScope}
              setGenerationScope={setGenerationScope}
              generationGuidance={generationGuidance}
              setGenerationGuidance={setGenerationGuidance}
              working={working}
              aiActionsReady={aiActionsReady}
              hasContent={Boolean(content.trim())}
              hasActiveCard={Boolean(activeCard)}
              hasSelectedOutlineDirection={Boolean(selectedOutlineDirection)}
              handleExtractFromContent={handleExtractFromContent}
              handleCreateCard={handleCreateCard}
              handleGenerateSeeds={handleGenerateSeeds}
              handleGenerateOutputs={handleGenerateOutputs}
              handlePromote={handlePromote}
            />

            <StoryIdeaTermsCard
              interactionMode={interactionMode}
              showOptionalInputs={showOptionalInputs}
              setShowOptionalInputs={setShowOptionalInputs}
              hasOptionalConstraints={hasOptionalConstraints}
              draft={draft}
              setField={setField}
              working={working}
              aiActionsReady={aiActionsReady}
              poolSourceFilter={poolSourceFilter}
              setPoolSourceFilter={setPoolSourceFilter}
              handleDeleteCard={handleDeleteCard}
              handleGenerateOutputs={handleGenerateOutputs}
              terms={terms}
            />

            <FlowCard
              tone="info"
              title="④ 决策"
              subtitle="一轮结果出来后，不是结束，而是二选一：继续炸开当前这张签，或者沿现有三签再收束一轮。"
            >
              <div className={styles.storyIdeaDecisionBar}>
                <button
                  className={styles.outlineActionButton}
                  onClick={() => void handleContinueDiverging()}
                  disabled={working || !aiActionsReady}
                  type="button"
                >
                  继续补当前签
                </button>
                <button
                  className={styles.outlineSecondaryButton}
                  onClick={() => void handleConvergeAgain()}
                  disabled={working || !aiActionsReady}
                  type="button"
                >
                  生成故事候选
                </button>
              </div>
            </FlowCard>

            <StoryIdeaOutputsCard
              interactionMode={interactionMode}
              outputTypeFilter={outputTypeFilter}
              setOutputTypeFilter={setOutputTypeFilter}
              selectedOnly={selectedOnly}
              setSelectedOnly={setSelectedOnly}
              outputsByType={outputsByType}
              outputCards={outputCards}
              filteredOutputCards={filteredOutputCards}
              acts={acts}
              boardTargetActIndex={boardTargetActIndex}
              setBoardTargetActIndex={setBoardTargetActIndex}
              activeCard={activeCard}
              draft={draft}
              working={working}
              linkedOutlineVersions={linkedOutlineVersions}
              selectOutput={selectOutput}
              pushSceneHookToBoard={pushSceneHookToBoard}
              promoteToOutline={promoteToOutline}
              deleteOutput={deleteOutput}
            />
          </div>
        )}
      </div>
    </div>
  );
});
