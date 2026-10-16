import React, { forwardRef } from 'react';
import styles from './styles.module.scss';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** 已有业务布局迁移时保留调用方样式；新界面使用默认统一样式。 */
  unstyled?: boolean;
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { unstyled = false, variant = 'default', className, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      data-variant={unstyled ? undefined : variant}
      className={
        [styles.base, !unstyled && styles.control, className].filter(Boolean).join(' ') || undefined
      }
      {...props}
    />
  );
});
export default Button;
