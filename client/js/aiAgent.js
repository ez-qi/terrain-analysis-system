// DeepSeek GIS Agent 地理语义翻译控制模块（已改为调后端代理）

async function callLLMToAnalyzeRegion(userQuery) {
    const loadingEl = document.getElementById('loading');
    const loadingTitle = document.getElementById('loadingTitle');
    const loadingText = document.getElementById('loadingText');

    loadingEl.style.display = 'flex';
    loadingTitle.innerText = "🧠 AI 地理分析中...";
    loadingText.innerText = "正在向大模型获取该地真实中心空间坐标...";

    try {
        const response = await fetch('/api/proxy/ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: userQuery, type: 'geo' })
        });

        if (!response.ok) throw new Error("连接异常");

        const parsed = await response.json();

        window.activeLon = parsed.lon;
        window.activeLat = parsed.lat;
        window.activeName = parsed.name;

        window.marker2d.setLatLng([window.activeLat, window.activeLon]);
        drawSelectionBox(window.activeLat, window.activeLon);

        generate3DTerrain();

    } catch (err) {
        console.error(err);
        showBanner("❌ AI 定位失败！" + err.message + "。推荐直接使用地图选区或推荐预设进行稳定展示。");
        loadingEl.style.display = 'none';
    }
}

async function fetchEcoDisasterAnalysis(locationName) {
    try {
        const response = await fetch('/api/proxy/ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: locationName, type: 'eco' })
        });

        if (!response.ok) throw new Error("大模型生态评估请求失败");
        return await response.json();
    } catch (err) {
        throw new Error('生态分析失败: ' + err.message);
    }
}

// ESM 导出
window.callLLMToAnalyzeRegion = callLLMToAnalyzeRegion;
window.fetchEcoDisasterAnalysis = fetchEcoDisasterAnalysis;
