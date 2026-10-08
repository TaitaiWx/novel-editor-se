/**
 * 模型行展开后的编辑区：显示名称、接口地址、模型、API Key（只写）+ 按能力的参数
 * （文本：生成参数；视频：每秒单价；语音：默认声音）。失焦 / 选择即保存，只发送改动的字段。
 *
 * 显示名称还是默认的「服务商 · 模型」时，换模型会同时更新名称。
 */
import React, { useEffect, useState } from 'react';
import type { AIIpcResult, AIProviderInfo, AIProviderUpdate } from '../../../types/ai-api';
import { defaultModelLabel, findPreset } from '@/shared/ai-models';
import NumberInput from '../../NumberInput';
import Select from '../../Select';
import sharedStyles from '../styles.module.scss';
import ApiKeyField from './ApiKeyField';
import FieldRow from './FieldRow';
import GenerationParams from './GenerationParams';
import styles from './styles.module.scss';

interface ModelEditFormProps {
  info: AIProviderInfo;
  onUpdate: (patch: AIProviderUpdate) => Promise<AIIpcResult<AIProviderInfo> | null>;
  /** Key 保存 / 清除后重新读取 */
  onKeyChanged: () => void;
}

/** 推荐项 + 列表底部手动填写（components/Select 的 custom） */
export const SuggestSelect: React.FC<{
  ariaLabel: string;
  value: string;
  suggestions: readonly string[];
  placeholder?: string;
  customPlaceholder?: string;
  onChange: (value: string) => void;
}> = ({ ariaLabel, value, suggestions, placeholder, customPlaceholder, onChange }) => (
  <Select
    block
    size="lg"
    aria-label={ariaLabel}
    value={value}
    placeholder={placeholder}
    options={Array.from(new Set(suggestions.filter(Boolean))).map((item) => ({
      value: item,
      label: item,
    }))}
    custom={{
      label: '手动填写',
      placeholder: customPlaceholder,
      normalize: (text) => {
        const trimmed = text.trim();
        return trimmed && trimmed.length <= 200 ? trimmed : null;
      },
    }}
    onChange={onChange}
  />
);

const ModelEditForm: React.FC<ModelEditFormProps> = ({ info, onUpdate, onKeyChanged }) => {
  const [label, setLabel] = useState(info.label);
  const [baseUrl, setBaseUrl] = useState(info.baseUrl);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const preset = findPreset(info.preset);

  // 主进程返回的值变化时同步（列表重新读取但值没变时不打断正在输入的内容）
  useEffect(() => setLabel(info.label), [info.label]);
  useEffect(() => setBaseUrl(info.baseUrl), [info.baseUrl]);

  const save = async (patch: AIProviderUpdate) => {
    const result = await onUpdate(patch);
    if (!result) return;
    setMessage(
      result.ok ? { ok: true, text: '已保存' } : { ok: false, text: result.error.message }
    );
  };

  const commitLabel = () => {
    if (label.trim() && label.trim() !== info.label) void save({ label });
    else setLabel(info.label);
  };
  const commitBaseUrl = () => {
    if (baseUrl.trim() !== info.baseUrl) void save({ baseUrl });
  };
  const changeModel = (model: string) => {
    if (model === info.model) return;
    const autoLabel = info.label === defaultModelLabel(info.providerLabel, info.model);
    void save({
      model,
      ...(autoLabel ? { label: defaultModelLabel(info.providerLabel, model) } : {}),
    });
  };
  const enterToBlur = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
  };

  return (
    <div className={styles.form}>
      <FieldRow label="显示名称" description="在续写、分镜、场景视频等功能的模型列表里显示。">
        <input
          className={sharedStyles.input}
          aria-label="显示名称"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={commitLabel}
          onKeyDown={enterToBlur}
        />
      </FieldRow>
      <FieldRow label="接口地址" description="只支持 http(s)，不要包含账号密码。">
        <input
          className={sharedStyles.input}
          aria-label="接口地址"
          value={baseUrl}
          placeholder={info.defaultBaseUrl || 'https://…/v1'}
          onChange={(event) => setBaseUrl(event.target.value)}
          onBlur={commitBaseUrl}
          onKeyDown={enterToBlur}
        />
      </FieldRow>
      <FieldRow label="模型" description="可从推荐中选择，也可以在列表底部手动填写。">
        <SuggestSelect
          ariaLabel="模型"
          value={info.model}
          suggestions={[info.model, ...info.models]}
          customPlaceholder="模型名称"
          onChange={changeModel}
        />
      </FieldRow>
      <FieldRow
        label="API Key"
        description={preset?.keyHint ?? '由系统钥匙串加密保存在本机，保存后不再显示明文。'}
      >
        <ApiKeyField
          providerId={info.id}
          configured={info.configured}
          secureStorage={info.secureStorage}
          placeholder="粘贴 API Key"
          onConfiguredChange={onKeyChanged}
        />
      </FieldRow>
      {info.kind === 'text' && (
        <GenerationParams
          providerLabel={info.label}
          values={{
            temperature: info.temperature,
            contextTokens: info.contextTokens,
            maxTokens: info.maxTokens,
          }}
          onCommit={(key, value) => void save({ [key]: value })}
        />
      )}
      {info.kind === 'video' && (
        <FieldRow
          label="每秒单价"
          description={`${info.currency ?? 'CNY'}，用于费用预估，可不填。`}
        >
          <NumberInput
            block
            size="lg"
            allowEmpty
            min={0}
            step={0.01}
            aria-label={`${info.label} 每秒单价`}
            value={typeof info.pricePerSecond === 'number' ? info.pricePerSecond : null}
            onChange={() => undefined}
            onCommit={(value) => {
              if (value !== (info.pricePerSecond ?? null)) void save({ pricePerSecond: value });
            }}
          />
        </FieldRow>
      )}
      {info.kind === 'speech' && (
        <FieldRow label="默认声音" description="台词没有指定声音时使用；不选用服务默认声音。">
          <SuggestSelect
            ariaLabel="默认声音"
            value={info.voice ?? ''}
            placeholder="服务默认"
            suggestions={preset?.voices ?? []}
            customPlaceholder="声音 id"
            onChange={(voice) => void save({ voice })}
          />
        </FieldRow>
      )}
      {preset?.note && <p className={styles.formNote}>{preset.note}</p>}
      {message && (
        <div className={styles.formFooter}>
          <span role="status" className={message.ok ? styles.statusOk : styles.statusError}>
            {message.text}
          </span>
        </div>
      )}
    </div>
  );
};

export default ModelEditForm;
