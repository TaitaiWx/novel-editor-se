import React from 'react';
import { VscLightbulb } from 'react-icons/vsc';
import Tooltip from '../Tooltip';
import { formatShortcutLabel } from '@/render/utils/appSettings';
import { requestOpenInspiration } from '../InspirationDialog/inspiration';
import styles from './styles.module.scss';

interface InspirationButtonProps {
  /** 当前「灵感抽签」快捷键（设置中心可改），用于提示 */
  shortcut?: string;
}

/** 编辑器文件栏上的「灵感」按钮：打开灵感抽签弹窗 */
const InspirationButton: React.FC<InspirationButtonProps> = ({ shortcut }) => {
  const shortcutLabel = shortcut ? formatShortcutLabel(shortcut) : '';
  return (
    <Tooltip content={shortcutLabel ? `灵感 (${shortcutLabel})` : '灵感'} position="bottom">
      <button
        type="button"
        className={styles.button}
        aria-label="灵感"
        onClick={() => requestOpenInspiration()}
      >
        <VscLightbulb />
      </button>
    </Tooltip>
  );
};

export default InspirationButton;
