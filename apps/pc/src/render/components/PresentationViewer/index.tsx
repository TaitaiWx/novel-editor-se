import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { VscLinkExternal, VscWand } from 'react-icons/vsc';
import LoadingSpinner from '../LoadingSpinner';
import ErrorState from '../ErrorState';
import styles from './styles.module.scss';

interface SlideData {
  index: number;
  title: string;
  texts: string[];
  noteText: string;
}

interface PresentationData {
  fileName: string;
  slideCount: number;
  slides: SlideData[];
}

interface PresentationViewerProps {
  filePath: string | null;
  settingsComponent?: React.ReactNode;
}

const MAX_PREVIEW_SIZE = 10 * 1024 * 1024; // 10MB

const PresentationViewer: React.FC<PresentationViewerProps> = ({ filePath, settingsComponent }) => {
  const [data, setData] = useState<PresentationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const [fileSize, setFileSize] = useState(0);

  const loadData = useCallback(async (fp: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electron.ipcRenderer.invoke('read-pptx-data', fp);
      setData(result as PresentationData);
    } catch (err) {
      setError((err as Error).message || '读取 PPT 文件失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // 加载数据
  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setTooLarge(false);
      try {
        const info = await window.electron.ipcRenderer.invoke('get-file-info', filePath);
        if (cancelled) return;
        if (info.size > MAX_PREVIEW_SIZE) {
          setTooLarge(true);
          setFileSize(info.size);
          setLoading(false);
          return;
        }
        const result = await window.electron.ipcRenderer.invoke('read-pptx-data', filePath);
        if (!cancelled) setData(result as PresentationData);
      } catch (err) {
        if (!cancelled) setError((err as Error).message || '读取 PPT 文件失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  // 监视文件变化 → 外部编辑后自动刷新
  useEffect(() => {
    if (!filePath) return;

    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;

    ipc.invoke('watch-file', filePath);

    const handleFileChanged = (_event: unknown, changedPath: string) => {
      if (changedPath === filePath) {
        loadData(filePath);
      }
    };

    const dispose = ipc.on('file-changed', handleFileChanged);

    return () => {
      ipc.invoke('unwatch-file', filePath);
      dispose?.();
    };
  }, [filePath, loadData]);

  const handleOpenExternal = useCallback(async () => {
    if (!filePath) return;
    try {
      await window.electron.ipcRenderer.invoke('open-in-system-app', filePath);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [filePath]);

  const [beautifying, setBeautifying] = useState(false);

  const handleBeautify = useCallback(async () => {
    if (!filePath) return;
    setBeautifying(true);
    try {
      const title =
        filePath
          .replace(/\\/g, '/')
          .split('/')
          .pop()
          ?.replace(/\.\w+$/, '') || '演示文稿';
      const result = await window.electron.ipcRenderer.invoke('beautify-pptx', filePath, { title });
      const r = result as { success: boolean; filePath?: string; error?: string };
      if (r.success && r.filePath) {
        setError(null);
      } else if (r.error) {
        setError(`美化失败: ${r.error}`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBeautifying(false);
    }
  }, [filePath]);

  const slideCards = useMemo(() => {
    if (!data) return null;
    return data.slides.map((slide) => (
      <div key={slide.index} className={styles.slideCard}>
        <div className={styles.slideHeader}>
          <span className={styles.slideNumber}>{slide.index}</span>
          <span className={styles.slideTitle}>{slide.title}</span>
        </div>
        <div className={styles.slideBody}>
          {slide.texts.length > 0 && <p className={styles.slideText}>{slide.texts.join('\n')}</p>}
          {slide.noteText && (
            <div className={styles.slideNote}>
              <div className={styles.slideNoteLabel}>备注</div>
              <div className={styles.slideNoteText}>{slide.noteText}</div>
            </div>
          )}
        </div>
      </div>
    ));
  }, [data]);

  if (loading) {
    return (
      <div className={styles.container}>
        <LoadingSpinner />
      </div>
    );
  }

  if (tooLarge) {
    const sizeMB = (fileSize / 1024 / 1024).toFixed(1);
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.fileName}>{filePath?.split('/').pop() ?? ''}</span>
            <span className={styles.badge}>PPTX</span>
          </div>
          <div className={styles.headerRight}>{settingsComponent}</div>
        </div>
        <div className={styles.slidesArea}>
          <div className={styles.tooLargeHint}>
            <p>该文件较大（{sizeMB} MB），不支持内置预览</p>
            <button className={styles.openExternalBtn} onClick={handleOpenExternal}>
              <VscLinkExternal />
              用默认应用打开
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <ErrorState message={error} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className={styles.container}>
        <ErrorState message="无法读取文件数据" />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.fileName}>{data.fileName}</span>
          <span className={styles.badge}>PPTX</span>
          <span className={styles.meta}>{data.slideCount} 张幻灯片</span>
        </div>
        <div className={styles.headerRight}>
          <button
            className={styles.openExternalBtn}
            onClick={handleBeautify}
            disabled={beautifying}
            title="提取文本内容，使用统一美化主题重新生成 PPT"
          >
            <VscWand />
            {beautifying ? '美化中…' : '美化导出'}
          </button>
          <button className={styles.openExternalBtn} onClick={handleOpenExternal}>
            <VscLinkExternal />
            用默认应用打开编辑
          </button>
          {settingsComponent}
        </div>
      </div>
      <div className={styles.slidesArea}>
        <div className={styles.slidesGrid}>{slideCards}</div>
      </div>
    </div>
  );
};

/** 判断路径是否为 PPT 文件 */
export function isPresentationPath(filePath: string | null): boolean {
  if (!filePath) return false;
  const lower = filePath.toLowerCase();
  return lower.endsWith('.pptx') || lower.endsWith('.ppt');
}

export default PresentationViewer;
