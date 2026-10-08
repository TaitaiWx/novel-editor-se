/**
 * 一个 AI 服务的折叠面板：标题行（名称、类型、状态、默认 / 设为默认、启用开关）+ 展开后的厂商表单
 */
import React, { useId } from 'react';
import { VscChevronRight } from 'react-icons/vsc';
import type { AIProviderInfo } from '../../../types/ai-api';
import Switch from '../../Switch';
import Tooltip from '../../Tooltip';
import styles from './styles.module.scss';

export const KIND_LABELS: Record<AIProviderInfo['kind'], string> = {
  text: '文本',
  video: '视频',
  image: '图片',
  speech: '语音',
};

type PanelStatus = 'enabled' | 'configured' | 'missing';

export function panelStatus(configured: boolean, enabled: boolean): PanelStatus {
  if (!configured) return 'missing';
  return enabled ? 'enabled' : 'configured';
}

const STATUS_TEXT: Record<PanelStatus, string> = {
  enabled: '已启用',
  configured: '已配置 · 未启用',
  missing: '未配置',
};

interface ProviderPanelProps {
  info: AIProviderInfo;
  /** 标题（默认用服务名称） */
  title?: string;
  configured: boolean;
  enabled: boolean;
  expanded: boolean;
  onToggleExpanded: (expanded: boolean) => void;
  onToggleEnabled: (enabled: boolean) => void;
  /** 开关不可用时的原因（例如总开关关闭） */
  enableDisabledReason?: string;
  /** 文本服务：设为默认写作 AI；undefined 表示不显示 */
  onSetDefault?: () => void;
  children: React.ReactNode;
}

const ProviderPanel: React.FC<ProviderPanelProps> = ({
  info,
  title,
  configured,
  enabled,
  expanded,
  onToggleExpanded,
  onToggleEnabled,
  enableDisabledReason,
  onSetDefault,
  children,
}) => {
  const bodyId = useId();
  const name = title ?? info.label;
  const status = panelStatus(configured, enabled);
  const switchControl = (
    <Switch
      size="sm"
      aria-label={`启用 ${name}`}
      checked={enabled}
      disabled={Boolean(enableDisabledReason)}
      onChange={onToggleEnabled}
    />
  );

  return (
    <section
      className={`${styles.panel} ${expanded ? styles.panelOpen : ''}`}
      data-testid={`ai-provider-${info.id}`}
    >
      <div className={styles.panelHeader}>
        <button
          type="button"
          className={styles.panelToggle}
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => onToggleExpanded(!expanded)}
        >
          <VscChevronRight
            className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`}
            aria-hidden="true"
          />
          <span className={styles.panelName}>{name}</span>
          <span className={styles.kindTag}>{KIND_LABELS[info.kind] ?? info.kind}</span>
          <span className={`${styles.statusTag} ${styles[`status-${status}`]}`}>
            {STATUS_TEXT[status]}
          </span>
        </button>
        <div className={styles.panelActions}>
          {info.kind === 'text' &&
            (info.isDefaultText ? (
              <Tooltip content="续写、分镜、预演、灵感、推演等写作功能默认使用这个 AI">
                <span className={styles.defaultTag}>默认</span>
              </Tooltip>
            ) : (
              onSetDefault && (
                <Tooltip content="写作功能默认使用这个 AI">
                  <button type="button" className={styles.textButton} onClick={onSetDefault}>
                    设为默认
                  </button>
                </Tooltip>
              )
            ))}
          {enableDisabledReason ? (
            <Tooltip content={enableDisabledReason}>{switchControl}</Tooltip>
          ) : (
            switchControl
          )}
        </div>
      </div>
      {expanded && (
        <div id={bodyId} className={styles.panelBody}>
          {info.description && <p className={styles.panelDesc}>{info.description}</p>}
          {children}
        </div>
      )}
    </section>
  );
};

export default ProviderPanel;
