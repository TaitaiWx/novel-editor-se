import React, { useMemo, useState } from 'react';
import {
  CHARACTER_DESIGN_FIELDS,
  parseCharacterDesign,
  resolveCover,
} from '@novel-editor/core/entity-media';
import CharacterAvatar from '../../../CharacterAvatar';
import { MediaImage } from '../../../EntityGallery/MediaTile';
import Tooltip from '../../../Tooltip';
import { CHARACTER_CATEGORY_LABELS } from '../../utils';
import type { Character } from '../../types';
import styles from './styles.module.scss';

export interface CharacterOverviewSummary {
  id: number;
  name: string;
  cover?: string;
  /** 已填写的人物设计字段数 / 总数 */
  designFilled: number;
  designTotal: number;
  imageCount: number;
  hasTurnaround: boolean;
  level: number | null;
  /** 待补充的提示（缺三视图 / 缺人物设计 / 还没有成长档案） */
  hints: string[];
}

/** 人物卡片摘要（人物维度：设计、图集、成长都汇总到人物上） */
export function summarizeCharacter(
  character: Character,
  level: number | null
): CharacterOverviewSummary {
  const design = parseCharacterDesign(character.design);
  const designFilled = CHARACTER_DESIGN_FIELDS.filter(({ key }) => design[key].trim()).length;
  const media = character.media ?? [];
  const hasTurnaround = media.some((item) => item.kind === 'turnaround');
  const hints: string[] = [];
  if (designFilled === 0) hints.push('缺人物设计');
  if (!hasTurnaround) hints.push('缺三视图');
  if (level === null) hints.push('没有成长档案');
  return {
    id: character.id,
    name: character.name,
    cover: resolveCover(media, character.avatar),
    designFilled,
    designTotal: CHARACTER_DESIGN_FIELDS.length,
    imageCount: media.length,
    hasTurnaround,
    level,
    hints,
  };
}

export type OverviewTab = 'people' | 'growth' | 'relations';

interface CharacterOverviewProps {
  characters: readonly Character[];
  /** 人物名（或别名）→ 成长等级 */
  levelOf: (character: Character) => number | null;
  workPath: string | null;
  onOpenCharacter: (id: number) => void;
  onCreateCharacter?: () => void;
  /** 「成长」分页：嵌入成长总览（等级、提醒、被遗忘的配角） */
  renderGrowthOverview?: () => React.ReactNode;
  /** 「关系」分页：人物编辑列表与关系网络 */
  relationsView: React.ReactNode;
}

/**
 * 人物总览（人物维度）：每个人物一张卡片——主要形象图、定位、等级、设计完成度、图集数量与待补充提示；
 * 成长（等级 / 提醒）与关系是其中的分页，而不是单独的「成长总览」
 */
export const CharacterOverview: React.FC<CharacterOverviewProps> = ({
  characters,
  levelOf,
  workPath,
  onOpenCharacter,
  onCreateCharacter,
  renderGrowthOverview,
  relationsView,
}) => {
  const [tab, setTab] = useState<OverviewTab>('people');
  const summaries = useMemo(
    () =>
      characters.map((item) => ({
        character: item,
        summary: summarizeCharacter(item, levelOf(item)),
      })),
    [characters, levelOf]
  );
  const stats = useMemo(
    () => ({
      total: summaries.length,
      turnaround: summaries.filter((item) => item.summary.hasTurnaround).length,
      growth: summaries.filter((item) => item.summary.level !== null).length,
      designed: summaries.filter((item) => item.summary.designFilled > 0).length,
    }),
    [summaries]
  );
  const tabs: Array<[OverviewTab, string]> = [
    ['people', '人物'],
    ...(renderGrowthOverview ? ([['growth', '成长']] as Array<[OverviewTab, string]>) : []),
    ['relations', '关系'],
  ];

  return (
    <div className={styles.overview} data-testid="character-overview">
      <header className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>人物总览</div>
          <h2 className={styles.title}>人物</h2>
          <p className={styles.desc}>
            每个人物有设计、图集和成长档案。卡片上的提示告诉你还缺什么：三视图让视频里的人物不崩，人物设计让续写不跑偏。
          </p>
        </div>
        <div className={styles.stats}>
          <span>人物 {stats.total}</span>
          <span>有设计 {stats.designed}</span>
          <span>有三视图 {stats.turnaround}</span>
          <span>有成长档案 {stats.growth}</span>
        </div>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="人物总览">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? styles.tabActive : styles.tab}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'people' && (
        <ul className={styles.grid} role="list" aria-label="人物">
          {summaries.map(({ character, summary }) => (
            <li key={summary.id}>
              <button
                type="button"
                className={styles.card}
                aria-label={`打开人物 ${summary.name}`}
                onClick={() => onOpenCharacter(summary.id)}
              >
                <span className={styles.cover}>
                  {summary.cover ? (
                    <MediaImage path={summary.cover} workPath={workPath} alt="" />
                  ) : (
                    <CharacterAvatar
                      name={summary.name}
                      src={null}
                      size={44}
                      color={character.highlightColor}
                    />
                  )}
                </span>
                <span className={styles.body}>
                  <span className={styles.nameRow}>
                    <strong>{summary.name}</strong>
                    {summary.level !== null && (
                      <span className={styles.level}>Lv.{summary.level}</span>
                    )}
                  </span>
                  <span className={styles.meta}>
                    {CHARACTER_CATEGORY_LABELS[character.category]}
                    {character.role ? ` · ${character.role}` : ''}
                  </span>
                  <span className={styles.meta}>
                    设计 {summary.designFilled}/{summary.designTotal} · 图片 {summary.imageCount}
                  </span>
                  {summary.hints.length > 0 && (
                    <span className={styles.hints}>
                      {summary.hints.map((hint) => (
                        <span key={hint} className={styles.hint}>
                          {hint}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
          {onCreateCharacter && (
            <li>
              <Tooltip content="新建人物：之后在人物详情里补设计、图集和成长档案">
                <button type="button" className={styles.addCard} onClick={onCreateCharacter}>
                  ＋ 新建人物
                </button>
              </Tooltip>
            </li>
          )}
        </ul>
      )}
      {tab === 'growth' && renderGrowthOverview && (
        <div role="tabpanel" aria-label="成长">
          {renderGrowthOverview()}
        </div>
      )}
      {tab === 'relations' && (
        <div role="tabpanel" aria-label="关系" className={styles.relations}>
          {relationsView}
        </div>
      )}
    </div>
  );
};

export default CharacterOverview;
