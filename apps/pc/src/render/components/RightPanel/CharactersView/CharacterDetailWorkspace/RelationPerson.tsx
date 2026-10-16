import UiButton from '@novel-editor/ui/Button';
import React, { useEffect, useRef, useState } from 'react';
import CharacterAvatar from '../../../CharacterAvatar';
import Popover from '@novel-editor/ui/Popover';
import DiffTextInput from '@novel-editor/ui/DiffTextInput';
import type { Character, CharacterRelation } from '../../types';
import { relationDisplayLabel } from '../../utils';
import { RELATION_TONE_COLORS } from '../../constants';
import styles from './styles.module.scss';

export default function RelationPerson({
  character,
  relation,
  noteBaseline,
  workPath,
  onOpen,
}: {
  character?: Character;
  relation: CharacterRelation;
  noteBaseline?: string;
  workPath: string | null;
  onOpen?: () => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [preview, setPreview] = useState(false);
  const clear = () => clearTimeout(timer.current);
  const show = () => {
    clear();
    setPreview(true);
  };
  const hide = () => {
    clear();
    timer.current = setTimeout(() => setPreview(false), 150);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className={styles.relationPerson}>
      <UiButton
        unstyled
        ref={anchor}
        type="button"
        className={styles.personButton}
        disabled={!character || !onOpen}
        aria-label={`双击打开人物：${character?.name || '未匹配人物'}`}
        onClick={show}
        onDoubleClick={() => {
          setPreview(false);
          onOpen?.();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setPreview(false);
            onOpen?.();
          }
        }}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        <CharacterAvatar
          name={character?.name || '?'}
          avatar={character?.avatar}
          color={character?.highlightColor}
          workPath={workPath}
          size={28}
        />
        <strong>{character?.name || '未匹配人物'}</strong>
        <span
          className={styles.relationship}
          style={{ color: RELATION_TONE_COLORS[relation.tone] }}
        >
          {relationDisplayLabel(relation)}
        </span>
      </UiButton>
      {character && (
        <Popover
          open={preview}
          anchorRef={anchor}
          onMouseEnter={show}
          onMouseLeave={hide}
          onClose={() => setPreview(false)}
          closeOnEscape
          closeOnOutsideClick
          className={styles.personPreview}
        >
          <div className={styles.previewIdentity}>
            <CharacterAvatar
              name={character.name}
              avatar={character.avatar}
              color={character.highlightColor}
              workPath={workPath}
              size={52}
            />
            <div>
              <strong>{character.name}</strong>
              <p>{character.role}</p>
            </div>
          </div>
          <div className={styles.previewBody}>
            <section>
              <h4>人物简介</h4>
              <p>{character.description || '暂无人物简介'}</p>
            </section>
            {(relation.note || noteBaseline !== undefined) && (
              <section>
                <h4>关系说明</h4>
                {noteBaseline !== undefined ? (
                  <DiffTextInput
                    aria-label="关系说明草稿"
                    value={relation.note}
                    baseline={noteBaseline}
                    disabled
                    onChange={() => undefined}
                    rows={4}
                  />
                ) : (
                  <p>{relation.note}</p>
                )}
              </section>
            )}
          </div>
        </Popover>
      )}
    </div>
  );
}
