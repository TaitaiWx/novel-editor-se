import React, { useCallback, useEffect, useState } from 'react';
import { DEFAULT_VOICE_LANGUAGE, VOICE_LANGUAGES } from '@novel-editor/video';
import type {
  AIIpcResult,
  AIProviderInfo,
  AIProviderUpdate,
  VideoSettingsInfo,
} from '../../../types/ai-api';
import NumberInput from '../../NumberInput';
import Select from '../../Select';
import sharedStyles from '../styles.module.scss';
import ApiKeyField from './ApiKeyField';
import styles from './styles.module.scss';

/** 默认文本服务在上方「AI 设置」表单中配置，这里只列出其他服务 */
const DEFAULT_PROVIDER_ID = 'openai-compatible';

const KIND_LABELS: Record<AIProviderInfo['kind'], string> = {
  text: '文本',
  video: '视频',
  image: '图片',
  speech: '配音',
};

/** 场景视频新场景的默认配音语言（保存在 ai-providers.json 的视频设置里） */
const VoiceLanguageSetting: React.FC = () => {
  const [language, setLanguage] = useState<string>(DEFAULT_VOICE_LANGUAGE);
  useEffect(() => {
    void window.electron?.ipcRenderer
      .invoke('video-settings-get')
      .then((result: AIIpcResult<VideoSettingsInfo>) => {
        if (result.ok && result.data.voiceLanguage) setLanguage(result.data.voiceLanguage);
      })
      .catch(() => undefined);
  }, []);
  return (
    <div className={styles.fieldLabel}>
      配音默认语言（新的场景视频使用；每一场可在「场景 → 声音」里改）
      <Select
        block
        size="lg"
        aria-label="配音默认语言"
        value={language}
        options={VOICE_LANGUAGES.map((item) => ({
          value: item.code,
          label: `${item.label}（${item.code}）`,
          textValue: item.label,
        }))}
        onChange={(next) => {
          setLanguage(next);
          void window.electron?.ipcRenderer
            .invoke('video-settings-set', { voiceLanguage: next })
            .catch(() => undefined);
        }}
      />
    </div>
  );
};

interface RowDraft {
  enabled: boolean;
  baseUrl: string;
  model: string;
  price: string;
}

function toDraft(info: AIProviderInfo): RowDraft {
  return {
    enabled: info.enabled,
    baseUrl: info.baseUrl,
    model: info.model,
    price: typeof info.pricePerSecond === 'number' ? String(info.pricePerSecond) : '',
  };
}

const ProviderRow: React.FC<{
  info: AIProviderInfo;
  onChange: (info: AIProviderInfo) => void;
}> = ({ info, onChange }) => {
  const [draft, setDraft] = useState<RowDraft>(() => toDraft(info));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const isVideo = info.kind === 'video';

  // 主进程未显式设置启用状态时按「是否已保存 Key」推导：保存 Key 后刷新，开关随之同步
  useEffect(() => {
    setDraft((prev) => (prev.enabled === info.enabled ? prev : { ...prev, enabled: info.enabled }));
  }, [info.enabled]);

  /**
   * 保存配置。只有点击开关时才写入 enabled：修改地址 / 模型 / 单价不能把推导出的启用状态
   * （尚未保存 Key 时为 false）固化为显式的「关闭」，否则之后保存 Key 也不会自动启用
   */
  const save = async (patch: Partial<RowDraft> = {}) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    const update: AIProviderUpdate = {
      baseUrl: next.baseUrl,
      model: next.model,
    };
    if (typeof patch.enabled === 'boolean') update.enabled = patch.enabled;
    if (isVideo) {
      const price = Number.parseFloat(next.price);
      update.pricePerSecond = next.price.trim() && Number.isFinite(price) ? price : null;
    }
    const result = (await window.electron?.ipcRenderer.invoke(
      'ai-providers-set',
      info.id,
      update
    )) as AIIpcResult<AIProviderInfo> | undefined;
    if (!result) return;
    if (result.ok) {
      onChange(result.data);
      setMessage({ ok: true, text: '已保存' });
    } else {
      setMessage({ ok: false, text: result.error.message });
    }
  };

  /** Key 保存 / 清除后重新读取：启用状态可能随之变化（未显式设置时跟随是否已配置 Key） */
  const refresh = async (configured: boolean) => {
    const result = (await window.electron?.ipcRenderer.invoke('ai-providers-get', info.id)) as
      | AIIpcResult<AIProviderInfo>
      | undefined;
    onChange(result?.ok ? result.data : { ...info, configured });
  };

  return (
    <div className={styles.providerCard} data-testid={`ai-provider-${info.id}`}>
      <div className={styles.providerHeader}>
        <div>
          <div className={styles.providerTitle}>
            {info.label}
            <span className={styles.kindTag}>{KIND_LABELS[info.kind] ?? info.kind}</span>
          </div>
          <div className={sharedStyles.formDesc}>{info.description}</div>
        </div>
        <button
          type="button"
          aria-label={`启用 ${info.label}`}
          aria-pressed={draft.enabled}
          className={`${sharedStyles.switchButton} ${draft.enabled ? sharedStyles.enabled : ''}`}
          onClick={() => void save({ enabled: !draft.enabled })}
        >
          <span className={sharedStyles.switchThumb} />
        </button>
      </div>
      <div className={styles.providerGrid}>
        <div className={styles.fieldLabel}>
          API Key
          <ApiKeyField
            providerId={info.id}
            configured={info.configured}
            secureStorage={info.secureStorage}
            placeholder="粘贴 API Key"
            onConfiguredChange={(configured) => void refresh(configured)}
          />
        </div>
        <label className={styles.fieldLabel}>
          接口地址
          <input
            className={sharedStyles.input}
            value={draft.baseUrl}
            placeholder={info.defaultBaseUrl}
            onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
            onBlur={() => void save()}
          />
        </label>
        <label className={styles.fieldLabel}>
          模型
          <input
            className={sharedStyles.input}
            list={`ai-models-${info.id}`}
            value={draft.model}
            placeholder={info.defaultModel}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            onBlur={() => void save()}
          />
          <datalist id={`ai-models-${info.id}`}>
            {info.models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </label>
        {isVideo && (
          <label className={styles.fieldLabel}>
            每秒单价（{info.currency ?? 'CNY'}，用于费用预估，可不填）
            <NumberInput
              block
              size="lg"
              allowEmpty
              min={0}
              step={0.01}
              aria-label={`${info.label} 每秒单价`}
              value={draft.price.trim() ? Number(draft.price) : null}
              onChange={(value) => setDraft((prev) => ({ ...prev, price: String(value) }))}
              onClear={() => setDraft((prev) => ({ ...prev, price: '' }))}
              onCommit={(value) => void save({ price: value === null ? '' : String(value) })}
            />
          </label>
        )}
      </div>
      {message && (
        <div role="status" className={message.ok ? styles.statusOk : styles.statusError}>
          {message.text}
        </div>
      )}
    </div>
  );
};

/** 设置中心「更多 AI 服务」：Grok 续写、MiniMax / Seedance 视频等 */
const ProviderList: React.FC = () => {
  const [providers, setProviders] = useState<AIProviderInfo[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const result = (await ipc.invoke('ai-providers-list')) as
      | AIIpcResult<AIProviderInfo[]>
      | undefined;
    if (!result) return;
    if (result.ok) {
      setProviders(result.data.filter((item) => item.id !== DEFAULT_PROVIDER_ID));
      setError('');
    } else {
      setError(result.error.message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <div className={styles.statusError}>加载 AI 服务失败：{error}</div>;
  if (!providers) return null;

  return (
    <div className={styles.providerList}>
      <VoiceLanguageSetting />
      {providers.map((info) => (
        <ProviderRow
          key={info.id}
          info={info}
          onChange={(next) =>
            setProviders((prev) => prev?.map((item) => (item.id === next.id ? next : item)) ?? prev)
          }
        />
      ))}
    </div>
  );
};

export default ProviderList;
