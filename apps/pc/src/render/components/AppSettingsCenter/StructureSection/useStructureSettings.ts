/**
 * 「设置 → 正文结构」的数据：读取当前项目的规则、编辑草稿（预设开关 / 自定义规则）、校验、保存。
 * 读写经 IPC project-structure-get / set（主进程校验文件夹与配置，保存后广播给所有窗口）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  compileStructureRules,
  nextCustomRuleId,
  structureConfigSignature,
  validateCustomStructureRule,
  type CustomStructureRule,
  type StructureConfig,
  type StructurePresetId,
  type StructureRuleSet,
} from '@novel-editor/core/structure-rules';
import type { ProjectStructureInfo } from '../../../../shared/project-structure';
import { setStructureConfig } from '../../../utils/structureRules';

export type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

export interface StructureSettingsApi {
  loading: boolean;
  loadError: string;
  info: ProjectStructureInfo | null;
  draft: StructureConfig | null;
  /** 每条自定义规则的错误（按下标，空字符串表示没问题） */
  ruleErrors: string[];
  /** 只包含有效规则的草稿规则集（测试框用） */
  previewRules: StructureRuleSet;
  dirty: boolean;
  canSave: boolean;
  status: SaveStatus;
  togglePreset(id: StructurePresetId, enabled: boolean): void;
  addRule(): void;
  updateRule(index: number, patch: Partial<CustomStructureRule>): void;
  removeRule(index: number): void;
  save(): Promise<void>;
  reset(): void;
}

export function useStructureSettings(folderPath: string | null): StructureSettingsApi {
  const [info, setInfo] = useState<ProjectStructureInfo | null>(null);
  const [draft, setDraft] = useState<StructureConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });

  useEffect(() => {
    setInfo(null);
    setDraft(null);
    setLoadError('');
    setStatus({ kind: 'idle' });
    const ipc = window.electron?.ipcRenderer;
    if (!folderPath || !ipc) return;
    let cancelled = false;
    setLoading(true);
    ipc
      .invoke('project-structure-get', folderPath)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setInfo(result.data);
          setDraft(result.data.config);
        } else {
          setLoadError(result.error);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [folderPath]);

  const ruleErrors = useMemo(
    () =>
      (draft?.custom ?? []).map((rule, index, all) => {
        const result = validateCustomStructureRule(rule);
        if (!result.ok) return result.error;
        return all.findIndex((item) => item.id === rule.id) === index ? '' : '规则 id 重复';
      }),
    [draft]
  );

  const previewRules = useMemo(
    () =>
      compileStructureRules({
        presets: draft?.presets ?? [],
        custom: (draft?.custom ?? []).filter((_rule, index) => !ruleErrors[index]),
      }),
    [draft, ruleErrors]
  );

  const dirty = Boolean(
    draft && info && structureConfigSignature(draft) !== structureConfigSignature(info.config)
  );
  const canSave = Boolean(draft && dirty && ruleErrors.every((error) => !error));

  const edit = useCallback((change: (config: StructureConfig) => StructureConfig) => {
    setDraft((current) => (current ? change(current) : current));
    setStatus({ kind: 'idle' });
  }, []);

  const togglePreset = useCallback(
    (id: StructurePresetId, enabled: boolean) =>
      edit((config) => ({
        ...config,
        presets: enabled
          ? Array.from(new Set([...config.presets, id]))
          : config.presets.filter((item) => item !== id),
      })),
    [edit]
  );

  const addRule = useCallback(
    () =>
      edit((config) => ({
        ...config,
        custom: [
          ...config.custom,
          { id: nextCustomRuleId(config.custom), kind: 'scene', pattern: '' },
        ],
      })),
    [edit]
  );

  const updateRule = useCallback(
    (index: number, patch: Partial<CustomStructureRule>) =>
      edit((config) => ({
        ...config,
        custom: config.custom.map((rule, i) => {
          if (i !== index) return rule;
          const next: CustomStructureRule = { ...rule, ...patch };
          if (!next.flags) delete next.flags;
          return next;
        }),
      })),
    [edit]
  );

  const removeRule = useCallback(
    (index: number) =>
      edit((config) => ({ ...config, custom: config.custom.filter((_rule, i) => i !== index) })),
    [edit]
  );

  const save = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    if (!folderPath || !ipc || !draft) return;
    setStatus({ kind: 'saving' });
    try {
      const result = await ipc.invoke('project-structure-set', folderPath, draft);
      if (!result.ok) {
        setStatus({ kind: 'error', message: result.error });
        return;
      }
      setInfo(result.data);
      setDraft(result.data.config);
      // 主进程也会广播；这里直接更新，保证本窗口立即生效
      setStructureConfig(result.data.config);
      setStatus({ kind: 'saved' });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }, [draft, folderPath]);

  const reset = useCallback(() => {
    if (info) setDraft(info.config);
    setStatus({ kind: 'idle' });
  }, [info]);

  return {
    loading,
    loadError,
    info,
    draft,
    ruleErrors,
    previewRules,
    dirty,
    canSave,
    status,
    togglePreset,
    addRule,
    updateRule,
    removeRule,
    save,
    reset,
  };
}
