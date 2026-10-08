/**
 * 渲染进程选择模型的唯一口径（续写、分镜、预演、场景视频、配音、图片共用；只读 configured / enabled / isDefault 标记，不涉及密钥）
 *
 * 主进程在 ai-providers-list 里给每个能力的默认模型标上 isDefault（作者选定的 > 第一个可用的 > 第一个），
 * 省略模型 id 的请求由主进程按同一规则解析。
 */
import { BUILTIN_TEXT_PROVIDER_ID, type AICapability, type AIProviderInfo } from '@/shared/ai';

export { BUILTIN_TEXT_PROVIDER_ID };

/** 已保存 Key 且已启用的某类模型 */
export function isUsableModel(item: AIProviderInfo, capability: AICapability): boolean {
  return item.kind === capability && item.configured && item.enabled;
}

/** 已保存 Key 且已启用的文本模型 */
export function isUsableTextProvider(item: AIProviderInfo): boolean {
  return isUsableModel(item, 'text');
}

/** 某类可用的模型，默认模型在前（选择器的选项顺序） */
export function usableModels(
  providers: readonly AIProviderInfo[],
  capability: AICapability
): AIProviderInfo[] {
  const usable = providers.filter((item) => isUsableModel(item, capability));
  return [...usable.filter((item) => item.isDefault), ...usable.filter((item) => !item.isDefault)];
}

/** 某类的默认模型（可用时）> 第一个可用的；都没有时返回 null */
export function pickDefaultModel(
  providers: readonly AIProviderInfo[],
  capability: AICapability
): AIProviderInfo | null {
  return usableModels(providers, capability)[0] ?? null;
}

/** 默认文本模型（可用时）> 第一个可用的文本模型 */
export function pickDefaultTextProvider(
  providers: readonly AIProviderInfo[]
): AIProviderInfo | null {
  return pickDefaultModel(providers, 'text');
}

/** 选中的模型 id 存在且可用时用它，否则用默认模型 */
export function resolveModelChoice(
  providers: readonly AIProviderInfo[],
  capability: AICapability,
  chosenId: string | null | undefined
): AIProviderInfo | null {
  const chosen = chosenId
    ? providers.find((item) => item.id === chosenId && isUsableModel(item, capability))
    : undefined;
  return chosen ?? pickDefaultModel(providers, capability);
}

/**
 * 请求里要传的模型 id：选中的就是默认文本模型时省略（undefined），
 * 让主进程按默认模型处理（受「启用 AI 功能」总开关约束）；否则显式传 id
 */
export function providerIdForRequest(
  _providers: readonly AIProviderInfo[],
  item: AIProviderInfo
): string | undefined {
  return item.isDefault ? undefined : item.id;
}
