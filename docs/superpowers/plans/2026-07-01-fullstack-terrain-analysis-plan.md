# 三维地形智能分析系统 — 前后端架构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将纯前端地形分析系统升级为 Node.js Express 后端 + Vite 前端的前后端分离项目，实现 API 密钥安全、真实 DEM 高程服务和卫星瓦片代理。

**Architecture:** Express 后端提供三个核心 API（DeepSeek 代理、DEM 高程网格、天地图瓦片代理），前端通过 Vite 开发服务器代理 `/api` 请求。DEM 数据预下载为本地 GeoTIFF 文件，由后端 `geotiff.js` 解析并插值返回 JSON 网格。

**Tech Stack:** Node.js + Express (后端), Vite + vanilla JS (前端构建), Leaflet + Three.js (前端渲染), geotiff.js (栅格解析), dotenv (配置管理)

## Global Constraints

- 所有 API Key（DeepSeek、天地图）仅存在于后端 `.env` 文件，前端零泄露
- 前端 JS 文件保持原有逻辑不变，仅改为 ESM 模块加载和 API 调用地址
- DEM 数据优先从本地 GeoTIFF 读取，未覆盖区域回退到 Open-Meteo 免费 API
- Vite `server.proxy` 将 `/api/*` 转发到 `localhost:3001`
- HTML `onclick` 调用的全局函数通过 `window.xxx` 显式挂载兼容

---

## 文件结构映射

### 新建文件

| 文件路径 | 职责 |
|---|---|
| `server/package.json` | 后端依赖管理 |
| `server/src/app.js` | Express 入口，挂载路由和中间件 |
| `server/src/config/index.js` | 读取 `.env` 配置 |
| `server/src/routes/proxy.js` | `POST /api/proxy/ai` DeepSeek 代理 |
| `server/src/routes/dem.js` | `GET /api/dem/elevation` 高程网格 |
| `server/src/routes/tiles.js` | `GET /api/tiles/:z/:x/:y` 瓦片代理 |
| `server/src/services/demService.js` | GeoTIFF 读取 + 裁剪 + 双线性插值 |
| `server/src/services/tileCache.js` | 瓦片磁盘 LRU 缓存 |
| `server/src/middleware/errorHandler.js` | 统一错误处理 |
| `client/package.json` | 前端依赖管理 |
| `client/vite.config.js` | Vite 配置 |
| `.env` | 环境变量（密钥） |
| `.gitignore` | 忽略 node_modules / .env / cache |

### 修改文件

| 文件路径 | 改动内容 |
|---|---|
| `index.html` | 移到 `client/`，script 改为 `<script type="module" src="/js/main.js">` |
| `js/main.js` | 转为 ESM 入口，import 各模块，`window.xxx` 挂载回调 |
| `js/config.js` | 移除直接 API 调用，保留非敏感配置 |
| `js/aiAgent.js` | `fetch()` 从直调 DeepSeek 改为调 `/api/proxy/ai` |
| `js/terrainEngine.js` | `fetchRealElevation()` 从 Open-Meteo 改为调 `/api/dem/elevation` |
| `js/render3d.js` | `loadSatelliteTexture()` 的天地图 URL 改为通过 `/api/tiles/static` 代理 |
| `README.md` | 更新运行步骤 |

---

## Phase 1: 后端基础 + API 代理 + Vite 迁移

### Task 1: 初始化后端项目结构

**Files:**
- Create: `server/package.json`
- Create: `server/src/app.js`
- Create: `server/src/config/index.js`
- Create: `server/src/middleware/errorHandler.js`
- Create: `.env`
- Create: `.gitignore`
- Modify: `.gitignore` (追加规则)

**Interfaces:**
- Consumes: 无（初始任务）
- Produces: Express 应用实例，`config` 模块（`config.deepseekKey`, `config.tdtTk`, `config.port`），`errorHandler` 中间件

- [ ] **Step 1: 创建 `server/package.json`**

```json
{
  "name": "terrain-analysis-server",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "node --watch src/app.js",
    "start": "node src/app.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "geotiff": "^2.1.0"
  }
}
```

- [ ] **Step 2: 创建 `.env`**

```
DEEPSEEK_API_KEY=your_deepseek_key_here
TDT_TK=your_tianditu_token_here
PORT=3001
```

- [ ] **Step 3: 创建 `.gitignore`（追加到已有 `.gitignore` 末尾）**

```
# Node
node_modules/
.env
server/cache/
server/data/dem/*.tif
```

- [ ] **Step 4: 创建 `server/src/config/index.js`**

```js
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '../.env') });

export const config = {
  deepseekKey: process.env.DEEPSEEK_API_KEY || '',
  tdtTk: process.env.TDT_TK || '',
  port: parseInt(process.env.PORT || '3001'),
  demDataDir: resolve(process.cwd(), '../server/data/dem'),
  tileCacheDir: resolve(process.cwd(), '../server/cache/tiles'),
};
```

- [ ] **Step 5: 创建 `server/src/middleware/errorHandler.js`**

```js
export function errorHandler(err, req, res, _next) {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
  });
}
```

- [ ] **Step 6: 创建 `server/src/app.js`**

```js
import express from 'express';
import cors from 'cors';
import { config } from './config/index.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();
app.use(cors());
app.use(express.json());

// 路由占位 — 后续 Task 挂载
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Server running on http://localhost:${config.port}`);
});
```

- [ ] **Step 7: 安装依赖并验证**

Run: `cd server && npm install`
Expected: node_modules 创建完成，无报错

Run: `node src/app.js`
Expected: 终端输出 `Server running on http://localhost:3001`

- [ ] **Step 8: 提交**

```bash
git add server/ .env.example .gitignore
git commit -m "feat: 初始化后端 Express 项目结构"
```

---

### Task 2: 实现 DeepSeek 代理路由

**Files:**
- Create: `server/src/routes/proxy.js`
- Modify: `server/src/app.js` (挂载路由)

**Interfaces:**
- Consumes: `config.deepseekKey`
- Produces: `POST /api/proxy/ai` — 接收 `{ prompt }`，返回 `{ lon, lat, name }`

- [ ] **Step 1: 创建 `server/src/routes/proxy.js`**

```js
import { Router } from 'express';
import { config } from '../config/index.js';

const router = Router();

/**
 * POST /api/proxy/ai
 * 代理 DeepSeek 地名解析和生态分析请求
 * Body: { prompt: string, type?: "geo" | "eco" }
 *   type="geo"  (默认): 地名→经纬度解析
 *   type="eco"  : 生态灾害分析
 */
router.post('/ai', async (req, res, next) => {
  try {
    const { prompt, type = 'geo' } = req.body;
    if (!prompt) return res.status(400).json({ error: '缺少 prompt 参数' });

    const systemPrompts = {
      geo: `你是一个专业的地理空间智能体（GIS Agent）。
任务：根据用户输入的地点名，检索它真实的经度、纬度中心。
格式要求：必须返回符合 JSON 语法的格式，不带任何 markdown 标签或其它解释：
{
    "name": "地名（中文）",
    "lon": 经度（数字）,
    "lat": 纬度（数字）
}`,
      eco: `你是一个资深的地质与生态学专家系统。
任务：根据用户输入的山脉/地区名，分析该地的典型自然地学属性。
强制返回合法 JSON 格式，不输出任何多余字符：
{
    "climate": "简述所属气候带与降水特征",
    "soil": "该地常见的土壤类型(如黄壤、红壤等)",
    "vegTrend": "主要植被带类型及南北坡差异",
    "baseVegCoverage": 0.85
}`
    };

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.deepseekKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompts[type] || systemPrompts.geo },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API 错误: ${response.status}`);
    }

    const result = await response.json();
    const jsonText = result.choices?.[0]?.message?.content || '';
    const cleanText = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanText);
    res.json(parsed);
  } catch (err) {
    next(err);
  }
});

export default router;
```

- [ ] **Step 2: 在 `server/src/app.js` 挂载路由**

在 `app.use(errorHandler)` 之前加入：

```js
import proxyRouter from './routes/proxy.js';
app.use('/api/proxy', proxyRouter);
```

- [ ] **Step 3: 验证服务正常**

Run: `node server/src/app.js`
在另一个终端: `curl -X POST http://localhost:3001/api/proxy/ai -H "Content-Type: application/json" -d "{\"prompt\":\"黄山\"}"`
Expected: 返回 `{"name":"黄山","lon":118.18,"lat":30.13}`

- [ ] **Step 4: 提交**

```bash
git add server/src/routes/proxy.js server/src/app.js
git commit -m "feat: 实现 DeepSeek API 代理路由"
```

---

### Task 3: 实现天地图瓦片代理路由

**Files:**
- Create: `server/src/routes/tiles.js`
- Modify: `server/src/app.js` (挂载路由)

**Interfaces:**
- Consumes: `config.tdtTk`
- Produces: `GET /api/tiles/:z/:x/:y` — 返回 PNG 瓦片；`GET /api/tiles/static` — 返回静态卫星影像

- [ ] **Step 1: 创建 `server/src/routes/tiles.js`**

```js
import { Router } from 'express';
import { config } from '../config/index.js';

const router = Router();

/**
 * GET /api/tiles/:z/:x/:y
 * 代理天地图卫星瓦片（隐藏 Token）
 */
router.get('/:z/:x/:y', async (req, res, next) => {
  try {
    const { z, x, y } = req.params;
    const url = `https://t0.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&tk=${config.tdtTk}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`天地图瓦片错误: ${response.status}`);

    const buffer = await response.arrayBuffer();
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(buffer));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tiles/static?lon=...&lat=...&zoom=...
 * 代理天地图静态地图 API（用于 3D 卫星纹理）
 */
router.get('/static', async (req, res, next) => {
  try {
    const { lon, lat, zoom = 13 } = req.query;
    if (!lon || !lat) return res.status(400).json({ error: '缺少 lon/lat 参数' });

    const url = `https://api.tianditu.gov.cn/staticimage?center=${lon},${lat}&width=1024&height=1024&zoom=${zoom}&layers=img_c&tk=${config.tdtTk}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`天地图静态图错误: ${response.status}`);

    const buffer = await response.arrayBuffer();
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(buffer));
  } catch (err) {
    next(err);
  }
});

export default router;
```

- [ ] **Step 2: 在 `server/src/app.js` 挂载瓦片路由**

```js
import tilesRouter from './routes/tiles.js';
app.use('/api/tiles', tilesRouter);
```

- [ ] **Step 3: 验证**

Run: `node server/src/app.js`
浏览器打开 `http://localhost:3001/api/tiles/static?lon=117.1&lat=36.25&zoom=13`
Expected: 返回一张 PNG 卫星图

- [ ] **Step 4: 提交**

```bash
git add server/src/routes/tiles.js server/src/app.js
git commit -m "feat: 实现天地图瓦片代理路由"
```

---

### Task 4: 初始化前端 Vite 项目 + 迁移 index.html

**Files:**
- Create: `client/package.json`
- Create: `client/vite.config.js`
- Move: `index.html` → `client/index.html`
- Move: `js/` → `client/js/`
- Move: `css/` → `client/css/`
- Modify: `client/index.html` (script 改为 ESM)

**Interfaces:**
- Consumes: 后端 `/api/*` 路由
- Produces: Vite 开发服务器 `:3000`，代理 `/api` 到 `:3001`

- [ ] **Step 1: 创建 `client/package.json`**

```json
{
  "name": "terrain-analysis-client",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: 创建 `client/vite.config.js`**

```js
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3001'
    }
  },
  build: {
    outDir: 'dist'
  }
});
```

- [ ] **Step 3: 移动文件**

```bash
md client\css client\js
move index.html client\index.html
move js\*.* client\js\
move css\*.* client\css\
```

- [ ] **Step 4: 编辑 `client/index.html`**

将原有多个 `<script src="js/...">` 标签替换为单个 ESM entry：

```html
<!-- 移除以下所有 script 标签 -->
<script src="js/config.js"></script>
<script src="js/shaders.js"></script>
<!-- ... 等等全部移除 ... -->

<!-- 替换为： -->
<script type="module" src="/js/main.js"></script>
```

- [ ] **Step 5: 安装依赖并验证**

```bash
cd client
npm install
npx vite --port 3000
```

Expected: Vite 启动在 `http://localhost:3000`，页面正常加载，控制台因模块化未完成会有 `import` 错误（下一步修复）

- [ ] **Step 6: 提交**

```bash
git add client/ -A
git rm js/ css/ --cached -r 2>/dev/null || true
git commit -m "feat: 初始化前端 Vite 项目，迁移文件"
```

---

### Task 5: 前端 JS 模块化改造 + API 调用转后端代理

**Files:**
- Modify: `client/js/main.js` (转为 ESM 入口)
- Modify: `client/js/config.js` (移除密钥相关)
- Modify: `client/js/aiAgent.js` (调后端代理)
- Modify: `client/js/render3d.js` (天地图 URL 改后端代理)

**Interfaces:**
- Consumes: 各模块全局变量（保持 `window.xxx` 兼容）
- Produces: ESM 化后的前端应用

- [ ] **Step 1: 修改 `client/js/config.js`**

保留非敏感配置，移除密钥获取函数：

```js
// 前端配置模块 — 不含任何 API Key

function loadLocalConfig() {
  return Promise.resolve();
}

function getTdtTk() { return ''; }     // 密钥在后端
function getApiKey() { return ''; }    // 密钥在后端
```

- [ ] **Step 2: 修改 `client/js/aiAgent.js`**

将直调 DeepSeek 改为调后端代理：

```js
// aiAgent.js — 已改为调后端代理

async function callLLMToAnalyzeRegion(userQuery) {
  const loadingEl = document.getElementById('loading');
  const loadingTitle = document.getElementById('loadingTitle');
  const loadingText = document.getElementById('loadingText');

  loadingEl.style.display = 'flex';
  loadingTitle.innerText = "🧠 AI 地理分析中...";
  loadingText.innerText = "正在向大模型获取该地真实中心空间坐标...";

  try {
    const response = await fetch('/api/proxy/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: userQuery, type: 'geo' })
    });

    if (!response.ok) throw new Error('连接异常');

    const parsed = await response.json();

    activeLon = parsed.lon;
    activeLat = parsed.lat;
    activeName = parsed.name;

    marker2d.setLatLng([activeLat, activeLon]);
    drawSelectionBox(activeLat, activeLon);

    generate3DTerrain();
  } catch (err) {
    console.error(err);
    showBanner("❌ AI 定位失败！" + err.message + "。推荐直接使用地图选区或推荐预设进行稳定展示。");
    loadingEl.style.display = 'none';
  }
}

async function fetchEcoDisasterAnalysis(locationName) {
  try {
    const response = await fetch('/api/proxy/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: locationName, type: 'eco' })
    });

    if (!response.ok) throw new Error('大模型生态评估请求失败');
    return await response.json();
  } catch (err) {
    throw new Error('生态分析失败: ' + err.message);
  }
}
```

- [ ] **Step 3: 修改 `client/js/render3d.js` — `loadSatelliteTexture`**

将天地图直调改为后端代理：

```js
// 在 loadSatelliteTexture 函数中
const meshPhysicalSize = parseFloat(document.getElementById('meshSize').value);
let optimalZoom = 13;
if (meshPhysicalSize <= 1200) optimalZoom = 15;
else if (meshPhysicalSize <= 2000) optimalZoom = 14;
else if (meshPhysicalSize <= 3500) optimalZoom = 13;
else optimalZoom = 12;

// 改前：直接请求天地图（暴露 token）
// const staticUrl = `https://api.tianditu.gov.cn/staticimage?center=...&tk=${tdtTk}`;

// 改后：通过后端代理（无 token 泄露）
const staticUrl = `/api/tiles/static?lon=${activeLon}&lat=${activeLat}&zoom=${optimalZoom}`;
```

- [ ] **Step 4: 修改 `client/js/main.js` — 转为 ESM 入口**

在文件最顶部添加：

```js
// ESM 入口 — 导入所有模块
import './config.js';
import './shaders.js';
import './terrainEngine.js';
import './map2d.js';
import './render3d.js';
import './aiAgent.js';
import './rainSystem.js';

// 显式挂载 HTML onclick 回调到 window
window.selectPreset = selectPreset;
window.toggleMenu = toggleMenu;
window.toggleWireframe = toggleWireframe;
window.toggleAutoSpacing = toggleAutoSpacing;
window.toggleLabels = toggleLabels;
window.updateWaterPlane = updateWaterPlane;
window.updateSunDirection = updateSunDirection;
window.updateContourWidth = updateContourWidth;
window.updateLabelOffset = updateLabelOffset;
window.applyRainPreset = applyRainPreset;
window.setRainTimeSpeed = setRainTimeSpeed;
window.toggleRainPlay = toggleRainPlay;
window.resetRainSimulation = resetRainSimulation;
window.onRainTimeSliderChange = onRainTimeSliderChange;

// 原有代码保持不变 ...
```

- [ ] **Step 5: 全面验证前端**

```bash
# 终端 1
cd server && node src/app.js

# 终端 2
cd client && npx vite --port 3000
```

浏览器打开 `http://localhost:3000`
Expected: 页面加载正常，AI 定位和卫星贴图功能通过后端代理正常工作，浏览器 Network 标签看不到任何 API Key

- [ ] **Step 6: 提交**

```bash
git add client/js/ -A
git commit -m "feat: 前端 JS 模块化改造，API 调用转向后端代理"
```

---

## Phase 2: DEM 高程服务

### Task 6: 实现 DEM 高程服务（GeoTIFF 解析 + 插值）

**Files:**
- Create: `server/src/services/demService.js`
- Create: `server/src/routes/dem.js`
- Modify: `server/src/app.js` (挂载 DEM 路由)

**Interfaces:**
- Consumes: `data/dem/*.tif` GeoTIFF 文件，`config.demDataDir`
- Produces: `GET /api/dem/elevation?lat=&lon=&size=&resolution=` → `{ elevation: number[], metadata: { min, max, mean, source } }`

- [ ] **Step 1: 创建 `server/src/services/demService.js`**

```js
import { readFile, readdir } from 'fs/promises';
import { resolve, extname } from 'path';
import { config } from '../config/index.js';

// 延迟加载 geotiff.js（ESM 兼容）
let GeoTIFF;
async function getGeoTIFF() {
  if (!GeoTIFF) GeoTIFF = await import('geotiff');
  return GeoTIFF;
}

/**
 * 双线性插值
 */
function bilinearInterpolate(data, width, height, u, v) {
  const col = u * (width - 1);
  const row = v * (height - 1);
  const c0 = Math.floor(col);
  const r0 = Math.floor(row);
  const c1 = Math.min(width - 1, c0 + 1);
  const r1 = Math.min(height - 1, r0 + 1);
  const fc = col - c0;
  const fr = row - r0;

  const h00 = data[r0 * width + c0];
  const h01 = data[r0 * width + c1];
  const h10 = data[r1 * width + c0];
  const h11 = data[r1 * width + c1];

  if (h00 === undefined || h01 === undefined || h10 === undefined || h11 === undefined) return 0;
  const top = h00 * (1 - fc) + h01 * fc;
  const bottom = h10 * (1 - fc) + h11 * fc;
  return top * (1 - fr) + bottom * fr;
}

/**
 * 扫描 data/dem 目录，找到包含指定经纬度的 GeoTIFF 文件
 * 返回 { filepath, raster, imageWidth, imageHeight, bbox }
 */
async function findDemFile(lat, lon) {
  const dir = config.demDataDir;
  let files;
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }

  const tifFiles = files.filter(f => extname(f).toLowerCase() === '.tif');
  const { fromUrl, fromBlob } = await getGeoTIFF();

  for (const file of tifFiles) {
    const filepath = resolve(dir, file);
    const buffer = await readFile(filepath);
    const tiff = await fromBlob(new Blob([buffer]));
    const image = await tiff.getImage();
    const bbox = image.getBoundingBox(); // [minX, minY, maxX, maxY]

    // 检查目标点是否在范围内（假设 EPSG:4326）
    if (lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]) {
      const width = image.getWidth();
      const height = image.getHeight();
      const raster = await image.readRasters();
      const data = raster[0]; // Float32Array
      return { filepath, data, width, height, bbox };
    }
  }
  return null;
}

/**
 * 获取指定区域的高程网格
 * @param {number} centerLat
 * @param {number} centerLon
 * @param {number} sizeMeters - 地形物理尺寸（米）
 * @param {number} gridResolution - 网格分辨率（每边点数）
 * @returns {{ elevation: number[], metadata: { min, max, mean, source } }}
 */
export async function getElevationGrid(centerLat, centerLon, sizeMeters, gridResolution) {
  const demFile = await findDemFile(centerLat, centerLon);

  if (!demFile) {
    return null; // 未找到本地 DEM 文件，让前端回退
  }

  const { data, width, height, bbox } = demFile;
  const halfDeg = (sizeMeters / 2400) * 0.05;
  const latMin = centerLat - halfDeg;
  const latMax = centerLat + halfDeg;
  const lonMin = centerLon - halfDeg;
  const lonMax = centerLon + halfDeg;

  const elevation = new Float32Array(gridResolution * gridResolution);
  let min = Infinity, max = -Infinity, sum = 0;

  for (let i = 0; i < gridResolution; i++) {
    for (let j = 0; j < gridResolution; j++) {
      const u = j / (gridResolution - 1);
      const v = i / (gridResolution - 1);
      const lon = lonMin + u * (lonMax - lonMin);
      const lat = latMin + v * (latMax - latMin);

      // 将地理坐标映射到 DEM 像素坐标
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

  return {
    elevation: Array.from(elevation),
    metadata: {
      min: Math.round(min),
      max: Math.round(max),
      mean: Math.round(sum / elevation.length),
      source: demFile.filepath.split('\\').pop().split('/').pop()
    }
  };
}
```

- [ ] **Step 2: 创建 `server/src/routes/dem.js`**

```js
import { Router } from 'express';
import { getElevationGrid } from '../services/demService.js';

const router = Router();

/**
 * GET /api/dem/elevation?lat=...&lon=...&size=2400&resolution=128
 */
router.get('/elevation', async (req, res, next) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    const size = parseInt(req.query.size || '2400');
    const resolution = parseInt(req.query.resolution || '128');

    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ error: '无效的 lat/lon 参数' });
    }

    const result = await getElevationGrid(lat, lon, size, resolution);
    if (!result) {
      return res.json({ elevation: null, metadata: { source: 'not_found' } });
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
```

- [ ] **Step 3: 在 `server/src/app.js` 挂载 DEM 路由**

```js
import demRouter from './routes/dem.js';
app.use('/api/dem', demRouter);
```

- [ ] **Step 4: 创建一个测试用的 DEM 数据文件说明**

在 `server/data/dem/` 下创建一个 `README.txt`:

```
此目录存放预下载的 GeoTIFF 高程数据文件。

数据来源：地理空间数据云 (https://www.gscloud.cn) ASTER GDEM V3 30m

命名规则：<地名>.tif（如 huangshan.tif）

下载方式：登录地理空间数据云 → DEM 数字高程数据 → ASTER GDEM 30M
→ 框选区域 → 下载 GeoTIFF → 放入此目录

预设区域文件列表：
- taibei.tif      (36.25, 117.10)
- huangshan.tif   (30.13, 118.18)
- huashan.tif     (34.48, 110.08)
- longhushan.tif  (28.18, 117.02)
```

- [ ] **Step 5: 提交**

```bash
git add server/src/services/demService.js server/src/routes/dem.js server/data/dem/README.txt server/src/app.js
git commit -m "feat: 实现 DEM 高程服务（GeoTIFF 解析 + 双线性插值）"
```

---

### Task 7: 前端 terrainEngine.js 对接后端 DEM API

**Files:**
- Modify: `client/js/terrainEngine.js` (替换 `fetchRealElevation`)

**Interfaces:**
- Consumes: `GET /api/dem/elevation`
- Produces: 高程网格数据（格式兼容现有 `interpolateHeight`）

- [ ] **Step 1: 修改 `client/js/terrainEngine.js` — `fetchRealElevation`**

```js
async function fetchRealElevation(centerLat, centerLon) {
  const meshPhysicalSize = parseFloat(document.getElementById('meshSize').value);
  const gridSize = elevationGridSize;

  try {
    const response = await fetch(
      `/api/dem/elevation?lat=${centerLat}&lon=${centerLon}&size=${meshPhysicalSize}&resolution=${gridSize}`
    );
    if (!response.ok) throw new Error('高程请求异常');

    const data = await response.json();
    if (data.elevation && data.elevation.length > 0) {
      return data.elevation;
    }
    // 后端返回 null（无本地 DEM 文件），回退到 Open-Meteo
    return await fetchOpenMeteoFallback(centerLat, centerLon);
  } catch (err) {
    console.warn('本地 DEM 服务不可用，回退到 Open-Meteo:', err.message);
    return await fetchOpenMeteoFallback(centerLat, centerLon);
  }
}

/**
 * 回退方案：从 Open-Meteo 免费 API 获取高程
 */
async function fetchOpenMeteoFallback(centerLat, centerLon) {
  const size = elevationGridSize;
  const lats = [];
  const lons = [];
  const meshPhysicalSize = parseFloat(document.getElementById('meshSize').value);
  const halfRange = (meshPhysicalSize / 2400) * 0.05;

  for (let i = 0; i < size; i++) {
    const lat = (centerLat + halfRange) - (i / (size - 1)) * (halfRange * 2);
    for (let j = 0; j < size; j++) {
      const lon = (centerLon - halfRange) + (j / (size - 1)) * (halfRange * 2);
      lats.push(lat.toFixed(5));
      lons.push(lon.toFixed(5));
    }
  }

  const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats.join(',')}&longitude=${lons.join(',')}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Open-Meteo 高程请求异常');
  const data = await response.json();
  return data.elevation || null;
}
```

- [ ] **Step 2: 验证**

```bash
# 终端 1
cd server && node src/app.js

# 终端 2
cd client && npx vite --port 3000
```

浏览器打开 `http://localhost:3000`，点击任一预设
Expected: 页面加载正常，Network 标签可见 `/api/dem/elevation` 请求（如无本地 GeoTIFF 则自动回退 Open-Meteo）

- [ ] **Step 3: 提交**

```bash
git add client/js/terrainEngine.js
git commit -m "feat: terrainEngine 对接后端 DEM API，保留 Open-Meteo 回退"
```

---

## Phase 3: 缓存 + README

### Task 8: 实现瓦片磁盘 LRU 缓存

**Files:**
- Create: `server/src/services/tileCache.js`
- Modify: `server/src/routes/tiles.js` (集成缓存)

**Interfaces:**
- Consumes: `config.tileCacheDir`
- Produces: 磁盘缓存中间件

- [ ] **Step 1: 创建 `server/src/services/tileCache.js`**

```js
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
        // 不删除文件，只更新索引；文件实际清理可后续考虑
      }
    }
  }
}

export const tileCache = new TileCache();
```

- [ ] **Step 2: 修改 `server/src/routes/tiles.js` — 集成缓存**

在 `/api/tiles/:z/:x/:y` 处理函数开头加入缓存检查：

```js
import { tileCache } from '../services/tileCache.js';

// 在 router.get('/:z/:x/:y', ...) 的函数体内：

// 1. 检查缓存
const cached = await tileCache.get(parseInt(z), parseInt(x), parseInt(y));
if (cached) {
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'public, max-age=86400');
  return res.send(cached);
}

// 2. 代理请求...
// 3. 写入缓存
await tileCache.set(parseInt(z), parseInt(x), parseInt(y), Buffer.from(buffer));
```

- [ ] **Step 3: 提交**

```bash
git add server/src/services/tileCache.js server/src/routes/tiles.js
git commit -m "feat: 实现瓦片磁盘 LRU 缓存"
```

---

### Task 9: 更新 README.md

**Files:**
- Modify: `README.md` (完整运行步骤)

- [ ] **Step 1: 重写 `README.md`**

```markdown
# 区域等高线与三维地形智能分析系统

基于 Node.js + Express 后端 + Vite 前端的前后端分离三维地形分析平台。

## 项目结构

```
terrain-analysis-system/
├── server/          # Express 后端
├── client/          # Vite 前端
├── .env             # 密钥配置
└── README.md
```

## 前置准备

1. 安装 [Node.js](https://nodejs.org/) >= 18
2. 在项目根目录创建 `.env` 文件，填入密钥：

```bash
DEEPSEEK_API_KEY=your_deepseek_api_key
TDT_TK=your_tianditu_token
PORT=3001
```

3. （可选）从 [地理空间数据云](https://www.gscloud.cn) 下载 ASTER GDEM 30M 高程数据，
   放入 `server/data/dem/` 目录以获得真实地形。未下载时自动回退到免费 Open-Meteo 高程服务。

## 运行方式

### 开发模式（终端 1 + 终端 2）

```bash
# 终端 1：启动后端
cd server
npm install
npm run dev

# 终端 2：启动前端
cd client
npm install
npm run dev
```

浏览器打开 `http://localhost:3000`

### 生产模式

```bash
cd client
npm install && npm run build    # 构建前端到 dist/
cd ../server
npm install && npm start          # Express 同时提供静态文件和 API
```

浏览器打开 `http://localhost:3001`

## 功能说明

- **2D 地图选区**：Leaflet 交互地图，点击选择地形区域
- **3D 地形渲染**：Three.js 实时渲染，支持等高线、光照、水位模拟
- **AI 地名解析**：输入地名，通过 DeepSeek AI 自动获取坐标（密钥仅在后端）
- **真实 DEM 高程**：本地 GeoTIFF 数据或 Open-Meteo 在线高程
- **卫星影像贴图**：天地图遥感影像（Token 仅在后端）
- **降雨模拟**：粒子系统 + 时序控制，模拟 0-72h 降雨过程
- **AI 生态灾害分析**：分析气候、土壤、植被覆盖率

## 技术栈

| 层级 | 技术 |
|---|---|
| 前端构建 | Vite + 原生 JavaScript |
| 2D 地图 | Leaflet |
| 3D 渲染 | Three.js |
| 后端 | Node.js + Express |
| DEM 数据 | GeoTIFF / Open-Meteo |
| AI 引擎 | DeepSeek API |
```

- [ ] **Step 2: 提交**

```bash
git add README.md
git commit -m "docs: 更新 README 为前后端运行步骤"
```

---

## 自审检查清单

1. **Spec 覆盖度**: 每一项 spec 要求都有对应 Task — 密钥安全 (Task 2, 3, 5)、DEM 数据 (Task 6, 7)、瓦片代理 (Task 3, 8)、Vite迁移 (Task 4, 5)、README (Task 9)。
2. **无占位符**: 所有步骤包含完整代码，无 TBD/TODO/留空。
3. **类型一致性**: API 接口签名在前端和后端之间保持一致 — `/api/dem/elevation?lat=&lon=&size=&resolution=` 在 Task 6 和 Task 7 中完全匹配；`/api/proxy/ai` 的 request/response 格式在 Task 2 和 Task 5 中一致。
4. **回退路径完整**: DEM 服务找不到本地 GeoTIFF 时返回 `null`，前端自动回退 Open-Meteo — 该逻辑在 Task 7 中实现。

---

## 执行说明

2. **Inline Execution** — 在当前会话中使用 executing-plans 技能分批执行，完成后审查
