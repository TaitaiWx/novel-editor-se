/**
 * PdfPreviewContent — PDF 版本预览（缩略图侧栏 + 主页面渲染）
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { PdfDocumentProxy, PdfJsModule, PdfLoadingTask } from '../types';
import styles from './styles.module.scss';

export interface PdfPreviewContentProps {
  dataUrl: string;
  currentPage: number;
  onPageChange: (page: number) => void;
}

const PdfPreviewContent: React.FC<PdfPreviewContentProps> = ({
  dataUrl,
  currentPage,
  onPageChange,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [mainPageDataUrl, setMainPageDataUrl] = useState<string | null>(null);
  const [thumbnailMap, setThumbnailMap] = useState<Record<number, string>>({});
  const pdfDocumentRef = useRef<PdfDocumentProxy | null>(null);
  const safeCurrentPage = pageCount > 0 ? Math.min(Math.max(currentPage, 1), pageCount) : 1;

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
    if (!pdfDocumentRef.current) return;

    const updateMainPage = async () => {
      try {
        const renderedPage = await renderPageToDataUrl(safeCurrentPage, 1.35);
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
  }, [renderPageToDataUrl, safeCurrentPage]);

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
              className={`${styles.pdfThumbButton} ${pageNumber === safeCurrentPage ? styles.pdfThumbButtonActive : ''}`}
              onClick={() => onPageChange(pageNumber)}
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
            disabled={safeCurrentPage <= 1}
            onClick={() => onPageChange(Math.max(1, safeCurrentPage - 1))}
          >
            上一页
          </button>
          <span className={styles.pdfPageIndicator}>
            第 {safeCurrentPage} / {pageCount} 页
          </span>
          <button
            className={styles.pdfPageButton}
            disabled={safeCurrentPage >= pageCount}
            onClick={() => onPageChange(Math.min(pageCount, safeCurrentPage + 1))}
          >
            下一页
          </button>
        </div>
        <div className={styles.pdfCanvasStage}>
          {mainPageDataUrl ? (
            <img
              className={styles.pdfMainImage}
              src={mainPageDataUrl}
              alt={`PDF 第 ${safeCurrentPage} 页`}
            />
          ) : (
            <div className={styles.previewPlaceholder}>正在渲染当前页...</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PdfPreviewContent;
