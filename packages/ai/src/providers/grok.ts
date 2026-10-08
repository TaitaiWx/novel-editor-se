/**
 * xAI Grok 文本 Provider
 *
 * xAI 提供 OpenAI 兼容接口：`POST https://api.x.ai/v1/chat/completions`（Bearer 鉴权，支持 stream）。
 * 这里只替换默认地址与模型，协议实现复用 openai-compatible。模型名会随 xAI 发布变化，
 * 默认值仅为推荐，设置中心 / CLI `--model` 可覆盖。
 *
 * 2026-10-08 核对 https://docs.x.ai/docs/models（旗舰 grok-4.7；grok-4 / grok-3 已不在模型列表）
 * 与 https://docs.x.ai/docs/api-reference（base https://api.x.ai/v1）。
 * 文档未写明的假设：xAI 现推荐 Responses API，并把 /chat/completions 标为 deprecated（未给下线日期），
 * 这里假设 /chat/completions 对当前模型仍可用；若下线需改为 /responses。
 */
import { createOpenAICompatibleProvider } from './openai-compatible';
import type { ProviderConfig, TextProvider } from '../types';

export const GROK_DEFAULTS = {
  baseUrl: 'https://api.x.ai/v1',
  model: 'grok-4.7',
  models: ['grok-4.7', 'grok-4.6', 'grok-4.3', 'grok-4.20-0309-non-reasoning'],
} as const;

export function createGrokProvider(config: ProviderConfig): TextProvider {
  return createOpenAICompatibleProvider({
    ...config,
    id: 'grok',
    defaults: { baseUrl: GROK_DEFAULTS.baseUrl, model: GROK_DEFAULTS.model },
  });
}
