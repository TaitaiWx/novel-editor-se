import React from 'react';
import type { PowerLimits } from '@novel-editor/core/growth';
import { NumberField, countErrorsUnder, type RulesSectionProps } from './fields';
import { RulesSection } from './RulesSection';
import styles from './styles.module.scss';

const LIMIT_FIELDS: Array<[keyof PowerLimits, string, string]> = [
  ['maxLevelsPerChapter', '每章最多升级', '同一章内超过这个等级数会提示「战力暴涨」'],
  ['maxAttributeGainPerChapter', '单属性每章上限', '同一章内单项属性的最大提升'],
  ['maxSkillLevelsPerChapter', '单技能每章上限', '同一章内单个技能最多提升的等级'],
  ['forgottenAfterChapters', '配角遗忘阈值（章）', '配角超过多少章未出场会被提醒'],
];

/** 战力限制：一致性检查用的每章上限与配角遗忘阈值 */
export const LimitsSection: React.FC<RulesSectionProps> = ({ draft, update, issues, disabled }) => (
  <RulesSection
    title="战力限制"
    errorCount={countErrorsUnder(issues, 'limits')}
    testId="growth-rules-limits"
  >
    <div className={styles.numberGrid}>
      {LIMIT_FIELDS.map(([key, label, hint]) => (
        <div key={key} title={hint}>
          <NumberField
            label={label}
            value={draft.limits[key]}
            min={1}
            disabled={disabled}
            issues={issues}
            path={`limits.${key}`}
            onChange={(value) =>
              update((ruleset) => ({ ...ruleset, limits: { ...ruleset.limits, [key]: value } }))
            }
          />
        </div>
      ))}
    </div>
  </RulesSection>
);

export default LimitsSection;
