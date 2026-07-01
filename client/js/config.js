// 前端配置模块 — 不含任何 API Key（密钥在后端 .env）
// 保留向后兼容接口，确保现有代码不报错

function loadLocalConfig() {
    return Promise.resolve();
}

function getTdtTk() {
    return '';  // 密钥在后端，通过 /api/tiles 代理
}

function getApiKey() {
    return '';  // 密钥在后端，通过 /api/proxy/ai 代理
}