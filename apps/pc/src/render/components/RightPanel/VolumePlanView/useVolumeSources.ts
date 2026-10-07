import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VolumeChapterSource, VolumeCharacterRef } from '@novel-editor/basic-algorithm';
import {
  NOVEL_EDITOR_FILE_SAVED_EVENT,
  type NovelEditorFileSavedDetail,
} from '@/render/utils/editor-events';
import { useDebounce } from '../useDebounce';
import { loadVolumeChapters, loadVolumeCharacters } from './volumeSources';
import type { VolumeTarget } from './volumePlanState';

/** 没有卷（独立窗口、未命名文档）时用当前文档作为唯一的一章 */
export const CURRENT_DOCUMENT_PATH = '__current__';

/**
 * 加载当前卷的章节、章纲与人物；当前打开的章节用编辑器里的实时内容（防抖 400ms）
 * 文件保存后只重读对应章节
 */
export function useVolumeSources({
  target,
  workPath,
  dbReady,
  content,
}: {
  target: VolumeTarget | null;
  workPath: string | null;
  dbReady: boolean;
  content: string;
}) {
  const [diskChapters, setDiskChapters] = useState<VolumeChapterSource[]>([]);
  const [characters, setCharacters] = useState<VolumeCharacterRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const volumePath = target?.volumePath ?? null;
  const activePath = target?.activePath ?? null;
  // 路径与内容一起防抖：切换章节时不会把上一章的内容套到新章节上
  const live = useDebounce(
    useMemo(() => ({ path: activePath, content }), [activePath, content]),
    400
  );
  const chapterPathsRef = useRef<Set<string>>(new Set());
  chapterPathsRef.current = new Set(diskChapters.map((chapter) => chapter.path));

  useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!volumePath || !ipc) {
      setDiskChapters([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadVolumeChapters(ipc, { volumePath, workPath, dbReady })
      .then((chapters) => {
        if (!cancelled) setDiskChapters(chapters);
      })
      .catch(() => {
        if (!cancelled) setDiskChapters([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dbReady, reloadToken, volumePath, workPath]);

  useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!workPath || !dbReady || !ipc) {
      setCharacters([]);
      return;
    }
    let cancelled = false;
    loadVolumeCharacters(ipc, workPath)
      .then((list) => {
        if (!cancelled) setCharacters(list);
      })
      .catch(() => {
        if (!cancelled) setCharacters([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dbReady, workPath]);

  // 其他章节在别处保存（或被 CLI 修改后重新保存）时只重读该章
  useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const handleSaved = (event: Event) => {
      const detail = (event as CustomEvent<NovelEditorFileSavedDetail>).detail;
      if (!detail?.filePath || detail.filePath === activePath) return;
      if (!chapterPathsRef.current.has(detail.filePath)) return;
      void ipc
        .invoke('read-file', detail.filePath)
        .then((next) =>
          setDiskChapters((current) =>
            current.map((chapter) =>
              chapter.path === detail.filePath ? { ...chapter, content: next } : chapter
            )
          )
        )
        .catch(() => undefined);
    };
    document.addEventListener(NOVEL_EDITOR_FILE_SAVED_EVENT, handleSaved);
    return () => document.removeEventListener(NOVEL_EDITOR_FILE_SAVED_EVENT, handleSaved);
  }, [activePath]);

  const chapters = useMemo<VolumeChapterSource[]>(() => {
    if (!volumePath) {
      return live.content.trim()
        ? [{ path: CURRENT_DOCUMENT_PATH, title: '当前文档', content: live.content }]
        : [];
    }
    if (!activePath || live.path !== activePath || !live.content) return diskChapters;
    return diskChapters.map((chapter) =>
      chapter.path === activePath ? { ...chapter, content: live.content } : chapter
    );
  }, [activePath, diskChapters, live, volumePath]);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  return { chapters, characters, loading, reload };
}
