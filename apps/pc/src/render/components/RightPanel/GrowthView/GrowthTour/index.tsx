import React, { useCallback, useLayoutEffect, useState } from 'react';
import OverlayPortal from '../../../OverlayPortal';
import { GROWTH_TOUR_STEPS } from '../growthGuide';
import styles from './styles.module.scss';

interface GrowthTourProps {
  /** 当前步骤；null 表示不显示 */
  step: number | null;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

interface Placement {
  spot: { left: number; top: number; width: number; height: number } | null;
  card: { left: number; top: number };
}

const CARD_WIDTH = 300;
const CARD_HEIGHT_GUESS = 170;
const GAP = 12;
const PAD = 12;

/** 按目标元素位置摆放高亮框与说明卡片；目标不存在时卡片居中 */
function computePlacement(target: Element | null): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const centered = {
    left: Math.max(PAD, (vw - CARD_WIDTH) / 2),
    top: Math.max(PAD, (vh - CARD_HEIGHT_GUESS) / 2),
  };
  if (!target) return { spot: null, card: centered };
  const rect = target.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return { spot: null, card: centered };
  const spot = {
    left: rect.left - 4,
    top: rect.top - 4,
    width: rect.width + 8,
    height: rect.height + 8,
  };
  const clampLeft = (left: number) => Math.min(Math.max(PAD, left), vw - CARD_WIDTH - PAD);
  const clampTop = (top: number) => Math.min(Math.max(PAD, top), vh - CARD_HEIGHT_GUESS - PAD);
  // 左侧窄列（文件面板）：卡片放在右边
  if (rect.right + GAP + CARD_WIDTH < vw && rect.left < vw * 0.3 && rect.height > 80) {
    return { spot, card: { left: rect.right + GAP, top: clampTop(rect.top) } };
  }
  const below = rect.bottom + GAP;
  const top = below + CARD_HEIGHT_GUESS < vh ? below : rect.top - GAP - CARD_HEIGHT_GUESS;
  return { spot, card: { left: clampLeft(rect.right - CARD_WIDTH), top: clampTop(top) } };
}

/**
 * 首次引导：3~4 步的小卡片，高亮界面上的对应位置（左侧列表 → 记一笔 → 提醒 → 更多）
 */
export const GrowthTour: React.FC<GrowthTourProps> = ({ step, onNext, onPrev, onClose }) => {
  const current = step === null ? null : GROWTH_TOUR_STEPS[step];
  const [placement, setPlacement] = useState<Placement | null>(null);

  const update = useCallback(() => {
    if (!current) return;
    setPlacement(
      computePlacement(document.querySelector(`[data-growth-tour="${current.target}"]`))
    );
  }, [current]);

  useLayoutEffect(() => {
    if (!current) {
      setPlacement(null);
      return;
    }
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [current, update]);

  if (step === null || !current) return null;
  const isLast = step === GROWTH_TOUR_STEPS.length - 1;

  return (
    <OverlayPortal open onClose={onClose} closeOnEscape className={styles.layer}>
      {placement?.spot ? (
        <div className={styles.spot} style={placement.spot} aria-hidden="true" />
      ) : (
        <div className={styles.dim} aria-hidden="true" />
      )}
      <div
        className={styles.card}
        role="dialog"
        aria-label={`引导 ${step + 1}/${GROWTH_TOUR_STEPS.length}：${current.title}`}
        style={placement ? placement.card : undefined}
      >
        <div className={styles.progress}>
          {step + 1} / {GROWTH_TOUR_STEPS.length}
        </div>
        <div className={styles.title}>{current.title}</div>
        <p className={styles.text}>{current.text}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.skip} onClick={onClose}>
            跳过
          </button>
          <span className={styles.spacer} />
          {step > 0 && (
            <button type="button" className={styles.secondary} onClick={onPrev}>
              上一步
            </button>
          )}
          <button type="button" className={styles.primary} onClick={onNext} autoFocus>
            {isLast ? '开始使用' : '下一步'}
          </button>
        </div>
      </div>
    </OverlayPortal>
  );
};

export default GrowthTour;
