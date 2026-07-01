// 前端配置模块 — 不含任何 API Key（密钥在后端 .env）
// 保留向后兼容接口，确保现有代码不报错

function loadLocalConfig() {
    return Promise.resolve();
}
window.loadLocalConfig = loadLocalConfig;

function getTdtTk() { return ''; }
window.getTdtTk = getTdtTk;

function getApiKey() { return ''; }
window.getApiKey = getApiKey;