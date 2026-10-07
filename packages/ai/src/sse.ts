/**
 * Server-Sent Events 解析器（按 WHATWG 规范的子集）
 *
 * - 网络分片可能在任意字节处切开（包括多字节 UTF-8 字符中间、`\r\n` 中间），
 *   用 TextDecoder stream 模式 + 行缓冲处理
 * - 支持 `\n` / `\r\n` / `\r` 换行、多行 data、`:` 注释、event / id 字段
 * - 空行派发事件；流结束时丢弃未以空行结束的残留（与浏览器 EventSource 一致），
 *   但为了兼容不规范的服务端，`flush()` 会把最后一个只差空行的事件派发出去
 */
import { AIError } from './errors';

export interface SSEEvent {
  event: string;
  data: string;
  id?: string;
}

export class SSEParser {
  private buffer = '';
  private dataLines: string[] = [];
  private eventName = '';
  private lastId: string | undefined;
  /** 上一块以 \r 结尾时，下一块开头的 \n 属于同一个换行 */
  private pendingCR = false;

  /** 喂入一段文本，返回其中完整的事件 */
  push(chunk: string): SSEEvent[] {
    let text = chunk;
    if (this.pendingCR && text.startsWith('\n')) text = text.slice(1);
    this.pendingCR = false;
    this.buffer += text;
    const events: SSEEvent[] = [];
    let start = 0;
    for (let i = 0; i < this.buffer.length; i += 1) {
      const ch = this.buffer[i];
      if (ch !== '\n' && ch !== '\r') continue;
      const line = this.buffer.slice(start, i);
      if (ch === '\r') {
        if (i + 1 < this.buffer.length) {
          if (this.buffer[i + 1] === '\n') i += 1;
        } else {
          this.pendingCR = true;
        }
      }
      start = i + 1;
      const event = this.processLine(line);
      if (event) events.push(event);
    }
    this.buffer = this.buffer.slice(start);
    return events;
  }

  /** 流结束：派发最后一个未以空行结束的事件 */
  flush(): SSEEvent[] {
    const events: SSEEvent[] = [];
    if (this.buffer) {
      const event = this.processLine(this.buffer);
      if (event) events.push(event);
      this.buffer = '';
    }
    const last = this.dispatch();
    if (last) events.push(last);
    return events;
  }

  private processLine(line: string): SSEEvent | null {
    if (line === '') return this.dispatch();
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    switch (field) {
      case 'data':
        this.dataLines.push(value);
        break;
      case 'event':
        this.eventName = value;
        break;
      case 'id':
        if (!value.includes('\0')) this.lastId = value;
        break;
      default:
        // retry 与未知字段忽略
        break;
    }
    return null;
  }

  private dispatch(): SSEEvent | null {
    if (this.dataLines.length === 0) {
      this.eventName = '';
      return null;
    }
    const event: SSEEvent = {
      event: this.eventName || 'message',
      data: this.dataLines.join('\n'),
      ...(this.lastId !== undefined ? { id: this.lastId } : {}),
    };
    this.dataLines = [];
    this.eventName = '';
    return event;
  }
}

type ByteSource = ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;

function isReadableStream(source: ByteSource): source is ReadableStream<Uint8Array> {
  return typeof (source as ReadableStream<Uint8Array>).getReader === 'function';
}

async function* iterateBytes(source: ByteSource): AsyncGenerator<Uint8Array> {
  if (!isReadableStream(source)) {
    yield* source;
    return;
  }
  const reader = source.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    // 提前结束（break / 取消）时释放底层连接
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export interface ParseSSEOptions {
  signal?: AbortSignal;
  /** 两个分片之间的最长间隔，超过视为超时（0 / 未设置 = 不限制） */
  idleTimeoutMs?: number;
}

/** 带空闲超时与取消的分片读取 */
async function* guardedBytes(
  source: ByteSource,
  options: ParseSSEOptions
): AsyncGenerator<Uint8Array> {
  const iterator = iterateBytes(source)[Symbol.asyncIterator]();
  try {
    for (;;) {
      if (options.signal?.aborted) {
        throw new AIError({ kind: 'aborted', message: '请求已取消' });
      }
      const next = iterator.next();
      const racers: Array<Promise<IteratorResult<Uint8Array>>> = [next];
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      if (options.idleTimeoutMs && options.idleTimeoutMs > 0) {
        racers.push(
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new AIError({ kind: 'timeout', message: 'AI 流式输出长时间无响应' })),
              options.idleTimeoutMs
            );
          })
        );
      }
      if (options.signal) {
        const signal = options.signal;
        racers.push(
          new Promise((_, reject) => {
            onAbort = () => reject(new AIError({ kind: 'aborted', message: '请求已取消' }));
            signal.addEventListener('abort', onAbort, { once: true });
          })
        );
      }
      let result: IteratorResult<Uint8Array>;
      try {
        result = await Promise.race(racers);
      } finally {
        if (timer) clearTimeout(timer);
        if (onAbort) options.signal?.removeEventListener('abort', onAbort);
      }
      if (result.done) return;
      yield result.value;
    }
  } finally {
    void iterator.return?.(undefined);
  }
}

/** 把字节流解析为 SSE 事件序列 */
export async function* parseSSEStream(
  source: ByteSource,
  options: ParseSSEOptions = {}
): AsyncGenerator<SSEEvent> {
  const decoder = new TextDecoder('utf-8');
  const parser = new SSEParser();
  for await (const bytes of guardedBytes(source, options)) {
    const text = decoder.decode(bytes, { stream: true });
    for (const event of parser.push(text)) yield event;
  }
  const tail = decoder.decode();
  for (const event of parser.push(tail)) yield event;
  for (const event of parser.flush()) yield event;
}
