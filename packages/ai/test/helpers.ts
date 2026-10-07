/**
 * 测试工具：可编排的 mock fetch、分片 SSE 响应
 */
import { vi } from 'vitest';
import type { FetchLike } from '../src/http';

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export type MockReply =
  | Response
  | Error
  | ((request: RecordedRequest, init?: RequestInit) => Response | Promise<Response>);

/** 按顺序返回 replies（最后一个会被重复使用），记录每次请求 */
export function mockFetch(...replies: MockReply[]) {
  const requests: RecordedRequest[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = Object.fromEntries(
      Object.entries((init?.headers as Record<string, string> | undefined) ?? {})
    );
    const request: RecordedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    };
    requests.push(request);
    const reply = replies[Math.min(requests.length - 1, replies.length - 1)];
    if (reply instanceof Error) throw reply;
    if (typeof reply === 'function') return reply(request, init);
    return reply.clone();
  });
  return { fetch: fn as unknown as FetchLike & typeof fn, requests };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 把文本按给定的字节切分点拆成流（模拟网络分片，可切在多字节字符中间） */
export function chunkedStream(
  text: string,
  chunkSize = 7,
  signal?: AbortSignal
): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (signal?.aborted) {
        controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        return;
      }
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

export function sseResponse(events: string[], chunkSize = 7): Response {
  const body = events.map((data) => `data: ${data}\n\n`).join('');
  return new Response(chunkedStream(body, chunkSize), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

/** 立即完成的 sleep（记录等待时长） */
export function instantSleep() {
  const delays: number[] = [];
  const sleep = async (ms: number) => {
    delays.push(ms);
  };
  return { sleep, delays };
}

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}
