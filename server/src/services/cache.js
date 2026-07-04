// server/src/services/cache.js
/**
 * 通用内存 LRU 缓存。
 * 存储和返回都是深拷贝副本，避免调用方污染缓存。
 * 淘汰策略：基于访问时间，超容量时移除最久未访问项。
 */
export class MemoryLRU {
  constructor(maxItems) {
    this.maxItems = maxItems;
    this.store = new Map();      // key → value（深拷贝）
    this.access = new Map();     // key → 访问序号（严格递增，避免毫秒并列）
    this._counter = 0;           // 自增计数器
  }

  _tick() {
    return ++this._counter;
  }

  _clone(value) {
    if (value === null || value === undefined) return value;
    if (Buffer.isBuffer(value)) return Buffer.from(value);
    if (value instanceof ArrayBuffer) return value.slice(0);
    if (ArrayBuffer.isView(value)) {
      return new value.constructor(value);
    }
    return structuredClone(value);
  }

  get(key) {
    if (!this.store.has(key)) return undefined;
    this.access.set(key, this._tick());
    return this._clone(this.store.get(key));
  }

  set(key, value) {
    const cloned = this._clone(value);
    this.store.set(key, cloned);
    this.access.set(key, this._tick());
    if (this.store.size > this.maxItems) {
      let oldestKey = null;
      let oldestTime = Infinity;
      for (const [k, t] of this.access) {
        if (t < oldestTime) { oldestTime = t; oldestKey = k; }
      }
      if (oldestKey !== null) {
        this.store.delete(oldestKey);
        this.access.delete(oldestKey);
      }
    }
  }

  has(key) {
    return this.store.has(key);
  }

  size() {
    return this.store.size;
  }
}
