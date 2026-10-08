/**
 * 渲染进程选择「默认写作 AI」的唯一口径（续写、分镜、预演共用；只读 configured / enabled 标记，不涉及密钥）
 *
 * 主进程在 ai-providers-list 里给默认写作 AI 标上 isDefaultText（作者选定的，或未选择时的内置 openai-compatible），
 * defaultTextChosen 表示是作者在设置中心选定的。省略 providerId 的请求由主进程按同一规则解析。
 */
import { BUILTIN_TEXT_PROVIDER_ID, type AIProviderInfo } from '@/shared/ai';

export { BUILTIN_TEXT_PROVIDER_ID };

/** 已保存 Key 且已启用的文本服务 */
export function isUsableTextProvider(item: AIProviderInfo): boolean {
  return item.kind === 'text' && item.configured && item.enabled;
}

/** 作者选定的默认写作 AI（可用时）；未选择或不可用时返回 null */
export function chosenDefaultTextProvider(
  providers: readonly AIProviderInfo[]
): AIProviderInfo | null {
  return providers.find((item) => item.defaultTextChosen && isUsableTextProvider(item)) ?? null;
}

/** 默认写作 AI：选定的 > 内置默认 > 第一个可用的文本服务；都没有时返回 null */
export function pickDefaultTextProvider(
  providers: readonly AIProviderInfo[]
): AIProviderInfo | null {
  const usable = providers.filter(isUsableTextProvider);
  return (
    usable.find((item) => item.isDefaultText) ??
    usable.find((item) => item.id === BUILTIN_TEXT_PROVIDER_ID) ??
    usable[0] ??
    null
  );
}

/**
 * 请求里要传的 providerId：选中的就是主进程会解析到的默认写作 AI 时省略（undefined），
 * 让主进程沿用默认 AI 的设置（总开关、内置服务的温度等）；否则显式传 id
 */
export function providerIdForRequest(
  providers: readonly AIProviderInfo[],
  item: AIProviderInfo
): string | undefined {
  const defaultId =
    providers.find((entry) => entry.isDefaultText)?.id ??
    // 旧数据 / 测试替身没有 isDefaultText 标记：内置服务就是默认
    (providers.some((entry) => entry.defaultTextChosen) ? undefined : BUILTIN_TEXT_PROVIDER_ID);
  return item.id === defaultId ? undefined : item.id;
}
