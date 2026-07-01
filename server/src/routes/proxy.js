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
