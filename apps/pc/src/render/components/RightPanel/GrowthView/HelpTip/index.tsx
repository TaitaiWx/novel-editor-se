import React from 'react';
import Tooltip from '../../../Tooltip';
import styles from './styles.module.scss';

interface HelpTipProps {
  /** 1~2 句说明 + 例子 */
  text: string;
  /** 读屏标签，例如「属性说明」 */
  label: string;
  position?: 'top' | 'bottom';
}

/** 卡片标题旁的「?」小提示：悬停或聚焦时显示简短说明 */
export const HelpTip: React.FC<HelpTipProps> = ({ text, label, position = 'top' }) => (
  <Tooltip content={text} position={position} delay={150}>
    <span className={styles.tip} role="note" tabIndex={0} aria-label={`${label}：${text}`}>
      ?
    </span>
  </Tooltip>
);

export default HelpTip;
