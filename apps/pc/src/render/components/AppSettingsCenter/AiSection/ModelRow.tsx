/**
 * 模型列表的一行：显示名称、服务商 · 模型、状态；默认标记 /「设为默认」、测试连接、编辑（就地展开）、删除、启用开关
 */
import React, { useId, useState } from 'react';
import { VscEdit, VscTrash } from 'react-icons/vsc';
import type { AIIpcResult, AIProviderInfo, AIProviderUpdate } from '../../../types/ai-api';
import Switch from '../../Switch';
import Tooltip from '../../Tooltip';
import ModelEditForm from './ModelEditForm';
import styles from './styles.module.scss';

type RowStatus = 'enabled' | 'configured' | 'missing';

export function rowStatus(info: Pick<AIProviderInfo, 'configured' | 'enabled'>): RowStatus {
  if (!info.configured) return 'missing';
  return info.enabled ? 'enabled' : 'configured';
}

const STATUS_TEXT: Record<RowStatus, string> = {
  enabled: '已配置',
  configured: '已配置 · 已停用',
  missing: '未配置',
};

const DEFAULT_HINTS: Record<AIProviderInfo['kind'], string> = {
  text: '续写、分镜、预演、灵感、推演等写作功能默认使用这个模型',
  image: '人物形象、设定图与首帧默认使用这个模型',
  video: '场景视频默认使用这个模型',
  speech: '对白配音默认使用这个模型',
};

interface ModelRowProps {
  info: AIProviderInfo;
  expanded: boolean;
  onToggleExpanded: () => void;
  onUpdate: (patch: AIProviderUpdate) => Promise<AIIpcResult<AIProviderInfo> | null>;
  onSetDefault: () => void;
  onTest: () => Promise<AIIpcResult<{ latencyMs: number }> | null>;
  onRemove: () => void;
  onKeyChanged: () => void;
}

type TestStatus = { tone: 'ok' | 'error' | 'muted'; text: string } | null;

const ModelRow: React.FC<ModelRowProps> = ({
  info,
  expanded,
  onToggleExpanded,
  onUpdate,
  onSetDefault,
  onTest,
  onRemove,
  onKeyChanged,
}) => {
  const bodyId = useId();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>(null);
  const status = rowStatus(info);

  const test = async () => {
    setTesting(true);
    setTestStatus({ tone: 'muted', text: '正在测试连接…' });
    try {
      const result = await onTest();
      if (!result) return setTestStatus(null);
      setTestStatus(
        result.ok
          ? { tone: 'ok', text: `连接成功（${result.data.latencyMs} ms）` }
          : { tone: 'error', text: `连接失败：${result.error.message}` }
      );
    } finally {
      setTesting(false);
    }
  };

  return (
    <section
      className={`${styles.panel} ${expanded ? styles.panelOpen : ''}`}
      aria-label={info.label}
      data-testid={`ai-model-${info.id}`}
    >
      <div className={styles.rowHeader}>
        <div className={styles.rowMain}>
          <div className={styles.rowTitleLine}>
            <span className={styles.panelName}>{info.label}</span>
            <span className={`${styles.statusTag} ${styles[`status-${status}`]}`}>
              {STATUS_TEXT[status]}
            </span>
            {info.isDefault && (
              <Tooltip content={DEFAULT_HINTS[info.kind]}>
                <span className={styles.defaultTag}>默认</span>
              </Tooltip>
            )}
          </div>
          <div className={styles.rowMeta}>
            <span>{info.providerLabel}</span>
            {info.model && (
              <>
                <span aria-hidden="true">·</span>
                <span className={styles.rowModel}>{info.model}</span>
              </>
            )}
          </div>
        </div>
        <div className={styles.panelActions}>
          {!info.isDefault && (
            <Tooltip content={DEFAULT_HINTS[info.kind]}>
              <button type="button" className={styles.textButton} onClick={onSetDefault}>
                设为默认
              </button>
            </Tooltip>
          )}
          <Tooltip content={info.configured ? '用已保存的 Key 测试连接' : '先填写并保存 API Key'}>
            <button
              type="button"
              className={styles.textButton}
              disabled={testing || !info.configured}
              onClick={() => void test()}
            >
              测试连接
            </button>
          </Tooltip>
          <Tooltip content={expanded ? '收起' : '编辑'}>
            <button
              type="button"
              className={`${styles.iconButton} ${expanded ? styles.iconButtonActive : ''}`}
              aria-label={`编辑 ${info.label}`}
              aria-expanded={expanded}
              aria-controls={bodyId}
              onClick={onToggleExpanded}
            >
              <VscEdit aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip content="删除（Key 一起删除）">
            <button
              type="button"
              className={styles.iconButton}
              aria-label={`删除 ${info.label}`}
              onClick={() => setConfirmingRemove(true)}
            >
              <VscTrash aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip content={info.enabled ? '停用这个模型' : '启用这个模型'}>
            <Switch
              size="sm"
              aria-label={`启用 ${info.label}`}
              checked={info.enabled}
              onChange={(next) => void onUpdate({ enabled: next })}
            />
          </Tooltip>
        </div>
      </div>
      {(testStatus || confirmingRemove) && (
        <div className={styles.rowNotice}>
          {confirmingRemove ? (
            <>
              <span className={styles.statusMuted}>
                删除「{info.label}」？Key 与配置会一起删除。
              </span>
              <div className={styles.footerButtons}>
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={() => setConfirmingRemove(false)}
                >
                  取消
                </button>
                <button type="button" className={styles.dangerButton} onClick={onRemove}>
                  确认删除
                </button>
              </div>
            </>
          ) : (
            testStatus && (
              <span
                role="status"
                className={
                  testStatus.tone === 'ok'
                    ? styles.statusOk
                    : testStatus.tone === 'error'
                      ? styles.statusError
                      : styles.statusMuted
                }
              >
                {testStatus.text}
              </span>
            )
          )}
        </div>
      )}
      {expanded && (
        <div id={bodyId} className={styles.panelBody}>
          <ModelEditForm info={info} onUpdate={onUpdate} onKeyChanged={onKeyChanged} />
        </div>
      )}
    </section>
  );
};

export default ModelRow;
