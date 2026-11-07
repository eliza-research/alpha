import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
// AP-11: a phone registers workflow device protocol 3 and falls back to 2 only when an agent that predates the
// selected-reminders read refuses it (HTTP 409). Sign-in, network, server and status-less transport failures never downgrade it.
const root=resolve(import.meta.dirname,'..');
const script=`
const P=await import(${JSON.stringify(resolve(root,'apps/app/src/runtime/workflow-presentation.ts'))});
const signal=new AbortController().signal;
const fails=status=>Object.assign(new Error('refused'),status===undefined?{}:{status});
const run=async(protocol,failure)=>{const calls=[];try{const out=await P.registerWorkflowDevice(protocol,async p=>{calls.push(p);if(p===3&&failure!==null)throw fails(failure);return {ok:p};},signal);return {calls,protocol:out.workflowProtocol};}catch(error){return {calls,error:error.message};}};
console.log(JSON.stringify({
 accepted:await run(3,null),
 olderAgent:await run(3,409),
 noStatus:await run(3,undefined),
 signedOut:await run(3,401),
 serverDown:await run(3,503),
 protocol1:await run(1,null),
}));`;
test('workflow device registration falls back from protocol 3 only when the agent refuses it',()=>{
 const out=JSON.parse(execFileSync(process.execPath,['--import=tsx','--input-type=module','-e',script],{cwd:root,encoding:'utf8',timeout:60000}));
 assert.deepEqual(out,{
  accepted:{calls:[3],protocol:3},
  olderAgent:{calls:[3,2],protocol:2},
  noStatus:{calls:[3],error:'refused'},
  signedOut:{calls:[3],error:'refused'},
  serverDown:{calls:[3],error:'refused'},
  protocol1:{calls:[1],protocol:1},
 });
});
