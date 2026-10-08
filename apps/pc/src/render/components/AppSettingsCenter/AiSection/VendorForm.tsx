/**
 * 内置默认 AI 以外的服务表单：按厂商只显示需要的字段（vendorSpecs），失焦 / 提交即保存。
 * 只发送改动的字段；启用开关在面板标题行，这里不写 enabled（避免把推导出的状态固化）。
 */
import React, { useEffect, useState } from 'react';
import type { AIIpcResult, AIProviderInfo, AIProviderUpdate } from '../../../types/ai-api';
import NumberInput from '../../NumberInput';
import sharedStyles from '../styles.module.scss';
import ApiKeyField from './ApiKeyField';
import FieldRow from './FieldRow';
import GenerationParams from './GenerationParams';
import { vendorSpec, type VendorField } from './vendorSpecs';
import styles from './styles.module.scss';

interface VendorFormProps {
  info: AIProviderInfo;
  onUpdate: (patch: AIProviderUpdate) => Promise<AIIpcResult<AIProviderInfo> | null>;
  /** Key 保存 / 清除后重新读取（启用状态可能随之变化） */
  onKeyChanged: () => void;
  /** 自己添加的服务：删除 */
  onRemove?: () => void;
}

interface TextDraft {
  label: string;
  baseUrl: string;
  model: string;
  voice: string;
}

function toDraft(info: AIProviderInfo): TextDraft {
  return {
    label: info.label,
    baseUrl: info.baseUrl,
    model: info.model,
    voice: info.voice ?? '',
  };
}

type TextKey = keyof TextDraft;

const VendorForm: React.FC<VendorFormProps> = ({ info, onUpdate, onKeyChanged, onRemove }) => {
  const spec = vendorSpec(info);
  const [draft, setDraft] = useState<TextDraft>(() => toDraft(info));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  // 主进程返回的值变化（例如改名、恢复默认地址）时同步；列表重新读取但值没变时不打断正在输入的内容
  useEffect(() => {
    setDraft({
      label: info.label,
      baseUrl: info.baseUrl,
      model: info.model,
      voice: info.voice ?? '',
    });
  }, [info.label, info.baseUrl, info.model, info.voice]);

  const save = async (patch: AIProviderUpdate) => {
    const result = await onUpdate(patch);
    if (!result) return;
    setMessage(
      result.ok ? { ok: true, text: '已保存' } : { ok: false, text: result.error.message }
    );
  };

  /** 文本字段失焦保存：没有变化不保存 */
  const commitText = (key: TextKey) => {
    const value = draft[key];
    if (value === toDraft(info)[key]) return;
    void save({ [key]: value });
  };

  const textInput = (key: TextKey, ariaLabel: string, placeholder?: string, list?: string) => (
    <input
      className={sharedStyles.input}
      aria-label={ariaLabel}
      value={draft[key]}
      placeholder={placeholder}
      list={list}
      onChange={(event) => setDraft((prev) => ({ ...prev, [key]: event.target.value }))}
      onBlur={() => commitText(key)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commitText(key);
      }}
    />
  );

  const renderField = (field: VendorField) => {
    switch (field) {
      case 'label':
        return (
          <FieldRow key={field} label="名称" description="在写作功能的服务列表里显示。">
            {textInput('label', '名称')}
          </FieldRow>
        );
      case 'key':
        return (
          <FieldRow
            key={field}
            label="API Key"
            description={spec.keyHint ?? '由系统钥匙串加密保存在本机，保存后不再显示明文。'}
          >
            <ApiKeyField
              providerId={info.id}
              configured={info.configured}
              secureStorage={info.secureStorage}
              placeholder="粘贴 API Key"
              onConfiguredChange={onKeyChanged}
            />
          </FieldRow>
        );
      case 'baseUrl':
        return (
          <FieldRow key={field} label="接口地址" description="只支持 http(s)，不要包含账号密码。">
            {textInput('baseUrl', '接口地址', info.defaultBaseUrl || 'https://…/v1')}
          </FieldRow>
        );
      case 'model':
        return (
          <FieldRow key={field} label="模型" description="可从推荐中选择，也可以手动填写。">
            {textInput('model', '模型', info.defaultModel, `ai-models-${info.id}`)}
            <datalist id={`ai-models-${info.id}`}>
              {info.models.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </FieldRow>
        );
      case 'voice':
        return (
          <FieldRow key={field} label="声音" description="台词没有指定声音时使用；留空用默认声音。">
            {textInput('voice', '声音', '例如：alloy', `ai-voices-${info.id}`)}
            <datalist id={`ai-voices-${info.id}`}>
              {(spec.voices ?? []).map((voice) => (
                <option key={voice} value={voice} />
              ))}
            </datalist>
          </FieldRow>
        );
      case 'price':
        return (
          <FieldRow
            key={field}
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
        );
      default:
        return null;
    }
  };

  return (
    <div className={styles.form}>
      {spec.fields.map(renderField)}
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
      {spec.note && <p className={styles.formNote}>{spec.note}</p>}
      {(message || onRemove) && (
        <div className={styles.formFooter}>
          {message ? (
            <span role="status" className={message.ok ? styles.statusOk : styles.statusError}>
              {message.text}
            </span>
          ) : (
            <span />
          )}
          {onRemove &&
            (confirmingRemove ? (
              <div className={styles.footerButtons}>
                <span className={styles.statusMuted}>Key 与配置会一起删除</span>
                <button
                  type="button"
                  className={`${sharedStyles.secondaryButton} ${styles.footerButton}`}
                  onClick={() => setConfirmingRemove(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className={`${styles.dangerButton} ${styles.footerButton}`}
                  onClick={onRemove}
                >
                  确认删除
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={`${styles.dangerButton} ${styles.footerButton}`}
                onClick={() => setConfirmingRemove(true)}
              >
                {info.kind === 'text' ? '删除这个 AI' : '删除这个服务'}
              </button>
            ))}
        </div>
      )}
    </div>
  );
};

export default VendorForm;
