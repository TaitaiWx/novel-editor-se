import React, { useCallback, useEffect, useState } from 'react';
import { VscLinkExternal } from 'react-icons/vsc';
import LoadingSpinner from '../LoadingSpinner';
import ErrorState from '../ErrorState';
import styles from './styles.module.scss';

interface DocumentData {
  fileName: string;
  html: string;
  useExternal?: boolean;
}

interface DocumentViewerProps {
  filePath: string | null;
  settingsComponent?: React.ReactNode;
}

const MAX_PREVIEW_SIZE = 10 * 1024 * 1024; // 10MB

const DocumentViewer: React.FC<DocumentViewerProps> = ({ filePath, settingsComponent }) => {
  const [data, setData] = useState<DocumentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const [fileSize, setFileSize] = useState(0);

  const loadData = useCallback(async (fp: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = (await window.electron.ipcRenderer.invoke(
        'read-docx-data',
        fp
      )) as DocumentData;
      setData(result);
    } catch (err) {
      setError((err as Error).message || '读取 Word 文件失败');
    } finally {
      setLoading(false);
    }
  }, []);

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
        const result = (await window.electron.ipcRenderer.invoke(
          'read-docx-data',
          filePath
        )) as DocumentData;
        if (!cancelled) {
          setData(result);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message || '读取 Word 文件失败');
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
    await window.electron.ipcRenderer.invoke('open-in-system-app', filePath);
  }, [filePath]);

  const fileName = filePath?.replace(/\\/g, '/').split('/').pop() ?? '';
  const ext = fileName.split('.').pop()?.toUpperCase() || 'DOCX';

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
            <span className={styles.fileName}>{fileName}</span>
            <span className={styles.badge}>{ext}</span>
          </div>
          <div className={styles.headerRight}>{settingsComponent}</div>
        </div>
        <div className={styles.contentArea}>
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
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.fileName}>{fileName}</span>
            <span className={styles.badge}>{ext}</span>
          </div>
          <div className={styles.headerRight}>
            <button className={styles.openExternalBtn} onClick={handleOpenExternal}>
              <VscLinkExternal />
              用默认应用打开
            </button>
            {settingsComponent}
          </div>
        </div>
        <div className={styles.contentArea}>
          <ErrorState message={error} />
        </div>
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

  if (data.useExternal) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.fileName}>{fileName}</span>
            <span className={styles.badge}>{ext}</span>
          </div>
          <div className={styles.headerRight}>{settingsComponent}</div>
        </div>
        <div className={styles.contentArea}>
          <div className={styles.tooLargeHint}>
            <p>该文件格式不支持内置预览，请使用系统默认应用打开</p>
            <button className={styles.openExternalBtn} onClick={handleOpenExternal}>
              <VscLinkExternal />
              用默认应用打开
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.fileName}>{data.fileName}</span>
          <span className={styles.badge}>{ext}</span>
        </div>
        <div className={styles.headerRight}>
          <button className={styles.openExternalBtn} onClick={handleOpenExternal}>
            <VscLinkExternal />
            用默认应用打开编辑
          </button>
          {settingsComponent}
        </div>
      </div>
      <div className={styles.contentArea}>
        <div className={styles.docContent} dangerouslySetInnerHTML={{ __html: data.html }} />
      </div>
    </div>
  );
};

/** 判断路径是否为 Word 文档 */
export function isDocumentPath(filePath: string | null): boolean {
  if (!filePath) return false;
  const lower = filePath.toLowerCase();
  return lower.endsWith('.docx') || lower.endsWith('.doc');
}

export default DocumentViewer;
