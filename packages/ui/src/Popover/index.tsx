import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import OverlayPortal from '../OverlayPortal';
import styles from './styles.module.scss';

type PopoverPlacement = 'top' | 'bottom';
type PopoverAlign = 'start' | 'center' | 'end';

export interface PopoverProps {
  open: boolean;
  children: React.ReactNode;
  anchorRef?: React.RefObject<HTMLElement | null>;
  anchorRect?: DOMRect | null;
  placement?: PopoverPlacement;
  align?: PopoverAlign;
  offset?: number;
  crossOffset?: number;
  viewportPadding?: number;
  zIndex?: number;
  className?: string;
  role?: React.AriaRole;
  onClose?: () => void;
  closeOnOutsideClick?: boolean;
  closeOnEscape?: boolean;
  onMouseEnter?: React.MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
}

interface PopoverPosition {
  left: number;
  top: number;
  placement: PopoverPlacement;
  positioned: boolean;
}

const DEFAULT_POSITION: PopoverPosition = {
  left: 0,
  top: 0,
  placement: 'bottom',
  positioned: false,
};

const Popover: React.FC<PopoverProps> = ({
  open,
  children,
  anchorRef,
  anchorRect,
  placement = 'bottom',
  align = 'start',
  offset = 8,
  crossOffset = 0,
  viewportPadding = 8,
  zIndex = 1000,
  className,
  role = 'dialog',
  onClose,
  closeOnOutsideClick = false,
  closeOnEscape = false,
  onMouseEnter,
  onMouseLeave,
}) => {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<PopoverPosition>({
    ...DEFAULT_POSITION,
    placement,
  });

  const getAnchorRect = useCallback(() => {
    if (anchorRect) return anchorRect;
    return anchorRef?.current?.getBoundingClientRect() ?? null;
  }, [anchorRect, anchorRef]);

  const updatePosition = useCallback(() => {
    const content = contentRef.current;
    const resolvedAnchorRect = getAnchorRect();
    if (!open || !content || !resolvedAnchorRect) return;

    const contentRect = content.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let nextPlacement: PopoverPlacement = placement;
    let top =
      nextPlacement === 'top'
        ? resolvedAnchorRect.top - contentRect.height - offset
        : resolvedAnchorRect.bottom + offset;

    if (nextPlacement === 'top' && top < viewportPadding) {
      nextPlacement = 'bottom';
      top = resolvedAnchorRect.bottom + offset;
    } else if (
      nextPlacement === 'bottom' &&
      top + contentRect.height > viewportHeight - viewportPadding
    ) {
      nextPlacement = 'top';
      top = resolvedAnchorRect.top - contentRect.height - offset;
    }

    let left = resolvedAnchorRect.left;
    if (align === 'center') {
      left = resolvedAnchorRect.left + resolvedAnchorRect.width / 2 - contentRect.width / 2;
    } else if (align === 'end') {
      left = resolvedAnchorRect.right - contentRect.width;
    }
    left += crossOffset;

    left = Math.max(viewportPadding, left);
    left = Math.min(left, viewportWidth - contentRect.width - viewportPadding);
    top = Math.max(viewportPadding, top);
    top = Math.min(top, viewportHeight - contentRect.height - viewportPadding);

    setPosition({
      left,
      top,
      placement: nextPlacement,
      positioned: true,
    });
  }, [align, crossOffset, getAnchorRect, offset, open, placement, viewportPadding]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition({
        ...DEFAULT_POSITION,
        placement,
      });
      return;
    }

    updatePosition();
  }, [open, placement, updatePosition, children]);

  useEffect(() => {
    if (!open) return;

    const handleViewportChange = () => updatePosition();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open, updatePosition]);

  if (!open) {
    return null;
  }

  return (
    <OverlayPortal
      ref={contentRef}
      open={open}
      className={[styles.popover, !position.positioned ? styles.hidden : '', className || '']
        .filter(Boolean)
        .join(' ')}
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
        zIndex,
      }}
      data-placement={position.placement}
      role={role}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClose={onClose}
      closeOnOutsideClick={closeOnOutsideClick}
      closeOnEscape={closeOnEscape}
      containRefs={anchorRef ? [anchorRef] : []}
    >
      {children}
    </OverlayPortal>
  );
};

export default Popover;
