/**
 * 「关于小说编辑器」的展示块，由设置中心「关于」分区与关于对话框共用
 */
import React from 'react';
import { VscCopy, VscCheck, VscFolderOpened, VscGithub, VscBook, VscIssues } from 'react-icons/vsc';
import appMarkUrl from '../../../../resources/branding/app-mark.svg';
import {
  RELEASE_CHANNEL_LABELS,
  describeOs,
  formatAboutDate,
  type AboutDirectory,
  type AboutInfo,
  type AboutLinkKey,
} from '../../../shared/about';
import styles from './styles.module.scss';

/** 设备 ID 的用途说明 */
export const DEVICE_ID_EXPLANATION = '用于灰度更新分组与问题排查，不包含个人信息';

/** 按平台给出「在文件管理器中打开」的文案 */
export function getRevealLabel(platform: string): string {
  if (platform === 'darwin') return '在访达中打开';
  if (platform === 'win32') return '在资源管理器中打开';
  return '在文件管理器中打开';
}

interface AboutHeaderProps {
  info: AboutInfo;
  compact?: boolean;
}

/** 应用图标、名称、版本与发布通道徽标 */
export const AboutHeader: React.FC<AboutHeaderProps> = ({ info, compact = false }) => (
  <div className={`${styles.header} ${compact ? styles.headerCompact : ''}`}>
    <img className={styles.appIcon} src={appMarkUrl} alt="" aria-hidden="true" />
    <div className={styles.headerMeta}>
      <div className={styles.appName}>{info.appName}</div>
      <div className={styles.versionRow}>
        <span className={styles.version} data-testid="about-version">
          版本 {info.version}
        </span>
        <span className={`${styles.channelBadge} ${styles[`channel-${info.releaseChannel}`]}`}>
          {RELEASE_CHANNEL_LABELS[info.releaseChannel]}
        </span>
      </div>
      <div className={styles.subtle}>首次运行 {formatAboutDate(info.firstRunAt)}</div>
    </div>
  </div>
);

interface DeviceIdBlockProps {
  deviceId: string;
  copied: boolean;
  onCopy: () => void;
}

/** 完整设备 ID + 复制按钮 + 用途说明 */
export const DeviceIdBlock: React.FC<DeviceIdBlockProps> = ({ deviceId, copied, onCopy }) => (
  <AboutBlock title="设备 ID">
    <div className={styles.deviceRow}>
      <code className={styles.deviceId} data-testid="about-device-id">
        {deviceId}
      </code>
      <button
        type="button"
        className={styles.iconButton}
        onClick={onCopy}
        aria-label="复制设备 ID"
        title="复制设备 ID"
      >
        {copied ? <VscCheck /> : <VscCopy />}
        <span>{copied ? '已复制' : '复制'}</span>
      </button>
    </div>
    <div className={styles.hint}>{DEVICE_ID_EXPLANATION}</div>
  </AboutBlock>
);

/** 运行环境表 */
export const RuntimeTable: React.FC<{ info: AboutInfo }> = ({ info }) => {
  const { runtime } = info;
  const rows: Array<[string, string]> = [
    ['操作系统', describeOs(runtime)],
    ['Electron', runtime.electron],
    ['Chromium', runtime.chrome],
    ['Node.js', runtime.node],
    ['V8', runtime.v8],
    ['安装方式', runtime.isPackaged ? '安装包' : '开发模式'],
  ];
  return (
    <dl className={styles.table}>
      {rows.map(([label, value]) => (
        <div key={label} className={styles.tableRow}>
          <dt className={styles.tableLabel}>{label}</dt>
          <dd className={styles.tableValue}>{value || '未知'}</dd>
        </div>
      ))}
    </dl>
  );
};

interface DirectoryListProps {
  directories: AboutDirectory[];
  platform: string;
  onOpen: (dirPath: string) => void;
}

/** 数据目录列表，每行一个「在访达 / 资源管理器中打开」按钮 */
export const DirectoryList: React.FC<DirectoryListProps> = ({ directories, platform, onOpen }) => {
  const revealLabel = getRevealLabel(platform);
  return (
    <div className={styles.table}>
      {directories.map((dir) => (
        <div key={dir.key} className={styles.dirRow}>
          <div className={styles.dirMeta}>
            <div className={styles.dirLabel}>{dir.label}</div>
            <div className={styles.dirPath} title={dir.path}>
              {dir.path}
            </div>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => onOpen(dir.path)}
            aria-label={`${revealLabel}：${dir.label}`}
            title={revealLabel}
          >
            <VscFolderOpened />
            <span>{revealLabel}</span>
          </button>
        </div>
      ))}
    </div>
  );
};

interface AboutLinksProps {
  onOpenLink: (key: AboutLinkKey) => void;
  onOpenChangelog?: () => void;
}

/** GitHub / 更新日志 / 问题反馈 */
export const AboutLinks: React.FC<AboutLinksProps> = ({ onOpenLink, onOpenChangelog }) => (
  <div className={styles.links}>
    <button type="button" className={styles.linkButton} onClick={() => onOpenLink('repository')}>
      <VscGithub />
      <span>GitHub</span>
    </button>
    {onOpenChangelog && (
      <button type="button" className={styles.linkButton} onClick={onOpenChangelog}>
        <VscBook />
        <span>更新日志</span>
      </button>
    )}
    <button type="button" className={styles.linkButton} onClick={() => onOpenLink('issues')}>
      <VscIssues />
      <span>问题反馈</span>
    </button>
  </div>
);

interface DiagnosticsButtonProps {
  copied: boolean;
  onCopy: () => void;
}

/** 复制诊断信息（用于问题反馈） */
export const DiagnosticsButton: React.FC<DiagnosticsButtonProps> = ({ copied, onCopy }) => (
  <button type="button" className={styles.primaryButton} onClick={onCopy}>
    {copied ? <VscCheck /> : <VscCopy />}
    <span>{copied ? '已复制诊断信息' : '复制诊断信息'}</span>
  </button>
);

/** 加载 / 错误 / 提示文本 */
export const AboutNotice: React.FC<{ text: string | null; tone?: 'muted' | 'warn' }> = ({
  text,
  tone = 'warn',
}) =>
  text ? (
    <div className={`${styles.notice} ${tone === 'warn' ? styles.noticeWarn : ''}`} role="status">
      {text}
    </div>
  ) : null;

interface AboutBlockProps {
  title: string;
  /** 标题右侧的操作区 */
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/** 带标题的分组块 */
export const AboutBlock: React.FC<AboutBlockProps> = ({ title, actions, children }) => (
  <section className={styles.block}>
    <div className={styles.blockHeader}>
      <div className={styles.blockTitle}>{title}</div>
      {actions}
    </div>
    {children}
  </section>
);
