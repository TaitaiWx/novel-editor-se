/**
 * 设置中心「通用」→「更新与诊断」分组：更新通道（正式 / 测试 / 金丝雀）、检查更新、
 * 崩溃时自动上传日志开关（原先位于「关于」分区，关于页精简后移到这里）
 */
import React from 'react';
import { VscSync } from 'react-icons/vsc';
import {
  UPDATE_CHANNEL_LABELS,
  describeRollout,
  type AboutUpdateChannel,
} from '../../../../shared/about';
import { useAboutInfo } from '../../../hooks/useAboutInfo';
import { useLogUploadSettings } from '../../../hooks/useLogUploadSettings';
import sharedStyles from '../styles.module.scss';
import styles from './styles.module.scss';

const CHANNEL_ORDER: AboutUpdateChannel[] = ['stable', 'beta', 'canary'];

export const CHANNEL_HINTS: Record<AboutUpdateChannel, string> = {
  stable: '只接收经过验证的正式版本，最稳妥。',
  beta: '提前体验即将发布的新功能，偶尔会有小问题。',
  canary: '加入金丝雀计划，第一时间获得新版本，帮助我们发现问题；新版本异常时会自动回退。',
};

const UpdateGroup: React.FC = () => {
  const about = useAboutInfo(true);
  const { info } = about;
  const logUpload = useLogUploadSettings();
  const autoUpload = logUpload.settings?.autoUploadOnCrash ?? true;

  const handleCheckUpdates = () => {
    void window.electron?.ipcRenderer.invoke('update-check').catch(() => undefined);
  };

  return (
    <>
      <div className={styles.groupTitle}>更新与诊断</div>
      <div className={`${sharedStyles.formSection} ${styles.section}`}>
        <div className={styles.channelBlock}>
          <div className={styles.channelHeader}>
            <div className={sharedStyles.formLabel}>更新通道</div>
            <button type="button" className={styles.textButton} onClick={handleCheckUpdates}>
              <VscSync />
              <span>检查更新</span>
            </button>
          </div>
          {info ? (
            <>
              <div className={styles.channelControl} role="radiogroup" aria-label="更新通道">
                {CHANNEL_ORDER.map((channel) => (
                  <button
                    key={channel}
                    type="button"
                    role="radio"
                    aria-checked={info.updateChannel === channel}
                    disabled={about.channelSaving}
                    className={`${styles.channelButton} ${info.updateChannel === channel ? styles.channelActive : ''}`}
                    onClick={() => {
                      if (channel !== info.updateChannel) void about.setUpdateChannel(channel);
                    }}
                  >
                    {UPDATE_CHANNEL_LABELS[channel]}
                  </button>
                ))}
              </div>
              <div className={sharedStyles.formDesc}>{CHANNEL_HINTS[info.updateChannel]}</div>
              <div className={styles.rollout}>
                <span>灰度分组</span>
                <span className={styles.rolloutValue}>{describeRollout(info.rollout)}</span>
              </div>
            </>
          ) : (
            <div className={sharedStyles.formDesc}>
              {about.error ?? (about.loading ? '正在读取更新信息…' : '')}
            </div>
          )}
          {about.notice && <div className={styles.warn}>{about.notice}</div>}
        </div>

        <div className={sharedStyles.formRow}>
          <div className={sharedStyles.formMeta}>
            <div className={sharedStyles.formLabel}>崩溃时自动上传日志</div>
            <div className={sharedStyles.formDesc}>
              应用崩溃或出现未捕获异常时自动打包日志，帮助我们定位问题；不包含作品内容。
              {logUpload.settings && !logUpload.settings.endpointConfigured
                ? '当前未配置上传服务，崩溃日志只保存在本机。'
                : ''}
            </div>
            {logUpload.error && <div className={styles.warn}>{logUpload.error}</div>}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoUpload}
            aria-label="崩溃时自动上传日志"
            disabled={!logUpload.settings || logUpload.saving}
            className={`${sharedStyles.switchButton} ${autoUpload ? sharedStyles.enabled : ''}`}
            onClick={() => void logUpload.setAutoUploadOnCrash(!autoUpload)}
          >
            <span className={sharedStyles.switchThumb} />
          </button>
        </div>
      </div>
    </>
  );
};

export default UpdateGroup;
