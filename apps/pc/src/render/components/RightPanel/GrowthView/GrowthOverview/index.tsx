import React, { useMemo, useState } from 'react';
import { getLevelProgress, latestChapterOfSheet } from '@novel-editor/core/growth';
import type { GrowthSnapshot } from '../../../../types/growth-api';
import { GrowthAttention } from '../GrowthAttention';
import { GrowthWorld, type GrowthWorldTab } from '../GrowthWorld';
import type { GrowthMemoryApi } from '../useGrowthMemory';
import styles from './styles.module.scss';

interface GrowthOverviewProps {
  growth: GrowthMemoryApi;
  snapshot: GrowthSnapshot;
  onOpenCharacter: (name: string) => void;
  /** 新建成长卡（询问角色名）；未提供时隐藏按钮 */
  onCreate?: () => void;
  onOpenHelp: () => void;
}

type OverviewSection = 'characters' | 'world';

/** 成长档案总览：所有角色的卡片网格 + 世界（队伍 / 地图 / 规则） */
export const GrowthOverview: React.FC<GrowthOverviewProps> = ({
  growth,
  snapshot,
  onOpenCharacter,
  onCreate,
  onOpenHelp,
}) => {
  const [section, setSection] = useState<OverviewSection>('characters');
  const [worldTab, setWorldTab] = useState<GrowthWorldTab>('party');
  const characterNames = useMemo(
    () => growth.characters.map((item) => item.name),
    [growth.characters]
  );
  const withoutSheet = growth.characters.filter((item) => !item.hasSheet);
  const cards = useMemo(
    () =>
      snapshot.sheets.map((sheet) => {
        const own = snapshot.check.warnings.filter(
          (warning) => warning.character === sheet.name && warning.severity !== 'info'
        );
        return {
          sheet,
          progress: getLevelProgress(snapshot.ruleset, sheet),
          latest: latestChapterOfSheet(sheet),
          attention:
            own.length + snapshot.check.forgotten.filter((f) => f.name === sheet.name).length,
          hasError: own.some((warning) => warning.severity === 'error'),
        };
      }),
    [snapshot]
  );

  return (
    <div className={styles.overview}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h1 className={styles.title}>成长档案</h1>
          <span className={styles.count}>{snapshot.sheets.length} 个角色</span>
        </div>
        <div className={styles.actions}>
          {onCreate && (
            <button type="button" className={styles.primary} onClick={onCreate}>
              + 新建成长卡
            </button>
          )}
          <button
            type="button"
            className={styles.iconButton}
            aria-label="使用说明"
            title="使用说明"
            onClick={onOpenHelp}
          >
            ?
          </button>
        </div>
      </header>
      <nav className={styles.sections} role="tablist" aria-label="总览分区">
        {(
          [
            ['characters', '角色'],
            ['world', '世界'],
          ] as Array<[OverviewSection, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={section === key}
            className={styles.section}
            onClick={() => setSection(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {section === 'characters' && (
        <>
          <GrowthAttention
            warnings={snapshot.check.warnings}
            forgotten={snapshot.check.forgotten}
            showCharacter
          />
          {cards.length === 0 ? (
            <section className={styles.empty} aria-label="还没有成长卡">
              <h2 className={styles.emptyTitle}>还没有成长卡</h2>
              <p className={styles.emptyText}>
                为主角和重要配角各建一张卡，写完一章花 30
                秒「记一笔」。几百章后，等级、技能和当初的抉择都一目了然。
              </p>
              <div className={styles.emptyActions}>
                {onCreate && (
                  <button type="button" className={styles.primary} onClick={onCreate}>
                    + 新建成长卡
                  </button>
                )}
                <button type="button" className={styles.secondary} onClick={onOpenHelp}>
                  查看使用说明
                </button>
              </div>
            </section>
          ) : (
            <ul className={styles.grid}>
              {cards.map(({ sheet, progress, latest, attention, hasError }) => (
                <li key={sheet.name}>
                  <button
                    type="button"
                    className={styles.card}
                    aria-label={`打开 ${sheet.name} 的成长卡`}
                    onClick={() => onOpenCharacter(sheet.name)}
                  >
                    <span className={styles.cardTop}>
                      <span className={styles.cardName}>{sheet.name}</span>
                      <span className={styles.level}>Lv.{sheet.level}</span>
                      {attention > 0 && (
                        <span
                          className={`${styles.dot} ${hasError ? styles.dotError : ''}`}
                          title={`${attention} 处需要留意`}
                          aria-label={`${attention} 处需要留意`}
                        />
                      )}
                    </span>
                    <span className={styles.track} aria-hidden="true">
                      <span style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
                    </span>
                    <span className={styles.cardMeta}>
                      <span>
                        {progress.isMaxLevel ? '已满级' : `距下一级 ${progress.expToNext}`}
                      </span>
                      <span>{latest > 0 ? `最近 第 ${latest} 章` : '尚未记录'}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {withoutSheet.length > 0 && (
            <div className={styles.suggest}>
              <span className={styles.suggestLabel}>人物库中还没建卡：</span>
              {withoutSheet.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  className={styles.suggestItem}
                  onClick={() => onOpenCharacter(item.name)}
                >
                  + {item.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {section === 'world' && (
        <GrowthWorld
          snapshot={snapshot}
          growth={growth}
          characterNames={characterNames}
          selectedCharacter={null}
          tab={worldTab}
          onTabChange={setWorldTab}
        />
      )}
    </div>
  );
};

export default GrowthOverview;
