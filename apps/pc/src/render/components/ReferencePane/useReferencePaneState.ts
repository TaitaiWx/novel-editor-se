/**
 * 参考窗格的列表状态：打开 / 收起、自动模式（跟随当前文档）、排序、拖入、移除。
 *
 * - 右键「在编辑器旁边打开」等（REFERENCE_OPEN_EVENT）：作者加入的参考（origin = user），一直保留
 * - 文件栏「参考」按钮（REFERENCE_TOGGLE_EVENT）：进入自动模式，内容 = 本章引用 → 本章场景视频 → 人物图；
 *   之后切换文档 / 作品、编辑指令、资料刷新（REFERENCE_AUTO_SOURCE_EVENT）都会更新自动内容，
 *   作者排好的顺序、加入的参考保留，移除过的自动项不再出现
 * 选中项按路径记录，列表变化时选中的参考不会跳到别的文件。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  REFERENCE_AUTO_SOURCE_EVENT,
  REFERENCE_OPEN_EVENT,
  REFERENCE_TOGGLE_EVENT,
  announceReferenceState,
  referenceItemFor,
  type OpenReferenceDetail,
  type ReferenceAutoSource,
  type ReferenceItem,
  type ToggleReferenceDetail,
} from '../../utils/referencePane';
import {
  combineAutoItems,
  extractDocumentMediaRefs,
  insertReferenceItems,
  moveReferenceItem,
  reconcileAutoItems,
  resolveDocumentMedia,
  sceneVideoReferenceItems,
} from '../../utils/referenceSources';

export type ReferencePaneMode = 'closed' | 'docked' | 'mini';

/** 自动内容的重新计算防抖（输入时不必每个字都解析） */
export const AUTO_REFRESH_DEBOUNCE_MS = 300;
/** 打开时等待本章引用解析的上限 */
export const OPEN_RESOLVE_TIMEOUT_MS = 400;

/** 合并新打开的参考：同一路径不重复，最多保留 30 个（新的在后） */
export function mergeReferenceItems(
  current: readonly ReferenceItem[],
  added: readonly ReferenceItem[]
): ReferenceItem[] {
  const paths = new Set(added.map((item) => item.path));
  return [...current.filter((item) => !paths.has(item.path)), ...added].slice(-30);
}

/** 从列表移除第 index 个后，选中项应在的位置 */
export function indexAfterRemove(length: number, index: number): number {
  return Math.max(0, Math.min(index, length - 2));
}

async function fileExists(path: string): Promise<boolean> {
  const ipc = window.electron?.ipcRenderer;
  if (!ipc) return false;
  try {
    const info = (await ipc.invoke('get-file-info', path)) as { isFile?: boolean } | null;
    return Boolean(info) && info?.isFile !== false;
  } catch {
    return false;
  }
}

/** 按自动来源计算自动内容（本章引用需要确认文件存在，是异步的） */
export async function buildAutoReferenceItems(
  fallback: readonly ReferenceItem[],
  source: ReferenceAutoSource | undefined,
  exists: (path: string) => Promise<boolean> = fileExists
): Promise<ReferenceItem[]> {
  const chapter = source
    ? await resolveDocumentMedia(extractDocumentMediaRefs(source.text), source.documentPath, exists)
    : [];
  const scene = source
    ? sceneVideoReferenceItems(source.files, source.workPath, source.documentPath)
    : [];
  return combineAutoItems(chapter, scene, fallback);
}

function asUserItems(items: readonly ReferenceItem[]): ReferenceItem[] {
  return items.map((item) => ({ ...item, origin: 'user', group: item.group ?? 'added' }));
}

export function useReferencePaneState() {
  const [items, setItems] = useState<ReferenceItem[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [mode, setMode] = useState<ReferencePaneMode>('closed');
  const [autoMode, setAutoMode] = useState(false);
  const autoRef = useRef<ToggleReferenceDetail | null>(null);
  const dismissedRef = useRef(new Set<string>());
  const sequenceRef = useRef(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const autoModeRef = useRef(autoMode);
  autoModeRef.current = autoMode;

  const index = Math.max(
    0,
    items.findIndex((item) => item.path === selectedPath)
  );
  const current = items.length > 0 ? items[Math.min(index, items.length - 1)] : null;

  const reset = useCallback(() => {
    sequenceRef.current += 1;
    setMode('closed');
    setAutoMode(false);
    setItems([]);
    setSelectedPath(null);
    dismissedRef.current = new Set();
  }, []);

  /** 重新计算自动内容并与当前列表合并 */
  const refreshAuto = useCallback(async () => {
    const detail = autoRef.current;
    if (!detail) return;
    const sequence = ++sequenceRef.current;
    const next = await buildAutoReferenceItems(detail.fallback ?? [], detail.source);
    if (sequence !== sequenceRef.current || !autoModeRef.current) return;
    setItems((prev) => reconcileAutoItems(prev, next, dismissedRef.current));
  }, []);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenReferenceDetail>).detail;
      if (!detail?.items?.length) return;
      const added = asUserItems(detail.items);
      const target = added[Math.max(0, Math.min(added.length - 1, detail.index ?? 0))];
      setItems((prev) => mergeReferenceItems(modeRef.current === 'closed' ? [] : prev, added));
      if (modeRef.current === 'closed') setAutoMode(false);
      setSelectedPath(target.path);
      setMode('docked');
    };
    window.addEventListener(REFERENCE_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(REFERENCE_OPEN_EVENT, onOpen);
  }, []);

  // 文件栏「参考」按钮：开着就收起；关着就以自动模式打开。
  // 文档里有媒体引用时先解析（最多等 OPEN_RESOLVE_TIMEOUT_MS），避免主画面先显示人物图再跳到本章图片
  const openingRef = useRef(false);
  useEffect(() => {
    const onToggle = (event: Event) => {
      const detail = (event as CustomEvent<ToggleReferenceDetail>).detail;
      if (modeRef.current !== 'closed' || openingRef.current) {
        openingRef.current = false;
        reset();
        return;
      }
      autoRef.current = detail ?? { fallback: [] };
      dismissedRef.current = new Set();
      setAutoMode(true);
      autoModeRef.current = true;
      const source = detail?.source;
      const initial = combineAutoItems(
        source ? sceneVideoReferenceItems(source.files, source.workPath, source.documentPath) : [],
        detail?.fallback ?? []
      );
      const show = (list: ReferenceItem[]) => {
        openingRef.current = false;
        setItems(list);
        setSelectedPath(null);
        setMode('docked');
      };
      if (!source || extractDocumentMediaRefs(source.text).length === 0) {
        show(initial);
        return;
      }
      openingRef.current = true;
      const sequence = ++sequenceRef.current;
      const timeout = new Promise<null>((resolve) =>
        window.setTimeout(() => resolve(null), OPEN_RESOLVE_TIMEOUT_MS)
      );
      void Promise.race([buildAutoReferenceItems(detail?.fallback ?? [], source), timeout]).then(
        (built) => {
          if (sequence !== sequenceRef.current || !openingRef.current) return;
          show(built ?? initial);
          // 超时：先显示已有的，解析完成后再补上本章引用
          if (!built) void refreshAuto();
        }
      );
    };
    window.addEventListener(REFERENCE_TOGGLE_EVENT, onToggle);
    return () => window.removeEventListener(REFERENCE_TOGGLE_EVENT, onToggle);
  }, [refreshAuto, reset]);

  // 自动来源变化：记下最新来源；自动模式下防抖后重新计算
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    const onSource = (event: Event) => {
      const detail = (event as CustomEvent<ToggleReferenceDetail>).detail;
      if (!detail) return;
      autoRef.current = detail;
      if (!autoModeRef.current || modeRef.current === 'closed') return;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void refreshAuto();
      }, AUTO_REFRESH_DEBOUNCE_MS);
    };
    window.addEventListener(REFERENCE_AUTO_SOURCE_EVENT, onSource);
    return () => {
      window.removeEventListener(REFERENCE_AUTO_SOURCE_EVENT, onSource);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [refreshAuto]);

  useEffect(() => {
    announceReferenceState(mode !== 'closed');
  }, [mode]);

  const step = useCallback(
    (offset: number) => {
      if (items.length === 0) return;
      const next = items[(index + offset + items.length) % items.length];
      setSelectedPath(next.path);
    },
    [index, items]
  );

  const select = useCallback(
    (target: number) => {
      const item = items[target];
      if (item) setSelectedPath(item.path);
    },
    [items]
  );

  const removeAt = useCallback(
    (target: number) => {
      const removed = items[target];
      if (!removed) return;
      if (removed.origin === 'auto') dismissedRef.current.add(removed.path);
      const remaining = items.filter((_, itemIndex) => itemIndex !== target);
      setItems(remaining);
      const nextIndex = indexAfterRemove(items.length, target);
      setSelectedPath(remaining[nextIndex]?.path ?? null);
    },
    [items]
  );

  const move = useCallback((from: number, to: number) => {
    setItems((prev) => moveReferenceItem(prev, from, to));
  }, []);

  /** 拖入的文件（资料树 / 系统文件管理器）：只收图片 / 视频，插到 at 位置（默认末尾）并选中第一个 */
  const addPaths = useCallback((paths: readonly string[], at?: number): number => {
    const added = asUserItems(
      paths
        .map((path) => referenceItemFor(path))
        .filter((item): item is ReferenceItem => item !== null)
    );
    if (added.length === 0) return 0;
    setItems((prev) => insertReferenceItems(prev, added, at ?? prev.length));
    setSelectedPath(added[0].path);
    return added.length;
  }, []);

  return {
    items,
    index,
    current,
    mode,
    setMode,
    autoMode,
    /** 最近一次的自动来源（当前文档 / 作品），插入正文时用来计算相对路径 */
    getSource: () => autoRef.current?.source ?? null,
    close: reset,
    step,
    select,
    removeAt,
    move,
    addPaths,
  };
}
