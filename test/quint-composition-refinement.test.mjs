import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('current renderer, Calendar and voice composition refines source checkpoints', {timeout: scaledTimeout(600000)}, () => {
  const result=spawnSync(process.execPath,['-e',`
    import assert from 'node:assert/strict';
    import {runCompositionRefinement} from './specs/quint/refinement/composition/index.mjs';
    const result=await runCompositionRefinement(['test/quint-composition-refinement.test.mjs']);
    assert.equal(result.receipts.length,2);
    assert.ok(result.receipts.every(receipt=>receipt.passed&&receipt.inputsUnchanged&&receipt.driverInputsBound));
    const receipt=result.receipts.find(receipt=>receipt.model==='ControllerComposition');
    assert.ok(receipt);
    assert.equal(receipt.passed,true);
    assert.equal(receipt.inputsUnchanged,true);
    assert.equal(receipt.driverInputsBound,true);
    assert.equal(receipt.traces,9);
    assert.equal(receipt.checkpoints,44);
    assert.ok(receipt.actions.calendarReturned);
    assert.ok(receipt.actions.voiceInputClosed);
    assert.ok(result.obligations.length);
    console.log(JSON.stringify({traces:receipt.traces,checkpoints:receipt.checkpoints}));
  `],{cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:scaledTimeout(590000),maxBuffer:16*1024*1024});
  assert.ifError(result.error);
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout,/"traces":9/);
});
