import React, { useEffect, useRef, useState } from 'react';
import OverlayPortal from '../../../OverlayPortal';
import {
  GROWTH_GUIDE_SECTIONS,
  GROWTH_GUIDE_SUMMARY,
  GROWTH_QUICK_START,
  GROWTH_GUIDE_TITLE,
  GROWTH_TOUR_STORAGE_KEY,
  type GuideBlock,
  type GrowthGuideSectionId,
} from '../growthGuide';
import styles from './styles.module.scss';

interface GrowthHelpProps {
  open: boolean;
  onClose: () => void;
  /** 重新播放首次引导；未提供时（例如从文件面板打开）改为「下次打开成长卡时显示」 */
  onStartTour?: () => void;
  /** 打开后滚动到该章节 */
  section?: GrowthGuideSectionId | null;
}

function Block({ block }: { block: GuideBlock }) {
  switch (block.kind) {
    case 'p':
      return <p className={styles.p}>{block.text}</p>;
    case 'list':
      return (
        <ul className={styles.list}>
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case 'steps':
      return (
        <ol className={styles.steps}>
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      );
    case 'example':
      return (
        <div className={styles.example}>
          <span className={styles.exampleLabel}>例</span>
          <span>{block.text}</span>
        </div>
      );
    case 'faq':
      return (
        <dl className={styles.faq}>
          {block.items.map((item) => (
            <div key={item.q} className={styles.faqItem}>
              <dt>{item.q}</dt>
              <dd>{item.a}</dd>
            </div>
          ))}
        </dl>
      );
  }
}

/**
 * 成长档案「使用说明」抽屉：从右侧滑出，正文来自 growthGuide.ts（与 docs/growth-guide.md 同源）
 */
export const GrowthHelp: React.FC<GrowthHelpProps> = ({ open, onClose, onStartTour, section }) => {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [tourQueued, setTourQueued] = useState(false);

  useEffect(() => {
    if (!open) {
      setTourQueued(false);
      return;
    }
    const target = section ? bodyRef.current?.querySelector(`#growth-guide-${section}`) : null;
    if (target instanceof HTMLDetailsElement) target.open = true;
    if (target instanceof HTMLElement) target.scrollIntoView?.({ block: 'start' });
    else bodyRef.current?.scrollTo?.({ top: 0 });
  }, [open, section]);

  const replayTour = () => {
    if (onStartTour) {
      onClose();
      onStartTour();
      return;
    }
    try {
      window.localStorage.removeItem(GROWTH_TOUR_STORAGE_KEY);
    } catch {
      // 存储不可用时忽略
    }
    setTourQueued(true);
  };

  return (
    <OverlayPortal open={open} onClose={onClose} closeOnEscape className={styles.layer}>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <aside
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-label={GROWTH_GUIDE_TITLE}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>{GROWTH_GUIDE_TITLE}</h2>
          <button
            type="button"
            className={styles.close}
            aria-label="关闭使用说明"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div ref={bodyRef} className={styles.body}>
          <p className={styles.summary}>{GROWTH_GUIDE_SUMMARY}</p>
          <section className={styles.quickStart} aria-label="3 步上手">
            <h3 className={styles.sectionTitle}>3 步上手</h3>
            <ol className={styles.steps}>
              {GROWTH_QUICK_START.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </section>
          <h4 className={styles.moreTitle}>需要时再看</h4>
          {GROWTH_GUIDE_SECTIONS.map((item) => (
            <details key={item.id} id={`growth-guide-${item.id}`} className={styles.details}>
              <summary className={styles.detailsSummary}>{item.title}</summary>
              <div className={styles.detailsBody}>
                {item.blocks.map((block, index) => (
                  <Block key={`${item.id}-${index}`} block={block} />
                ))}
              </div>
            </details>
          ))}
        </div>
        <footer className={styles.footer}>
          <span className={styles.footerHint}>
            {tourQueued ? '下次打开成长卡时会重新显示引导' : '也可以在终端用 ne growth --help 查看'}
          </span>
          <button type="button" className={styles.footerButton} onClick={replayTour}>
            重新查看引导
          </button>
        </footer>
      </aside>
    </OverlayPortal>
  );
};

export default GrowthHelp;
