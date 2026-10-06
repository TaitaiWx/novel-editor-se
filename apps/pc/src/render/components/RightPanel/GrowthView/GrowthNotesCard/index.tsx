import React, { useState } from 'react';
import type { GrowthSheet } from '@novel-editor/core/growth';
import { HelpTip } from '../HelpTip';
import { GROWTH_TIPS } from '../growthGuide';
import styles from './styles.module.scss';

interface GrowthNotesCardProps {
  sheet: GrowthSheet;
  busy: boolean;
  onUpdateNotes: (notes: string[]) => Promise<string | null>;
}

/** 状态备注：伤势、装备、心境等长期状态（AI 推演时参考） */
export const GrowthNotesCard: React.FC<GrowthNotesCardProps> = ({ sheet, busy, onUpdateNotes }) => {
  const [draft, setDraft] = useState('');

  return (
    <section className={styles.card} aria-label="状态备注">
      <h3 className={styles.title}>
        状态备注
        <HelpTip text={GROWTH_TIPS.notes} label="状态备注说明" />
      </h3>
      {sheet.notes.length === 0 && <div className={styles.empty}>暂无状态备注</div>}
      {sheet.notes.map((note, index) => (
        <div key={`${note}-${index}`} className={styles.note}>
          <span>{note}</span>
          <button
            type="button"
            className={styles.remove}
            disabled={busy}
            aria-label={`删除备注 ${note}`}
            onClick={() => void onUpdateNotes(sheet.notes.filter((_, i) => i !== index))}
          >
            ×
          </button>
        </div>
      ))}
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          const text = draft.trim();
          if (!text) return;
          void onUpdateNotes([...sheet.notes, text]).then((error) => {
            if (!error) setDraft('');
          });
        }}
      >
        <input
          className={styles.input}
          value={draft}
          aria-label="新的状态备注"
          placeholder="如：左臂旧伤未愈，不能使用双手武器"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className={styles.button} disabled={busy || !draft.trim()}>
          添加
        </button>
      </form>
    </section>
  );
};

export default GrowthNotesCard;
