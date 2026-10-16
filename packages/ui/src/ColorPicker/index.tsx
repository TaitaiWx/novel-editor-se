import UiButton from '../Button';
import UiInput from '../Input';
import React, { useEffect, useRef, useState } from 'react';
import Popover from '../Popover';
import styles from './styles.module.scss';

const PRESETS = [
  '#9CDCFE',
  '#A2C5AF',
  '#D9C18D',
  '#D4AC98',
  '#B9ACD3',
  '#E6A5A0',
  '#C8D2DC',
  '#F0F0F0',
];
const validHex = (value: string) => /^#[0-9a-f]{6}$/i.test(value);

export interface ColorPickerProps {
  value: string;
  onChange: (color: string) => Promise<void> | void;
  preview?: string;
}

/** 与应用主题一致的颜色浮层；预览与持久化分开，避免拖动时连续写库。 */
export default function ColorPicker({ value, onChange, preview = '文字预览' }: ColorPickerProps) {
  const anchor = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [hex, setHex] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const selectColor = (color: string) => {
    setDraft(color);
    setHex(color);
  };
  const close = () => {
    if (!saving) {
      setOpen(false);
      anchor.current?.focus();
    }
  };
  const apply = async () => {
    if (!validHex(hex) || saving) return;
    setSaving(true);
    setError('');
    try {
      await onChange(hex.toUpperCase());
      setOpen(false);
      anchor.current?.focus();
    } catch {
      setError('颜色保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <UiButton
        unstyled
        ref={anchor}
        type="button"
        className={styles.trigger}
        aria-label="选择高亮颜色"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (open) close();
          else {
            selectColor(validHex(value) ? value.toUpperCase() : PRESETS[0]);
            setError('');
            setOpen(true);
          }
        }}
      >
        <span className={styles.swatch} style={{ background: value }} />
        {value.toUpperCase()}
      </UiButton>
      <Popover
        open={open}
        anchorRef={anchor}
        onClose={close}
        closeOnOutsideClick
        closeOnEscape
        className={styles.picker}
      >
        <div role="group" aria-label="高亮颜色">
          <strong>高亮颜色</strong>
          <div className={styles.presets}>
            {PRESETS.map((color) => (
              <UiButton
                unstyled
                key={color}
                type="button"
                aria-label={`选择 ${color}`}
                aria-pressed={draft.toUpperCase() === color}
                style={{ background: color }}
                disabled={saving}
                onClick={() => selectColor(color)}
              />
            ))}
          </div>
          <div className={styles.preview} style={{ color: draft }}>
            {preview}
          </div>
          {['R', 'G', 'B'].map((channel, index) => (
            <label key={channel} className={styles.channel}>
              <span>{channel}</span>
              <UiInput
                unstyled
                type="range"
                min={0}
                max={255}
                aria-label={channel}
                disabled={saving}
                value={parseInt(draft.slice(1 + index * 2, 3 + index * 2), 16)}
                onChange={(event) => {
                  const start = 1 + index * 2;
                  selectColor(
                    draft.slice(0, start) +
                      Number(event.target.value).toString(16).padStart(2, '0').toUpperCase() +
                      draft.slice(start + 2)
                  );
                }}
              />
              <output>{parseInt(draft.slice(1 + index * 2, 3 + index * 2), 16)}</output>
            </label>
          ))}
          <label className={styles.hex}>
            HEX
            <UiInput
              unstyled
              ref={input}
              value={hex}
              disabled={saving}
              maxLength={7}
              aria-invalid={!validHex(hex)}
              onChange={(event) => {
                const next = event.target.value.toUpperCase();
                setHex(next);
                if (validHex(next)) setDraft(next);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void apply();
              }}
            />
          </label>
          {!validHex(hex) && <span className={styles.error}>请输入 # 开头的六位颜色值。</span>}
          {error && (
            <span role="alert" className={styles.error}>
              {error}
            </span>
          )}
          <div className={styles.actions}>
            <UiButton unstyled type="button" disabled={saving} onClick={close}>
              取消
            </UiButton>
            <UiButton
              unstyled
              type="button"
              disabled={saving || !validHex(hex)}
              onClick={() => void apply()}
            >
              {saving ? '保存中…' : '应用颜色'}
            </UiButton>
          </div>
        </div>
      </Popover>
    </>
  );
}
