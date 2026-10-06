/**
 * 「关于小说编辑器」紧凑展示块，由关于对话框与设置中心「关于」分区共用
 *
 * 只展示：图标 + 名称 + 版本（通道徽标）、运行时间、设备 ID（点击复制）、上传日志。
 * 运行环境、数据目录等诊断信息写进日志包，不在界面展示。
 */
import React, { useCallback } from 'react';
import { VscCloudUpload, VscLoading } from 'react-icons/vsc';
import appMarkUrl from '../../../../resources/branding/app-mark.svg';
import { RELEASE_CHANNEL_LABELS, formatRunningSummary } from '../../../shared/about';
import { useAboutInfo, writeClipboard } from '../../hooks/useAboutInfo';
import { useLogUpload } from '../../hooks/useLogUpload';
import { useNow } from '../../hooks/useNow';
import { useToast } from '../Toast';
import styles from './styles.module.scss';

/** 「本次已运行」每分钟刷新一次 */
const UPTIME_REFRESH_MS = 60_000;

interface AboutCardProps {
  /** 是否可见（变为可见时重新读取信息） */
  active: boolean;
}

const AboutCard: React.FC<AboutCardProps> = ({ active }) => {
  const toast = useToast();
  const { info, loading, error } = useAboutInfo(active);
  const upload = useLogUpload();
  const now = useNow(UPTIME_REFRESH_MS, active);

  const handleCopyDeviceId = useCallback(async () => {
    if (!info) return;
    if (await writeClipboard(info.deviceId)) {
      toast.success('设备 ID 已复制', 1600);
    } else {
      toast.error('复制失败，请手动选择文本复制');
    }
  }, [info, toast]);

  if (!info) {
    const text = error ?? (loading ? '正在读取应用信息…' : null);
    return text ? (
      <div className={`${styles.notice} ${error ? styles.noticeWarn : ''}`} role="status">
        {text}
      </div>
    ) : null;
  }

  const running = upload.phase === 'running';
  const result = upload.result;
  const statusTone =
    result?.status === 'uploaded'
      ? styles.statusOk
      : result?.status === 'failed'
        ? styles.statusWarn
        : '';

  return (
    <div className={styles.card}>
      <img className={styles.appIcon} src={appMarkUrl} alt="" aria-hidden="true" />
      <div className={styles.appName}>{info.appName}</div>
      <div className={styles.versionRow}>
        <span className={styles.version} data-testid="about-version">
          版本 {info.version}
        </span>
        <span className={`${styles.channelBadge} ${styles[`channel-${info.releaseChannel}`]}`}>
          {RELEASE_CHANNEL_LABELS[info.releaseChannel]}
        </span>
      </div>
      <div className={styles.runtime} data-testid="about-runtime">
        {formatRunningSummary(info.firstRunAt, info.startedAt, now)}
      </div>

      <div className={styles.deviceField}>
        <div className={styles.deviceLabelRow}>
          <span>设备 ID</span>
          <span className={styles.copyHint} aria-hidden="true">
            点击复制
          </span>
        </div>
        <button
          type="button"
          className={styles.deviceId}
          data-testid="about-device-id"
          title="点击复制"
          onClick={() => void handleCopyDeviceId()}
        >
          {info.deviceId}
        </button>
      </div>

      <button
        type="button"
        className={styles.primaryButton}
        onClick={() => void upload.run()}
        disabled={running}
      >
        {running ? <VscLoading className={styles.spin} /> : <VscCloudUpload />}
        <span>{running ? '正在打包日志…' : '上传日志'}</span>
      </button>

      {upload.message && (
        <div
          className={`${styles.uploadStatus} ${statusTone}`}
          role="status"
          data-testid="about-upload-status"
        >
          <div>{upload.message}</div>
          {result?.status === 'saved' && result.uploadError && (
            <div className={styles.uploadHint}>
              上传失败（{result.uploadError}），已改为本地保存
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AboutCard;
