import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkSourceRenewalQuestion} from '../specs/quint/refinement/application/source-renewal-question.mjs';
import {withHostedDigestRefresh} from '../specs/quint/refinement/application/hosted-digest-refresh.mjs';

const driver = fileURLToPath(import.meta.url);
const mounted = drive => withHostedDigestRefresh(drive, [driver], {native: true});
const pending = (state, kind, id) => state.requests.some(row => row.kind === kind && row.id === id && !row.done);
async function attach(run, id) {
  await run('select', id);
  await run('history', id);
  await run('sync', id);
  const state = await run('observe');
  assert.equal(state.binding, 'session-'+id);
  assert.equal(state.message, 'Synced with this agent.');
}
async function review(run, id) {
  await run('showRenewal', id);
  assert.equal((await run('observe')).renewalDialog, true);
  await run('acceptRenewal');
  const state = await run('observe');
  assert.equal(state.renewalDialog, false);
  assert.ok(pending(state, 'renewal-read', id));
}

test('a retired renewal question cannot publish its refusal in the replacement binding', {timeout: scaledTimeout(60_000)}, async () => {
  await mounted(async scenario => scenario(async run => {
    await attach(run, 1);
    await review(run, 1);
    await run('renewalRead', 1);
    assert.ok(pending(await run('observe'), 'renewal-settle', 1));
    await attach(run, 2);
    await run('renewalSettle', 1);
    const state = await run('observe');
    assert.deepEqual(state.compositions, []);
    assert.equal(state.message, 'Synced with this agent.');
  }));
});

test('a renewal question leaves its exact native tap pending when the composer is unavailable', {timeout: scaledTimeout(60_000)}, async () => {
  await mounted(async scenario => scenario(async run => {
    await attach(run, 1);
    await review(run, 1);
    await run('conversation', false);
    await run('renewalRead', 1);
    const state = await run('observe');
    assert.equal(state.renewalTap, 'tap-1');
    assert.deepEqual(state.compositions, []);
    assert.deepEqual(state.settlements, []);
  }));
});

test('mounted source renewal question matches the bounded Quint projection', {timeout: scaledTimeout(120_000)}, async () => {
  const receipt = await checkSourceRenewalQuestion([driver]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 11);
});
