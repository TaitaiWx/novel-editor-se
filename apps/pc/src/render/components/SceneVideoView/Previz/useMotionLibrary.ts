/**
 * 预演可用的动作片段：内置动作（代码生成）+ 作品动作库（<作品>/资料/动作库/*.bvh，经 motion-library-* IPC 读取）。
 * 每个 BVH 在渲染进程解析并重定向到木偶（@novel-editor/video retargetBvh），无法解析的文件列出错误原因、不参与预演。
 * 导入：选择 .bvh → 读成文本 → motion-library-import 复制到动作库 → 重新加载。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BUILTIN_MOTIONS,
  createMotionLibrary,
  motionClipFromBvh,
  type MotionClip,
  type MotionLibrary,
} from '@novel-editor/video';

export interface MotionClipEntry {
  id: string;
  label: string;
  source: MotionClip['source'];
  durationSec?: number;
  loop?: boolean;
  description?: string;
  /** 无法解析 / 重定向时的原因（不参与预演） */
  error?: string;
}

export interface MotionLibraryApi {
  clips: MotionLibrary;
  entries: MotionClipEntry[];
  loading: boolean;
  importing: boolean;
  error: string;
  /** 等到当前这次加载完成（生成预演前调用，保证 AI 看到完整的动作列表） */
  whenReady: () => Promise<void>;
  /** 最近一次加载的结果（不等重新渲染，生成预演时使用） */
  snapshot: () => { clips: MotionLibrary; entries: MotionClipEntry[] };
  reload: () => Promise<void>;
  importFile: (file: File) => Promise<void>;
  /** 保存一段 BVH 文本到动作库（动作生成服务的结果），返回片段 id */
  saveBvh: (fileName: string, data: string) => Promise<string>;
}

const BUILTIN_ENTRIES: MotionClipEntry[] = BUILTIN_MOTIONS.map((item) => ({
  id: item.id,
  label: item.label,
  source: 'builtin',
  durationSec: item.durationSec,
  loop: item.loop,
  description: item.description,
}));

export function useMotionLibrary(workPath: string | null | undefined): MotionLibraryApi {
  const [clips, setClips] = useState<MotionLibrary>(() => createMotionLibrary());
  const [files, setFiles] = useState<MotionClipEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef<{ clips: MotionLibrary; entries: MotionClipEntry[] }>({
    clips,
    entries: BUILTIN_ENTRIES,
  });
  const publish = useCallback((next: MotionLibrary, entries: MotionClipEntry[]) => {
    latest.current = { clips: next, entries: [...BUILTIN_ENTRIES, ...entries] };
    setClips(next);
    setFiles(entries);
  }, []);

  const load = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc || !workPath) {
      publish(createMotionLibrary(), []);
      return;
    }
    setLoading(true);
    try {
      const list = await ipc.invoke('motion-library-list', { workPath });
      if (!list.ok) throw new Error(list.error.message);
      const loaded: MotionClip[] = [];
      const entries: MotionClipEntry[] = [];
      for (const file of list.data.files) {
        const read = await ipc.invoke('motion-library-read', { workPath, fileName: file.fileName });
        const label = file.fileName.replace(/\.bvh$/i, '');
        if (!read.ok) {
          entries.push({ id: file.clipId, label, source: 'library', error: read.error.message });
          continue;
        }
        try {
          const clip = motionClipFromBvh(file.fileName, read.data);
          loaded.push(clip);
          entries.push({
            id: clip.id,
            label,
            source: 'library',
            durationSec: clip.durationSec,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          entries.push({ id: file.clipId, label, source: 'library', error: message });
        }
      }
      publish(createMotionLibrary(loaded), entries);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [publish, workPath]);

  const reload = useCallback(() => {
    const task = pending.current.then(load, load);
    pending.current = task;
    return task;
  }, [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const saveBvh = useCallback(
    async (fileName: string, data: string) => {
      const ipc = window.electron?.ipcRenderer;
      if (!ipc || !workPath) throw new Error('没有打开作品，无法保存到动作库');
      const result = await ipc.invoke('motion-library-import', { workPath, fileName, data });
      if (!result.ok) throw new Error(result.error.message);
      await reload();
      return result.data.clipId;
    },
    [reload, workPath]
  );

  const importFile = useCallback(
    async (file: File) => {
      setImporting(true);
      setError('');
      try {
        await saveBvh(file.name, await file.text());
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setImporting(false);
      }
    },
    [saveBvh]
  );

  const whenReady = useCallback(() => pending.current, []);
  const snapshot = useCallback(() => latest.current, []);
  const entries = useMemo(() => [...BUILTIN_ENTRIES, ...files], [files]);
  return {
    clips,
    entries,
    loading,
    importing,
    error,
    whenReady,
    snapshot,
    reload,
    importFile,
    saveBvh,
  };
}
