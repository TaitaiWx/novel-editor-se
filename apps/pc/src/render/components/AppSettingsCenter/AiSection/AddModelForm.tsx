/**
 * 「添加模型」：每个能力分区底部一个。
 *
 * 选服务商（预设）→ 自动填好协议、接口地址与推荐模型；模型可从推荐中选或手动填写；
 * 显示名称默认「服务商 · 模型」；API Key 只写。同一服务商 + 同一接口地址已经保存过 Key 时，
 * 默认「沿用已保存的 Key」（主进程复制，渲染进程拿不到明文）。
 */
import React, { useMemo, useState } from 'react';
import { VscAdd } from 'react-icons/vsc';
import type {
  AICapability,
  AIIpcResult,
  AIModelInput,
  AIProviderInfo,
} from '../../../types/ai-api';
import {
  defaultModelLabel,
  presetProviderName,
  presetsFor,
  type AIModelPreset,
} from '@/shared/ai-models';
import Checkbox from '../../Checkbox';
import NumberInput from '../../NumberInput';
import Select from '../../Select';
import sharedStyles from '../styles.module.scss';
import FieldRow from './FieldRow';
import { SuggestSelect } from './ModelEditForm';
import styles from './styles.module.scss';

interface AddModelFormProps {
  capability: AICapability;
  /** 同一能力已有的模型（找可沿用的 Key） */
  existing: readonly AIProviderInfo[];
  onAdd: (input: AIModelInput) => Promise<AIIpcResult<AIProviderInfo> | null>;
  /** 添加成功（展开新行） */
  onAdded: (info: AIProviderInfo) => void;
}

interface Draft {
  preset: string;
  baseUrl: string;
  model: string;
  label: string;
  apiKey: string;
  reuseKey: boolean;
  pricePerSecond: number | null;
  voice: string;
}

function draftFor(preset: AIModelPreset): Draft {
  return {
    preset: preset.key,
    baseUrl: preset.baseUrl,
    model: preset.models[0] ?? '',
    label: '',
    apiKey: '',
    reuseKey: true,
    pricePerSecond: null,
    voice: '',
  };
}

const trimUrl = (value: string) => value.trim().replace(/\/+$/, '');

/** 同一协议 + 同一接口地址、已保存 Key 的模型（第一个） */
export function reusableKeySource(
  existing: readonly AIProviderInfo[],
  vendor: string,
  baseUrl: string
): AIProviderInfo | undefined {
  const url = trimUrl(baseUrl);
  return existing.find(
    (item) => item.vendor === vendor && item.configured && trimUrl(item.baseUrl) === url && url
  );
}

const AddModelForm: React.FC<AddModelFormProps> = ({ capability, existing, onAdd, onAdded }) => {
  const presets = useMemo(() => presetsFor(capability), [capability]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFor(presets[0]));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const preset = presets.find((item) => item.key === draft.preset) ?? presets[0];
  const defaultLabel = defaultModelLabel(presetProviderName(preset), draft.model);
  const keySource = reusableKeySource(existing, preset.vendor, draft.baseUrl);
  const reusing = Boolean(keySource && draft.reuseKey);

  if (!open) {
    return (
      <button
        type="button"
        className={styles.addButton}
        onClick={() => {
          setDraft(draftFor(presets[0]));
          setError('');
          setOpen(true);
        }}
      >
        <VscAdd aria-hidden="true" />
        添加模型
      </button>
    );
  }

  const submit = async () => {
    if (preset.vendor === 'openai-compatible' && !draft.baseUrl.trim()) {
      return setError('请填写接口地址');
    }
    setBusy(true);
    try {
      const result = await onAdd({
        capability,
        vendor: preset.vendor,
        preset: preset.key,
        label: draft.label.trim() || defaultLabel,
        baseUrl: draft.baseUrl,
        model: draft.model,
        ...(reusing && keySource ? { reuseKeyFrom: keySource.id } : {}),
        ...(!reusing && draft.apiKey.trim() ? { apiKey: draft.apiKey } : {}),
        ...(capability === 'video' && draft.pricePerSecond !== null
          ? { pricePerSecond: draft.pricePerSecond }
          : {}),
        ...(capability === 'speech' && draft.voice.trim() ? { voice: draft.voice } : {}),
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

  const set = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }));

  return (
    <div className={styles.addForm} role="group" aria-label="添加模型">
      <FieldRow label="服务商" description="选一个服务商，自动填好接口地址和推荐模型。">
        <Select
          block
          size="lg"
          aria-label="服务商"
          value={draft.preset}
          options={presets.map((item) => ({ value: item.key, label: item.label }))}
          onChange={(key) => {
            const next = presets.find((item) => item.key === key);
            if (next) setDraft(draftFor(next));
          }}
        />
      </FieldRow>
      <FieldRow label="接口地址" description="只支持 http(s)，不要包含账号密码。">
        <input
          className={sharedStyles.input}
          aria-label="接口地址"
          value={draft.baseUrl}
          placeholder="https://…/v1"
          onChange={(event) => set({ baseUrl: event.target.value })}
        />
      </FieldRow>
      <FieldRow label="模型" description="从推荐中选择，或在列表底部手动填写。">
        <SuggestSelect
          ariaLabel="模型"
          value={draft.model}
          placeholder="选择或填写模型"
          suggestions={preset.models}
          customPlaceholder="模型名称"
          onChange={(model) => set({ model })}
        />
      </FieldRow>
      <FieldRow label="显示名称" description="在各功能的模型列表里显示，留空使用默认名称。">
        <input
          className={sharedStyles.input}
          aria-label="显示名称"
          value={draft.label}
          placeholder={defaultLabel}
          onChange={(event) => set({ label: event.target.value })}
        />
      </FieldRow>
      <FieldRow
        label="API Key"
        description={preset.keyHint ?? '只保存在本机的系统钥匙串，也可以添加后再填。'}
      >
        <div className={styles.keyField}>
          {keySource && (
            <Checkbox
              size="sm"
              checked={draft.reuseKey}
              onChange={(reuseKey) => set({ reuseKey })}
              label="沿用已保存的 Key"
              description={`与「${keySource.label}」使用同一个 Key`}
            />
          )}
          {!reusing && (
            <input
              className={sharedStyles.input}
              type="password"
              autoComplete="off"
              aria-label="API Key"
              value={draft.apiKey}
              placeholder="粘贴 API Key"
              onChange={(event) => set({ apiKey: event.target.value })}
            />
          )}
        </div>
      </FieldRow>
      {capability === 'video' && (
        <FieldRow label="每秒单价" description="CNY，用于费用预估，可不填。">
          <NumberInput
            block
            size="lg"
            allowEmpty
            min={0}
            step={0.01}
            aria-label="每秒单价"
            value={draft.pricePerSecond}
            onChange={(value) => set({ pricePerSecond: value })}
            onClear={() => set({ pricePerSecond: null })}
          />
        </FieldRow>
      )}
      {capability === 'speech' && (preset.voices?.length ?? 0) > 0 && (
        <FieldRow label="默认声音" description="台词没有指定声音时使用；不选用服务默认声音。">
          <SuggestSelect
            ariaLabel="默认声音"
            value={draft.voice}
            placeholder="服务默认"
            suggestions={preset.voices ?? []}
            customPlaceholder="声音 id"
            onChange={(voice) => set({ voice })}
          />
        </FieldRow>
      )}
      {preset.note && <p className={styles.formNote}>{preset.note}</p>}
      <div className={styles.formFooter}>
        {error ? (
          <span role="alert" className={styles.statusError}>
            {error}
          </span>
        ) : (
          <span className={styles.statusMuted}>添加后可以在列表里继续修改。</span>
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

export default AddModelForm;
