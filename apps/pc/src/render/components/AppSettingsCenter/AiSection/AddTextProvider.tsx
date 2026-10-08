/**
 * 「添加文本 AI」：选一个常见服务模板（DeepSeek、通义千问、Kimi、智谱、本地 Ollama…）或自定义，
 * 填名称 / 接口地址 / 模型后添加；Key 在新面板里填写（只写不读）
 */
import React, { useState } from 'react';
import { VscAdd } from 'react-icons/vsc';
import type { AICustomTextInput, AIIpcResult, AIProviderInfo } from '../../../types/ai-api';
import Select from '../../Select';
import sharedStyles from '../styles.module.scss';
import FieldRow from './FieldRow';
import styles from './styles.module.scss';

interface TextTemplate {
  key: string;
  label: string;
  baseUrl: string;
  models: string[];
}

export const TEXT_TEMPLATES: readonly TextTemplate[] = [
  {
    key: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    key: 'qwen',
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo'],
  },
  {
    key: 'kimi',
    label: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k2-turbo-preview', 'moonshot-v1-32k'],
  },
  {
    key: 'glm',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4.6', 'glm-4-flash'],
  },
  {
    key: 'ollama',
    label: 'Ollama（本地）',
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: ['qwen3', 'llama3.1'],
  },
  { key: 'custom', label: '其他兼容接口', baseUrl: '', models: [] },
];

interface AddTextProviderProps {
  onAdd: (input: AICustomTextInput) => Promise<AIIpcResult<AIProviderInfo> | null>;
  /** 添加成功（展开新面板） */
  onAdded: (info: AIProviderInfo) => void;
}

interface Draft {
  template: string;
  label: string;
  baseUrl: string;
  model: string;
}

function fromTemplate(key: string): Draft {
  const template = TEXT_TEMPLATES.find((item) => item.key === key) ?? TEXT_TEMPLATES[0];
  return {
    template: template.key,
    label: template.key === 'custom' ? '' : template.label,
    baseUrl: template.baseUrl,
    model: template.models[0] ?? '',
  };
}

const AddTextProvider: React.FC<AddTextProviderProps> = ({ onAdd, onAdded }) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => fromTemplate('deepseek'));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const template = TEXT_TEMPLATES.find((item) => item.key === draft.template);

  if (!open) {
    return (
      <button
        type="button"
        className={styles.addButton}
        onClick={() => {
          setDraft(fromTemplate('deepseek'));
          setError('');
          setOpen(true);
        }}
      >
        <VscAdd aria-hidden="true" />
        添加文本 AI
      </button>
    );
  }

  const submit = async () => {
    if (!draft.label.trim()) return setError('请填写名称');
    if (!draft.baseUrl.trim()) return setError('请填写接口地址');
    setBusy(true);
    try {
      const result = await onAdd({
        label: draft.label,
        baseUrl: draft.baseUrl,
        model: draft.model,
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

  const set = (key: keyof Draft) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <div className={styles.addForm} role="group" aria-label="添加文本 AI">
      <FieldRow label="服务" description="选一个常见服务自动填好地址和模型，也可以自定义。">
        <Select
          block
          size="lg"
          aria-label="服务模板"
          value={draft.template}
          options={TEXT_TEMPLATES.map((item) => ({ value: item.key, label: item.label }))}
          onChange={(value) => setDraft(fromTemplate(value))}
        />
      </FieldRow>
      <FieldRow label="名称" description="在写作功能的服务列表里显示。">
        <input
          className={sharedStyles.input}
          aria-label="新文本 AI 名称"
          value={draft.label}
          placeholder="例如：DeepSeek"
          onChange={set('label')}
        />
      </FieldRow>
      <FieldRow
        label="接口地址"
        description="OpenAI 兼容的 /chat/completions 接口（http / https）。"
      >
        <input
          className={sharedStyles.input}
          aria-label="新文本 AI 接口地址"
          value={draft.baseUrl}
          placeholder="https://…/v1"
          onChange={set('baseUrl')}
        />
      </FieldRow>
      <FieldRow label="模型" description="可以稍后修改。">
        <input
          className={sharedStyles.input}
          aria-label="新文本 AI 模型"
          list="ai-add-text-models"
          value={draft.model}
          onChange={set('model')}
        />
        <datalist id="ai-add-text-models">
          {(template?.models ?? []).map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      </FieldRow>
      <div className={styles.formFooter}>
        {error ? (
          <span role="alert" className={styles.statusError}>
            {error}
          </span>
        ) : (
          <span className={styles.statusMuted}>添加后在新面板里填写 API Key。</span>
        )}
        <div className={styles.footerButtons}>
          <button
            type="button"
            className={sharedStyles.secondaryButton}
            onClick={() => setOpen(false)}
          >
            取消
          </button>
          <button
            type="button"
            className={sharedStyles.primaryButton}
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

export default AddTextProvider;
