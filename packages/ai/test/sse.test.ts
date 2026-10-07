import { describe, expect, it } from 'vitest';
import { AIError } from '../src/errors';
import { parseSSEStream, SSEParser } from '../src/sse';
import { chunkedStream, collect } from './helpers';

describe('SSEParser', () => {
  it('解析 data / event / id 与多行 data', () => {
    const parser = new SSEParser();
    const events = parser.push('event: delta\nid: 7\ndata: 第一行\ndata: 第二行\n\ndata: x\n\n');
    expect(events).toEqual([
      { event: 'delta', data: '第一行\n第二行', id: '7' },
      { event: 'message', data: 'x', id: '7' },
    ]);
  });

  it('忽略注释、未知字段与空事件，data 后的单个空格被去掉', () => {
    const parser = new SSEParser();
    expect(
      parser.push(': keep-alive\nretry: 100\nfoo: bar\n\ndata:no-space\ndata:  two\n\n')
    ).toEqual([{ event: 'message', data: 'no-space\n two' }]);
  });

  it('支持 \\r\\n 与 \\r 换行，且 \\r\\n 被切在两个分片之间', () => {
    const parser = new SSEParser();
    const first = parser.push('data: a\r');
    const second = parser.push('\n\r\ndata: b\r\r');
    expect([...first, ...second]).toEqual([
      { event: 'message', data: 'a' },
      { event: 'message', data: 'b' },
    ]);
  });

  it('逐字符喂入与一次性喂入结果相同', () => {
    const text = 'data: {"a":1}\n\nevent: x\ndata: 你好\r\n\r\n: c\ndata: [DONE]\n\n';
    const whole = new SSEParser().push(text);
    const parser = new SSEParser();
    const split = Array.from(text).flatMap((ch) => parser.push(ch));
    expect(split).toEqual(whole);
    expect(whole).toHaveLength(3);
  });

  it('flush 派发最后一个没有空行结尾的事件', () => {
    const parser = new SSEParser();
    expect(parser.push('data: tail')).toEqual([]);
    expect(parser.flush()).toEqual([{ event: 'message', data: 'tail' }]);
    expect(parser.flush()).toEqual([]);
  });
});

describe('parseSSEStream', () => {
  const body = 'data: 你好，世界\n\ndata: {"x":"多字节字符被切开"}\n\ndata: [DONE]\n\n';

  it.each([1, 2, 3, 5, 64])('分片大小 %i 字节时结果一致（含 UTF-8 多字节切分）', async (size) => {
    const events = await collect(parseSSEStream(chunkedStream(body, size)));
    expect(events.map((event) => event.data)).toEqual([
      '你好，世界',
      '{"x":"多字节字符被切开"}',
      '[DONE]',
    ]);
  });

  it('接受 AsyncIterable<Uint8Array>', async () => {
    async function* source() {
      yield new TextEncoder().encode('data: a\n');
      yield new TextEncoder().encode('\ndata: b');
    }
    const events = await collect(parseSSEStream(source()));
    expect(events.map((event) => event.data)).toEqual(['a', 'b']);
  });

  it('已取消的信号立即抛出 aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      collect(parseSSEStream(chunkedStream(body), { signal: controller.signal }))
    ).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('读取过程中取消会中断等待', async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode('data: first\n\n'));
        // 之后不再有数据，模拟挂起的连接
      },
    });
    const received: string[] = [];
    const run = (async () => {
      for await (const event of parseSSEStream(stream, { signal: controller.signal })) {
        received.push(event.data);
        controller.abort();
      }
    })();
    await expect(run).rejects.toBeInstanceOf(AIError);
    expect(received).toEqual(['first']);
  });

  it('空闲超时抛出 timeout', async () => {
    const stream = new ReadableStream<Uint8Array>({ start() {} });
    await expect(collect(parseSSEStream(stream, { idleTimeoutMs: 20 }))).rejects.toMatchObject({
      kind: 'timeout',
    });
  });
});
