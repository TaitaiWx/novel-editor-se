import React, { useEffect, useMemo, useState } from 'react';
import { VscCode, VscFileMedia, VscFilePdf, VscJson, VscMarkdown, VscMusic } from 'react-icons/vsc';
import LoadingSpinner from '../LoadingSpinner';
import ErrorState from '../ErrorState';
import EmptyState from '../EmptyState';
import styles from './styles.module.scss';
import { getPathBasename } from '@/render/utils/path';
import PdfDocumentView from './PdfDocumentView';
import { AudioPreview, VideoPreview } from './MediaPreview';
import {
  buildDataUrl,
  buildTextDataUrl,
  formatByteSize,
  guessMimeTypeByPath,
  isPreviewableResourcePath,
  isTextBackedPreviewMime,
  type BinaryReadResult,
  type LoadedResource,
  type ResourceKind,
} from './utils';

export { isPreviewableResourcePath, isTextBackedPreviewResourcePath } from './utils';

interface ResourceViewerProps {
  filePath: string | null;
  settingsComponent?: React.ReactNode;
}

interface BinaryContentViewerProps {
  filePath: string | null;
  settingsComponent?: React.ReactNode;
}

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

const ResourceViewer: React.FC<ResourceViewerProps> = ({ filePath, settingsComponent }) => {
  const [resource, setResource] = useState<LoadedResource | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 快速切换文件时忽略旧请求的结果，避免旧文件内容覆盖新文件
    let cancelled = false;
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
          if (cancelled) return;
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
        if (cancelled) return;

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
        if (cancelled) return;
        setResource(null);
        setError(err instanceof Error ? err.message : '资源预览加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadResource();
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const fileName = filePath ? getPathBasename(filePath) : '';
  const descriptor = useMemo(
    () => getResourceLabel(resource?.mimeType ?? guessMimeTypeByPath(filePath)),
    [filePath, resource?.mimeType]
  );

  if (!filePath) {
    return (
      <div className={styles.resourceViewer}>
        <EmptyState
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
    // 快速切换文件时忽略旧请求的结果
    let cancelled = false;
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
        if (cancelled) return;
        setBinaryResult(result);
      } catch (err) {
        if (cancelled) return;
        setBinaryResult(null);
        setError(err instanceof Error ? err.message : '无法读取资源内容');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadBinaryContent();
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const fileName = filePath ? getPathBasename(filePath) : '';
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
