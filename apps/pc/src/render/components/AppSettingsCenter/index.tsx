import React from 'react';
import type { SettingsDraft } from '../../utils/appSettings';
import styles from './styles.module.scss';
import { TAB_LABELS, VALID_TABS, type SettingsTab } from './constants';
import { useSettingsForm } from './useSettingsForm';
import GeneralSection from './GeneralSection';
import ShortcutsSection from './ShortcutsSection';
import DataSection from './DataSection';
import AiSection from './AiSection';
import AboutSection from './AboutSection';

export type { SettingsTab } from './constants';

interface AppSettingsCenterProps {
  visible: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
  onSettingsChange?: (settings: SettingsDraft) => void;
  onOpenShortcuts?: () => void;
  /** 打开更新日志标签（「关于」分区使用） */
  onOpenChangelog?: () => void;
}

const AppSettingsCenter: React.FC<AppSettingsCenterProps> = ({
  visible,
  onClose,
  initialTab = 'general',
  onSettingsChange,
  onOpenShortcuts,
  onOpenChangelog,
}) => {
  const {
    activeTab,
    setActiveTab,
    settings,
    setSettings,
    aiSettings,
    activeAIPreset,
    aiSaveStatus,
    clearConfirmScope,
    setClearConfirmScope,
    systemProfile,
    setGeneral,
    setShortcuts,
    resetShortcut,
    setAI,
    applyAIPreset,
    handleClearData,
    handleSaveAISettings,
  } = useSettingsForm({ visible, onClose, initialTab, onSettingsChange });

  if (!visible) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3>设置中心</h3>
          <button className={styles.closeButton} onClick={onClose} aria-label="关闭设置">
            ×
          </button>
        </div>

        <div className={styles.body}>
          <aside className={styles.sidebar}>
            {VALID_TABS.map((tab) => (
              <button
                key={tab}
                className={`${styles.tabButton} ${activeTab === tab ? styles.active : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </aside>

          <section className={styles.content}>
            {activeTab === 'general' && (
              <GeneralSection
                settings={settings}
                setGeneral={setGeneral}
                systemProfile={systemProfile}
              />
            )}

            {activeTab === 'shortcuts' && (
              <ShortcutsSection
                settings={settings}
                setShortcuts={setShortcuts}
                resetShortcut={resetShortcut}
                onClose={onClose}
                onOpenShortcuts={onOpenShortcuts}
              />
            )}

            {activeTab === 'data' && (
              <DataSection
                clearConfirmScope={clearConfirmScope}
                setClearConfirmScope={setClearConfirmScope}
                handleClearData={handleClearData}
              />
            )}

            {activeTab === 'ai' && (
              <AiSection
                aiSettings={aiSettings}
                activeAIPreset={activeAIPreset}
                setSettings={setSettings}
                setAI={setAI}
                applyAIPreset={applyAIPreset}
                aiSaveStatus={aiSaveStatus}
                handleSaveAISettings={handleSaveAISettings}
              />
            )}

            {activeTab === 'about' && (
              <AboutSection
                active={visible}
                onOpenChangelog={
                  onOpenChangelog
                    ? () => {
                        onClose();
                        onOpenChangelog();
                      }
                    : undefined
                }
              />
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default AppSettingsCenter;
