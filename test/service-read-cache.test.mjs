import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceReadCache } from '../apps/app/src/runtime/service-read-cache.ts';

const owner = 'owner-A';
const now = 10_000_000_000;
const day = 86_400_000;

function fixture() {
  let raw = null;
  let writes = 0;
  const store = {
    async read() { return structuredClone(raw); },
    async compareExchange(before, value) {
      assert.deepEqual(before, raw);
      raw = structuredClone(value);
      writes++;
      return 'saved';
    },
  };
  return { cache: new ServiceReadCache(owner, store, () => now), store, get writes() { return writes; } };
}

test('the same owner restores a completed read while a different owner is refused', async () => {
  const { cache, store } = fixture();
  const value = { messages: [{ id: 'one' }] };
  await cache.put('inbox', value);

  const reload = new ServiceReadCache(owner, store, () => now + 1);
  assert.deepEqual(await reload.get('inbox'), { value, at: now });
  await assert.rejects(new ServiceReadCache('owner-B', store).get('inbox'), /unavailable/);
});

test('a snapshot past its lifetime is unavailable', async () => {
  const { cache, store } = fixture();
  await cache.put('inbox', 'saved data');
  const later = new ServiceReadCache(owner, store, () => now + 31 * day);
  assert.equal(await later.get('inbox'), null);
});

test('CAS retries merge a concurrent writer’s result and eventually stop on persistent conflict', async () => {
  const f = fixture();
  const save = f.store.compareExchange;
  let attempts = 0;
  f.store.compareExchange = async (before, next) => {
    if (++attempts === 1) {
      await save(before, { version: 1, owner, entries: [{ key: 'other', value: 'concurrent result', at: now }] });
      return 'conflict';
    }
    return save(before, next);
  };
  await f.cache.put('inbox', 'new result');
  assert.equal(attempts, 2);
  assert.equal((await f.cache.get('other')).value, 'concurrent result');
  assert.equal((await f.cache.get('inbox')).value, 'new result');

  attempts = 0;
  f.store.compareExchange = async () => { attempts++; return 'conflict'; };
  await f.cache.put('inbox', 'never committed');
  assert.equal(attempts, 3);
  assert.equal((await f.cache.get('inbox')).value, 'new result');
});

test('disconnect fences queued writes and removes persisted provider data', async () => {
  const f = fixture();
  await f.cache.put('inbox', 'private');
  await Promise.all([f.cache.put('pending', 'must not commit'), f.cache.clear()]);

  assert.equal(f.writes, 2, 'only the first write and the clear commit');
  assert.equal(await f.store.read(), null);
  assert.equal(await f.cache.get('pending'), null);
});

test('bounded caching evicts the oldest pages and keeps recent pages when a body is oversized', async () => {
  const { cache, store } = fixture();
  for (let page = 0; page < 30; page++) await cache.put(`page-${page}`, page);
  const retained = await store.read();
  assert.deepEqual(retained.entries.map(entry => entry.value), Array.from({ length: 24 }, (_, i) => i + 6));

  await cache.put('oversized', 'x'.repeat(5 * 1024 * 1024));
  assert.equal(await cache.get('oversized'), null);
  assert.deepEqual(await store.read(), retained);
});
