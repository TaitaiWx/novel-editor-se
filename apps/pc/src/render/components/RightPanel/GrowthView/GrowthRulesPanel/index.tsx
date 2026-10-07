import React, { useMemo, useState } from 'react';
import {
  createDndRuleset,
  findRulesetUsage,
  isRulesetEmpty,
  removeFromRuleset,
  type GrowthRuleset,
  type GrowthSheet,
  type RulesetRef,
} from '@novel-editor/core/growth';
import { isDeveloperDebugMode } from '../../../../utils/debugMode';
import { AttributesSection } from './AttributesSection';
import { ChoicesSection } from './ChoicesSection';
import { CoreRulesSection } from './CoreRulesSection';
import { DebugJsonEditor } from './DebugJsonEditor';
import { TextField, type RequestRemove } from './fields';
import { LevelCurveSection } from './LevelCurveSection';
import { LimitsSection } from './LimitsSection';
import { describeUsage } from './model';
import { SkillsSection } from './SkillsSection';
import { useRulesDraft } from './useRulesDraft';
import styles from './styles.module.scss';

interface GrowthRulesPanelProps {
  ruleset: GrowthRuleset;
  /** 成长卡：删除属性 / 技能 / 抉择前检查是否有角色用到 */
  sheets?: readonly GrowthSheet[];
  /** 核心规则可限定的角色 */
  characterNames?: readonly string[];
  busy: boolean;
  onSave: (ruleset: GrowthRuleset) => Promise<string | null>;
}

interface PendingRemoval {
  ref: RulesetRef;
  label: string;
  message: string;
}

/**
 * 规则之书可视化编辑器：属性、等级曲线、技能、能力抉择、核心规则、战力限制。
 * 所有改动先进入草稿，字段旁实时显示校验问题；底部「保存 / 撤销更改」统一提交（growth-save-ruleset），
 * 主进程再校验一次后写入 资料/记忆/规则.json 并广播 growth-memory-changed。
 * 规则 JSON 是内部数据，只有开发者调试模式（NOVEL_EDITOR_DEBUG=1）才显示原始 JSON 编辑
 */
export const GrowthRulesPanel: React.FC<GrowthRulesPanelProps> = ({
  ruleset,
  sheets = [],
  characterNames = [],
  busy,
  onSave,
}) => {
  const draft = useRulesDraft(ruleset, onSave);
  const { current, update, issues } = draft;
  const [pending, setPending] = useState<PendingRemoval | null>(null);
  const [startBlank, setStartBlank] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const savedKeys = useMemo(
    () => new Set(ruleset.attributes.map((attr) => attr.key)),
    [ruleset.attributes]
  );
  const disabled = busy;

  const requestRemove: RequestRemove = (ref, label) => {
    const usage = findRulesetUsage(current, sheets, ref);
    if (usage.characters.length === 0 && usage.references.length === 0) {
      update((value) => removeFromRuleset(value, ref));
      return;
    }
    setPending({ ref, label, message: describeUsage(label, usage) });
  };

  const sectionProps = { draft: current, update, issues, disabled };
  const showEmpty = isRulesetEmpty(current) && !draft.dirty && !startBlank;
  const error = draft.saveError ?? jsonError;

  return (
    <div className={styles.panel}>
      {draft.dirty && (
        <div className={styles.unsavedBar} role="region" aria-label="未保存的更改">
          <span className={styles.unsavedText}>
            有未保存的更改
            {draft.errorCount > 0 && (
              <span className={styles.unsavedErrors}> · {draft.errorCount} 处需要修改</span>
            )}
          </span>
          <button type="button" className={styles.button} disabled={busy} onClick={draft.reset}>
            撤销更改
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={busy || draft.errorCount > 0}
            onClick={() => void draft.save()}
          >
            保存
          </button>
        </div>
      )}

      {pending && (
        <div className={styles.confirm} role="alertdialog" aria-label="确认删除">
          <div className={styles.confirmText}>
            删除{pending.label}？{pending.message}
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.button} onClick={() => setPending(null)}>
              取消
            </button>
            <button
              type="button"
              className={styles.danger}
              onClick={() => {
                update((value) => removeFromRuleset(value, pending.ref));
                setPending(null);
              }}
            >
              仍然删除
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      {showEmpty ? (
        <div className={styles.card} role="region" aria-label="规则之书还是空的">
          <div className={styles.emptyTitle}>规则之书还是空的</div>
          <div className={styles.hint}>
            属性、技能、二选一 / 三选一和不可违背的核心规则都写在这里，记一笔与 AI 推演会按它校验。
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.button} onClick={() => setStartBlank(true)}>
              从空白开始
            </button>
            <button
              type="button"
              className={styles.primary}
              disabled={busy}
              onClick={() => draft.replace({ ...createDndRuleset(), limits: current.limits })}
            >
              从 DND 模板开始
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.card}>
            <div className={styles.itemRow}>
              <TextField
                className={styles.grow}
                label="规则之书名称"
                value={current.name}
                disabled={disabled}
                issues={issues}
                path="name"
                onChange={(name) => update((value) => ({ ...value, name }))}
              />
            </div>
            <input
              className={`${styles.input} ${styles.description}`}
              aria-label="规则之书说明"
              placeholder="这套成长体系的一句话说明（可选）"
              value={current.description ?? ''}
              disabled={disabled}
              onChange={(event) => {
                const description = event.target.value;
                update((value) => {
                  const next: GrowthRuleset = { ...value, description };
                  if (!description) delete next.description;
                  return next;
                });
              }}
            />
          </div>
          <CoreRulesSection {...sectionProps} characterNames={characterNames} />
          <AttributesSection {...sectionProps} savedKeys={savedKeys} onRemove={requestRemove} />
          <LevelCurveSection {...sectionProps} />
          <SkillsSection {...sectionProps} onRemove={requestRemove} />
          <ChoicesSection {...sectionProps} onRemove={requestRemove} />
          <LimitsSection {...sectionProps} />
        </>
      )}

      {isDeveloperDebugMode() && (
        <DebugJsonEditor
          ruleset={ruleset}
          busy={busy}
          onSave={async (next) => {
            setJsonError(null);
            return draft.saveRaw(next);
          }}
          onError={setJsonError}
        />
      )}
    </div>
  );
};

export default GrowthRulesPanel;
