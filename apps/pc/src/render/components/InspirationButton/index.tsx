import React from 'react';
import { VscLightbulb } from 'react-icons/vsc';
import Tooltip from '../Tooltip';
import { formatShortcutLabel } from '@/render/utils/appSettings';
import { requestOpenInspiration } from '../InspirationDialog/inspiration';
import styles from './styles.module.scss';

export const INSPIRATION_TIP = '抽一签人物 / 地点 / 冲突，没有头绪时找点灵感';

interface InspirationButtonProps {
  /** 当前「灵感抽签」快捷键（设置中心可改），用于提示 */
  shortcut?: string;
  /**
   * pill：编辑器文件栏上的「💡 灵感」胶囊按钮（图标 + 文字，一眼能找到）
   * primary：未打开文件时空状态里的主操作「灵感抽签」（带快捷键提示）
   */
  variant?: 'pill' | 'primary';
}

/** 打开灵感抽签弹窗的按钮（编辑器文件栏 / 空编辑器）；应用菜单「编辑 → 灵感抽签…」与快捷键同样可打开 */
const InspirationButton: React.FC<InspirationButtonProps> = ({ shortcut, variant = 'pill' }) => {
  const shortcutLabel = shortcut ? formatShortcutLabel(shortcut) : '';

  if (variant === 'primary') {
    return (
      <button
        type="button"
        className={styles.primary}
        onClick={() => requestOpenInspiration()}
        aria-keyshortcuts={shortcut || undefined}
        data-testid="inspiration-empty-action"
      >
        <VscLightbulb className={styles.icon} aria-hidden="true" />
        <span>灵感抽签</span>
        {shortcutLabel && (
          <kbd className={styles.kbd} aria-hidden="true">
            {shortcutLabel}
          </kbd>
        )}
      </button>
    );
  }

  // 外层 slot 在文件栏操作区（flex）中排到最前，与保存 / 设置图标分开
  return (
    <span className={styles.pillSlot}>
      <Tooltip
        content={shortcutLabel ? `${INSPIRATION_TIP}（${shortcutLabel}）` : INSPIRATION_TIP}
        position="bottom"
      >
        <button
          type="button"
          className={styles.pill}
          aria-label="灵感"
          aria-keyshortcuts={shortcut || undefined}
          data-testid="inspiration-pill"
          onClick={() => requestOpenInspiration()}
        >
          <VscLightbulb className={styles.icon} aria-hidden="true" />
          <span className={styles.label}>灵感</span>
        </button>
      </Tooltip>
    </span>
  );
};

export default InspirationButton;
