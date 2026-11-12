import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {checkResidentSchedulingServiceAdmission,withResidentSchedulingAdmission} from '../specs/quint/refinement/native/resident-scheduling-service-admission.mjs';

test('resident admission executes real receiver refusals and closed lifecycle after stop acknowledgement',{timeout:120_000},async()=>{
  const {receipt}=await checkResidentSchedulingServiceAdmission([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed,true);assert.equal(receipt.inputsUnchanged,true);assert.equal(receipt.driverInputsBound,true);
  assert.equal(receipt.traces,123);assert.ok(receipt.checkpoints>500);
  assert.equal(verifyRefinementReceiptInputs(receipt),true,'generated Java ports remain verifiable after fixture cleanup');
});
for(const mutation of ['ignore-lifecycle','lose-refusal'])test(`resident admission refuses the ${mutation} source canary`,{timeout:120_000},async()=>{
  await assert.rejects(withResidentSchedulingAdmission(()=>assert.fail('mutant source reached receipt generation'),[],mutation),
    error=>{
      assert.match(error.message,/^(?:[^\n]*\/)?java failed \(status 1\)/,'the mutant must compile and fail during source execution');
      assert.match(error.message,mutation==='ignore-lifecycle'
        ? /admit\/decide disagreement|Start admitted while lifecycle closed/
        : /Controlled service refusal/);
      return true;
    });
});
