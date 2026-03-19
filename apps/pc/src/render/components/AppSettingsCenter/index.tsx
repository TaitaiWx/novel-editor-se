import React, { useEffect, useState } from 'react';
import {
  AiOutlineApi,
  AiOutlineCloudSync,
  AiOutlineDatabase,
  AiOutlineKey,
  AiOutlineUser,
} from 'react-icons/ai';
import { useToast } from '../Toast';
import styles from './styles.module.scss';

export type SettingsTab = 'general' | 'account' | 'sync' | 'ai' | 'data' | 'shortcuts';
type ClearDataScope = 'document' | 'account' | 'ai' | 'all';

type LoginStatus = 'signed-out' | 'signed-in' | 'expired';
type AuthProvider = 'email' | 'github' | 'wechat';
type WorkspaceScope = 'local-only' | 'personal-cloud' | 'team-space';
type SyncStrategy = 'realtime' | 'manual' | 'wifi-only';
type ConflictStrategy = 'ask' | 'keep-both' | 'local-first' | 'cloud-first';

interface AccountSettings {
  loginStatus: LoginStatus;
  provider: AuthProvider;
  displayName: string;
  email: string;
  workspaceScope: WorkspaceScope;
  deviceName: string;
  autoLogin: boolean;
  sessionProtection: boolean;
}

interface SyncSettings {
  syncEnabled: boolean;
  strategy: SyncStrategy;
  conflictStrategy: ConflictStrategy;
  autoBackupEnabled: boolean;
  backupIntervalMinutes: 5 | 10 | 30;
  keepVersions: 10 | 20 | 50;
  syncAssets: boolean;
  backupBeforeOverwrite: boolean;
}

type AIProvider = 'openai-compatible' | 'openai' | 'deepseek';

type AIPresetKey = 'openai-official' | 'deepseek-official' | 'openrouter' | 'copilot' | 'custom';
interface AISettings {
  enabled: boolean;
  provider: AIProvider;
  preset: AIPresetKey;
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
  contextTokens: number;
  maxTokens: number;
}

export interface SettingsDraft {
  account: AccountSettings;
  sync: SyncSettings;
  ai: AISettings;
}

interface AppSettingsCenterProps {
  visible: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
  onSettingsChange?: (settings: SettingsDraft) => void;
  onOpenShortcuts?: () => void;
}

const SETTINGS_STORAGE_KEY = 'novel-editor:settings-center';

const INITIAL_SETTINGS: SettingsDraft = {
  account: {
    loginStatus: 'signed-out',
    provider: 'email',
    displayName: '未登录用户',
    email: '',
    workspaceScope: 'local-only',
    deviceName: '当前设备',
    autoLogin: true,
    sessionProtection: true,
  },
  sync: {
    syncEnabled: false,
    strategy: 'manual',
    conflictStrategy: 'ask',
    autoBackupEnabled: true,
    backupIntervalMinutes: 10,
    keepVersions: 20,
    syncAssets: true,
    backupBeforeOverwrite: true,
  },
  ai: {
    enabled: false,
    provider: 'openai-compatible',
    preset: 'openai-official',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.4-mini',
    apiKey: '',
    temperature: 1.3,
    contextTokens: 128000,
    maxTokens: 8192,
  },
};

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

const LOGIN_STATUS_LABELS: Record<LoginStatus, string> = {
  'signed-out': '未登录',
  'signed-in': '已登录',
  expired: '会话过期',
};

const STRATEGY_LABELS: Record<SyncStrategy, string> = {
  realtime: '实时同步',
  manual: '手动同步',
  'wifi-only': '仅 Wi-Fi 下同步',
};

const CONFLICT_LABELS: Record<ConflictStrategy, string> = {
  ask: '每次询问',
  'keep-both': '保留双版本',
  'local-first': '本地优先',
  'cloud-first': '云端优先',
};

function mergeSettingsDraft(raw: string | null): SettingsDraft {
  if (!raw) return INITIAL_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<SettingsDraft>;
    return {
      account: { ...INITIAL_SETTINGS.account, ...(parsed.account || {}) },
      sync: { ...INITIAL_SETTINGS.sync, ...(parsed.sync || {}) },
      ai: { ...INITIAL_SETTINGS.ai, ...(parsed.ai || {}) },
    };
  } catch {
    return INITIAL_SETTINGS;
  }
}

const TAB_LABELS: Record<SettingsTab, string> = {
  general: '通用',
  account: '账号',
  sync: '云同步',
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
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [settings, setSettings] = useState<SettingsDraft>(INITIAL_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [aiSaveStatus, setAiSaveStatus] = useState('');
  const [clearConfirmScope, setClearConfirmScope] = useState<ClearDataScope | null>(null);
  const aiSettings = settings.ai ?? INITIAL_SETTINGS.ai;
  const activeAIPreset =
    AI_PRESET_OPTIONS.find((item) => item.key === aiSettings.preset) || AI_PRESET_OPTIONS[0];

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab, visible]);

  useEffect(() => {
    if (!visible) {
      setClearConfirmScope(null);
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
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
        setSettings(INITIAL_SETTINGS);
        setLoaded(true);
        return;
      }
      try {
        const raw = (await ipc.invoke('db-settings-get', SETTINGS_STORAGE_KEY)) as string | null;
        const next = mergeSettingsDraft(raw);
        setSettings(next);
        onSettingsChange?.(next);
      } catch {
        setSettings(INITIAL_SETTINGS);
      } finally {
        setLoaded(true);
      }
    };
    load();
  }, [visible, onSettingsChange]);

  useEffect(() => {
    if (!loaded) return;
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    ipc.invoke('db-settings-set', SETTINGS_STORAGE_KEY, JSON.stringify(settings)).catch(() => {});
    onSettingsChange?.(settings);
  }, [settings, loaded, onSettingsChange]);

  const tabs = Object.keys(TAB_LABELS) as SettingsTab[];

  const setAccount = <K extends keyof AccountSettings>(key: K, value: AccountSettings[K]) => {
    setSettings((prev) => ({
      ...prev,
      account: { ...prev.account, [key]: value },
    }));
  };

  const setSync = <K extends keyof SyncSettings>(key: K, value: SyncSettings[K]) => {
    setSettings((prev) => ({
      ...prev,
      sync: { ...prev.sync, [key]: value },
    }));
  };

  const setAI = <K extends keyof AISettings>(key: K, value: AISettings[K]) => {
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
        const result = (await ipc?.invoke('app-cache-clear', 'document-data')) as
          | { removedSettingRows?: number; clearedRecentFolders?: number }
          | undefined;
        if (scope === 'document') {
          setClearConfirmScope(null);
          toast.success(
            `已清除文档数据：${result?.removedSettingRows ?? 0} 项面板缓存，${result?.clearedRecentFolders ?? 0} 条最近项目记录`
          );
          return;
        }
      }

      if (scope === 'account') {
        const next = {
          ...settings,
          account: INITIAL_SETTINGS.account,
          sync: INITIAL_SETTINGS.sync,
        };
        setSettings(next);
        setClearConfirmScope(null);
        onSettingsChange?.(next);
        toast.success('账户与同步数据已重置');
        return;
      }

      if (scope === 'ai') {
        const next = {
          ...settings,
          ai: INITIAL_SETTINGS.ai,
        };
        setSettings(next);
        setClearConfirmScope(null);
        onSettingsChange?.(next);
        toast.success('AI 设置数据已重置');
        return;
      }

      const next = INITIAL_SETTINGS;
      if (ipc) {
        await ipc.invoke('db-settings-set', SETTINGS_STORAGE_KEY, JSON.stringify(next));
      }
      setSettings(next);
      setClearConfirmScope(null);
      onSettingsChange?.(next);
      toast.success('本地数据与设置已全部清空');
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
            {tabs.map((tab) => (
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
                <h4>编辑体验</h4>
                <p>专注模式、自动保存、主题等全局能力会统一在这里配置。</p>
                <div className={styles.specCard}>
                  <div className={styles.specRow}>
                    <span className={styles.specLabel}>配置落盘</span>
                    <span className={styles.specValue}>本地持久化已接通</span>
                  </div>
                  <div className={styles.specRow}>
                    <span className={styles.specLabel}>配置范围</span>
                    <span className={styles.specValue}>主题、字体、专注模式参数</span>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'account' && (
              <div className={styles.panel}>
                <h4>
                  <AiOutlineUser />
                  <span>账号体系</span>
                </h4>
                <p>统一管理登录状态、身份提供方、工作区归属与设备级安全策略。</p>

                <div className={styles.statusCard}>
                  <div>
                    <div className={styles.statusTitle}>当前登录状态</div>
                    <div className={styles.statusSubtext}>
                      {settings.account.loginStatus === 'signed-in'
                        ? `${settings.account.displayName} · ${settings.account.email || '未绑定邮箱'}`
                        : '当前设备未建立登录会话，相关能力将在接入真实账号后直接生效'}
                    </div>
                  </div>
                  <span className={`${styles.statusBadge} ${styles[settings.account.loginStatus]}`}>
                    {LOGIN_STATUS_LABELS[settings.account.loginStatus]}
                  </span>
                </div>

                <div className={styles.formSection}>
                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>登录状态</div>
                      <div className={styles.formDesc}>决定云同步、跨设备与订阅能力是否可用</div>
                    </div>
                    <select
                      className={styles.select}
                      value={settings.account.loginStatus}
                      onChange={(e) => setAccount('loginStatus', e.target.value as LoginStatus)}
                    >
                      <option value="signed-out">未登录</option>
                      <option value="signed-in">已登录</option>
                      <option value="expired">会话过期</option>
                    </select>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>身份提供方</div>
                      <div className={styles.formDesc}>支持邮箱、GitHub、微信等身份接入方式</div>
                    </div>
                    <select
                      className={styles.select}
                      value={settings.account.provider}
                      onChange={(e) => setAccount('provider', e.target.value as AuthProvider)}
                    >
                      <option value="email">邮箱登录</option>
                      <option value="github">GitHub</option>
                      <option value="wechat">微信</option>
                    </select>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>显示名称</div>
                      <div className={styles.formDesc}>
                        用于云端工作区、协作痕迹与 AI 上下文署名
                      </div>
                    </div>
                    <input
                      className={styles.input}
                      value={settings.account.displayName}
                      onChange={(e) => setAccount('displayName', e.target.value)}
                      placeholder="请输入显示名称"
                    />
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>默认工作区</div>
                      <div className={styles.formDesc}>
                        决定当前项目优先使用本地、个人云或团队空间
                      </div>
                    </div>
                    <select
                      className={styles.select}
                      value={settings.account.workspaceScope}
                      onChange={(e) =>
                        setAccount('workspaceScope', e.target.value as WorkspaceScope)
                      }
                    >
                      <option value="local-only">仅本地</option>
                      <option value="personal-cloud">个人云工作区</option>
                      <option value="team-space">团队空间</option>
                    </select>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>设备名称</div>
                      <div className={styles.formDesc}>用于同步冲突提示与设备管理标识</div>
                    </div>
                    <input
                      className={styles.input}
                      value={settings.account.deviceName}
                      onChange={(e) => setAccount('deviceName', e.target.value)}
                      placeholder="例如：MacBook Pro 14"
                    />
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>自动登录</div>
                      <div className={styles.formDesc}>应用启动时自动恢复本地会话</div>
                    </div>
                    <button
                      className={`${styles.switchButton} ${settings.account.autoLogin ? styles.enabled : ''}`}
                      onClick={() => setAccount('autoLogin', !settings.account.autoLogin)}
                    >
                      <span className={styles.switchThumb} />
                    </button>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>会话保护</div>
                      <div className={styles.formDesc}>切换设备或异常退出后要求重新确认身份</div>
                    </div>
                    <button
                      className={`${styles.switchButton} ${settings.account.sessionProtection ? styles.enabled : ''}`}
                      onClick={() =>
                        setAccount('sessionProtection', !settings.account.sessionProtection)
                      }
                    >
                      <span className={styles.switchThumb} />
                    </button>
                  </div>
                </div>

                <div className={styles.specCard}>
                  <div className={styles.specRow}>
                    <span className={styles.specLabel}>接入约定</span>
                    <span className={styles.specValue}>OAuth / 邮箱验证码 / 设备管理</span>
                  </div>
                  <div className={styles.specRow}>
                    <span className={styles.specLabel}>安全能力</span>
                    <span className={styles.specValue}>短期令牌 + 刷新令牌 + 设备吊销</span>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'sync' && (
              <div className={styles.panel}>
                <h4>
                  <AiOutlineCloudSync />
                  <span>云同步</span>
                </h4>
                <p>定义同步策略、冲突策略、自动备份策略以及素材同步范围。</p>

                <div className={styles.formSection}>
                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>启用云同步</div>
                      <div className={styles.formDesc}>打开后会尝试同步稿件、设定与结构化数据</div>
                    </div>
                    <button
                      className={`${styles.switchButton} ${settings.sync.syncEnabled ? styles.enabled : ''}`}
                      onClick={() => setSync('syncEnabled', !settings.sync.syncEnabled)}
                    >
                      <span className={styles.switchThumb} />
                    </button>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>同步策略</div>
                      <div className={styles.formDesc}>决定何时将本地修改推送到云端</div>
                    </div>
                    <select
                      className={styles.select}
                      value={settings.sync.strategy}
                      onChange={(e) => setSync('strategy', e.target.value as SyncStrategy)}
                    >
                      <option value="realtime">实时同步</option>
                      <option value="manual">手动同步</option>
                      <option value="wifi-only">仅 Wi-Fi 下同步</option>
                    </select>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>冲突策略</div>
                      <div className={styles.formDesc}>同一内容多端同时修改时的默认处理方式</div>
                    </div>
                    <select
                      className={styles.select}
                      value={settings.sync.conflictStrategy}
                      onChange={(e) =>
                        setSync('conflictStrategy', e.target.value as ConflictStrategy)
                      }
                    >
                      <option value="ask">每次询问</option>
                      <option value="keep-both">保留双版本</option>
                      <option value="local-first">本地优先</option>
                      <option value="cloud-first">云端优先</option>
                    </select>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>自动备份</div>
                      <div className={styles.formDesc}>定期生成恢复点，减少误覆盖带来的损失</div>
                    </div>
                    <button
                      className={`${styles.switchButton} ${settings.sync.autoBackupEnabled ? styles.enabled : ''}`}
                      onClick={() => setSync('autoBackupEnabled', !settings.sync.autoBackupEnabled)}
                    >
                      <span className={styles.switchThumb} />
                    </button>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>备份间隔</div>
                      <div className={styles.formDesc}>控制自动备份的频率</div>
                    </div>
                    <select
                      className={styles.select}
                      value={settings.sync.backupIntervalMinutes}
                      onChange={(e) =>
                        setSync('backupIntervalMinutes', Number(e.target.value) as 5 | 10 | 30)
                      }
                    >
                      <option value="5">每 5 分钟</option>
                      <option value="10">每 10 分钟</option>
                      <option value="30">每 30 分钟</option>
                    </select>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>保留版本数</div>
                      <div className={styles.formDesc}>控制本地快照与云端恢复点数量</div>
                    </div>
                    <select
                      className={styles.select}
                      value={settings.sync.keepVersions}
                      onChange={(e) =>
                        setSync('keepVersions', Number(e.target.value) as 10 | 20 | 50)
                      }
                    >
                      <option value="10">10 个版本</option>
                      <option value="20">20 个版本</option>
                      <option value="50">50 个版本</option>
                    </select>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>同步素材附件</div>
                      <div className={styles.formDesc}>
                        决定图片、参考资料、关系图等是否随项目同步
                      </div>
                    </div>
                    <button
                      className={`${styles.switchButton} ${settings.sync.syncAssets ? styles.enabled : ''}`}
                      onClick={() => setSync('syncAssets', !settings.sync.syncAssets)}
                    >
                      <span className={styles.switchThumb} />
                    </button>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>覆盖前备份</div>
                      <div className={styles.formDesc}>高风险操作前，先写入可回滚快照</div>
                    </div>
                    <button
                      className={`${styles.switchButton} ${settings.sync.backupBeforeOverwrite ? styles.enabled : ''}`}
                      onClick={() =>
                        setSync('backupBeforeOverwrite', !settings.sync.backupBeforeOverwrite)
                      }
                    >
                      <span className={styles.switchThumb} />
                    </button>
                  </div>
                </div>

                <div className={styles.specCard}>
                  <div className={styles.specRow}>
                    <span className={styles.specLabel}>当前策略</span>
                    <span className={styles.specValue}>
                      {STRATEGY_LABELS[settings.sync.strategy]}
                    </span>
                  </div>
                  <div className={styles.specRow}>
                    <span className={styles.specLabel}>冲突处理</span>
                    <span className={styles.specValue}>
                      {CONFLICT_LABELS[settings.sync.conflictStrategy]}
                    </span>
                  </div>
                  <div className={styles.specRow}>
                    <span className={styles.specLabel}>备份约定</span>
                    <span className={styles.specValue}>
                      {settings.sync.autoBackupEnabled
                        ? `${settings.sync.backupIntervalMinutes} 分钟 / 保留 ${settings.sync.keepVersions} 份`
                        : '已关闭'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'data' && (
              <div className={styles.panel}>
                <h4>
                  <AiOutlineDatabase />
                  <span>数据与缓存</span>
                </h4>
                <p>按数据域独立清理，避免一次“全清空”误伤不同量级的本地数据。</p>

                <div className={styles.dataGrid}>
                  <div className={styles.dataCard}>
                    <div className={styles.dataCardHeader}>
                      <div>
                        <div className={styles.dataCardTitle}>文档数据</div>
                        <div className={styles.dataCardDesc}>
                          清除最近项目记录、世界观缓存、人物关系图、剧情板与图布局等文档侧本地缓存，不影响磁盘上的正文文件。
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
                          将清除本地文档缓存与最近项目记录，但不会删除你的项目文件。
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
                        <div className={styles.dataCardTitle}>账户数据</div>
                        <div className={styles.dataCardDesc}>
                          重置登录状态、显示名称、设备级账户偏好，以及同步策略、备份间隔与冲突处理配置。
                        </div>
                      </div>
                      <button
                        className={styles.dataClearButton}
                        onClick={() =>
                          setClearConfirmScope(clearConfirmScope === 'account' ? null : 'account')
                        }
                      >
                        清除账户数据
                      </button>
                    </div>
                    {clearConfirmScope === 'account' && (
                      <div className={styles.dataConfirmBox}>
                        <div className={styles.dataConfirmText}>
                          将恢复账户与同步相关配置到默认值，不影响文档缓存和 AI 参数。
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
                            onClick={() => void handleClearData('account')}
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
                          重置 AI Provider、模型、Key、温度、上下文窗口与最大输出 Token 等参数。
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
                          将恢复 AI 配置到默认值，不影响账户数据和文档缓存。
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
                          同时清除文档缓存、账户/同步配置和 AI
                          设置，恢复当前设备上的本地状态到初始值。
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
                          这是最高风险操作，会重置全部本地设置并清除文档类缓存，但不会删除你的项目目录和正文文件。
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
                  <span>AI 能力接入</span>
                </h4>
                <p>统一配置 AI Provider、Key、模型与推理参数，供所有 AI 功能复用。</p>

                <div className={styles.formSection}>
                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>启用 AI 功能</div>
                      <div className={styles.formDesc}>
                        关闭后，右侧 AI 面板仅展示结构入口，不会发起请求
                      </div>
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
                        选择常见服务后自动填充 Provider、Base URL 与常用模型
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
                      <div className={styles.formLabel}>Provider</div>
                      <div className={styles.formDesc}>
                        默认按 OpenAI 兼容接口调用，便于稳定切换服务商
                      </div>
                    </div>
                    <select
                      className={styles.select}
                      value={aiSettings.provider}
                      onChange={(e) => setAI('provider', e.target.value as AIProvider)}
                    >
                      <option value="openai-compatible">OpenAI Compatible</option>
                      <option value="openai">OpenAI</option>
                      <option value="deepseek">DeepSeek</option>
                    </select>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formMeta}>
                      <div className={styles.formLabel}>Base URL</div>
                      <div className={styles.formDesc}>
                        例如 https://api.openai.com/v1 或兼容服务地址
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
                      <div className={styles.formDesc}>优先使用预设模型，也支持手动填写</div>
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
                        保存在本地应用设置中，由主进程统一读取并发起请求
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
                      <div className={styles.formDesc}>创意写作建议 1.0–1.5，默认 1.3</div>
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
                      <div className={styles.formLabel}>上下文 Token 窗口</div>
                      <div className={styles.formDesc}>
                        当前产品默认按 128k 工作，用于分片与结构化提取
                      </div>
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
                      <div className={styles.formLabel}>最大输出 Token</div>
                      <div className={styles.formDesc}>
                        chat 模型 8k；reasoner 模型 64k（切换模型自动调整）
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

                <div className={styles.specCard}>
                  <div className={styles.specRow}>
                    <span className={styles.specLabel}>调用方式</span>
                    <span className={styles.specValue}>主进程统一代理请求</span>
                  </div>
                  <div className={styles.specRow}>
                    <span className={styles.specLabel}>使用范围</span>
                    <span className={styles.specValue}>关系图、设定补全、一致性检查、剧情建议</span>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'shortcuts' && (
              <div className={styles.panel}>
                <h4>
                  <AiOutlineKey />
                  <span>键盘快捷键</span>
                </h4>
                <p>查看当前所有快捷键，并支持扩展个性化绑定能力。</p>
                <button
                  className={styles.primaryButton}
                  onClick={() => {
                    onClose();
                    onOpenShortcuts?.();
                  }}
                >
                  打开快捷键面板
                </button>
                <div className={styles.specCard}>
                  <div className={styles.specRow}>
                    <span className={styles.specLabel}>扩展能力</span>
                    <span className={styles.specValue}>个人快捷键方案与云端同步</span>
                  </div>
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
