import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('current renderer, Calendar and voice composition refines source checkpoints', {timeout: 300000}, () => {
  const result=spawnSync(process.execPath,['--import=tsx','--input-type=module','-e',`
    import assert from 'node:assert/strict';
    import {runCompositionRefinement} from './specs/quint/refinement/composition/index.mjs';
    const result=await runCompositionRefinement(['test/quint-composition-refinement.test.mjs']);
    assert.equal(result.receipts.length,1);
    const receipt=result.receipts[0];
    assert.equal(receipt.passed,true);
    assert.equal(receipt.inputsUnchanged,true);
    assert.equal(receipt.driverInputsBound,true);
    assert.equal(receipt.traces,9);
    assert.equal(receipt.checkpoints,44);
    assert.ok(receipt.actions.calendarReturned);
    assert.ok(receipt.actions.voiceInputClosed);
    assert.ok(result.obligations.length);
    console.log(JSON.stringify({traces:receipt.traces,checkpoints:receipt.checkpoints}));
  `],{cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:280000,maxBuffer:16*1024*1024});
  assert.ifError(result.error);
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout,/"traces":9/);
});
