import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {captureSources} from '../specs/quint/refinement/application/support.mjs';
import {shellNavigation,developmentSurfaces,developmentDevice,filesTree} from '../specs/quint/refinement/application/surfaces.mjs';

// Partial source contracts: only the original extracted members and controlled ports execute.
// These four distinct components do not establish whole-file refinement or acceptance.
captureSources([fileURLToPath(import.meta.url)]);
for (const [model,run] of [['ShellNavigation',shellNavigation],['DevelopmentSurfaces',developmentSurfaces],['DevelopmentDevice',developmentDevice],['FilesTree',filesTree]]) {
 test('partial source contract: '+model+' retains its original source schedules',{timeout:240000},async()=>{
  const receipt=await run();
  assert.equal(receipt.model,model);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
 });
}
