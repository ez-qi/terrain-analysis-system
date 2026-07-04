import assert from 'node:assert';
import { test } from 'node:test';

test('相同坐标第二次调用命中缓存', async () => {
  const { getElevationGrid, __cacheStats } = await import('../src/services/demService.js');
  const before = __cacheStats().hits;
  const r1 = await getElevationGrid(36.25, 117.10, 2400, 64);
  const r2 = await getElevationGrid(36.25, 117.10, 2400, 64);
  // 两次结果应一致（都是 null 或都是有效数据）
  assert.strictEqual(r1 === null, r2 === null);
  // 若非 null，第二次应是深拷贝（不同引用）
  if (r1 !== null) {
    assert.notStrictEqual(r1.elevation, r2.elevation);
    assert.deepEqual(r1.elevation, r2.elevation);
  }
  // 命中计数应增加
  assert.ok(__cacheStats().hits > before, '应有缓存命中');
});

test('坐标量化：36.25001 与 36.25004 视为同一 key', async () => {
  const { getElevationGrid, __cacheStats } = await import('../src/services/demService.js');
  const before = __cacheStats().hits;
  await getElevationGrid(36.25001, 117.10002, 2400, 64);
  await getElevationGrid(36.25004, 117.10008, 2400, 64);
  // 第二次应命中（量化到 4 位小数后相同）
  assert.ok(__cacheStats().hits > before, '量化后应命中缓存');
});
