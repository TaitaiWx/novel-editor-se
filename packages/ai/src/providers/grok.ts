/**
 * xAI Grok 文本 Provider
 *
 * xAI 提供 OpenAI 兼容接口：`POST https://api.x.ai/v1/chat/completions`（Bearer 鉴权，支持 stream）。
 * 这里只替换默认地址与模型，协议实现复用 openai-compatible。模型名会随 xAI 发布变化，
 * 默认值仅为推荐，设置中心 / CLI `--model` 可覆盖。
 */
import { createOpenAICompatibleProvider } from './openai-compatible';
import type { ProviderConfig, TextProvider } from '../types';

export const GROK_DEFAULTS = {
  baseUrl: 'https://api.x.ai/v1',
  model: 'grok-4',
  models: ['grok-4', 'grok-4-fast', 'grok-3', 'grok-3-mini'],
} as const;

export function createGrokProvider(config: ProviderConfig): TextProvider {
  return createOpenAICompatibleProvider({
    ...config,
    id: 'grok',
    defaults: { baseUrl: GROK_DEFAULTS.baseUrl, model: GROK_DEFAULTS.model },
  });
}
