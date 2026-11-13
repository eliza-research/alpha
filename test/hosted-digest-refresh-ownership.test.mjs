import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {withHostedDigestRefresh} from '../specs/quint/refinement/application/hosted-digest-refresh.mjs';

async function settleInitial(run) {
  await run('select', 1);
  await run('history', 1);
  await run('sync', 1, 1);
}

test('mounted digest refresh keeps follow-up work with its exact session', {timeout: scaledTimeout(120000)}, async t => {
  await withHostedDigestRefresh(async scenario => {
    await t.test('a queued full refresh cannot use the retired agent metadata', () => scenario(async run => {
      await settleInitial(run);
      await run('poll');
      await run('open');
      await run('select', 2);
      await run('history', 2);
      const held = (await run('observe')).requests.find(row => row.kind === 'sync' && row.id === 1 && !row.done);
      assert.ok(held?.aborted, 'Replacement aborts the old result-only flight');
      await run('sync', 1, 1);
      const waiting = await run('observe');
      assert.deepEqual(waiting.capabilities, [1, 2], 'The current binding starts one full read');
      assert.deepEqual(waiting.results, [], 'The old result cannot publish');
      await run('sync', 2, 2);
      const settled = await run('observe');
      assert.deepEqual(settled.results, ['run-2']);
      assert.equal(settled.brief?.agent, 'Fixture agent 2');
    }));

    await t.test('a retired poll cannot dispatch a replacement inbox read', () => scenario(async run => {
      await settleInitial(run);
      await run('poll', true);
      await run('select', 2);
      await run('status', 1);
      const held = await run('observe');
      assert.ok(held.requests.some(row => row.kind === 'history' && row.id === 2 && !row.done));
      assert.ok(!held.requests.some(row => row.kind === 'sync' && row.id === 2));
      await run('history', 2);
      await run('sync', 2, 2);
      const settled = await run('observe');
      assert.deepEqual(settled.capabilities, [1, 2]);
      assert.equal(settled.brief?.agent, 'Fixture agent 2');
    }));

    await t.test('an open panel still promotes a result-only flight in the same session', () => scenario(async run => {
      await settleInitial(run);
      await run('poll');
      await run('open');
      assert.deepEqual((await run('observe')).capabilities, [1], 'Full read waits for the current result-only flight');
      await run('sync', 1, 1);
      assert.deepEqual((await run('observe')).capabilities, [1, 1], 'The live owner gets one full follow-up');
      await run('sync', 1, 1);
      assert.equal((await run('observe')).brief?.agent, 'Fixture agent 1');
    }));
  }, [fileURLToPath(import.meta.url)]);
});
