# 区域等高线与三维地形智能分析系统

基于 Node.js + Express 后端 + Vite 前端的前后端分离三维地形分析平台。

## 项目结构

```
terrain-analysis-system/
├── server/              # Express 后端（端口 3001）
│   ├── src/
│   │   ├── services/    # DEM、瓦片缓存、通用 LRU
│   │   ├── routes/      # API 路由
│   │   └
│   ├── test/            # 单元测试（node:test）
│   └├── client/              # Vite 前端（开发时端口 3000）
│   ├── js/              # 地形引擎、渲染、降雨、AI、Worker
│   ├── css/
│   ├── index.html
│   ├── vite.config.js
│   └
├── docs/                # 设计文档与实现计划
├── .env.example         # 密钥配置模板
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
| **WebWorker 网格生成** | 地形几何体计算移入 Worker 线程，主线程保持响应，失败自动回退同步生成 |
| **AI 地名解析** | 输入地名，通过 DeepSeek AI 自动获取坐标（密钥仅在后端） |
| **真实 DEM 高程** | 本地 GeoTIFF 数据或 Open-Meteo 在线高程，自动回退 |
| **卫星影像贴图** | 天地图遥感影像，国内精度 12-15 动态、国外固定 12，按选区尺寸匹配 |
| **降雨模拟** | Three.js 粒子系统 + 时序控制，模拟 0-72h 降雨过程，72h 后冻结 |
| **水位动态累积** | 基于水文参数（有效降雨系数、蒸发下渗率）的真实积水模拟，雨停退水 |
| **时间轴预测** | 非播放态拖动时间滑块显示当前雨强下的预测累计降水和淹没高度 |
| **AI 生态灾害分析** | 分析气候、土壤、植被覆盖率，动态调整渲染 |
| **灾害风险热力图** | WLC 加权线性叠加模型，含土壤渗透水量平衡，降水过程中绿→黄→红渐变 |
| **可拖拽侧栏** | 非全屏时可手动拖动分隔条调整控制面板宽度，双击恢复默认 |

## 技术栈

| 层级 | 技术 |
|---|---|
| 前端构建 | Vite + 原生 JavaScript (ES Module) |
| 2D 地图 | Leaflet |
| 3D 渲染 | Three.js |
| WebWorker | 地形网格生成（Transferable Objects 零拷贝） |
| 后端 | Node.js + Express |
| DEM 数据 | 本地 GeoTIFF (geotiff.js) / Open-Meteo 回退 |
| AI 引擎 | DeepSeek API（通过后端代理） |
| 卫星瓦片 | 天地图（通过后端代理，内存 + 磁盘两级 LRU 缓存） |
| 后端缓存 | 通用内存 LRU（DEM 结果 + 瓦片热点），接口抽象可扩展 Redis |
| 响应压缩 | Express compression 中间件（gzip/deflate） |

## API 接口

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/health` | GET | 健康检查 |
| `/api/proxy/ai` | POST | DeepSeek AI 代理（地名解析/生态分析） |
| `/api/dem/elevation` | GET | 高程网格数据（?lat=&lon=&size=&resolution=），内存缓存命中 |
| `/api/tiles/:z/:x/:y` | GET | 卫星瓦片代理（内存 + 磁盘两级缓存） |
| `/api/tiles/static` | GET | 静态卫星影像（?lon=&lat=&zoom=） |

## 性能优化

- **DEM 缓存**：进程内内存 LRU，相同坐标请求命中缓存避免重复计算
- **瓦片两级缓存**：内存热点 LRU + 磁盘 LRU，消除热点瓦片磁盘 I/O
- **WebWorker 网格生成**：高程→几何体计算移入 Worker，主线程保持 UI 响应
- **gzip 压缩**：Express compression 中间件自动压缩 JSON 等响应
- **缓存接口抽象**：当前内存实现，保留未来 Redis 扩展点

## 灾害风险模型

采用 WLC（加权线性叠加）业内基础法，含土壤渗透水量平衡：

```
渗水量 = 渗透率 × 时间 × (1 − 植被截留系数)，被最大蓄水量封顶
有效降水 = 累计降雨 − 已渗透吸收量
风险 = 坡度权重×坡度 + 植被权重×(1−植被) + 土壤权重×土壤 + 岩层权重×岩层 + 0.55×有效降水×坡度门槛
```

- **平原无风险**：降水贡献乘坡度门槛，平原 slope≈0 时降水不推风险
- **水量平衡**：土地渗透吸收降雨，只有超过吸收能力后余量才升风险
- **植被/土壤参数敏感**：覆盖率/渗透率直观影响风险，线性叠加无饱和

## 本地部署说明

- 所有 API Key（DeepSeek、天地图）**仅存在于后端** `.env` 文件中，前端不持有任何密钥
- 开发时 Vite 自动将 `/api/*` 请求代理到后端 `:3001`，无跨域问题
- 前端文件迁移到 `client/` 目录后，原根目录下的 `js/` 和 `css/` 已不再使用
- 生产模式下 Express 服务 `client/dist/` 静态文件，SPA 根路径回退到 `index.html`
