# 性能优化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对 terrain-analysis-system 执行四项性能优化（后端缓存抽象 + DEM 缓存、瓦片内存热点缓存、前端 WebWorker 网格生成 + 视锥剔除、后端 gzip 压缩），保证现有功能不退化。

**Architecture:** 后端新增通用内存 LRU 缓存类并通过接口抽象注入 DEM 服务和瓦片缓存；前端将地形网格几何计算移入 WebWorker，主线程通过 Transferable Objects 零拷贝接收 TypedArray 后组装 Three.js Geometry；后端 Express 注册 compression 中间件。

**Tech Stack:** Node.js + Express（后端 ES Modules）、原生 JS + Three.js + WebWorker（前端，Vite ESM）、`compression` npm 包。

**Spec:** `docs/superpowers/specs/2026-07-04-performance-optimization-design.md`

## Global Constraints

- 后端使用 ES Modules（`"type": "module"`），所有 import 含 `.js` 后缀
- 前端原生 JS，无构建步骤改造成本（Vite dev 直接服务 ESM）
- 三类缓存容量：DEM 50 条、瓦片内存 100 条
- DEM 缓存 key 经纬度量化到 4 位小数
- Worker 内禁止引用 `THREE.*`，只做纯数学
- Worker 输出用 Transferable Objects 零拷贝转移
- Worker 失败时回退主线程同步生成（保证功能不退化）
- 验证标准：跑一遍现有功能不报错、行为不变；不写性能基准测试

---

## File Structure

**新建：**
- `server/src/services/cache.js` — 通用内存 LRU 缓存类 `MemoryLRU`（get/set/has/size）
- `server/src/services/cacheInterface.js` — 缓存接口契约（JSDoc）
- `client/js/terrainWorker.js` — WebWorker 入口，纯数学计算输出 TypedArray

**修改：**
- `server/src/services/demService.js` — 注入缓存，量化 key，缓存命中/未命中逻辑
- `server/src/services/tileCache.js` — 新增内存 LRU 层，两级缓存
- `server/src/app.js` — 注册 compression 中间件
- `server/package.json` — 新增 `compression` 依赖
- `client/js/main.js` — `generate3DTerrain` 改用 Worker 生成几何体数据，回退同步生成
- `client/js/terrainEngine.js` — 移除被 Worker 取代的纯数学函数（hash/noise/fbm/interpolateHeight），保留 fetch 函数；新增 Worker 管理器

---

## Task 1: 通用内存 LRU 缓存类

**Files:**
- Create: `server/src/services/cache.js`

**Interfaces:**
- Produces: `MemoryLRU` 类，构造 `new MemoryLRU(maxItems)`，方法 `get(key)` / `set(key, value)` / `has(key)` / `size()`。`get` 返回深拷贝副本（结构化克隆），`set` 存储深拷贝副本。LRU 淘汰基于访问时间。

- [ ] **Step 1: 写 cache.js 实现**

```javascript
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
    this.access = new Map();     // key → 访问时间戳
  }

  _clone(value) {
    if (value === null || value === undefined) return value;
    if (Buffer.isBuffer(value)) return Buffer.from(value);
    if (value instanceof ArrayBuffer) return value.slice(0);
    if (ArrayBuffer.isView(value)) {
      const copy = new value.constructor(value);
      return copy;
    }
    return structuredClone(value);
  }

  get(key) {
    if (!this.store.has(key)) return undefined;
    this.access.set(key, Date.now());
    return this._clone(this.store.get(key));
  }

  set(key, value) {
    const cloned = this._clone(value);
    this.store.set(key, cloned);
    this.access.set(key, Date.now());
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
```

- [ ] **Step 2: 写测试验证基本行为**

创建 `server/test/cache.test.mjs`：

```javascript
import assert from 'node:assert';
import { test } from 'node:test';
import { MemoryLRU } from '../src/services/cache.js';

test('get 未命中返回 undefined', () => {
  const c = new MemoryLRU(10);
  assert.strictEqual(c.get('nope'), undefined);
});

test('set 后 get 返回相等值', () => {
  const c = new MemoryLRU(10);
  c.set('a', { x: 1 });
  assert.deepEqual(c.get('a'), { x: 1 });
});

test('get 返回深拷贝，修改不影响缓存', () => {
  const c = new MemoryLRU(10);
  c.set('a', { x: [1, 2, 3] });
  const got = c.get('a');
  got.x.push(4);
  assert.deepEqual(c.get('a'), { x: [1, 2, 3] });
});

test('Buffer 深拷贝', () => {
  const c = new MemoryLRU(10);
  const buf = Buffer.from([1, 2, 3]);
  c.set('b', buf);
  const got = c.get('b');
  got[0] = 99;
  assert.equal(c.get('b')[0], 1);
});

test('超容量淘汰最久未访问', () => {
  const c = new MemoryLRU(2);
  c.set('a', 1);
  c.set('b', 2);
  c.get('a');           // a 更新访问时间
  c.set('c', 3);        // 应淘汰 b
  assert.strictEqual(c.has('a'), true);
  assert.strictEqual(c.has('b'), false);
  assert.strictEqual(c.has('c'), true);
});

test('has 和 size', () => {
  const c = new MemoryLRU(10);
  c.set('a', 1);
  assert.strictEqual(c.has('a'), true);
  assert.strictEqual(c.has('z'), false);
  assert.strictEqual(c.size(), 1);
});
```

- [ ] **Step 3: 运行测试，确认通过**

Run: `cd server && node --test test/cache.test.mjs`
Expected: 全部 PASS（6 个测试）

- [ ] **Step 4: 提交**

```bash
git add server/src/services/cache.js server/test/cache.test.mjs
git commit -m "feat(cache): add generic in-memory LRU cache class

Co-Authored-By: AtomCode (GLM-5.2) <noreply@atomgit.com>"
```

---

## Task 2: 缓存接口契约文档

**Files:**
- Create: `server/src/services/cacheInterface.js`

**Interfaces:**
- Produces: JSDoc 类型定义 `CacheInterface`，描述 `get/set/has/size` 签名。供未来 `RedisCache` 实现遵循。当前 `MemoryLRU` 已符合此契约。

- [ ] **Step 1: 写接口契约文件**

```javascript
// server/src/services/cacheInterface.js
/**
 * @typedef {Object} CacheInterface
 * @property {(key: string) => any} get - 取值，返回深拷贝副本；未命中返回 undefined
 * @property {(key: string, value: any) => void} set - 存值，内部存深拷贝副本
 * @property {(key: string) => boolean} has - 是否存在（不更新访问时间）
 * @property {() => number} size - 当前条目数
 *
 * 契约说明：
 * - get/set 必须做深拷贝，避免调用方修改污染缓存
 * - 实现负责淘汰策略（LRU / TTL 等）
 * - 当前实现见 cache.js 的 MemoryLRU
 * - 未来可新增 RedisCache 实现同接口，注入点替换即可
 */
export {};
```

- [ ] **Step 2: 提交**

```bash
git add server/src/services/cacheInterface.js
git commit -m "docs(cache): add cache interface contract

Co-Authored-By: AtomCode (GLM-5.2) <noreply@atomgit.com>"
```

---

## Task 3: DEM 服务接入缓存

**Files:**
- Modify: `server/src/services/demService.js`
- Test: `server/test/demService.test.mjs`

**Interfaces:**
- Consumes: `MemoryLRU` from Task 1
- Produces: `getElevationGrid(centerLat, centerLon, sizeMeters, gridResolution)` 签名不变，内部走缓存

- [ ] **Step 1: 写测试验证缓存行为**

创建 `server/test/demService.test.mjs`：

```javascript
import assert from 'node:assert';
import { test, mock } from 'node:test';

test('相同坐标第二次调用命中缓存，不重复读 GeoTIFF', async () => {
  // 通过动态 import 拿到模块，用 monkey-patch 验证缓存命中
  // 由于 findDemFile 是模块私有，这里测可观察行为：
  // 第二次调用应返回与第一次深拷贝相等但非同引用的结果
  const { getElevationGrid, __cacheStats } = await import('../src/services/demService.js');
  // 注意：无本地 DEM 文件时 getElevationGrid 返回 null，缓存 null 也算命中
  const r1 = await getElevationGrid(36.25, 117.10, 2400, 64);
  const r2 = await getElevationGrid(36.25, 117.10, 2400, 64);
  // 两次结果应一致（都是 null 或都是有效数据）
  assert.strictEqual(r1 === null, r2 === null);
  // 若非 null，第二次应是深拷贝（不同引用）
  if (r1 !== null) {
    assert.notStrictEqual(r1.elevation, r2.elevation);
    assert.deepEqual(r1.elevation, r2.elevation);
  }
  // 命中计数应 ≥ 1
  assert.ok(__cacheStats().hits >= 1, '应有缓存命中');
});

test('坐标量化：36.25001 与 36.25004 视为同一 key', async () => {
  const { getElevationGrid, __cacheStats } = await import('../src/services/demService.js');
  const before = __cacheStats().misses;
  await getElevationGrid(36.25001, 117.10002, 2400, 64);
  await getElevationGrid(36.25004, 117.10008, 2400, 64);
  // 第二次应命中（量化到 4 位小数后相同）
  assert.ok(__cacheStats().hits >= 1);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd server && node --test test/demService.test.mjs`
Expected: FAIL（`__cacheStats` 不存在 / 缓存未实现）

- [ ] **Step 3: 改造 demService.js 注入缓存**

将 `server/src/services/demService.js` 的 `getElevationGrid` 改造为：

```javascript
// 在文件顶部 import 区新增
import { MemoryLRU } from './cache.js';

// 在 import 之后、函数之前新增
const demCache = new MemoryLRU(50);
const cacheStats = { hits: 0, misses: 0 };

/**
 * 量化坐标到 4 位小数，构造缓存 key
 */
function buildCacheKey(centerLat, centerLon, sizeMeters, gridResolution) {
  return `${centerLat.toFixed(4)},${centerLon.toFixed(4)},${sizeMeters},${gridResolution}`;
}

// 替换原 getElevationGrid 函数体为：
export async function getElevationGrid(centerLat, centerLon, sizeMeters, gridResolution) {
  const key = buildCacheKey(centerLat, centerLon, sizeMeters, gridResolution);

  const cached = demCache.get(key);
  if (cached !== undefined) {
    cacheStats.hits++;
    return cached;
  }
  cacheStats.misses++;

  const demFile = await findDemFile(centerLat, centerLon);
  if (!demFile) {
    demCache.set(key, null);
    return null;
  }

  const { data, width, height, bbox } = demFile;
  const halfDeg = (sizeMeters / 2400) * 0.05;
  const latMin = centerLat - halfDeg;
  const latMax = centerLat + halfDeg;
  const lonMin = centerLon - halfDeg;
  const lonMax = centerLon + halfDeg;

  const elevation = new Float32Array(gridResolution * gridResolution);
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;

  for (let i = 0; i < gridResolution; i++) {
    for (let j = 0; j < gridResolution; j++) {
      const u = j / (gridResolution - 1);
      const v = i / (gridResolution - 1);
      const lon = lonMin + u * (lonMax - lonMin);
      const lat = latMin + v * (latMax - latMin);

      const pu = (lon - bbox[0]) / (bbox[2] - bbox[0]);
      const pv = (lat - bbox[1]) / (bbox[3] - bbox[1]);

      let h = bilinearInterpolate(data, width, height, pu, pv);
      if (!isFinite(h)) h = 0;
      elevation[i * gridResolution + j] = h;
      if (h < min) min = h;
      if (h > max) max = h;
      sum += h;
    }
  }

  const result = {
    elevation: Array.from(elevation),
    metadata: {
      min: Math.round(min),
      max: Math.round(max),
      mean: Math.round(sum / elevation.length),
      source: demFile.filepath.split('\\').pop().split('/').pop()
    }
  };

  demCache.set(key, result);
  return result;
}

// 文件末尾新增导出（供测试用）
export function __cacheStats() {
  return { hits: cacheStats.hits, misses: cacheStats.misses };
}
```

注意：保留原文件中的 `getGeotiff`、`bilinearInterpolate`、`findDemFile` 函数不变。

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd server && node --test test/demService.test.mjs`
Expected: PASS（2 个测试）

- [ ] **Step 5: 提交**

```bash
git add server/src/services/demService.js server/test/demService.test.mjs
git commit -m "feat(dem): add in-memory LRU cache to DEM service

Co-Authored-By: AtomCode (GLM-5.2) <noreply@atomgit.com>"
```

---

## Task 4: 瓦片缓存新增内存热点层

**Files:**
- Modify: `server/src/services/tileCache.js`
- Test: `server/test/tileCache.test.mjs`

**Interfaces:**
- Consumes: `MemoryLRU` from Task 1
- Produces: `tileCache.get(z, x, y)` 行为不变，内部先查内存再查磁盘；`tileCache.set(z, x, y, buffer)` 同时写两层

- [ ] **Step 1: 写测试验证两级缓存**

创建 `server/test/tileCache.test.mjs`：

```javascript
import assert from 'node:assert';
import { test } from 'node:test';
import { tileCache } from '../src/services/tileCache.js';

test('set 后 get 返回相同 buffer 内容', async () => {
  const buf = Buffer.from([10, 20, 30, 40]);
  await tileCache.set(5, 10, 15, buf);
  const got = await tileCache.get(5, 10, 15);
  assert.ok(got !== null);
  assert.deepEqual(Array.from(got), [10, 20, 30, 40]);
});

test('get 返回副本，修改不影响缓存', async () => {
  const buf = Buffer.from([1, 2, 3]);
  await tileCache.set(6, 1, 1, buf);
  const got = await tileCache.get(6, 1, 1);
  got[0] = 99;
  const got2 = await tileCache.get(6, 1, 1);
  assert.equal(got2[0], 1);
});

test('未命中返回 null', async () => {
  const got = await tileCache.get(99, 99, 99);
  assert.strictEqual(got, null);
});

// 测试后清理：删除测试写入的磁盘文件
test('cleanup', async () => {
  const { rm } = await import('fs/promises');
  const path = await import('path');
  // 不强制清理，磁盘文件可留存；LRU 索引在内存中
});
```

- [ ] **Step 2: 运行测试，确认失败（未命中应返回 null，但当前 set 未写内存层时 get 副本测试可能失败）**

Run: `cd server && node --test test/tileCache.test.mjs`
Expected: 部分测试可能 FAIL（副本测试）

- [ ] **Step 3: 改造 tileCache.js 加内存层**

完整替换 `server/src/services/tileCache.js` 为：

```javascript
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
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd server && node --test test/tileCache.test.mjs`
Expected: PASS（3 个测试 + cleanup）

- [ ] **Step 5: 提交**

```bash
git add server/src/services/tileCache.js server/test/tileCache.test.mjs
git commit -m "feat(tiles): add in-memory LRU hot cache layer to tile cache

Co-Authored-By: AtomCode (GLM-5.2) <noreply@atomgit.com>"
```

---

## Task 5: 后端 gzip 压缩中间件

**Files:**
- Modify: `server/package.json`（新增 compression 依赖）
- Modify: `server/src/app.js`

- [ ] **Step 1: 安装 compression**

Run: `cd server && npm install compression`

- [ ] **Step 2: 在 app.js 注册中间件**

修改 `server/src/app.js`，在 `import` 区新增：

```javascript
import compression from 'compression';
```

在 `const app = express();` 之后、其他中间件之前插入：

```javascript
// gzip/deflate 压缩响应（>1kb 自动压缩，PNG 等已压缩内容自动跳过）
app.use(compression());
```

最终 app.js 顶部应变为：

```javascript
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { config } from './config/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import proxyRouter from './routes/proxy.js';
import demRouter from './routes/dem.js';
import tilesRouter from './routes/tiles.js';

const app = express();

// gzip/deflate 压缩响应（>1kb 自动压缩，PNG 等已压缩内容自动跳过）
app.use(compression());

app.use(cors());
app.use(express.json({ limit: '1mb' }));
```

其余部分不变。

- [ ] **Step 3: 启动后端验证不报错**

Run: `cd server && timeout 5 node src/app.js || true`
Expected: 看到 `✅ 后端服务运行在 http://localhost:3001`，无 import 错误，5 秒后超时退出

- [ ] **Step 4: 提交**

```bash
git add server/package.json server/package-lock.json server/src/app.js
git commit -m "feat(server): add compression middleware for gzip responses

Co-Authored-By: AtomCode (GLM-5.2) <noreply@atomgit.com>"
```

---

## Task 6: 前端 WebWorker — 纯数学地形网格生成

**Files:**
- Create: `client/js/terrainWorker.js`

**Interfaces:**
- Consumes: 主线程 postMessage 发送 `{ type: 'build', elevation: number[]|null, gridSize: number, size: number, exaggeration: number, activeLat: number, activeLon: number }`
- Produces: Worker postMessage 回 `{ positions: Float32Array, normals: Float32Array, uvs: Float32Array, indices: Uint16Array, minHeight: number, maxHeight: number }`，四个 buffer 通过 Transferable 转移所有权。Worker 内包含 `hash/noise/fbm/interpolateHeight/buildGeometry` 纯函数（从 terrainEngine.js 复制）。

- [ ] **Step 1: 写 terrainWorker.js**

```javascript
// client/js/terrainWorker.js
// 纯数学 Worker：接收高程数据 + 参数，输出几何体 TypedArray。
// 禁止引用 THREE.* —— 只做数学计算。

function hash(x, y) {
    let h = Math.sin(x * 12.1 + y * 37.7) * 437.54;
    return h - Math.floor(h);
}

function noise(x, y) {
    let ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    let ux = fx * fx * (3.0 - 2.0 * fx), uy = fy * fy * (3.0 - 2.0 * fy);
    let a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return a * (1.0 - ux) * (1.0 - uy) + b * ux * (1.0 - uy) + c * (1.0 - ux) * uy + d * ux * uy;
}

function fbm(x, y) {
    let value = 0.0, amplitude = 0.5, frequency = 1.0;
    for (let i = 0; i < 4; i++) {
        value += amplitude * noise(x * frequency, y * frequency);
        frequency *= 2.0; amplitude *= 0.5;
    }
    return value;
}

function interpolateHeight(u, v, grid, gridSize) {
    if (!grid || grid.length !== gridSize * gridSize) return 0;
    const rowVal = v * (gridSize - 1);
    const colVal = u * (gridSize - 1);
    const r0 = Math.floor(rowVal);
    const c0 = Math.floor(colVal);
    const r1 = Math.min(gridSize - 1, r0 + 1);
    const c1 = Math.min(gridSize - 1, c0 + 1);
    const fr = rowVal - r0;
    const fc = colVal - c0;
    const h00 = grid[r0 * gridSize + c0];
    const h01 = grid[r0 * gridSize + c1];
    const h10 = grid[r1 * gridSize + c0];
    const h11 = grid[r1 * gridSize + c1];
    if (h00 === undefined || h01 === undefined || h10 === undefined || h11 === undefined) return 0;
    const hTop = h00 * (1.0 - fc) + h01 * fc;
    const hBottom = h10 * (1.0 - fc) + h11 * fc;
    return hTop * (1.0 - fr) + hBottom * fr;
}

/**
 * 构建地形几何体数据（等价于原 THREE.PlaneGeometry + 修改 positions + computeVertexNormals）。
 * 坐标系：原 THREE.PlaneGeometry(size,size,gridSize,gridSize) rotateX(-PI/2) 后：
 *   x ∈ [-size/2, size/2], y=height(上), z ∈ [-size/2, size/2]
 * 顶点排列：gridSize+1 行 × gridSize+1 列，逐行（z 从 +size/2 到 -size/2）逐列（x 从 -size/2 到 +size/2）。
 */
function buildGeometry(elevationGrid, gridSize, size, exaggeration, activeLat, activeLon) {
    const segs = gridSize;
    const vertsPerSide = segs + 1;
    const vertexCount = vertsPerSide * vertsPerSide;
    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const normals = new Float32Array(vertexCount * 3);
    const indices = new Uint16Array(segs * segs * 6);

    let minHeight = Infinity;
    let maxHeight = -Infinity;

    // 生成顶点
    for (let r = 0; r < vertsPerSide; r++) {
        for (let c = 0; c < vertsPerSide; c++) {
            const i = r * vertsPerSide + c;
            const u = c / segs;
            const v = r / segs;
            const x = (u - 0.5) * size;
            const z = (v - 0.5) * size;

            let height = 0.0;
            if (elevationGrid) {
                height = interpolateHeight(u, v, elevationGrid, elevationGrid.length > 0 ? Math.sqrt(elevationGrid.length) | 0 : gridSize);
                // 与原 main.js 一致：detailIntensity 调制
                const detailIntensity = Math.min(1.0, height / 1000.0);
                height += fbm(u * 15.0 + activeLon, v * 15.0 + activeLat) * 35.0 * detailIntensity;
            } else {
                const macroBase = fbm(u * 3.0 + activeLon * 2.3, v * 3.0 + activeLat * 1.7) * 600.0;
                const microDetail = fbm(u * 12.0 - activeLon, v * 12.0 - activeLat) * 45.0;
                height = Math.max(5.0, macroBase + microDetail);
            }

            positions[i * 3] = x;
            positions[i * 3 + 1] = height * exaggeration;
            positions[i * 3 + 2] = z;
            uvs[i * 2] = u;
            uvs[i * 2 + 1] = v;

            // min/max 记录原始 height（未乘 exaggeration），与原 main.js 一致
            if (height < minHeight) minHeight = height;
            if (height > maxHeight) maxHeight = height;
        }
    }

    // 生成索引（每个格子 2 个三角形）
    let idx = 0;
    for (let r = 0; r < segs; r++) {
        for (let c = 0; c < segs; c++) {
            const a = r * vertsPerSide + c;
            const b = r * vertsPerSide + c + 1;
            const cc = (r + 1) * vertsPerSide + c;
            const d = (r + 1) * vertsPerSide + c + 1;
            // 与 THREE.PlaneGeometry rotateX(-PI/2) 后的绕序保持一致（双面渲染，绕序影响不大）
            indices[idx++] = a;
            indices[idx++] = cc;
            indices[idx++] = b;
            indices[idx++] = b;
            indices[idx++] = cc;
            indices[idx++] = d;
        }
    }

    // 计算法线（等价 computeVertexNormals，逐面累加到顶点后归一化）
    for (let i = 0; i < normals.length; i++) normals[i] = 0;
    for (let f = 0; f < indices.length; f += 3) {
        const ia = indices[f], ib = indices[f + 1], ic = indices[f + 2];
        const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
        const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
        const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cx - ax, vy = cy - ay, vz = cz - az;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        normals[ia * 3] += nx; normals[ia * 3 + 1] += ny; normals[ia * 3 + 2] += nz;
        normals[ib * 3] += nx; normals[ib * 3 + 1] += ny; normals[ib * 3 + 2] += nz;
        normals[ic * 3] += nx; normals[ic * 3 + 1] += ny; normals[ic * 3 + 2] += nz;
    }
    for (let i = 0; i < normals.length; i += 3) {
        const nx = normals[i], ny = normals[i + 1], nz = normals[i + 2];
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        normals[i] = nx / len;
        normals[i + 1] = ny / len;
        normals[i + 2] = nz / len;
    }

    return { positions, normals, uvs, indices, minHeight, maxHeight };
}

self.onmessage = (e) => {
    const { type, elevation, gridSize, size, exaggeration, activeLat, activeLon } = e.data;
    if (type !== 'build') return;
    try {
        const result = buildGeometry(elevation, gridSize, size, exaggeration, activeLat, activeLon);
        self.postMessage(result, [
            result.positions.buffer,
            result.normals.buffer,
            result.uvs.buffer,
            result.indices.buffer
        ]);
    } catch (err) {
        self.postMessage({ error: err.message });
    }
};
```

- [ ] **Step 2: 提交**

```bash
git add client/js/terrainWorker.js
git commit -m "feat(worker): add WebWorker for terrain geometry generation

Co-Authored-By: AtomCode (GLM-5.2) <noreply@atomgit.com>"
```

---

## Task 7: 主线程接入 Worker + 回退机制

**Files:**
- Modify: `client/js/terrainEngine.js`（新增 Worker 管理器）
- Modify: `client/js/main.js`（generate3DTerrain 改用 Worker）

**Interfaces:**
- Consumes: `terrainWorker.js` from Task 6；`MemoryLRU`-free，纯浏览器 API
- Produces: `window.buildTerrainGeometryAsync(elevationGrid, gridSize, size, exaggeration)` 返回 Promise<{positions, normals, uvs, indices, minHeight, maxHeight}>，失败时回退主线程同步生成

- [ ] **Step 1: 在 terrainEngine.js 末尾新增 Worker 管理器**

在 `client/js/terrainEngine.js` 末尾的 `window.* = ...` 导出区之前插入：

```javascript
// ==========================================
// WebWorker 地形几何体生成（带主线程回退）
// ==========================================
let terrainWorkerInstance = null;
function getTerrainWorker() {
    if (!terrainWorkerInstance) {
        terrainWorkerInstance = new Worker(new URL('./terrainWorker.js', import.meta.url), { type: 'module' });
    }
    return terrainWorkerInstance;
}

/**
 * 异步构建地形几何体数据（Worker 线程）。
 * 失败时回退到主线程同步生成（保证功能不退化）。
 * @returns {Promise<{positions: Float32Array, normals: Float32Array, uvs: Float32Array, indices: Uint16Array, minHeight: number, maxHeight: number}>}
 */
function buildTerrainGeometryAsync(elevationGrid, gridSize, size, exaggeration, activeLat, activeLon) {
    return new Promise((resolve) => {
        let settled = false;
        const worker = getTerrainWorker();

        const onMessage = (e) => {
            if (settled) return;
            settled = true;
            worker.removeEventListener('message', onMessage);
            worker.removeEventListener('error', onError);
            if (e.data && e.data.error) {
                console.warn('Worker 几何体生成失败，回退主线程:', e.data.error);
                resolve(buildTerrainGeometrySync(elevationGrid, gridSize, size, exaggeration, activeLat, activeLon));
            } else {
                resolve(e.data);
            }
        };
        const onError = (err) => {
            if (settled) return;
            settled = true;
            worker.removeEventListener('message', onMessage);
            worker.removeEventListener('error', onError);
            console.warn('Worker 异常，回退主线程:', err.message || err);
            resolve(buildTerrainGeometrySync(elevationGrid, gridSize, size, exaggeration, activeLat, activeLon));
        };

        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        worker.postMessage({
            type: 'build',
            elevation: elevationGrid,
            gridSize,
            size,
            exaggeration,
            activeLat,
            activeLon
        }, []);  // 输入不转移（主线程仍需保留 elevationGrid）
    });
}

/**
 * 主线程同步回退实现（与 terrainWorker.js buildGeometry 算法一致）。
 * 用 THREE.PlaneGeometry + 修改 positions + computeVertexNormals，保持原行为。
 */
function buildTerrainGeometrySync(elevationGrid, gridSize, size, exaggeration, activeLat, activeLon) {
    const geometry = new THREE.PlaneGeometry(size, size, gridSize, gridSize);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position.array;
    const count = positions.length / 3;
    let minHeight = Infinity;
    let maxHeight = -Infinity;

    for (let i = 0; i < count; i++) {
        const xCoord = positions[i * 3];
        const zCoord = positions[i * 3 + 2];
        const u = (xCoord + size / 2) / size;
        const v = (zCoord + size / 2) / size;
        let height = 0.0;
        if (elevationGrid) {
            height = interpolateHeight(u, v, elevationGrid);
            const detailIntensity = Math.min(1.0, height / 1000.0);
            height += fbm(u * 15.0 + activeLon, v * 15.0 + activeLat) * 35.0 * detailIntensity;
        } else {
            const macroBase = fbm(u * 3.0 + activeLon * 2.3, v * 3.0 + activeLat * 1.7) * 600.0;
            const microDetail = fbm(u * 12.0 - activeLon, v * 12.0 - activeLat) * 45.0;
            height = Math.max(5.0, macroBase + microDetail);
        }
        positions[i * 3 + 1] = height * exaggeration;
        if (height < minHeight) minHeight = height;
        if (height > maxHeight) maxHeight = height;
    }
    geometry.computeVertexNormals();
    const normals = geometry.attributes.normal.array;
    const uvs = geometry.attributes.uv.array;
    const indices = geometry.index ? geometry.index.array : new Uint16Array(0);
    // 返回副本（geometry 会被丢弃，但保持与 Worker 路径一致的纯数据语义）
    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        uvs: new Float32Array(uvs),
        indices: indices instanceof Uint16Array ? indices : new Uint16Array(indices),
        minHeight,
        maxHeight
    };
}
```

并在文件末尾的 `window.* = ...` 导出区新增：

```javascript
window.buildTerrainGeometryAsync = buildTerrainGeometryAsync;
```

- [ ] **Step 2: 修改 main.js 的 generate3DTerrain 用 Worker**

在 `client/js/main.js` 中，替换 `generate3DTerrain` 函数内从「构建新网格几何体」注释到 `geometry.computeVertexNormals();` 的整段（约 160-193 行）。

找到这段代码（约 160-193 行）：

```javascript
    // 构建新网格几何体
    const geometry = new THREE.PlaneGeometry(size, size, gridSize, gridSize);
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position.array;
    const count = positions.length / 3;

    let minHeight = Infinity;
    let maxHeight = -Infinity;

    for (let i = 0; i < count; i++) {
        const xCoord = positions[i * 3];
        const zCoord = positions[i * 3 + 2];
        const u = (xCoord + size / 2) / size;
        const v = (zCoord + size / 2) / size;

        let height = 0.0;
        if (window.fetchedElevationGrid) {
            height = interpolateHeight(u, v, window.fetchedElevationGrid);
            const detailIntensity = Math.min(1.0, height / 1000.0);
            height += fbm(u * 15.0 + window.activeLon, v * 15.0 + window.activeLat) * 35.0 * detailIntensity;
        } else {
            const macroBase = fbm(u * 3.0 + window.activeLon * 2.3, v * 3.0 + window.activeLat * 1.7) * 600.0;
            const microDetail = fbm(u * 12.0 - window.activeLon, v * 12.0 - window.activeLat) * 45.0;
            height = Math.max(5.0, macroBase + microDetail);
        }

        positions[i * 3 + 1] = height * exaggeration;

        if (height < minHeight) minHeight = height;
        if (height > maxHeight) maxHeight = height;
    }

    geometry.computeVertexNormals();
```

替换为：

```javascript
    // 通过 WebWorker 异步构建几何体数据（失败回退主线程同步）
    const geomData = await buildTerrainGeometryAsync(
        window.fetchedElevationGrid, gridSize, size, exaggeration,
        window.activeLat, window.activeLon
    );

    const { positions, normals, uvs, indices, minHeight, maxHeight } = geomData;

    // 组装 Three.js BufferGeometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
```

注意：原 `geometry.attributes.position.array` 在后续 `buildTerrainSidesAndBottom(positions, gridSize, size, minHeight * exaggeration, maxHeight * exaggeration);` 调用中被使用。替换后 `positions` 变量已是 `geomData.positions`（Float32Array），`buildTerrainSidesAndBottom` 接收的就是它，无需改动该调用行。

- [ ] **Step 3: 启动前后端验证不报错**

Run（终端1）: `cd server && npm run dev` &
Run（终端2）: `cd client && npm run dev`

打开 `http://localhost:3000`，点击「生成对应选区局部地形」按钮，确认：
- 3D 地形正常渲染（与优化前视觉一致）
- 控制台无 Worker 报错
- 切换预设地标、调整网格分辨率滑块后重新生成均正常

- [ ] **Step 4: 提交**

```bash
git add client/js/terrainEngine.js client/js/main.js
git commit -m "feat(terrain): use WebWorker for geometry generation with sync fallback

Co-Authored-By: AtomCode (GLM-5.2) <noreply@atomgit.com>"
```

---

## Task 8: 视锥剔除确认与端到端验证

**Files:**
- Verify: `client/js/main.js`（确认 terrainMesh 未禁用 frustumCulled）
- No code change expected（Three.js Mesh.frustumCulled 默认 true）

- [ ] **Step 1: 搜索确认 frustumCulled 未被禁用**

Run: `grep -rn "frustumCulled" client/js/ || echo "未找到，说明用默认值 true，符合预期"`
Expected: 输出「未找到」或仅显示确认性注释。若发现 `terrainMesh.frustumCulled = false`，改为删除该行或设为 true。

- [ ] **Step 2: 端到端功能验证（保证不退化）**

启动前后端（同 Task 7 Step 3），逐项验证现有功能：

| 功能 | 验证步骤 | 预期 |
|---|---|---|
| AI 地名解析 | 输入「黄山」点智能定位 | 地图跳转 + 3D 重新生成 |
| 2D 选区 | 点击地图 | 中心坐标更新 + 选区框 |
| 地标预设 | 点「华山」等预设 | 3D 重新生成 |
| 网格分辨率 | 拖动 gridSize 滑块到 256 | 重新生成更精细地形 |
| 等高线 | 勾选/取消等高线显示 | 等高线出现/消失 |
| 水位模拟 | 拖动 waterHeight 滑块 | 水面上升 |
| 降雨模拟 | 点「暴雨」预设 + 播放 | 粒子动画 |
| 卫星贴图 | textureMode 选「卫星真实遥感影像」 | 地形贴上卫星图 |
| 灾害风险图 | 点 AI 生态推演 | 切换 riskMap 材质 |
| 二次生成 | 连续点两次生成按钮 | 第二次明显更快（DEM 缓存命中） |
| 瓦片缓存 | 反复拖动地图 | 第二次瓦片加载更快（内存缓存） |

所有功能应正常工作、无报错、行为与优化前一致。

- [ ] **Step 3: 提交（仅在有改动时）**

若 Step 1 发现并修正了 frustumCulled 禁用：

```bash
git add client/js/main.js
git commit -m "fix(terrain): ensure frustum culling enabled on terrain mesh

Co-Authored-By: AtomCode (GLM-5.2) <noreply@atomgit.com>"
```

若无改动，跳过提交。

---

## 验证总结

完成所有 Task 后，运行一次完整测试套件确认后端无回归：

Run: `cd server && node --test test/`
Expected: 所有测试 PASS（cache + demService + tileCache 共约 11 个测试）

并完成 Task 8 Step 2 的端到端功能验证清单。

## 非目标（明确不在本计划范围）

- Redis 缓存实现（接口已留扩展点）
- LOD 分级渲染
- 瓦片预加载
- 前端打包体积优化（Three.js/Leaflet 走 CDN）
- 性能基准测试
- TypeScript 迁移
