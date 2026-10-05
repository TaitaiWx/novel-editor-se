import React, { useEffect, useMemo, useState } from 'react';
import {
  expForNextLevel,
  totalExpForLevel,
  type GrowthRuleset,
  type PowerLimits,
} from '@novel-editor/core/growth';
import styles from './styles.module.scss';

const LIMIT_LABELS: Record<keyof PowerLimits, { label: string; hint: string }> = {
  maxLevelsPerChapter: { label: '每章最多升级', hint: '同一章内超过这个等级数会提示「战力暴涨」' },
  maxAttributeGainPerChapter: { label: '单属性每章上限', hint: '同一章内单项属性的最大提升' },
  maxSkillLevelsPerChapter: { label: '单技能每章上限', hint: '同一章内单个技能最多提升的等级' },
  forgottenAfterChapters: { label: '配角遗忘阈值', hint: '配角超过多少章未出场会被提醒' },
};

const CHECK_LABELS: Record<string, string> = {
  'max-level': '自动校验：等级上限',
  'max-attribute': '自动校验：属性上限',
  'max-skill-level': '自动校验：技能上限',
  'forbid-skill': '自动校验：禁用技能',
  'require-choice-by-level': '自动校验：限期抉择',
};

interface GrowthRulesPanelProps {
  ruleset: GrowthRuleset;
  busy: boolean;
  onSave: (ruleset: GrowthRuleset) => Promise<string | null>;
}

/**
 * 规则之书编辑器：核心规则、战力限制、经验曲线预览，以及完整 JSON 编辑
 */
export const GrowthRulesPanel: React.FC<GrowthRulesPanelProps> = ({ ruleset, busy, onSave }) => {
  const [ruleDraft, setRuleDraft] = useState('');
  const [limits, setLimits] = useState<Record<keyof PowerLimits, string>>(() =>
    toLimitDraft(ruleset.limits)
  );
  const [json, setJson] = useState(() => JSON.stringify(ruleset, null, 2));
  const [jsonOpen, setJsonOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLimits(toLimitDraft(ruleset.limits));
    setJson(JSON.stringify(ruleset, null, 2));
  }, [ruleset]);

  const curve = useMemo(() => {
    const rows: Array<{ level: number; need: number; total: number }> = [];
    for (let level = 1; level < Math.min(ruleset.levels.maxLevel, 11); level += 1) {
      rows.push({
        level,
        need: expForNextLevel(ruleset, level),
        total: totalExpForLevel(ruleset, level + 1),
      });
    }
    return rows;
  }, [ruleset]);

  const save = async (next: GrowthRuleset) => {
    const saveError = await onSave(next);
    setError(saveError);
    return !saveError;
  };

  const addRule = async () => {
    const text = ruleDraft.trim();
    if (!text) return;
    const taken = new Set(ruleset.coreRules.map((rule) => rule.id));
    let index = ruleset.coreRules.length + 1;
    while (taken.has(`rule-${index}`)) index += 1;
    if (
      await save({ ...ruleset, coreRules: [...ruleset.coreRules, { id: `rule-${index}`, text }] })
    ) {
      setRuleDraft('');
    }
  };

  const saveLimits = () => {
    const next = { ...ruleset.limits };
    for (const key of Object.keys(LIMIT_LABELS) as Array<keyof PowerLimits>) {
      const value = Number(limits[key]);
      if (!Number.isInteger(value) || value < 1) {
        setError(`${LIMIT_LABELS[key].label}必须是正整数`);
        return;
      }
      next[key] = value;
    }
    void save({ ...ruleset, limits: next });
  };

  const saveJson = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      setError(`JSON 格式错误：${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    void save(parsed as GrowthRuleset);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.card}>
        <div className={styles.title}>
          <span>核心规则</span>
          <span
            className={styles.meta}
            title="AI 推演时必须遵守；带「自动校验」的规则会在一致性检查中被检查"
          >
            {ruleset.coreRules.length} 条
          </span>
        </div>
        {ruleset.coreRules.length === 0 && (
          <div className={styles.empty}>写下不可违背的设定，例如「主角在第三卷前不能学会飞行」</div>
        )}
        {ruleset.coreRules.map((rule) => (
          <div key={rule.id} className={styles.rule}>
            <div className={styles.ruleText}>
              {rule.text}
              <div className={styles.ruleMeta}>
                {rule.check ? CHECK_LABELS[rule.check.kind] : '交给 AI 推演遵守'}
                {rule.appliesTo?.length ? ` · 仅限 ${rule.appliesTo.join('、')}` : ''}
              </div>
            </div>
            <button
              type="button"
              className={styles.remove}
              disabled={busy}
              aria-label={`删除规则 ${rule.text}`}
              onClick={() =>
                void save({
                  ...ruleset,
                  coreRules: ruleset.coreRules.filter((item) => item.id !== rule.id),
                })
              }
            >
              ×
            </button>
          </div>
        ))}
        <form
          className={styles.row}
          onSubmit={(event) => {
            event.preventDefault();
            void addRule();
          }}
        >
          <input
            className={styles.input}
            value={ruleDraft}
            placeholder="新增一条核心规则"
            aria-label="新增核心规则"
            onChange={(event) => setRuleDraft(event.target.value)}
          />
          <button type="submit" className={styles.primary} disabled={busy || !ruleDraft.trim()}>
            添加
          </button>
        </form>
      </div>

      <div className={styles.card}>
        <div className={styles.title}>战力限制</div>
        <div className={styles.limits}>
          {(Object.keys(LIMIT_LABELS) as Array<keyof PowerLimits>).map((key) => (
            <label key={key} className={styles.limit} title={LIMIT_LABELS[key].hint}>
              <span>{LIMIT_LABELS[key].label}</span>
              <input
                className={styles.input}
                value={limits[key]}
                inputMode="numeric"
                onChange={(event) => setLimits((prev) => ({ ...prev, [key]: event.target.value }))}
              />
            </label>
          ))}
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.button} disabled={busy} onClick={saveLimits}>
            保存限制
          </button>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.title}>
          <span>经验曲线</span>
          <span className={styles.meta}>
            {ruleset.levels.curve.kind === 'table' ? '经验表' : '公式'} · 上限{' '}
            {ruleset.levels.maxLevel} 级
          </span>
        </div>
        <div className={styles.curve}>
          {curve.map((row) => (
            <div key={row.level} className={styles.curveRow}>
              <span>
                {row.level} → {row.level + 1}
              </span>
              <span>{row.need}</span>
              <span className={styles.curveTotal}>累计 {row.total}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.card}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={jsonOpen}
          onClick={() => setJsonOpen((open) => !open)}
        >
          {jsonOpen ? '▾' : '▸'} 编辑完整规则（属性 / 技能 / 抉择 / 经验曲线）
        </button>
        {jsonOpen && (
          <>
            <textarea
              className={styles.json}
              value={json}
              spellCheck={false}
              aria-label="规则 JSON"
              onChange={(event) => setJson(event.target.value)}
            />
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.button}
                onClick={() => setJson(JSON.stringify(ruleset, null, 2))}
              >
                还原
              </button>
              <button type="button" className={styles.primary} disabled={busy} onClick={saveJson}>
                保存规则
              </button>
            </div>
          </>
        )}
      </div>
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
    </div>
  );
};

function toLimitDraft(limits: PowerLimits): Record<keyof PowerLimits, string> {
  return {
    maxLevelsPerChapter: String(limits.maxLevelsPerChapter),
    maxAttributeGainPerChapter: String(limits.maxAttributeGainPerChapter),
    maxSkillLevelsPerChapter: String(limits.maxSkillLevelsPerChapter),
    forgottenAfterChapters: String(limits.forgottenAfterChapters),
  };
}

export default GrowthRulesPanel;
