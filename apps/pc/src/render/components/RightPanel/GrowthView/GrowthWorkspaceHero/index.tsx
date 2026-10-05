import React from 'react';
import {
  getLevelProgress,
  latestChapterOfSheet,
  type GrowthRuleset,
  type GrowthSheet,
} from '@novel-editor/core/growth';
import styles from './styles.module.scss';

interface GrowthWorkspaceHeroProps {
  sheet: GrowthSheet | null;
  ruleset: GrowthRuleset;
  sheetCount: number;
  warningCount: number;
}

/**
 * 工作区标签中的成长档案标题区：角色名 + 等级徽章 + 关键指标，
 * 同时用一句话说明成长档案的用途（首次使用提示）。
 */
export const GrowthWorkspaceHero: React.FC<GrowthWorkspaceHeroProps> = ({
  sheet,
  ruleset,
  sheetCount,
  warningCount,
}) => {
  const progress = sheet ? getLevelProgress(ruleset, sheet) : null;
  const latestChapter = sheet ? latestChapterOfSheet(sheet) : 0;
  const skillCount = sheet ? sheet.skills.filter((skill) => skill.level > 0).length : 0;

  return (
    <section className={styles.hero} aria-label="成长档案概览">
      <div className={styles.eyebrow}>成长档案</div>
      <div className={styles.titleRow}>
        <h2 className={styles.title}>{sheet ? sheet.name : '角色成长总览'}</h2>
        {progress && (
          <span className={styles.levelBadge} aria-label={`等级 ${progress.level}`}>
            Lv.{progress.level}
          </span>
        )}
      </div>
      <p className={styles.desc}>
        像 DND 角色卡一样记录等级、经验、属性、技能与二选一 / 三选一抉择，数据保存在
        <code>资料/记忆/</code>，与 CLI <code>ne growth</code>{' '}
        共用。等级或属性暴涨、违背核心规则时会提醒你，避免写到几百章后战力崩溃。
      </p>
      <div className={styles.chips}>
        {sheet && progress ? (
          <>
            <span className={styles.chip}>经验 {sheet.exp}</span>
            <span className={styles.chip}>
              {progress.isMaxLevel ? '已满级' : `距下一级 ${progress.expToNext}`}
            </span>
            <span className={styles.chip}>技能 {skillCount}</span>
            <span className={styles.chip}>抉择 {sheet.choices.length}</span>
            <span className={styles.chip}>
              {latestChapter > 0 ? `最近记录 第 ${latestChapter} 章` : '尚未关联章节'}
            </span>
            {warningCount > 0 && (
              <span className={`${styles.chip} ${styles.chipWarning}`}>
                一致性提醒 {warningCount}
              </span>
            )}
          </>
        ) : (
          <span className={styles.chip}>已建档角色 {sheetCount}</span>
        )}
      </div>
    </section>
  );
};

export default GrowthWorkspaceHero;
