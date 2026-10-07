import React from 'react';
import { AiOutlineApi } from 'react-icons/ai';
import type { AIPresetKey, AIProvider, SettingsDraft } from '../../../utils/appSettings';
import { AI_PRESET_OPTIONS, type AIPresetOption } from '../constants';
import type { SettingsFormApi } from '../useSettingsForm';
import ApiKeyField from './ApiKeyField';
import ProviderList from './ProviderList';
import sharedStyles from '../styles.module.scss';
import styles from './styles.module.scss';

interface AiSectionProps {
  aiSettings: SettingsDraft['ai'];
  activeAIPreset: AIPresetOption;
  setSettings: SettingsFormApi['setSettings'];
  setAI: SettingsFormApi['setAI'];
  applyAIPreset: (presetKey: AIPresetKey) => void;
  aiSaveStatus: string;
  handleSaveAISettings: () => Promise<void>;
}

/** AI 设置分区 */
const AiSection: React.FC<AiSectionProps> = ({
  aiSettings,
  activeAIPreset,
  setSettings,
  setAI,
  applyAIPreset,
  aiSaveStatus,
  handleSaveAISettings,
}) => (
  <div className={sharedStyles.panel}>
    <h4>
      <AiOutlineApi />
      <span>AI 设置</span>
    </h4>
    <p>统一配置 AI 服务、模型与回复参数，供写作辅助功能使用。</p>

    <div className={sharedStyles.formSection}>
      <div className={sharedStyles.formRow}>
        <div className={sharedStyles.formMeta}>
          <div className={sharedStyles.formLabel}>启用 AI 功能</div>
          <div className={sharedStyles.formDesc}>关闭后，AI 相关功能将不再发送请求。</div>
        </div>
        <button
          className={`${sharedStyles.switchButton} ${aiSettings.enabled ? sharedStyles.enabled : ''}`}
          onClick={() =>
            setSettings((prev) => ({
              ...prev,
              ai: {
                ...prev.ai,
                enabled: !prev.ai.enabled,
                enabledExplicitlySet: true,
              },
            }))
          }
        >
          <span className={sharedStyles.switchThumb} />
        </button>
      </div>

      <div className={sharedStyles.formRow}>
        <div className={sharedStyles.formMeta}>
          <div className={sharedStyles.formLabel}>服务预设</div>
          <div className={sharedStyles.formDesc}>
            选择常见服务后，自动填入推荐的接口地址和模型。
          </div>
        </div>
        <select
          className={sharedStyles.select}
          value={aiSettings.preset || 'openai-official'}
          onChange={(e) => applyAIPreset(e.target.value as AIPresetKey)}
        >
          {AI_PRESET_OPTIONS.map((preset) => (
            <option key={preset.key} value={preset.key}>
              {preset.label}
            </option>
          ))}
        </select>
      </div>

      <div className={sharedStyles.formRow}>
        <div className={sharedStyles.formMeta}>
          <div className={sharedStyles.formLabel}>服务类型</div>
          <div className={sharedStyles.formDesc}>
            用于匹配不同服务的接口协议。大多数服务选择 OpenAI 兼容即可。
          </div>
        </div>
        <select
          className={sharedStyles.select}
          value={aiSettings.provider}
          onChange={(e) => setAI('provider', e.target.value as AIProvider)}
        >
          <option value="openai-compatible">OpenAI 兼容</option>
          <option value="openai">OpenAI</option>
          <option value="deepseek">DeepSeek</option>
        </select>
      </div>

      <div className={sharedStyles.formRow}>
        <div className={sharedStyles.formMeta}>
          <div className={sharedStyles.formLabel}>接口地址</div>
          <div className={sharedStyles.formDesc}>
            填写服务提供方的 API 地址，例如 https://api.openai.com/v1
          </div>
        </div>
        <input
          className={sharedStyles.input}
          value={aiSettings.baseUrl}
          onChange={(e) => setAI('baseUrl', e.target.value)}
          placeholder="https://api.openai.com/v1"
        />
      </div>

      <div className={sharedStyles.formRow}>
        <div className={sharedStyles.formMeta}>
          <div className={sharedStyles.formLabel}>模型名称</div>
          <div className={sharedStyles.formDesc}>可从推荐模型中选择，也可以手动填写。</div>
        </div>
        <div className={styles.dualInputGroup}>
          <select
            className={sharedStyles.select}
            value={
              activeAIPreset.models.includes(aiSettings.model) ? aiSettings.model : '__custom__'
            }
            onChange={(e) => {
              if (e.target.value === '__custom__') return;
              const newModel = e.target.value;
              setAI('model', newModel);
              if (newModel === 'deepseek-reasoner') {
                setAI('maxTokens', 65536);
              } else if (newModel === 'deepseek-chat') {
                setAI('maxTokens', 8192);
              }
            }}
          >
            {activeAIPreset.models.map((model) => (
              <option key={model} value={model}>
                {model === 'deepseek-chat'
                  ? 'deepseek-chat / DeepSeek-V3.2'
                  : model === 'deepseek-reasoner'
                    ? 'deepseek-reasoner'
                    : model}
              </option>
            ))}
            {aiSettings.preset !== 'deepseek-official' && (
              <option value="__custom__">手动输入</option>
            )}
          </select>
          <input
            className={sharedStyles.input}
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
      </div>

      <div className={sharedStyles.formRow}>
        <div className={sharedStyles.formMeta}>
          <div className={sharedStyles.formLabel}>API Key</div>
          <div className={sharedStyles.formDesc}>
            由系统钥匙串加密保存在当前设备上，保存后不会再显示明文。
          </div>
        </div>
        <ApiKeyField
          providerId="openai-compatible"
          configured={Boolean(aiSettings.hasApiKey || aiSettings.apiKey?.trim())}
          onConfiguredChange={(configured) => setAI('hasApiKey', configured)}
        />
      </div>

      <div className={sharedStyles.formRow}>
        <div className={sharedStyles.formMeta}>
          <div className={sharedStyles.formLabel}>温度</div>
          <div className={sharedStyles.formDesc}>数值越高，回复越发散；数值越低，回复越稳定。</div>
        </div>
        <input
          className={sharedStyles.input}
          type="number"
          min="0"
          max="2"
          step="0.1"
          value={aiSettings.temperature}
          onChange={(e) => {
            // 只在无法解析（如清空输入）时回退默认值，0 是合法温度
            const value = Number.parseFloat(e.target.value);
            setAI('temperature', Number.isNaN(value) ? 1.3 : value);
          }}
        />
      </div>

      <div className={sharedStyles.formRow}>
        <div className={sharedStyles.formMeta}>
          <div className={sharedStyles.formLabel}>上下文长度</div>
          <div className={sharedStyles.formDesc}>用于控制单次请求可携带的上下文上限。</div>
        </div>
        <input
          className={sharedStyles.input}
          type="number"
          min="128000"
          max="1000000"
          step="10000"
          value={aiSettings.contextTokens}
          onChange={(e) =>
            setAI('contextTokens', Math.max(128000, Number(e.target.value) || 128000))
          }
        />
      </div>

      <div className={sharedStyles.formRow}>
        <div className={sharedStyles.formMeta}>
          <div className={sharedStyles.formLabel}>单次回复长度</div>
          <div className={sharedStyles.formDesc}>
            限制 AI 单次回复的最大长度。较长回复会消耗更多额度。
          </div>
        </div>
        <input
          className={sharedStyles.input}
          type="number"
          min="512"
          max="65536"
          step="128"
          value={aiSettings.maxTokens}
          onChange={(e) => setAI('maxTokens', Math.max(512, Number(e.target.value) || 8192))}
        />
      </div>
    </div>

    <div className={styles.aiSaveRow}>
      <button className={sharedStyles.primaryButton} onClick={handleSaveAISettings}>
        保存 AI 配置
      </button>
      {aiSaveStatus && <span className={styles.aiSaveStatus}>{aiSaveStatus}</span>}
    </div>

    <h4 className={styles.subHeading}>
      <span>更多 AI 服务</span>
    </h4>
    <p>续写（xAI Grok）与场景视频（MiniMax、Seedance）使用的服务，Key 同样只保存在本机钥匙串中。</p>
    <ProviderList />
  </div>
);

export default AiSection;
