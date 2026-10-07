/**
 * OpenAI 兼容的对话补全 Provider（`POST {baseUrl}/chat/completions`）
 *
 * 行为与旧版主进程 handlers/ai.ts 的 invokeConfiguredAI 一致：
 * - 请求体 { model, temperature, max_tokens, messages }
 * - 响应 choices[0].message.content，可能是字符串或 [{ text }] 数组
 * - 错误信息优先取 error.message，否则「AI 请求失败 (HTTP n)」
 * 新增：流式输出（stream: true + SSE）、取消、超时与重试。
 * OpenAI、DeepSeek、OpenRouter、xAI Grok 等均使用该协议。
 */
import { AIError } from '../errors';
import { createHttpClient, NO_RETRY, type HttpClient } from '../http';
import { parseSSEStream } from '../sse';
import type {
  CallOptions,
  CompletionRequest,
  CompletionResult,
  ProviderConfig,
  StreamChunk,
  TextProvider,
  TokenUsage,
} from '../types';

export const OPENAI_COMPATIBLE_DEFAULTS = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-5.4-mini',
  temperature: 1.3,
  maxTokens: 8192,
  /** 一次性补全：长回复可能需要数分钟 */
  completeTimeoutMs: 300_000,
  /** 流式：等待响应头的超时 */
  streamConnectTimeoutMs: 60_000,
  /** 流式：两个分片之间的最长间隔 */
  streamIdleTimeoutMs: 120_000,
} as const;

type MessageContent = string | Array<{ text?: string; type?: string }> | null | undefined;

interface ChatCompletionResponse {
  model?: string;
  choices?: Array<{ message?: { content?: MessageContent }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

interface ChatCompletionChunk {
  model?: string;
  choices?: Array<{
    delta?: { content?: MessageContent; reasoning_content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: ChatCompletionResponse['usage'] | null;
  error?: { message?: string; code?: string | number };
}

function contentToText(content: MessageContent): string {
  if (Array.isArray(content)) return content.map((item) => item?.text || '').join('');
  return typeof content === 'string' ? content : '';
}

function mapUsage(
  usage: ChatCompletionResponse['usage'] | null | undefined
): TokenUsage | undefined {
  if (!usage) return undefined;
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

export interface OpenAICompatibleOptions extends ProviderConfig {
  /** Provider id（grok 等复用本实现时传入自己的 id） */
  id?: string;
  /** 默认 baseUrl / 模型（未在 config 中指定时使用） */
  defaults?: { baseUrl: string; model: string };
}

/** 构造 /chat/completions 请求体（导出供测试做请求映射快照） */
export function buildChatCompletionBody(
  request: CompletionRequest,
  config: { model: string; temperature?: number; maxTokens?: number },
  stream: boolean
): Record<string, unknown> {
  return {
    model: (request.model ?? config.model).trim(),
    temperature:
      typeof request.temperature === 'number'
        ? request.temperature
        : typeof config.temperature === 'number'
          ? config.temperature
          : OPENAI_COMPATIBLE_DEFAULTS.temperature,
    max_tokens:
      typeof request.maxTokens === 'number'
        ? request.maxTokens
        : typeof config.maxTokens === 'number'
          ? config.maxTokens
          : OPENAI_COMPATIBLE_DEFAULTS.maxTokens,
    messages: request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
  };
}

export function createOpenAICompatibleProvider(options: OpenAICompatibleOptions): TextProvider {
  const id = options.id ?? 'openai-compatible';
  const defaults = options.defaults ?? OPENAI_COMPATIBLE_DEFAULTS;
  const apiKey = options.apiKey?.trim() ?? '';
  const baseUrl = (options.baseUrl?.trim() || defaults.baseUrl).replace(/\/+$/, '');
  const model = options.model?.trim() || defaults.model;
  if (!apiKey) {
    throw new AIError({ kind: 'not-configured', message: '未配置 AI Key', providerId: id });
  }

  const makeClient = (timeoutMs: number): HttpClient =>
    createHttpClient({
      providerId: id,
      baseUrl,
      headers: { Authorization: `Bearer ${apiKey}` },
      fetch: options.fetch,
      timeoutMs: options.timeoutMs ?? timeoutMs,
      retry: options.retry,
      sleep: options.sleep,
    });
  const completeClient = makeClient(OPENAI_COMPATIBLE_DEFAULTS.completeTimeoutMs);
  const streamClient = makeClient(OPENAI_COMPATIBLE_DEFAULTS.streamConnectTimeoutMs);
  const config = { model, temperature: options.temperature, maxTokens: options.maxTokens };

  const complete = async (
    request: CompletionRequest,
    call: CallOptions = {}
  ): Promise<CompletionResult> => {
    const json = await completeClient.json<ChatCompletionResponse>(
      'POST',
      '/chat/completions',
      buildChatCompletionBody(request, config, false),
      { signal: call.signal }
    );
    const choice = json.choices?.[0];
    return {
      text: contentToText(choice?.message?.content),
      model: json.model,
      finishReason: choice?.finish_reason ?? undefined,
      usage: mapUsage(json.usage),
    };
  };

  async function* stream(
    request: CompletionRequest,
    call: CallOptions = {}
  ): AsyncGenerator<StreamChunk> {
    const response = await streamClient.stream(
      '/chat/completions',
      buildChatCompletionBody(request, config, true),
      { signal: call.signal }
    );
    if (!response.body) {
      throw new AIError({
        kind: 'invalid-response',
        message: 'AI 服务没有返回流式内容',
        providerId: id,
      });
    }
    let finishReason: string | undefined;
    let usage: TokenUsage | undefined;
    let responseModel: string | undefined;
    for await (const event of parseSSEStream(response.body, {
      signal: call.signal,
      idleTimeoutMs: OPENAI_COMPATIBLE_DEFAULTS.streamIdleTimeoutMs,
    })) {
      const data = event.data.trim();
      if (!data) continue;
      if (data === '[DONE]') break;
      let chunk: ChatCompletionChunk;
      try {
        chunk = JSON.parse(data) as ChatCompletionChunk;
      } catch {
        throw new AIError({
          kind: 'invalid-response',
          message: `AI 服务返回了无法解析的流式数据: ${data.slice(0, 120)}`,
          providerId: id,
        });
      }
      if (chunk.error) {
        throw new AIError({
          kind: 'server',
          message: chunk.error.message || 'AI 流式输出中断',
          code: chunk.error.code !== undefined ? String(chunk.error.code) : undefined,
          providerId: id,
          retryable: false,
        });
      }
      responseModel = chunk.model ?? responseModel;
      usage = mapUsage(chunk.usage) ?? usage;
      const choice = chunk.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      const text = contentToText(choice?.delta?.content);
      if (text) yield { type: 'delta', text };
    }
    if (call.signal?.aborted) {
      throw new AIError({ kind: 'aborted', message: '请求已取消', providerId: id });
    }
    yield { type: 'done', finishReason, usage, model: responseModel };
  }

  return {
    id,
    kind: 'text',
    complete,
    stream,
    async testConnection(call: CallOptions = {}) {
      // 用 1 token 的补全验证 Key + 模型（部分兼容服务没有 /models 接口）
      await completeClient.json<ChatCompletionResponse>(
        'POST',
        '/chat/completions',
        buildChatCompletionBody(
          { messages: [{ role: 'user', content: 'ping' }], maxTokens: 1, temperature: 0 },
          config,
          false
        ),
        { signal: call.signal, retry: NO_RETRY }
      );
    },
  };
}
