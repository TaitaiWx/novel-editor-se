import React, { useMemo, useState } from 'react';
import {
  checkSkillPrerequisites,
  describeGrowthEvent,
  findAttributeDef,
  type GrowthEventInput,
  type GrowthRuleset,
  type GrowthSheet,
  type GrowthSimulationMode,
  type SimulationBranch,
} from '@novel-editor/core/growth';
import type {
  GrowthSimulationOutcome,
  GrowthSimulationRequest,
} from '../../../../types/growth-api';
import styles from './styles.module.scss';

const MAX_CANDIDATES = 4;

interface CandidateOption {
  id: string;
  label: string;
  group: string;
  hint?: string;
}

interface GrowthSimulationPanelProps {
  ruleset: GrowthRuleset;
  sheet: GrowthSheet;
  busy: boolean;
  onSimulate: (
    request: GrowthSimulationRequest
  ) => Promise<{ outcome: GrowthSimulationOutcome | null; error: string | null }>;
  onApplyBranch: (events: GrowthEventInput[]) => Promise<string | null>;
}

/** 分支相对当前角色卡的变化摘要 */
function diffBranch(
  ruleset: GrowthRuleset,
  sheet: GrowthSheet,
  branch: SimulationBranch
): string[] {
  const lines: string[] = [];
  if (branch.projected.level !== sheet.level) {
    lines.push(`等级 ${sheet.level} → ${branch.projected.level}`);
  }
  for (const [key, value] of Object.entries(branch.projected.attributes)) {
    const before = sheet.attributes[key] ?? 0;
    if (value !== before) {
      const name = findAttributeDef(ruleset, key)?.name ?? key;
      lines.push(`${name} ${before} → ${value}`);
    }
  }
  for (const skill of branch.projected.skills) {
    const before = sheet.skills.find((item) => item.id === skill.id)?.level ?? 0;
    if (skill.level !== before) {
      const name = ruleset.skills.find((item) => item.id === skill.id)?.name ?? skill.id;
      lines.push(
        before === 0
          ? `习得「${name}」Lv ${skill.level}`
          : `「${name}」Lv ${before} → ${skill.level}`
      );
    }
  }
  return lines;
}

/**
 * AI 成长推演：选择二选一 / 三选一候选项，受控或自由成长，并排比较各分支，采用后才写入
 */
export const GrowthSimulationPanel: React.FC<GrowthSimulationPanelProps> = ({
  ruleset,
  sheet,
  busy,
  onSimulate,
  onApplyBranch,
}) => {
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [mode, setMode] = useState<GrowthSimulationMode>('controlled');
  const [horizon, setHorizon] = useState('10');
  const [extraRules, setExtraRules] = useState('');
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<GrowthSimulationOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [appliedId, setAppliedId] = useState<string | null>(null);

  const options = useMemo<CandidateOption[]>(() => {
    const result: CandidateOption[] = [];
    for (const group of ruleset.choiceGroups) {
      if (sheet.choices.filter((choice) => choice.groupId === group.id).length >= group.pick)
        continue;
      for (const option of group.options) {
        result.push({
          id: option.id,
          label: option.name,
          group: group.name,
          hint: option.description,
        });
      }
    }
    for (const skill of ruleset.skills) {
      if (sheet.skills.some((entry) => entry.id === skill.id)) continue;
      const problems = checkSkillPrerequisites(ruleset, sheet, skill);
      result.push({
        id: skill.id,
        label: skill.name,
        group: '主修技能',
        hint: [skill.description, ...problems].filter(Boolean).join('\n'),
      });
    }
    return result;
  }, [ruleset, sheet]);

  const groups = useMemo(() => {
    const map = new Map<string, CandidateOption[]>();
    for (const option of options) map.set(option.group, [...(map.get(option.group) ?? []), option]);
    return Array.from(map.entries());
  }, [options]);

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((item) => item !== id)
        : prev.length >= MAX_CANDIDATES
          ? prev
          : [...prev, id]
    );
  };

  const canRun = !running && !busy && (mode === 'free' || selected.length > 0);

  const run = async () => {
    setRunning(true);
    setError(null);
    setOutcome(null);
    setAppliedId(null);
    const horizonNum = Number(horizon);
    const response = await onSimulate({
      choices: selected,
      mode,
      horizon: Number.isFinite(horizonNum) && horizonNum > 0 ? horizonNum : 10,
      extraRules: extraRules
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    });
    setRunning(false);
    setOutcome(response.outcome);
    setError(response.error);
  };

  const adopt = async (branch: SimulationBranch) => {
    if (confirming !== branch.id) {
      setConfirming(branch.id);
      return;
    }
    setConfirming(null);
    const applyError = await onApplyBranch(branch.events);
    if (applyError) setError(applyError);
    else setAppliedId(branch.id);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.card}>
        <div className={styles.title}>
          <span>候选项</span>
          <span className={styles.meta}>
            已选 {selected.length}/{MAX_CANDIDATES}
          </span>
        </div>
        {groups.length === 0 && selected.length === 0 && (
          <div className={styles.empty}>
            规则中没有待抉择的选项，可以添加自定义候选或使用自由成长
          </div>
        )}
        {groups.map(([groupName, items]) => (
          <div key={groupName} className={styles.group}>
            <div className={styles.groupName}>{groupName}</div>
            <div className={styles.chips}>
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected.includes(item.id)}
                  className={`${styles.chip} ${selected.includes(item.id) ? styles.chipOn : ''}`}
                  title={item.hint ?? ''}
                  onClick={() => toggle(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        {selected
          .filter((id) => !options.some((option) => option.id === id))
          .map((id) => (
            <button
              key={id}
              type="button"
              className={`${styles.chip} ${styles.chipOn}`}
              onClick={() => toggle(id)}
            >
              {id} ×
            </button>
          ))}
        <form
          className={styles.row}
          onSubmit={(event) => {
            event.preventDefault();
            const text = custom.trim();
            if (text && !selected.includes(text) && selected.length < MAX_CANDIDATES) {
              setSelected((prev) => [...prev, text]);
              setCustom('');
            }
          }}
        >
          <input
            className={styles.input}
            value={custom}
            placeholder="自定义候选，例如：加入盗贼公会"
            aria-label="自定义候选"
            onChange={(event) => setCustom(event.target.value)}
          />
          <button type="submit" className={styles.button} disabled={!custom.trim()}>
            添加
          </button>
        </form>
      </div>

      <div className={styles.card}>
        <div className={styles.settings}>
          <div className={styles.modeSwitch} role="radiogroup" aria-label="成长模式">
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'controlled'}
              className={`${styles.mode} ${mode === 'controlled' ? styles.modeOn : ''}`}
              title="严格遵守核心规则与战力限制，每个候选项推演一个分支"
              onClick={() => setMode('controlled')}
            >
              受控成长
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'free'}
              className={`${styles.mode} ${mode === 'free' ? styles.modeOn : ''}`}
              title="在规则范围内让 AI 自由发挥，可自行提出成长方向"
              onClick={() => setMode('free')}
            >
              自由成长
            </button>
          </div>
          <label className={styles.horizon} title="向后推演多少章">
            推演
            <input
              className={styles.input}
              value={horizon}
              inputMode="numeric"
              aria-label="推演章节数"
              onChange={(event) => setHorizon(event.target.value)}
            />
            章
          </label>
        </div>
        <textarea
          className={styles.rules}
          value={extraRules}
          placeholder="本次推演额外的核心规则，每行一条（可选）"
          aria-label="额外核心规则"
          onChange={(event) => setExtraRules(event.target.value)}
        />
        <div className={styles.actions}>
          <span className={styles.hint}>推演结果只是提案，采用后才会写入成长卡</span>
          <button
            type="button"
            className={styles.primary}
            disabled={!canRun}
            onClick={() => void run()}
          >
            {running ? '推演中…' : '开始推演'}
          </button>
        </div>
      </div>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      {outcome && (
        <>
          {outcome.issues.length > 0 && (
            <div className={styles.issues} title={outcome.issues.join('\n')}>
              AI 返回中有 {outcome.issues.length} 处内容被忽略
            </div>
          )}
          {outcome.result.overallRisks.length > 0 && (
            <div className={styles.risks}>整体风险：{outcome.result.overallRisks.join('；')}</div>
          )}
          <div className={styles.branches}>
            {outcome.result.branches.map((branch) => {
              const changes = diffBranch(ruleset, sheet, branch);
              const errors = branch.warnings.filter((w) => w.severity === 'error').length;
              return (
                <div key={branch.id} className={styles.branch} data-testid="growth-branch">
                  <div className={styles.branchHead}>
                    <span className={styles.branchTitle}>{branch.title}</span>
                    {outcome.result.recommendation === branch.id && (
                      <span className={styles.recommend}>推荐</span>
                    )}
                  </div>
                  {branch.summary && <div className={styles.summary}>{branch.summary}</div>}
                  {changes.length > 0 && (
                    <ul className={styles.changes}>
                      {changes.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  )}
                  <details className={styles.events}>
                    <summary>{branch.events.length} 条成长事件</summary>
                    <ol>
                      {branch.events.map((event, index) => (
                        <li key={index}>
                          {event.chapter !== undefined ? `第${event.chapter}章 ` : ''}
                          {describeGrowthEvent(ruleset, event)}
                          {event.note ? ` — ${event.note}` : ''}
                        </li>
                      ))}
                    </ol>
                  </details>
                  {branch.risks.length > 0 && (
                    <div className={styles.branchRisks}>风险：{branch.risks.join('；')}</div>
                  )}
                  {branch.warnings.length > 0 && (
                    <div
                      className={`${styles.branchWarnings} ${errors > 0 ? styles.branchErrors : ''}`}
                      title={branch.warnings.map((w) => w.message).join('\n')}
                    >
                      {errors > 0 ? `${errors} 处违反规则` : `${branch.warnings.length} 处提醒`}：
                      {branch.warnings[0].message}
                    </div>
                  )}
                  <button
                    type="button"
                    className={confirming === branch.id ? styles.primary : styles.button}
                    disabled={busy || appliedId !== null}
                    onClick={() => void adopt(branch)}
                  >
                    {appliedId === branch.id
                      ? '已采用'
                      : confirming === branch.id
                        ? '确认写入成长卡'
                        : '采用此分支'}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default GrowthSimulationPanel;
