import React, { useMemo } from 'react';
import { computeInlineTextDiff } from '@novel-editor/basic-algorithm';
import styles from './styles.module.scss';

export interface DiffTextProps {
  before?: string;
  value: string;
}

export default function DiffText({ before, value }: DiffTextProps) {
  const parts = useMemo(
    () => (before === undefined ? null : computeInlineTextDiff(before, value)),
    [before, value]
  );
  if (!parts) return <>{value}</>;
  return (
    <>
      {parts.map((part, index) =>
        part.type === 'del' ? (
          <del key={index} className={styles.deleted} title="已删除的原文">
            {part.text}
          </del>
        ) : (
          <span key={index} className={part.type === 'add' ? styles.added : undefined}>
            {part.text}
          </span>
        )
      )}
    </>
  );
}
