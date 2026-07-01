# 区域等高线与三维地形智能分析系统

基于 Node.js + Express 后端 + Vite 前端的前后端分离三维地形分析平台。

## 项目结构

```
terrain-analysis-system/
├── server/          # Express 后端（端口 3001）
├── client/          # Vite 前端（开发时端口 3000）
├── .env.example     # 密钥配置模板
└── README.md
```

## 前置准备

1. 安装 [Node.js](https://nodejs.org/) >= 18
2. 在项目根目录创建 `.env` 文件（**不要提交 Git**），填入密钥：

```bash
DEEPSEEK_API_KEY=your_deepseek_api_key
TDT_TK=your_tianditu_token
PORT=3001
```

3. （可选）从 [地理空间数据云](https://www.gscloud.cn) 下载 ASTER GDEM 30M 高程数据，
   放入 `server/data/dem/` 目录以获得真实地形。未下载时自动回退到免费 Open-Meteo 高程服务。

## 运行方式

### 开发模式（需要两个终端）

```bash
# 终端 1：启动后端
cd server
npm install
npm run dev

# 终端 2：启动前端（新开终端）
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

| 功能 | 说明 |
|---|---|
| **2D 地图选区** | Leaflet 交互地图，点击选择地形区域 |
| **3D 地形渲染** | Three.js 实时渲染，支持等高线、光照、水位模拟 |
| **AI 地名解析** | 输入地名，通过 DeepSeek AI 自动获取坐标（密钥仅在后端） |
| **真实 DEM 高程** | 本地 GeoTIFF 数据或 Open-Meteo 在线高程，自动回退 |
| **卫星影像贴图** | 天地图遥感影像（Token 仅在后端，不暴露） |
| **降雨模拟** | Three.js 粒子系统 + 时序控制，模拟 0-72h 降雨过程 |
| **AI 生态灾害分析** | 分析气候、土壤、植被覆盖率，动态调整渲染 |

## 技术栈

| 层级 | 技术 |
|---|---|
| 前端构建 | Vite + 原生 JavaScript (ES Module) |
| 2D 地图 | Leaflet |
| 3D 渲染 | Three.js |
| 后端 | Node.js + Express |
| DEM 数据 | 本地 GeoTIFF (geotiff.js) / Open-Meteo 回退 |
| AI 引擎 | DeepSeek API（通过后端代理） |
| 卫星瓦片 | 天地图（通过后端代理，磁盘 LRU 缓存） |

## API 接口

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/health` | GET | 健康检查 |
| `/api/proxy/ai` | POST | DeepSeek AI 代理（地名解析/生态分析） |
| `/api/dem/elevation` | GET | 高程网格数据（?lat=&lon=&size=&resolution=） |
| `/api/tiles/:z/:x/:y` | GET | 卫星瓦片代理 |
| `/api/tiles/static` | GET | 静态卫星影像（?lon=&lat=&zoom=） |

## 本地部署说明

- 所有 API Key（DeepSeek、天地图）**仅存在于后端** `.env` 文件中，前端不持有任何密钥
- 开发时 Vite 自动将 `/api/*` 请求代理到后端 `:3001`，无跨域问题
- 前端文件迁移到 `client/` 目录后，原根目录下的 `js/` 和 `css/` 已不再使用
