import { useCallback, useMemo, useRef, useState } from 'react';
import {
  finalizeRuleset,
  rulesetErrors,
  validateRuleset,
  type GrowthRuleset,
} from '@novel-editor/core/growth';
import { buildIssueMap } from './fields';

/**
 * 规则之书的编辑草稿：
 * - draft 为 null 表示没有改动，直接显示已保存的规则（外部写入后自动跟随）
 * - 每次改动都实时校验，错误显示在字段旁；有错误时不能保存
 * - 保存成功或撤销后回到 null
 */
export function useRulesDraft(
  saved: GrowthRuleset,
  onSave: (ruleset: GrowthRuleset) => Promise<string | null>
) {
  const [draft, setDraft] = useState<GrowthRuleset | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedRef = useRef(saved);
  savedRef.current = saved;

  const current = draft ?? saved;
  const dirty = useMemo(
    () => draft !== null && JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved]
  );
  const issueList = useMemo(() => validateRuleset(current), [current]);
  const issues = useMemo(() => buildIssueMap(issueList), [issueList]);
  const errorCount = useMemo(() => rulesetErrors(issueList).length, [issueList]);

  const update = useCallback((updater: (ruleset: GrowthRuleset) => GrowthRuleset) => {
    setDraft((prev) => updater(prev ?? savedRef.current));
    setSaveError(null);
  }, []);

  /** 整体替换（模板、调试 JSON） */
  const replace = useCallback((next: GrowthRuleset) => {
    setDraft(next);
    setSaveError(null);
  }, []);

  const reset = useCallback(() => {
    setDraft(null);
    setSaveError(null);
  }, []);

  const save = useCallback(async () => {
    if (errorCount > 0) {
      setSaveError(`还有 ${errorCount} 处需要修改`);
      return false;
    }
    const error = await onSave(finalizeRuleset(current));
    setSaveError(error);
    if (!error) setDraft(null);
    return !error;
  }, [current, errorCount, onSave]);

  /** 直接保存一份完整规则（调试 JSON 编辑器） */
  const saveRaw = useCallback(
    async (next: GrowthRuleset) => {
      const error = await onSave(next);
      setSaveError(error);
      if (!error) setDraft(null);
      return !error;
    },
    [onSave]
  );

  return { current, dirty, issues, errorCount, saveError, update, replace, reset, save, saveRaw };
}
