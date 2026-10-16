import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { computeInlineTextDiff } from '@novel-editor/basic-algorithm';

export const setDiffBaseline = StateEffect.define<string | undefined>();
class DeletedText extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: DeletedText) {
    return this.text === other.text;
  }
  get lineBreaks() {
    return this.text.split('\n').length - 1;
  }
  toDOM() {
    const element = document.createElement('del');
    element.className = 'diff-text-deleted';
    element.textContent = this.text;
    element.contentEditable = 'false';
    element.setAttribute('aria-hidden', 'true');
    element.title = '已删除的原文（不会保存）';
    return element;
  }
  ignoreEvent() {
    return true;
  }
}
function decorate(before: string | undefined, after: string): DecorationSet {
  if (before === undefined) return Decoration.none;
  return Decoration.set(
    computeInlineTextDiff(before, after).flatMap((part) => {
      if (part.type === 'add')
        return [Decoration.mark({ class: 'diff-text-added' }).range(part.from, part.to)];
      if (part.type === 'del')
        return [
          Decoration.widget({ widget: new DeletedText(part.text), side: -1 }).range(part.from),
        ];
      return [];
    }),
    true
  );
}
export const diffInputField = StateField.define<{ baseline?: string; decorations: DecorationSet }>({
  create: () => ({ decorations: Decoration.none }),
  update(value, transaction) {
    let baseline = value.baseline;
    for (const effect of transaction.effects)
      if (effect.is(setDiffBaseline)) baseline = effect.value;
    if (!transaction.docChanged && baseline === value.baseline) return value;
    return { baseline, decorations: decorate(baseline, transaction.newDoc.toString()) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});
