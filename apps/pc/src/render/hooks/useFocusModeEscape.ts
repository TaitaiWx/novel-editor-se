import { useEffect, useRef } from 'react';
import { isImeComposing } from '@/render/utils/ime';

/**
 * 打开时会自己消费 Esc 的界面：对话框、菜单、弹出层（OverlayPortal）、编辑器搜索面板。
 * 只要其中任何一个存在，Esc 都留给它们，不退出专注模式。
 */
export const FOCUS_ESCAPE_BLOCKERS = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[aria-modal="true"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[data-overlay-layer]',
  '.cm-sp-panel',
  '.cm-search',
].join(', ');

/** 焦点在普通输入框（重命名、搜索框等）里时，Esc 属于输入框 */
function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('.cm-content')) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * 在事件派发「之前」判断这次 Esc 能否用于退出专注模式。
 * 必须在捕获阶段判断：很多弹层在 document 上监听 Esc 并同步关闭自己（不调用 preventDefault），
 * 等事件冒泡到 window 时弹层可能已经消失，无法再区分「Esc 是关弹层的」还是「退出专注的」。
 */
export function canEscapeExitFocus(event: KeyboardEvent, doc: Document = document): boolean {
  if (event.key !== 'Escape' || event.repeat) return false;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  if (isImeComposing(event)) return false;
  if (isTextField(event.target)) return false;
  return doc.querySelector(FOCUS_ESCAPE_BLOCKERS) === null;
}

/**
 * 专注模式下按 Esc 退出。
 *
 * 事件顺序：window 捕获阶段记录「派发前」的界面状态 → 编辑器 / 搜索面板 / 弹层各自处理 →
 * window 冒泡阶段（最后执行）只在没有人 preventDefault 且派发前没有弹层时才退出。
 */
export function useFocusModeEscape(focusMode: boolean, exitFocusMode: () => void): void {
  const exitRef = useRef(exitFocusMode);
  exitRef.current = exitFocusMode;

  useEffect(() => {
    if (!focusMode) return;
    let candidate: KeyboardEvent | null = null;

    const onCapture = (event: KeyboardEvent) => {
      candidate = canEscapeExitFocus(event) ? event : null;
    };
    const onBubble = (event: KeyboardEvent) => {
      const eligible = candidate === event;
      candidate = null;
      if (!eligible || event.defaultPrevented) return;
      event.preventDefault();
      exitRef.current();
    };

    window.addEventListener('keydown', onCapture, true);
    window.addEventListener('keydown', onBubble);
    return () => {
      window.removeEventListener('keydown', onCapture, true);
      window.removeEventListener('keydown', onBubble);
    };
  }, [focusMode]);
}
