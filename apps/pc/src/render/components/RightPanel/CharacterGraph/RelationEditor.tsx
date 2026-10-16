import UiButton from '@novel-editor/ui/Button';
import { useUnsavedChangesGuard } from '../../../hooks/useUnsavedChangesGuard';
import { registerWorkspaceLeaveGuard } from '../../../utils/workspaceLeaveGuard';
import React, { useEffect, useRef, useState } from 'react';
import Select from '@novel-editor/ui/Select';
import DiffTextInput from '@novel-editor/ui/DiffTextInput';
import { VscClose } from 'react-icons/vsc';
import { RELATION_TONE_LABELS, RELATION_TONE_COLORS } from '../constants';
import type { Character, RelationTone } from '../types';
import styles from './styles.module.scss';

export interface RelationEditorProps {
  characters: Character[];
  relationSourceId: number | '';
  onRelationSourceChange: (id: number | '') => void;
  relationTargetId: number | '';
  onRelationTargetChange: (id: number | '') => void;
  relationTone: RelationTone;
  onRelationToneChange: (tone: RelationTone) => void;
  relationNote: string;
  relationBaseline?: string;
  onRelationNoteChange: (note: string) => void;
  editingRelationId: string | null;
  onAddRelation: () => Promise<void> | void;
  onUpdateRelation: () => Promise<void> | void;
  onDeleteRelation: (id: string) => Promise<void> | void;
}

export default function RelationEditor({
  onClose,
  ...props
}: RelationEditorProps & { onClose: () => void }) {
  const inputRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reveal = () => {
    setError('请先保存或取消正在编辑的关系。');
    formRef.current?.scrollIntoView({ block: 'nearest' });
    inputRef.current?.focus({ preventScroll: true });
  };
  useUnsavedChangesGuard(true, reveal);
  useEffect(
    () =>
      registerWorkspaceLeaveGuard(() => {
        reveal();
        return false;
      }),
    []
  );
  const baseline = useRef(
    props.relationBaseline ?? (props.editingRelationId ? props.relationNote : '')
  );
  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  const options = props.characters.map((character) => ({
    value: String(character.id),
    label: character.name,
  }));
  const run = async (action: () => Promise<void> | void) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败，请重试');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      ref={formRef}
      className={styles.editor}
      aria-label={props.editingRelationId ? '编辑关系' : '建立关系'}
      onSubmit={(event) => {
        event.preventDefault();
        if (
          props.relationSourceId === '' ||
          props.relationTargetId === '' ||
          props.relationSourceId === props.relationTargetId
        )
          return;
        void run(props.editingRelationId ? props.onUpdateRelation : props.onAddRelation);
      }}
    >
      <header>
        <strong>{props.editingRelationId ? '编辑关系' : '建立关系'}</strong>
        <UiButton
          unstyled
          type="button"
          className={styles.closeButton}
          aria-label="关闭关系编辑"
          disabled={busy}
          onClick={onClose}
        >
          <VscClose />
        </UiButton>
      </header>
      <fieldset disabled={busy}>
        <div className={styles.endpoints}>
          <Select
            block
            aria-label="关系起点"
            value={String(props.relationSourceId)}
            options={options.filter((option) => option.value !== String(props.relationTargetId))}
            onChange={(value) => props.onRelationSourceChange(Number(value) || '')}
            placeholder="选择人物"
            disabled={busy}
          />
          <span aria-hidden="true">↔</span>
          <Select
            block
            aria-label="关系终点"
            value={String(props.relationTargetId)}
            options={options.filter((option) => option.value !== String(props.relationSourceId))}
            onChange={(value) => props.onRelationTargetChange(Number(value) || '')}
            placeholder="选择另一人物"
            disabled={busy}
          />
        </div>
        <label>
          关系类型
          <Select<RelationTone>
            ref={inputRef}
            block
            aria-label="关系类型"
            value={props.relationTone}
            options={(Object.keys(RELATION_TONE_LABELS) as RelationTone[]).map((tone) => ({
              value: tone,
              textValue: RELATION_TONE_LABELS[tone],
              label: (
                <span className={styles.toneOption}>
                  <i aria-hidden="true" style={{ background: RELATION_TONE_COLORS[tone] }} />
                  {RELATION_TONE_LABELS[tone]}
                </span>
              ),
            }))}
            onChange={props.onRelationToneChange}
            disabled={busy}
          />
        </label>
        <label>
          关系说明（选填）
          <DiffTextInput
            aria-label="关系说明"
            baseline={baseline.current}
            disabled={busy}
            rows={3}
            value={props.relationNote}
            placeholder="这段关系的背景或变化"
            onChange={props.onRelationNoteChange}
          />
        </label>
      </fieldset>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <footer>
        {props.editingRelationId && (
          <UiButton
            unstyled
            type="button"
            className={styles.danger}
            disabled={busy}
            onClick={() => void run(() => props.onDeleteRelation(props.editingRelationId!))}
          >
            删除关系
          </UiButton>
        )}
        <span />
        <UiButton unstyled type="button" disabled={busy} onClick={onClose}>
          取消
        </UiButton>
        <UiButton
          unstyled
          type="submit"
          className={styles.primary}
          disabled={
            busy ||
            props.relationSourceId === '' ||
            props.relationTargetId === '' ||
            props.relationSourceId === props.relationTargetId
          }
        >
          {busy ? '保存中…' : '保存关系'}
        </UiButton>
      </footer>
    </form>
  );
}
