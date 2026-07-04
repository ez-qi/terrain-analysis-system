import assert from 'node:assert';
import { test } from 'node:test';
import { tileCache } from '../src/services/tileCache.js';

test('set 后 get 返回相同 buffer 内容', async () => {
  const buf = Buffer.from([10, 20, 30, 40]);
  await tileCache.set(5, 10, 15, buf);
  const got = await tileCache.get(5, 10, 15);
  assert.ok(got !== null);
  assert.deepEqual(Array.from(got), [10, 20, 30, 40]);
});

test('get 返回副本，修改不影响缓存', async () => {
  const buf = Buffer.from([1, 2, 3]);
  await tileCache.set(7, 2, 2, buf);
  const got = await tileCache.get(7, 2, 2);
  got[0] = 99;
  const got2 = await tileCache.get(7, 2, 2);
  assert.equal(got2[0], 1);
});

test('未命中返回 null', async () => {
  const got = await tileCache.get(99, 99, 99);
  assert.strictEqual(got, null);
});
