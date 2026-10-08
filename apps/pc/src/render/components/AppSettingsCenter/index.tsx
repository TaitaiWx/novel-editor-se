import React, { useRef } from 'react';
import type { SettingsDraft } from '../../utils/appSettings';
import styles from './styles.module.scss';
import { TAB_LABELS, VALID_TABS, type SettingsTab } from './constants';
import { useSettingsForm } from './useSettingsForm';
import GeneralSection from './GeneralSection';
import ShortcutsSection from './ShortcutsSection';
import DataSection from './DataSection';
import AiSection from './AiSection';
import AboutSection from './AboutSection';
import StructureSection from './StructureSection';

export type { SettingsTab } from './constants';

interface AppSettingsCenterProps {
  visible: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
  onSettingsChange?: (settings: SettingsDraft) => void;
  onOpenShortcuts?: () => void;
  /** 当前打开的文件夹（「正文结构」规则保存在项目里） */
  folderPath?: string | null;
}

const AppSettingsCenter: React.FC<AppSettingsCenterProps> = ({
  visible,
  onClose,
  initialTab = 'general',
  onSettingsChange,
  onOpenShortcuts,
  folderPath = null,
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
  const overlayPressRef = useRef(false);

  if (!visible) return null;

  return (
    <div
      className={styles.overlay}
      // 只有在遮罩本身上按下并松开才关闭：从弹窗里拖选文字拖到外面、
      // 或点在弹窗里的浮层（下拉列表等）上，都不会误关
      onPointerDown={(event) => {
        overlayPressRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        const pressedOnOverlay = overlayPressRef.current;
        overlayPressRef.current = false;
        if (pressedOnOverlay && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="设置中心"
        onClick={(e) => e.stopPropagation()}
      >
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

            {activeTab === 'structure' && <StructureSection folderPath={folderPath} />}

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

            {activeTab === 'about' && <AboutSection active={visible} />}
          </section>
        </div>
      </div>
    </div>
  );
};

export default AppSettingsCenter;
