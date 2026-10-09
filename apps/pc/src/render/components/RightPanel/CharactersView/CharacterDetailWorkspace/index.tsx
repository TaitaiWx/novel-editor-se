import React, { useMemo, useState } from 'react';
import {
  CHARACTER_MEDIA_KINDS,
  buildCharacterImagePrompt,
  parseCharacterDesign,
  resolveCover,
  type CharacterDesign,
  type MediaItem,
} from '@novel-editor/core/entity-media';
import EntityGallery from '../../../EntityGallery';
import Select from '../../../Select';
import Switch from '../../../Switch';
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
import { CATEGORY_OPTIONS } from '../helpers';
import { CharacterCurrentStateSection } from '../CharacterCurrentStateSection';
import { CharacterTimelineSection } from '../CharacterTimelineSection';
import { CharacterGrowthButton } from '../CharacterGrowthButton';
import { CharacterPortrait } from '../CharacterPortrait';
import { CharacterDesignForm } from '../CharacterDesignForm';
import { CharacterVoiceForm } from '../CharacterVoiceForm';
import type { CharacterVoice } from '@novel-editor/video';
import CharacterAvatar from '../../../CharacterAvatar';
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
  characters: Character[];
  novelCorpusFileCount: number;
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
  /** 当前人物成长卡的等级；null 表示尚未建档 */
  growthLevel?: number | null;
  /** 打开（或新建）该人物的成长档案；未提供时不显示入口 */
  onOpenGrowthSheet?: (characterName: string) => void;
  /** 作品目录：图集保存到 <作品>/资料/图集/人物/<名>/ */
  workPath?: string | null;
  /** 「成长」分页：嵌入该人物的成长档案（GrowthView）；未提供时只显示跳转按钮 */
  renderGrowth?: (characterName: string) => React.ReactNode;
}

export type CharacterDetailTab = 'design' | 'gallery' | 'growth' | 'story' | 'relations';

export const CHARACTER_DETAIL_TABS: ReadonlyArray<{ id: CharacterDetailTab; label: string }> = [
  { id: 'design', label: '人物设计' },
  { id: 'gallery', label: '图集' },
  { id: 'growth', label: '成长档案' },
  { id: 'story', label: '经历与状态' },
  { id: 'relations', label: '关系与高亮' },
];

/**
 * 人物详情：左侧形象图（封面）+ 名称与概况；下方分页
 * 人物设计 / 图集（多视图、服装、背景，AI 生成或本地上传）/ 成长档案（与人物一体）/ 经历与状态 / 关系与高亮
 */
export const CharacterDetailWorkspace: React.FC<CharacterDetailWorkspaceProps> = ({
  focusedCharacter,
  focusedCamp,
  focusedHeat,
  focusedTimeline,
  selectedRelations,
  characters,
  novelCorpusLoading,
  novelCorpusError,
  timeline,
  currentState,
  handleUpdateCharacterAttributes,
  graphView,
  growthLevel = null,
  onOpenGrowthSheet,
  workPath = null,
  renderGrowth,
}) => {
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
  return (
    <div className={styles.objectWorkspace}>
      {focusedCharacter ? (
        <>
          <section className={`${styles.workspaceHero} ${styles.workspaceHeroPortrait}`}>
            <CharacterPortrait
              name={focusedCharacter.name}
              avatar={resolveCover(focusedCharacter.media ?? [], focusedCharacter.avatar)}
              color={focusedCharacter.highlightColor}
              workPath={workPath}
              onChange={(avatar) =>
                handleUpdateCharacterAttributes(focusedCharacter.id, { avatar })
              }
              onOpenGallery={() => setTab('gallery')}
            />
            <div className={styles.workspaceHeroMain}>
              <div className={styles.workspaceEyebrow}>人物资料</div>
              <div className={styles.workspaceTitleRow}>
                <h2 className={`${styles.workspaceTitle} ${styles.workspaceTitleGrow}`}>
                  {focusedCharacter.name}
                </h2>
                {(onOpenGrowthSheet || renderGrowth) && (
                  <CharacterGrowthButton
                    characterName={focusedCharacter.name}
                    level={growthLevel}
                    // 成长档案嵌在本页时切到「成长档案」分页，否则打开成长档案标签
                    onOpen={
                      renderGrowth
                        ? () => setTab('growth')
                        : (onOpenGrowthSheet ?? (() => undefined))
                    }
                  />
                )}
              </div>
              <p className={styles.workspaceDesc}>
                {focusedTimeline.length > 0
                  ? `已从整个作品目录中按章节整理出 ${focusedTimeline.length} 段关键经历，覆盖前期到后期的主要推进。`
                  : focusedCharacter.description || '这个人物还没有补充详细描述。'}
              </p>
              <div className={styles.workspaceMetaRow}>
                <span className={styles.workspaceChip}>
                  分类 {CHARACTER_CATEGORY_LABELS[focusedCharacter.category]}
                </span>
                <span className={styles.workspaceChip}>
                  角色定位 {focusedCharacter.role || '未填写'}
                </span>
                <span className={styles.workspaceChip}>
                  阵营 {CAMP_LABELS[focusedCamp ?? 'support']}
                </span>
                <span className={styles.workspaceChip}>正文热度 {focusedHeat}</span>
                <span className={styles.workspaceChip}>关系 {selectedRelations.length}</span>
              </div>
            </div>
          </section>

          <div className={tabStyles.tabs} role="tablist" aria-label="人物详情">
            {CHARACTER_DETAIL_TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                className={tab === item.id ? tabStyles.tabActive : tabStyles.tab}
                onClick={() => setTab(item.id)}
              >
                {item.label}
                {item.id === 'gallery' && (focusedCharacter.media?.length ?? 0) > 0 && (
                  <span className={tabStyles.tabCount}>{focusedCharacter.media?.length}</span>
                )}
                {item.id === 'growth' && growthLevel !== null && (
                  <span className={tabStyles.tabCount}>Lv.{growthLevel}</span>
                )}
              </button>
            ))}
          </div>

          {tab === 'design' && (
            <div className={tabStyles.panel} role="tabpanel" aria-label="人物设计">
              <CharacterDesignForm
                key={`${workPath}:${focusedCharacter.id}`}
                design={focusedCharacter.design}
                onSave={(designPatch, designExpected) =>
                  handleUpdateCharacterAttributes(focusedCharacter.id, {
                    designPatch,
                    designExpected,
                  })
                }
              />
              <CharacterVoiceForm
                voice={focusedCharacter.voice}
                onSave={(voice) => handleUpdateCharacterAttributes(focusedCharacter.id, { voice })}
              />
              {focusedCharacter.description && (
                <section className={styles.workspaceCardShell}>
                  <div className={styles.workspaceCardHeader}>
                    <span className={styles.workspaceSectionTitle}>资料摘要</span>
                    <span className={styles.workspaceListHint}>
                      保留资料库中的原始描述，便于后续手工修订
                    </span>
                  </div>
                  <div className={styles.workspaceBodyCopy}>{focusedCharacter.description}</div>
                </section>
              )}
            </div>
          )}

          {tab === 'gallery' && (
            <div className={tabStyles.panel} role="tabpanel" aria-label="图集">
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
              {renderGrowth ? (
                renderGrowth(focusedCharacter.name)
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

          {tab === 'story' && (
            <div className={tabStyles.panel} role="tabpanel" aria-label="经历与状态">
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
            </div>
          )}

          {tab === 'relations' && (
            <div className={tabStyles.panel} role="tabpanel" aria-label="关系与高亮">
              <section className={styles.workspaceCardShell}>
                <div className={styles.workspaceCardHeader}>
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
                  <label className={styles.highlightColorField}>
                    <span className={styles.highlightFieldLabel}>高亮颜色</span>
                    <div className={styles.highlightColorControl}>
                      <input
                        type="color"
                        value={focusedCharacter.highlightColor || DEFAULT_CHARACTER_HIGHLIGHT_COLOR}
                        onChange={(event) =>
                          void handleUpdateCharacterAttributes(focusedCharacter.id, {
                            highlightColor: event.target.value,
                          })
                        }
                        className={styles.colorInput}
                      />
                      <span className={styles.highlightColorValue}>
                        {(
                          focusedCharacter.highlightColor || DEFAULT_CHARACTER_HIGHLIGHT_COLOR
                        ).toUpperCase()}
                      </span>
                    </div>
                  </label>
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

              <section className={styles.workspaceCardShell}>
                <div className={styles.workspaceCardHeader}>
                  <span className={styles.workspaceSectionTitle}>人物关系</span>
                  <span className={styles.workspaceListHint}>围绕当前人物的出场关系</span>
                </div>
                {selectedRelations.length > 0 ? (
                  <div className={styles.workspaceList}>
                    {selectedRelations.map((relation) => {
                      const otherId =
                        relation.sourceId === focusedCharacter.id
                          ? relation.targetId
                          : relation.sourceId;
                      const otherCharacter = characters.find((item) => item.id === otherId);
                      return (
                        <div key={relation.id} className={styles.workspaceListItem}>
                          <div className={`${styles.workspaceListTitle} ${styles.relationTitle}`}>
                            {otherCharacter && (
                              <CharacterAvatar
                                name={otherCharacter.name}
                                avatar={otherCharacter.avatar}
                                color={otherCharacter.highlightColor}
                                workPath={workPath}
                                size={22}
                              />
                            )}
                            {otherCharacter?.name || '未匹配人物'}
                          </div>
                          <div className={styles.workspaceListDesc}>
                            {relation.label}
                            {relation.note ? ` · ${relation.note}` : ''}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className={styles.emptyHint}>这个人物还没有整理关系。</div>
                )}
              </section>

              <section className={styles.workspaceCardShell}>
                <div className={styles.workspaceCardHeader}>
                  <span className={styles.workspaceSectionTitle}>人物网络</span>
                  <span className={styles.workspaceListHint}>保留当前人物的关系编辑能力</span>
                </div>
                {graphView}
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
