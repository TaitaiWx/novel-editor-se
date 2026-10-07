/**
 * 当前项目的正文结构规则（渲染进程内的单一来源）
 *
 * 由 hooks/useProjectStructureRules 在打开文件夹 / 收到 project-structure-changed 时更新；
 * 编辑器（TextEditor/structure-rules.ts 的 StateField）、卷纲、目录、场景视频等都从这里读取，
 * 规则变化时订阅者立即刷新，不需要重新打开文件。这里不访问 IPC。
 */
import { useSyncExternalStore } from 'react';
import {
  classifyStructureLine,
  compileStructureRules,
  DEFAULT_STRUCTURE_RULES,
  structureConfigSignature,
  type StructureConfig,
  type StructureLineKind,
  type StructureRuleSet,
} from '@novel-editor/core/structure-rules';

let current: StructureRuleSet = DEFAULT_STRUCTURE_RULES;
const listeners = new Set<() => void>();

export function getStructureRules(): StructureRuleSet {
  return current;
}

/** 更新规则；配置与当前相同时不通知（避免无谓的重建） */
export function setStructureConfig(config: StructureConfig | null): void {
  const next = config ? compileStructureRules(config) : DEFAULT_STRUCTURE_RULES;
  if (next.signature === current.signature) return;
  current = next;
  for (const listener of listeners) listener();
}

export function subscribeStructureRules(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export type StructureLineClassifier = (line: string) => StructureLineKind | null;

const classifierCache = new WeakMap<StructureRuleSet, StructureLineClassifier>();

/** 规则集 → 识别函数（传给 basic-algorithm 的 classify 参数；同一规则集返回同一函数，便于 memo） */
export function structureClassifier(rules: StructureRuleSet): StructureLineClassifier {
  let classify = classifierCache.get(rules);
  if (!classify) {
    classify = (line: string) => classifyStructureLine(line, rules);
    classifierCache.set(rules, classify);
  }
  return classify;
}

/** React：当前规则集（变化时重新渲染） */
export function useStructureRules(): StructureRuleSet {
  return useSyncExternalStore(subscribeStructureRules, getStructureRules, getStructureRules);
}

/** React：当前规则的识别函数 */
export function useStructureClassifier(): StructureLineClassifier {
  return structureClassifier(useStructureRules());
}

export { structureConfigSignature };

/** 非 React 场景：当前规则的识别函数 */
export function getStructureClassifier(): StructureLineClassifier {
  return structureClassifier(current);
}
