# AI 灾害风险图动态演化设计文档

- **日期**: 2026-07-08
- **范围**: AI 灾害热力风险图随累计降水+时间演化，AI 权重提升至 40%，用户可编辑元数据
- **状态**: 已确认，待写实现计划
- **关联**: 替代当前 `shaders.js` 静态风险公式（commit `af122b5` 范围内）

## 背景

当前 shader 灾害风险公式（`shaders.js:44-80`）：

```
slope = 1 - dot(法线, 上向量)
localVeg = uBaseVeg × (1 - slopePenalty) ± 坡向修正
precipFactor = uPrecipitation / 800           // 只读瞬时雨强
risk = slopeRisk × precipFactor × (1.2 - localVeg)
```

问题：
1. 只用坡度+坡向+瞬时雨强+单一植被覆盖率，缺岩层/土壤类型/植被根深/历史密度/断裂带等主控因素
2. AI 只返回 climate/soil/baseVegCoverage 三字段，不参与风险计算，占比约 10%
3. 风险图是瞬时切片，不随累计降水演化，雨强滑条一拖就变
4. 元数据只读，用户无法修正 AI 推断

## 设计决策（brainstorming 已确认）

| # | 决策点 | 选择 | 理由 |
|---|---|---|---|
| 1 | 灾害类型 | A 统一风险值 | 不分滑坡/崩塌/泥石流，简单 |
| 2 | 风险图演化 | B 随累计降水+时间演化 | 接入 rainAccumulation，体现过程 |
| 3 | AI 介入深度 | B AI 生成权重+字段值 | AI 占比约 40%，决定"怎么算" |
| 4 | 数据真实性 | C AI+用户可编辑元数据 | AI 给初值，用户面板可兜底修正 |
| 5 | UI 形态 | B 折叠「灾害元数据」面板 | 不挤占现有面板 |
| 6 | AI 权重形式 | C 权重+临界阈值 | criticalPrecip 是滑坡预警核心物理量 |
| 7 | 演化曲线 | B 临界阈值突跳+滞后回落 | 体现"雨后滑坡"核心机制 |
| 8 | 滞后参数 | B AI 返回 riskDelay/riskDecay | 与 3C 一致，不同地区差异化 |

## 设计

### 1. AI 返回字段扩展（后端 eco 提示词）

`server/src/routes/proxy.js` 的 `eco` system prompt 改为返回扩展字段：

```json
{
  "climate": "简述气候带与降水特征",
  "soil": "主要土壤类型（如黄壤、红壤、黏土、残积土）",
  "lithology": "主要岩层（如砂岩、泥岩、花岗岩、层状灰岩）",
  "vegType": "主要植被类型（如深根乔木、浅根灌丛、草本、竹林）",
  "vegRootDepth": 1.5,
  "baseVegCoverage": 0.75,
  "historicalLandslideDensity": 0.3,
  "faultZoneProximity": 0.2,
  "criticalPrecip": 120,
  "riskDelay": 2.0,
  "riskDecay": 0.3,
  "slopeWeight": 1.2,
  "soilWeight": 0.8,
  "vegWeight": 1.1,
  "lithologyWeight": 1.5
}
```

字段语义：
- `vegRootDepth`（米）：根深决定固土厚度，深根乔木 2-3m、浅根灌丛 0.5m、草本 0.2m
- `historicalLandslideDensity`（0-1）：历史滑坡点密度归一化，高值表示该区易复发
- `faultZoneProximity`（0-1）：断裂带邻近度，高值表示岩体破碎
- `criticalPrecip`（mm）：临界累计降水量，突破则风险突跳（黄土区 25、岩质区 80、残积土区 120）
- `riskDelay`（小时）：雨停后风险开始回落前的滞后时长
- `riskDecay`（1/小时）：退险速率，黄土快退、岩质慢退
- 各 `xxxWeight`（0-2）：AI 按该地地质特征给各因子权重，shader 按权重组合

### 2. 折叠「灾害元数据」面板（前端 UI）

`client/index.html` 在「环境与生态仿真渲染」菜单之后或其内，新增 collapsible-menu：

```html
<div class="collapsible-menu">
  <div class="menu-header" onclick="toggleMenu(this)">
    <span>📊 灾害元数据（可编辑）</span>
    <span class="menu-toggle-icon">▼</span>
  </div>
  <div class="menu-content">
    <div class="menu-items">
      <!-- 每个字段：label + 输入控件 -->
      <label>气候带: <input id="metaClimate" type="text"></label>
      <label>土壤类型: <input id="metaSoil" type="text"></label>
      <label>岩层类别: <input id="metaLithology" type="text"></label>
      <label>植被类型: <input id="metaVegType" type="text"></label>
      <label>植被根深(米): <input id="metaVegRootDepth" type="number" step="0.1"></label>
      <label>植被覆盖率: <input id="metaBaseVeg" type="range" min="0" max="1" step="0.05"></label>
      <label>历史滑坡密度: <input id="metaHistDensity" type="range" min="0" max="1" step="0.05"></label>
      <label>断裂带邻近度: <input id="metaFaultProx" type="range" min="0" max="1" step="0.05"></label>
      <label>临界累计降水(mm): <input id="metaCriticalPrecip" type="number" step="5"></label>
      <label>风险滞后(小时): <input id="metaRiskDelay" type="number" step="0.5"></label>
      <label>退险速率(1/小时): <input id="metaRiskDecay" type="number" step="0.1"></label>
    </div>
  </div>
</div>
```

字段变更触发 shader uniforms 更新（`main.js` 绑定 `oninput`）。

### 3. shader 风险公式改造（核心）

`client/js/shaders.js` 模式3 段替换为：

```glsl
// 多因子权重（AI 给初值，用户可改）
uniform float uSoilWeight;
uniform float uLithologyWeight;
uniform float uVegWeight;
uniform float uSlopeWeight;
uniform float uVegRootDepth;      // 根深米
uniform float uHistDensity;       // 历史滑坡密度 0-1
uniform float uFaultProx;         // 断裂带邻近度 0-1
uniform float uCriticalPrecip;    // 临界累计降水 mm
uniform float uRiskDelay;         // 雨停滞后 小时
uniform float uRiskDecay;         // 退险速率 1/小时
uniform float uRainAccum;         // 累计降水 mm（tick 推入）
uniform float uTimeSinceRain;     // 距上次降雨小时（tick 推入）

// 坡度+坡向（已有）
float slope = 1.0 - max(0.0, dot(norm, vec3(0.0, 1.0, 0.0)));
float aspect = dot(normalize(vec3(norm.x, 0.0, norm.z)), vec3(0.0, 0.0, 1.0));

// 植被固土：根深系数 × 覆盖率 × 坡度惩罚
float slopePenalty = smoothstep(0.3, 0.7, slope);
float localVeg = uBaseVeg * (1.0 - slopePenalty * 0.8);
localVeg += (aspect < 0.0 ? 0.08 : -0.05);
localVeg = clamp(localVeg, 0.0, 1.0);
float vegFactor = uVegWeight * uVegRootDepth * localVeg;  // 深根固土强

// 土壤/岩层风险（由元数据 + 权重组合）
// soil/lithology 字段为文本，shader 难解析 → 用前端推算的归一化因子
// 前端按 soil/lithology 文本查映射表算出 uSoilFactor/uLithologyFactor
float soilRisk = uSoilWeight * uSoilFactor;
float lithRisk = uLithologyWeight * uLithologyFactor * (1.0 + uFaultProx);
float slopeRisk = uSlopeWeight * smoothstep(0.15, 0.65, slope);

// 累计降水演化（突跳+滞后）
float accumFactor = clamp(uRainAccum / max(1.0, uCriticalPrecip), 0.0, 2.0);
float precipTrigger = smoothstep(0.7, 1.3, accumFactor);  // 接近临界缓升，突破突跳

// 雨停滞后回落
// uTimeSinceRain 由 tick 维护：雨停后递增，下雨中归零
float decayReduction = 0.0;
if (uTimeSinceRain > uRiskDelay) {
  decayReduction = (uTimeSinceRain - uRiskDelay) * uRiskDecay;
}
float riskLevel = precipTrigger * max(0.0, 1.0 - decayReduction);

// 历史密度加成（复发地带更易再发）
riskLevel *= (1.0 + uHistDensity * 0.5);

// 综合风险
float risk = slopeRisk * riskLevel * (1.2 - vegFactor) * (soilRisk + lithRisk);
risk = clamp(risk, 0.0, 1.0);

// 热力图设色（已有：绿→黄→橙→红）
vec3 safeColor = vec3(0.1, 0.7, 0.2);
vec3 warnColor = vec3(0.9, 0.8, 0.1);
vec3 dangerColor = vec3(0.9, 0.1, 0.1);
vec3 riskColor = mix(safeColor, warnColor, smoothstep(0.0, 0.5, risk));
riskColor = mix(riskColor, dangerColor, smoothstep(0.5, 1.0, risk));
float gray = dot(vec3(0.38, 0.31, 0.21), vec3(0.333));
baseColor = mix(vec3(gray), riskColor, 0.85);
```

### 4. 前端土壤/岩层因子映射表

`client/js/main.js` 新增映射表（土壤/岩层文本 → 归一化风险因子 0-1）：

```javascript
const SOIL_FACTOR_MAP = {
  '黏土': 0.9, '黄壤': 0.7, '红壤': 0.6, '残积土': 0.8,
  '砂土': 0.3, '壤土': 0.5, '泥石流物源': 1.0
};
const LITHOLOGY_FACTOR_MAP = {
  '泥岩': 0.9, '页岩': 0.8, '砂岩': 0.4, '花岗岩': 0.2,
  '灰岩': 0.3, '层状灰岩': 0.7, '石英岩': 0.1
};

function textToFactor(text, map, fallback = 0.5) {
  for (const [key, val] of Object.entries(map)) {
    if (text.includes(key)) return val;
  }
  return fallback;
}
```

AI 返回后或用户编辑后，按 soil/lithology 文本算 `uSoilFactor`/`uLithologyFactor` 推入 shader。

### 5. tick() 暴露累计降水与时间

`client/js/rainSystem.js` tick() 中已有 `rainAccumulation`，新增 `timeSinceRain`：

```javascript
// 维护：下雨中归零，雨停后递增
if (rainRate > LOSS_RATE) {
  timeSinceRain = 0;
} else {
  timeSinceRain += hoursPerStep;
}

// 推入 shader
if (window.terrainMesh?.material?.uniforms) {
  const u = window.terrainMesh.material.uniforms;
  if (u.uRainAccum) u.uRainAccum.value = rainAccumulation;
  if (u.uTimeSinceRain) u.uTimeSinceRain.value = timeSinceRain;
}
```

### 6. 改动文件汇总

| 文件 | 改动 |
|---|---|
| `server/src/routes/proxy.js` | eco 提示词扩展返回字段 |
| `client/index.html` | 新增折叠「灾害元数据」面板（可编辑字段） |
| `client/js/main.js` | AI 返回后填充面板；字段 oninput 更新 shader；土壤/岩层映射表 |
| `client/js/rainSystem.js` | tick() 维护 timeSinceRain，推入 uRainAccum/uTimeSinceRain |
| `client/js/shaders.js | 模式3 改造：多因子权重 + 临界阈值突跳 + 滞后回落；新增 uniforms |

### 7. 演化行为

| 阶段 | rainAccum vs criticalPrecip | 表现 |
|---|---|---|
| 萌芽期 | < 0.7× | 风险低缓升，绿色 |
| 警戒期 | 0.7-1.3× | 缓升，黄→橙 |
| 临滑期 | ≥ 1.3× | 突跳，红色 |
| 雨停后 | timeSinceRain < riskDelay | 风险不退（滞后） |
| 雨停后 | timeSinceRain > riskDelay | 按 riskDecay 回落 |

### 8. 验证方式

| 场景 | 预期 |
|---|---|
| AI 推演后元数据面板填充 | 所有字段显示 AI 返回值 |
| 编辑元数据字段 | shader uniforms 同步，风险图实时变 |
| 降雨播放累计接近临界 | 风险图由绿渐黄 |
| 累计突破临界 | 风险突跳至红 |
| 雨停后风险Delay 内 | 风险保持高位不退 |
| 雨停后超过 riskDelay | 风险按 riskDecay 回落 |
| 不同地区（黄山 vs 大峡谷） | AI 给不同权重和阈值，风险图差异 |
| 重置降雨 | timeSinceRain 归零，累计归零，风险回萌芽期 |

## 非目标（明确不做）

- 灾害分类（滑坡/崩塌/泥石流独立算法）—— 统一风险值
- 全过程仿真（入渗滞后物理模型、孔隙水压）—— 用 riskDelay/riskDecay 简化
- AI 生成完整公式结构 —— 只给权重和阈值
- 接入离线数据库（地震局断裂带、地质图）—— AI 推断 + 用户可编辑兜底
- 多阶段 UI 显示（萌芽/警戒/临滑/退水）—— shader 内隐处理，UI 不显式标阶段
- 灾害规模估算（可滑体积 = 坡长×厚度×单宽）—— 不算规模，只算风险等级
