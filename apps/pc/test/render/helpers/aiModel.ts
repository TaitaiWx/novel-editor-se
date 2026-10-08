/**
 * 测试用的模型列表行（AIProviderInfo）：补齐 capability / vendor / providerLabel / isDefault，
 * capability 始终跟随 kind
 */
import type { AIProviderInfo } from '@/shared/ai';

type ModelInfoInput = Omit<
  AIProviderInfo,
  'capability' | 'vendor' | 'providerLabel' | 'isDefault' | 'useProxy'
> &
  Partial<Pick<AIProviderInfo, 'vendor' | 'providerLabel' | 'isDefault' | 'useProxy'>>;

export function modelInfo(input: ModelInfoInput): AIProviderInfo {
  return {
    vendor: input.id,
    providerLabel: input.label,
    isDefault: Boolean(input.isDefaultText),
    useProxy: false,
    ...input,
    capability: input.kind,
  };
}
