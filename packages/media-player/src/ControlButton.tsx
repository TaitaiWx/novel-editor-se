/**
 * 控制条按钮：提示文字默认用原生 title；使用方传入 renderTooltip 时改用自己的提示组件
 * （此时不再设置 title，避免两层提示同时出现）。
 */
import React from 'react';
import styles from './styles.module.scss';

/** 把控制按钮包进使用方的提示组件，例如 `(content, node) => <Tooltip content={content}>{node}</Tooltip>` */
export type RenderTooltip = (content: string, control: React.ReactElement) => React.ReactNode;

export interface ControlButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tooltip: string;
  renderTooltip?: RenderTooltip;
  active?: boolean;
}

const ControlButton: React.FC<ControlButtonProps> = ({
  tooltip,
  renderTooltip,
  active = false,
  className,
  children,
  ...rest
}) => {
  const classes = [styles.control, active ? styles.controlOn : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  const button = (
    <button type="button" className={classes} title={renderTooltip ? undefined : tooltip} {...rest}>
      {children}
    </button>
  );
  return renderTooltip ? <>{renderTooltip(tooltip, button)}</> : button;
};

export default ControlButton;
