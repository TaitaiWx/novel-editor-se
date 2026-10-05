/**
 * PDF 预览：左侧缩略图 + 主画面翻页
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styles from './styles.module.scss';

type PdfJsModule = typeof import('pdfjs-dist');
type PdfLoadingTask = ReturnType<PdfJsModule['getDocument']>;
type PdfDocumentProxy = Awaited<PdfLoadingTask['promise']>;

export interface PdfDocumentViewProps {
  dataUrl: string;
}

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

        // 直接从 base64 data URL 解码为 ArrayBuffer，避免 fetch data URL
        // 在 Electron 渲染进程中可能被 CSP 拦截或因体积过大失败
        const base64Prefix = 'base64,';
        const base64Index = dataUrl.indexOf(base64Prefix);
        let buffer: ArrayBuffer;
        if (base64Index !== -1) {
          const base64Data = dataUrl.slice(base64Index + base64Prefix.length);
          const binaryStr = atob(base64Data);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          buffer = bytes.buffer;
        } else {
          const response = await fetch(dataUrl);
          buffer = await response.arrayBuffer();
        }

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

export default PdfDocumentView;
