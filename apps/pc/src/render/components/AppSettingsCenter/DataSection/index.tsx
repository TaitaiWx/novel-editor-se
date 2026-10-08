import React from 'react';
import { AiOutlineDatabase } from 'react-icons/ai';
import type { ClearDataScope } from '../constants';
import { SettingsGroup, SettingsRow, SettingsSection } from '../layout';
import styles from './styles.module.scss';

interface DataSectionProps {
  clearConfirmScope: ClearDataScope | null;
  setClearConfirmScope: (scope: ClearDataScope | null) => void;
  handleClearData: (scope: ClearDataScope) => Promise<void>;
}

interface ClearItem {
  scope: ClearDataScope;
  label: string;
  description: string;
  action: string;
  confirmText: string;
  confirmAction: string;
}

const CLEAR_ITEMS: readonly ClearItem[] = [
  {
    scope: 'document',
    label: '文档数据',
    description: '清理最近项目记录和创作辅助缓存，不会影响正文与素材文件。',
    action: '清除文档数据',
    confirmText: '将清理本地缓存与最近项目记录，不会删除作品文件。',
    confirmAction: '确认清除',
  },
  {
    scope: 'ai',
    label: 'AI 设置数据',
    description: '重置 AI 服务、模型和密钥等参数，不影响作品内容。',
    action: '清除 AI 设置',
    confirmText: '将恢复 AI 设置到默认值，不影响作品内容和本地缓存。',
    confirmAction: '确认清除',
  },
];

const RESET_ALL: ClearItem = {
  scope: 'all',
  label: '全部清空',
  description: '清理本地缓存并恢复默认设置，不会删除作品目录中的文件。',
  action: '全部清空',
  confirmText: '这会重置全部本地设置与缓存，不会删除作品文件。',
  confirmAction: '确认全部清空',
};

/** 数据与缓存分区 */
const DataSection: React.FC<DataSectionProps> = ({
  clearConfirmScope,
  setClearConfirmScope,
  handleClearData,
}) => {
  const renderItem = (item: ClearItem, danger: boolean) => {
    const confirming = clearConfirmScope === item.scope;
    return (
      <SettingsRow
        key={item.scope}
        label={item.label}
        description={item.description}
        tone={danger ? 'danger' : 'default'}
        align="start"
        extra={
          confirming && (
            <div className={styles.confirm} role="alert">
              <div className={styles.confirmText}>{item.confirmText}</div>
              <div className={styles.confirmActions}>
                <button
                  type="button"
                  className={styles.neutralButton}
                  onClick={() => setClearConfirmScope(null)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={() => void handleClearData(item.scope)}
                >
                  {item.confirmAction}
                </button>
              </div>
            </div>
          )
        }
      >
        <button
          type="button"
          className={danger ? styles.dangerButton : styles.neutralButton}
          aria-expanded={confirming}
          onClick={() => setClearConfirmScope(confirming ? null : item.scope)}
        >
          {item.action}
        </button>
      </SettingsRow>
    );
  };

  return (
    <SettingsSection
      icon={<AiOutlineDatabase />}
      title="数据与缓存"
      description="清理保存在当前设备上的本地缓存与偏好设置，不会删除作品目录中的文件。"
    >
      <SettingsGroup title="本地数据">
        {CLEAR_ITEMS.map((item) => renderItem(item, false))}
      </SettingsGroup>
      <SettingsGroup title="危险操作" description="以下操作不可撤销，请确认后再执行。">
        {renderItem(RESET_ALL, true)}
      </SettingsGroup>
    </SettingsSection>
  );
};

export default DataSection;
