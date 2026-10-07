import { describe, expect, it } from 'vitest';
import { createKeyedSerialQueue } from '../../src/main/keyed-serial-queue';

/** 可手动完成的 Promise */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createKeyedSerialQueue', () => {
  it('同一 key 按调用顺序执行：后一个任务等前一个完成后才开始', async () => {
    const queue = createKeyedSerialQueue();
    const order: string[] = [];
    const first = deferred();
    const a = queue('f', async () => {
      order.push('a:start');
      await first.promise;
      order.push('a:end');
      return 'a';
    });
    const b = queue('f', async () => {
      order.push('b:start');
      return 'b';
    });
    await flush();
    expect(order).toEqual(['a:start']);
    first.resolve();
    expect(await a).toBe('a');
    expect(await b).toBe('b');
    expect(order).toEqual(['a:start', 'a:end', 'b:start']);
  });

  it('不同 key 互不阻塞', async () => {
    const queue = createKeyedSerialQueue();
    const blocker = deferred();
    const order: string[] = [];
    void queue('x', async () => {
      await blocker.promise;
      order.push('x');
    });
    await queue('y', async () => {
      order.push('y');
    });
    expect(order).toEqual(['y']);
    blocker.resolve();
  });

  it('前一个任务失败不影响后续任务，错误只返回给对应调用方；完成后释放 key', async () => {
    const queue = createKeyedSerialQueue();
    const failing = queue('f', async () => {
      throw new Error('写入失败');
    });
    const next = queue('f', async () => 'ok');
    await expect(failing).rejects.toThrow('写入失败');
    expect(await next).toBe('ok');
    await flush();
    expect(queue.size()).toBe(0);
  });
});
