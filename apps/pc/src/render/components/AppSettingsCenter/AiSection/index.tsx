/**
 * 设置中心「AI」：顶部独立的总开关，下面每个能力（文本 / 图片 / 视频 / 语音）一张模型列表。
 *
 * - 一行 = 一个可选用的模型（服务商预设 + 接口地址 + 模型 + Key），可以同时配置多个，各功能里按显示名称选择
 * - 每个能力一个默认模型（「设为默认」）；功能里没有特别选择时使用它
 * - 「添加模型」：选服务商预填地址与推荐模型；同一服务商 + 地址已有 Key 时可沿用
 * - Grok、DeepSeek、通义等只是 OpenAI 兼容协议的预设，不再有单独的服务面板
 */
import React, { useState } from 'react';
import { AiOutlineApi } from 'react-icons/ai';
import type { SettingsDraft } from '../../../utils/appSettings';
import type { AICapability, AIProviderInfo } from '../../../types/ai-api';
import type { SettingsFormApi } from '../useSettingsForm';
import Switch from '../../Switch';
import sharedStyles from '../styles.module.scss';
import AddModelForm from './AddModelForm';
import ModelRow from './ModelRow';
import { useAiModels } from './useAiModels';
import VoiceLanguageSetting from './VoiceLanguageSetting';
import styles from './styles.module.scss';

interface AiSectionProps {
  aiSettings: SettingsDraft['ai'];
  setSettings: SettingsFormApi['setSettings'];
}

interface SectionDef {
  capability: AICapability;
  title: string;
  description: string;
  empty: string;
}

const SECTIONS: readonly SectionDef[] = [
  {
    capability: 'text',
    title: '文本（写作 / 续写 / 分镜 / 预演）',
    description: '可以同时配置多个模型（例如 Grok 写续写、DeepSeek 做整理），选一个作为默认。',
    empty:
      '还没有文本模型。点「添加模型」，选服务商（OpenAI、DeepSeek、Grok、通义…）并填写 Key 即可使用。',
  },
  {
    capability: 'image',
    title: '图片',
    description: '人物形象、三视图、设定图与场景视频的首帧。',
    empty: '还没有图片模型。点「添加模型」选择 Seedream、MiniMax 或 Grok。',
  },
  {
    capability: 'video',
    title: '视频',
    description: '场景视频的镜头生成（异步任务，按厂商计费）。',
    empty: '还没有视频模型。点「添加模型」选择 MiniMax 海螺或 Seedance。',
  },
  {
    capability: 'speech',
    title: '语音（配音）',
    description: '场景视频的对白配音。',
    empty: '还没有配音模型。点「添加模型」选择 OpenAI 兼容或 MiniMax。',
  },
];

const AiSection: React.FC<AiSectionProps> = ({ aiSettings, setSettings }) => {
  const api = useAiModels();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const byCapability = (capability: AICapability): AIProviderInfo[] =>
    (api.models ?? []).filter((item) => item.kind === capability);

  return (
    <div className={`${sharedStyles.panel} ${styles.aiPanel}`}>
      <h4>
        <AiOutlineApi />
        <span>AI 设置</span>
      </h4>
      <p>按能力配置模型。Key 只保存在本机的系统钥匙串中，界面上不会再显示明文。</p>

      <div className={styles.masterRow}>
        <div className={sharedStyles.formMeta}>
          <div className={styles.masterTitle}>启用 AI 功能</div>
          <div className={sharedStyles.formDesc}>
            总开关。关闭后，写作功能的默认模型（续写、分镜、灵感、推演等）不再发送请求。
          </div>
        </div>
        <Switch
          aria-label="启用 AI 功能"
          checked={aiSettings.enabled}
          onChange={(next) =>
            setSettings((prev) => ({
              ...prev,
              ai: { ...prev.ai, enabled: next, enabledExplicitlySet: true },
            }))
          }
        />
      </div>

      {api.error && <div className={styles.statusError}>加载 AI 模型失败：{api.error}</div>}

      {SECTIONS.map((section) => {
        const items = byCapability(section.capability);
        const defaultItem = items.find((item) => item.isDefault);
        return (
          <section
            key={section.capability}
            className={styles.capability}
            aria-labelledby={`ai-section-${section.capability}`}
            data-testid={`ai-section-${section.capability}`}
          >
            <div className={styles.capabilityHeader}>
              <h5 id={`ai-section-${section.capability}`} className={styles.capabilityTitle}>
                {section.title}
              </h5>
              {defaultItem && (
                <span className={styles.capabilityMeta}>默认：{defaultItem.label}</span>
              )}
            </div>
            <p className={styles.capabilityDesc}>{section.description}</p>
            {section.capability === 'speech' && (
              <div className={styles.sectionSetting}>
                <VoiceLanguageSetting />
              </div>
            )}
            {api.models !== null && items.length === 0 && (
              <p className={styles.emptyState}>{section.empty}</p>
            )}
            <div className={styles.panelList}>
              {items.map((info) => (
                <ModelRow
                  key={info.id}
                  info={info}
                  expanded={expandedId === info.id}
                  onToggleExpanded={() =>
                    setExpandedId((prev) => (prev === info.id ? null : info.id))
                  }
                  onUpdate={(patch) => api.update(info.id, patch)}
                  onSetDefault={() => void api.setDefault(section.capability, info.id)}
                  onTest={() => api.test(info.id)}
                  onRemove={() => void api.remove(info.id)}
                  onKeyChanged={() => void api.reload()}
                />
              ))}
            </div>
            {api.models !== null && (
              <AddModelForm
                capability={section.capability}
                existing={items}
                onAdd={api.add}
                onAdded={(info) => setExpandedId(info.configured ? null : info.id)}
              />
            )}
          </section>
        );
      })}
    </div>
  );
};

export default AiSection;
