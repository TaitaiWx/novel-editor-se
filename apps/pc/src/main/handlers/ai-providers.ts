/**
 * AI Provider 配置 / 一次性补全 / 流式输出 IPC
 *
 * - ai-providers-list / get / set / test：设置中心「AI 服务」；Key 只写不读，返回值只有 configured
 * - ai-providers-add-custom / remove-custom：自己添加的服务——OpenAI 兼容文本 AI（custom-text-<n>），
 *   或沿用内置厂商实现的视频 / 图片 / 语音服务（custom-video-<n> / custom-image-<n> / custom-speech-<n>）；
 *   全部字段由主进程校验，改名走 set { label }
 * - ai-providers-set-default：选定默认写作 AI（null 恢复内置默认）；变化后广播 settings-updated，
 *   让各窗口的 AI 可用状态（useAiConfig）重新读取
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
  type AICustomProviderInput,
  type AIIpcResult,
  type AIProviderInfo,
  type AIProviderUpdate,
  type AIStreamEvent,
} from '../../shared/ai';
import { getAIService } from '../ai/runtime';
import { SETTINGS_CENTER_KEY } from '../ai/settings-secrets';
import type { AIService } from '../ai/service';

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
  ipcMain.handle(
    'ai-providers-list',
    (): Promise<AIIpcResult<AIProviderInfo[]>> => guard(() => getService().listProviders())
  );
  ipcMain.handle('ai-providers-get', (_event, providerId: unknown) =>
    guard(() => getService().getProviderInfo(String(providerId)))
  );
  ipcMain.handle('ai-providers-set', (_event, providerId: unknown, update: AIProviderUpdate) =>
    guardAndNotify(() => getService().updateProvider(String(providerId), update))
  );
  ipcMain.handle(
    'ai-providers-add-custom',
    (_event, input: AICustomProviderInput): Promise<AIIpcResult<AIProviderInfo>> =>
      guardAndNotify(() => getService().addCustomProvider(input))
  );
  ipcMain.handle('ai-providers-remove-custom', (_event, providerId: unknown) =>
    guardAndNotify(() => ({ removed: getService().removeCustomProvider(providerId) }))
  );
  ipcMain.handle(
    'ai-providers-set-default',
    (_event, providerId: unknown): Promise<AIIpcResult<AIProviderInfo[]>> =>
      guardAndNotify(() => {
        const service = getService();
        service.setDefaultTextProvider(providerId);
        return service.listProviders();
      })
  );
  ipcMain.handle('ai-providers-test', (_event, providerId: unknown) =>
    guard(async () => {
      const started = Date.now();
      await getService().testProvider(String(providerId), AbortSignal.timeout(30_000));
      return { latencyMs: Date.now() - started };
    })
  );
  ipcMain.handle(
    'ai-complete',
    (_event, payload: AICompletePayload): Promise<AIIpcResult<AICompleteResult>> =>
      guard(async () => {
        const result = await getService().complete(payload);
        return { text: result.text, model: result.model, finishReason: result.finishReason };
      })
  );
  ipcMain.handle('ai-stream-start', (event, payload: AICompletePayload) =>
    guard(() => ({ streamId: streams.start(toSender(event.sender), payload) }))
  );
  ipcMain.handle('ai-stream-cancel', (event, streamId: unknown) =>
    guard(() => ({ cancelled: streams.cancel(streamId, event.sender.id) }))
  );
  return streams;
}
