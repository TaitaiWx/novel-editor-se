/**
 * PreviewPanel — 版本预览面板（图片/PDF/音频/视频/二进制的快照与当前文件对比）
 */
import React from 'react';
import AudioPreviewCard from '../AudioPreviewCard';
import VideoPreviewCard from '../VideoPreviewCard';
import PdfPreviewContent from '../PdfPreviewContent';
import type { PreviewState } from '../types';
import { formatByteSize } from '../utils';
import styles from './styles.module.scss';

export interface PreviewPanelProps {
  previewState: PreviewState;
  /** 是否显示「恢复当前文件」按钮（存在当前文件时） */
  canRestore: boolean;
  pdfComparePage: number;
  onPdfPageChange: (page: number) => void;
  onRestore: (e: React.MouseEvent) => void;
  onClose: () => void;
}

const PreviewPanel: React.FC<PreviewPanelProps> = ({
  previewState,
  canRestore,
  pdfComparePage,
  onPdfPageChange,
  onRestore,
  onClose,
}) => {
  return (
    <div className={styles.previewPanel}>
      <div className={styles.previewHeader}>
        <div>
          <div className={styles.previewTitle}>版本预览</div>
          <div className={styles.previewMeta}>
            {previewState.snapshotMessage} · {previewState.mimeType} ·{' '}
            {formatByteSize(previewState.byteSize)}
          </div>
        </div>
        <div className={styles.previewActions}>
          {canRestore && (
            <button className={styles.previewActionButton} onClick={onRestore}>
              恢复当前文件
            </button>
          )}
          <button className={styles.previewCloseButton} onClick={onClose}>
            关闭预览
          </button>
        </div>
      </div>
      <div className={styles.previewBody}>
        {previewState.kind === 'image' ? (
          <div className={styles.imageCompareLayout}>
            <div className={styles.imageComparePane}>
              <div className={styles.imageCompareLabel}>版本快照</div>
              <img
                className={styles.previewImage}
                src={previewState.dataUrl}
                alt={previewState.snapshotMessage}
              />
              <div className={styles.imageCompareMeta}>
                {previewState.mimeType} · {formatByteSize(previewState.byteSize)}
              </div>
            </div>
            <div className={styles.imageComparePane}>
              <div className={styles.imageCompareLabel}>当前文件</div>
              {previewState.currentDataUrl ? (
                <>
                  <img
                    className={styles.previewImage}
                    src={previewState.currentDataUrl}
                    alt="当前文件"
                  />
                  <div className={styles.imageCompareMeta}>
                    {previewState.currentMimeType} · {formatByteSize(previewState.currentByteSize)}
                  </div>
                </>
              ) : (
                <div className={styles.previewPlaceholder}>当前文件暂时无法读取</div>
              )}
            </div>
          </div>
        ) : previewState.kind === 'pdf' ? (
          <div className={styles.pdfCompareLayout}>
            <div className={styles.pdfComparePane}>
              <div className={styles.imageCompareLabel}>版本快照</div>
              <div className={styles.imageCompareMeta}>
                {previewState.mimeType} · {formatByteSize(previewState.byteSize)}
              </div>
              <PdfPreviewContent
                dataUrl={previewState.dataUrl ?? ''}
                currentPage={pdfComparePage}
                onPageChange={onPdfPageChange}
              />
            </div>
            <div className={styles.pdfComparePane}>
              <div className={styles.imageCompareLabel}>当前文件</div>
              {previewState.currentDataUrl ? (
                <>
                  <div className={styles.imageCompareMeta}>
                    {previewState.currentMimeType} · {formatByteSize(previewState.currentByteSize)}
                  </div>
                  <PdfPreviewContent
                    dataUrl={previewState.currentDataUrl}
                    currentPage={pdfComparePage}
                    onPageChange={onPdfPageChange}
                  />
                </>
              ) : (
                <div className={styles.previewPlaceholder}>当前文件暂时无法读取</div>
              )}
            </div>
          </div>
        ) : previewState.kind === 'audio' ? (
          <div className={styles.audioCompareLayout}>
            <AudioPreviewCard
              title="版本快照"
              dataUrl={previewState.dataUrl}
              mimeType={previewState.mimeType}
              byteSize={previewState.byteSize}
              emptyText="当前快照音频无法加载"
            />
            <AudioPreviewCard
              title="当前文件"
              dataUrl={previewState.currentDataUrl}
              mimeType={previewState.currentMimeType}
              byteSize={previewState.currentByteSize}
              emptyText="当前文件暂时无法读取"
            />
          </div>
        ) : previewState.kind === 'video' ? (
          <div className={styles.videoCompareLayout}>
            <VideoPreviewCard
              title="版本快照"
              dataUrl={previewState.dataUrl}
              mimeType={previewState.mimeType}
              byteSize={previewState.byteSize}
              emptyText="当前快照视频无法加载"
            />
            <VideoPreviewCard
              title="当前文件"
              dataUrl={previewState.currentDataUrl}
              mimeType={previewState.currentMimeType}
              byteSize={previewState.currentByteSize}
              emptyText="当前文件暂时无法读取"
            />
          </div>
        ) : (
          <div className={styles.binaryInfoLayout}>
            <div className={styles.binaryInfoCard}>
              <div className={styles.binaryInfoTitle}>版本快照</div>
              <div className={styles.binaryInfoRow}>
                <span className={styles.binaryInfoLabel}>MIME</span>
                <span className={styles.binaryInfoValue}>{previewState.mimeType}</span>
              </div>
              <div className={styles.binaryInfoRow}>
                <span className={styles.binaryInfoLabel}>大小</span>
                <span className={styles.binaryInfoValue}>
                  {formatByteSize(previewState.byteSize)}
                </span>
              </div>
              <div className={styles.binaryInfoHint}>
                当前类型暂不适合做结构化内容预览，但已经保留了专用元信息对比。
              </div>
            </div>
            <div className={styles.binaryInfoCard}>
              <div className={styles.binaryInfoTitle}>当前文件</div>
              <div className={styles.binaryInfoRow}>
                <span className={styles.binaryInfoLabel}>MIME</span>
                <span className={styles.binaryInfoValue}>
                  {previewState.currentMimeType ?? '无法读取'}
                </span>
              </div>
              <div className={styles.binaryInfoRow}>
                <span className={styles.binaryInfoLabel}>大小</span>
                <span className={styles.binaryInfoValue}>
                  {formatByteSize(previewState.currentByteSize)}
                </span>
              </div>
              <div className={styles.binaryInfoHint}>
                可先恢复到目标版本，或使用系统关联应用进一步检查差异。
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PreviewPanel;
