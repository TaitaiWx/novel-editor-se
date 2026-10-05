import React from 'react';
import { VscInfo, VscSync } from 'react-icons/vsc';
import {
  UPDATE_CHANNEL_LABELS,
  describeRollout,
  type AboutUpdateChannel,
} from '../../../../shared/about';
import { useAboutInfo } from '../../../hooks/useAboutInfo';
import {
  AboutBlock,
  AboutHeader,
  AboutLinks,
  AboutNotice,
  DeviceIdBlock,
  DiagnosticsButton,
  DirectoryList,
  RuntimeTable,
} from '../../AboutContent';
import sharedStyles from '../styles.module.scss';
import styles from './styles.module.scss';

const CHANNEL_ORDER: AboutUpdateChannel[] = ['stable', 'beta', 'canary'];

const CHANNEL_HINTS: Record<AboutUpdateChannel, string> = {
  stable: '只接收经过验证的正式版本，最稳妥。',
  beta: '提前体验即将发布的新功能，偶尔会有小问题。',
  canary: '加入金丝雀计划，第一时间获得新版本，帮助我们发现问题；新版本异常时会自动回退。',
};

interface AboutSectionProps {
  /** 当前分区是否可见（切换到该分区时刷新信息） */
  active: boolean;
  onOpenChangelog?: () => void;
}

/** 设置中心「关于」分区：版本、设备 ID、更新通道、运行环境、数据目录与链接 */
const AboutSection: React.FC<AboutSectionProps> = ({ active, onOpenChangelog }) => {
  const about = useAboutInfo(active);
  const { info } = about;

  const handleCheckUpdates = () => {
    void window.electron?.ipcRenderer.invoke('update-check').catch(() => undefined);
  };

  return (
    <div className={sharedStyles.panel}>
      <h4>
        <VscInfo />
        <span>关于</span>
      </h4>
      <p>查看版本与运行环境，反馈问题时可一键复制诊断信息。</p>

      {!info && (
        <div className={styles.stack}>
          <AboutNotice
            text={about.error ?? (about.loading ? '正在读取应用信息…' : null)}
            tone={about.error ? 'warn' : 'muted'}
          />
        </div>
      )}

      {info && (
        <div className={styles.stack}>
          <div className={styles.headerCard}>
            <AboutHeader info={info} />
            <DiagnosticsButton
              copied={about.copied === 'diagnostics'}
              onCopy={() => void about.copy('diagnostics')}
            />
          </div>

          <AboutNotice text={about.notice} />

          <DeviceIdBlock
            deviceId={info.deviceId}
            copied={about.copied === 'deviceId'}
            onCopy={() => void about.copy('deviceId')}
          />

          <AboutBlock
            title="更新通道"
            actions={
              <button type="button" className={styles.textButton} onClick={handleCheckUpdates}>
                <VscSync />
                <span>检查更新</span>
              </button>
            }
          >
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
            <div className={styles.channelHint}>{CHANNEL_HINTS[info.updateChannel]}</div>
            <div className={styles.rollout}>
              <span>灰度分组</span>
              <span className={styles.rolloutValue}>{describeRollout(info.rollout)}</span>
            </div>
          </AboutBlock>

          <AboutBlock title="运行环境">
            <RuntimeTable info={info} />
          </AboutBlock>

          <AboutBlock title="数据目录">
            <DirectoryList
              directories={info.directories}
              platform={info.runtime.platform}
              onOpen={(dirPath) => void about.openDirectory(dirPath)}
            />
          </AboutBlock>

          <AboutBlock title="链接">
            <AboutLinks
              onOpenLink={(key) => void about.openLink(key)}
              onOpenChangelog={onOpenChangelog}
            />
          </AboutBlock>
        </div>
      )}
    </div>
  );
};

export default AboutSection;
