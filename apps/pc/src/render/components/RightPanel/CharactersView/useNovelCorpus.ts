import { useEffect, useRef, useState } from 'react';
import {
  NOVEL_EDITOR_FILE_SAVED_EVENT,
  type NovelEditorFileSavedDetail,
} from '../../../utils/editor-events';
import {
  TIMELINE_TEXT_FILE_RE,
  buildRelativeFileLabel,
  loadNovelCorpusFiles,
  type NovelCorpusFile,
} from './helpers';

/**
 * 加载并缓存整个作品目录的正文语料，用于人物经历时间线抽取。
 * 监听文件保存事件做增量刷新，读取失败时回退为整体重新加载。
 */
export function useNovelCorpus(folderPath: string | null) {
  const [novelCorpusFiles, setNovelCorpusFiles] = useState<NovelCorpusFile[]>([]);
  const [novelCorpusLoading, setNovelCorpusLoading] = useState(false);
  const [novelCorpusError, setNovelCorpusError] = useState('');
  const [novelCorpusReloadToken, setNovelCorpusReloadToken] = useState(0);
  const novelCorpusCacheRef = useRef<Map<string, NovelCorpusFile[]>>(new Map());

  useEffect(() => {
    if (!folderPath || !window.electron?.ipcRenderer) {
      setNovelCorpusFiles([]);
      setNovelCorpusLoading(false);
      setNovelCorpusError('');
      return;
    }

    const cachedCorpusFiles = novelCorpusCacheRef.current.get(folderPath);
    if (cachedCorpusFiles) {
      setNovelCorpusFiles(cachedCorpusFiles);
      setNovelCorpusLoading(false);
      setNovelCorpusError('');
      return;
    }

    let cancelled = false;
    setNovelCorpusLoading(true);
    setNovelCorpusError('');

    void loadNovelCorpusFiles(folderPath, window.electron.ipcRenderer)
      .then((files) => {
        if (cancelled) return;
        novelCorpusCacheRef.current.set(folderPath, files);
        setNovelCorpusFiles(files);
      })
      .catch((error) => {
        if (cancelled) return;
        setNovelCorpusFiles([]);
        setNovelCorpusError(error instanceof Error ? error.message : '作品语料加载失败');
      })
      .finally(() => {
        if (!cancelled) {
          setNovelCorpusLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [folderPath, novelCorpusReloadToken]);

  useEffect(() => {
    if (!folderPath || !window.electron?.ipcRenderer) return;

    let cancelled = false;
    const ipc = window.electron.ipcRenderer;
    const normalizedFolderPath = folderPath.replace(/\\/g, '/').replace(/\/+$/, '');

    const handleFileSaved = async (event: Event) => {
      const detail = (event as CustomEvent<NovelEditorFileSavedDetail>).detail;
      const normalizedFilePath = detail?.filePath?.replace(/\\/g, '/');
      if (!normalizedFilePath) return;
      if (!normalizedFilePath.startsWith(`${normalizedFolderPath}/`)) return;
      if (!TIMELINE_TEXT_FILE_RE.test(normalizedFilePath)) return;

      const cachedCorpusFiles = novelCorpusCacheRef.current.get(folderPath);
      if (!cachedCorpusFiles) {
        novelCorpusCacheRef.current.delete(folderPath);
        setNovelCorpusReloadToken((prev) => prev + 1);
        return;
      }

      try {
        const raw = await ipc.invoke('read-file', detail.filePath);
        if (cancelled) return;

        const nextItem: NovelCorpusFile = {
          path: detail.filePath,
          label: buildRelativeFileLabel(folderPath, detail.filePath),
          content: raw.trim(),
        };
        const withoutCurrent = cachedCorpusFiles.filter((item) => item.path !== detail.filePath);
        const nextCorpusFiles = nextItem.content ? [...withoutCurrent, nextItem] : withoutCurrent;
        nextCorpusFiles.sort((left, right) =>
          left.path.localeCompare(right.path, 'zh-CN', { numeric: true })
        );
        novelCorpusCacheRef.current.set(folderPath, nextCorpusFiles);
        setNovelCorpusFiles(nextCorpusFiles);
        setNovelCorpusError('');
      } catch {
        if (cancelled) return;
        novelCorpusCacheRef.current.delete(folderPath);
        setNovelCorpusReloadToken((prev) => prev + 1);
      }
    };

    document.addEventListener(NOVEL_EDITOR_FILE_SAVED_EVENT, handleFileSaved as EventListener);
    return () => {
      cancelled = true;
      document.removeEventListener(NOVEL_EDITOR_FILE_SAVED_EVENT, handleFileSaved as EventListener);
    };
  }, [folderPath]);

  return { novelCorpusFiles, novelCorpusLoading, novelCorpusError };
}
