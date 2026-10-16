import { registerWorkspaceHandler } from '../workspace-ipc';
/**
 * AI Provider 配置 / 一次性补全 / 流式输出 IPC
 *
 * - ai-providers-list / get：模型列表（每个能力一张，不含密钥，只有 configured）
 * - ai-models-add / update / remove / set-default / test：模型的增删改、每个能力的默认模型、测试连接；
 *   全部字段由主进程校验，Key 只写不读（add 可用 reuseKeyFrom 沿用同一服务商 + 地址的 Key，在主进程内复制）
 * - ai-providers-set / test：旧通道（= ai-models-update / test；内置服务 id 还没有模型时以这个 id 新建）
 * - 配置变化后广播 settings-updated，让各窗口的 AI 可用状态（useAiConfig）与模型列表重新读取
 * - ai-complete：一次性补全（可指定 providerId，例如 grok）
 * - ai-stream-start / ai-stream-cancel：流式补全，片段通过 webContents.send('ai-stream-event') 推送，
 *   只推给发起请求的窗口；窗口关闭时自动取消该窗口的所有流
 */
import { BrowserWindow, ipcMain, type WebContents } from 'electron';
import { randomUUID } from 'crypto';
import { AIError, toAIError, type StreamChunk } from '@novel-editor/ai';
import {
  AI_STREAM_EVENT,
  type AICompletePayload,
  type AICompleteResult,
  type AIIpcResult,
  type AIModelInput,
  type AIProviderInfo,
  type AIProviderUpdate,
  type AIStreamEvent,
} from '../../shared/ai';
import { getAIService } from '../ai/runtime';
import { SETTINGS_CENTER_KEY } from '../ai/settings-secrets';
import type { AIService } from '../ai/service';
import type { AIProxySettings } from '../../shared/ai-proxy';

const MAX_STREAMS_PER_SENDER = 4;

async function guard<T>(task: () => Promise<T> | T): Promise<AIIpcResult<T>> {
  try {
    return { ok: true, data: await task() };
  } catch (error) {
    return { ok: false, error: toAIError(error).toJSON() };
  }
}

export interface StreamSender {
  id: number;
  send(channel: string, payload: AIStreamEvent): void;
  isDestroyed(): boolean;
  once(event: 'destroyed', listener: () => void): void;
}

interface ActiveStream {
  controller: AbortController;
  senderId: number;
}

/** 流式会话管理（与 IPC 解耦，便于测试） */
export class AIStreamManager {
  private readonly streams = new Map<string, ActiveStream>();
  private readonly watchedSenders = new Set<number>();

  constructor(
    private readonly getService: () => AIService,
    private readonly createId: () => string = randomUUID
  ) {}

  get size(): number {
    return this.streams.size;
  }

  start(sender: StreamSender, payload: AICompletePayload): string {
    const owned = Array.from(this.streams.values()).filter((item) => item.senderId === sender.id);
    if (owned.length >= MAX_STREAMS_PER_SENDER) {
      throw new AIError({ kind: 'rate-limit', message: '同时进行的 AI 生成过多，请稍后再试' });
    }
    const controller = new AbortController();
    // 先同步创建（未配置 / 参数错误直接返回给调用方，而不是走事件）
    const iterable = this.getService().stream(payload, controller.signal);
    const streamId = this.createId();
    this.streams.set(streamId, { controller, senderId: sender.id });
    this.watchSender(sender);
    void this.pump(sender, streamId, iterable, controller.signal);
    return streamId;
  }

  cancel(streamId: unknown, senderId: number): boolean {
    if (typeof streamId !== 'string') return false;
    const stream = this.streams.get(streamId);
    if (!stream || stream.senderId !== senderId) return false;
    stream.controller.abort();
    return true;
  }

  cancelAllFor(senderId: number): void {
    for (const stream of this.streams.values()) {
      if (stream.senderId === senderId) stream.controller.abort();
    }
  }

  private watchSender(sender: StreamSender): void {
    if (this.watchedSenders.has(sender.id)) return;
    this.watchedSenders.add(sender.id);
    sender.once('destroyed', () => {
      this.watchedSenders.delete(sender.id);
      this.cancelAllFor(sender.id);
    });
  }

  private emit(sender: StreamSender, event: AIStreamEvent): void {
    if (!sender.isDestroyed()) sender.send(AI_STREAM_EVENT, event);
  }

  private async pump(
    sender: StreamSender,
    streamId: string,
    iterable: AsyncIterable<StreamChunk>,
    signal: AbortSignal
  ): Promise<void> {
    try {
      for await (const chunk of iterable) {
        if (signal.aborted) break;
        if (chunk.type === 'delta') {
          this.emit(sender, { streamId, type: 'delta', text: chunk.text });
        } else {
          this.emit(sender, {
            streamId,
            type: 'done',
            finishReason: chunk.finishReason,
            model: chunk.model,
          });
        }
      }
      if (signal.aborted) {
        this.emit(sender, {
          streamId,
          type: 'error',
          error: new AIError({ kind: 'aborted', message: '已取消' }).toJSON(),
        });
      }
    } catch (error) {
      const normalized = signal.aborted
        ? new AIError({ kind: 'aborted', message: '已取消' })
        : toAIError(error);
      this.emit(sender, { streamId, type: 'error', error: normalized.toJSON() });
    } finally {
      this.streams.delete(streamId);
    }
  }
}

function toSender(webContents: WebContents): StreamSender {
  return {
    id: webContents.id,
    send: (channel, payload) => webContents.send(channel, payload),
    isDestroyed: () => webContents.isDestroyed(),
    once: (event, listener) => {
      webContents.once(event, listener);
    },
  };
}

/** 默认写作 AI 的可用状态注入在设置中心 JSON 里：配置变化后通知各窗口重新读取 */
function notifySettingsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('settings-updated', SETTINGS_CENTER_KEY);
  }
}

/** 执行后通知（只在成功时） */
async function guardAndNotify<T>(task: () => Promise<T> | T): Promise<AIIpcResult<T>> {
  const result = await guard(task);
  if (result.ok) notifySettingsChanged();
  return result;
}

export function registerAIProviderHandlers(
  getService: () => AIService = getAIService,
  streams: AIStreamManager = new AIStreamManager(getService)
): AIStreamManager {
  const completions = new Map<string, ActiveStream>();
  const watchedSenders = new Set<number>();
  // 取消只操作本窗口的内存控制器，不能排进它正在取消的工作区任务队列。
  ipcMain.handle('ai-complete-cancel', (event, requestId: unknown) =>
    guard(() => {
      if (typeof requestId !== 'string' || !/^[\w:-]{1,100}$/.test(requestId))
        throw new AIError({ kind: 'bad-request', message: 'AI 请求标识无效' });
      const request = completions.get(`${event.sender.id}:${requestId}`);
      request?.controller.abort();
      return { cancelled: !!request };
    })
  );
  registerWorkspaceHandler(
    'ai-providers-list',
    (): Promise<AIIpcResult<AIProviderInfo[]>> => guard(() => getService().listProviders())
  );
  registerWorkspaceHandler('ai-providers-get', (_event, providerId: unknown) =>
    guard(() => getService().getProviderInfo(providerId))
  );
  registerWorkspaceHandler(
    'ai-providers-set',
    (_event, providerId: unknown, update: AIProviderUpdate) =>
      guardAndNotify(() => getService().updateProvider(providerId, update))
  );
  registerWorkspaceHandler(
    'ai-models-add',
    (_event, input: AIModelInput): Promise<AIIpcResult<AIProviderInfo>> =>
      guardAndNotify(() => getService().addModel(input))
  );
  registerWorkspaceHandler('ai-models-update', (_event, id: unknown, update: AIProviderUpdate) =>
    guardAndNotify(() => getService().updateModel(id, update))
  );
  registerWorkspaceHandler('ai-models-remove', (_event, id: unknown) =>
    guardAndNotify(() => ({ removed: getService().removeModel(id) }))
  );
  registerWorkspaceHandler(
    'ai-models-set-default',
    (_event, capability: unknown, id: unknown): Promise<AIIpcResult<AIProviderInfo[]>> =>
      guardAndNotify(() => getService().setDefaultModel(capability, id))
  );
  const test = (id: unknown) =>
    guard(async () => {
      const started = Date.now();
      await getService().testProvider(id, AbortSignal.timeout(30_000));
      return { latencyMs: Date.now() - started };
    });
  registerWorkspaceHandler('ai-models-test', (_event, id: unknown) => test(id));
  registerWorkspaceHandler(
    'ai-proxy-get',
    (): Promise<AIIpcResult<AIProxySettings>> => guard(() => getService().getProxySettings())
  );
  registerWorkspaceHandler(
    'ai-proxy-set',
    (_event, value: unknown): Promise<AIIpcResult<AIProxySettings>> =>
      guardAndNotify(() => getService().setProxySettings(value))
  );
  registerWorkspaceHandler('ai-providers-test', (_event, id: unknown) => test(id));
  registerWorkspaceHandler(
    'ai-complete',
    (event, payload: AICompletePayload): Promise<AIIpcResult<AICompleteResult>> =>
      guard(async () => {
        const timeoutMs = payload?.timeoutMs;
        if (
          timeoutMs !== undefined &&
          (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000)
        )
          throw new AIError({ kind: 'bad-request', message: 'AI 请求时间预算无效' });
        const cancellation = payload?.requestId
          ? completions.get(`${event.sender.id}:${payload.requestId}`)?.controller.signal
          : undefined;
        const deadline = timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs);
        const signals = [cancellation, deadline].filter((value): value is AbortSignal => !!value);
        const signal = signals.length ? AbortSignal.any(signals) : undefined;
        try {
          signal?.throwIfAborted();
          const result = await getService().complete(payload, signal);
          signal?.throwIfAborted();
          return { text: result.text, model: result.model, finishReason: result.finishReason };
        } catch (error) {
          if (cancellation?.aborted) throw new AIError({ kind: 'aborted', message: '已取消生成' });
          if (deadline?.aborted)
            throw new AIError({
              kind: 'timeout',
              message: '此部分生成超时，请重试；已生成的草稿会保留。',
            });
          throw error;
        }
      }),
    {
      // 在工作区任务排队之前登记，快速点击取消也能中止尚未发出的请求。
      beforeAdmission: (event, payload: AICompletePayload) => {
        if (payload?.requestId === undefined) return;
        if (typeof payload.requestId !== 'string' || !/^[\w:-]{1,100}$/.test(payload.requestId))
          throw new AIError({ kind: 'bad-request', message: 'AI 请求标识无效' });
        const key = `${event.sender.id}:${payload.requestId}`;
        if (completions.has(key))
          throw new AIError({ kind: 'bad-request', message: 'AI 请求标识重复' });
        if (
          [...completions.values()].filter((item) => item.senderId === event.sender.id).length >= 8
        )
          throw new AIError({ kind: 'rate-limit', message: '同时进行的 AI 生成过多，请稍后再试' });
        completions.set(key, { senderId: event.sender.id, controller: new AbortController() });
        if (!watchedSenders.has(event.sender.id)) {
          watchedSenders.add(event.sender.id);
          event.sender.once('destroyed', () => {
            watchedSenders.delete(event.sender.id);
            for (const request of completions.values())
              if (request.senderId === event.sender.id) request.controller.abort();
          });
        }
        return () => {
          completions.delete(key);
        };
      },
    }
  );
  registerWorkspaceHandler('ai-stream-start', (event, payload: AICompletePayload) =>
    guard(() => ({ streamId: streams.start(toSender(event.sender), payload) }))
  );
  registerWorkspaceHandler('ai-stream-cancel', (event, streamId: unknown) =>
    guard(() => ({ cancelled: streams.cancel(streamId, event.sender.id) }))
  );
  return streams;
}
