/**
 * 内置 OpenAI 兼容文本 AI 的表单：服务预设、接口地址、模型（推荐 + 手填）、Key + 与其他文本服务相同的「生成参数」。
 * 地址 / 模型 / 温度等保存在设置中心 JSON（与旧版一致），Key 只写不读（ApiKeyField）。
 */
import React from 'react';
import type { AIPresetKey, SettingsDraft } from '../../../utils/appSettings';
import { AI_PRESET_OPTIONS, type AIPresetOption } from '../constants';
import type { SettingsFormApi } from '../useSettingsForm';
import Select from '../../Select';
import sharedStyles from '../styles.module.scss';
import ApiKeyField from './ApiKeyField';
import FieldRow from './FieldRow';
import GenerationParams from './GenerationParams';
import styles from './styles.module.scss';

interface BuiltinTextFormProps {
  aiSettings: SettingsDraft['ai'];
  activeAIPreset: AIPresetOption;
  setAI: SettingsFormApi['setAI'];
  applyAIPreset: (presetKey: AIPresetKey) => void;
  aiSaveStatus: string;
  handleSaveAISettings: () => Promise<void>;
  /** Key 保存 / 清除后刷新服务列表 */
  onKeyChanged: () => void;
}

const BuiltinTextForm: React.FC<BuiltinTextFormProps> = ({
  aiSettings,
  activeAIPreset,
  setAI,
  applyAIPreset,
  aiSaveStatus,
  handleSaveAISettings,
  onKeyChanged,
}) => (
  <div className={styles.form}>
    <FieldRow label="服务预设" description="选择常见服务后，自动填入推荐的接口地址和模型。">
      <Select<AIPresetKey>
        block
        size="lg"
        aria-label="服务预设"
        value={aiSettings.preset || 'openai-official'}
        options={AI_PRESET_OPTIONS.map((preset) => ({ value: preset.key, label: preset.label }))}
        onChange={(value) => applyAIPreset(value)}
      />
    </FieldRow>

    <FieldRow label="接口地址" description="服务提供方的 API 地址，例如 https://api.openai.com/v1">
      <input
        className={sharedStyles.input}
        aria-label="接口地址"
        value={aiSettings.baseUrl}
        onChange={(e) => setAI('baseUrl', e.target.value)}
        placeholder="https://api.openai.com/v1"
      />
    </FieldRow>

    <FieldRow label="模型名称" description="可从推荐模型中选择，也可以手动填写。">
      <div className={styles.dualInputGroup}>
        <Select
          block
          size="lg"
          aria-label="模型名称"
          value={activeAIPreset.models.includes(aiSettings.model) ? aiSettings.model : '__custom__'}
          options={[
            ...activeAIPreset.models.map((model) => ({
              value: model,
              label: model === 'deepseek-chat' ? 'deepseek-chat / DeepSeek-V3.2' : model,
            })),
            ...(aiSettings.preset !== 'deepseek-official'
              ? [{ value: '__custom__', label: '手动输入' }]
              : []),
          ]}
          onChange={(newModel) => {
            if (newModel === '__custom__') return;
            setAI('model', newModel);
            if (newModel === 'deepseek-reasoner') {
              setAI('maxTokens', 65536);
            } else if (newModel === 'deepseek-chat') {
              setAI('maxTokens', 8192);
            }
          }}
        />
        <input
          className={sharedStyles.input}
          aria-label="模型"
          value={aiSettings.model}
          onChange={(e) => setAI('model', e.target.value)}
          placeholder={
            aiSettings.preset === 'deepseek-official'
              ? 'DeepSeek 官方预设模型（固定使用 V3.2 / Reasoner）'
              : '例如：gpt-5.4-mini'
          }
          disabled={aiSettings.preset === 'deepseek-official'}
        />
      </div>
    </FieldRow>

    <FieldRow label="API Key" description="由系统钥匙串加密保存在本机，保存后不再显示明文。">
      <ApiKeyField
        providerId="openai-compatible"
        configured={Boolean(aiSettings.hasApiKey || aiSettings.apiKey?.trim())}
        onConfiguredChange={(configured) => {
          setAI('hasApiKey', configured);
          onKeyChanged();
        }}
      />
    </FieldRow>

    <GenerationParams
      providerLabel="OpenAI 兼容"
      values={{
        temperature: aiSettings.temperature,
        contextTokens: aiSettings.contextTokens,
        maxTokens: aiSettings.maxTokens,
      }}
      onChange={(key, value) => setAI(key, value)}
    />

    <div className={styles.formFooter}>
      {aiSaveStatus ? <span className={styles.statusOk}>{aiSaveStatus}</span> : <span />}
      <button
        type="button"
        className={`${sharedStyles.primaryButton} ${styles.footerButton}`}
        onClick={handleSaveAISettings}
      >
        保存 AI 配置
      </button>
    </div>
  </div>
);

export default BuiltinTextForm;
