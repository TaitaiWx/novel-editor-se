import React, { useState } from 'react';
import type { ContinuationContextSummary } from '../TextEditor/assist/types';
import styles from './styles.module.scss';

interface ContextDetailsProps {
  context: ContinuationContextSummary;
}

/** 「查看本次上下文」：服务、token 用量与各分区（可展开看具体内容） */
export const ContextDetails: React.FC<ContextDetailsProps> = ({ context }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.context}>
      <button
        type="button"
        className={styles.linkButton}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? '收起本次上下文' : '查看本次上下文'}
      </button>
      {open && (
        <div className={styles.contextBody}>
          <div className={styles.contextMeta}>
            {context.providerLabel} · 约 {context.usedTokens} / {context.budget} tokens
          </div>
          <ul className={styles.sectionList}>
            {context.sections.map((section) => (
              <li key={section.key}>
                <details>
                  <summary>
                    <span>{section.label}</span>
                    <span className={styles.sectionTokens}>
                      {section.tokens} tokens
                      {section.truncated ? ' · 已截断' : ''}
                      {section.omittedItems > 0 ? ` · 省略 ${section.omittedItems} 条` : ''}
                    </span>
                  </summary>
                  <pre className={styles.sectionText}>{section.text}</pre>
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default ContextDetails;
