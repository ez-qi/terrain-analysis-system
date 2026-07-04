import assert from 'node:assert';
import { test } from 'node:test';
import { MemoryLRU } from '../src/services/cache.js';

test('get 未命中返回 undefined', () => {
  const c = new MemoryLRU(10);
  assert.strictEqual(c.get('nope'), undefined);
});

test('set 后 get 返回相等值', () => {
  const c = new MemoryLRU(10);
  c.set('a', { x: 1 });
  assert.deepEqual(c.get('a'), { x: 1 });
});

test('get 返回深拷贝，修改不影响缓存', () => {
  const c = new MemoryLRU(10);
  c.set('a', { x: [1, 2, 3] });
  const got = c.get('a');
  got.x.push(4);
  assert.deepEqual(c.get('a'), { x: [1, 2, 3] });
});

test('Buffer 深拷贝', () => {
  const c = new MemoryLRU(10);
  const buf = Buffer.from([1, 2, 3]);
  c.set('b', buf);
  const got = c.get('b');
  got[0] = 99;
  assert.equal(c.get('b')[0], 1);
});

test('超容量淘汰最久未访问', () => {
  const c = new MemoryLRU(2);
  c.set('a', 1);
  c.set('b', 2);
  c.get('a');           // a 更新访问时间
  c.set('c', 3);        // 应淘汰 b
  assert.strictEqual(c.has('a'), true);
  assert.strictEqual(c.has('b'), false);
  assert.strictEqual(c.has('c'), true);
});

test('has 和 size', () => {
  const c = new MemoryLRU(10);
  c.set('a', 1);
  assert.strictEqual(c.has('a'), true);
  assert.strictEqual(c.has('z'), false);
  assert.strictEqual(c.size(), 1);
});
