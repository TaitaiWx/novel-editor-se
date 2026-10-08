import { useEffect, useRef, useState } from 'react';
import { useToast } from '../Toast';
import {
  type SettingsDraft,
  type ShortcutSettings,
  DEFAULT_AI_SETTINGS,
  DEFAULT_SETTINGS_DRAFT,
  DEFAULT_SHORTCUT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  mergeSettingsDraft,
  normalizeShortcutInput,
} from '../../utils/appSettings';
import { isImeComposing } from '../../utils/ime';
import type { AIIpcResult, AIProviderInfo } from '../../types/ai-api';
import {
  VALID_TABS,
  type ClearDataScope,
  type SettingsTab,
  type SystemProfileInfo,
} from './constants';

/**
 * 把加载期间用户已做的修改（current 相对 baseline 变化的字段）叠加到存储中读出的设置上，
 * 避免异步加载完成后覆盖用户的编辑
 */
function mergeUserEdits(
  baseline: SettingsDraft,
  current: SettingsDraft,
  loaded: SettingsDraft
): SettingsDraft {
  if (current === baseline) return loaded;
  const mergeSection = <T extends object>(base: T, cur: T, next: T): T => {
    if (cur === base) return next;
    const result = { ...next };
    (Object.keys(cur) as Array<keyof T>).forEach((key) => {
      if (cur[key] !== base[key]) result[key] = cur[key];
    });
    return result;
  };
  return {
    general: mergeSection(baseline.general, current.general, loaded.general),
    shortcuts: mergeSection(baseline.shortcuts, current.shortcuts, loaded.shortcuts),
    ai: mergeSection(baseline.ai, current.ai, loaded.ai),
  };
}

function normalizeTab(tab?: SettingsTab | string): SettingsTab {
  return VALID_TABS.includes(tab as SettingsTab) ? (tab as SettingsTab) : 'general';
}

interface UseSettingsFormOptions {
  visible: boolean;
  onClose: () => void;
  initialTab: SettingsTab;
  onSettingsChange?: (settings: SettingsDraft) => void;
}

/** 删除全部 AI 模型（Key 一并删除）；主进程不可用时忽略 */
async function clearAllModels(): Promise<void> {
  const ipc = window.electron?.ipcRenderer;
  if (!ipc) return;
  const listed = (await ipc.invoke('ai-providers-list').catch(() => undefined)) as
    | AIIpcResult<AIProviderInfo[]>
    | undefined;
  for (const item of listed?.ok ? listed.data : []) {
    await ipc.invoke('ai-models-remove', item.id);
  }
}

/**
 * 设置中心的表单状态：加载 / 自动保存设置草稿、系统性能信息、清理数据
 */
export function useSettingsForm({
  visible,
  onClose,
  initialTab,
  onSettingsChange,
}: UseSettingsFormOptions) {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<SettingsTab>(normalizeTab(initialTab));
  const [settings, setSettings] = useState<SettingsDraft>(DEFAULT_SETTINGS_DRAFT);
  const [loaded, setLoaded] = useState(false);
  // 始终指向最新的设置草稿，供异步加载完成时判断用户是否已做修改
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [clearConfirmScope, setClearConfirmScope] = useState<ClearDataScope | null>(null);
  const [systemProfile, setSystemProfile] = useState<SystemProfileInfo | null>(null);
  const aiSettings = settings.ai ?? DEFAULT_AI_SETTINGS;

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
      const baseline = settingsRef.current;
      try {
        const raw = (await ipc.invoke('db-settings-get', SETTINGS_STORAGE_KEY)) as string | null;
        const next = mergeUserEdits(baseline, settingsRef.current, mergeSettingsDraft(raw));
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
    if (!visible || systemProfile) return;
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    ipc
      .invoke('get-system-profile')
      .then((info) => {
        if (info && typeof info === 'object') {
          setSystemProfile(info as SystemProfileInfo);
        }
      })
      .catch(() => {});
  }, [visible, systemProfile]);

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

      if (scope === 'ai' || scope === 'all') {
        // 全部模型连同 Key（主进程安全存储）一起删除
        await clearAllModels();
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

  return {
    activeTab,
    setActiveTab,
    settings,
    setSettings,
    aiSettings,
    clearConfirmScope,
    setClearConfirmScope,
    systemProfile,
    setGeneral,
    setShortcuts,
    resetShortcut,
    handleClearData,
  };
}

export type SettingsFormApi = ReturnType<typeof useSettingsForm>;
