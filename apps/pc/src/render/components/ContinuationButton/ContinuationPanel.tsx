import React, { useState } from 'react';
import type { ContinuationLength } from '@novel-editor/ai/prompts';
import type { AIProviderInfo } from '@/shared/ai';
import type { ContinuationState } from '../TextEditor/assist';
import { describeAIError } from '../TextEditor/assist/ai-error';
import { currentContinuationText } from '../TextEditor/assist/continuation-state';
import type { ResolvedProvider } from '../../utils/continuationService';
import { usableModels } from '../../utils/textProviders';
import Checkbox from '../Checkbox';
import Select from '../Select';
import { ContextDetails } from './ContextDetails';
import {
  DEFAULT_PANEL_FORM,
  type ContinuationPanelForm,
  type DirectionChoice,
} from './useContinuationPanel';
import styles from './styles.module.scss';

const LENGTHS: Array<[ContinuationLength, string]> = [
  ['sentence', '一句'],
  ['paragraph', '一段'],
  ['long', '约 500 字'],
];

const DIRECTIONS: Array<[Exclude<DirectionChoice, 'custom'>, string]> = [
  ['continue', '顺着写'],
  ['conflict', '制造冲突'],
  ['wrap-up', '收束本章'],
];

export interface ContinuationPanelProps {
  providers: AIProviderInfo[] | null;
  resolvedProvider: ResolvedProvider | null;
  configured: boolean | null;
  state: ContinuationState;
  notice: string | null;
  onGenerate: (form: ContinuationPanelForm) => void;
  onAccept: () => void;
  onDiscard: () => void;
  onNext: () => void;
  onRetry: () => void;
  onOpenSettings: () => void;
}

/** 续写面板：长度 / 方向 / 是否遵循章纲 / 服务 → 生成「建议」，并显示进度、错误与上下文 */
export const ContinuationPanel: React.FC<ContinuationPanelProps> = ({
  providers,
  resolvedProvider,
  configured,
  state,
  notice,
  onGenerate,
  onAccept,
  onDiscard,
  onNext,
  onRetry,
  onOpenSettings,
}) => {
  const [form, setForm] = useState<ContinuationPanelForm>(DEFAULT_PANEL_FORM);
  const update = (patch: Partial<ContinuationPanelForm>) =>
    setForm((prev) => ({ ...prev, ...patch }));
  const usable = usableModels(providers ?? [], 'text');
  const suggestion = state.mode === 'suggestion' ? state : null;
  const busy = suggestion?.phase === 'loading' || suggestion?.phase === 'streaming';
  const text = suggestion ? currentContinuationText(suggestion) : '';

  if (configured === false) {
    return (
      <div className={styles.panel}>
        <div className={styles.empty}>
          <strong>AI 还没有配置</strong>
          <span>在设置中心填写 Grok（xAI）或默认 AI 的 API Key 后即可续写。</span>
          <button type="button" className={styles.primary} onClick={onOpenSettings}>
            去设置 AI 服务
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.field}>
        <span className={styles.label}>长度</span>
        <div className={styles.segmented} role="radiogroup" aria-label="续写长度">
          {LENGTHS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={form.length === value}
              className={form.length === value ? styles.segmentActive : styles.segment}
              onClick={() => update({ length: value })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>方向</span>
        <div className={styles.segmented} role="radiogroup" aria-label="续写方向">
          {DIRECTIONS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={form.direction === value && !form.customDirection.trim()}
              className={
                form.direction === value && !form.customDirection.trim()
                  ? styles.segmentActive
                  : styles.segment
              }
              onClick={() => update({ direction: value, customDirection: '' })}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          className={styles.input}
          value={form.customDirection}
          placeholder="或者写一句你想要的方向，例如：让苏晴先发现异样"
          aria-label="自定义续写方向"
          maxLength={200}
          onChange={(event) => update({ customDirection: event.target.value })}
        />
      </div>

      <div className={styles.row}>
        <Checkbox
          size="sm"
          checked={form.followOutline}
          onChange={(checked) => update({ followOutline: checked })}
          label="遵循章纲"
        />
        <Select
          className={styles.select}
          size="sm"
          aria-label="AI 模型"
          value={form.providerId}
          options={[
            { value: '', label: `默认（${resolvedProvider?.label ?? '读取中…'}）` },
            ...usable.map((item) => ({ value: item.id, label: item.label })),
          ]}
          onChange={(providerId) => update({ providerId })}
        />
      </div>

      <button
        type="button"
        className={styles.primary}
        disabled={busy || configured === null}
        onClick={() => onGenerate(form)}
      >
        {busy ? '正在续写…' : '生成建议'}
      </button>
      {notice && <div className={styles.notice}>{notice}</div>}

      {suggestion && suggestion.phase !== 'idle' && (
        <div className={styles.status} role="status">
          {suggestion.phase === 'loading' && <span>正在组装上下文并请求 AI…</span>}
          {suggestion.phase === 'streaming' && <span>正在生成… {Array.from(text).length} 字</span>}
          {suggestion.phase === 'ready' && (
            <>
              <span>建议已插在光标处（{Array.from(text).length} 字），采纳后才写入正文。</span>
              <div className={styles.actions}>
                <button type="button" className={styles.primarySmall} onClick={onAccept}>
                  采纳
                </button>
                <button type="button" className={styles.ghost} onClick={onDiscard}>
                  放弃
                </button>
                <button type="button" className={styles.ghost} onClick={onNext}>
                  换一个
                </button>
              </div>
            </>
          )}
          {suggestion.phase === 'error' && suggestion.error && (
            <ErrorBlock
              error={suggestion.error}
              onRetry={onRetry}
              onDiscard={onDiscard}
              onOpenSettings={onOpenSettings}
            />
          )}
        </div>
      )}
      {suggestion?.context && <ContextDetails context={suggestion.context} />}
    </div>
  );
};

const ErrorBlock: React.FC<{
  error: NonNullable<ContinuationState['error']>;
  onRetry: () => void;
  onDiscard: () => void;
  onOpenSettings: () => void;
}> = ({ error, onRetry, onDiscard, onOpenSettings }) => {
  const info = describeAIError(error);
  return (
    <div className={styles.error} role="alert">
      <strong>{info.title}</strong>
      {info.hint && <span>{info.hint}</span>}
      <div className={styles.actions}>
        {info.canRetry && (
          <button type="button" className={styles.primarySmall} onClick={onRetry}>
            重试
          </button>
        )}
        {info.needsSettings && (
          <button type="button" className={styles.ghost} onClick={onOpenSettings}>
            去设置
          </button>
        )}
        <button type="button" className={styles.ghost} onClick={onDiscard}>
          关闭
        </button>
      </div>
    </div>
  );
};

export default ContinuationPanel;
