# 区域等高线与三维地形智能分析系统

## 项目目录结构

```
/terrain-analysis-system
│
├── index.html
└── js/
    ├── config.js
    ├── shaders.js
    ├── terrainEngine.js
    ├── map2d.js
    ├── render3d.js
    ├── aiAgent.js
    └── main.js
```

## 本地部署

1. 请在项目根目录启动本地 HTTP 服务器，避免 `file:///` 导致的 CORS 或浏览器资源加载问题。
2. 推荐方式：VS Code 安装并启用 `Live Server` 插件，右键 `index.html` 选择 `Open with Live Server`。
3. 也可使用命令行：
   - `python -m http.server 8000`
   - 然后在浏览器中打开 `http://localhost:8000`

## 说明

- `index.html` 负责 UI 结构与第三方库引入。
- `js/config.js` 用于静态配置与 AI 密钥管理。
- `js/shaders.js` 存放 Three.js 着色器代码。
- `js/terrainEngine.js` 提供高程抓取、双线性插值与 FBM 噪声计算。
- `js/map2d.js` 封装 Leaflet 二维地图交互。
- `js/render3d.js` 处理 Three.js 渲染与地形网格构建。
- `js/aiAgent.js` 实现 DeepSeek GIS Agent 的 AI 地名解析逻辑。
- `js/main.js` 协调控件交互、参数绑定与生成流程。

## 运行注意

- 若要使用 DeepSeek AI 定位，请在 `js/config.js` 中填写 `apiKey`。
- 若无 AI 密钥，系统仍支持 Leaflet 地图选区与本地地形生成。
