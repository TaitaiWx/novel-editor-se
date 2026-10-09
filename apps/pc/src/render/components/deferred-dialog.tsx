import React, { Component, Suspense, lazy, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './deferred-dialog.module.scss';

interface PlaceholderProps {
  active: boolean;
  onClose: () => void;
  onRetry?: () => void;
}

function DialogPlaceholder({ active, onClose, onRetry }: PlaceholderProps) {
  useEffect(() => {
    if (!active) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229) onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [active, onClose]);
  if (!active) return null;
  return createPortal(
    <div className={styles.overlay}>
      <div className={styles.panel} role="dialog" aria-modal="true" aria-label="打开窗口">
        <p role={onRetry ? 'alert' : 'status'}>
          {onRetry ? '窗口加载失败，请重试。' : '正在打开…'}
        </p>
        {onRetry && <button onClick={onRetry}>重试</button>}
        <button onClick={onClose}>关闭</button>
      </div>
    </div>,
    document.body
  );
}

class DialogErrorBoundary extends Component<
  PlaceholderProps & { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <DialogPlaceholder {...this.props} /> : this.props.children;
  }
}

/** Defer the module and first mount, then keep receiving props while hidden.
 * This retains drafts/refs and each dialog's existing visibility cleanup.
 * A caller that previously unmounted on close can keep doing so.
 */
export function deferredDialog<P extends { onClose: () => void }>(
  load: () => Promise<{ default: React.ComponentType<P> }>,
  isActive: (props: P) => boolean
): React.FC<P> {
  // Share the lazy module even when a caller deliberately unmounts the dialog.
  let currentDialog = lazy(load);
  return function DeferredDialog(props: P) {
    const active = isActive(props);
    const activated = useRef(false);
    if (active) activated.current = true;
    const [Dialog, setDialog] = useState(() => currentDialog);
    const [attempt, setAttempt] = useState(0);
    const LoadedDialog = Dialog as unknown as React.ComponentType<P>;
    if (!activated.current) return null;
    const retry = () => {
      currentDialog = lazy(load);
      setDialog(() => currentDialog);
      setAttempt((value) => value + 1);
    };
    return (
      <DialogErrorBoundary key={attempt} active={active} onClose={props.onClose} onRetry={retry}>
        <Suspense fallback={<DialogPlaceholder active={active} onClose={props.onClose} />}>
          <LoadedDialog {...props} />
        </Suspense>
      </DialogErrorBoundary>
    );
  };
}
