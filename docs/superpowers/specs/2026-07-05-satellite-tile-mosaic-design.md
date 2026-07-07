# 卫星贴图瓦片拼接改造设计文档

- **日期**: 2026-07-05
- **范围**: 卫星贴图从单张静态图改为瓦片拼接，修复国外区域显示比例失衡
- **状态**: 已确认，待写实现计划
- **关联**: 替代上一轮"国外边界框判定降 zoom"的临时方案（commit `1799781`），该方案治标不治本（zoom 降级反而让单张图覆盖范围更大，显示整个岛屿）

## 背景

当前卫星贴图走 `/api/tiles/static`（天地图 staticimage API），返回固定 1024×1024 像素影像。问题：**影像覆盖的地理范围随 zoom 变化** —— zoom 8 时一张 1024px 图覆盖约 625km × 625km，贴到固定大小的地形上比例失衡，国外区域（如日本）会显示整个岛屿和沿海。

上一轮临时方案降国外 zoom 至 8，反而让单图覆盖范围更大，问题更严重。

## 设计决策（brainstorming 已确认）

| 决策点 | 选择 | 理由 |
|---|---|---|
| 瓦片图源 | 保持天地图 `img_w` 瓦片 | 国内精度重要，国外精度无伤大雅，逻辑国内外一致 |
| zoom 选择 | 按选区尺寸动态选，瓦片数 2×2 到 4×4 | 精度与选区尺寸匹配，瓦片数受控 |
| 拼接逻辑位置 | 全前端 Canvas 拼接 | 零后端改动、零依赖，前端能感知加载进度 |

## 设计

### 1. zoom 选择与瓦片网格计算

**zoom 公式：**

```
meshSize（米）→ 选区经纬度范围（度）≈ meshSize / 111000
目标：单片瓦片覆盖范围 ≈ 选区范围的 1/2，瓦片数 ~2×2
单片覆盖 = 360 / 2^z
→ z = log2(360 × 111000 × 2 / meshSize) = log2(79920000 / meshSize)
```

约束 `z ∈ [12, 17]`（下限避免瓦片太少精度差，上限避免瓦片太多负载大）。

| meshSize | 算出 z | 实取 z | 单片覆盖 | 选区覆盖瓦片数 |
|---|---|---|---|---|
| 1000m | 16.6 | 16 | 0.0055° | ~2×2 |
| 2400m | 15.0 | 15 | 0.011° | ~2×2 |
| 5000m | 14.0 | 14 | 0.022° | ~2×2 |

**瓦片坐标计算（天地图 `img_w` Web Mercator，与 OSM/Google 一致）：**

```
x = floor((lon + 180) / 360 × 2^z)
y = floor((1 - asinh(tanh(lat_rad)) / π) / 2 × 2^z)   // lat_rad = lat × π/180
```

按选区中心 `(activeLat, activeLon)` 和 zoom z 算中心瓦片，取 N×N 邻接网格（N 默认 2，确保覆盖选区）。

### 2. 并行加载与 Canvas 拼接

**并行加载（Promise.all + 失败兜底）：**

```
promises = tiles.flat().map(t =>
    fetch(t.url)
      .then(r => r.blob())
      .then(b => createImageBitmap(b))
      .then(bmp => ({ ...t, bmp }))
      .catch(() => null)           // 单瓦片失败返回 null，不阻断整体
)
results = await Promise.all(promises)
```

单瓦片失败返回 `null`，拼接时跳过（对应位置留空）。全部失败才回退 procedural 纹理（保持现有降级逻辑）。

**Canvas 拼接：**

```
const tileSize = 256                          // 天地图瓦片像素
const canvas = document.createElement('canvas')
canvas.width = N × tileSize
canvas.height = N × tileSize
const ctx = canvas.getContext('2d')
for (let r = 0; r < N; r++) {
  for (let c = 0; c < N; c++) {
    const tile = results[r × N + c]
    if (tile && tile.bmp) {
      ctx.drawImage(tile.bmp, c × tileSize, r × tileSize)
    }
    // null 跳过，留空（透明）
  }
}
const texture = new THREE.CanvasTexture(canvas)
texture.needsUpdate = true
texture.wrapS = THREE.ClampToEdgeWrapping
texture.wrapT = THREE.ClampToEdgeWrapping
texture.minFilter = THREE.LinearMipMapLinearFilter
texture.magFilter = THREE.LinearFilter
```

**传给 shader：** `material.uniforms.uSatelliteTex.value = texture`，与现有 shader 接口完全兼容（shader 只采样 `uSatelliteTex`，不关心来源）。

### 3. 替换 loadSatelliteTexture 函数体

**去除：** 上一轮加的国外边界框判定和 zoom 降级逻辑（`isOverseas` 段）整段删除。

**替换：** `loadSatelliteTexture` 函数体替换为：

1. 读 meshSize 滑块值
2. 按 zoom 公式算 z（约束 [12, 17]）
3. 按 activeLat/activeLon 和 z 算中心瓦片 x/y
4. 取 N×N 邻接瓦片网格（N 默认 2）
5. 并行 fetch 所有 `/api/tiles/:z/:x/:y`
6. Canvas 拼接成一张 N×256 像素图
7. 转 THREE.CanvasTexture，配 wrap/filter
8. 传给 material.uniforms.uSatelliteTex
9. 全部失败时回退 procedural（保留现有降级 banner）

**保留不变：**

- 函数签名 `loadSatelliteTexture(material)`
- 调用方 `generate3DTerrain` 中 `await loadSatelliteTexture(terrainMaterial)`
- 成功/失败的 banner 提示和 `uTextureMode` 切换逻辑
- loading 遮罩显示/关闭逻辑

**不再调用：** `/api/tiles/static` 静态图接口。后端 `tiles.js` 的 `/static` 路由保留但不被前端调用（YAGNI，不删除也不维护）。

### 改动文件范围

| 文件 | 改动 |
|---|---|
| `client/js/main.js` | 替换 `loadSatelliteTexture` 函数体；删除 `isOverseas` 边界框判定段 |

**不动：**

- `server/src/routes/tiles.js`（瓦片代理路由已存在，直接复用）
- `client/js/shaders.js`（shader 接口不变）
- `client/js/render3d.js`（其 `loadSatelliteTexture` 副本不动 —— 实际生效的是 `main.js` 版，挂 window 覆盖）

### 验证方式

保证功能不退化 + 比例修复：

| 场景 | 预期 |
|---|---|
| 国内选区（黄山）卫星贴图 | 正常显示，精度与原静态图相当或更好 |
| 国外选区（大峡谷）卫星贴图 | 正常显示，不再显示整个岛屿/国家，比例正确 |
| 切换 meshSize 滑块 | 重新生成后贴图精度匹配选区尺寸 |
| 单瓦片请求失败 | 对应位置留空，不阻断整体贴图 |
| 全部瓦片失败 | 回退 procedural 纹理 + banner 提示（保持现有降级） |
| 3D 渲染无报错 | 行为不退化 |

## 非目标（明确不做）

- 切换到全球卫星瓦片源（Esri/OSM）—— 国内精度更重要，保持天地图
- 后端瓦片拼接接口 —— 全前端拼接，零后端改动
- 删除后端 `/static` 路由 —— YAGNI，保留不维护
- 多分辨率 wmts 或自定义图层 —— 走现有 `img_w` 代理
- 瓦片本地缓存前端侧 —— 后端已有磁盘 LRU，前端不重复缓存
