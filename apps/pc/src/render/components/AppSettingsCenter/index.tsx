import React, { useEffect, useState } from 'react';
import { AiOutlineApi, AiOutlineDatabase, AiOutlineKey, AiOutlineSetting } from 'react-icons/ai';
import { useToast } from '../Toast';
import styles from './styles.module.scss';
import {
  type AIProvider,
  type AIPresetKey,
  type SettingsDraft,
  type ShortcutSettings,
  DEFAULT_AI_SETTINGS,
  DEFAULT_SETTINGS_DRAFT,
  DEFAULT_SHORTCUT_SETTINGS,
  READONLY_SHORTCUTS,
  SETTINGS_STORAGE_KEY,
  SHORTCUT_FIELD_DEFINITIONS,
  formatShortcutLabel,
  mergeSettingsDraft,
  normalizeShortcutInput,
} from '../../utils/appSettings';
import { isImeComposing } from '../../utils/ime';

export type SettingsTab = 'general' | 'ai' | 'data' | 'shortcuts';
type ClearDataScope = 'document' | 'ai' | 'all';

interface AppSettingsCenterProps {
  visible: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
  onSettingsChange?: (settings: SettingsDraft) => void;
  onOpenShortcuts?: () => void;
}

const VALID_TABS: SettingsTab[] = ['general', 'ai', 'data', 'shortcuts'];

const AI_PRESET_OPTIONS: Array<{
  key: AIPresetKey;
  label: string;
  provider: AIProvider;
  baseUrl: string;
  models: string[];
  defaultTemperature: number;
  defaultContextTokens: number;
}> = [
  {
    key: 'openai-official',
    label: 'OpenAI 官方',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.4'],
    defaultTemperature: 1.3,
    defaultContextTokens: 128000,
  },
  {
    key: 'deepseek-official',
    label: 'DeepSeek 官方',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultTemperature: 1.3,
    defaultContextTokens: 128000,
  },
  {
    key: 'openrouter',
    label: 'OpenRouter',
    provider: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['openai/gpt-5.4-mini', 'deepseek/deepseek-chat-v3-0324'],
    defaultTemperature: 1.3,
    defaultContextTokens: 128000,
  },
  {
    key: 'copilot',
    label: 'Copilot / GitHub Models',
    provider: 'openai-compatible',
    baseUrl: 'https://models.inference.ai.azure.com',
    models: ['gpt-4.1', 'gpt-4o-mini', 'DeepSeek-R1'],
    defaultTemperature: 1.3,
    defaultContextTokens: 128000,
  },
  {
    key: 'custom',
    label: '自定义兼容接口',
    provider: 'openai-compatible',
    baseUrl: '',
    models: [],
    defaultTemperature: 1.3,
    defaultContextTokens: 128000,
  },
];

function normalizeTab(tab?: SettingsTab | string): SettingsTab {
  return VALID_TABS.includes(tab as SettingsTab) ? (tab as SettingsTab) : 'general';
}

const TAB_LABELS: Record<SettingsTab, string> = {
  general: '通用',
  ai: 'AI',
  data: '数据与缓存',
  shortcuts: '快捷键',
};

const AppSettingsCenter: React.FC<AppSettingsCenterProps> = ({
  visible,
  onClose,
  initialTab = 'general',
  onSettingsChange,
  onOpenShortcuts,
}) => {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<SettingsTab>(normalizeTab(initialTab));
  const [settings, setSettings] = useState<SettingsDraft>(DEFAULT_SETTINGS_DRAFT);
  const [loaded, setLoaded] = useState(false);
  const [aiSaveStatus, setAiSaveStatus] = useState('');
  const [clearConfirmScope, setClearConfirmScope] = useState<ClearDataScope | null>(null);
  const aiSettings = settings.ai ?? DEFAULT_AI_SETTINGS;
  const activeAIPreset =
    AI_PRESET_OPTIONS.find((item) => item.key === aiSettings.preset) || AI_PRESET_OPTIONS[0];

  useEffect(() => {
    setActiveTab(normalizeTab(initialTab));
  }, [initialTab, visible]);

  useEffect(() => {
    if (!visible) {
      setClearConfirmScope(null);
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return;
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, onClose]);

  useEffect(() => {
    if (!visible) return;
    const load = async () => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc) {
        setSettings(DEFAULT_SETTINGS_DRAFT);
        setLoaded(true);
        return;
      }
      try {
        const raw = (await ipc.invoke('db-settings-get', SETTINGS_STORAGE_KEY)) as string | null;
        const next = mergeSettingsDraft(raw);
        setSettings(next);
        onSettingsChange?.(next);
      } catch {
        setSettings(DEFAULT_SETTINGS_DRAFT);
      } finally {
        setLoaded(true);
      }
    };
    void load();
  }, [visible, onSettingsChange]);

  useEffect(() => {
    if (!loaded) return;
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    ipc.invoke('db-settings-set', SETTINGS_STORAGE_KEY, JSON.stringify(settings)).catch(() => {});
    onSettingsChange?.(settings);
  }, [settings, loaded, onSettingsChange]);

  const setGeneral = <K extends keyof SettingsDraft['general']>(
    key: K,
    value: SettingsDraft['general'][K]
  ) => {
    setSettings((prev) => ({
      ...prev,
      general: { ...prev.general, [key]: value },
    }));
  };

  const setShortcuts = <K extends keyof ShortcutSettings>(key: K, value: ShortcutSettings[K]) => {
    setSettings((prev) => ({
      ...prev,
      shortcuts: { ...prev.shortcuts, [key]: normalizeShortcutInput(value) || prev.shortcuts[key] },
    }));
  };

  const resetShortcut = <K extends keyof ShortcutSettings>(key: K) => {
    setSettings((prev) => ({
      ...prev,
      shortcuts: { ...prev.shortcuts, [key]: DEFAULT_SHORTCUT_SETTINGS[key] },
    }));
  };

  const setAI = <K extends keyof SettingsDraft['ai']>(key: K, value: SettingsDraft['ai'][K]) => {
    setSettings((prev) => ({
      ...prev,
      ai: { ...prev.ai, [key]: value },
    }));
  };

  const applyAIPreset = (presetKey: AIPresetKey) => {
    const preset = AI_PRESET_OPTIONS.find((item) => item.key === presetKey);
    if (!preset) return;
    setSettings((prev) => ({
      ...prev,
      ai: {
        ...prev.ai,
        preset: preset.key,
        provider: preset.provider,
        baseUrl: preset.baseUrl || prev.ai.baseUrl,
        model: preset.models[0] || prev.ai.model,
        temperature: preset.defaultTemperature,
        contextTokens: preset.defaultContextTokens,
        maxTokens: 8192,
      },
    }));
  };

  const handleClearData = async (scope: ClearDataScope) => {
    const ipc = window.electron?.ipcRenderer;
    try {
      if (scope === 'document' || scope === 'all') {
        await (ipc?.invoke('app-cache-clear', 'document-data') as
          | { removedSettingRows?: number; clearedRecentFolders?: number }
          | undefined);
        if (scope === 'document') {
          setClearConfirmScope(null);
          toast.success('已清理本地缓存与最近项目记录');
          return;
        }
      }

      if (scope === 'ai') {
        const next = {
          ...settings,
          ai: DEFAULT_AI_SETTINGS,
        };
        setSettings(next);
        setClearConfirmScope(null);
        onSettingsChange?.(next);
        toast.success('AI 设置已恢复默认');
        return;
      }

      const next = DEFAULT_SETTINGS_DRAFT;
      if (ipc) {
        await ipc.invoke('db-settings-set', SETTINGS_STORAGE_KEY, JSON.stringify(next));
      }
      setSettings(next);
      setClearConfirmScope(null);
      onSettingsChange?.(next);
      toast.success('本地缓存与设置已清理');
    } catch (error) {
      toast.error(`清除失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleSaveAISettings = async () => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    try {
      await ipc.invoke('db-settings-set', SETTINGS_STORAGE_KEY, JSON.stringify(settings));
      setAiSaveStatus('AI 配置已保存');
      setTimeout(() => setAiSaveStatus(''), 1800);
    } catch {
      setAiSaveStatus('保存失败，请重试');
    }
  };

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
              <div className={styles.panel}>
                <h4>
                  <AiOutlineSetting />
                  <span>通用设置</span>
                </h4>
                <p>调整启动方式与界面显示。设置会保存在当前设备上。</p>

                <div className={styles.formSection}>
                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>启动时默认折叠右侧辅助面板</div>
                      <div className={styles.formDesc}>启动时先收起右侧辅助区，需要时再展开。</div>
                    </div>
                    <button
                      className={`${styles.switchButton} ${settings.general.collapseRightPanelOnStartup ? styles.enabled : ''}`}
                      onClick={() =>
                        setGeneral(
                          'collapseRightPanelOnStartup',
                          !settings.general.collapseRightPanelOnStartup
                        )
                      }
                    >
                      <span className={styles.switchThumb} />
                    </button>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>显示状态栏</div>
                      <div className={styles.formDesc}>
                        在窗口底部显示字数、编码和版本入口等信息。
                      </div>
                    </div>
                    <button
                      className={`${styles.switchButton} ${settings.general.showStatusBar ? styles.enabled : ''}`}
                      onClick={() => setGeneral('showStatusBar', !settings.general.showStatusBar)}
                    >
                      <span className={styles.switchThumb} />
                    </button>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>显示文件大小</div>
                      <div className={styles.formDesc}>
                        在资源树中显示文件大小。关闭后可减轻大目录的加载压力。
                      </div>
                    </div>
                    <button
                      className={`${styles.switchButton} ${settings.general.showFileSizes ? styles.enabled : ''}`}
                      onClick={() => setGeneral('showFileSizes', !settings.general.showFileSizes)}
                    >
                      <span className={styles.switchThumb} />
                    </button>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>更新后自动打开更新日志</div>
                      <div className={styles.formDesc}>应用更新完成后，自动打开本次版本说明。</div>
                    </div>
                    <button
                      className={`${styles.switchButton} ${settings.general.openChangelogAfterUpdate ? styles.enabled : ''}`}
                      onClick={() =>
                        setGeneral(
                          'openChangelogAfterUpdate',
                          !settings.general.openChangelogAfterUpdate
                        )
                      }
                    >
                      <span className={styles.switchThumb} />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'shortcuts' && (
              <div className={styles.panel}>
                <h4>
                  <AiOutlineKey />
                  <span>快捷键</span>
                </h4>
                <p>
                  可自定义的快捷键会在保存后立即生效。系统级快捷键保持默认，以避免与系统菜单冲突。
                </p>

                <div className={styles.formSection}>
                  {SHORTCUT_FIELD_DEFINITIONS.map((field) => (
                    <div key={field.key} className={styles.formRowTopAligned}>
                      <div className={styles.formMeta}>
                        <div className={styles.formLabel}>{field.label}</div>
                        <div className={styles.formDesc}>{field.description}</div>
                      </div>
                      <div className={styles.shortcutEditor}>
                        <input
                          className={styles.input}
                          value={settings.shortcuts[field.key]}
                          onChange={(e) => setShortcuts(field.key, e.target.value)}
                          onBlur={(e) => setShortcuts(field.key, e.target.value)}
                          placeholder={field.placeholder}
                        />
                        <div className={styles.shortcutActions}>
                          <span className={styles.shortcutHint}>
                            当前显示：{formatShortcutLabel(settings.shortcuts[field.key])}
                          </span>
                          <button
                            className={styles.secondaryButton}
                            onClick={() => resetShortcut(field.key)}
                          >
                            恢复默认
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className={styles.specCard}>
                  <div className={styles.specRow}>
                    <span className={styles.specLabel}>固定备用键</span>
                    <span className={styles.specValue}>F11 仍然可以切换专注模式</span>
                  </div>
                </div>

                <div className={styles.readonlyShortcutList}>
                  {READONLY_SHORTCUTS.map((item) => (
                    <div
                      key={`${item.description}-${item.accelerator}`}
                      className={styles.readonlyShortcutItem}
                    >
                      <div className={styles.readonlyShortcutMeta}>
                        <div className={styles.formLabel}>{item.description}</div>
                        <div className={styles.formDesc}>系统级快捷键，当前版本暂不支持修改。</div>
                      </div>
                      <span className={styles.readonlyShortcutValue}>
                        {formatShortcutLabel(item.accelerator)}
                      </span>
                    </div>
                  ))}
                </div>

                <button
                  className={styles.primaryButton}
                  onClick={() => {
                    onClose();
                    onOpenShortcuts?.();
                  }}
                >
                  打开快捷键总览
                </button>
              </div>
            )}

            {activeTab === 'data' && (
              <div className={styles.panel}>
                <h4>
                  <AiOutlineDatabase />
                  <span>数据与缓存</span>
                </h4>
                <p>清理保存在当前设备上的本地缓存与偏好设置，不会删除作品目录中的文件。</p>

                <div className={styles.dataGrid}>
                  <div className={styles.dataCard}>
                    <div className={styles.dataCardHeader}>
                      <div>
                        <div className={styles.dataCardTitle}>文档数据</div>
                        <div className={styles.dataCardDesc}>
                          清理最近项目记录和创作辅助缓存，不会影响正文与素材文件。
                        </div>
                      </div>
                      <button
                        className={styles.dataClearButton}
                        onClick={() =>
                          setClearConfirmScope(clearConfirmScope === 'document' ? null : 'document')
                        }
                      >
                        清除文档数据
                      </button>
                    </div>
                    {clearConfirmScope === 'document' && (
                      <div className={styles.dataConfirmBox}>
                        <div className={styles.dataConfirmText}>
                          将清理本地缓存与最近项目记录，不会删除作品文件。
                        </div>
                        <div className={styles.dataConfirmActions}>
                          <button
                            className={styles.dataCancelButton}
                            onClick={() => setClearConfirmScope(null)}
                          >
                            取消
                          </button>
                          <button
                            className={styles.dataDangerConfirmButton}
                            onClick={() => void handleClearData('document')}
                          >
                            确认清除
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className={styles.dataCard}>
                    <div className={styles.dataCardHeader}>
                      <div>
                        <div className={styles.dataCardTitle}>AI 设置数据</div>
                        <div className={styles.dataCardDesc}>
                          重置 AI 服务、模型和密钥等参数，不影响作品内容。
                        </div>
                      </div>
                      <button
                        className={styles.dataClearButton}
                        onClick={() =>
                          setClearConfirmScope(clearConfirmScope === 'ai' ? null : 'ai')
                        }
                      >
                        清除 AI 设置
                      </button>
                    </div>
                    {clearConfirmScope === 'ai' && (
                      <div className={styles.dataConfirmBox}>
                        <div className={styles.dataConfirmText}>
                          将恢复 AI 设置到默认值，不影响作品内容和本地缓存。
                        </div>
                        <div className={styles.dataConfirmActions}>
                          <button
                            className={styles.dataCancelButton}
                            onClick={() => setClearConfirmScope(null)}
                          >
                            取消
                          </button>
                          <button
                            className={styles.dataDangerConfirmButton}
                            onClick={() => void handleClearData('ai')}
                          >
                            确认清除
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className={`${styles.dataCard} ${styles.dataCardDanger}`}>
                    <div className={styles.dataCardHeader}>
                      <div>
                        <div className={styles.dataCardTitle}>全部清空</div>
                        <div className={styles.dataCardDesc}>
                          清理本地缓存并恢复默认设置，不会删除作品目录中的文件。
                        </div>
                      </div>
                      <button
                        className={styles.dataClearDangerButton}
                        onClick={() =>
                          setClearConfirmScope(clearConfirmScope === 'all' ? null : 'all')
                        }
                      >
                        全部清空
                      </button>
                    </div>
                    {clearConfirmScope === 'all' && (
                      <div className={styles.dataConfirmBox}>
                        <div className={styles.dataConfirmText}>
                          这会重置全部本地设置与缓存，不会删除作品文件。
                        </div>
                        <div className={styles.dataConfirmActions}>
                          <button
                            className={styles.dataCancelButton}
                            onClick={() => setClearConfirmScope(null)}
                          >
                            取消
                          </button>
                          <button
                            className={styles.dataDangerConfirmButton}
                            onClick={() => void handleClearData('all')}
                          >
                            确认全部清空
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'ai' && (
              <div className={styles.panel}>
                <h4>
                  <AiOutlineApi />
                  <span>AI 设置</span>
                </h4>
                <p>统一配置 AI 服务、模型与回复参数，供写作辅助功能使用。</p>

                <div className={styles.formSection}>
                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>启用 AI 功能</div>
                      <div className={styles.formDesc}>关闭后，AI 相关功能将不再发送请求。</div>
                    </div>
                    <button
                      className={`${styles.switchButton} ${aiSettings.enabled ? styles.enabled : ''}`}
                      onClick={() => setAI('enabled', !aiSettings.enabled)}
                    >
                      <span className={styles.switchThumb} />
                    </button>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>服务预设</div>
                      <div className={styles.formDesc}>
                        选择常见服务后，自动填入推荐的接口地址和模型。
                      </div>
                    </div>
                    <select
                      className={styles.select}
                      value={aiSettings.preset || 'openai-official'}
                      onChange={(e) => applyAIPreset(e.target.value as AIPresetKey)}
                    >
                      {AI_PRESET_OPTIONS.map((preset) => (
                        <option key={preset.key} value={preset.key}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>服务类型</div>
                      <div className={styles.formDesc}>
                        用于匹配不同服务的接口协议。大多数服务选择 OpenAI 兼容即可。
                      </div>
                    </div>
                    <select
                      className={styles.select}
                      value={aiSettings.provider}
                      onChange={(e) => setAI('provider', e.target.value as AIProvider)}
                    >
                      <option value="openai-compatible">OpenAI 兼容</option>
                      <option value="openai">OpenAI</option>
                      <option value="deepseek">DeepSeek</option>
                    </select>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>接口地址</div>
                      <div className={styles.formDesc}>
                        填写服务提供方的 API 地址，例如 https://api.openai.com/v1
                      </div>
                    </div>
                    <input
                      className={styles.input}
                      value={aiSettings.baseUrl}
                      onChange={(e) => setAI('baseUrl', e.target.value)}
                      placeholder="https://api.openai.com/v1"
                    />
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>模型名称</div>
                      <div className={styles.formDesc}>可从推荐模型中选择，也可以手动填写。</div>
                    </div>
                    <div className={styles.dualInputGroup}>
                      <select
                        className={styles.select}
                        value={
                          activeAIPreset.models.includes(aiSettings.model)
                            ? aiSettings.model
                            : '__custom__'
                        }
                        onChange={(e) => {
                          if (e.target.value === '__custom__') return;
                          const newModel = e.target.value;
                          setAI('model', newModel);
                          if (newModel === 'deepseek-reasoner') {
                            setAI('maxTokens', 65536);
                          } else if (newModel === 'deepseek-chat') {
                            setAI('maxTokens', 8192);
                          }
                        }}
                      >
                        {activeAIPreset.models.map((model) => (
                          <option key={model} value={model}>
                            {model === 'deepseek-chat'
                              ? 'deepseek-chat / DeepSeek-V3.2'
                              : model === 'deepseek-reasoner'
                                ? 'deepseek-reasoner'
                                : model}
                          </option>
                        ))}
                        {aiSettings.preset !== 'deepseek-official' && (
                          <option value="__custom__">手动输入</option>
                        )}
                      </select>
                      <input
                        className={styles.input}
                        value={aiSettings.model}
                        onChange={(e) => setAI('model', e.target.value)}
                        placeholder={
                          aiSettings.preset === 'deepseek-official'
                            ? 'DeepSeek 官方预设模型（固定使用 V3.2 / Reasoner）'
                            : '例如：gpt-5.4-mini'
                        }
                        disabled={aiSettings.preset === 'deepseek-official'}
                      />
                    </div>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>API Key</div>
                      <div className={styles.formDesc}>
                        仅保存在当前设备上，用于连接你选择的 AI 服务。
                      </div>
                    </div>
                    <input
                      className={styles.input}
                      type="password"
                      value={aiSettings.apiKey}
                      onChange={(e) => setAI('apiKey', e.target.value)}
                      placeholder="sk-..."
                    />
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>温度</div>
                      <div className={styles.formDesc}>
                        数值越高，回复越发散；数值越低，回复越稳定。
                      </div>
                    </div>
                    <input
                      className={styles.input}
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      value={aiSettings.temperature}
                      onChange={(e) => setAI('temperature', Number(e.target.value) || 1.3)}
                    />
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>上下文长度</div>
                      <div className={styles.formDesc}>用于控制单次请求可携带的上下文上限。</div>
                    </div>
                    <input
                      className={styles.input}
                      type="number"
                      min="128000"
                      max="1000000"
                      step="10000"
                      value={aiSettings.contextTokens}
                      onChange={(e) =>
                        setAI('contextTokens', Math.max(128000, Number(e.target.value) || 128000))
                      }
                    />
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>单次回复长度</div>
                      <div className={styles.formDesc}>
                        限制 AI 单次回复的最大长度。较长回复会消耗更多额度。
                      </div>
                    </div>
                    <input
                      className={styles.input}
                      type="number"
                      min="512"
                      max="65536"
                      step="128"
                      value={aiSettings.maxTokens}
                      onChange={(e) =>
                        setAI('maxTokens', Math.max(512, Number(e.target.value) || 8192))
                      }
                    />
                  </div>
                </div>

                <div className={styles.aiSaveRow}>
                  <button className={styles.primaryButton} onClick={handleSaveAISettings}>
                    保存 AI 配置
                  </button>
                  {aiSaveStatus && <span className={styles.aiSaveStatus}>{aiSaveStatus}</span>}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default AppSettingsCenter;
