import React, { useState } from 'react';
import type { AIIpcResult, AIProviderInfo } from '../../../types/ai-api';
import sharedStyles from '../styles.module.scss';
import styles from './styles.module.scss';

interface ApiKeyFieldProps {
  providerId: string;
  /** 安全存储中是否已有 Key（主进程只告诉我们这一点，永远拿不到明文） */
  configured: boolean;
  /** 系统钥匙串是否可用（false 时提示以受限权限文件保存） */
  secureStorage?: boolean;
  placeholder?: string;
  onConfiguredChange: (configured: boolean) => void;
}

type Status = { tone: 'ok' | 'error' | 'muted'; text: string } | null;

function errorText(result: AIIpcResult<unknown>): string {
  return result.ok ? '' : result.error.message;
}

/**
 * 只写的 API Key 输入：保存后清空输入框，只显示「已安全保存」；支持清除（测试连接在模型行的标题栏）。
 * Key 通过 ai-models-update 交给主进程用 safeStorage 加密保存。
 */
const ApiKeyField: React.FC<ApiKeyFieldProps> = ({
  providerId,
  configured,
  secureStorage = true,
  placeholder = 'sk-...',
  onConfiguredChange,
}) => {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const ipc = window.electron?.ipcRenderer;

  const save = async () => {
    if (!ipc || !draft.trim()) return;
    setBusy(true);
    try {
      const result = (await ipc.invoke('ai-models-update', providerId, {
        apiKey: draft,
      })) as AIIpcResult<AIProviderInfo>;
      if (result.ok) {
        setDraft('');
        onConfiguredChange(true);
        setStatus({ tone: 'ok', text: 'Key 已安全保存' });
      } else {
        setStatus({ tone: 'error', text: errorText(result) });
      }
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!ipc) return;
    setBusy(true);
    try {
      const result = (await ipc.invoke('ai-models-update', providerId, {
        clearKey: true,
      })) as AIIpcResult<AIProviderInfo>;
      if (result.ok) {
        onConfiguredChange(false);
        setStatus({ tone: 'muted', text: 'Key 已清除' });
      } else {
        setStatus({ tone: 'error', text: errorText(result) });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.keyField}>
      <div className={styles.keyInputRow}>
        <input
          className={sharedStyles.input}
          type="password"
          autoComplete="off"
          aria-label="API Key"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
          }}
          placeholder={configured ? '已安全保存，输入新 Key 可替换' : placeholder}
        />
        <button
          type="button"
          className={sharedStyles.secondaryButton}
          disabled={busy || !draft.trim()}
          onClick={() => void save()}
        >
          保存 Key
        </button>
      </div>
      <div className={styles.keyActions}>
        <span className={configured ? styles.badgeOk : styles.badgeMuted}>
          {configured ? (secureStorage ? '已配置 · 系统钥匙串加密' : '已配置') : '未配置'}
        </span>
        {configured && (
          <>
            <button
              type="button"
              className={styles.linkButton}
              disabled={busy}
              onClick={() => void clear()}
            >
              清除
            </button>
          </>
        )}
        {status && (
          <span
            role="status"
            className={
              status.tone === 'ok'
                ? styles.statusOk
                : status.tone === 'error'
                  ? styles.statusError
                  : styles.statusMuted
            }
          >
            {status.text}
          </span>
        )}
      </div>
      {configured && !secureStorage && (
        <div className={styles.keyWarning}>
          当前系统没有可用的钥匙串，Key 以仅本人可读的文件保存在应用数据目录。
        </div>
      )}
    </div>
  );
};

export default ApiKeyField;
