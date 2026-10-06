import React, { useEffect, useRef, useState } from 'react';
import { isImeComposing } from '../../utils/ime';
import styles from './styles.module.scss';

/** 行内重命名的触发键（与 VS Code / Finder 一致）：单独按下 F2 */
export function isRenameShortcut(event: React.KeyboardEvent): boolean {
  return event.key === 'F2' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
}

interface InlineRenameInputProps {
  /** 当前名称（输入框初始值） */
  initialValue: string;
  /** 无障碍名称，例如「重命名 001-启程」 */
  ariaLabel: string;
  /** 初始选中范围的结束位置（默认全选；带扩展名的文件只选主名） */
  selectEnd?: number;
  className?: string;
  /** 回车或失焦时提交；名称为空或未变化时视为取消 */
  onCommit: (value: string) => void;
  onCancel: () => void;
  /** 回车 / Esc 结束编辑后把焦点还给它（通常是所在的行），保持键盘操作连贯 */
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
}

const stop = (event: React.SyntheticEvent) => event.stopPropagation();

/**
 * 行内重命名输入框：Enter 提交、Esc 取消、失焦提交。
 * 键盘与鼠标事件不冒泡到所在的行（避免触发打开 / 折叠、拖拽、全局快捷键）
 */
const InlineRenameInput: React.FC<InlineRenameInputProps> = ({
  initialValue,
  ariaLabel,
  selectEnd,
  className,
  onCommit,
  onCancel,
  restoreFocusRef,
}) => {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);
  // 只在挂载时聚焦并选中：初始选区记在 ref 里，之后的 props 变化不影响用户正在编辑的选区
  const selectEndRef = useRef(selectEnd);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const end = selectEndRef.current ?? input.value.length;
    input.setSelectionRange(0, Math.max(0, Math.min(end, input.value.length)));
  }, []);

  const finish = (commit: boolean, restoreFocus: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    const next = value.trim();
    if (commit && next && next !== initialValue.trim()) onCommit(next);
    else onCancel();
    if (restoreFocus) restoreFocusRef?.current?.focus();
  };

  return (
    <input
      ref={inputRef}
      className={`${styles.input}${className ? ` ${className}` : ''}`}
      value={value}
      aria-label={ariaLabel}
      spellCheck={false}
      draggable={false}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (isImeComposing(event)) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(true, true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finish(false, true);
        }
      }}
      onBlur={() => finish(true, false)}
      onClick={stop}
      onMouseDown={stop}
      onDoubleClick={stop}
      onContextMenu={stop}
      onDragStart={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    />
  );
};

export default InlineRenameInput;
