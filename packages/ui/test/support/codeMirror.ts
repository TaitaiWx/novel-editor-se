import { act } from '@testing-library/react';
import { EditorView } from '@codemirror/view';

/** Exercise the mounted editor's transactions, including its filters and React callbacks. */
export function editorView(element: HTMLElement): EditorView {
  const view = EditorView.findFromDOM(element);
  if (!view) throw new Error('Expected a mounted CodeMirror editor');
  return view;
}
export function replaceEditorText(element: HTMLElement, text: string): void {
  const view = editorView(element);
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }));
}
export function editorText(element: HTMLElement): string {
  return editorView(element).state.doc.toString();
}
