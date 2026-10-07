import React, { useState } from 'react';
import Select from '../../../Select';
import styles from './styles.module.scss';

const NONE = '__none__';
const CREATE = '__create__';

interface ExclusiveGroupFieldProps {
  label: string;
  value: string | undefined;
  /** 规则里已有的互斥组 */
  groups: readonly string[];
  disabled: boolean;
  onChange: (group: string | undefined) => void;
}

/** 互斥组：选择已有的组，或就地新建一个 */
export const ExclusiveGroupField: React.FC<ExclusiveGroupFieldProps> = ({
  label,
  value,
  groups,
  disabled,
  onChange,
}) => {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const commit = () => {
    const name = draft.trim();
    if (name) onChange(name);
    setCreating(false);
    setDraft('');
  };

  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>互斥组</span>
      {creating ? (
        <form
          className={styles.inline}
          onSubmit={(event) => {
            event.preventDefault();
            commit();
          }}
        >
          <input
            className={styles.input}
            aria-label={`${label} 新互斥组名称`}
            placeholder="例如 元素法术"
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setCreating(false);
              }
            }}
          />
          <button type="submit" className={styles.button} disabled={!draft.trim()}>
            确定
          </button>
        </form>
      ) : (
        <Select
          size="sm"
          block
          aria-label={`${label} 互斥组`}
          value={value ?? NONE}
          disabled={disabled}
          options={[
            { value: NONE, label: '不互斥' },
            ...groups.map((group) => ({ value: group, label: group })),
            { value: CREATE, label: '新建互斥组…' },
          ]}
          onChange={(next) => {
            if (next === CREATE) setCreating(true);
            else onChange(next === NONE ? undefined : next);
          }}
        />
      )}
    </div>
  );
};

export default ExclusiveGroupField;
