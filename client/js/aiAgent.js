// DeepSeek GIS Agent 地理语义翻译控制模块

async function callLLMToAnalyzeRegion(userQuery) {
    const localKey = getApiKey();
    if (!localKey || localKey.trim() === "") {
        showBanner("⚠️ 本地未配置 DeepSeek 密钥 (apiKey)，已自动飞往默认地质坐标轴！", true);
        return;
    }

    const loadingEl = document.getElementById('loading');
    const loadingTitle = document.getElementById('loadingTitle');
    const loadingText = document.getElementById('loadingText');
    
    loadingEl.style.display = 'flex';
    loadingTitle.innerText = "🧠 AI 地理分析中...";
    loadingText.innerText = "正在向大模型获取该地真实中心空间坐标...";

    const url = `https://api.deepseek.com/chat/completions`;
    
    const systemPrompt = `
你是一个专业的地理空间智能体（GIS Agent）。
任务：根据用户输入的地点名，检索它真实的经度、纬度中心。
格式要求：必须返回符合 JSON 语法的格式，不带任何 markdown 标签或其它解释：
{
    "name": "地名（中文）",
    "lon": 经度（数字）, 
    "lat": 纬度（数字）
}
`;

    const payload = {
        model: "deepseek-chat",
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userQuery }
        ],
        response_format: { type: "json_object" }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localKey}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error("连接异常");

        const result = await response.json();
        let jsonText = result.choices?.[0]?.message?.content;
        
        if (!jsonText) throw new Error("数据为空");
        jsonText = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
        
        const parsed = JSON.parse(jsonText);
        
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

async function fetchEcoDisasterAnalysis(locationName, apiKey) {
    const localKey = apiKey || getApiKey();
    if (!localKey || localKey.trim() === "") {
        throw new Error("未配置 DeepSeek API 密钥，无法执行生态灾害分析。");
    }

    const url = `https://api.deepseek.com/chat/completions`;
    const systemPrompt = `
你是一个资深的地质与生态学专家系统。
任务：根据用户输入的山脉/地区名，分析该地的典型自然地学属性。
强制返回合法 JSON 格式，不输出任何多余字符：
{
    "climate": "简述所属气候带与降水特征",
    "soil": "该地常见的土壤类型(如黄壤、红壤等)",
    "vegTrend": "主要植被带类型及南北坡差异",
    "baseVegCoverage": 0.85 // 估算该地宏观的平均植被覆盖率 (0.0 到 1.0 的浮点数)
}`;

    const payload = {
        model: "deepseek-chat",
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `请分析：${locationName}` }
        ],
        response_format: { type: "json_object" }
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localKey}`
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error("大模型生态评估请求失败");

    const result = await response.json();
    let jsonText = result.choices?.[0]?.message?.content || '';
    jsonText = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();

    try {
        return JSON.parse(jsonText);
    } catch (e) {
        throw new Error('解析模型返回的 JSON 失败: ' + e.message + '\n原始返回: ' + jsonText);
    }
}
