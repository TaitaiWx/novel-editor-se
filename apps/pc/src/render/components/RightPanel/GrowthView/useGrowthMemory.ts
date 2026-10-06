import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Atlas,
  GrowthEventInput,
  GrowthIpcResult,
  GrowthRuleset,
  GrowthSimulationOutcome,
  GrowthSimulationRequest,
  GrowthSnapshot,
  GrowthTemplate,
  PartyBook,
} from '../../../types/growth-api';
import { mapCharacterRows } from '../utils';
import {
  GROWTH_MEMORY_CHANGED_EVENT,
  emitGrowthMemoryChanged,
  type GrowthMemoryChangedDetail,
} from '../../../utils/growthIndex';
import { describeRecordResult, sheetFilePaths } from './growthText';

export interface GrowthCharacterOption {
  name: string;
  aliases: string[];
  /** 是否来自编辑器人物库（否则只存在于记忆库） */
  fromDatabase: boolean;
  hasSheet: boolean;
}

/** 操作结果：成功返回 null，失败返回错误文案 */
export type GrowthActionError = string | null;

function ipc() {
  return window.electron?.ipcRenderer;
}

/**
 * 成长记录器数据：加载 `资料/记忆/`，合并编辑器人物库，并封装所有写操作。
 * 每次写操作后主进程返回最新快照，避免渲染进程自行推算状态。
 */
export function useGrowthMemory({
  folderPath,
  dbReady,
}: {
  folderPath: string | null;
  dbReady: boolean;
}) {
  const [snapshot, setSnapshot] = useState<GrowthSnapshot | null>(null);
  const [dbCharacters, setDbCharacters] = useState<Array<{ name: string; aliases: string[] }>>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const folderRef = useRef(folderPath);
  folderRef.current = folderPath;
  // 本实例标识：广播写入结果时带上，收到自己的广播时忽略
  const [sourceId] = useState(() => `growth-view-${Math.random().toString(36).slice(2)}`);

  /** 统一处理 IPC 结果；成功时更新快照 */
  const run = useCallback(
    async <T>(
      task: () => Promise<GrowthIpcResult<T>> | undefined,
      pick: (data: T) => GrowthSnapshot | null
    ): Promise<{ data: T | null; error: GrowthActionError }> => {
      setBusy(true);
      try {
        const result = await task();
        if (!result) return { data: null, error: '当前环境不支持该操作' };
        if (!result.ok) return { data: null, error: result.error };
        const next = pick(result.data);
        if (next) {
          setSnapshot(next);
          // 广播写入结果：文件面板「成长档案」分区、人物详情及其他成长视图据此刷新
          if (folderRef.current) emitGrowthMemoryChanged(folderRef.current, next, sourceId);
        }
        return { data: result.data, error: null };
      } catch (err) {
        return { data: null, error: err instanceof Error ? err.message : String(err) };
      } finally {
        setBusy(false);
      }
    },
    [sourceId]
  );

  const reload = useCallback(async () => {
    const api = ipc();
    if (!folderPath || !api) {
      setSnapshot(null);
      return;
    }
    setLoading(true);
    try {
      const result = await api.invoke('growth-load', folderPath);
      if (folderRef.current !== folderPath) return;
      if (result.ok) {
        setSnapshot(result.data);
        setError(null);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [folderPath]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 其他成长视图（右侧面板 / 工作区标签）写入后同步刷新；只读不广播，避免互相触发
  useEffect(() => {
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<GrowthMemoryChangedDetail>).detail;
      if (!detail || detail.source === sourceId || detail.folderPath !== folderRef.current) return;
      void reload();
    };
    window.addEventListener(GROWTH_MEMORY_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(GROWTH_MEMORY_CHANGED_EVENT, onChanged);
  }, [reload, sourceId]);

  // 编辑器人物库（SQLite）：用于角色选择器，选中后自动建卡
  useEffect(() => {
    const api = ipc();
    if (!folderPath || !dbReady || !api) {
      setDbCharacters([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const novel = (await api.invoke('db-novel-get-by-folder', folderPath)) as {
          id: number;
        } | null;
        if (!novel) return;
        const rows = (await api.invoke('db-character-list', novel.id)) as Array<{
          id: number;
          name: string;
          role: string;
          description: string;
          attributes: string;
        }>;
        if (cancelled) return;
        setDbCharacters(
          mapCharacterRows(rows ?? []).map((item) => ({
            name: item.name,
            aliases: item.aliases ?? [],
          }))
        );
      } catch {
        if (!cancelled) setDbCharacters([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dbReady, folderPath]);

  const characters = useMemo<GrowthCharacterOption[]>(() => {
    const sheets = snapshot?.sheets ?? [];
    const options: GrowthCharacterOption[] = sheets.map((sheet) => ({
      name: sheet.name,
      aliases: sheet.aliases,
      fromDatabase: dbCharacters.some((item) => item.name === sheet.name),
      hasSheet: true,
    }));
    for (const item of dbCharacters) {
      if (!item.name.trim() || options.some((option) => option.name === item.name)) continue;
      options.push({ name: item.name, aliases: item.aliases, fromDatabase: true, hasSheet: false });
    }
    return options;
  }, [dbCharacters, snapshot?.sheets]);

  // 默认选中第一个已有成长卡的角色
  useEffect(() => {
    if (selectedName && characters.some((item) => item.name === selectedName)) return;
    const first = characters.find((item) => item.hasSheet) ?? null;
    setSelectedName(first?.name ?? null);
  }, [characters, selectedName]);

  const selectedSheet = useMemo(
    () => snapshot?.sheets.find((sheet) => sheet.name === selectedName) ?? null,
    [selectedName, snapshot?.sheets]
  );

  const selectCharacter = useCallback(
    async (name: string): Promise<GrowthActionError> => {
      if (!folderPath || snapshot?.sheets.some((sheet) => sheet.name === name)) {
        setSelectedName(name);
        return null;
      }
      const aliases = characters.find((item) => item.name === name)?.aliases ?? [];
      const { error: err } = await run(
        () => ipc()?.invoke('growth-ensure-sheet', folderPath, name, aliases),
        (data) => data
      );
      // 建卡成功后再切换，避免「默认选中」逻辑把尚不存在的角色重置掉；新卡片本身就是反馈，不再弹提示
      if (!err) setSelectedName(name);
      return err;
    },
    [characters, folderPath, run, snapshot?.sheets]
  );

  const initMemory = useCallback(
    async (template: GrowthTemplate) => {
      if (!folderPath) return '未打开项目';
      const { error: err } = await run(
        () => ipc()?.invoke('growth-init', folderPath, template),
        (data) => data
      );
      return err;
    },
    [folderPath, run]
  );

  /** 记一笔：默认写入当前选中的角色，也可指定角色（右侧面板摘要中直接记录） */
  const applyEvent = useCallback(
    async (
      event: GrowthEventInput,
      force = false,
      name: string | null = selectedName
    ): Promise<GrowthActionError> => {
      if (!folderPath || !name) return '请先选择角色';
      const before = snapshot?.sheets.find((item) => item.name === name) ?? null;
      const { data, error: err } = await run(
        () => ipc()?.invoke('growth-apply-event', folderPath, name, event, { force }),
        (outcome) => outcome.snapshot
      );
      if (data) {
        setNotice(
          describeRecordResult({
            name,
            ruleset: data.snapshot.ruleset,
            event,
            before,
            after: data.snapshot.sheets.find((item) => item.name === name) ?? null,
            levelUps: data.levelUps,
          })
        );
      }
      return err;
    },
    [folderPath, run, selectedName, snapshot?.sheets]
  );

  const updateNotes = useCallback(
    async (notes: string[]) => {
      if (!folderPath || !selectedName) return '请先选择角色';
      return (
        await run(
          () => ipc()?.invoke('growth-update-notes', folderPath, selectedName, notes),
          (data) => data
        )
      ).error;
    },
    [folderPath, run, selectedName]
  );

  const saveRuleset = useCallback(
    async (ruleset: GrowthRuleset) => {
      if (!folderPath) return '未打开项目';
      const { error: err } = await run(
        () => ipc()?.invoke('growth-save-ruleset', folderPath, ruleset),
        (data) => data
      );
      if (!err) setNotice('规则已保存');
      return err;
    },
    [folderPath, run]
  );

  const saveParty = useCallback(
    async (party: PartyBook) => {
      if (!folderPath) return '未打开项目';
      return (
        await run(
          () => ipc()?.invoke('growth-save-party', folderPath, party),
          (data) => data
        )
      ).error;
    },
    [folderPath, run]
  );

  const saveAtlas = useCallback(
    async (atlas: Atlas) => {
      if (!folderPath) return '未打开项目';
      return (
        await run(
          () => ipc()?.invoke('growth-save-atlas', folderPath, atlas),
          (data) => data
        )
      ).error;
    },
    [folderPath, run]
  );

  const simulate = useCallback(
    async (
      request: GrowthSimulationRequest
    ): Promise<{ outcome: GrowthSimulationOutcome | null; error: GrowthActionError }> => {
      if (!folderPath || !selectedName) return { outcome: null, error: '请先选择角色' };
      const { data, error: err } = await run(
        () => ipc()?.invoke('growth-simulate', folderPath, selectedName, request),
        () => null
      );
      return { outcome: data, error: err };
    },
    [folderPath, run, selectedName]
  );

  const applyBranch = useCallback(
    async (events: GrowthEventInput[]): Promise<GrowthActionError> => {
      if (!folderPath || !selectedName) return '请先选择角色';
      const { error: err } = await run(
        () => ipc()?.invoke('growth-apply-branch', folderPath, selectedName, { events }),
        (outcome) => outcome.snapshot
      );
      if (!err) setNotice('已采用推演分支，成长记录已写入');
      return err;
    },
    [folderPath, run, selectedName]
  );

  const syncSnapshots = useCallback(async () => {
    if (!folderPath) return '未打开项目';
    const { data, error: err } = await run(
      () => ipc()?.invoke('memory-sync-snapshots', folderPath),
      () => null
    );
    if (data) {
      setNotice(
        `已同步 ${data.characterFiles.length} 张角色卡、${data.settingFiles.length} 条设定到 资料/记忆/`
      );
    }
    return err;
  }, [folderPath, run]);

  /** 删除成长卡：移除 角色/<名>.json 与派生的 .md，然后重新读取并广播 */
  const deleteSheet = useCallback(
    async (name: string): Promise<GrowthActionError> => {
      const api = ipc();
      if (!folderPath || !snapshot || !api) return '未打开项目';
      const [jsonFile, mdFile] = sheetFilePaths(snapshot.dir, name);
      try {
        await api.invoke('delete-file', jsonFile);
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
      // 派生的 Markdown 可能不存在，忽略失败
      await api.invoke('delete-file', mdFile).catch(() => undefined);
      const { error: err } = await run(
        () => api.invoke('growth-load', folderPath),
        (data) => data
      );
      if (!err) setNotice(`已删除「${name}」的成长卡`);
      return err;
    },
    [folderPath, run, snapshot]
  );

  /** 在系统文件管理器中打开 资料/记忆/ */
  const openDataFolder = useCallback(async (): Promise<GrowthActionError> => {
    const api = ipc();
    if (!snapshot?.dir || !api) return '未打开项目';
    try {
      await api.invoke('open-in-system-app', snapshot.dir);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }, [snapshot?.dir]);

  return {
    snapshot,
    characters,
    selectedName,
    selectedSheet,
    loading,
    busy,
    error,
    notice,
    setNotice,
    reload,
    selectCharacter,
    initMemory,
    applyEvent,
    updateNotes,
    saveRuleset,
    saveParty,
    saveAtlas,
    simulate,
    applyBranch,
    syncSnapshots,
    deleteSheet,
    openDataFolder,
  };
}

export type GrowthMemoryApi = ReturnType<typeof useGrowthMemory>;
