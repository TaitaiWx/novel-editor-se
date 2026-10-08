/**
 * 自定义文本 AI（作者添加的 OpenAI 兼容服务：DeepSeek、通义、Kimi、本地 Ollama 等）
 *
 * - 登记在 ai-providers.json 的 customText（只有 id / 名称），地址 / 模型 / 温度等与其他服务一样在 providers[id]
 * - Key 在 CredentialStore，按 id（custom-text-<n>）隔离；编号只增不减，删除后不复用
 * - 运行时把登记同步为注册表里的动态 Provider（工厂复用 openai-compatible 协议）
 */
import {
  createOpenAICompatibleProvider,
  OPENAI_COMPATIBLE_DEFAULTS,
  providerEnvKey,
  type ProviderDescriptor,
  type ProviderRegistry,
} from '@novel-editor/ai';
import {
  CUSTOM_TEXT_ID_PREFIX,
  isCustomTextId,
  type CustomTextProfile,
  type ProviderConfigStore,
} from './provider-config';

export const CUSTOM_TEXT_DESCRIPTION = 'OpenAI 兼容接口（自己添加的文本 AI）';

export function customTextDescriptor(profile: CustomTextProfile): ProviderDescriptor {
  return {
    id: profile.id,
    kind: 'text',
    label: profile.label,
    description: CUSTOM_TEXT_DESCRIPTION,
    defaultBaseUrl: '',
    defaultModel: OPENAI_COMPATIBLE_DEFAULTS.model,
    models: [],
    envKey: providerEnvKey(profile.id),
  };
}

/**
 * 让注册表里的自定义文本 AI 与配置文件一致：新增 / 改名的重新注册，已删除的移除。
 * 每次读取列表或取 Provider 前调用（配置文件很小，读取开销可以忽略）
 */
export function syncCustomTextProviders(
  registry: ProviderRegistry,
  configs: ProviderConfigStore
): CustomTextProfile[] {
  const profiles = configs.listCustomText();
  const wanted = new Set(profiles.map((item) => item.id));
  for (const descriptor of registry.list('text')) {
    if (descriptor.id.startsWith(CUSTOM_TEXT_ID_PREFIX) && !wanted.has(descriptor.id)) {
      registry.unregister(descriptor.id);
    }
  }
  for (const profile of profiles) {
    const current = registry.get(profile.id);
    if (current && current.label === profile.label) continue;
    registry.registerText(customTextDescriptor(profile), (config) =>
      createOpenAICompatibleProvider({ ...config, id: profile.id })
    );
  }
  return profiles;
}

export { isCustomTextId };
