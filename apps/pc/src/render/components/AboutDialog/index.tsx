import React, { useEffect } from 'react';
import { UPDATE_CHANNEL_LABELS, describeRollout } from '../../../shared/about';
import { useAboutInfo } from '../../hooks/useAboutInfo';
import { isImeComposing } from '../../utils/ime';
import {
  AboutBlock,
  AboutHeader,
  AboutLinks,
  AboutNotice,
  DeviceIdBlock,
  DiagnosticsButton,
  DirectoryList,
  RuntimeTable,
} from '../AboutContent';
import styles from './styles.module.scss';

interface AboutDialogProps {
  visible: boolean;
  onClose: () => void;
  /** 打开「更新日志」标签 */
  onOpenChangelog?: () => void;
  /** 打开设置中心的更新通道设置 */
  onOpenUpdateSettings?: () => void;
}

/** 紧凑的「关于小说编辑器」对话框（应用菜单、帮助菜单、状态栏版本面板均可打开） */
const AboutDialog: React.FC<AboutDialogProps> = ({
  visible,
  onClose,
  onOpenChangelog,
  onOpenUpdateSettings,
}) => {
  const about = useAboutInfo(visible);
  const { info } = about;

  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isImeComposing(event)) return;
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="关于小说编辑器"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <h3>关于小说编辑器</h3>
          <button className={styles.closeButton} onClick={onClose} aria-label="关闭关于">
            ×
          </button>
        </div>

        <div className={styles.body}>
          {!info && (
            <AboutNotice
              text={about.error ?? (about.loading ? '正在读取应用信息…' : null)}
              tone={about.error ? 'warn' : 'muted'}
            />
          )}

          {info && (
            <>
              <AboutHeader info={info} compact />
              <AboutNotice text={about.notice} />
              <DeviceIdBlock
                deviceId={info.deviceId}
                copied={about.copied === 'deviceId'}
                onCopy={() => void about.copy('deviceId')}
              />

              <AboutBlock
                title="更新"
                actions={
                  onOpenUpdateSettings && (
                    <button
                      type="button"
                      className={styles.textButton}
                      onClick={() => {
                        onClose();
                        onOpenUpdateSettings();
                      }}
                    >
                      更新设置…
                    </button>
                  )
                }
              >
                <dl className={styles.summary}>
                  <div className={styles.summaryRow}>
                    <dt>更新通道</dt>
                    <dd>{UPDATE_CHANNEL_LABELS[info.updateChannel]}</dd>
                  </div>
                  <div className={styles.summaryRow}>
                    <dt>金丝雀计划</dt>
                    <dd>{info.rollout.canaryEnrolled ? '已加入' : '未加入'}</dd>
                  </div>
                  <div className={styles.summaryRow}>
                    <dt>灰度分组</dt>
                    <dd>{describeRollout(info.rollout)}</dd>
                  </div>
                </dl>
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
            </>
          )}
        </div>

        {info && (
          <div className={styles.footer}>
            <AboutLinks
              onOpenLink={(key) => void about.openLink(key)}
              onOpenChangelog={
                onOpenChangelog
                  ? () => {
                      onClose();
                      onOpenChangelog();
                    }
                  : undefined
              }
            />
            <DiagnosticsButton
              copied={about.copied === 'diagnostics'}
              onCopy={() => void about.copy('diagnostics')}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default AboutDialog;
