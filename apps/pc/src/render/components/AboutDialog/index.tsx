/**
 * 小巧的「关于小说编辑器」窗口（应用菜单、设置菜单、状态栏版本面板均可打开）
 *
 * 只展示图标、名称、版本（通道徽标）与运行时间；设备 ID 不在界面上显示，
 * 通过「复制设备 ID」按钮获取。复制与上传日志的结果统一用 toast 反馈。
 */
import React, { useCallback, useEffect } from 'react';
import { VscCloudUpload, VscCopy, VscLoading } from 'react-icons/vsc';
import appMarkUrl from '../../../../resources/branding/app-mark.svg';
import { RELEASE_CHANNEL_LABELS, formatRunningSummary } from '../../../shared/about';
import { describeLogUploadResult } from '../../../shared/log-upload';
import { useAboutInfo, writeClipboard } from '../../hooks/useAboutInfo';
import { useLogUpload } from '../../hooks/useLogUpload';
import { useNow } from '../../hooks/useNow';
import { isImeComposing } from '../../utils/ime';
import { useToast } from '../Toast';
import Tooltip from '../Tooltip';
import styles from './styles.module.scss';

/** 「本次已运行」每分钟刷新一次 */
const UPTIME_REFRESH_MS = 60_000;
/** 含文件名的结果提示停留更久，方便看清 */
const RESULT_TOAST_MS = 6_000;

export const COPY_DEVICE_ID_TIP = '复制本机设备 ID，用于问题排查';
export const UPLOAD_LOG_TIP = '打包诊断信息与最近日志并上传，不含作品内容';

interface AboutDialogProps {
  visible: boolean;
  onClose: () => void;
}

const AboutDialog: React.FC<AboutDialogProps> = ({ visible, onClose }) => {
  const toast = useToast();
  const { info, loading, error } = useAboutInfo(visible);
  const upload = useLogUpload();
  const now = useNow(UPTIME_REFRESH_MS, visible);
  const running = upload.phase === 'running';

  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isImeComposing(event)) return;
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, onClose]);

  const handleCopyDeviceId = useCallback(async () => {
    if (!info) return;
    if (await writeClipboard(info.deviceId)) {
      toast.success('设备 ID 已复制', 1600);
    } else {
      toast.error('复制失败');
    }
  }, [info, toast]);

  const { run } = upload;
  const handleUpload = useCallback(async () => {
    const result = await run();
    if (!result) return;
    const message = describeLogUploadResult(result);
    if (result.status === 'uploaded') {
      toast.success(message, RESULT_TOAST_MS);
    } else if (result.status === 'saved') {
      const prefix = result.uploadError ? `上传失败（${result.uploadError}），` : '';
      toast.info(`${prefix}${message}`, RESULT_TOAST_MS);
    } else {
      toast.error(message, RESULT_TOAST_MS);
    }
  }, [run, toast]);

  if (!visible) return null;

  const notice = error ?? (loading ? '正在读取应用信息…' : null);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="关于小说编辑器"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          aria-label="关闭关于"
        >
          ×
        </button>

        {info ? (
          <>
            <div className={styles.hero}>
              <img className={styles.appIcon} src={appMarkUrl} alt="" aria-hidden="true" />
              <div className={styles.appName}>{info.appName}</div>
              <div className={styles.versionRow}>
                <span className={styles.version} data-testid="about-version">
                  版本 {info.version}
                </span>
                <span className={`${styles.badge} ${styles[`channel-${info.releaseChannel}`]}`}>
                  {RELEASE_CHANNEL_LABELS[info.releaseChannel]}
                </span>
              </div>
              <div className={styles.runtime} data-testid="about-runtime">
                {formatRunningSummary(info.firstRunAt, info.startedAt, now)}
              </div>
            </div>

            <div className={styles.actions}>
              <Tooltip content={COPY_DEVICE_ID_TIP}>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={() => void handleCopyDeviceId()}
                >
                  <VscCopy />
                  <span>复制设备 ID</span>
                </button>
              </Tooltip>
              <Tooltip content={UPLOAD_LOG_TIP}>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={() => void handleUpload()}
                  disabled={running}
                  aria-busy={running}
                >
                  {running ? <VscLoading className={styles.spin} /> : <VscCloudUpload />}
                  <span>{running ? '打包中…' : '上传日志'}</span>
                </button>
              </Tooltip>
            </div>
          </>
        ) : (
          notice && (
            <div className={`${styles.notice} ${error ? styles.noticeWarn : ''}`} role="status">
              {notice}
            </div>
          )
        )}
      </div>
    </div>
  );
};

export default AboutDialog;
