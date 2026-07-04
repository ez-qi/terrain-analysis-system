# 水位动态累积增强设计文档

- **日期**: 2026-07-05
- **范围**: 降雨模拟中水位累积机制的修复与增强
- **状态**: 已确认，待写实现计划
- **关联**: 性能优化计划 `docs/superpowers/plans/2026-07-04-performance-optimization.md`（独立任务，不依赖其成果）

## 背景

当前 `client/js/rainSystem.js` 的 `tick()` 已实现水位随降雨动态上升（第 264-276 行）：

```javascript
const accumulationFactor = 0.15;        // 硬编码魔数
const waterRise = stepRain * accumulationFactor;
const newWater = Math.min(slider.max, currentWater + waterRise);
```

但机制粗糙，存在 6 个问题：

| # | 问题 | 现象 |
|---|---|---|
| 1 | 系数硬编码 0.15 | 无视地形、降雨强度，上升速率恒定 |
| 2 | 无视地形汇流 | 全局平面水位，不向低洼汇聚 |
| 3 | 上限 = `maxHeight` | 水能淹到山顶 |
| 4 | `onRainTimeSliderChange` 用 `rainRate × hours × 0.15` | 拖时间滑块与播放结果不一致 |
| 5 | 无蒸发下渗 | 雨停水位只增不减 |
| 6 | `accumulationFactor` 含义不清 | 既非汇流系数也非有效降雨比例 |

## 设计决策（brainstorming 已确认）

- **方案范围：A** —— 修复并增强现有全局水位平面机制（不引入洼地填充）
- **退水机制：a** —— 雨停后水位缓慢下降（蒸发下渗）
- **水位上限：ii** —— `(maxHeight - minHeight) × 0.5 + minHeight`（淹到"半山腰"，考虑地形起伏）
- **时间滑块拖动语义：C** —— 显示「当前雨强下若持续到该时刻」的预测值
- **UI 说明方式：C** —— 不改现有标签，加一行小字说明拖动时显示的是预测值

## 新增功能：时间滑块拖动显示预测值

拖动「模拟时间进度」滑块时，实时显示对应时间点的**预测累计降水量**和**预测淹没模拟高度**，按当前雨强滑块值假设持续降雨计算。

**UI 改动（`index.html`）：** 在现有累计降雨显示行下方加一行小字说明，不破坏现有布局。

**计算（`onRainTimeSliderChange`）：** 拖动到 `h` 小时时：
- 预测累计降雨 = `rainRate × h`（mm）
- 预测净累积 = `rainRate × h × RUNOFF_COEFF - LOSS_RATE × h`
- 预测水位 = `max(0, min(slider.max, 预测净累积 × MM_TO_METER))`

**显示同步：**
- `rainAccumDisplay`（累计降雨 mm）显示预测累计降雨
- `waterHeightVal`（淹没高度 米）显示预测水位
- 水位滑块 `waterHeight` value 同步为预测水位
- 3D 水面 `uWaterHeight` 同步更新（调用 `updateWaterPlane`）

**与播放的语义区分：** 播放时显示真实累积值；拖动时显示预测值。通过一行小字说明告知用户语义。

## 设计

### 1. 引入有物理含义的水文参数

替换硬编码 `0.15`，引入两个参数：

| 参数 | 含义 | 默认值 | 取值范围 |
|---|---|---|---|
| `RUNOFF_COEFF` | 有效降雨系数（多少降雨转化为积水，其余下渗） | 0.6 | 0-1 |
| `LOSS_RATE` | 蒸发下渗率（mm/h，雨停或弱雨时水位下降） | 0.5 | ≥0 |

**水位变化公式（每个时间步）：**

```
Δh = (stepRain × RUNOFF_COEFF - LOSS_RATE × hoursPerStep) × 水位换算系数
```

其中 `stepRain = rainRate × hoursPerStep`（mm，本步降雨量）。

**水位换算系数：** 当前 `0.15` 实际承担了"mm 降雨 → 米水位"的单位换算。保留这个量纲关系，命名为 `MM_TO_METER`（默认 0.15，即 1mm 有效降雨约产生 0.15 米水位上升 —— 这是一个简化的视觉化系数，非严格水文物理）。

最终公式：
```
Δh = (stepRain × RUNOFF_COEFF - LOSS_RATE × hoursPerStep) × MM_TO_METER
```

- 雨强 > 损失率：`Δh > 0`，水位上升
- 雨强 < 损失率（如雨停 `rainRate=0`）：`Δh < 0`，水位下降（退水）
- 平衡点：`rainRate × RUNOFF_COEFF = LOSS_RATE`，即 `rainRate ≈ 0.83 mm/h` 时水位不变

### 2. 水位上限改为基于地形起伏

**当前：** `waterSlider.max = Math.ceil(maxHeight)`（在 `main.js:231` 生成地形时设置）

**改为：** `waterSlider.max = Math.ceil((maxHeight - minHeight) × 0.5 + minHeight)`

即淹到"半山腰"。修改点在 `client/js/main.js` 的 `generate3DTerrain` 函数中设置 slider.max 的那行。

### 3. 修复时间滑块与播放一致性

**当前问题：** `onRainTimeSliderChange` 用 `rainAccumulation = rainRate × rainElapsedHours × 0.15`，假设恒定雨强，与播放中实际累积不符。

**改为：** 时间滑块拖动时，按**新公式**重算累积水位：

```javascript
const accumulatedRain = rainRate × rainElapsedHours;  // mm
const netAccum = accumulatedRain × RUNOFF_COEFF - LOSS_RATE × rainElapsedHours;
const newWater = Math.max(0, netAccum × MM_TO_METER);
```

注意下限为 0（退水不能为负），上限为 slider.max。

### 4. 退水机制

**触发：** 雨停（`rainRate = 0` 或播放暂停后雨强视为 0）时，`Δh < 0`，水位按 `LOSS_RATE × hoursPerStep × MM_TO_METER` 下降。

**实现：** 无需额外触发逻辑 —— 公式天然处理：播放中若用户把雨强拉到 0，`stepRain = 0`，`Δh = -LOSS_RATE × hoursPerStep × MM_TO_METER < 0`，水位自动下降。

**下限保护：** `newWater = Math.max(0, currentWater + Δh)`，水位不低于 0。

### 5. 改动文件与范围

| 文件 | 改动 | 行数估计 |
|---|---|---|
| `client/js/rainSystem.js` | 替换 `tick()` 中水位计算段；替换 `onRainTimeSliderChange` 中重算段；新增参数常量；`resetRainSimulation` 不变（已归零） | ~30 行 |
| `client/js/main.js` | 修改 `waterSlider.max` 设置那 1 行 | 1 行 |

**不动：**
- `shaders.js`（shader 里 `uWaterHeight` 用法不变，仍是全局平面）
- `updateWaterPlane` 函数（接口不变）
- UI 结构（不新增滑块，参数用常量，YAGNI）

### 6. 验证方式

保证功能不退化 + 新机制生效：

| 场景 | 预期 |
|---|---|
| 中雨播放 1 小时 | 水位上升约 `20 × 1 × 0.6 × 0.15 = 1.8m` |
| 大暴雨播放 10 小时 | 水位上升至 slider.max 后封顶 |
| 雨强拉到 0 后继续播放 | 水位缓慢下降（退水） |
| 重置按钮 | 水位归零、时间归零 |
| 拖时间滑块到 5 小时（非播放态） | 累计降雨 = `rainRate×5`，预测淹没高度 = `max(0, (rainRate×5×0.6 - 0.5×5)×0.15)`，水面同步更新 |
| 拖时间滑块时 UI | 显示预测淹没高度数值 + 小字说明"拖动时间轴显示当前雨强下的预测值" |
| 播放态拖时间滑块 | 无效（保持现有行为，播放中不响应拖动） |
| 生成新地形后 | slider.max = 半山腰高度，水不会淹到山顶 |
| 降雨/水位/3D 渲染均无报错 | 行为不退化 |

### 7. 非目标（明确不做）

- 洼地填充算法（属方案 C）
- 地形坡度感知（属方案 B，全局平面下视觉差异不明显）
- 新增 UI 滑块控制 `RUNOFF_COEFF` / `LOSS_RATE`（YAGNI，用常量）
- 多洼地独立蓄水
- 真实水文物理模型（当前是视觉化简化）
- 单元测试（前端原生 JS 无测试框架，端到端验证即可）
- 记录播放历史雨强（拖动时按历史回放）—— YAGNI，采用预测值模型

### 8. 附加功能：拖动时间滑块显示预测值

**需求：** 拖动「模拟时间进度」滑块时，实时显示对应时间点的累计降水量和淹没模拟高度。

**语义（brainstorming 确认）：** 拖动时显示的是**预测值** —— "当前雨强下若持续到该时刻"的累计降水和水位，非真实播放历史。播放过程中用户改过雨强的话，拖动值与播放累积值不一致是预期行为。

**计算公式（与第 1 节一致）：**

```
accumulatedRain = rainRate × hours                     // mm，累计降雨
netAccum = accumulatedRain × RUNOFF_COEFF - LOSS_RATE × hours
waterHeight = max(0, min(slider.max, netAccum × MM_TO_METER))   // m，淹没高度
```

**UI 处理（brainstorming 确认：C）：** 不改现有标签，在降雨控制面板的累计/雨强行下方加一行小字说明拖动语义。新增一个 `#waterHeightPredictDisplay` 元素显示预测淹没高度。

**改动点：**

| 文件 | 改动 |
|---|---|
| `client/js/rainSystem.js` | `onRainTimeSliderChange` 改为：按预测公式重算累计降雨和水位，同步更新 `#rainAccumDisplay` 和新增的 `#waterHeightPredictDisplay`，并调用 `updateWaterPlane` |
| `client/index.html` | 在累计/雨强行下方新增一行：小字说明 + 预测淹没高度显示元素 |

**显示规则：**
- **非播放态拖动时间滑块：** 显示预测值（累计降雨 + 预测淹没高度），水位平面同步更新到预测值
- **播放态：** 拖动滑块无效（保持现有行为，播放中以实际累积为准）—— 现有 `onRainTimeSliderChange` 已有 `if (!window.rainPlaying)` 守卫，保留

**UI 新增结构（在 `index.html` 第 189 行后）：**

```html
<div class="text-[10px] text-slate-500 mt-0.5">
  * 拖动时间轴显示当前雨强下的预测值
</div>
<div class="flex items-center justify-between text-xs bg-slate-900 bg-opacity-40 p-2 rounded mt-1">
  <span class="text-slate-400">预测淹没高度: <span id="waterHeightPredictDisplay" class="text-cyan-300 font-bold">0</span> 米</span>
</div>
```
