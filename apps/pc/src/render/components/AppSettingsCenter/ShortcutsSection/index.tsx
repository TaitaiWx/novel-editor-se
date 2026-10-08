import React from 'react';
import { AiOutlineKey } from 'react-icons/ai';
import {
  type SettingsDraft,
  READONLY_SHORTCUTS,
  SHORTCUT_FIELD_DEFINITIONS,
  formatShortcutLabel,
} from '../../../utils/appSettings';
import type { SettingsFormApi } from '../useSettingsForm';
import { SettingsGroup, SettingsRow, SettingsSection } from '../layout';
import sharedStyles from '../styles.module.scss';
import styles from './styles.module.scss';

interface ShortcutsSectionProps {
  settings: SettingsDraft;
  setShortcuts: SettingsFormApi['setShortcuts'];
  resetShortcut: SettingsFormApi['resetShortcut'];
  onClose: () => void;
  onOpenShortcuts?: () => void;
}

/** 快捷键设置分区 */
const ShortcutsSection: React.FC<ShortcutsSectionProps> = ({
  settings,
  setShortcuts,
  resetShortcut,
  onClose,
  onOpenShortcuts,
}) => (
  <SettingsSection
    icon={<AiOutlineKey />}
    title="快捷键"
    description="可自定义的快捷键会在保存后立即生效。系统级快捷键保持默认，以避免与系统菜单冲突。"
  >
    <SettingsGroup title="可自定义">
      {SHORTCUT_FIELD_DEFINITIONS.map((field) => (
        <SettingsRow
          key={field.key}
          label={field.label}
          description={field.description}
          control="field"
          align="start"
        >
          <div className={styles.shortcutEditor}>
            <input
              className={sharedStyles.input}
              value={settings.shortcuts[field.key]}
              onChange={(e) => setShortcuts(field.key, e.target.value)}
              onBlur={(e) => setShortcuts(field.key, e.target.value)}
              placeholder={field.placeholder}
              aria-label={field.label}
            />
            <div className={styles.shortcutActions}>
              <span className={styles.shortcutHint}>
                当前显示：{formatShortcutLabel(settings.shortcuts[field.key])}
              </span>
              <button
                type="button"
                className={sharedStyles.secondaryButton}
                onClick={() => resetShortcut(field.key)}
              >
                恢复默认
              </button>
            </div>
          </div>
        </SettingsRow>
      ))}
    </SettingsGroup>

    <SettingsGroup
      title="系统级快捷键"
      description="当前版本暂不支持修改。F11 仍然可以切换专注模式。"
    >
      {READONLY_SHORTCUTS.map((item) => (
        <SettingsRow key={`${item.description}-${item.accelerator}`} label={item.description}>
          <kbd className={styles.keyValue}>{formatShortcutLabel(item.accelerator)}</kbd>
        </SettingsRow>
      ))}
    </SettingsGroup>

    <div className={sharedStyles.actions}>
      <button
        type="button"
        className={sharedStyles.primaryButton}
        onClick={() => {
          onClose();
          onOpenShortcuts?.();
        }}
      >
        打开快捷键总览
      </button>
    </div>
  </SettingsSection>
);

export default ShortcutsSection;
