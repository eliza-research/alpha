import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {checkOSDefaults} from '../specs/quint/refinement/application/os-defaults.mjs';
import {checkOSProvisioning} from '../specs/quint/refinement/application/os-provisioning.mjs';
import {checkOSSourceStaging} from '../specs/quint/refinement/application/os-source-staging.mjs';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';

for(const [model,check,count,actions] of [
 ['OSDefaults',checkOSDefaults,13,['load','storeLayout','storeVersion','restart','ownerLayout','context','ownerAppop','defaultAppop']],
 ['OSProvisioning',checkOSProvisioning,12,['begin','callback','timeout','destroy','authorityLost','ownerKeyboard','keyboardDefault','finish','requestAppearance','applyAppearance']],
 ['OSSourceStaging',checkOSSourceStaging,7,['badAssets','drift','admit','backup','write','failure','verify']],
])test(model+' executes OS source with independently retained harness inputs',{timeout:240000},async()=>{
 const receipt=await check([fileURLToPath(import.meta.url)]);
 assert.equal(receipt.model,model);assert.ok(receipt.passed&&receipt.driverInputsBound&&receipt.inputsUnchanged);
 assert.equal(receipt.traces,count);assert.ok(Object.keys(receipt.generatedSourceSnapshots).length>0);
 assert.ok(verifyRefinementReceiptInputs(receipt),'Consumed and generated inputs revalidate after temporary cleanup');
 for(const name of actions)assert.ok(receipt.actions[name]>0,'Actual-source action '+name);
 assert.ok(Object.keys(receipt.sourceHashesBefore).some(path=>path.endsWith('/application/index.mjs')));
 assert.ok(Object.keys(receipt.sourceHashesBefore).some(path=>path.endsWith('/test/quint-application-refinement.test.mjs')));
});
