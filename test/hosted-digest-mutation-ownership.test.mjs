import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {withHostedDigestRefresh} from '../specs/quint/refinement/application/hosted-digest-refresh.mjs';

async function prepare(run) {
  await run('seed', 1);
  await run('seed', 2);
  await run('select', 1);
  await run('history', 1);
  await run('sync', 1, 1);
  await run('open');
  await run('sync', 1, 1);
  assert.equal((await run('observe')).pendingSummary, 'Fixture saved request 1');
  await run('retry');
  const current = await run('observe');
  assert.deepEqual(current.mutations, [1]);
  assert.deepEqual(current.writes, [[1, 'dispatched'], [1, 'dispatched']]);
}

test('mounted digest save settlement keeps the exact journal and refresh owner', {timeout: 120000}, async t => {
  await withHostedDigestRefresh(async scenario => {
    await t.test('a retired save may clear its journal while replacement history remains held', () => scenario(async run => {
      await prepare(run);
      await run('mutate', 1);
      await run('select', 2);
      await run('remove', 1);
      const replacement = await run('observe');
      assert.deepEqual(replacement.stored.map(([id]) => id), [2]);
      assert.ok(replacement.requests.some(row => row.kind === 'history' && row.id === 2 && !row.done));
      assert.ok(!replacement.requests.some(row => row.kind === 'sync' && row.id === 2));
      await run('history', 2);
      await run('sync', 2, 2);
      assert.equal((await run('observe')).pendingSummary, 'Fixture saved request 2');
    }));

    await t.test('retired cleanup leaves the replacement read and mutation busy state independent', () => scenario(async run => {
      await prepare(run);
      await run('mutate', 1);
      await run('select', 2);
      await run('history', 2);
      const replacing = await run('observe');
      assert.ok(replacing.requests.some(row => row.kind === 'sync' && row.id === 2 && !row.done));
      assert.equal(replacing.busy, false);
      await run('sync', 2, 2);
      await run('retry');
      await run('remove', 1);
      const active = await run('observe');
      assert.equal(active.pendingSummary, 'Fixture saved request 2');
      assert.equal(active.busy, true);
      assert.deepEqual(active.mutations, [1, 2]);
      await run('mutate', 2);
      await run('remove', 2);
      await run('sync', 2, 2);
      const settled = await run('observe');
      assert.equal(settled.busy, false);
      assert.deepEqual(settled.stored, []);
      assert.equal(settled.brief?.agent, 'Fixture agent 2');
    }));

    await t.test('a retired source rejection cannot publish after its follow-up read', () => scenario(async run => {
      await prepare(run);
      await run('mutate', 1, 'rejected');
      await run('remove', 1);
      assert.ok((await run('observe')).requests.some(row => row.kind === 'sync' && row.id === 1 && !row.done));
      await run('select', 2);
      await run('sync', 1, 1);
      const replacement = await run('observe');
      assert.doesNotMatch(replacement.message, /Source access changed before saving/);
      assert.deepEqual(replacement.stored.map(([id]) => id), [2]);
      await run('history', 2);
      await run('sync', 2, 2);
    }));
  }, [fileURLToPath(import.meta.url)]);
});
