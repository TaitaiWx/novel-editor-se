/**
 * 设置中心「AI」：顶部独立的总开关，下面按能力分区（文本 / 图片 / 视频 / 语音），
 * 每个服务一个可折叠面板，只显示这家需要的字段。
 *
 * - 文本：内置 OpenAI 兼容（参数在设置中心 JSON）+ Grok + 自己添加的 OpenAI 兼容服务（可多个），
 *   其中一个是默认写作 AI（「设为默认」）
 * - 展开状态记在 localStorage；没点过的：已配置或默认写作 AI 展开，其余收起
 */
import React from 'react';
import { AiOutlineApi } from 'react-icons/ai';
import type { AIPresetKey, SettingsDraft } from '../../../utils/appSettings';
import type { AIProviderInfo } from '../../../types/ai-api';
import { BUILTIN_TEXT_PROVIDER_ID } from '../../../types/ai-api';
import type { AIPresetOption } from '../constants';
import type { SettingsFormApi } from '../useSettingsForm';
import Switch from '../../Switch';
import sharedStyles from '../styles.module.scss';
import AddTextProvider from './AddTextProvider';
import BuiltinTextForm from './BuiltinTextForm';
import ProviderPanel from './ProviderPanel';
import { useAiProviders } from './useAiProviders';
import { useExpandedPanels } from './useExpandedPanels';
import VendorForm from './VendorForm';
import VoiceLanguageSetting from './VoiceLanguageSetting';
import styles from './styles.module.scss';

type ProviderKind = AIProviderInfo['kind'];

interface AiSectionProps {
  aiSettings: SettingsDraft['ai'];
  activeAIPreset: AIPresetOption;
  setSettings: SettingsFormApi['setSettings'];
  setAI: SettingsFormApi['setAI'];
  applyAIPreset: (presetKey: AIPresetKey) => void;
  aiSaveStatus: string;
  handleSaveAISettings: () => Promise<void>;
}

interface SectionDef {
  kind: ProviderKind;
  title: string;
  description: string;
}

const SECTIONS: readonly SectionDef[] = [
  {
    kind: 'text',
    title: '文本（写作 / 续写 / 分镜 / 预演）',
    description: '写作功能的主力 AI。可以添加多家，选一个作为默认。',
  },
  { kind: 'image', title: '图片', description: '人物形象、三视图、设定图与场景视频的首帧。' },
  { kind: 'video', title: '视频', description: '场景视频的镜头生成（异步任务，按厂商计费）。' },
  { kind: 'speech', title: '语音（配音）', description: '场景视频的对白配音。' },
];

/** 主进程列表还没读到时，内置文本 AI 用设置草稿兜底显示 */
function builtinFallback(ai: SettingsDraft['ai']): AIProviderInfo {
  return {
    id: BUILTIN_TEXT_PROVIDER_ID,
    kind: 'text',
    label: 'OpenAI 兼容',
    description: '',
    defaultBaseUrl: '',
    defaultModel: '',
    models: [],
    configured: Boolean(ai.hasApiKey),
    secureStorage: true,
    enabled: ai.enabled,
    baseUrl: ai.baseUrl,
    model: ai.model,
    isDefaultText: !ai.defaultTextProviderId,
  };
}

const AiSection: React.FC<AiSectionProps> = (props) => {
  const { aiSettings, setSettings } = props;
  const api = useAiProviders();
  const panels = useExpandedPanels();

  const list = api.providers ?? [];
  const builtin = list.find((item) => item.id === BUILTIN_TEXT_PROVIDER_ID);
  const byKind = (kind: ProviderKind) =>
    kind === 'text'
      ? [
          builtin ?? builtinFallback(aiSettings),
          ...list.filter((item) => item.kind === 'text' && item.id !== BUILTIN_TEXT_PROVIDER_ID),
        ]
      : list.filter((item) => item.kind === kind);
  const defaultText = byKind('text').find((item) => item.isDefaultText);

  const refreshOne = async (id: string) => {
    const result = await window.electron?.ipcRenderer.invoke('ai-providers-get', id);
    if (result?.ok) api.replace(result.data);
  };

  const renderPanel = (info: AIProviderInfo) => {
    const isBuiltin = info.id === BUILTIN_TEXT_PROVIDER_ID;
    const configured = isBuiltin
      ? Boolean(aiSettings.hasApiKey || aiSettings.apiKey?.trim())
      : info.configured;
    const enabled = isBuiltin ? aiSettings.enabled && info.enabled : info.enabled;
    return (
      <ProviderPanel
        key={info.id}
        info={info}
        configured={configured}
        enabled={enabled}
        expanded={panels.isExpanded(info.id, configured || Boolean(info.isDefaultText))}
        onToggleExpanded={(next) => panels.setExpanded(info.id, next)}
        onToggleEnabled={(next) => void api.update(info.id, { enabled: next })}
        enableDisabledReason={
          isBuiltin && !aiSettings.enabled ? '先打开上方的「启用 AI 功能」' : undefined
        }
        onSetDefault={
          info.kind === 'text' ? () => void api.setDefault(isBuiltin ? null : info.id) : undefined
        }
      >
        {isBuiltin ? (
          <BuiltinTextForm {...props} onKeyChanged={() => void refreshOne(info.id)} />
        ) : (
          <VendorForm
            info={info}
            onUpdate={(patch) => api.update(info.id, patch)}
            onKeyChanged={() => void refreshOne(info.id)}
            onRemove={
              info.custom
                ? () => {
                    panels.forget(info.id);
                    void api.removeCustom(info.id);
                  }
                : undefined
            }
          />
        )}
      </ProviderPanel>
    );
  };

  return (
    <div className={`${sharedStyles.panel} ${styles.aiPanel}`}>
      <h4>
        <AiOutlineApi />
        <span>AI 设置</span>
      </h4>
      <p>按能力配置 AI 服务。Key 只保存在本机的系统钥匙串中，界面上不会再显示明文。</p>

      <div className={styles.masterRow}>
        <div className={sharedStyles.formMeta}>
          <div className={styles.masterTitle}>启用 AI 功能</div>
          <div className={sharedStyles.formDesc}>
            总开关。关闭后，写作功能的默认 AI（续写、分镜、灵感、推演等）不再发送请求。
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

      {api.error && <div className={styles.statusError}>加载 AI 服务失败：{api.error}</div>}

      {SECTIONS.map((section) => {
        const items = byKind(section.kind);
        if (section.kind !== 'text' && items.length === 0 && api.providers === null) return null;
        return (
          <section
            key={section.kind}
            className={styles.capability}
            aria-labelledby={`ai-section-${section.kind}`}
          >
            <div className={styles.capabilityHeader}>
              <h5 id={`ai-section-${section.kind}`} className={styles.capabilityTitle}>
                {section.title}
              </h5>
              {section.kind === 'text' && defaultText && (
                <span className={styles.capabilityMeta}>默认写作 AI：{defaultText.label}</span>
              )}
            </div>
            <p className={styles.capabilityDesc}>{section.description}</p>
            {section.kind === 'speech' && (
              <div className={styles.sectionSetting}>
                <VoiceLanguageSetting />
              </div>
            )}
            <div className={styles.panelList}>{items.map(renderPanel)}</div>
            {section.kind === 'text' && api.providers !== null && (
              <AddTextProvider
                onAdd={api.addCustom}
                onAdded={(info) => panels.setExpanded(info.id, true)}
              />
            )}
          </section>
        );
      })}
    </div>
  );
};

export default AiSection;
