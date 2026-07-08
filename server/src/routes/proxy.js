import { Router } from 'express';
import { config } from '../config/index.js';

const router = Router();

/**
 * POST /api/proxy/ai
 * 代理 DeepSeek 地名解析和生态分析请求
 * Body: { prompt: string, type?: "geo" | "eco" }
 *   type="geo" (默认): 地名→经纬度解析
 *   type="eco"       : 生态灾害分析
 */
router.post('/ai', async (req, res, next) => {
  try {
    const { prompt, type = 'geo' } = req.body;
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: '缺少 prompt 参数' });
    }

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
任务：根据用户输入的山脉/地区名，分析该地的典型自然地学属性，用于滑坡/泥石流灾害风险评估。
强制返回合法 JSON 格式，不输出任何多余字符：
{
    "climate": "简述所属气候带与降水特征",
    "soil": "主要土壤类型（如黏土、黄壤、红壤、残积土、砂土、壤土）",
    "lithology": "主要岩层（如泥岩、页岩、砂岩、花岗岩、灰岩、层状灰岩、石英岩）",
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
字段说明：
- vegRootDepth（米）：植被平均根深，深根乔木 2-3、浅根灌丛 0.5、草本 0.2
- baseVegCoverage（0-1）：地表植被覆盖率
- historicalLandslideDensity（0-1）：历史滑坡点密度归一化，高值表示易复发
- faultZoneProximity（0-1）：断裂带邻近度，高值表示岩体破碎
- criticalPrecip（mm）：临界累计降水量，突破则风险突跳（黄土区 25、岩质区 80、残积土区 120）
- riskDelay（小时）：雨停后风险开始回落前的滞后时长
- riskDecay（1/小时）：退险速率，黄土快退、岩质慢退
- 各 xxxWeight（0-2）：该因子在风险公式中的权重，按该地地质特征给值`
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
      const errorText = await response.text().catch(() => '');
      throw new Error(`DeepSeek API 错误 (${response.status}): ${errorText}`);
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
