import React, { useMemo, useState } from 'react';
import { getLevelProgress } from '@novel-editor/core/growth';
import type { GrowthSnapshot } from '../../../../types/growth-api';
import { findMentionedNames, requestOpenGrowth } from '../../../../utils/growthIndex';
import { GrowthRecordButton } from '../GrowthRecordButton';
import { defaultRecordChapter } from '../growthText';
import type { GrowthMemoryApi } from '../useGrowthMemory';
import styles from './styles.module.scss';

interface GrowthPanelSummaryProps {
  growth: GrowthMemoryApi;
  snapshot: GrowthSnapshot;
  /** 当前章节正文：用于找出本章出场的已建卡角色 */
  content: string;
  currentChapter: number | null;
  onOpenHelp: () => void;
}

/**
 * 右侧面板「成长」：只读摘要。列出本章出场（或手动选中）的角色，可直接「记一笔」，
 * 完整档案在工作区标签中打开。
 */
export const GrowthPanelSummary: React.FC<GrowthPanelSummaryProps> = ({
  growth,
  snapshot,
  content,
  currentChapter,
  onOpenHelp,
}) => {
  const [picked, setPicked] = useState<string | null>(null);
  const mentioned = useMemo(
    () => findMentionedNames(content, snapshot.sheets),
    [content, snapshot.sheets]
  );
  const shownNames = useMemo(() => {
    const names = [...mentioned];
    if (picked && !names.includes(picked)) names.push(picked);
    return names;
  }, [mentioned, picked]);
  const others = snapshot.sheets.filter((sheet) => !shownNames.includes(sheet.name));
  const attentionOf = (name: string) =>
    snapshot.check.warnings.filter(
      (warning) => warning.character === name && warning.severity !== 'info'
    ).length;

  return (
    <div className={styles.summary}>
      <div className={styles.head}>
        <span className={styles.caption}>
          {snapshot.sheets.length === 0
            ? '还没有成长卡'
            : mentioned.length > 0
              ? `本章出场 ${mentioned.length} 个已建卡角色`
              : '本章没有提到已建卡的角色'}
        </span>
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

      {shownNames.map((name) => {
        const sheet = snapshot.sheets.find((item) => item.name === name);
        if (!sheet) return null;
        const progress = getLevelProgress(snapshot.ruleset, sheet);
        const attention = attentionOf(name);
        const chapter = defaultRecordChapter(currentChapter, sheet);
        return (
          <div key={name} className={styles.row}>
            <button
              type="button"
              className={styles.rowMain}
              title="打开成长卡"
              onClick={() => requestOpenGrowth(name)}
            >
              <span className={styles.rowTop}>
                <span className={styles.name}>{name}</span>
                <span className={styles.level}>Lv.{sheet.level}</span>
                {attention > 0 && (
                  <span className={styles.dot} aria-label={`${attention} 处需要留意`} />
                )}
              </span>
              <span className={styles.track} aria-hidden="true">
                <span style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
              </span>
              <span className={styles.meta}>
                {progress.isMaxLevel ? '已满级' : `距下一级 ${progress.expToNext}`}
                {sheet.skills.length > 0 ? ` · ${sheet.skills.length} 个技能` : ''}
              </span>
            </button>
            <GrowthRecordButton
              variant="compact"
              ruleset={snapshot.ruleset}
              sheet={sheet}
              busy={growth.busy}
              defaultChapter={chapter}
              chapterSource={currentChapter ? 'current' : chapter ? 'latest' : null}
              onSubmit={(event, force) => growth.applyEvent(event, force, name)}
            />
          </div>
        );
      })}

      {others.length > 0 && (
        <div className={styles.others}>
          <span className={styles.othersLabel}>
            {shownNames.length > 0 ? '其他角色' : '选择角色'}
          </span>
          {others.map((sheet) => (
            <button
              key={sheet.name}
              type="button"
              className={styles.chip}
              onClick={() => setPicked(sheet.name)}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}

      <button type="button" className={styles.open} onClick={() => requestOpenGrowth(null)}>
        打开成长档案
      </button>
    </div>
  );
};

export default GrowthPanelSummary;
