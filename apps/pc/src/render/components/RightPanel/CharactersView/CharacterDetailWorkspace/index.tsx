import UiButton from '@novel-editor/ui/Button';
import type { RelationNoteDrafts } from '../useRelationNoteDrafts';
import { registerWorkspaceLeaveGuard } from '@/render/utils/workspaceLeaveGuard';
import { createCharacterWorkspaceTab } from '@/render/utils/workspace';
import { useUnsavedChangesGuard } from '@/render/hooks/useUnsavedChangesGuard';
import { useProfileDraft, type ProfileDraftTab } from './useProfileDraft';
import Tooltip from '@novel-editor/ui/Tooltip';
import Tabs from '@novel-editor/ui/Tabs';
import { VscSave, VscDiscard } from 'react-icons/vsc';
import CharacterProfileAssistant, {
  type EnrichmentProgress,
  type CharacterProfileAssistantHandle,
} from '../../../CharacterProfileAssistant';
import GenerationStatus, { type GenerationPhase } from '@novel-editor/ui/GenerationStatus';
import {
  ENRICHMENT_SECTIONS,
  type EnrichmentSection,
} from '@novel-editor/core/character-enrichment';
import { developmentEntries } from '@novel-editor/core/character-development';
import CharacterDevelopment from '../CharacterDevelopment';
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  CHARACTER_MEDIA_KINDS,
  CHARACTER_TRAIT_FIELD_KEYS,
  CHARACTER_CONTEXT_FIELD_KEYS,
  buildCharacterImagePrompt,
  parseCharacterDesign,
  resolveCover,
  type CharacterDesign,
  type MediaItem,
} from '@novel-editor/core/entity-media';
import EntityGallery from '../../../EntityGallery';
import Select from '@novel-editor/ui/Select';
import Switch from '@novel-editor/ui/Switch';
import styles from '../../styles.module.scss';
import tabStyles from './styles.module.scss';
import type {
  Character,
  CharacterCamp,
  CharacterCategory,
  CharacterCurrentStateItem,
  CharacterRelation,
  CharacterTimelineItem,
} from '../../types';
import { CHARACTER_CATEGORY_LABELS, DEFAULT_CHARACTER_HIGHLIGHT_COLOR } from '../../utils';
import { CAMP_LABELS } from '../../constants';
import { CATEGORY_OPTIONS, type NovelCorpusFile } from '../helpers';
import { CharacterCurrentStateSection } from '../CharacterCurrentStateSection';
import { CharacterTimelineSection } from '../CharacterTimelineSection';
import { CharacterGrowthButton } from '../CharacterGrowthButton';
import { CharacterPortrait } from '../CharacterPortrait';
import { CharacterDesignForm } from '../CharacterDesignForm';
import { CharacterVoiceForm } from '../CharacterVoiceForm';
import { parseCharacterVoice, type CharacterVoice } from '@novel-editor/video';
import ColorPicker from '@novel-editor/ui/ColorPicker';
import RelationPerson from './RelationPerson';
import type { CharacterCurrentStateController } from '../useCharacterCurrentState';
import type { CharacterTimelineController } from '../useCharacterTimeline';

/** 分组下拉里自定义分组的值前缀（与 major / secondary 区分开） */
const CUSTOM_GROUP_PREFIX = 'group:';

interface CharacterDetailWorkspaceProps {
  focusedCharacter: Character | null;
  focusedCamp: CharacterCamp | null;
  focusedHeat: number;
  focusedTimeline: CharacterTimelineItem[];
  focusedTimelineEditedCount: number;
  selectedRelations: CharacterRelation[];
  networkRelations?: CharacterRelation[];
  characters: Character[];
  novelCorpusFileCount: number;
  novelCorpusFiles?: NovelCorpusFile[];
  novelCorpusLoading: boolean;
  novelCorpusError: string;
  timeline: CharacterTimelineController;
  currentState: CharacterCurrentStateController;
  handleUpdateCharacterAttributes: (
    characterId: number,
    patch: {
      category?: CharacterCategory;
      group?: string;
      highlightColor?: string;
      highlightFirstMentionOnly?: boolean;
      currentState?: CharacterCurrentStateItem[];
      avatar?: string;
      design?: CharacterDesign;
      designPatch?: Partial<CharacterDesign>;
      designExpected?: Partial<CharacterDesign>;
      media?: MediaItem[];
      voice?: CharacterVoice;
    }
  ) => Promise<void>;
  graphView: React.ReactNode;
  propertyEditRequest?: number;
  relationNoteDrafts?: RelationNoteDrafts;
  relationEditing?: boolean;
  onOpenCharacter?: (id: number) => void;
  /** 当前人物成长卡的等级；null 表示尚未建档 */
  growthLevel?: number | null;
  /** 打开（或新建）该人物的成长档案；未提供时不显示入口 */
  onOpenGrowthSheet?: (characterName: string) => void;
  onOpenSourceLocation?: (filePath: string, line: number, contentKey?: string) => void;
  /** 作品目录：图集保存到 <作品>/资料/图集/人物/<名>/ */
  workPath?: string | null;
  /** 「成长」分页：嵌入该人物的成长档案（GrowthView）；未提供时只显示跳转按钮 */
  renderGrowth?: (characterName: string) => React.ReactNode;
}

export type CharacterDetailTab =
  | 'design'
  | 'environment'
  | 'social'
  | 'power'
  | 'plot'
  | 'growth'
  | 'gallery'
  | 'settings';
export const CHARACTER_DETAIL_TABS: ReadonlyArray<{ id: CharacterDetailTab; label: string }> = [
  { id: 'design', label: '人物' },
  { id: 'environment', label: '背景' },
  { id: 'social', label: '社会关系' },
  { id: 'power', label: '能力与资源' },
  { id: 'plot', label: '剧情发展' },
  { id: 'growth', label: '成长档案' },
  { id: 'gallery', label: '人物图集' },
  { id: 'settings', label: '设置' },
];

/**
 * 人物详情：左侧形象图（封面）+ 名称与概况；下方分页
 * 人物、背景、社会关系、能力与资源、剧情发展、成长档案、人物图集、设置。
 */
export const CharacterDetailWorkspace: React.FC<CharacterDetailWorkspaceProps> = ({
  focusedCharacter,
  focusedCamp,
  focusedHeat,
  focusedTimeline,
  selectedRelations,
  networkRelations = selectedRelations,
  characters,
  novelCorpusLoading,
  novelCorpusFiles,
  novelCorpusError,
  timeline,
  currentState,
  handleUpdateCharacterAttributes,
  graphView,
  propertyEditRequest = 0,
  relationNoteDrafts,
  relationEditing = false,
  onOpenCharacter,
  growthLevel = null,
  onOpenGrowthSheet,
  onOpenSourceLocation,
  workPath = null,
  renderGrowth,
}) => {
  const chapters = useMemo(() => {
    const names = [focusedCharacter?.name, ...(focusedCharacter?.aliases ?? [])].filter(
      (name): name is string => !!name
    );
    return (novelCorpusFiles ?? []).map((file) => {
      const positions = names
        .map((name) => file.content.indexOf(name))
        .filter((index) => index >= 0);
      const start = positions.length ? Math.max(0, Math.min(...positions) - 100) : -1;
      return {
        path: file.label,
        label: file.label,
        excerpt: start >= 0 ? file.content.slice(start, start + 400) : '',
      };
    });
  }, [novelCorpusFiles, focusedCharacter?.name, focusedCharacter?.aliases]);
  const networkChapters = useMemo(
    () =>
      (novelCorpusFiles ?? []).map((file) => {
        const excerpts = characters.flatMap((person) => {
          const start = file.content.indexOf(person.name);
          return start < 0 ? [] : [file.content.slice(Math.max(0, start - 80), start + 240)];
        });
        return { path: file.label, label: file.label, excerpt: [...new Set(excerpts)].join('\n') };
      }),
    [novelCorpusFiles, characters]
  );
  // 作者自定义过的人物分组（与默认分组同名的不重复列出）
  const customGroups = useMemo(() => {
    const defaults = new Set(CATEGORY_OPTIONS.map((option) => option.label));
    const names = new Set<string>();
    for (const item of characters) {
      const name = item.group?.trim();
      if (name && !defaults.has(name)) names.add(name);
    }
    return Array.from(names);
  }, [characters]);
  const [tab, setTab] = useState<CharacterDetailTab>('design');
  const [collectionFormDirty, setCollectionDirty] = useState(false);
  const collectionDirty = collectionFormDirty || relationEditing;
  const leaveRef = useRef<(target: string | null) => boolean>(() => true);
  const baseProfile = useProfileDraft(
    focusedCharacter,
    workPath,
    () => {
      leaveRef.current(null);
    },
    chapters
  );
  const profile = {
    ...baseProfile,
    hasDraft: baseProfile.hasDraft || !!relationNoteDrafts?.hasDraft,
    saving: baseProfile.saving || !!relationNoteDrafts?.saving,
    error: baseProfile.error || relationNoteDrafts?.error,
    hasTabDraft: (page: string) =>
      baseProfile.hasTabDraft(page) || (page === 'social' && !!relationNoteDrafts?.hasDraft),
    fill: (...args: Parameters<typeof baseProfile.fill>) => {
      const filled = baseProfile.fill(...args);
      return (relationNoteDrafts?.fill(...args) ?? false) || filled;
    },
    discard: (page: ProfileDraftTab) => {
      baseProfile.discard(page);
      if (page === 'social') relationNoteDrafts?.discard();
    },
    save: async (page: ProfileDraftTab) => {
      await baseProfile.save(page);
      if (page === 'social' && relationNoteDrafts?.hasDraft) await relationNoteDrafts.save();
    },
  };
  const scope = JSON.stringify([workPath, focusedCharacter?.id]);
  const [generationState, setGenerationState] = useState<{
    scope: string;
    value: EnrichmentProgress | null;
  } | null>(null);
  const generation = generationState?.scope === scope ? generationState.value : null;
  const assistant = useRef<CharacterProfileAssistantHandle>(null);
  const statusRegion = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!propertyEditRequest) return;
    setTab('design');
    const frame = requestAnimationFrame(() => {
      statusRegion.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      statusRegion.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [propertyEditRequest]);
  const [navigationNotice, setNavigationNotice] = useState<{ scope: string; text: string } | null>(
    null
  );
  const reviewedFailures = useRef(new Set<string>());
  const generationPhase = (id: CharacterDetailTab): GenerationPhase | undefined => {
    if (!generation || id === 'growth' || id === 'gallery' || id === 'settings') return undefined;
    const phase = generation.states[id]?.phase;
    return phase === 'cancelled' ? undefined : phase;
  };
  const draftedCharacter = focusedCharacter
    ? {
        ...focusedCharacter,
        design: { ...parseCharacterDesign(focusedCharacter.design), ...profile.values },
        voice: parseCharacterVoice({ ...focusedCharacter.voice, ...profile.voice }),
        development: { ...focusedCharacter.development, ...profile.development },
      }
    : null;
  const isTabGenerating = (id: CharacterDetailTab) =>
    ['waiting', 'generating'].includes(generationPhase(id) ?? '');
  const currentDraftTab = ['design', 'environment', 'social', 'power', 'plot'].includes(tab)
    ? (tab as ProfileDraftTab)
    : null;
  const currentTabLabel = CHARACTER_DETAIL_TABS.find((item) => item.id === tab)!.label;

  const sectionState = currentDraftTab ? generation?.states[currentDraftTab] : undefined;
  const failedKey = (section: EnrichmentSection) =>
    `${scope}:${section}:${generation?.states[section]?.reason}`;
  const reveal = (target: CharacterDetailTab, text: string) => {
    setTab(target);
    setNavigationNotice({ scope, text });
    requestAnimationFrame(() => {
      statusRegion.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      statusRegion.current?.focus({ preventScroll: true });
    });
  };
  leaveRef.current = (target) => {
    if (!focusedCharacter || target === createCharacterWorkspaceTab(focusedCharacter)) return true;
    const pending = ENRICHMENT_SECTIONS.find((item) => profile.hasTabDraft(item.id));
    if (collectionDirty || profile.saving) {
      reveal(tab, `「${focusedCharacter.name}」当前页还有正在编辑或保存的内容，请先处理。`);
      return false;
    }
    if (pending) {
      reveal(
        pending.id,
        `「${focusedCharacter.name}」的「${CHARACTER_DETAIL_TABS.find((item) => item.id === pending.id)!.label}」尚未保存，请先点击保存或取消。`
      );
      return false;
    }
    if (generation?.running) {
      reveal(generation.section, `「${focusedCharacter.name}」仍在生成资料，请完成后再切换。`);
      return false;
    }
    const unread = ENRICHMENT_SECTIONS.find(
      (item) =>
        generation?.states[item.id]?.phase === 'failed' &&
        !reviewedFailures.current.has(failedKey(item.id))
    );
    if (unread) {
      reviewedFailures.current.add(failedKey(unread.id));
      reveal(
        unread.id,
        `「${focusedCharacter.name}」有生成失败的资料，原因已定位到下方。查看后可重试或再次切换。`
      );
      return false;
    }
    return true;
  };
  useEffect(() => registerWorkspaceLeaveGuard((target) => leaveRef.current(target)), []);
  useUnsavedChangesGuard(
    profile.hasDraft || collectionDirty || profile.saving || !!generation?.running,
    () => {
      leaveRef.current(null);
    }
  );
  const selectTab = (next: CharacterDetailTab) => {
    setTab(next);
    setNavigationNotice(null);
    if (
      next !== 'growth' &&
      next !== 'gallery' &&
      next !== 'settings' &&
      generation?.states[next]?.phase === 'failed'
    ) {
      reviewedFailures.current.add(failedKey(next));
      requestAnimationFrame(() => {
        statusRegion.current?.scrollIntoView({ block: 'nearest' });
        statusRegion.current?.focus({ preventScroll: true });
      });
    }
  };
  const openDevelopmentChapter = onOpenSourceLocation
    ? (path: string) => {
        const file = novelCorpusFiles?.find((item) => item.label === path);
        if (file && leaveRef.current(null)) onOpenSourceLocation(file.path, 1);
      }
    : undefined;

  return (
    <div className={styles.objectWorkspace}>
      {focusedCharacter ? (
        <>
          <section
            className={`${styles.workspaceHero} ${styles.workspaceHeroPortrait} ${tabStyles.hero}`}
          >
            <CharacterPortrait
              name={focusedCharacter.name}
              avatar={resolveCover(focusedCharacter.media ?? [], focusedCharacter.avatar)}
              color={focusedCharacter.highlightColor}
              workPath={workPath}
              onChange={(avatar) =>
                handleUpdateCharacterAttributes(focusedCharacter.id, { avatar })
              }
              onOpenGallery={() => {
                if (!collectionDirty) setTab('gallery');
              }}
            />
            <div className={styles.workspaceHeroMain}>
              <div className={styles.workspaceEyebrow}>人物资料</div>
              <div className={styles.workspaceTitleRow}>
                <h2 className={`${styles.workspaceTitle} ${styles.workspaceTitleGrow}`}>
                  {focusedCharacter.name}
                </h2>
                <div className={tabStyles.heroActions}>
                  {(onOpenGrowthSheet || renderGrowth) && (
                    <CharacterGrowthButton
                      characterName={focusedCharacter.name}
                      level={growthLevel}
                      // 成长档案嵌在本页时切到「成长档案」分页，否则打开成长档案标签
                      onOpen={
                        renderGrowth
                          ? () => {
                              if (!collectionDirty) setTab('growth');
                            }
                          : (onOpenGrowthSheet ?? (() => undefined))
                      }
                    />
                  )}
                  <CharacterProfileAssistant
                    ref={assistant}
                    key={`assistant:${workPath}:${focusedCharacter.id}`}
                    character={{
                      ...draftedCharacter!,
                      network: {
                        characters: characters.map((person) => ({
                          id: person.id,
                          name: person.name,
                          role: person.role,
                          description: person.description,
                        })),
                        relations: networkRelations,
                        chapters: networkChapters,
                      },
                      relations: selectedRelations.map((relation) => ({
                        id: relation.id,
                        name:
                          characters.find(
                            (item) =>
                              item.id ===
                              (relation.sourceId === focusedCharacter.id
                                ? relation.targetId
                                : relation.sourceId)
                          )?.name ?? '未匹配人物',
                        label: relation.label,
                        note: relation.note,
                      })),
                    }}
                    chapters={chapters}
                    workPath={workPath}
                    disabled={profile.saving || collectionDirty || novelCorpusLoading}
                    onProgress={(value) => setGenerationState({ scope, value })}
                    onFill={profile.fill}
                  />
                </div>
              </div>
              {focusedTimeline.length > 0 && (
                <p className={styles.workspaceDesc}>
                  已从作品正文整理出 {focusedTimeline.length} 段关键经历。
                </p>
              )}
              <div className={tabStyles.metaRows}>
                <div className={styles.workspaceMetaRow}>
                  <span className={`${tabStyles.chip} ${tabStyles.categoryChip}`}>
                    {CHARACTER_CATEGORY_LABELS[focusedCharacter.category]}
                  </span>
                  <span className={`${tabStyles.chip} ${tabStyles.roleChip}`}>
                    {focusedCharacter.role || '未填写'}
                  </span>
                  <span className={`${tabStyles.chip} ${tabStyles.campChip}`}>
                    {CAMP_LABELS[focusedCamp ?? 'support']}
                  </span>
                </div>
                <div className={styles.workspaceMetaRow}>
                  <span className={`${tabStyles.chip} ${tabStyles.heatChip}`}>
                    正文热度 {focusedHeat}
                  </span>
                  <span className={`${tabStyles.chip} ${tabStyles.relationChip}`}>
                    关系 {selectedRelations.length}
                  </span>
                </div>
              </div>
              {focusedCharacter.description && (
                <section className={tabStyles.heroSummary} aria-label="资料摘要">
                  <div className={tabStyles.recordCopy}>{focusedCharacter.description}</div>
                </section>
              )}
            </div>
          </section>

          <Tabs
            label="人物详情"
            value={tab}
            onChange={selectTab}
            items={CHARACTER_DETAIL_TABS.map((item) => {
              const phase = generationPhase(item.id);
              return {
                ...item,
                disabled: profile.saving || (collectionDirty && tab !== item.id),
                reserveStatusSpace: ENRICHMENT_SECTIONS.some((section) => section.id === item.id),
                status:
                  phase && phase !== 'waiting' ? (
                    <GenerationStatus phase={phase} compact />
                  ) : undefined,
                error: phase === 'failed',
                title:
                  phase === 'failed'
                    ? `生成失败：${generation?.states[item.id as EnrichmentSection]?.reason}`
                    : undefined,
                badge:
                  item.id === 'gallery' && (focusedCharacter.media?.length ?? 0) > 0
                    ? focusedCharacter.media?.length
                    : item.id === 'growth' && growthLevel !== null
                      ? `Lv.${growthLevel}`
                      : undefined,
              };
            })}
          />

          <div ref={statusRegion} tabIndex={-1} className={tabStyles.statusRegion}>
            {navigationNotice?.scope === scope && (
              <p className={tabStyles.navigationNotice} role="alert">
                {navigationNotice.text}
              </p>
            )}
            {sectionState && sectionState.phase !== 'waiting' && (
              <div
                className={
                  sectionState.phase === 'failed'
                    ? tabStyles.generationError
                    : tabStyles.generationNotice
                }
                role={sectionState.phase === 'failed' ? 'alert' : 'status'}
              >
                <GenerationStatus
                  phase={sectionState.phase}
                  label={
                    sectionState.phase === 'done'
                      ? profile.hasTabDraft(tab)
                        ? '已生成，待保存'
                        : '已处理'
                      : undefined
                  }
                />
                {sectionState.phase === 'failed' && (
                  <>
                    <span className={tabStyles.failureReason}>
                      {sectionState.reason || '生成失败，请重试'}
                    </span>
                    <UiButton
                      unstyled
                      type="button"
                      disabled={!!generation?.running || profile.saving || collectionDirty}
                      onClick={() => {
                        if (currentDraftTab) assistant.current?.retry(currentDraftTab);
                      }}
                    >
                      重试此页
                    </UiButton>
                  </>
                )}
              </div>
            )}
          </div>
          {currentDraftTab && profile.hasTabDraft(tab) && (
            <div
              className={tabStyles.draftActions}
              role="group"
              aria-label={`${currentTabLabel}草稿操作`}
            >
              <Tooltip content={`取消「${currentTabLabel}」的修改`}>
                <UiButton
                  unstyled
                  type="button"
                  aria-label={`取消${currentTabLabel}修改`}
                  disabled={profile.saving || isTabGenerating(tab) || collectionDirty}
                  onClick={() => {
                    profile.discard(currentDraftTab);
                    setNavigationNotice(null);
                  }}
                >
                  <VscDiscard />
                </UiButton>
              </Tooltip>
              <Tooltip content={`保存「${currentTabLabel}」的修改`}>
                <UiButton
                  unstyled
                  type="button"
                  aria-label={`保存${currentTabLabel}修改`}
                  disabled={profile.saving || isTabGenerating(tab) || collectionDirty}
                  onClick={() => {
                    setNavigationNotice(null);
                    void profile.save(currentDraftTab);
                  }}
                >
                  {profile.saving ? <GenerationStatus compact /> : <VscSave />}
                </UiButton>
              </Tooltip>
              {profile.error && <span role="alert">{profile.error}</span>}
            </div>
          )}
          {tab === 'design' && (
            <div className={tabStyles.panel} role="tabpanel" aria-label="人物">
              <CharacterDesignForm
                key={`${workPath}:${focusedCharacter.id}`}
                design={focusedCharacter.design}
                fieldKeys={CHARACTER_TRAIT_FIELD_KEYS}
                draftOverride={profile.values}
                draftBaseline={profile.baseline?.design}
                onDraftChange={profile.edit}
                disabled={profile.saving || isTabGenerating(tab)}
                generationPhase={generationPhase('design')}
                basicFields={
                  <CharacterVoiceForm
                    voice={focusedCharacter.voice}
                    draftOverride={profile.voice}
                    draftBaseline={profile.baseline?.voice}
                    onDraftChange={profile.editVoice}
                    disabled={profile.saving || isTabGenerating(tab)}
                    generationPhase={generationPhase('design')}
                    onSave={(voice) =>
                      handleUpdateCharacterAttributes(focusedCharacter.id, { voice })
                    }
                  />
                }
                onSave={(designPatch, designExpected) =>
                  handleUpdateCharacterAttributes(focusedCharacter.id, {
                    designPatch,
                    designExpected,
                  })
                }
              />
            </div>
          )}

          {(tab === 'power' || tab === 'plot') && (
            <div
              className={tabStyles.panel}
              role="tabpanel"
              aria-label={tab === 'power' ? '能力与资源' : '剧情发展'}
            >
              <CharacterDevelopment
                key={`${workPath}:${focusedCharacter.id}:${tab}`}
                character={draftedCharacter!}
                originalCharacter={profile.hasDraft ? focusedCharacter : undefined}
                draftBaseline={profile.baseline?.development}
                workPath={workPath}
                section={tab}
                chapters={chapters}
                onOpenChapter={openDevelopmentChapter}
                disabled={profile.saving || isTabGenerating(tab)}
                generationPhase={generationPhase(tab)}
                onDraftSave={profile.hasDraft ? profile.editDevelopment : undefined}
                onDirtyChange={setCollectionDirty}
                onOpenGrowth={() => {
                  if (!collectionDirty) setTab('growth');
                }}
              />
              {tab === 'plot' && (
                <>
                  <CharacterCurrentStateSection
                    focusedCharacter={focusedCharacter}
                    controller={currentState}
                  />

                  <CharacterTimelineSection
                    focusedTimeline={focusedTimeline}
                    novelCorpusLoading={novelCorpusLoading}
                    novelCorpusError={novelCorpusError}
                    controller={timeline}
                  />
                </>
              )}
            </div>
          )}

          {tab === 'gallery' && (
            <div className={tabStyles.panel} role="tabpanel" aria-label="人物图集">
              <EntityGallery
                entity="character"
                name={focusedCharacter.name}
                workPath={workPath}
                items={focusedCharacter.media ?? []}
                cover={focusedCharacter.avatar}
                legacyCover={focusedCharacter.avatar}
                kinds={CHARACTER_MEDIA_KINDS}
                buildPrompt={({ kind, style, extra }) =>
                  buildCharacterImagePrompt({
                    name: focusedCharacter.name,
                    design: parseCharacterDesign(focusedCharacter.design),
                    description: focusedCharacter.description,
                    kind,
                    style,
                    extra,
                  })
                }
                onChange={({ media, cover }) =>
                  handleUpdateCharacterAttributes(focusedCharacter.id, { media, avatar: cover })
                }
              />
            </div>
          )}

          {tab === 'growth' && (
            <div className={tabStyles.panel} role="tabpanel" aria-label="成长档案">
              <section className={styles.workspaceCardShell}>
                <div className={styles.workspaceSectionTitle}>能力与剧情变化</div>
                {developmentEntries(focusedCharacter.development, focusedCharacter.design)
                  .flatMap((entry) => entry.events.map((event) => ({ entry, event })))
                  .sort((a, b) => b.event.at.localeCompare(a.event.at))
                  .map(({ entry, event }) => (
                    <div key={`${entry.id}:${event.id}`} className={styles.workspaceListItem}>
                      <strong>
                        {entry.name} · {event.stage || '未分期'}
                      </strong>
                      <div className={tabStyles.recordCopy}>{event.note}</div>
                      <span className={styles.workspaceListHint}>
                        {event.chapter}
                        {event.growthEventId ? ' · 已关联成长记录' : ''}
                      </span>
                    </div>
                  ))}
                <span className={styles.workspaceListHint}>
                  装备、能力和剧情条目的变化在此汇总；经验与等级在下方记录。
                </span>
              </section>
              {renderGrowth ? (
                // 懒加载只替换档案内容，避免冒泡到 ContentPanel 后隐藏整个人物页面。
                <Suspense
                  fallback={
                    <div role="status" className={tabStyles.growthLoading}>
                      <GenerationStatus label="正在加载成长档案…" />
                    </div>
                  }
                >
                  {renderGrowth(focusedCharacter.name)}
                </Suspense>
              ) : onOpenGrowthSheet ? (
                <CharacterGrowthButton
                  characterName={focusedCharacter.name}
                  level={growthLevel}
                  onOpen={onOpenGrowthSheet}
                />
              ) : (
                <div className={styles.emptyHint}>打开作品后即可记录人物成长。</div>
              )}
            </div>
          )}

          {tab === 'environment' && (
            <div className={tabStyles.panel} role="tabpanel" aria-label="背景">
              <section>
                <CharacterDevelopment
                  key={`identity:${workPath}:${focusedCharacter.id}`}
                  character={draftedCharacter!}
                  originalCharacter={profile.hasDraft ? focusedCharacter : undefined}
                  draftBaseline={profile.baseline?.development}
                  workPath={workPath}
                  section="identity"
                  chapters={chapters}
                  onOpenChapter={openDevelopmentChapter}
                  disabled={profile.saving || isTabGenerating(tab)}
                  generationPhase={generationPhase('environment')}
                  onDraftSave={profile.hasDraft ? profile.editDevelopment : undefined}
                  onDirtyChange={setCollectionDirty}
                  onOpenGrowth={() => {
                    if (!collectionDirty) setTab('growth');
                  }}
                />
              </section>
              <CharacterDesignForm
                key={`background:${workPath}:${focusedCharacter.id}`}
                design={focusedCharacter.design}
                fieldKeys={CHARACTER_CONTEXT_FIELD_KEYS}
                draftOverride={profile.values}
                draftBaseline={profile.baseline?.design}
                onDraftChange={profile.edit}
                disabled={profile.saving || isTabGenerating(tab)}
                generationPhase={generationPhase('environment')}
                onSave={(designPatch, designExpected) =>
                  handleUpdateCharacterAttributes(focusedCharacter.id, {
                    designPatch,
                    designExpected,
                  })
                }
              />
            </div>
          )}
          {tab === 'social' && (
            <div className={tabStyles.panel} role="tabpanel" aria-label="社会关系">
              <section className={tabStyles.section}>
                <div className={tabStyles.sectionHeader}>
                  <span className={styles.workspaceSectionTitle}>人物关系</span>
                  <span className={styles.workspaceListHint}>围绕当前人物的出场关系</span>
                </div>
                {selectedRelations.length > 0 ? (
                  <div className={tabStyles.relationList}>
                    {selectedRelations.map((relation) => {
                      const otherId =
                        relation.sourceId === focusedCharacter.id
                          ? relation.targetId
                          : relation.sourceId;
                      const otherCharacter = characters.find((item) => item.id === otherId);
                      return (
                        <RelationPerson
                          key={relation.id}
                          character={otherCharacter}
                          relation={relation}
                          noteBaseline={relationNoteDrafts?.notes[relation.id]?.baseline}
                          workPath={workPath}
                          onOpen={
                            otherCharacter && onOpenCharacter
                              ? () => {
                                  if (
                                    leaveRef.current(
                                      createCharacterWorkspaceTab({ id: otherCharacter.id })
                                    )
                                  )
                                    onOpenCharacter(otherCharacter.id);
                                }
                              : undefined
                          }
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div className={styles.emptyHint}>这个人物还没有整理关系。</div>
                )}
              </section>

              <section className={tabStyles.section}>{graphView}</section>
            </div>
          )}
          {tab === 'settings' && (
            <div className={tabStyles.panel} role="tabpanel" aria-label="设置">
              <section className={tabStyles.section}>
                <div className={tabStyles.sectionHeader}>
                  <span className={styles.workspaceSectionTitle}>正文高亮</span>
                  <span className={styles.workspaceListHint}>控制角色名在正文中的强调方式</span>
                </div>
                <div className={styles.highlightConfigPanel}>
                  <label className={styles.categoryField}>
                    <span className={styles.highlightFieldLabel}>分组</span>
                    {/* 主要 / 次要角色 + 作者自定义的分组，也可以在列表底部新建；文件面板「角色」按它分组 */}
                    <Select<string>
                      block
                      size="lg"
                      aria-label="人物分组"
                      value={
                        focusedCharacter.group
                          ? (CATEGORY_OPTIONS.find(
                              (option) => option.label === focusedCharacter.group?.trim()
                            )?.value ?? `${CUSTOM_GROUP_PREFIX}${focusedCharacter.group.trim()}`)
                          : focusedCharacter.category
                      }
                      options={[
                        ...CATEGORY_OPTIONS,
                        ...customGroups.map((group) => ({
                          value: `${CUSTOM_GROUP_PREFIX}${group}`,
                          label: group,
                        })),
                      ]}
                      custom={{
                        label: '新建分组',
                        placeholder: '分组名，例如：反派',
                        normalize: (text) => {
                          const name = text.trim().slice(0, 30);
                          return name ? `${CUSTOM_GROUP_PREFIX}${name}` : null;
                        },
                      }}
                      onChange={(value) =>
                        void handleUpdateCharacterAttributes(
                          focusedCharacter.id,
                          value.startsWith(CUSTOM_GROUP_PREFIX)
                            ? { group: value.slice(CUSTOM_GROUP_PREFIX.length) }
                            : { category: value as CharacterCategory, group: '' }
                        )
                      }
                    />
                  </label>
                  <div className={styles.highlightColorField}>
                    <span className={styles.highlightFieldLabel}>高亮颜色</span>
                    <ColorPicker
                      key={focusedCharacter.id}
                      value={focusedCharacter.highlightColor || DEFAULT_CHARACTER_HIGHLIGHT_COLOR}
                      preview={focusedCharacter.name}
                      onChange={(highlightColor) =>
                        handleUpdateCharacterAttributes(focusedCharacter.id, { highlightColor })
                      }
                    />
                  </div>
                  <Switch
                    size="sm"
                    className={styles.highlightToggle}
                    checked={focusedCharacter.highlightFirstMentionOnly !== false}
                    onChange={(checked) =>
                      void handleUpdateCharacterAttributes(focusedCharacter.id, {
                        highlightFirstMentionOnly: checked,
                      })
                    }
                    label="仅在每章第一次出现时高亮"
                  />
                </div>
              </section>
            </div>
          )}
        </>
      ) : (
        <div className={styles.emptyHint}>没有找到对应人物，可能已经被删除。</div>
      )}
    </div>
  );
};
