import React, { useCallback, useMemo, useState } from 'react';
import {
  normalizeIdeaTerms,
  pickRandomStoryIdeaTerms,
  STORY_IDEA_TERM_SECTION_LABELS,
  type StoryIdeaCardDraft,
  type StoryIdeaGenerationConfig,
  type StoryIdeaTermPoolState,
  type StoryIdeaTermSection,
} from '../story-idea';
import type { useStoryIdeaCards } from '../useStoryIdeaCards';
import { STORY_IDEA_TERM_CARD_DESCRIPTIONS, STORY_IDEA_TERM_ORDER } from './helpers';

type StoryIdeaCardsApi = ReturnType<typeof useStoryIdeaCards>;

/**
 * 三签签词操作：当前签卡切换、向导步骤、词池筛选与补词/抽词/重抽等动作。
 */
export function useStoryIdeaTerms({
  draft,
  setDraft,
  setField,
  termPool,
  poolSourceFilter,
  divergentGenerationConfig,
  addTermsToPool,
  requestRelatedTerms,
  redrawIdeaTermRandomly,
}: {
  draft: StoryIdeaCardDraft;
  setDraft: React.Dispatch<React.SetStateAction<StoryIdeaCardDraft>>;
  setField: <K extends keyof StoryIdeaCardDraft>(key: K, value: StoryIdeaCardDraft[K]) => void;
  termPool: StoryIdeaTermPoolState;
  poolSourceFilter: 'all' | 'history' | 'ai' | 'manual';
  divergentGenerationConfig: StoryIdeaGenerationConfig;
  addTermsToPool: StoryIdeaCardsApi['addTermsToPool'];
  requestRelatedTerms: StoryIdeaCardsApi['requestRelatedTerms'];
  redrawIdeaTermRandomly: StoryIdeaCardsApi['redrawIdeaTermRandomly'];
}) {
  const [activeTermSection, setActiveTermSection] = useState<StoryIdeaTermSection>('theme');

  const filteredTermPool = useMemo(
    () => ({
      theme:
        poolSourceFilter === 'all'
          ? termPool.theme
          : termPool.theme.filter((entry) => entry.sources.includes(poolSourceFilter)),
      conflict:
        poolSourceFilter === 'all'
          ? termPool.conflict
          : termPool.conflict.filter((entry) => entry.sources.includes(poolSourceFilter)),
      twist:
        poolSourceFilter === 'all'
          ? termPool.twist
          : termPool.twist.filter((entry) => entry.sources.includes(poolSourceFilter)),
    }),
    [poolSourceFilter, termPool.conflict, termPool.theme, termPool.twist]
  );

  const activeTermStepIndex = useMemo(
    () => STORY_IDEA_TERM_ORDER.indexOf(activeTermSection),
    [activeTermSection]
  );

  const activeTermValue = useMemo(() => {
    if (activeTermSection === 'theme') return draft.themeTerms;
    if (activeTermSection === 'conflict') return draft.conflictTerms;
    return draft.twistTerms;
  }, [activeTermSection, draft.conflictTerms, draft.themeTerms, draft.twistTerms]);

  const guidedTermSteps = useMemo(
    () =>
      STORY_IDEA_TERM_ORDER.map((section) => ({
        section,
        label: STORY_IDEA_TERM_SECTION_LABELS[section],
        description: STORY_IDEA_TERM_CARD_DESCRIPTIONS[section],
        value:
          section === 'theme'
            ? draft.themeTerms
            : section === 'conflict'
              ? draft.conflictTerms
              : draft.twistTerms,
        poolTerms:
          section === 'theme'
            ? filteredTermPool.theme
            : section === 'conflict'
              ? filteredTermPool.conflict
              : filteredTermPool.twist,
        placeholder:
          section === 'theme'
            ? '例如：雨夜，失约，旧校舍，借名人生'
            : section === 'conflict'
              ? '例如：冒名顶替，被迫合作，证词作废，代价升级'
              : '例如：救人者才是幕后人，胜利即暴露，记忆被嫁接',
      })),
    [
      draft.conflictTerms,
      draft.themeTerms,
      draft.twistTerms,
      filteredTermPool.conflict,
      filteredTermPool.theme,
      filteredTermPool.twist,
    ]
  );

  const activeGuidedTermStep = guidedTermSteps[activeTermStepIndex] ?? guidedTermSteps[0];

  const handleAddCurrentTermsToPool = useCallback(
    (section: StoryIdeaTermSection) => {
      void addTermsToPool(
        section,
        section === 'theme'
          ? draft.themeTerms
          : section === 'conflict'
            ? draft.conflictTerms
            : draft.twistTerms
      );
    },
    [addTermsToPool, draft.conflictTerms, draft.themeTerms, draft.twistTerms]
  );

  const handleRequestRelatedTerms = useCallback(
    (section: StoryIdeaTermSection) => {
      void requestRelatedTerms(draft, section, divergentGenerationConfig);
    },
    [divergentGenerationConfig, draft, requestRelatedTerms]
  );

  const handleRedrawRandom = useCallback(
    (section: StoryIdeaTermSection) => {
      void redrawIdeaTermRandomly(draft, section, divergentGenerationConfig).then((nextDraft) => {
        if (nextDraft) setDraft(nextDraft);
      });
    },
    [divergentGenerationConfig, draft, redrawIdeaTermRandomly, setDraft]
  );

  const handleContinueDiverging = useCallback(() => {
    setActiveTermSection((current) => current);
    void requestRelatedTerms(draft, activeTermSection, divergentGenerationConfig);
  }, [activeTermSection, divergentGenerationConfig, draft, requestRelatedTerms]);

  const handlePickPoolTerm = useCallback(
    (section: StoryIdeaTermSection, term: string) => {
      setActiveTermSection(section);
      const currentTerms =
        section === 'theme'
          ? draft.themeTerms
          : section === 'conflict'
            ? draft.conflictTerms
            : draft.twistTerms;
      if (currentTerms.includes(term)) return;
      const nextTerms = normalizeIdeaTerms([...currentTerms, term]);
      if (section === 'theme') setField('themeTerms', nextTerms);
      else if (section === 'conflict') setField('conflictTerms', nextTerms);
      else setField('twistTerms', nextTerms);
    },
    [draft.conflictTerms, draft.themeTerms, draft.twistTerms, setField]
  );

  const handleToggleTermSection = useCallback((section: StoryIdeaTermSection) => {
    setActiveTermSection(section);
  }, []);

  const handleQuickFillFromPool = useCallback(
    (section: StoryIdeaTermSection) => {
      setActiveTermSection(section);
      const pool =
        section === 'theme'
          ? filteredTermPool.theme
          : section === 'conflict'
            ? filteredTermPool.conflict
            : filteredTermPool.twist;
      if (pool.length === 0) return;

      const nextTerms = pickRandomStoryIdeaTerms(pool, 3);
      if (section === 'theme') setField('themeTerms', nextTerms);
      else if (section === 'conflict') setField('conflictTerms', nextTerms);
      else setField('twistTerms', nextTerms);
    },
    [filteredTermPool.conflict, filteredTermPool.theme, filteredTermPool.twist, setField]
  );

  const handleGoToNextTermStep = useCallback(() => {
    setActiveTermSection((current) => {
      const currentIndex = STORY_IDEA_TERM_ORDER.indexOf(current);
      const nextIndex = Math.min(STORY_IDEA_TERM_ORDER.length - 1, currentIndex + 1);
      return STORY_IDEA_TERM_ORDER[nextIndex] ?? current;
    });
  }, []);

  const handleGoToPrevTermStep = useCallback(() => {
    setActiveTermSection((current) => {
      const currentIndex = STORY_IDEA_TERM_ORDER.indexOf(current);
      const nextIndex = Math.max(0, currentIndex - 1);
      return STORY_IDEA_TERM_ORDER[nextIndex] ?? current;
    });
  }, []);

  return {
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
    handleContinueDiverging,
    handlePickPoolTerm,
    handleToggleTermSection,
    handleQuickFillFromPool,
    handleGoToNextTermStep,
    handleGoToPrevTermStep,
  };
}

export type StoryIdeaTermsController = ReturnType<typeof useStoryIdeaTerms>;
