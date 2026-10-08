/**
 * 「添加服务」：每个能力分区底部一个（文本 / 图片 / 视频 / 语音），可以添加多个。
 *
 * - 文本：选常见服务模板或自定义（OpenAI 兼容），名称 + 接口地址必填
 * - 视频 / 图片 / 语音：选沿用的厂商实现（例如第二个 Seedance 账号、自建的 OpenAI 兼容配音），
 *   名称必填，接口地址 / 模型留空用厂商默认；视频可填每秒单价，语音可填默认声音
 * - API Key 可在这里一起填（只写不读），也可以添加后在新面板里填写
 */
import React, { useState } from 'react';
import { VscAdd } from 'react-icons/vsc';
import type { AICustomProviderInput, AIIpcResult, AIProviderInfo } from '../../../types/ai-api';
import NumberInput from '../../NumberInput';
import Select from '../../Select';
import sharedStyles from '../styles.module.scss';
import {
  KIND_NOUNS,
  TEXT_TEMPLATES,
  textDraft,
  vendorDraft,
  type AddDraft,
  type ProviderKind,
} from './addTemplates';
import FieldRow from './FieldRow';
import { voiceSuggestions } from './vendorSpecs';
import styles from './styles.module.scss';

interface AddProviderProps {
  kind: ProviderKind;
  /** 视频 / 图片 / 语音：可沿用的内置厂商实现 */
  vendors?: readonly AIProviderInfo[];
  /** 同类已有的服务（用于生成不重复的默认名称） */
  existing?: readonly AIProviderInfo[];
  onAdd: (input: AICustomProviderInput) => Promise<AIIpcResult<AIProviderInfo> | null>;
  /** 添加成功（展开新面板） */
  onAdded: (info: AIProviderInfo) => void;
}

const AddProvider: React.FC<AddProviderProps> = ({
  kind,
  vendors = [],
  existing = [],
  onAdd,
  onAdded,
}) => {
  const noun = KIND_NOUNS[kind];
  const isText = kind === 'text';
  const initial = () => (isText ? textDraft('deepseek') : vendorDraft(vendors[0], existing));
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AddDraft>(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!isText && vendors.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        className={styles.addButton}
        onClick={() => {
          setDraft(initial());
          setError('');
          setOpen(true);
        }}
      >
        <VscAdd aria-hidden="true" />
        添加{noun}
      </button>
    );
  }

  const vendor = vendors.find((item) => item.id === draft.template);
  const modelSuggestions = isText
    ? (TEXT_TEMPLATES.find((item) => item.key === draft.template)?.models ?? [])
    : (vendor?.models ?? []);
  const voices = kind === 'speech' ? voiceSuggestions(draft.template) : [];

  const submit = async () => {
    if (!draft.label.trim()) return setError('请填写名称');
    if (isText && !draft.baseUrl.trim()) return setError('请填写接口地址');
    if (!isText && !vendor) return setError('请选择服务类型');
    setBusy(true);
    try {
      const result = await onAdd({
        kind,
        ...(isText ? {} : { vendor: draft.template }),
        label: draft.label,
        baseUrl: draft.baseUrl,
        model: draft.model,
        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey } : {}),
        ...(kind === 'video' && draft.pricePerSecond !== null
          ? { pricePerSecond: draft.pricePerSecond }
          : {}),
        ...(kind === 'speech' && draft.voice.trim() ? { voice: draft.voice } : {}),
      });
      if (!result) return;
      if (result.ok) {
        setOpen(false);
        onAdded(result.data);
      } else {
        setError(result.error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const set =
    (key: 'label' | 'baseUrl' | 'model' | 'apiKey' | 'voice') =>
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setDraft((prev) => ({ ...prev, [key]: event.target.value }));
  const listId = (suffix: string) => `ai-add-${kind}-${suffix}`;

  return (
    <div className={styles.addForm} role="group" aria-label={`添加${noun}`}>
      {isText ? (
        <FieldRow label="服务" description="选一个常见服务自动填好地址和模型，也可以自定义。">
          <Select
            block
            size="lg"
            aria-label="服务模板"
            value={draft.template}
            options={TEXT_TEMPLATES.map((item) => ({ value: item.key, label: item.label }))}
            onChange={(value) => setDraft(textDraft(value))}
          />
        </FieldRow>
      ) : (
        <FieldRow label="服务类型" description="沿用哪一家的接口（可以是同一家的另一个账号）。">
          <Select
            block
            size="lg"
            aria-label="服务类型"
            value={draft.template}
            options={vendors.map((item) => ({ value: item.id, label: item.label }))}
            onChange={(value) =>
              setDraft(
                vendorDraft(
                  vendors.find((item) => item.id === value),
                  existing
                )
              )
            }
          />
        </FieldRow>
      )}
      <FieldRow label="名称" description="在写作功能的服务列表里显示。">
        <input
          className={sharedStyles.input}
          aria-label={`新${noun} 名称`}
          value={draft.label}
          placeholder={isText ? '例如：DeepSeek' : '例如：Seedance（工作室账号）'}
          onChange={set('label')}
        />
      </FieldRow>
      <FieldRow
        label="接口地址"
        description={
          isText
            ? 'OpenAI 兼容的 /chat/completions 接口（http / https）。'
            : '留空使用这一家的默认地址；只支持 http(s)。'
        }
      >
        <input
          className={sharedStyles.input}
          aria-label={`新${noun} 接口地址`}
          value={draft.baseUrl}
          placeholder={isText ? 'https://…/v1' : vendor?.defaultBaseUrl || 'https://…'}
          onChange={set('baseUrl')}
        />
      </FieldRow>
      <FieldRow label="模型" description={isText ? '可以稍后修改。' : '留空使用默认模型。'}>
        <input
          className={sharedStyles.input}
          aria-label={`新${noun} 模型`}
          list={listId('models')}
          value={draft.model}
          placeholder={isText ? undefined : vendor?.defaultModel}
          onChange={set('model')}
        />
        <datalist id={listId('models')}>
          {modelSuggestions.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      </FieldRow>
      {kind === 'video' && (
        <FieldRow label="每秒单价" description="CNY，用于费用预估，可不填。">
          <NumberInput
            block
            size="lg"
            allowEmpty
            min={0}
            step={0.01}
            aria-label={`新${noun} 每秒单价`}
            value={draft.pricePerSecond}
            onChange={(value) => setDraft((prev) => ({ ...prev, pricePerSecond: value }))}
            onClear={() => setDraft((prev) => ({ ...prev, pricePerSecond: null }))}
          />
        </FieldRow>
      )}
      {kind === 'speech' && (
        <FieldRow label="默认声音" description="台词没有指定声音时使用；留空用默认声音。">
          <input
            className={sharedStyles.input}
            aria-label={`新${noun} 默认声音`}
            list={listId('voices')}
            value={draft.voice}
            onChange={set('voice')}
          />
          <datalist id={listId('voices')}>
            {voices.map((voice) => (
              <option key={voice} value={voice} />
            ))}
          </datalist>
        </FieldRow>
      )}
      <FieldRow label="API Key" description="可选；只保存在本机的系统钥匙串，也可以添加后再填。">
        <input
          className={sharedStyles.input}
          type="password"
          autoComplete="off"
          aria-label={`新${noun} API Key`}
          value={draft.apiKey}
          placeholder="粘贴 API Key"
          onChange={set('apiKey')}
        />
      </FieldRow>
      <div className={styles.formFooter}>
        {error ? (
          <span role="alert" className={styles.statusError}>
            {error}
          </span>
        ) : (
          <span className={styles.statusMuted}>添加后可以在新面板里继续修改。</span>
        )}
        <div className={styles.footerButtons}>
          <button
            type="button"
            className={`${sharedStyles.secondaryButton} ${styles.footerButton}`}
            onClick={() => setOpen(false)}
          >
            取消
          </button>
          <button
            type="button"
            className={`${sharedStyles.primaryButton} ${styles.footerButton}`}
            disabled={busy}
            onClick={() => void submit()}
          >
            添加
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddProvider;
