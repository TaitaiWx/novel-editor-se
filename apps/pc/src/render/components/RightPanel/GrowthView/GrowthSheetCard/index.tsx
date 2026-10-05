import React, { useMemo, useState } from 'react';
import {
  checkSkillPrerequisites,
  getLevelProgress,
  getSkillProgress,
  type GrowthRuleset,
  type GrowthSheet,
} from '@novel-editor/core/growth';
import styles from './styles.module.scss';

interface GrowthSheetCardProps {
  ruleset: GrowthRuleset;
  sheet: GrowthSheet;
  busy: boolean;
  onChoose: (groupId: string, optionId: string) => void;
}

/**
 * RPG 风格角色卡：等级徽章、经验条、属性、技能（含下一级所需经验）、抉择
 */
export const GrowthSheetCard: React.FC<GrowthSheetCardProps> = ({
  ruleset,
  sheet,
  busy,
  onChoose,
}) => {
  const progress = getLevelProgress(ruleset, sheet);
  // 抉择不可撤销：第一次点击进入确认状态，再次点击才写入
  const [confirming, setConfirming] = useState<string | null>(null);
  const percent = Math.round(progress.ratio * 100);

  const attributes = useMemo(() => {
    const known = ruleset.attributes.map((attr) => ({
      key: attr.key,
      name: attr.name,
      value: sheet.attributes[attr.key] ?? attr.initial,
      tip: `${attr.description ? `${attr.description}\n` : ''}范围 ${attr.min}~${attr.max}，每级成长 +${attr.growthPerLevel}，每级上限 +${attr.perLevelCap}`,
      ratio:
        attr.max > attr.min
          ? ((sheet.attributes[attr.key] ?? attr.initial) - attr.min) / (attr.max - attr.min)
          : 1,
    }));
    const extra = Object.entries(sheet.attributes)
      .filter(([key]) => !ruleset.attributes.some((attr) => attr.key === key))
      .map(([key, value]) => ({ key, name: key, value, tip: '未在规则中定义', ratio: 0 }));
    return [...known, ...extra];
  }, [ruleset.attributes, sheet.attributes]);

  const learnable = useMemo(
    () =>
      ruleset.skills
        .filter((skill) => !sheet.skills.some((entry) => entry.id === skill.id && entry.level > 0))
        .map((skill) => ({ skill, problems: checkSkillPrerequisites(ruleset, sheet, skill) })),
    [ruleset, sheet]
  );

  const pendingGroups = ruleset.choiceGroups.filter(
    (group) => sheet.choices.filter((choice) => choice.groupId === group.id).length < group.pick
  );

  return (
    <div className={styles.sheet}>
      <div className={styles.header}>
        <div className={styles.levelBadge} title={`等级上限 ${progress.maxLevel}`}>
          <span className={styles.levelLabel}>Lv</span>
          <span className={styles.levelValue}>{sheet.level}</span>
        </div>
        <div className={styles.headerMain}>
          <div className={styles.name}>
            {sheet.name}
            {sheet.aliases.length > 0 && (
              <span className={styles.aliases}>{sheet.aliases.join(' / ')}</span>
            )}
          </div>
          <div
            className={styles.expTrack}
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            title={`累计经验 ${sheet.exp}`}
          >
            <div className={styles.expFill} style={{ width: `${percent}%` }} />
          </div>
          <div className={styles.expText}>
            {progress.isMaxLevel ? (
              <span>已满级 · 累计经验 {sheet.exp}</span>
            ) : (
              <>
                <span title="本级已获得 / 升到下一级所需经验">
                  本级 {progress.expIntoLevel} / {progress.expForLevel} · 累计经验 {sheet.exp}
                </span>
                <span className={styles.expToNext}>距下一级 {progress.expToNext} 经验</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>属性</div>
        {attributes.length === 0 ? (
          <div className={styles.empty}>规则中还没有定义属性</div>
        ) : (
          <div className={styles.attrGrid}>
            {attributes.map((attr) => (
              <div key={attr.key} className={styles.attr} title={attr.tip}>
                <span className={styles.attrName}>{attr.name}</span>
                <span className={styles.attrValue}>{attr.value}</span>
                <span className={styles.attrBar}>
                  <span style={{ width: `${Math.max(0, Math.min(1, attr.ratio)) * 100}%` }} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          <span>技能</span>
          <span className={styles.sectionMeta}>{sheet.skills.length} 项</span>
        </div>
        {sheet.skills.length === 0 && <div className={styles.empty}>尚未掌握技能</div>}
        {sheet.skills.map((entry) => {
          const info = getSkillProgress(ruleset, entry);
          const def = ruleset.skills.find((skill) => skill.id === entry.id);
          const skillRatio = info.nextCost ? Math.min(1, info.exp / info.nextCost) : 1;
          return (
            <div key={entry.id} className={styles.skill} title={def?.description ?? ''}>
              <div className={styles.skillRow}>
                <span className={styles.skillName}>
                  {info.name}
                  {!info.known && <span className={styles.unknown}>未定义</span>}
                </span>
                <span className={styles.skillLevel}>
                  Lv {info.level}/{info.maxLevel}
                </span>
              </div>
              <div className={styles.skillTrack}>
                <div className={styles.skillFill} style={{ width: `${skillRatio * 100}%` }} />
              </div>
              <div className={styles.skillCost}>
                {info.expToNext === null
                  ? '已满级'
                  : `下一级需 ${info.nextCost} 技能经验（还差 ${info.expToNext}）`}
              </div>
            </div>
          );
        })}
        {learnable.length > 0 && (
          <div className={styles.learnable}>
            {learnable.map(({ skill, problems }) => (
              <span
                key={skill.id}
                className={`${styles.chip} ${problems.length === 0 ? styles.chipReady : ''}`}
                title={problems.length ? problems.join('\n') : `${skill.description ?? ''}\n可学习`}
              >
                {skill.name}
                {problems.length === 0 ? ' · 可学习' : ''}
              </span>
            ))}
          </div>
        )}
      </div>

      {(sheet.choices.length > 0 || pendingGroups.length > 0) && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>能力抉择</div>
          {sheet.choices.map((choice) => {
            const group = ruleset.choiceGroups.find((item) => item.id === choice.groupId);
            const option = group?.options.find((item) => item.id === choice.optionId);
            return (
              <div key={`${choice.groupId}-${choice.optionId}`} className={styles.choiceMade}>
                <span>{group?.name ?? choice.groupId}</span>
                <span className={styles.choiceArrow}>→</span>
                <strong>{option?.name ?? choice.optionId}</strong>
                {choice.chapter !== undefined && (
                  <span className={styles.chapterTag}>第 {choice.chapter} 章</span>
                )}
              </div>
            );
          })}
          {pendingGroups.map((group) => (
            <div key={group.id} className={styles.choicePending}>
              <div className={styles.choiceGroupName} title={group.description ?? ''}>
                {group.name}
                {group.unlockLevel ? `（${group.unlockLevel} 级解锁）` : ''}
              </div>
              <div className={styles.choiceOptions}>
                {group.options.map((option) => {
                  const key = `${group.id}:${option.id}`;
                  const armed = confirming === key;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className={`${styles.choiceOption} ${armed ? styles.choiceArmed : ''}`}
                      disabled={busy}
                      title={option.description ?? ''}
                      onClick={() => {
                        if (!armed) {
                          setConfirming(key);
                          return;
                        }
                        setConfirming(null);
                        onChoose(group.id, option.id);
                      }}
                      onBlur={() => armed && setConfirming(null)}
                    >
                      {armed ? `确认选择「${option.name}」` : option.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default GrowthSheetCard;
