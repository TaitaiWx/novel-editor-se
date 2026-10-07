/**
 * 编辑器里的正文结构规则（章 / 幕 / 场的识别）
 *
 * StateField 保存当前规则集，初始值取自 utils/structureRules；一个 ViewPlugin 订阅规则变化并派发
 * setStructureRules，依赖它的装饰（实时预览的结构行样式、写作装饰）据此重建 —— 在「设置 → 正文结构」
 * 保存后无需重新打开文件。同一个扩展对象可被多处引用，CodeMirror 会去重。
 */
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import {
  classifyStructureLine,
  type StructureLineKind,
  type StructureRuleSet,
} from '@novel-editor/core/structure-rules';
import { getStructureRules, subscribeStructureRules } from '../../utils/structureRules';

export const setStructureRules = StateEffect.define<StructureRuleSet>();

export const structureRulesField = StateField.define<StructureRuleSet>({
  create: () => getStructureRules(),
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setStructureRules)) return effect.value;
    }
    return value;
  },
});

const structureRulesSync = ViewPlugin.fromClass(
  class {
    private readonly dispose: () => void;
    constructor(view: EditorView) {
      const sync = () => {
        const next = getStructureRules();
        if (view.state.field(structureRulesField, false) === next) return;
        view.dispatch({ effects: setStructureRules.of(next) });
      };
      this.dispose = subscribeStructureRules(sync);
      // 创建视图与订阅之间规则可能已变化
      if (view.state.field(structureRulesField, false) !== getStructureRules()) {
        queueMicrotask(() => {
          if (view.dom.isConnected) sync();
        });
      }
    }
    destroy() {
      this.dispose();
    }
  }
);

/** 结构规则扩展（StateField + 订阅），供需要识别结构行的扩展引入 */
export const structureRulesExtension: Extension = [structureRulesField, structureRulesSync];

/** 当前状态下一行的结构类型 */
export function classifyLineInState(state: EditorState, line: string): StructureLineKind | null {
  return classifyStructureLine(
    line,
    state.field(structureRulesField, false) ?? getStructureRules()
  );
}

/** 本次更新是否换了规则 */
export function structureRulesChanged(update: ViewUpdate): boolean {
  return (
    update.startState.field(structureRulesField, false) !==
    update.state.field(structureRulesField, false)
  );
}
