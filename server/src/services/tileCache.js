import { readFile, writeFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { config } from '../config/index.js';

const MAX_CACHE_ITEMS = 500; // LRU 最大瓦片数

class TileCache {
  constructor() {
    this.cacheDir = config.tileCacheDir;
    this.accessLog = new Map(); // key → timestamp
  }

  _key(z, x, y) {
    return `${z}/${x}/${y}`;
  }

  _filepath(z, x, y) {
    return resolve(this.cacheDir, this._key(z, x, y) + '.png');
  }

  async get(z, x, y) {
    const key = this._key(z, x, y);
    const filepath = this._filepath(z, x, y);
    try {
      const data = await readFile(filepath);
      this.accessLog.set(key, Date.now());
      return data;
    } catch {
      return null;
    }
  }

  async set(z, x, y, buffer) {
    const key = this._key(z, x, y);
    const filepath = this._filepath(z, x, y);
    await mkdir(dirname(filepath), { recursive: true });
    await writeFile(filepath, buffer);
    this.accessLog.set(key, Date.now());

    // LRU 淘汰
    if (this.accessLog.size > MAX_CACHE_ITEMS) {
      const sorted = [...this.accessLog.entries()].sort((a, b) => a[1] - b[1]);
      const evictCount = sorted.length - MAX_CACHE_ITEMS;
      for (let i = 0; i < evictCount; i++) {
        const [evictKey] = sorted[i];
        this.accessLog.delete(evictKey);
        // 不删除文件，只清理索引；文件清理可后续考虑
      }
    }
  }
}

export const tileCache = new TileCache();
