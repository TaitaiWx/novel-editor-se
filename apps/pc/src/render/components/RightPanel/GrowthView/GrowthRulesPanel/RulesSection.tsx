import React, { useId, useState } from 'react';
import { VscChevronDown, VscChevronRight } from 'react-icons/vsc';
import styles from './styles.module.scss';

interface RulesSectionProps {
  title: string;
  /** 标题旁的计数，例如「6 项」 */
  meta?: string;
  /** 本分区的错误数（折叠时也能看到） */
  errorCount?: number;
  /** 标题右侧的操作（添加按钮等） */
  actions?: React.ReactNode;
  defaultOpen?: boolean;
  testId?: string;
  children: React.ReactNode;
}

/** 可折叠的分区卡片 */
export const RulesSection: React.FC<RulesSectionProps> = ({
  title,
  meta,
  errorCount = 0,
  actions,
  defaultOpen = true,
  testId,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <section className={styles.card} aria-label={title} data-testid={testId}>
      <div className={styles.sectionHead}>
        <button
          type="button"
          className={styles.sectionToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <VscChevronDown aria-hidden /> : <VscChevronRight aria-hidden />}
          <span className={styles.sectionTitle}>{title}</span>
          {meta && <span className={styles.meta}>{meta}</span>}
          {errorCount > 0 && (
            <span className={styles.errorBadge} aria-label={`${errorCount} 处错误`}>
              {errorCount}
            </span>
          )}
        </button>
        {open && actions && <div className={styles.sectionActions}>{actions}</div>}
      </div>
      {open && (
        <div id={bodyId} className={styles.sectionBody}>
          {children}
        </div>
      )}
    </section>
  );
};

export default RulesSection;
