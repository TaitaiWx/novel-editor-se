import React, { useMemo, useState } from 'react';
import {
  checkSkillPrerequisites,
  getSkillProgress,
  type GrowthRuleset,
  type GrowthSheet,
} from '@novel-editor/core/growth';
import { HelpTip } from '../HelpTip';
import { GROWTH_TIPS } from '../growthGuide';
import styles from './styles.module.scss';

interface CardProps {
  ruleset: GrowthRuleset;
  sheet: GrowthSheet;
}

/** 属性：紧凑网格，悬停显示范围与成长规则 */
export const GrowthAttributesCard: React.FC<CardProps> = ({ ruleset, sheet }) => {
  const attributes = useMemo(() => {
    const known = ruleset.attributes.map((attr) => {
      const value = sheet.attributes[attr.key] ?? attr.initial;
      const cap = attr.initial + attr.perLevelCap * Math.max(0, sheet.level - 1);
      return {
        key: attr.key,
        name: attr.name,
        value,
        over: value > cap,
        tip: `${attr.description ? `${attr.description}\n` : ''}每级自动 +${attr.growthPerLevel}，${sheet.level} 级合理上限 ${cap}（范围 ${attr.min}~${attr.max}）`,
      };
    });
    const extra = Object.entries(sheet.attributes)
      .filter(([key]) => !ruleset.attributes.some((attr) => attr.key === key))
      .map(([key, value]) => ({ key, name: key, value, over: false, tip: '规则中未定义该属性' }));
    return [...known, ...extra];
  }, [ruleset.attributes, sheet.attributes, sheet.level]);

  return (
    <section className={styles.card} aria-label="属性">
      <h3 className={styles.title}>
        属性
        <HelpTip text={GROWTH_TIPS.attributes} label="属性说明" />
      </h3>
      {attributes.length === 0 ? (
        <div className={styles.empty}>规则里还没有定义属性，可在「⋯ → 编辑规则」中添加</div>
      ) : (
        <div className={styles.attrGrid}>
          {attributes.map((attr) => (
            <div key={attr.key} className={styles.attr} title={attr.tip}>
              <span className={styles.attrName}>{attr.name}</span>
              <span className={`${styles.attrValue} ${attr.over ? styles.attrOver : ''}`}>
                {attr.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

/** 技能：等级 + 下一级所需技能经验；底部列出现在就能学的技能 */
export const GrowthSkillsCard: React.FC<CardProps> = ({ ruleset, sheet }) => {
  const learned = sheet.skills.filter((entry) => entry.level > 0);
  const ready = useMemo(
    () =>
      ruleset.skills.filter(
        (skill) =>
          !sheet.skills.some((entry) => entry.id === skill.id && entry.level > 0) &&
          checkSkillPrerequisites(ruleset, sheet, skill).length === 0
      ),
    [ruleset, sheet]
  );

  return (
    <section className={styles.card} aria-label="技能">
      <h3 className={styles.title}>
        技能
        <HelpTip text={GROWTH_TIPS.skills} label="技能说明" />
        <span className={styles.meta}>{learned.length > 0 ? `${learned.length} 项` : ''}</span>
      </h3>
      {learned.length === 0 && <div className={styles.empty}>还没有学会技能</div>}
      <ul className={styles.skills}>
        {learned.map((entry) => {
          const info = getSkillProgress(ruleset, entry);
          const def = ruleset.skills.find((skill) => skill.id === entry.id);
          return (
            <li key={entry.id} className={styles.skill} title={def?.description ?? ''}>
              <span className={styles.skillName}>
                {info.name}
                {!info.known && <span className={styles.unknown}>未定义</span>}
              </span>
              <span className={styles.skillLevel}>
                Lv {info.level}/{info.maxLevel}
              </span>
              <span className={styles.skillNext}>
                {info.expToNext === null
                  ? '已满级'
                  : `下一级需 ${info.nextCost} 技能经验（还差 ${info.expToNext}）`}
              </span>
            </li>
          );
        })}
      </ul>
      {ready.length > 0 && (
        <div className={styles.ready}>
          现在可以学：
          {ready.map((skill) => (
            <span key={skill.id} className={styles.readyItem} title={skill.description ?? ''}>
              {skill.name}
            </span>
          ))}
        </div>
      )}
    </section>
  );
};

interface ChoicesCardProps extends CardProps {
  busy: boolean;
  onChoose: (groupId: string, optionId: string) => void;
}

/** 抉择：已做出的选择 + 尚未选择的抉择组（点两次确认，不可撤销） */
export const GrowthChoicesCard: React.FC<ChoicesCardProps> = ({
  ruleset,
  sheet,
  busy,
  onChoose,
}) => {
  const [confirming, setConfirming] = useState<string | null>(null);
  const pendingGroups = ruleset.choiceGroups.filter(
    (group) => sheet.choices.filter((choice) => choice.groupId === group.id).length < group.pick
  );
  if (sheet.choices.length === 0 && pendingGroups.length === 0) return null;

  return (
    <section className={styles.card} aria-label="抉择">
      <h3 className={styles.title}>
        抉择
        <HelpTip text={GROWTH_TIPS.choices} label="抉择说明" />
      </h3>
      {sheet.choices.map((choice) => {
        const group = ruleset.choiceGroups.find((item) => item.id === choice.groupId);
        const option = group?.options.find((item) => item.id === choice.optionId);
        return (
          <div key={`${choice.groupId}-${choice.optionId}`} className={styles.choiceMade}>
            <span className={styles.choiceGroup}>{group?.name ?? choice.groupId}</span>
            <strong>{option?.name ?? choice.optionId}</strong>
            {choice.chapter !== undefined && (
              <span className={styles.chapterTag}>第 {choice.chapter} 章</span>
            )}
          </div>
        );
      })}
      {pendingGroups.map((group) => {
        const locked = group.unlockLevel !== undefined && sheet.level < group.unlockLevel;
        return (
          <div key={group.id} className={styles.choicePending}>
            <div className={styles.choiceGroup} title={group.description ?? ''}>
              {group.name}
              <span className={styles.choiceState}>
                {locked ? `建议 ${group.unlockLevel} 级时选择` : '待选择 · 点两次确认'}
              </span>
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
        );
      })}
    </section>
  );
};
