// server/src/services/cacheInterface.js
/**
 * @typedef {Object} CacheInterface
 * @property {(key: string) => any} get - 取值，返回深拷贝副本；未命中返回 undefined
 * @property {(key: string, value: any) => void} set - 存值，内部存深拷贝副本
 * @property {(key: string) => boolean} has - 是否存在（不更新访问时间）
 * @property {() => number} size - 当前条目数
 *
 * 契约说明：
 * - get/set 必须做深拷贝，避免调用方修改污染缓存
 * - 实现负责淘汰策略（LRU / TTL 等）
 * - 当前实现见 cache.js 的 MemoryLRU
 * - 未来可新增 RedisCache 实现同接口，注入点替换即可
 */
export {};
