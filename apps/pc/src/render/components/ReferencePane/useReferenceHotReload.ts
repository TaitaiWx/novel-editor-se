/**
 * 参考窗格热更新：显示中的文件在磁盘上被修改（重新生成、覆盖保存、外部编辑）时重新读取。
 *
 * - 窗格打开期间每 ~2 秒查询当前显示文件的 修改时间 / 大小（get-file-info），变化即递增它的版本
 * - 资料文件变化通知（WORKSPACE_FILES_CHANGED_EVENT，场景视频 / 图集 / 文件操作后派发）时检查全部参考
 * 第一次看到某个文件只记录签名，不算变化。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { WORKSPACE_FILES_CHANGED_EVENT } from '../../utils/workspaceFiles';

export const REFERENCE_POLL_INTERVAL_MS = 2000;

interface FileInfoLike {
  size?: number;
  modified?: Date | string | number;
}

/** 文件签名：大小 + 修改时间（毫秒） */
export function fileSignature(info: FileInfoLike | null | undefined): string | null {
  if (!info) return null;
  const modified =
    info.modified instanceof Date
      ? info.modified.getTime()
      : typeof info.modified === 'string' || typeof info.modified === 'number'
        ? new Date(info.modified).getTime()
        : Number.NaN;
  return `${info.size ?? -1}:${Number.isFinite(modified) ? modified : -1}`;
}

/**
 * 对比新旧签名，返回需要递增版本的路径（第一次出现的路径只记录，不返回）。
 * known 会被就地更新。
 */
export function changedPaths(
  known: Map<string, string>,
  entries: ReadonlyArray<{ path: string; signature: string | null }>
): string[] {
  const changed: string[] = [];
  for (const { path, signature } of entries) {
    if (signature === null) continue;
    const previous = known.get(path);
    known.set(path, signature);
    if (previous !== undefined && previous !== signature) changed.push(path);
  }
  return changed;
}

async function readSignature(path: string): Promise<string | null> {
  const ipc = window.electron?.ipcRenderer;
  if (!ipc) return null;
  try {
    // 用批量接口：文件被删除时静默返回空，不在主进程日志里留错误
    const entries = (await ipc.invoke('get-file-info-batch', [path])) as Array<{
      path: string;
      info: FileInfoLike;
    }>;
    const entry = entries?.[0];
    return entry ? fileSignature(entry.info) : null;
  } catch {
    return null;
  }
}

export function useReferenceHotReload(options: {
  active: boolean;
  currentPath: string | null;
  paths: readonly string[];
}): Record<string, number> {
  const { active, currentPath, paths } = options;
  const [versions, setVersions] = useState<Record<string, number>>({});
  const knownRef = useRef(new Map<string, string>());
  const pathsRef = useRef(paths);
  pathsRef.current = paths;

  const check = useCallback(async (targets: readonly string[]) => {
    const entries = await Promise.all(
      targets.map(async (path) => ({ path, signature: await readSignature(path) }))
    );
    const changed = changedPaths(knownRef.current, entries);
    if (changed.length === 0) return;
    setVersions((prev) => {
      const next = { ...prev };
      for (const path of changed) next[path] = (next[path] ?? 0) + 1;
      return next;
    });
  }, []);

  // 当前显示的文件：立即记录签名，之后定时检查
  useEffect(() => {
    if (!active || !currentPath) return;
    void check([currentPath]);
    const timer = window.setInterval(() => void check([currentPath]), REFERENCE_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [active, check, currentPath]);

  // 新加入的参考先记录签名，之后资料变化通知时才能判断它是否被改过
  const pathsKey = paths.join('\n');
  useEffect(() => {
    if (!active || !pathsKey) return;
    const unknown = pathsKey.split('\n').filter((path) => !knownRef.current.has(path));
    if (unknown.length > 0) void check(unknown);
  }, [active, check, pathsKey]);

  // 资料变化通知：检查全部参考
  useEffect(() => {
    if (!active) return;
    const onChanged = () => void check(pathsRef.current);
    window.addEventListener(WORKSPACE_FILES_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(WORKSPACE_FILES_CHANGED_EVENT, onChanged);
  }, [active, check]);

  // 窗格关闭后清空记录，下次打开重新开始
  useEffect(() => {
    if (active) return;
    knownRef.current.clear();
  }, [active]);

  return versions;
}
