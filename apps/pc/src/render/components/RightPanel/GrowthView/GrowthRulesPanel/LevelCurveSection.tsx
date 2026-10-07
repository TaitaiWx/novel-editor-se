import React, { useMemo } from 'react';
import { VscAdd, VscTrash } from 'react-icons/vsc';
import { levelCurvePreview, type ExpCurve } from '@novel-editor/core/growth';
import {
  FieldIssue,
  IconButton,
  NumberField,
  countErrorsUnder,
  replaceAt,
  type RulesSectionProps,
} from './fields';
import { RulesSection } from './RulesSection';
import styles from './styles.module.scss';

/** 公式模式预览的升级次数 */
const PREVIEW_LEVELS = 10;

/** 等级曲线：经验表（逐级填写）或公式（基础经验 × 倍率^(等级-1)），以及最高等级 */
export const LevelCurveSection: React.FC<RulesSectionProps> = ({
  draft,
  update,
  issues,
  disabled,
}) => {
  const { levels } = draft;
  const curve = levels.curve;
  const preview = useMemo(() => levelCurvePreview(levels, PREVIEW_LEVELS), [levels]);
  const setCurve = (next: ExpCurve) =>
    update((ruleset) => ({ ...ruleset, levels: { ...ruleset.levels, curve: next } }));

  /** 切换模式：用当前曲线算出的数值预填，切换前后经验基本一致 */
  const switchKind = (kind: ExpCurve['kind']) => {
    if (kind === curve.kind) return;
    if (kind === 'table') {
      const rows = levelCurvePreview({ ...levels, maxLevel: Math.max(2, levels.maxLevel) }, 99);
      setCurve({ kind: 'table', perLevel: rows.map((row) => row.need) });
    } else {
      const first = curve.kind === 'table' ? (curve.perLevel[0] ?? 100) : 100;
      setCurve({ kind: 'formula', base: first > 0 ? first : 100, factor: 1.5 });
    }
  };

  return (
    <RulesSection
      title="等级曲线"
      meta={`${curve.kind === 'table' ? '经验表' : '公式'} · 最高 ${levels.maxLevel} 级`}
      errorCount={countErrorsUnder(issues, 'levels')}
      testId="growth-rules-levels"
    >
      <div className={styles.itemRow}>
        <div className={styles.segmented} role="radiogroup" aria-label="经验曲线类型">
          {(
            [
              ['table', '经验表'],
              ['formula', '公式'],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={curve.kind === kind}
              className={styles.segment}
              disabled={disabled}
              onClick={() => switchKind(kind)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={styles.narrow}>
          <NumberField
            label="最高等级"
            value={levels.maxLevel}
            min={1}
            max={999}
            disabled={disabled}
            issues={issues}
            path="levels.maxLevel"
            onChange={(maxLevel) =>
              update((ruleset) => ({ ...ruleset, levels: { ...ruleset.levels, maxLevel } }))
            }
          />
        </div>
      </div>

      {curve.kind === 'table' ? (
        <>
          <div className={styles.hint}>
            每行是升到下一级需要的经验；表比最高等级短时重复最后一项
          </div>
          <div className={styles.curveTable}>
            {curve.perLevel.map((need, index) => (
              <div key={index} className={styles.curveCell}>
                <span className={styles.fieldLabel}>
                  {index + 1} → {index + 2}
                </span>
                <div className={styles.inline}>
                  <NumberField
                    label=""
                    ariaLabel={`${index + 1} 级升 ${index + 2} 级经验`}
                    value={need}
                    min={0}
                    disabled={disabled}
                    issues={issues}
                    path={`levels.curve.perLevel.${index}`}
                    onChange={(value) =>
                      setCurve({ kind: 'table', perLevel: replaceAt(curve.perLevel, index, value) })
                    }
                  />
                  <IconButton
                    label={`删除第 ${index + 1} 级`}
                    danger
                    disabled={disabled || curve.perLevel.length <= 1}
                    onClick={() =>
                      setCurve({
                        kind: 'table',
                        perLevel: curve.perLevel.filter((_, i) => i !== index),
                      })
                    }
                  >
                    <VscTrash />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
          <FieldIssue issues={issues} path="levels.curve" />
          <button
            type="button"
            className={styles.button}
            disabled={disabled}
            onClick={() => {
              const last = curve.perLevel[curve.perLevel.length - 1] ?? 100;
              setCurve({ kind: 'table', perLevel: [...curve.perLevel, last] });
            }}
          >
            <VscAdd aria-hidden /> 添加一级
          </button>
        </>
      ) : (
        <>
          <div className={styles.numberGrid}>
            <NumberField
              label="基础经验（1 → 2 级）"
              value={curve.base}
              min={0}
              disabled={disabled}
              issues={issues}
              path="levels.curve.base"
              onChange={(base) => setCurve({ ...curve, base })}
            />
            <NumberField
              label="每级倍率"
              value={curve.factor}
              min={0}
              step={0.05}
              precision={2}
              disabled={disabled}
              issues={issues}
              path="levels.curve.factor"
              onChange={(factor) => setCurve({ ...curve, factor })}
            />
          </div>
          <div className={styles.hint}>从 L 级升到 L+1 级需要 基础经验 × 倍率^(L-1)</div>
        </>
      )}

      {curve.kind === 'formula' && (
        <div className={styles.curve} aria-label="经验预览">
          {preview.map((row) => (
            <div key={row.level} className={styles.curveRow}>
              <span>
                {row.level} → {row.level + 1}
              </span>
              <span>{row.need}</span>
              <span className={styles.curveTotal}>累计 {row.total}</span>
            </div>
          ))}
        </div>
      )}
    </RulesSection>
  );
};

export default LevelCurveSection;
