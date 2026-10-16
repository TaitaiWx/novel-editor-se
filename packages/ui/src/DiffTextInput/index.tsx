import React, { useLayoutEffect, useRef } from 'react';
import { Annotation, Compartment, EditorState, Prec, Transaction } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderExtension } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { diffInputField, setDiffBaseline } from './decorations';
import styles from './styles.module.scss';

export interface DiffTextInputProps {
  value: string;
  /** undefined disables diff; empty string marks an entirely new field. */
  baseline?: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  'aria-label': string;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  singleLine?: boolean;
}
const externalValue = Annotation.define<boolean>();

/** Plain-text editor with visual-only deletions; copied/saved text is always the current document. */
export default function DiffTextInput(props: DiffTextInputProps) {
  const ariaLabel = props['aria-label'];
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const current = useRef(props);
  current.current = props;
  const config = useRef(new Compartment());
  const settings = () => [
    EditorState.readOnly.of(!!current.current.disabled),
    EditorView.editable.of(!current.current.disabled),
    EditorView.contentAttributes.of({
      'aria-label': current.current['aria-label'],
      'aria-multiline': String(!current.current.singleLine),
      'aria-disabled': String(!!current.current.disabled),
      role: 'textbox',
      tabindex: current.current.disabled ? '-1' : '0',
      spellcheck: 'false',
    }),
    placeholderExtension(
      current.current.value === '' && current.current.baseline
        ? ''
        : (current.current.placeholder ?? '')
    ),
  ];
  useLayoutEffect(() => {
    if (!container.current) return;
    const editor = new EditorView({
      parent: container.current,
      state: EditorState.create({
        doc: current.current.value,
        extensions: [
          config.current.of(settings()),
          diffInputField,
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorState.transactionFilter.of((tr) => {
            if (!tr.docChanged || tr.annotation(externalValue)) return tr;
            const { maxLength, singleLine } = current.current;
            if (singleLine && tr.newDoc.lines > 1) return [];
            if (maxLength && tr.newDoc.length > Math.max(maxLength, tr.startState.doc.length))
              return [];
            return tr;
          }),
          EditorView.updateListener.of((update) => {
            if (
              update.docChanged &&
              !update.transactions.some((tr) => tr.annotation(externalValue))
            )
              current.current.onChange(update.state.doc.toString());
          }),
          Prec.high(
            EditorView.domEventHandlers({
              blur: () => {
                current.current.onBlur?.();
              },
              keydown: (event) => {
                if (current.current.disabled) return false;
                current.current.onKeyDown?.(event);
                if (event.defaultPrevented) return true;
                if (current.current.singleLine && event.key === 'Enter' && !event.isComposing)
                  return true;
                return false;
              },
            })
          ),
        ],
      }),
    });
    view.current = editor;
    editor.dispatch({ effects: setDiffBaseline.of(current.current.baseline) });
    if (current.current.autoFocus) editor.focus();
    return () => {
      view.current = null;
      editor.destroy();
    };
  }, []);
  useLayoutEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const changed = editor.state.doc.toString() !== props.value;
    editor.dispatch({
      ...(changed
        ? { changes: { from: 0, to: editor.state.doc.length, insert: props.value } }
        : {}),
      effects: [config.current.reconfigure(settings()), setDiffBaseline.of(props.baseline)],
      annotations: [externalValue.of(true), Transaction.addToHistory.of(false)],
    });
  }, [props.value, props.baseline, props.disabled, props.placeholder, props.singleLine, ariaLabel]);
  return (
    <div
      ref={container}
      className={styles.input}
      data-disabled={props.disabled || undefined}
      data-single-line={props.singleLine || undefined}
      style={
        { '--diff-input-rows': props.singleLine ? 1 : (props.rows ?? 3) } as React.CSSProperties
      }
    />
  );
}
