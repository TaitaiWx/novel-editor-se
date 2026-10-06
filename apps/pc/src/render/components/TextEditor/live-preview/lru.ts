/**
 * 极简 LRU 缓存：基于 Map 的插入顺序，命中时移到末尾，超出容量淘汰最旧项。
 * 附带命中 / 未命中计数，供单测与性能排查使用。
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  hits = 0;
  misses = 0;

  constructor(private readonly capacity: number) {}

  get size(): number {
    return this.map.size;
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) {
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    // 移到末尾表示最近使用
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
    this.hits = 0;
    this.misses = 0;
  }
}
