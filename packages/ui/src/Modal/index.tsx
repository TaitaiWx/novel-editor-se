import UiButton from '../Button';
import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { OverlayContainerContext } from '../OverlayPortal';
import styles from './styles.module.scss';

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

/** 通用居中弹窗：统一外观、遮罩、Esc 关闭与焦点恢复，浏览器负责模态焦点约束。 */
export default function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width = 480,
  initialFocusRef,
}: ModalProps) {
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const titleId = useId();
  const focusRef = useRef(initialFocusRef);
  focusRef.current = initialFocusRef;
  useEffect(() => {
    if (!open) return;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    dialog.showModal();
    focusRef.current?.current?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, [open, dialog]);

  if (!open) return null;
  return createPortal(
    <dialog
      ref={setDialog}
      className={styles.modal}
      style={{ width }}
      aria-labelledby={titleId}
      aria-modal="true"
      data-overlay-layer=""
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className={styles.header}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <UiButton
          unstyled
          type="button"
          className={styles.close}
          aria-label="关闭"
          onClick={onClose}
        >
          ×
        </UiButton>
      </header>
      <OverlayContainerContext.Provider value={dialog}>
        <div className={styles.body}>{children}</div>
        {footer && <footer className={styles.footer}>{footer}</footer>}
      </OverlayContainerContext.Provider>
    </dialog>,
    document.body
  );
}
