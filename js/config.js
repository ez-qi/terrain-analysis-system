// 全局配置模块
// 天地图TK，从本地环境变量读取
const TDT_TK = import.meta.env.VITE_TDT_TK;
// DeepSeek API密钥
const apiKey = import.meta.env.VITE_DEEPSEEK_KEY;

// 增加校验，本地没配置直接抛出提示，防止空key运行
if (!TDT_TK) throw new Error("请在.env.local配置VITE_TDT_TK天地图密钥");
if (!apiKey) throw new Error("请在.env.local配置VITE_DEEPSEEK_KEY");

export default {
  TDT_TK,
  apiKey
}