import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VscCode, VscFileMedia, VscFilePdf, VscJson, VscMarkdown, VscMusic } from 'react-icons/vsc';
import LoadingSpinner from '../LoadingSpinner';
import ErrorState from '../ErrorState';
import EmptyState from '../EmptyState';
import styles from './styles.module.scss';

type PdfJsModule = typeof import('pdfjs-dist');
type PdfLoadingTask = ReturnType<PdfJsModule['getDocument']>;
type PdfDocumentProxy = Awaited<PdfLoadingTask['promise']>;

interface BinaryReadResult {
  base64Content: string;
  byteSize: number;
  mimeType: string;
}

type ResourceKind = 'image' | 'pdf' | 'audio' | 'video' | 'binary';

interface LoadedResource {
  kind: ResourceKind;
  mimeType: string;
  byteSize: number;
  dataUrl?: string;
}

interface ResourceViewerProps {
  filePath: string | null;
  settingsComponent?: React.ReactNode;
}

interface BinaryContentViewerProps {
  filePath: string | null;
  settingsComponent?: React.ReactNode;
}

interface PdfDocumentViewProps {
  dataUrl: string;
}

const MIME_BY_EXT: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.yml': 'application/yaml',
  '.yaml': 'application/yaml',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.scss': 'text/x-scss',
  '.css': 'text/css',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

const guessMimeTypeByPath = (filePath: string | null) => {
  if (!filePath) {
    return 'application/octet-stream';
  }

  const normalizedPath = filePath.toLowerCase();
  const matchedEntry = Object.entries(MIME_BY_EXT).find(([ext]) => normalizedPath.endsWith(ext));
  return matchedEntry?.[1] ?? 'application/octet-stream';
};

const buildDataUrl = (mimeType: string, base64Content: string) =>
  `data:${mimeType};base64,${base64Content}`;

const buildTextDataUrl = (mimeType: string, content: string) =>
  `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;

const formatByteSize = (byteSize: number | null | undefined) => {
  if (!byteSize) {
    return '0 KB';
  }

  if (byteSize < 1024) {
    return `${byteSize} B`;
  }

  if (byteSize < 1024 * 1024) {
    return `${(byteSize / 1024).toFixed(1)} KB`;
  }

  return `${(byteSize / (1024 * 1024)).toFixed(2)} MB`;
};

const formatDuration = (seconds: number | null) => {
  if (seconds === null || !Number.isFinite(seconds)) {
    return '读取中';
  }

  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

const isUntitledPath = (filePath: string | null) =>
  Boolean(filePath && filePath.startsWith('__untitled__:'));

const isTextBackedPreviewMime = (mimeType: string) => mimeType === 'image/svg+xml';

export const isPreviewableResourcePath = (filePath: string | null) => {
  if (!filePath || isUntitledPath(filePath)) {
    return false;
  }

  const mimeType = guessMimeTypeByPath(filePath);
  return (
    mimeType.startsWith('image/') ||
    mimeType === 'application/pdf' ||
    mimeType.startsWith('audio/') ||
    mimeType.startsWith('video/')
  );
};

export const isTextBackedPreviewResourcePath = (filePath: string | null) =>
  isTextBackedPreviewMime(guessMimeTypeByPath(filePath));

const getResourceLabel = (mimeType: string) => {
  if (mimeType === 'application/pdf') {
    return { label: 'PDF 预览', icon: <VscFilePdf /> };
  }

  if (mimeType.startsWith('image/')) {
    return {
      label: mimeType === 'image/svg+xml' ? 'SVG 预览' : '图片预览',
      icon: <VscFileMedia />,
    };
  }

  if (mimeType.startsWith('audio/')) {
    return { label: '音频预览', icon: <VscMusic /> };
  }

  if (mimeType.startsWith('video/')) {
    return { label: '视频预览', icon: <VscFileMedia /> };
  }

  if (mimeType === 'application/json') {
    return { label: 'JSON 内容', icon: <VscJson /> };
  }

  if (mimeType === 'text/markdown') {
    return { label: 'Markdown 内容', icon: <VscMarkdown /> };
  }

  return { label: '文本内容', icon: <VscCode /> };
};

const PdfDocumentView: React.FC<PdfDocumentViewProps> = ({ dataUrl }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [mainPageDataUrl, setMainPageDataUrl] = useState<string | null>(null);
  const [thumbnailMap, setThumbnailMap] = useState<Record<number, string>>({});
  const pdfDocumentRef = useRef<PdfDocumentProxy | null>(null);

  const renderPageToDataUrl = useCallback(async (pageNumber: number, scale: number) => {
    const pdfDocument = pdfDocumentRef.current;
    if (!pdfDocument) {
      throw new Error('PDF 文档尚未加载');
    }

    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('无法创建 PDF 预览画布');
    }

    await page.render({ canvasContext: context, viewport, canvas }).promise;
    return canvas.toDataURL('image/png');
  }, []);

  useEffect(() => {
    let disposed = false;
    let loadingTask: PdfLoadingTask | null = null;

    const loadPdf = async () => {
      try {
        setLoading(true);
        setError(null);
        setThumbnailMap({});
        setMainPageDataUrl(null);
        setCurrentPage(1);

        const pdfjs = (await import('pdfjs-dist')) as PdfJsModule;
        const workerModule = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;

        const response = await fetch(dataUrl);
        const buffer = await response.arrayBuffer();
        loadingTask = pdfjs.getDocument({ data: buffer });
        const pdfDocument = await loadingTask.promise;

        if (disposed) {
          await loadingTask.destroy();
          return;
        }

        pdfDocumentRef.current = pdfDocument;
        setPageCount(pdfDocument.numPages);

        const firstPage = await renderPageToDataUrl(1, 1.35);
        if (!disposed) {
          setMainPageDataUrl(firstPage);
        }

        for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
          const thumbnail = await renderPageToDataUrl(pageNumber, 0.24);
          if (disposed) {
            break;
          }

          setThumbnailMap((prev) => ({
            ...prev,
            [pageNumber]: thumbnail,
          }));
        }
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : 'PDF 预览加载失败');
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    void loadPdf();

    return () => {
      disposed = true;
      pdfDocumentRef.current = null;
      if (loadingTask) {
        void loadingTask.destroy();
      }
    };
  }, [dataUrl, renderPageToDataUrl]);

  useEffect(() => {
    let disposed = false;
    if (!pdfDocumentRef.current) {
      return;
    }

    const updateMainPage = async () => {
      try {
        const renderedPage = await renderPageToDataUrl(currentPage, 1.35);
        if (!disposed) {
          setMainPageDataUrl(renderedPage);
        }
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : 'PDF 页面渲染失败');
        }
      }
    };

    void updateMainPage();
    return () => {
      disposed = true;
    };
  }, [currentPage, renderPageToDataUrl]);

  if (loading) {
    return <div className={styles.previewPlaceholder}>正在渲染 PDF 页面...</div>;
  }

  if (error) {
    return <div className={styles.previewPlaceholder}>PDF 预览失败: {error}</div>;
  }

  return (
    <div className={styles.pdfPreviewLayout}>
      <div className={styles.pdfSidebar}>
        {Array.from({ length: pageCount }, (_, index) => {
          const pageNumber = index + 1;
          const thumbnail = thumbnailMap[pageNumber];
          return (
            <button
              key={pageNumber}
              className={`${styles.pdfThumbButton} ${pageNumber === currentPage ? styles.pdfThumbButtonActive : ''}`}
              onClick={() => setCurrentPage(pageNumber)}
            >
              <span className={styles.pdfThumbNumber}>第 {pageNumber} 页</span>
              {thumbnail ? (
                <img className={styles.pdfThumbImage} src={thumbnail} alt={`第 ${pageNumber} 页`} />
              ) : (
                <span className={styles.pdfThumbPlaceholder}>渲染中...</span>
              )}
            </button>
          );
        })}
      </div>
      <div className={styles.pdfMainStage}>
        <div className={styles.pdfToolbar}>
          <button
            className={styles.pdfPageButton}
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
          >
            上一页
          </button>
          <span className={styles.pdfPageIndicator}>
            第 {currentPage} / {pageCount} 页
          </span>
          <button
            className={styles.pdfPageButton}
            disabled={currentPage >= pageCount}
            onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}
          >
            下一页
          </button>
        </div>
        <div className={styles.pdfCanvasStage}>
          {mainPageDataUrl ? (
            <img
              className={styles.pdfMainImage}
              src={mainPageDataUrl}
              alt={`PDF 第 ${currentPage} 页`}
            />
          ) : (
            <div className={styles.previewPlaceholder}>正在渲染当前页...</div>
          )}
        </div>
      </div>
    </div>
  );
};

const AudioPreview: React.FC<{ dataUrl: string; mimeType: string; byteSize: number }> = ({
  dataUrl,
  mimeType,
  byteSize,
}) => {
  const [duration, setDuration] = useState<number | null>(null);

  return (
    <div className={styles.mediaPanel}>
      <audio
        className={styles.audioPlayer}
        controls
        preload="metadata"
        onLoadedMetadata={(event) => {
          setDuration(
            Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : null
          );
        }}
      >
        <source src={dataUrl} type={mimeType} />
      </audio>
      <div className={styles.metaGrid}>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>类型</span>
          <span className={styles.metaValue}>{mimeType}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>大小</span>
          <span className={styles.metaValue}>{formatByteSize(byteSize)}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>时长</span>
          <span className={styles.metaValue}>{formatDuration(duration)}</span>
        </div>
      </div>
    </div>
  );
};

const VideoPreview: React.FC<{ dataUrl: string; mimeType: string; byteSize: number }> = ({
  dataUrl,
  mimeType,
  byteSize,
}) => (
  <div className={styles.mediaPanel}>
    <video className={styles.previewVideo} controls preload="metadata">
      <source src={dataUrl} type={mimeType} />
    </video>
    <div className={styles.metaGrid}>
      <div className={styles.metaItem}>
        <span className={styles.metaLabel}>类型</span>
        <span className={styles.metaValue}>{mimeType}</span>
      </div>
      <div className={styles.metaItem}>
        <span className={styles.metaLabel}>大小</span>
        <span className={styles.metaValue}>{formatByteSize(byteSize)}</span>
      </div>
    </div>
  </div>
);

const ResourceViewer: React.FC<ResourceViewerProps> = ({ filePath, settingsComponent }) => {
  const [resource, setResource] = useState<LoadedResource | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadResource = async () => {
      if (!filePath) {
        setResource(null);
        setError(null);
        return;
      }

      if (!isPreviewableResourcePath(filePath)) {
        setResource(null);
        setError('当前文件不是可预览资源');
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const mimeType = guessMimeTypeByPath(filePath);

        if (isTextBackedPreviewMime(mimeType)) {
          const content = (await window.electron.ipcRenderer.invoke(
            'read-file',
            filePath
          )) as string;
          setResource({
            kind: 'image',
            mimeType,
            byteSize: new Blob([content]).size,
            dataUrl: buildTextDataUrl(mimeType, content),
          });
          return;
        }

        const binary = (await window.electron.ipcRenderer.invoke(
          'read-file-binary',
          filePath
        )) as BinaryReadResult;

        const resolvedMimeType = binary.mimeType || mimeType;
        let kind: ResourceKind = 'binary';
        if (resolvedMimeType.startsWith('image/')) {
          kind = 'image';
        } else if (resolvedMimeType === 'application/pdf') {
          kind = 'pdf';
        } else if (resolvedMimeType.startsWith('audio/')) {
          kind = 'audio';
        } else if (resolvedMimeType.startsWith('video/')) {
          kind = 'video';
        }

        setResource({
          kind,
          mimeType: resolvedMimeType,
          byteSize: binary.byteSize,
          dataUrl: buildDataUrl(resolvedMimeType, binary.base64Content),
        });
      } catch (err) {
        setResource(null);
        setError(err instanceof Error ? err.message : '资源预览加载失败');
      } finally {
        setLoading(false);
      }
    };

    void loadResource();
  }, [filePath]);

  const fileName = filePath
    ? filePath.split('/').pop() || filePath.split('\\').pop() || filePath
    : '';
  const descriptor = useMemo(
    () => getResourceLabel(resource?.mimeType ?? guessMimeTypeByPath(filePath)),
    [filePath, resource?.mimeType]
  );

  if (!filePath) {
    return (
      <div className={styles.resourceViewer}>
        <EmptyState
          icon="🖼️"
          title="选择资源开始预览"
          description="图片、PDF、音频和视频文件会默认显示预览效果"
          variant="file"
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.resourceViewer}>
        <LoadingSpinner message="正在加载资源预览..." size="medium" />
      </div>
    );
  }

  if (error || !resource?.dataUrl) {
    return (
      <div className={styles.resourceViewer}>
        <ErrorState title="资源预览失败" message={error ?? '无法生成预览'} size="medium" />
      </div>
    );
  }

  return (
    <div className={styles.resourceViewer}>
      <div className={styles.fileHeader}>
        <div className={styles.fileInfo}>
          <span className={styles.fileName}>{fileName}</span>
          <span className={styles.languageBadge}>
            {descriptor.icon}
            <span>{descriptor.label}</span>
          </span>
          <span className={styles.fileMeta}>
            {resource.mimeType} · {formatByteSize(resource.byteSize)}
          </span>
        </div>
        <div className={styles.fileActions}>{settingsComponent}</div>
      </div>
      <div className={styles.previewContainer}>
        {resource.kind === 'image' ? (
          <img className={styles.previewImage} src={resource.dataUrl} alt={fileName} />
        ) : resource.kind === 'pdf' ? (
          <PdfDocumentView dataUrl={resource.dataUrl} />
        ) : resource.kind === 'audio' ? (
          <AudioPreview
            dataUrl={resource.dataUrl}
            mimeType={resource.mimeType}
            byteSize={resource.byteSize}
          />
        ) : resource.kind === 'video' ? (
          <VideoPreview
            dataUrl={resource.dataUrl}
            mimeType={resource.mimeType}
            byteSize={resource.byteSize}
          />
        ) : (
          <div className={styles.previewPlaceholder}>当前类型暂不支持预览</div>
        )}
      </div>
    </div>
  );
};

const BinaryContentViewer: React.FC<BinaryContentViewerProps> = ({
  filePath,
  settingsComponent,
}) => {
  const [binaryResult, setBinaryResult] = useState<BinaryReadResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadBinaryContent = async () => {
      if (!filePath) {
        setBinaryResult(null);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const result = (await window.electron.ipcRenderer.invoke(
          'read-file-binary',
          filePath
        )) as BinaryReadResult;
        setBinaryResult(result);
      } catch (err) {
        setBinaryResult(null);
        setError(err instanceof Error ? err.message : '无法读取资源内容');
      } finally {
        setLoading(false);
      }
    };

    void loadBinaryContent();
  }, [filePath]);

  const fileName = filePath
    ? filePath.split('/').pop() || filePath.split('\\').pop() || filePath
    : '';
  const dataPreview = useMemo(() => {
    if (!binaryResult) {
      return { text: '', truncated: false };
    }

    const maxLength = 64 * 1024;
    const truncated = binaryResult.base64Content.length > maxLength;
    return {
      text: truncated
        ? `${binaryResult.base64Content.slice(0, maxLength)}\n\n... 已截断，避免一次性渲染过大内容 ...`
        : binaryResult.base64Content,
      truncated,
    };
  }, [binaryResult]);

  if (!filePath) {
    return null;
  }

  if (loading) {
    return (
      <div className={styles.resourceViewer}>
        <LoadingSpinner message="正在加载资源内容..." size="medium" />
      </div>
    );
  }

  if (error || !binaryResult) {
    return (
      <div className={styles.resourceViewer}>
        <ErrorState title="资源内容加载失败" message={error ?? '无法读取内容'} size="medium" />
      </div>
    );
  }

  return (
    <div className={styles.resourceViewer}>
      <div className={styles.fileHeader}>
        <div className={styles.fileInfo}>
          <span className={styles.fileName}>{fileName}</span>
          <span className={styles.languageBadge}>
            <VscCode />
            <span>原始内容</span>
          </span>
          <span className={styles.fileMeta}>
            {binaryResult.mimeType} · {formatByteSize(binaryResult.byteSize)}
          </span>
        </div>
        <div className={styles.fileActions}>{settingsComponent}</div>
      </div>
      <div className={styles.binaryContentLayout}>
        <div className={styles.binaryMetaPanel}>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>MIME</span>
            <span className={styles.metaValue}>{binaryResult.mimeType}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>大小</span>
            <span className={styles.metaValue}>{formatByteSize(binaryResult.byteSize)}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>编码</span>
            <span className={styles.metaValue}>Base64</span>
          </div>
          <div className={styles.binaryHint}>
            二进制资源默认展示预览。切换到“展示内容”时，会显示安全截断后的原始编码文本，避免一次性渲染超大二进制字符串。
          </div>
        </div>
        <div className={styles.binaryTextPanel}>
          {dataPreview.truncated && <div className={styles.binaryNotice}>已截断显示</div>}
          <pre className={styles.binaryText}>{dataPreview.text}</pre>
        </div>
      </div>
    </div>
  );
};

export { BinaryContentViewer };
export default ResourceViewer;
