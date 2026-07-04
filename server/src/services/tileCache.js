import { readFile, writeFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { config } from '../config/index.js';
import { MemoryLRU } from './cache.js';

const MAX_DISK_ITEMS = 500;       // 磁盘 LRU 索引上限（保持原值）
const MAX_MEMORY_ITEMS = 100;     // 内存热点缓存上限

class TileCache {
  constructor() {
    this.cacheDir = config.tileCacheDir;
    this.accessLog = new Map();               // key → timestamp（磁盘层）
    this.memoryCache = new MemoryLRU(MAX_MEMORY_ITEMS);  // 内存层
  }

  _key(z, x, y) {
    return `${z}/${x}/${y}`;
  }

  _filepath(z, x, y) {
    return resolve(this.cacheDir, this._key(z, x, y) + '.png');
  }

  async get(z, x, y) {
    const key = this._key(z, x, y);

    // 1. 内存层
    const memHit = this.memoryCache.get(key);
    if (memHit !== undefined) {
      return memHit;
    }

    // 2. 磁盘层
    const filepath = this._filepath(z, x, y);
    try {
      const data = await readFile(filepath);
      this.accessLog.set(key, Date.now());
      // 回填内存层
      this.memoryCache.set(key, data);
      return this.memoryCache.get(key);
    } catch {
      return null;
    }
  }

  async set(z, x, y, buffer) {
    const key = this._key(z, x, y);
    const filepath = this._filepath(z, x, y);

    // 写磁盘
    await mkdir(dirname(filepath), { recursive: true });
    await writeFile(filepath, buffer);
    this.accessLog.set(key, Date.now());

    // 写内存层
    this.memoryCache.set(key, buffer);

    // 磁盘层 LRU 淘汰（保持原逻辑，只清索引不删文件）
    if (this.accessLog.size > MAX_DISK_ITEMS) {
      const sorted = [...this.accessLog.entries()].sort((a, b) => a[1] - b[1]);
      const evictCount = sorted.length - MAX_DISK_ITEMS;
      for (let i = 0; i < evictCount; i++) {
        const [evictKey] = sorted[i];
        this.accessLog.delete(evictKey);
      }
    }
  }
}

export const tileCache = new TileCache();
