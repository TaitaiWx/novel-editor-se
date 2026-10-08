/**
 * 自定义视频 / 图片 / 语音服务（作者添加的第二个 Seedance 账号、自建的 OpenAI 兼容配音等）
 *
 * - 登记在 ai-providers.json 的 customMedia（id / 类型 / 沿用的厂商实现 / 名称），地址 / 模型 / 单价 / 声音在 providers[id]
 * - Key 在 CredentialStore，按 id（custom-<kind>-<n>）隔离；编号只增不减，删除后不复用
 * - 运行时把登记同步为注册表里的 Provider（registerVariant：沿用内置厂商的工厂，只换 id 与名称）
 */
import {
  BUILTIN_PROVIDERS,
  providerEnvKey,
  type ProviderDescriptor,
  type ProviderRegistry,
} from '@novel-editor/ai';
import {
  CUSTOM_MEDIA_KINDS,
  isCustomMediaId,
  type CustomMediaKind,
  type CustomMediaProfile,
  type ProviderConfigStore,
} from './provider-config';

/** 某一类可以沿用的厂商实现（内置的同类服务） */
export function customMediaVendors(kind: CustomMediaKind): ProviderDescriptor[] {
  return BUILTIN_PROVIDERS.filter((item) => item.kind === kind);
}

/** 校验厂商实现：必须是同类的内置服务 */
export function resolveCustomMediaVendor(
  kind: unknown,
  vendor: unknown
): { kind: CustomMediaKind; vendor: ProviderDescriptor } {
  if (typeof kind !== 'string' || !(CUSTOM_MEDIA_KINDS as readonly string[]).includes(kind)) {
    throw new Error('无效的服务类型');
  }
  const mediaKind = kind as CustomMediaKind;
  const found = customMediaVendors(mediaKind).find((item) => item.id === vendor);
  if (!found) throw new Error('请选择支持的服务类型');
  return { kind: mediaKind, vendor: found };
}

export function customMediaDescriptor(
  profile: CustomMediaProfile,
  vendor: ProviderDescriptor
): ProviderDescriptor {
  return {
    ...vendor,
    id: profile.id,
    label: profile.label,
    description: `${vendor.label} 接口（自己添加）`,
    envKey: providerEnvKey(profile.id),
  };
}

/**
 * 让注册表里的自定义媒体服务与配置文件一致：新增 / 改名的重新登记，已删除的移除；
 * 厂商实现已不存在（旧版本数据）的登记跳过
 */
export function syncCustomMediaProviders(
  registry: ProviderRegistry,
  configs: ProviderConfigStore
): CustomMediaProfile[] {
  const profiles = configs.listCustomMedia();
  const wanted = new Set(profiles.map((item) => item.id));
  for (const descriptor of registry.list()) {
    if (isCustomMediaId(descriptor.id) && !wanted.has(descriptor.id)) {
      registry.unregister(descriptor.id);
    }
  }
  for (const profile of profiles) {
    const vendor = customMediaVendors(profile.kind).find((item) => item.id === profile.vendor);
    if (!vendor || !registry.has(vendor.id)) continue;
    const current = registry.get(profile.id);
    if (current && current.label === profile.label) continue;
    registry.registerVariant(vendor.id, customMediaDescriptor(profile, vendor));
  }
  return profiles;
}

/** 自定义媒体服务沿用的厂商实现 id（不是自定义媒体服务时返回 undefined） */
export function customMediaVendorOf(
  configs: ProviderConfigStore,
  providerId: string
): string | undefined {
  if (!isCustomMediaId(providerId)) return undefined;
  return configs.listCustomMedia().find((item) => item.id === providerId)?.vendor;
}

export { isCustomMediaId };
