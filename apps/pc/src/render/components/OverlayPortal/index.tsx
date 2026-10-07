import React, { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { isImeComposing } from '../../utils/ime';

export interface OverlayPortalProps extends React.HTMLAttributes<HTMLDivElement> {
  open: boolean;
  children: React.ReactNode;
  onClose?: () => void;
  closeOnOutsideClick?: boolean;
  closeOnEscape?: boolean;
  containRefs?: Array<React.RefObject<Element | null>>;
}

const OverlayPortal = React.forwardRef<HTMLDivElement, OverlayPortalProps>(
  (
    {
      open,
      children,
      onClose,
      closeOnOutsideClick = false,
      closeOnEscape = false,
      containRefs = [],
      ...divProps
    },
    forwardedRef
  ) => {
    const contentRef = useRef<HTMLDivElement | null>(null);

    const setRefs = useCallback(
      (node: HTMLDivElement | null) => {
        contentRef.current = node;
        if (typeof forwardedRef === 'function') {
          forwardedRef(node);
          return;
        }
        if (forwardedRef) {
          (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }
      },
      [forwardedRef]
    );

    useEffect(() => {
      if (!open || !onClose || !closeOnOutsideClick) return;

      const handlePointerDown = (event: MouseEvent) => {
        const target = event.target as Node | null;
        if (!target) return;
        if (contentRef.current?.contains(target)) return;
        if (containRefs.some((ref) => ref.current?.contains(target))) return;
        // 嵌套弹层（例如弹窗里 Select 的下拉列表，渲染在 body 下）里的点击不算「外部」
        const element = target instanceof Element ? target : target.parentElement;
        if (element?.closest('[data-overlay-nested]')) return;
        onClose();
      };

      document.addEventListener('mousedown', handlePointerDown);
      return () => document.removeEventListener('mousedown', handlePointerDown);
    }, [closeOnOutsideClick, containRefs, onClose, open]);

    useEffect(() => {
      if (!open || !onClose || !closeOnEscape) return;

      const handleEscape = (event: KeyboardEvent) => {
        if (isImeComposing(event)) return;
        if (event.key === 'Escape') {
          onClose();
        }
      };

      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }, [closeOnEscape, onClose, open]);

    if (!open) {
      return null;
    }

    return createPortal(
      // data-overlay-layer：弹层打开期间 Esc 优先给弹层（见 hooks/useFocusModeEscape.ts）
      <div ref={setRefs} data-overlay-layer="" {...divProps}>
        {children}
      </div>,
      document.body
    );
  }
);

OverlayPortal.displayName = 'OverlayPortal';

export default OverlayPortal;
