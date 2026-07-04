# 性能优化设计文档

- **日期**: 2026-07-04
- **范围**: terrain-analysis-system 性能优化方向
- **状态**: 已确认，待写实现计划

## 背景

针对项目（等高线与三维地形智能分析系统，Express + Vite + Three.js + Leaflet + DeepSeek AI）执行性能优化。经 brainstorming 流程澄清后，原「性能优化方向全部四项」的实际范围如下表。

| # | 原计划 | 实际范围 | 已剔除 | 剔除理由 |
|---|---|---|---|---|
| 1 | DEM 数据缓存 | 进程内内存 LRU + 缓存接口抽象（保留 Redis 扩展点）+ Express gzip | Redis 重依赖 | 单机部署，YAGNI |
| 2 | 3D 渲染优化 | 前端 WebWorker 生成网格 + 确认/启用视锥剔除 | LOD 分级渲染 | 风险高，收益不确定 |
| 3 | 瓦片缓存策略 | 后端内存热点 LRU 缓存层 | 预加载相邻瓦片 | 增加瓦片源负载，收益不确定 |
| 4 | 前端打包体积 | 跳过（CDN 已实现核心目标） | 全部 | Three.js/Leaflet 走 CDN，不进打包 |

**关键决策**：部署环境 = 单机但保留多实例扩展能力（缓存抽象层）；3D 优化定位 = 预防性优化（只做低风险高收益项）；验证方式 = 保证功能不退化即可，不写性能基准测试。

---

## 第 1 节：后端缓存抽象层 + DEM 缓存

### 架构

新建通用内存 LRU 缓存类，并通过接口抽象让 DEM 服务和瓦片缓存都依赖抽象，未来可无痛替换为 Redis。

### 组件

**新建 `server/src/services/cache.js` — `MemoryLRU` 类**

- 接口：`get(key)` / `set(key, value)` / `has(key)`
- 容量可配置（构造参数 `maxItems`）
- 基于访问时间淘汰（LRU）：`get` 时更新访问时间，`set` 时若超容量淘汰最久未访问项
- 存储返回值的深拷贝副本（避免调用方污染缓存）

**新建 `server/src/services/cacheInterface.js` — 缓存接口契约**

- JSDoc 注释定义接口形状（`get` / `set` / `has` 的签名和语义）
- 当前实现为 `MemoryLRU`，未来新增 `RedisCache` 实现同接口即可替换

**改造 `server/src/services/demService.js`**

- 注入缓存实例（依赖抽象接口）
- 缓存 key：`${lat.toFixed(4)},${lon.toFixed(4)},${sizeMeters},${gridResolution}`（量化精度避免浮点抖动）
- 缓存 value：`getElevationGrid` 的完整返回值（`{ elevation, metadata }`）
- 缓存未命中：走原有流程（读 GeoTIFF → 回退 Open-Meteo），结果写入缓存
- 缓存命中：返回深拷贝副本
- 缓存容量：建议 50 条（单条高程网格约 128×128×8 字节 ≈ 128KB，50 条 ≈ 6MB）

### 数据流

```
请求 getElevationGrid(lat, lon, size, res)
  → 量化 key
  → cache.get(key)
    → 命中：返回深拷贝
    → 未命中：findDemFile → 双线性插值 → 组装结果 → cache.set(key, result) → 返回
```

### 为什么这样设计

DEM 计算是 CPU 密集（双线性插值遍历网格），同一坐标重复请求时缓存收益最大。抽象层让未来 Redis 替换零成本，符合「单机 + 保留扩展能力」决策。

---

## 第 2 节：瓦片内存热点缓存

### 改造 `server/src/services/tileCache.js`

复用第 1 节的 `MemoryLRU`，形成两级缓存结构：

```
请求 get(z, x, y)
  → 内存 LRU 命中？→ 是 → 直接返回 buffer 副本（零磁盘 I/O）
                  → 否 → 磁盘读取
                      → 磁盘命中 → 回填内存 LRU → 返回
                      → 磁盘未命中 → 返回 null（由路由层拉取上游）
请求 set(z, x, y, buffer)
  → 同时写磁盘和内存 LRU
```

### 配置

- 内存层容量：100 条（单条 PNG 瓦片约几百 KB，100 条 ≈ 50MB）
- 内存层存储 `Buffer.from(buffer)` 副本，避免返回同一引用被消费方修改
- 磁盘层淘汰逻辑保持现状（只清 `accessLog` 索引不删文件，注释已说明）
- 内存层淘汰由 `MemoryLRU` 内部处理，GC 自然回收

### 为什么这样设计

消除热点瓦片的磁盘 I/O（小文件随机读开销可观）。预加载按决策跳过，避免增加瓦片源负载。

---

## 第 3 节：前端 WebWorker 网格生成 + 视锥剔除

### 改造范围

`client/js/terrainEngine.js`（当前 114 行，纯几何计算）+ `client/js/render3d.js`（调用方）

### Worker 架构

新建 `client/js/terrainWorker.js` — Worker 入口，接收高程数据 + 参数，输出纯数据 TypedArray。

```
主线程 render3d.js / terrainEngine.js     Worker terrainWorker.js
─────────────────────────────────────     ─────────────────────────
fetch /api/dem/elevation
  ↓ 拿到 elevation[]
postMessage({
  elevation, params
}, [])  ← 输入不转移，主线程仍需保留
                                          接收，执行纯数学计算：
                                            1. positions (Float32Array)
                                            2. normals (Float32Array)
                                            3. uv (Float32Array)
                                            4. indices (Uint16Array)
                                          postMessage(
                                            { positions, normals, uv, indices },
                                            [所有 buffer]  ← Transferable 零拷贝
                                          )
收到 TypedArray ↓
组装 THREE.BufferGeometry：
  geometry.setAttribute('position', new THREE.BufferAttribute(arr))
  ...
```

### 关键边界

- Worker 内**禁止**出现任何 `THREE.*` 引用（Three.js 不能跨线程），Worker 只做纯数学
- 主线程负责把 TypedArray 包装成 `THREE.BufferAttribute`
- `terrainEngine.js` 核心计算逻辑搬到 Worker；主线程 `terrainEngine.js` 改为薄封装：创建 Worker、收发消息、组装 Geometry
- 失败回退：Worker `onerror` / `onmessageerror` 时回退到主线程同步生成（保证功能不退化）
- 通信方式：Transferable Objects 零拷贝（输入 elevation 不转移因主线程仍需保留；输出四个 buffer 全部转移所有权）

### 视锥剔除

- Three.js `Mesh.frustumCulled` 默认 `true`
- 检查 `render3d.js` 中地形 mesh 未被显式设为 `false`
- 确认 geometry 的 bounding sphere 自动计算正确
- 几乎零风险零改动，仅确认/修正

### 为什么这样设计

网格生成是 CPU 密集（128×128 = 16384 顶点，每顶点算 position+normal+uv），移到 Worker 后主线程在生成期间仍可响应 UI（如加载提示动画）。Transferable 避免大数组拷贝开销。回退机制保证功能不退化。

---

## 第 4 节：后端 gzip 压缩

### 改造范围

`server/package.json` + `server/src/app.js`

### 方案

- 安装 `compression` 中间件（Express 生态标准做法）
- 在 `app.js` 中间件链最前面注册：`app.use(compression())`
- 自动对超过 1KB 的响应做 gzip/deflate 压缩，按 `Accept-Encoding` 协商

### 收益对象

- `/api/dem/elevation` JSON 高程数组（128×128 = 16384 数字，gzip 后通常压缩到 30-50%）
- `/api/proxy/ai` AI 返回的 JSON 文本
- `/api/tiles/static` 静态影像（PNG 已压缩，gzip 几乎无收益但无害）

### 注意点

`compression` 默认 `threshold: 1kb`，对小响应不压缩，且会跳过已压缩 content-type。PNG 瓦片无需特殊处理。

### 为什么这样设计

前端打包体积优化跳过后，gzip 是唯一有真实收益的「压缩」工作，本质属后端 HTTP 优化。一行中间件、零风险。

---

## 验证方式

按决策采用「保证功能不退化即可」：

- 优化后跑一遍现有功能：AI 地名解析、选区生成 3D 地形、等高线显示、水位模拟、降雨模拟、瓦片贴图
- 确保无报错、行为不变
- 不写性能基准测试（YAGNI）
- 后端缓存层可选记录命中/未命中次数到日志（轻量，非必须）

## 非目标（明确剔除）

- Redis 缓存（保留接口扩展点，不引入重依赖）
- LOD 分级渲染（风险高）
- 瓦片预加载（增加上游负载）
- 前端打包体积优化（CDN 已实现核心目标）
- 性能基准测试（预防性优化，过度工程）
- TypeScript 迁移、移动端适配等（属其他优化方向，不在此范围）
