/**
 * 「网络代理」：勾选了「通过代理访问」的模型走这里的代理，其余模型直连。
 * 跟随系统代理（默认）或手动填写地址（http / https / socks4 / socks5）；保存在 ai-providers.json（主进程校验）。
 */
import React, { useEffect, useState } from 'react';
import type { AIIpcResult } from '../../../types/ai-api';
import { normalizeProxyUrl, type AIProxyMode, type AIProxySettings } from '@/shared/ai-proxy';
import Select from '../../Select';
import sharedStyles from '../styles.module.scss';
import { SettingsRow } from '../layout';
import styles from './styles.module.scss';

const MODE_OPTIONS: { value: AIProxyMode; label: string }[] = [
  { value: 'system', label: '跟随系统代理' },
  { value: 'manual', label: '手动填写代理地址' },
];

type Status = { ok: boolean; text: string } | null;

interface ProxySettingProps {
  /** 有多少模型勾选了「通过代理访问」（提示用） */
  proxiedCount: number;
}

const ProxySetting: React.FC<ProxySettingProps> = ({ proxiedCount }) => {
  const [saved, setSaved] = useState<AIProxySettings | null>(null);
  const [mode, setMode] = useState<AIProxyMode>('system');
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    void window.electron?.ipcRenderer
      .invoke('ai-proxy-get')
      .then((result: AIIpcResult<AIProxySettings>) => {
        if (!result?.ok) return;
        setSaved(result.data);
        setMode(result.data.mode);
        setUrl(result.data.url ?? '');
      })
      .catch(() => undefined);
  }, []);

  const save = async (next: AIProxySettings) => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const result: AIIpcResult<AIProxySettings> = await ipc.invoke('ai-proxy-set', next);
    if (result.ok) {
      setSaved(result.data);
      setUrl(result.data.url ?? '');
      setStatus({ ok: true, text: '已保存' });
    } else {
      setStatus({ ok: false, text: result.error.message });
    }
  };

  const commitUrl = () => {
    let normalized: string;
    try {
      normalized = normalizeProxyUrl(url);
    } catch (error) {
      setStatus({ ok: false, text: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (!normalized) {
      setStatus({ ok: false, text: '请填写代理地址，例如 http://127.0.0.1:7890' });
      return;
    }
    if (saved?.mode === 'manual' && saved.url === normalized) {
      setUrl(normalized);
      return;
    }
    void save({ mode: 'manual', url: normalized });
  };

  const usage =
    proxiedCount > 0
      ? `${proxiedCount} 个模型通过代理访问，其余直连。`
      : '还没有模型使用代理：在模型的编辑里勾选「通过代理访问」。';

  return (
    <>
      <SettingsRow
        label="代理方式"
        description={`只对勾选了「通过代理访问」的模型生效。${usage}`}
        control="field"
        data-testid="ai-proxy-row"
      >
        <Select
          block
          size="lg"
          aria-label="代理方式"
          value={mode}
          options={MODE_OPTIONS}
          onChange={(next) => {
            setMode(next);
            setStatus(null);
            if (next === 'system') void save({ mode: 'system' });
          }}
        />
      </SettingsRow>
      {mode === 'manual' && (
        <SettingsRow
          label="代理地址"
          description="支持 http / https / socks4 / socks5，例如 http://127.0.0.1:7890；不支持账号密码。"
          control="field"
          extra={
            status && (
              <span role="status" className={status.ok ? styles.statusOk : styles.statusError}>
                {status.text}
              </span>
            )
          }
        >
          <input
            className={sharedStyles.input}
            aria-label="代理地址"
            value={url}
            placeholder="http://127.0.0.1:7890"
            onChange={(event) => setUrl(event.target.value)}
            onBlur={commitUrl}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
        </SettingsRow>
      )}
      {mode === 'system' && status && !status.ok && (
        <span role="status" className={styles.statusError}>
          {status.text}
        </span>
      )}
    </>
  );
};

export default ProxySetting;
