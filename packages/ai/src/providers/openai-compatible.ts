/**
 * OpenAI 兼容的对话补全 Provider（`POST {baseUrl}/chat/completions`）
 *
 * 行为与旧版主进程 handlers/ai.ts 的 invokeConfiguredAI 一致：
 * - 请求体 { model, temperature, max_tokens, messages }
 * - 响应 choices[0].message.content，可能是字符串或 [{ text }] 数组
 * - 错误信息优先取 error.message，否则「AI 请求失败 (HTTP n)」
 * 新增：流式输出（stream: true + SSE）、取消、超时与重试。
 * OpenAI、DeepSeek、OpenRouter、xAI Grok、Gemini（OpenAI 兼容端点）等均使用该协议。
 *
 * 参数差异（2026-10-09 用真实 Key 验证）：
 * - OpenAI 官方接口（api.openai.com）的新模型（gpt-5 起、o 系列）不接受 max_tokens，要用 max_completion_tokens
 *   （旧模型两者都接受），所以对 OpenAI 官方地址一律发 max_completion_tokens
 * - 推理模型（例如 gpt-6-luna）只接受默认温度 1，传其他值报 Unsupported value: 'temperature'
 * - 其他兼容服务若同样报「参数不支持」，按错误信息调整后自动重试一次，并按「地址 + 模型」记住（PARAM_QUIRKS）
 * - 推理模型用 1 token 测试会报「max_tokens or model output limit was reached」：测试连接时视为成功
 * - 推理模型（例如 deepseek-flash）先思考再回答，思考用完回复长度时正文为空（finish_reason = length）：
 *   一次补全 / 流式在没有任何正文时，自动放大回复长度重试一次（expandedBudget）
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

/**
 * 协议默认值（只在旧数据没有地址 / 模型时兜底；新添加的模型用 shared/ai-models.ts 的预设）。
 * 2026-10-08 核对 https://developers.openai.com/api/docs/models：gpt-5.4-mini 仍为可用（非弃用）模型，保持不变
 */
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

/** 不同模型 / 服务对参数的要求 */
export interface ChatParamQuirks {
  /** 回复长度参数名 */
  tokenParam: 'max_tokens' | 'max_completion_tokens';
  /** 不发送温度（只接受默认值的推理模型） */
  omitTemperature: boolean;
}

/** OpenAI 官方接口：新模型要求 max_completion_tokens（旧模型也接受） */
export function defaultQuirksFor(baseUrl: string): ChatParamQuirks {
  let host = '';
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    host = '';
  }
  return {
    tokenParam: host === 'api.openai.com' ? 'max_completion_tokens' : 'max_tokens',
    omitTemperature: false,
  };
}

/** 运行中学到的参数要求（按「地址 + 模型」记住，避免每次请求都先失败一次） */
const PARAM_QUIRKS = new Map<string, ChatParamQuirks>();

/** 测试用：清空记住的参数要求 */
export function resetChatParamQuirks(): void {
  PARAM_QUIRKS.clear();
}

/** 根据「参数不支持」的错误信息调整参数；看不出是参数问题时返回 null */
export function adjustQuirksForError(
  quirks: ChatParamQuirks,
  message: string
): ChatParamQuirks | null {
  if (/max_completion_tokens/.test(message) && quirks.tokenParam === 'max_tokens') {
    return { ...quirks, tokenParam: 'max_completion_tokens' };
  }
  if (
    /'max_completion_tokens'/.test(message) &&
    /unsupported|unrecognized|unknown/i.test(message) &&
    quirks.tokenParam === 'max_completion_tokens'
  ) {
    return { ...quirks, tokenParam: 'max_tokens' };
  }
  if (/temperature/i.test(message) && /unsupported|only the default|not support/i.test(message)) {
    return quirks.omitTemperature ? null : { ...quirks, omitTemperature: true };
  }
  return null;
}

/** 推理模型回复长度太小时的报错（测试连接时说明 Key 与模型都可用） */
export function isOutputLimitError(message: string): boolean {
  return /max_tokens or model output limit/i.test(message);
}

/** 构造 /chat/completions 请求体（导出供测试做请求映射快照） */
export function buildChatCompletionBody(
  request: CompletionRequest,
  config: { model: string; temperature?: number; maxTokens?: number },
  stream: boolean,
  quirks: ChatParamQuirks = { tokenParam: 'max_tokens', omitTemperature: false }
): Record<string, unknown> {
  const temperature =
    typeof request.temperature === 'number'
      ? request.temperature
      : typeof config.temperature === 'number'
        ? config.temperature
        : OPENAI_COMPATIBLE_DEFAULTS.temperature;
  const maxTokens =
    typeof request.maxTokens === 'number'
      ? request.maxTokens
      : typeof config.maxTokens === 'number'
        ? config.maxTokens
        : OPENAI_COMPATIBLE_DEFAULTS.maxTokens;
  return {
    model: (request.model ?? config.model).trim(),
    ...(quirks.omitTemperature ? {} : { temperature }),
    [quirks.tokenParam]: maxTokens,
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

  const quirksKey = (request: CompletionRequest) => `${baseUrl}|${(request.model ?? model).trim()}`;
  const quirksFor = (request: CompletionRequest) =>
    PARAM_QUIRKS.get(quirksKey(request)) ?? defaultQuirksFor(baseUrl);

  /** 发送请求；遇到「参数不支持」时按错误调整参数重试（最多两次：回复长度参数、温度各一次） */
  async function withQuirks<T>(
    request: CompletionRequest,
    send: (quirks: ChatParamQuirks) => Promise<T>
  ): Promise<T> {
    let quirks = quirksFor(request);
    for (let attempt = 0; ; attempt += 1) {
      try {
        const result = await send(quirks);
        if (attempt > 0) PARAM_QUIRKS.set(quirksKey(request), quirks);
        return result;
      } catch (error) {
        const next =
          attempt < 2 && error instanceof AIError && error.kind === 'bad-request'
            ? adjustQuirksForError(quirks, error.message)
            : null;
        if (!next) throw error;
        quirks = next;
      }
    }
  }

  /** 思考用完回复长度时的重试预算：放大 4 倍，至少 2048、最多 32768 */
  const expandedBudget = (request: CompletionRequest): number => {
    const current = request.maxTokens ?? config.maxTokens ?? OPENAI_COMPATIBLE_DEFAULTS.maxTokens;
    return Math.min(Math.max(current * 4, 2048), 32_768);
  };

  const complete = async (
    request: CompletionRequest,
    call: CallOptions = {},
    retried = false
  ): Promise<CompletionResult> => {
    const json = await withQuirks(request, (quirks) =>
      completeClient.json<ChatCompletionResponse>(
        'POST',
        '/chat/completions',
        buildChatCompletionBody(request, config, false, quirks),
        { signal: call.signal }
      )
    );
    const choice = json.choices?.[0];
    const text = contentToText(choice?.message?.content);
    if (!retried && !text.trim() && choice?.finish_reason === 'length') {
      return complete({ ...request, maxTokens: expandedBudget(request) }, call, true);
    }
    return {
      text,
      model: json.model,
      finishReason: choice?.finish_reason ?? undefined,
      usage: mapUsage(json.usage),
    };
  };

  interface StreamSummary {
    finishReason?: string;
    usage?: TokenUsage;
    model?: string;
  }

  async function* stream(
    request: CompletionRequest,
    call: CallOptions = {}
  ): AsyncGenerator<StreamChunk> {
    let attempt = request;
    for (let round = 0; ; round += 1) {
      const generator = streamOnce(attempt, call);
      let emitted = false;
      let next = await generator.next();
      while (!next.done) {
        emitted = true;
        yield next.value;
        next = await generator.next();
      }
      const summary = next.value;
      // 思考用完了回复长度、一个字的正文都没有：放大回复长度重试一次
      if (!emitted && summary.finishReason === 'length' && round === 0) {
        attempt = { ...attempt, maxTokens: expandedBudget(attempt) };
        continue;
      }
      yield { type: 'done', ...summary };
      return;
    }
  }

  async function* streamOnce(
    request: CompletionRequest,
    call: CallOptions
  ): AsyncGenerator<StreamChunk, StreamSummary> {
    const response = await withQuirks(request, (quirks) =>
      streamClient.stream(
        '/chat/completions',
        buildChatCompletionBody(request, config, true, quirks),
        {
          signal: call.signal,
        }
      )
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
    return { finishReason, usage, model: responseModel };
  }

  return {
    id,
    kind: 'text',
    complete: (request, call) => complete(request, call),
    stream,
    async testConnection(call: CallOptions = {}) {
      // 用很短的补全验证 Key + 模型（部分兼容服务没有 /models 接口）；
      // 推理模型可能因长度上限报错，这说明 Key 与模型都可用，视为成功
      const request: CompletionRequest = {
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 1,
        temperature: 0,
      };
      try {
        await withQuirks(request, (quirks) =>
          completeClient.json<ChatCompletionResponse>(
            'POST',
            '/chat/completions',
            buildChatCompletionBody(request, config, false, quirks),
            { signal: call.signal, retry: NO_RETRY }
          )
        );
      } catch (error) {
        if (error instanceof AIError && isOutputLimitError(error.message)) return;
        throw error;
      }
    },
  };
}
