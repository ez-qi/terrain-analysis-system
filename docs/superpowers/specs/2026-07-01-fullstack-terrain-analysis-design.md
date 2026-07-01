# 三维地形智能分析系统 — 前后端架构设计

> 日期：2026-07-01
> 状态：设计稿
> 作者：AtomCode（deepseek-v4-flash）

---

## 1. 目标

将当前的纯前端「区域等高线与三维地形智能分析系统」升级为完整的前后端分离项目，核心目标：

1. **密钥安全**：API Key（DeepSeek、天地图等）全部移至后端，前端零泄露风险
2. **真实 DEM 数据**：从国内平台预下载 GeoTIFF 高程数据，替代程序化 FBM 噪声，提供真实地形
3. **卫星瓦片代理**：后端代理天地图瓦片请求，前端不暴露 Token
4. **缓存策略**：后端对瓦片和高程数据做磁盘缓存，降低外部依赖和延迟

---

## 2. 技术栈

| 层级 | 技术 |
|---|---|
| 前端构建 | Vite（ES Module + HMR） |
| 前端语言 | 原生 JavaScript（保持现有代码不变） |
| 前端渲染 | Leaflet（2D）+ Three.js（3D） |
| 后端框架 | Node.js + Express |
| 后端数据 | 本地 GeoTIFF 文件 + 磁盘 LRU 缓存 |
| 配置管理 | `.env` 环境变量（不提交 Git） |

---

## 3. 系统架构

```
┌─────────────────────────────────────────────────┐
│                  客户端 (Vite 开发服务器 :3000)    │
│  index.html → main.js (ESM 入口)                │
│      ├── config.js          配置（无密钥）         │
│      ├── shaders.js         Three.js 着色器       │
│      ├── terrainEngine.js   高程引擎 → 调后端 DEM │
│      ├── map2d.js           Leaflet → 调后端瓦片  │
│      ├── render3d.js        Three.js 渲染（不变）  │
│      ├── aiAgent.js         AI → 调后端代理       │
│      └── rainSystem.js      降雨模拟（不变）       │
└──────────────┬──────────────────────────────────┘
               │ fetch('/api/*')
┌──────────────▼──────────────────────────────────┐
│             后端 Express 服务 (:3001)             │
│                                                   │
│  /api/proxy/ai     POST   DeepSeek 代理           │
│  /api/dem/elevation GET   高程网格数据             │
│  /api/tiles/*       GET   卫星/地形瓦片代理        │
│                                                   │
│  中间件: rateLimit → 日志 → 错误处理               │
│  缓存层: data/dem/ ← 预下载 GeoTIFF               │
│          cache/tiles/ ← 瓦片 LRU 磁盘缓存          │
└──────────────────────────────────────────────────┘
```

---

## 4. 后端 API 设计

### 4.1 `POST /api/proxy/ai`

代理 DeepSeek 地名解析请求。

```
Request:  { prompt: "黄山" }
Response: { lon: 118.18, lat: 30.13, name: "黄山" }

流程: 前端 → 后端（注入 apiKey）→ DeepSeek API → 后端 → 前端
```

### 4.2 `GET /api/dem/elevation`

返回指定区域的高程网格数据。

```
Query:    ?lat=30.13&lon=118.18&size=2400&resolution=128
Response: {
  elevation: [... Float32Array 转 Array],
  metadata: { min, max, mean, source }
}

流程: 后端查找本地 GeoTIFF → 裁剪矩形区域 → 双线性插值重采样 → JSON
```

### 4.3 `GET /api/tiles/:z/:x/:y`

代理卫星/地形瓦片请求。

```
流程: 检查 cache/tiles/ → 命中返回 → 未命中拼接 Token 请求天地图 → 缓存 → 返回
```

---

## 5. 前端迁移方案

### 5.1 Vite 配置

```js
// client/vite.config.js
export default defineConfig({
  root: '.',
  server: {
    port: 3000,
    proxy: { '/api': 'http://localhost:3001' }
  }
})
```

### 5.2 HTML 改造

```html
<!-- index.html 唯一改动 -->
<script type="module" src="/js/main.js"></script>
```

### 5.3 JS 模块化

各文件保持原有逻辑不变，仅做两件事：
1. 在文件内加 `export` 导出需共享的变量
2. `main.js` 作为入口 `import` 所有模块

### 5.4 HTML onclick 兼容

在 ESM 模块中显式挂载到 `window`：
```js
window.selectPreset = selectPreset;
window.toggleMenu = toggleMenu;
// ... 其余 onclick 回调同理
```

---

## 6. DEM 数据管理

### 6.1 数据来源

| 区域 | 来源 | 精度 | 文件 |
|---|---|---|---|
| 中国区域（6 预设点） | 地理空间数据云 ASTER GDEM V3 | 30m | `data/dem/*.tif` |
| 国外区域（富士山、大峡谷等） | OpenTopography SRTM GL1 | 30m | 在线获取后缓存 |

### 6.2 预下载清单

| 预设点 | 地理范围（lat, lon） | 文件名 |
|---|---|---|
| 泰北 | 36.25, 117.10 | `taibei.tif` |
| 黄山 | 30.13, 118.18 | `huangshan.tif` |
| 华山 | 34.48, 110.08 | `huashan.tif` |
| 龙虎山 | 28.18, 117.02 | `longhushan.tif` |
| 富士山 | 35.36, 138.73 | （OpenTopography） |
| 大峡谷 | 36.05, -112.11 | （OpenTopography） |

### 6.3 读取流程

```
demService.getElevation(lat, lon, size, resolution)
  → 查找包含该区域的 GeoTIFF 文件
  → 使用 geotiff.js 解析（纯 JS，无需 GDAL 二进制）
  → 计算文件像素坐标范围
  → 双线性插值到请求的网格分辨率
  → 返回高程 Float32Array
```

---

## 7. 项目目录结构

```
terrain-analysis-system/
├── server/
│   ├── src/
│   │   ├── app.js                  # Express 入口
│   │   ├── config/index.js         # 配置（.env 加载）
│   │   ├── routes/
│   │   │   ├── proxy.js            # DeepSeek 代理
│   │   │   ├── dem.js              # 高程接口
│   │   │   └── tiles.js            # 瓦片代理
│   │   ├── services/
│   │   │   ├── demService.js       # GeoTIFF 解析 + 插值
│   │   │   └── tileCache.js        # 瓦片缓存
│   │   └── middleware/
│   │       ├── rateLimit.js
│   │       └── errorHandler.js
│   ├── data/dem/                   # 预下载 GeoTIFF
│   ├── cache/tiles/                # 自动生成的瓦片缓存
│   └── package.json
├── client/
│   ├── index.html
│   ├── vite.config.js
│   ├── js/
│   │   ├── main.js                 # ESM 入口
│   │   ├── config.js               # 前端配置
│   │   ├── shaders.js
│   │   ├── terrainEngine.js        # 改为调后端 API
│   │   ├── map2d.js                # 瓦片 URL 指向后端
│   │   ├── render3d.js
│   │   ├── aiAgent.js              # 改为调后端 API
│   │   └── rainSystem.js
│   ├── css/style.css
│   └── package.json
├── .env                            # 密钥（不提交 Git）
├── .gitignore
└── README.md
```

---

## 8. 分阶段实施计划

| 阶段 | 内容 | 预计工时 |
|---|---|---|
| **Phase 1** | Express 基础 + DeepSeek 代理 + 瓦片代理 + Vite 迁移 | 1-2 天 |
| **Phase 2** | DEM 服务：GeoTIFF 解析 + 插值 + 高程接口 + 前端对接 | 2-3 天 |
| **Phase 3** | 缓存优化 + README 更新 + 最终验证 | 1 天 |
| **合计** | | **4-6 天** |

---

## 9. 运行方式

### 开发模式

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

浏览器打开 `http://localhost:3000`，Vite 自动将 `/api` 请求代理到后端 `:3001`。

### 生产模式

```bash
cd client
npm run build    # 输出到 dist/
cd ../server
npm start        # Express 同时提供前端静态文件和 API
```

---

## 10. 未涵盖（后续展望）

- 用户认证与多用户地形管理
- 地形分析结果持久化（保存截图、标注）
- 更多 DEM 数据源自动切换
- WMS/WMTS 标准接口支持
