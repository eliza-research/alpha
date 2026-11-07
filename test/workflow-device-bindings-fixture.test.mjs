import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {installWorkflowDeviceBindings} from './fixtures/workflow-device-bindings.mjs';
// The connection-ui vm harnesses (resident-explicit-panel-startup, test-connection-history) get the
// real workflow device bindings through this fixture; only the native bridge probe is synthetic.
test('connection-ui imports from workflow-presentation are all installed by the harness fixture',()=>{
 const text=readFileSync('apps/app/src/runtime/connection-ui.tsx','utf8');
 const imports=[...text.matchAll(/^import\s*\{([^}]*)\}\s*from\s*['"]\.\/workflow-presentation['"]/gm)].flatMap(match=>match[1].split(',').map(name=>name.trim()).filter(name=>name&&!name.startsWith('type ')));
 assert.ok(imports.length>0,'connection-ui.tsx imports workflow-presentation');
 const box=installWorkflowDeviceBindings({workflowPresentationProtocol:async()=>2});
 for(const name of imports)assert.equal(typeof box[name],'function',`the vm fixture must install ${name} (or provide it as a fixture)`);
});
test('real workflow device mapping and 409 downgrade run over the fixture probe',async()=>{
 const signal=new AbortController().signal;
 for(const [probe,expected] of [[2,3],[1,1]]){
  const box=installWorkflowDeviceBindings({workflowPresentationProtocol:async()=>probe});
  assert.equal(await box.workflowDeviceProtocol(signal),expected);
 }
 const box=installWorkflowDeviceBindings({workflowPresentationProtocol:async()=>2});
 const attempts=[];
 const admitted=await box.registerWorkflowDevice(3,async protocol=>{attempts.push(protocol);if(protocol===3)throw Object.assign(Error('conflict'),{status:409});return 'ok';},signal);
 assert.deepEqual(attempts,[3,2]);assert.equal(admitted.workflowProtocol,2);assert.equal(admitted.registered,'ok');
 await assert.rejects(box.registerWorkflowDevice(3,async()=>{throw Object.assign(Error('server'),{status:500});},signal),/server/);
 assert.throws(()=>installWorkflowDeviceBindings({}),/workflowPresentationProtocol fixture/);
});
