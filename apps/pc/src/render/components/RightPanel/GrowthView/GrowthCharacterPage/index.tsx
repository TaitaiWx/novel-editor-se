import React, { useMemo, useState } from 'react';
import { getLevelProgress, type GrowthSheet } from '@novel-editor/core/growth';
import type { GrowthSnapshot } from '../../../../types/growth-api';
import { GrowthAttention } from '../GrowthAttention';
import { GrowthMoreMenu } from '../GrowthMoreMenu';
import { GrowthNotesCard } from '../GrowthNotesCard';
import { GrowthRecordButton } from '../GrowthRecordButton';
import { GrowthSimulationPanel } from '../GrowthSimulationPanel';
import { GrowthAttributesCard, GrowthChoicesCard, GrowthSkillsCard } from '../GrowthStatCards';
import { GrowthTimeline } from '../GrowthTimeline';
import { GrowthWorld, type GrowthWorldTab } from '../GrowthWorld';
import { GROWTH_TIPS } from '../growthGuide';
import { defaultRecordChapter, relevantForgotten } from '../growthText';
import type { GrowthMemoryApi } from '../useGrowthMemory';
import styles from './styles.module.scss';

export type GrowthPageSection = 'sheet' | 'simulate' | 'world';

const SECTIONS: Array<[GrowthPageSection, string]> = [
  ['sheet', '档案'],
  ['simulate', '推演'],
  ['world', '世界'],
];

interface GrowthCharacterPageProps {
  growth: GrowthMemoryApi;
  snapshot: GrowthSnapshot;
  sheet: GrowthSheet;
  /** 当前打开的正文章节（「记一笔」默认填入） */
  currentChapter: number | null;
  onOpenHelp: () => void;
  onDeleted: (name: string) => void;
  onError: (message: string | null) => void;
}

/**
 * 单个角色的成长卡：标题区（等级、经验条、记一笔、?、⋯）+ 档案 / 推演 / 世界
 */
export const GrowthCharacterPage: React.FC<GrowthCharacterPageProps> = ({
  growth,
  snapshot,
  sheet,
  currentChapter,
  onOpenHelp,
  onDeleted,
  onError,
}) => {
  const [section, setSection] = useState<GrowthPageSection>('sheet');
  const [worldTab, setWorldTab] = useState<GrowthWorldTab>('party');
  const progress = getLevelProgress(snapshot.ruleset, sheet);
  const percent = Math.round(progress.ratio * 100);
  const chapter = defaultRecordChapter(currentChapter, sheet);
  const chapterSource =
    currentChapter && currentChapter > 0 ? 'current' : chapter ? 'latest' : null;

  const warnings = useMemo(
    () => snapshot.check.warnings.filter((warning) => warning.character === sheet.name),
    [sheet.name, snapshot.check.warnings]
  );
  const forgotten = useMemo(
    () => relevantForgotten(snapshot.check.forgotten, snapshot.party, sheet.name),
    [sheet.name, snapshot.check.forgotten, snapshot.party]
  );
  const characterNames = useMemo(
    () => growth.characters.map((item) => item.name),
    [growth.characters]
  );

  const report = (promise: Promise<string | null>) => void promise.then(onError);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.topRow}>
          <div className={styles.identity}>
            <h1 className={styles.name}>{sheet.name}</h1>
            <span className={styles.level} aria-label={`等级 ${sheet.level}`}>
              Lv.{sheet.level}
            </span>
            {sheet.aliases.length > 0 && (
              <span className={styles.aliases}>{sheet.aliases.join(' / ')}</span>
            )}
          </div>
          <div className={styles.actions}>
            <GrowthRecordButton
              ruleset={snapshot.ruleset}
              sheet={sheet}
              busy={growth.busy}
              defaultChapter={chapter}
              chapterSource={chapterSource}
              tourTarget="record"
              onSubmit={(event, force) => growth.applyEvent(event, force, sheet.name)}
            />
            <button
              type="button"
              className={styles.iconButton}
              aria-label="使用说明"
              title="使用说明"
              onClick={onOpenHelp}
            >
              ?
            </button>
            <GrowthMoreMenu
              characterName={sheet.name}
              busy={growth.busy}
              onSync={() => report(growth.syncSnapshots())}
              onEditRules={() => {
                setSection('world');
                setWorldTab('rules');
              }}
              onOpenFolder={() => report(growth.openDataFolder())}
              onOpenHelp={onOpenHelp}
              onDelete={() =>
                void growth.deleteSheet(sheet.name).then((error) => {
                  onError(error);
                  if (!error) onDeleted(sheet.name);
                })
              }
            />
          </div>
        </div>
        <div className={styles.expRow} title={`累计经验 ${sheet.exp}`}>
          <div
            className={styles.expTrack}
            role="progressbar"
            aria-label="本级经验"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          <span className={styles.expText}>
            {progress.isMaxLevel
              ? `已满级 · 累计经验 ${sheet.exp}`
              : `本级 ${progress.expIntoLevel} / ${progress.expForLevel} · 距下一级 ${progress.expToNext}`}
          </span>
        </div>
        <nav className={styles.sections} role="tablist" aria-label="成长档案分区">
          {SECTIONS.map(([key, label]) => (
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
      </header>

      {section === 'sheet' && (
        <>
          <GrowthAttention warnings={warnings} forgotten={forgotten} />
          <div className={styles.grid}>
            <div className={styles.column}>
              <GrowthAttributesCard ruleset={snapshot.ruleset} sheet={sheet} />
              <GrowthSkillsCard ruleset={snapshot.ruleset} sheet={sheet} />
              <GrowthChoicesCard
                ruleset={snapshot.ruleset}
                sheet={sheet}
                busy={growth.busy}
                onChoose={(groupId, optionId) =>
                  report(
                    growth.applyEvent(
                      { type: 'choice', target: groupId, value: optionId, chapter },
                      false,
                      sheet.name
                    )
                  )
                }
              />
            </div>
            <div className={styles.column}>
              <GrowthTimeline ruleset={snapshot.ruleset} sheet={sheet} />
            </div>
          </div>
        </>
      )}

      {section === 'simulate' && (
        <div className={styles.stack}>
          <p className={styles.lead}>{GROWTH_TIPS.simulate}</p>
          <GrowthSimulationPanel
            key={sheet.name}
            ruleset={snapshot.ruleset}
            sheet={sheet}
            busy={growth.busy}
            onSimulate={growth.simulate}
            onApplyBranch={growth.applyBranch}
          />
          <GrowthNotesCard sheet={sheet} busy={growth.busy} onUpdateNotes={growth.updateNotes} />
        </div>
      )}

      {section === 'world' && (
        <GrowthWorld
          snapshot={snapshot}
          growth={growth}
          characterNames={characterNames}
          selectedCharacter={sheet.name}
          tab={worldTab}
          onTabChange={setWorldTab}
        />
      )}
    </div>
  );
};

export default GrowthCharacterPage;
