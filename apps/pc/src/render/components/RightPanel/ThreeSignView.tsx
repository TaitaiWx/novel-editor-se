import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  StoryIdeaCardRow,
  StoryIdeaOutputRow,
  StoryIdeaOutputType,
} from '@/render/types/electron-api';
import styles from './styles.module.scss';
import { useAiConfig } from './useAiConfig';
import { useDialog } from '../Dialog';
import { useStoryIdeaCards } from './useStoryIdeaCards';
import { FlowCard, FlowCollapsibleCard } from './FlowCards';
import {
  buildStoryIdeaSearchText,
  STORY_IDEA_GENERATION_SCOPE_LABELS,
  buildStoryIdeaTermSummary,
  createEmptyStoryIdeaDraft,
  draftToStoryIdeaUpdatePayload,
  normalizeIdeaTags,
  normalizeIdeaTerms,
  parseStoryIdeaSnapshot,
  pickRandomStoryIdeaTerms,
  pickSelectedOutput,
  serializeStoryIdeaDraft,
  STORY_IDEA_OUTPUT_LABELS,
  STORY_IDEA_SOURCE_LABELS,
  STORY_IDEA_STATUS_LABELS,
  STORY_IDEA_TERM_POOL_SOURCE_LABELS,
  STORY_IDEA_TERM_SECTION_LABELS,
  type StoryIdeaGenerationConfig,
  type StoryIdeaGenerationScope,
  type StoryIdeaTermPoolEntry,
  type StoryIdeaTermSection,
  toStoryIdeaDraft,
  type StoryIdeaCardDraft,
} from './story-idea';

const OPEN_STORY_IDEA_CARD_EVENT = 'open-story-idea-card';

const STORY_IDEA_TERM_CARD_DESCRIPTIONS: Record<StoryIdeaTermSection, string> = {
  theme: '题眼签抓意象、关系和气质，它决定这个故事像什么。',
  conflict: '冲突签抓阻力、代价和对撞，它决定故事往哪儿拧。',
  twist: '变形签抓反转、错位和揭示，它决定故事怎么翻面。',
};

type StoryIdeaOutputFilterState = {
  type: 'all' | StoryIdeaOutputType;
  selectedOnly: boolean;
};

function createPoolSourceFilterKey(folderPath: string | null): string | null {
  return folderPath ? `novel-editor:story-idea-pool-filter:${folderPath}` : null;
}

function createOutputFilterKey(folderPath: string | null): string | null {
  return folderPath ? `novel-editor:story-idea-output-filter:${folderPath}` : null;
}

function readOutputMeta(output: StoryIdeaOutputRow): Record<string, unknown> {
  try {
    return JSON.parse(output.meta_json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getTermSummary(draft: StoryIdeaCardDraft): string {
  return [draft.themeTerms, draft.conflictTerms, draft.twistTerms].flat().slice(0, 6).join(' / ');
}

function buildTransientStoryIdeaCard(cardId: number, draft: StoryIdeaCardDraft): StoryIdeaCardRow {
  const now = new Date().toISOString();
  return {
    id: cardId,
    novel_id: 0,
    title: draft.title,
    premise: draft.premise,
    tags_json: JSON.stringify(draft.tags),
    source: draft.source,
    status: draft.status,
    theme_seed: draft.themeTerms.join(' / '),
    conflict_seed: draft.conflictTerms.join(' / '),
    twist_seed: draft.twistTerms.join(' / '),
    protagonist_wish: '',
    core_obstacle: '',
    irony_or_gap: '',
    escalation_path: '',
    payoff_hint: '',
    selected_logline: draft.selectedLogline,
    selected_direction: draft.selectedDirection,
    note: draft.note,
    created_at: now,
    updated_at: now,
  };
}

function createGeneratedCardTitle() {
  const now = new Date();
  return `创意卡 ${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function StoryIdeaTermEditor({
  section,
  label,
  description,
  isExpanded,
  value,
  poolTerms,
  placeholder,
  working,
  onToggle,
  onChange,
  onAddCurrentToPool,
  onQuickFillFromPool,
  onRequestRelated,
  onRedrawRandom,
  onPickPoolTerm,
}: {
  section: StoryIdeaTermSection;
  label: string;
  description: string;
  isExpanded: boolean;
  value: string[];
  poolTerms: StoryIdeaTermPoolEntry[];
  placeholder: string;
  working: boolean;
  onToggle: (section: StoryIdeaTermSection) => void;
  onChange: (next: string[]) => void;
  onAddCurrentToPool: (section: StoryIdeaTermSection) => void;
  onQuickFillFromPool: (section: StoryIdeaTermSection) => void;
  onRequestRelated: (section: StoryIdeaTermSection) => void;
  onRedrawRandom: (section: StoryIdeaTermSection) => void;
  onPickPoolTerm: (section: StoryIdeaTermSection, term: string) => void;
}) {
  const summary = buildStoryIdeaTermSummary(value, 3);
  return (
    <FlowCollapsibleCard
      title={label}
      subtitle={description}
      expanded={isExpanded}
      onToggle={() => onToggle(section)}
      tone={isExpanded ? 'info' : 'default'}
      meta={
        <>
          <span className={styles.storyIdeaTermCardCount}>{value.length}/5</span>
          <span className={styles.storyIdeaTermCardToggle}>{isExpanded ? '收起' : '展开'}</span>
        </>
      }
      summary={
        <div className={styles.storyIdeaTermSummaryBar}>
          <span className={styles.storyIdeaTermSummaryLabel}>摘要</span>
          <div className={styles.storyIdeaTermSummaryContent}>
            {summary.visibleTerms.length === 0 ? (
              <span className={styles.storyIdeaTermPlaceholder}>
                任选这一张先起手，填 3-5 个即可
              </span>
            ) : (
              <>
                {summary.visibleTerms.map((item) => (
                  <span key={`${label}-${item}`} className={styles.storyIdeaTermChip}>
                    {item}
                  </span>
                ))}
                {summary.hiddenCount > 0 && (
                  <span className={styles.storyIdeaTermOverflowChip}>+{summary.hiddenCount}</span>
                )}
              </>
            )}
          </div>
        </div>
      }
    >
      <div className={styles.storyIdeaTermGroup}>
        <label className={styles.storyIdeaField}>
          <span className={styles.storyIdeaFieldLabel}>签词输入</span>
          <input
            className={styles.storyIdeaInput}
            value={value.join('，')}
            onChange={(event) => onChange(normalizeIdeaTerms(event.target.value))}
            placeholder={placeholder}
          />
        </label>
        <div className={styles.storyIdeaTermActions}>
          <button
            className={styles.outlineSecondaryButton}
            onClick={() => onQuickFillFromPool(section)}
            disabled={working || poolTerms.length === 0}
            type="button"
          >
            词池抽 3 个
          </button>
          <button
            className={styles.outlineSecondaryButton}
            onClick={() => onAddCurrentToPool(section)}
            disabled={working || value.length === 0}
            type="button"
          >
            收进词池
          </button>
          <button
            className={styles.outlineSecondaryButton}
            onClick={() => onRequestRelated(section)}
            disabled={working}
            type="button"
          >
            AI 提相关
          </button>
          <button
            className={styles.outlineSecondaryButton}
            onClick={() => onRedrawRandom(section)}
            disabled={working}
            type="button"
          >
            随机重抽一签
          </button>
        </div>
        <div className={styles.storyIdeaPoolBox}>
          <div className={styles.storyIdeaPoolTitle}>可直接点选的词池</div>
          <div className={styles.storyIdeaTagCloud}>
            {poolTerms.length === 0 ? (
              <span className={styles.storyIdeaTermPlaceholder}>历史词、AI 提词会沉淀到这里</span>
            ) : (
              poolTerms.map((item) => (
                <button
                  key={`${section}-${item.term}`}
                  className={styles.storyIdeaPoolChip}
                  onClick={() => onPickPoolTerm(section, item.term)}
                  type="button"
                >
                  <span>{item.term}</span>
                  <span className={styles.storyIdeaPoolSources}>
                    {item.sources.map((source) => (
                      <span
                        key={`${item.term}-${source}`}
                        className={styles.storyIdeaPoolSourceBadge}
                      >
                        {STORY_IDEA_TERM_POOL_SOURCE_LABELS[source]}
                      </span>
                    ))}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </FlowCollapsibleCard>
  );
}

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
  const [draftCardId, setDraftCardId] = useState<number | null>(null);
  const [draft, setDraft] = useState<StoryIdeaCardDraft>(createEmptyStoryIdeaDraft());
  const [lastSavedSignature, setLastSavedSignature] = useState(() =>
    serializeStoryIdeaDraft(createEmptyStoryIdeaDraft())
  );
  const [saving, setSaving] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | StoryIdeaCardDraft['status']>('all');
  const [tagFilter, setTagFilter] = useState('');
  const [boardTargetActIndex, setBoardTargetActIndex] = useState(0);
  const [showOptionalInputs, setShowOptionalInputs] = useState(false);
  const [poolSourceFilter, setPoolSourceFilter] = useState<'all' | 'history' | 'ai' | 'manual'>(
    'all'
  );
  const [poolSourceFilterLoaded, setPoolSourceFilterLoaded] = useState(false);
  const [activeTermSection, setActiveTermSection] = useState<StoryIdeaTermSection>('theme');
  const [outputTypeFilter, setOutputTypeFilter] = useState<'all' | StoryIdeaOutputType>('all');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [outputFilterLoaded, setOutputFilterLoaded] = useState(false);
  const [generationScope, setGenerationScope] = useState<StoryIdeaGenerationScope>('hybrid');
  const [generationGuidance, setGenerationGuidance] = useState('');

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

  useEffect(() => {
    const key = createPoolSourceFilterKey(folderPath);
    const ipc = window.electron?.ipcRenderer;
    if (!key || !ipc) {
      setPoolSourceFilter('all');
      setPoolSourceFilterLoaded(true);
      return;
    }

    let cancelled = false;
    void ipc
      .invoke('db-settings-get', key)
      .then((raw) => {
        if (cancelled) return;
        if (raw === 'history' || raw === 'ai' || raw === 'manual' || raw === 'all') {
          setPoolSourceFilter(raw);
        } else {
          setPoolSourceFilter('all');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPoolSourceFilter('all');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPoolSourceFilterLoaded(true);
        }
      });

    return () => {
      cancelled = true;
      setPoolSourceFilterLoaded(false);
    };
  }, [folderPath]);

  useEffect(() => {
    const key = createPoolSourceFilterKey(folderPath);
    const ipc = window.electron?.ipcRenderer;
    if (!poolSourceFilterLoaded || !key || !ipc) return;
    void ipc.invoke('db-settings-set', key, poolSourceFilter).catch(() => undefined);
  }, [folderPath, poolSourceFilter, poolSourceFilterLoaded]);

  useEffect(() => {
    const key = createOutputFilterKey(folderPath);
    const ipc = window.electron?.ipcRenderer;
    if (!key || !ipc) {
      setOutputTypeFilter('all');
      setSelectedOnly(false);
      setOutputFilterLoaded(true);
      return;
    }

    let cancelled = false;
    void ipc
      .invoke('db-settings-get', key)
      .then((raw) => {
        if (cancelled) return;
        try {
          const parsed = JSON.parse(String(raw || '')) as Partial<StoryIdeaOutputFilterState>;
          const nextType =
            parsed.type === 'logline' ||
            parsed.type === 'scene_hook' ||
            parsed.type === 'outline_direction'
              ? parsed.type
              : 'all';
          setOutputTypeFilter(nextType);
          setSelectedOnly(Boolean(parsed.selectedOnly));
        } catch {
          setOutputTypeFilter('all');
          setSelectedOnly(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOutputTypeFilter('all');
          setSelectedOnly(false);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setOutputFilterLoaded(true);
        }
      });

    return () => {
      cancelled = true;
      setOutputFilterLoaded(false);
    };
  }, [folderPath]);

  useEffect(() => {
    const key = createOutputFilterKey(folderPath);
    const ipc = window.electron?.ipcRenderer;
    if (!outputFilterLoaded || !key || !ipc) return;
    const payload: StoryIdeaOutputFilterState = {
      type: outputTypeFilter,
      selectedOnly,
    };
    void ipc.invoke('db-settings-set', key, JSON.stringify(payload)).catch(() => undefined);
  }, [folderPath, outputFilterLoaded, outputTypeFilter, selectedOnly]);

  const filteredCards = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    const normalizedTag = tagFilter.trim().toLowerCase();
    return cards.filter((card) => {
      const draftCard = toStoryIdeaDraft(card);
      const matchesKeyword =
        !normalizedKeyword || buildStoryIdeaSearchText(draftCard).includes(normalizedKeyword);
      const matchesStatus = statusFilter === 'all' || card.status === statusFilter;
      const matchesTag =
        !normalizedTag || draftCard.tags.some((tag) => tag.toLowerCase().includes(normalizedTag));
      return matchesKeyword && matchesStatus && matchesTag;
    });
  }, [cards, keyword, statusFilter, tagFilter]);

  const popularTags = useMemo(() => {
    const counts = new Map<string, number>();
    cards.forEach((card) => {
      toStoryIdeaDraft(card).tags.forEach((tag) => {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      });
    });
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag]) => tag);
  }, [cards]);

  const activeCard = useMemo(
    () =>
      filteredCards.find((card) => card.id === activeCardId) ||
      cards.find((card) => card.id === activeCardId) ||
      null,
    [activeCardId, cards, filteredCards]
  );

  const draftSignature = useMemo(() => serializeStoryIdeaDraft(draft), [draft]);
  const isDirty = draftSignature !== lastSavedSignature;

  useEffect(() => {
    if (!activeCard) {
      const empty = createEmptyStoryIdeaDraft();
      setDraft(empty);
      setDraftCardId(null);
      setLastSavedSignature(serializeStoryIdeaDraft(empty));
      return;
    }
    if (draftCardId !== activeCard.id) {
      const nextDraft = toStoryIdeaDraft(activeCard);
      setDraft(nextDraft);
      setDraftCardId(activeCard.id);
      setLastSavedSignature(serializeStoryIdeaDraft(nextDraft));
    }
  }, [activeCard, draftCardId]);

  useEffect(() => {
    if (!activeCard) return;
    void loadOutputs(activeCard.id);
  }, [activeCard, loadOutputs]);

  useEffect(() => {
    if (!activeCard || isDirty) return;
    const nextDraft = toStoryIdeaDraft(activeCard);
    const nextSignature = serializeStoryIdeaDraft(nextDraft);
    if (nextSignature !== lastSavedSignature) {
      setDraft(nextDraft);
      setLastSavedSignature(nextSignature);
    }
  }, [activeCard, isDirty, lastSavedSignature]);

  useEffect(() => {
    if (!activeCard || !isDirty) return;
    const timer = window.setTimeout(() => {
      setSaving(true);
      void updateCard(activeCard.id, draftToStoryIdeaUpdatePayload(draft))
        .then(() => {
          setLastSavedSignature(draftSignature);
        })
        .finally(() => {
          setSaving(false);
        });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [activeCard, draft, draftSignature, isDirty, updateCard]);

  const selectedOutlineDirection = useMemo(
    () => pickSelectedOutput(outputsByType.outline_direction, 'outline_direction'),
    [outputsByType.outline_direction]
  );

  const linkedOutlineVersions = useMemo(
    () => outlineVersions.filter((version) => version.story_idea_card_id === activeCard?.id),
    [activeCard?.id, outlineVersions]
  );

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

  const setField = useCallback(
    <K extends keyof StoryIdeaCardDraft>(key: K, value: StoryIdeaCardDraft[K]) => {
      setDraft((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

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
    [divergentGenerationConfig, draft, redrawIdeaTermRandomly]
  );

  const handleContinueDiverging = useCallback(() => {
    setActiveTermSection((current) => current);
    void requestRelatedTerms(draft, activeTermSection, divergentGenerationConfig);
  }, [activeTermSection, divergentGenerationConfig, draft, requestRelatedTerms]);

  const handleConvergeAgain = useCallback(() => {
    void handleGenerateOutputs();
  }, [handleGenerateOutputs]);

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

  if (!folderPath || !dbReady) {
    return <div className={styles.emptyHint}>项目数据库尚未就绪，无法使用三签创作法</div>;
  }

  return (
    <div className={styles.storyIdeaRoot}>
      <div className={styles.storyIdeaHeader}>
        <div>
          <div className={styles.storyIdeaTitle}>三签创作法</div>
          <div className={styles.storyIdeaSubtitle}>
            先搜历史卡，再抓当前这组三签，决定是继续发散还是开始收束。
          </div>
        </div>
      </div>

      <div className={styles.storyIdeaTopSection}>
        <FlowCard
          tone="info"
          title="① 历史搜索"
          subtitle="先从已有灵感里找接近的卡，再决定复用、扩写还是新起一张。"
          meta={
            <div className={styles.storyIdeaStatsRow}>
              <span className={styles.outlineStatChip}>{cards.length} 张创意卡</span>
              {activeCard && (
                <span className={styles.outlineStatChip}>
                  当前卡: {draft.title.trim() || '未命名创意卡'}
                </span>
              )}
              {activeCard && (
                <span className={styles.outlineStatChip}>
                  {STORY_IDEA_STATUS_LABELS[draft.status]}
                </span>
              )}
              {saving && <span className={styles.outlineLoadingChip}>自动保存中...</span>}
              {loading && <span className={styles.outlineLoadingChip}>加载中...</span>}
              {outputsLoading && <span className={styles.outlineLoadingChip}>同步候选...</span>}
              {working && <span className={styles.outlineLoadingChip}>AI 处理中...</span>}
              {!aiConfig.loaded && (
                <span className={styles.outlineLoadingChip}>读取 AI 状态...</span>
              )}
              {aiConfig.loaded && !aiConfig.ready && (
                <span className={styles.outlineAiHintChip}>AI 未就绪</span>
              )}
            </div>
          }
        >
          <div className={styles.storyIdeaFilterPanel}>
            <input
              className={styles.storyIdeaInput}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜标题、premise、签词"
            />
            <div className={styles.storyIdeaFilterRow}>
              <select
                className={styles.storyIdeaSelect}
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as 'all' | StoryIdeaCardDraft['status'])
                }
              >
                <option value="all">全部状态</option>
                {Object.entries(STORY_IDEA_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                className={styles.storyIdeaInput}
                value={tagFilter}
                onChange={(event) => setTagFilter(event.target.value)}
                placeholder="按标签检索"
              />
            </div>
            {popularTags.length > 0 && (
              <div className={styles.storyIdeaTagCloud}>
                {popularTags.map((tag) => (
                  <button
                    key={tag}
                    className={`${styles.storyIdeaTagChip} ${tagFilter === tag ? styles.storyIdeaTagChipActive : ''}`}
                    onClick={() => setTagFilter((current) => (current === tag ? '' : tag))}
                    type="button"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </div>
          {filteredCards.length === 0 ? (
            <div className={styles.storyIdeaEmptyCard}>
              <div className={styles.storyIdeaEmptyTitle}>没有匹配的创意卡</div>
              <div className={styles.storyIdeaEmptyText}>换个关键词、状态或标签试试。</div>
            </div>
          ) : (
            <div className={styles.storyIdeaHistoryCards}>
              {filteredCards.map((card) => {
                const draftCard = toStoryIdeaDraft(card);
                return (
                  <button
                    key={card.id}
                    className={`${styles.storyIdeaListItem} ${activeCardId === card.id ? styles.storyIdeaListItemActive : ''}`}
                    onClick={() => setActiveCardId(card.id)}
                    type="button"
                  >
                    <span className={styles.storyIdeaListTitle}>{card.title}</span>
                    <span className={styles.storyIdeaListMeta}>
                      {new Date(card.updated_at).toLocaleString()} /{' '}
                      {STORY_IDEA_STATUS_LABELS[card.status]}
                    </span>
                    <span className={styles.storyIdeaListSummary}>
                      {draftCard.premise || getTermSummary(draftCard) || '尚未整理签词'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </FlowCard>
      </div>

      {statusMessage && <div className={styles.outlineImportStatus}>{statusMessage}</div>}

      <div className={styles.storyIdeaLayout}>
        {!activeCard ? (
          <div className={styles.storyIdeaEditorEmpty}>
            先从“从章节起手发想”开始，系统会自动创建当前灵感卡；如果你只想空想，也可以新建空白灵感卡。
          </div>
        ) : (
          <div className={styles.storyIdeaEditor}>
            <FlowCard
              tone="accent"
              title="② 当前发想范围"
              subtitle="三签不必被当前章节锁死。先定范围，再决定这轮是向外发散还是开始收束。"
              actions={
                <div className={styles.storyIdeaEditorActions}>
                  <button
                    className={styles.outlineActionButton}
                    onClick={() => void handleExtractFromContent()}
                    disabled={working || !aiActionsReady || !content.trim()}
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
              <div className={styles.storyIdeaDecisionBar}>
                <button
                  className={styles.outlineSecondaryButton}
                  onClick={() => void handleGenerateSeeds()}
                  disabled={working || !aiActionsReady}
                  type="button"
                >
                  继续外扩三签
                </button>
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
                  disabled={!activeCard || working || !selectedOutlineDirection}
                  type="button"
                >
                  转为大纲
                </button>
              </div>
            </FlowCard>

            <FlowCard
              tone="default"
              title="③ 三张签卡"
              subtitle="顶部始终先看这组三签。你只需要盯住当前一张，反复扩它，直到觉得可以收束。"
              actions={
                <div className={styles.storyIdeaEditorActions}>
                  {!showOptionalInputs && hasOptionalConstraints && (
                    <span className={styles.storyIdeaConstraintPill}>这张卡带有限定</span>
                  )}
                  <button
                    className={styles.outlineSecondaryButton}
                    onClick={() => setShowOptionalInputs((current) => !current)}
                  >
                    {showOptionalInputs ? '收起限定' : '补充限定（可选）'}
                  </button>
                </div>
              }
            >
              {hasOptionalConstraints && !showOptionalInputs && (
                <div className={styles.storyIdeaConstraintSummary}>
                  {draft.premise.trim() || '这张卡已带有补充限定'}
                </div>
              )}

              {showOptionalInputs && (
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
                  三签的本质，不是按流程填表，而是先抓题眼、冲突、变形三种不同张力，再让其中一张被你不断掰开。真正的使用节奏是：先扩一张，再看是否值得收束，而不是从上到下机械填完。
                </div>
                <div className={styles.storyIdeaPoolFilterRow}>
                  <div className={styles.storyIdeaPoolFilterHeader}>
                    <span className={styles.storyIdeaFieldLabel}>词池来源</span>
                    <span className={styles.storyIdeaPoolFilterHint}>
                      记住上次筛选，下次打开沿用
                    </span>
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
                <div className={styles.storyIdeaSignatureDeck}>
                  <StoryIdeaTermEditor
                    section="theme"
                    label={STORY_IDEA_TERM_SECTION_LABELS.theme}
                    description={STORY_IDEA_TERM_CARD_DESCRIPTIONS.theme}
                    isExpanded={activeTermSection === 'theme'}
                    value={draft.themeTerms}
                    poolTerms={filteredTermPool.theme}
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
              </div>
            </FlowCard>

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
                  继续发散当前签
                </button>
                <button
                  className={styles.outlineSecondaryButton}
                  onClick={() => void handleConvergeAgain()}
                  disabled={working || !aiActionsReady}
                  type="button"
                >
                  再收束一轮候选
                </button>
              </div>
            </FlowCard>

            <FlowCard
              tone="plain"
              title="⑤ 候选结果"
              subtitle="收束产出的 logline、场景钩子和大纲方向，筛选后送出或继续迭代。"
              meta={
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
              }
            >
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

              <div className={styles.storyIdeaVersionTraceSection}>
                <div className={styles.storyIdeaOutputHeader}>
                  <span className={styles.storyIdeaOutputTitle}>关联大纲版本</span>
                  <span className={styles.storyIdeaOutputCount}>
                    {linkedOutlineVersions.length} 个
                  </span>
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
                          {new Date(version.created_at).toLocaleString()} / {version.total_nodes}{' '}
                          节点
                        </div>
                        {snapshot && (
                          <div className={styles.storyIdeaTraceTerms}>
                            {[
                              ...snapshot.themeTerms,
                              ...snapshot.conflictTerms,
                              ...snapshot.twistTerms,
                            ]
                              .slice(0, 9)
                              .map((term) => (
                                <span
                                  key={`${version.id}-${term}`}
                                  className={styles.storyIdeaTermChip}
                                >
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
            </FlowCard>
          </div>
        )}
      </div>
    </div>
  );
});
