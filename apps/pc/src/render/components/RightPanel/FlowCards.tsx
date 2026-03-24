import React from 'react';
import styles from './styles.module.scss';

type FlowCardTone = 'default' | 'accent' | 'info' | 'plain';

function getToneClass(tone: FlowCardTone): string {
  if (tone === 'accent') return styles.flowCardAccent;
  if (tone === 'info') return styles.flowCardInfo;
  if (tone === 'plain') return styles.flowCardPlain;
  return '';
}

export const FlowCard: React.FC<{
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  tone?: FlowCardTone;
  className?: string;
}> = ({ title, subtitle, meta, actions, children, tone = 'default', className }) => {
  return (
    <section className={[styles.flowCard, getToneClass(tone), className].filter(Boolean).join(' ')}>
      {(title || subtitle || meta || actions) && (
        <FlowCardHeader title={title} subtitle={subtitle} meta={meta} actions={actions} />
      )}
      <div className={styles.flowCardBody}>{children}</div>
    </section>
  );
};

export const FlowCardHeader: React.FC<{
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ title, subtitle, meta, actions }) => {
  return (
    <div className={styles.flowCardHeader}>
      <div className={styles.flowCardHeading}>
        {title && <div className={styles.flowCardTitle}>{title}</div>}
        {subtitle && <div className={styles.flowCardSubtitle}>{subtitle}</div>}
      </div>
      {(meta || actions) && (
        <div className={styles.flowCardHeaderSide}>
          {meta && <div className={styles.flowCardMeta}>{meta}</div>}
          {actions && <div className={styles.flowCardActions}>{actions}</div>}
        </div>
      )}
    </div>
  );
};

export const FlowCollapsibleCard: React.FC<{
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  meta?: React.ReactNode;
  summary?: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
  tone?: FlowCardTone;
  className?: string;
}> = ({
  title,
  subtitle,
  meta,
  summary,
  expanded,
  onToggle,
  children,
  tone = 'default',
  className,
}) => {
  return (
    <section className={[styles.flowCard, getToneClass(tone), className].filter(Boolean).join(' ')}>
      <button className={styles.flowCardCollapseToggle} onClick={onToggle} type="button">
        <FlowCardHeader title={title} subtitle={subtitle} meta={meta} />
      </button>
      {summary && <div className={styles.flowCardSummary}>{summary}</div>}
      {expanded && children && <div className={styles.flowCardBody}>{children}</div>}
    </section>
  );
};
