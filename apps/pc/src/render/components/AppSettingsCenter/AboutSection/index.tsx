/**
 * 设置中心「关于」分区：与其他分区同一套行式布局（layout/）（应用 / 运行时间 / 设备 ID / 诊断日志）
 *
 * 与关于小窗口是两套独立的界面，只共用读取信息、复制、上传日志的 hooks。
 * 应用行右侧提供「检查更新」（应用菜单也有）。更新通道、灰度分组、崩溃日志上传由我们决定，不对用户展示。
 */
import React, { useCallback } from 'react';
import { VscCloudUpload, VscCopy, VscInfo, VscLoading, VscSync } from 'react-icons/vsc';
import appMarkUrl from '../../../../../resources/branding/app-mark.svg';
import { RELEASE_CHANNEL_LABELS, formatRunningSummary } from '../../../../shared/about';
import { useAboutInfo, writeClipboard } from '../../../hooks/useAboutInfo';
import { useLogUpload } from '../../../hooks/useLogUpload';
import { useNow } from '../../../hooks/useNow';
import { useToast } from '../../Toast';
import { SettingsGroup, SettingsRow, SettingsSection } from '../layout';
import sharedStyles from '../styles.module.scss';
import styles from './styles.module.scss';

/** 「本次已运行」每分钟刷新一次 */
const UPTIME_REFRESH_MS = 60_000;

interface AboutSectionProps {
  /** 当前分区是否可见（切换到该分区时刷新信息） */
  active: boolean;
}

const AboutSection: React.FC<AboutSectionProps> = ({ active }) => {
  const toast = useToast();
  const { info, loading, error } = useAboutInfo(active);
  const upload = useLogUpload();
  const now = useNow(UPTIME_REFRESH_MS, active);
  const running = upload.phase === 'running';
  const result = upload.result;
  const notice = error ?? (loading ? '正在读取应用信息…' : null);

  const handleCopyDeviceId = useCallback(async () => {
    if (!info) return;
    if (await writeClipboard(info.deviceId)) {
      toast.success('设备 ID 已复制', 1600);
    } else {
      toast.error('复制失败');
    }
  }, [info, toast]);

  const handleCheckUpdates = useCallback(() => {
    void window.electron?.ipcRenderer.invoke('update-check').catch(() => undefined);
  }, []);

  const statusTone =
    result?.status === 'uploaded'
      ? styles.statusOk
      : result?.status === 'failed'
        ? styles.statusWarn
        : '';

  return (
    <SettingsSection
      icon={<VscInfo />}
      title="关于"
      description="查看版本与设备信息。遇到问题时可上传诊断日志，日志不包含作品内容。"
    >
      {info ? (
        <SettingsGroup aria-label="应用信息">
          <SettingsRow
            label={info.appName}
            leading={<img className={styles.appIcon} src={appMarkUrl} alt="" aria-hidden="true" />}
            description={
              <span className={styles.versionRow}>
                <span className={styles.version} data-testid="about-version">
                  版本 {info.version}
                </span>
                <span className={`${styles.badge} ${styles[`channel-${info.releaseChannel}`]}`}>
                  {RELEASE_CHANNEL_LABELS[info.releaseChannel]}
                </span>
              </span>
            }
          >
            <button
              type="button"
              className={`${sharedStyles.secondaryButton} ${styles.actionButton}`}
              onClick={handleCheckUpdates}
            >
              <VscSync className={styles.buttonIcon} />
              <span>检查更新</span>
            </button>
          </SettingsRow>

          <SettingsRow
            label="运行时间"
            description={
              <span data-testid="about-runtime">
                {formatRunningSummary(info.firstRunAt, info.startedAt, now)}
              </span>
            }
          />

          <SettingsRow
            label="设备 ID"
            description="用于问题排查，不包含个人信息。"
            align="start"
            extra={
              <code className={styles.deviceId} data-testid="about-device-id">
                {info.deviceId}
              </code>
            }
          >
            <button
              type="button"
              className={`${sharedStyles.secondaryButton} ${styles.actionButton}`}
              onClick={() => void handleCopyDeviceId()}
              aria-label="复制设备 ID"
            >
              <VscCopy className={styles.buttonIcon} />
              <span>复制</span>
            </button>
          </SettingsRow>

          <SettingsRow
            label="诊断日志"
            description="打包诊断信息与最近日志并上传；未配置上传服务时保存到「下载」目录。"
            align="start"
            extra={
              upload.message && (
                <div
                  className={`${styles.uploadStatus} ${statusTone}`}
                  role="status"
                  data-testid="about-upload-status"
                >
                  {upload.message}
                  {result?.status === 'saved' && result.uploadError && (
                    <span className={styles.uploadHint}>
                      （上传失败：{result.uploadError}，已改为本地保存）
                    </span>
                  )}
                </div>
              )
            }
          >
            <button
              type="button"
              className={`${sharedStyles.secondaryButton} ${styles.actionButton}`}
              onClick={() => void upload.run()}
              disabled={running}
              aria-busy={running}
            >
              {running ? (
                <VscLoading className={`${styles.buttonIcon} ${styles.spin}`} />
              ) : (
                <VscCloudUpload className={styles.buttonIcon} />
              )}
              <span>{running ? '打包中…' : '上传日志'}</span>
            </button>
          </SettingsRow>
        </SettingsGroup>
      ) : (
        notice && (
          <div
            className={`${sharedStyles.notice} ${error ? sharedStyles.noticeWarn : ''}`}
            role="status"
          >
            {notice}
          </div>
        )
      )}
    </SettingsSection>
  );
};

export default AboutSection;
