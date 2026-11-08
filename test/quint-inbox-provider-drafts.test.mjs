import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('provider drafts refine reviewed requests, reference restoration and forward identity', {timeout: 180000}, () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import {runInboxProviderDraftsRefinement} from './specs/quint/refinement/services/inbox-provider-drafts.mjs';
    const {receipts, obligations} = await runInboxProviderDraftsRefinement(['test/quint-inbox-provider-drafts.test.mjs']);
    assert.equal(receipts.length, 1);
    const receipt = receipts[0];
    assert.equal(receipt.model, 'InboxProviderDrafts');
    assert.equal(receipt.passed, true);
    assert.equal(receipt.traces, 25);
    assert.equal(receipt.driverInputsBound, true);
    assert.equal(receipt.inputsUnchanged, true);
    assert.ok(receipt.actions.retired);
    assert.ok(receipt.actions.sourceEdit);
    assert.ok(receipt.actions.remoteEdit);
    assert.ok(obligations.length);
    console.log(JSON.stringify({traces: receipt.traces, checkpoints: receipt.checkpoints}));
  `], {cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 170000, maxBuffer: 16 * 1024 * 1024});
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /"traces":25/);
});
