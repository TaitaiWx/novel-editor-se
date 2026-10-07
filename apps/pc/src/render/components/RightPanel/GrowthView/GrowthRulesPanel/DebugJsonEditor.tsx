import React, { useEffect, useState } from 'react';
import type { GrowthRuleset } from '@novel-editor/core/growth';
import styles from './styles.module.scss';

interface DebugJsonEditorProps {
  ruleset: GrowthRuleset;
  busy: boolean;
  onSave: (ruleset: GrowthRuleset) => Promise<boolean>;
  onError: (message: string) => void;
}

/** 开发者调试模式（NOVEL_EDITOR_DEBUG=1）才显示的规则 JSON 编辑器 */
export const DebugJsonEditor: React.FC<DebugJsonEditorProps> = ({
  ruleset,
  busy,
  onSave,
  onError,
}) => {
  const [open, setOpen] = useState(false);
  const [json, setJson] = useState(() => JSON.stringify(ruleset, null, 2));

  useEffect(() => {
    setJson(JSON.stringify(ruleset, null, 2));
  }, [ruleset]);

  const save = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      onError(`JSON 格式错误：${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    void onSave(parsed as GrowthRuleset);
  };

  return (
    <div className={styles.card}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? '▾' : '▸'} 开发者：编辑规则 JSON
      </button>
      {open && (
        <>
          <textarea
            className={styles.json}
            value={json}
            spellCheck={false}
            aria-label="规则 JSON"
            onChange={(event) => setJson(event.target.value)}
          />
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.button}
              onClick={() => setJson(JSON.stringify(ruleset, null, 2))}
            >
              还原
            </button>
            <button type="button" className={styles.primary} disabled={busy} onClick={save}>
              保存规则
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default DebugJsonEditor;
