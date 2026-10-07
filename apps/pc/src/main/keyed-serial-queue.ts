/**
 * 按 key 串行执行异步任务：同一个 key 的任务按调用顺序依次执行，不同 key 互不阻塞。
 *
 * 用于 write-file：保存前要先异步读取旧内容（写作日志字数差），两次保存同一文件若并发执行，
 * 先发起的旧内容可能后落盘，覆盖掉新内容（例如撤销回原文后的自动保存被更早的一次保存覆盖）。
 */
export type KeyedSerialQueue = <T>(key: string, task: () => Promise<T>) => Promise<T>;

export function createKeyedSerialQueue(): KeyedSerialQueue & { readonly size: () => number } {
  const tails = new Map<string, Promise<void>>();
  const run = <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const previous = tails.get(key) ?? Promise.resolve();
    // 前一个任务失败不影响后续任务
    const result = previous.then(task, task);
    const tail = result.then(
      () => undefined,
      () => undefined
    );
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return result;
  };
  return Object.assign(run, { size: () => tails.size });
}
