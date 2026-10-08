import React, { useEffect, useRef, useState } from 'react';
import OverlayPortal from '../../../OverlayPortal';
import type { GuideBlock, GuideContent } from '../../../../utils/guideContent';
import { GROWTH_GUIDE, GROWTH_TOUR_STORAGE_KEY } from '../growthGuide';
import styles from './styles.module.scss';

interface GrowthHelpProps {
  open: boolean;
  onClose: () => void;
  /** 显示的说明（默认成长档案；角色分区传角色使用说明） */
  guide?: GuideContent;
  /** 底部操作：提供时替换默认的「重新查看引导」（例如角色说明切换到成长档案说明） */
  footerAction?: { hint: string; label: string; onClick: () => void };
  /** 重新播放首次引导；未提供时（例如从文件面板打开）改为「下次打开成长卡时显示」 */
  onStartTour?: () => void;
  /** 打开后滚动到该章节 */
  section?: string | null;
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
 * 「使用说明」抽屉：从右侧滑出。默认是成长档案（growthGuide.ts，与 docs/growth-guide.md 同源），
 * 角色分区传入角色使用说明（CharactersView/characterGuide.ts）
 */
export const GrowthHelp: React.FC<GrowthHelpProps> = ({
  open,
  onClose,
  guide = GROWTH_GUIDE,
  footerAction,
  onStartTour,
  section,
}) => {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [tourQueued, setTourQueued] = useState(false);

  useEffect(() => {
    if (!open) {
      setTourQueued(false);
      return;
    }
    const target = section
      ? bodyRef.current?.querySelector(`#${guide.anchorPrefix}-${section}`)
      : null;
    if (target instanceof HTMLDetailsElement) target.open = true;
    if (target instanceof HTMLElement) target.scrollIntoView?.({ block: 'start' });
    else bodyRef.current?.scrollTo?.({ top: 0 });
  }, [open, section, guide]);

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
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={guide.title}>
        <header className={styles.header}>
          <h2 className={styles.title}>{guide.title}</h2>
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
          <p className={styles.summary}>{guide.summary}</p>
          <section className={styles.quickStart} aria-label="3 步上手">
            <h3 className={styles.sectionTitle}>3 步上手</h3>
            <ol className={styles.steps}>
              {guide.quickStart.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </section>
          <h4 className={styles.moreTitle}>需要时再看</h4>
          {guide.sections.map((item) => (
            <details
              key={item.id}
              id={`${guide.anchorPrefix}-${item.id}`}
              className={styles.details}
            >
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
          {footerAction ? (
            <>
              <span className={styles.footerHint}>{footerAction.hint}</span>
              <button type="button" className={styles.footerButton} onClick={footerAction.onClick}>
                {footerAction.label}
              </button>
            </>
          ) : (
            <>
              <span className={styles.footerHint}>
                {tourQueued
                  ? '下次打开成长卡时会重新显示引导'
                  : '也可以在终端用 ne growth --help 查看'}
              </span>
              <button type="button" className={styles.footerButton} onClick={replayTour}>
                重新查看引导
              </button>
            </>
          )}
        </footer>
      </aside>
    </OverlayPortal>
  );
};

export default GrowthHelp;
