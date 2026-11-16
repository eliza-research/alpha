import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const script=`
const P=await import(${JSON.stringify(resolve(root,'apps/app/src/runtime/workflow-presentation.ts'))});
const fails=status=>Object.assign(new Error('refused'),status===undefined?{}:{status});
const run=async(protocol,failures,{abort=false}={})=>{
 const owner=new AbortController(),calls=[];
 try{
  const out=await P.registerWorkflowDevice(protocol,async p=>{
   calls.push(p);
   if(abort)owner.abort(new Error('retired'));
   if(failures.has(p))throw fails(failures.get(p));
   return {ok:p};
  },owner.signal);
  return {calls,protocol:out.workflowProtocol};
 }catch(error){return {calls,error:error.message};}
};
console.log(JSON.stringify({
 current:await run(5,new Map()),
 retainedCalendar:await run(5,new Map([[5,409]])),
 reminders:await run(5,new Map([[5,409],[4,409]])),
 presentation:await run(5,new Map([[5,409],[4,409],[3,409]])),
 exhausted:await run(5,new Map([[5,409],[4,409],[3,409],[2,409]])),
 noStatus:await run(5,new Map([[5,undefined]])),
 signedOut:await run(5,new Map([[5,409],[4,401]])),
 serverDown:await run(5,new Map([[5,503]])),
 retiredConflict:await run(5,new Map([[5,409]]),{abort:true}),
 retiredSuccess:await run(5,new Map(),{abort:true}),
 legacy:await run(1,new Map()),
}));`;
test('workflow device registration retries older protocols only on HTTP 409 under the same current enrollment',()=>{
 const out=JSON.parse(execFileSync(process.execPath,['-e',script],{cwd:root,encoding:'utf8',timeout:scaledTimeout(60000)}));
 assert.deepEqual(out,{
  current:{calls:[5],protocol:5},
  retainedCalendar:{calls:[5,4],protocol:4},
  reminders:{calls:[5,4,3],protocol:3},
  presentation:{calls:[5,4,3,2],protocol:2},
  exhausted:{calls:[5,4,3,2],error:'refused'},
  noStatus:{calls:[5],error:'refused'},
  signedOut:{calls:[5,4],error:'refused'},
  serverDown:{calls:[5],error:'refused'},
  retiredConflict:{calls:[5],error:'retired'},
  retiredSuccess:{calls:[5],error:'retired'},
  legacy:{calls:[1],protocol:1},
 });
});
