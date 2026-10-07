import { useCallback, useEffect, useRef, useState } from 'react';
import { SCENE_STORYBOARD_JSON, storyboardToMarkdown } from '@novel-editor/video';
import { notifyWorkspaceFilesChanged } from '@/render/utils/workspaceFiles';
import { getSceneVideoSeed } from './events';
import {
  detectCharacters,
  resolveSceneSource,
  suggestLocation,
  type NamedCharacter,
} from './sceneSource';
import {
  chapterNameFromPath,
  createSceneVideoState,
  parseSceneVideoState,
  storyboardForExport,
  type SceneVideoState,
} from './sceneVideoState';

/** 作者停止编辑后多久写入 分镜.json */
export const SCENE_SAVE_DEBOUNCE_MS = 800;

export interface UseSceneVideoDocOptions {
  tabPath: string;
  workPath: string | null;
  chapterPath: string;
  scene: string;
  characters: readonly NamedCharacter[];
  loreTitles: readonly string[];
}

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/**
 * 场景视频工作区的状态：打开时读取 分镜.json（没有则用种子 / 章节正文新建），
 * 作者修改后防抖写回 分镜.json，并同时重写可读的 分镜.md（不需要手动「导出」）；
 * 目录内的成片文件列表随任务完成刷新。只打开不修改时不写任何文件。
 * 写入后目录里出现新文件时通知文件面板静默刷新，资料里随即可见。
 */
export function useSceneVideoDoc(options: UseSceneVideoDocOptions) {
  const { tabPath, workPath, chapterPath, scene } = options;
  const chapter = chapterNameFromPath(chapterPath);
  const [state, setStateRaw] = useState<SceneVideoState | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  /** 场景目录的绝对路径（主进程按作品目录解析；在资料中定位用） */
  const [dir, setDir] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState('');
  /** 已保存的分镜与这次带入的选段不同：提示作者是否替换场景正文 */
  const [pendingSeed, setPendingSeed] = useState<string | null>(null);
  const stateRef = useRef<SceneVideoState | null>(null);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 人物 / 设定只在新建时用于预填，不触发重新加载
  const prefillRef = useRef({ characters: options.characters, loreTitles: options.loreTitles });
  prefillRef.current = { characters: options.characters, loreTitles: options.loreTitles };

  const refreshFiles = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc || !workPath) return;
    const result = await ipc.invoke('video-scene-load', { workPath, chapter, scene });
    if (result.ok) {
      setFiles(result.data.files);
      setDir(result.data.dir);
    }
  }, [chapter, scene, workPath]);
  const refreshFilesRef = useRef<(() => Promise<void>) | null>(null);
  refreshFilesRef.current = refreshFiles;

  useEffect(() => {
    let cancelled = false;
    const ipc = window.electron?.ipcRenderer;
    dirtyRef.current = false;
    setLoading(true);
    setPendingSeed(null);
    const load = async () => {
      const seed = getSceneVideoSeed(tabPath);
      let loaded: SceneVideoState | null = null;
      if (ipc && workPath) {
        const result = await ipc
          .invoke('video-scene-load', { workPath, chapter, scene })
          .catch(() => null);
        if (result?.ok) {
          if (!cancelled) {
            setFiles(result.data.files);
            setDir(result.data.dir);
          }
          loaded = parseSceneVideoState(result.data.state);
        }
      }
      if (loaded) {
        if (seed && seed.sourceText.trim() && seed.sourceText.trim() !== loaded.sourceText.trim()) {
          if (!cancelled) setPendingSeed(seed.sourceText);
        }
        return { ...loaded, chapterPath };
      }
      let sourceText = seed?.sourceText ?? '';
      if (!sourceText && ipc) {
        const docText = await ipc.invoke('read-file', chapterPath).catch(() => '');
        sourceText = resolveSceneSource({ docText, sceneTitle: scene }).text;
      }
      const { characters, loreTitles } = prefillRef.current;
      return createSceneVideoState(
        {
          chapterPath,
          chapter,
          scene,
          sourceText,
          characters: detectCharacters(sourceText, characters),
          location: suggestLocation(sourceText, loreTitles),
        },
        new Date()
      );
    };
    void load().then((next) => {
      if (cancelled) return;
      stateRef.current = next;
      setStateRaw(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [chapter, chapterPath, scene, tabPath, workPath]);

  const filesRef = useRef<string[]>([]);
  filesRef.current = files;

  const persist = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    const current = stateRef.current;
    if (!ipc || !workPath || !current) return null;
    setSaveStatus('saving');
    const result = await ipc
      .invoke('video-scene-save', {
        workPath,
        chapter: current.chapter,
        scene: current.scene,
        state: current,
        markdown: storyboardToMarkdown(storyboardForExport(current)),
      })
      .catch((error: unknown) => ({
        ok: false as const,
        error: { message: error instanceof Error ? error.message : String(error) },
      }));
    if (result.ok) {
      dirtyRef.current = false;
      setSaveStatus('saved');
      setSaveError('');
      // 第一次保存会新建场景目录与分镜表：刷新文件列表，并让资料面板显示出来
      if (!filesRef.current.includes(SCENE_STORYBOARD_JSON)) {
        void refreshFilesRef.current?.();
        notifyWorkspaceFilesChanged();
      }
      return result.data;
    }
    setSaveStatus('error');
    setSaveError(result.error.message);
    return null;
  }, [workPath]);

  /** 修改状态（标记为未保存并防抖写回） */
  const updateState = useCallback(
    (updater: (prev: SceneVideoState) => SceneVideoState) => {
      const prev = stateRef.current;
      if (!prev) return;
      const next = { ...updater(prev), updatedAt: new Date().toISOString() };
      stateRef.current = next;
      setStateRaw(next);
      dirtyRef.current = true;
      setSaveStatus('pending');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void persist();
      }, SCENE_SAVE_DEBOUNCE_MS);
    },
    [persist]
  );

  // 关闭标签 / 切换场景时把未保存的修改写回
  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (dirtyRef.current) void persist();
    },
    [persist]
  );

  const applyPendingSeed = useCallback(() => {
    if (pendingSeed === null) return;
    const text = pendingSeed;
    setPendingSeed(null);
    updateState((prev) => ({ ...prev, sourceText: text }));
  }, [pendingSeed, updateState]);

  return {
    chapter,
    state,
    files,
    dir,
    loading,
    saveStatus,
    saveError,
    pendingSeed,
    updateState,
    refreshFiles,
    applyPendingSeed,
    dismissPendingSeed: () => setPendingSeed(null),
  };
}

export type SceneVideoDocApi = ReturnType<typeof useSceneVideoDoc>;
