import React from 'react';
import { VscClose } from 'react-icons/vsc';
import Tooltip from '../../Tooltip';
import styles from './styles.module.scss';

export interface PlanVariant {
  id: string;
  title: string;
  /** 一句话特点（例如「AI · 7 个节点」） */
  subtitle: string;
  /** 预览要点（前几条） */
  lines: string[];
}

interface PlanVariantPickerProps {
  /** 例如「选一个卷纲方案」 */
  heading: string;
  variants: readonly PlanVariant[];
  busy?: boolean;
  onApply: (id: string) => void;
  onDismiss: () => void;
}

/**
 * 「给得少、选得多」：一次生成几种不同方向的方案并排展示，作者只需挑一个「采用」。
 * 章纲（均衡 / 悬疑钩子 / 电影感）与卷纲（三幕式 / 起承转合 / 英雄之旅）共用。
 */
const PlanVariantPicker: React.FC<PlanVariantPickerProps> = ({
  heading,
  variants,
  busy = false,
  onApply,
  onDismiss,
}) => (
  <section className={styles.picker} aria-label={heading} data-testid="plan-variants">
    <header className={styles.head}>
      <span className={styles.heading}>{heading}</span>
      <Tooltip content="都不要（不会改动现有内容）">
        <button
          type="button"
          className={styles.iconButton}
          aria-label="关闭方案"
          onClick={onDismiss}
        >
          <VscClose />
        </button>
      </Tooltip>
    </header>
    <ul className={styles.list} role="list">
      {variants.map((variant) => (
        <li key={variant.id} className={styles.card} aria-label={`方案 ${variant.title}`}>
          <div className={styles.cardHead}>
            <strong>{variant.title}</strong>
            <span className={styles.subtitle}>{variant.subtitle}</span>
          </div>
          <ol className={styles.lines}>
            {variant.lines.slice(0, 5).map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ol>
          <button
            type="button"
            className={styles.apply}
            disabled={busy}
            onClick={() => onApply(variant.id)}
          >
            采用这个
          </button>
        </li>
      ))}
    </ul>
  </section>
);

export default PlanVariantPicker;
