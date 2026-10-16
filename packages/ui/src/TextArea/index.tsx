import React, { forwardRef } from 'react';
import styles from './styles.module.scss';

export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** 已有业务布局迁移时保留调用方样式；新界面使用默认统一样式。 */
  unstyled?: boolean;
}

const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { unstyled = false, className, ...props },
  ref
) {
  return (
    <textarea
      ref={ref}
      className={
        [styles.base, !unstyled && styles.control, className].filter(Boolean).join(' ') || undefined
      }
      {...props}
    />
  );
});
export default TextArea;
