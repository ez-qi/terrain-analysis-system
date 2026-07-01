// 全局配置模块（浏览器直开兼容）
// 若需要使用天地图卫星影像或 AI 定位功能，请在本地创建 js/config.local.js 并填入密钥。
window.TDT_TK = window.TDT_TK || "";
window.apiKey = window.apiKey || "";

function loadLocalConfig() {
    return new Promise((resolve) => {
        const scriptId = 'config-local-script';
        if (document.getElementById(scriptId)) return resolve();

        const script = document.createElement('script');
        script.id = scriptId;
        script.src = 'js/config.local.js';
        script.async = false;
        script.onload = () => {
            window.TDT_TK = window.TDT_TK || "";
            window.apiKey = window.apiKey || "";
            resolve();
        };
        script.onerror = () => {
            console.warn('未找到本地密钥文件 js/config.local.js，继续使用默认配置。');
            resolve();
        };
        document.head.appendChild(script);
    });
}

function getTdtTk() {
    return window.TDT_TK || "";
}

function getApiKey() {
    return window.apiKey || "";
}  