import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformSync} from 'esbuild';
import {residentRecoveryCopy} from '../apps/app/src/runtime/resident-recovery.ts';
const source=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
const compiled=transformSync(source.slice(source.indexOf('function ResidentRecoveryPanel(')),{loader:'tsx',jsx:'transform'}).code;
const token='d32f7f34-962b-47b7-8f0d-f2fe7f12610a';
const snapshot={residentRecoveryReason:'ipc-recovery-retention-limit',residentRecovery:{step:'review',review:{retainedCount:8,reviewToken:token}},session:null,busy:false};
test('real React recovery panel has one restart action, no collapsible details and no private token',()=>{
 const context={React,residentRecoveryCopy,connectionController:{}};vm.createContext(context);vm.runInContext(compiled,context);
 const html=renderToStaticMarkup(React.createElement(context.ResidentRecoveryPanel,{snapshot}));
 assert.equal((html.match(/<button/g)||[]).length,1);assert.match(html,/>Restart Alpha<\/button>/);
 assert.match(html,/Alpha is ready to restart/);assert.doesNotMatch(html,/Your data is safe/);assert.doesNotMatch(html,/<details|<summary|Startup records to keep/);assert.doesNotMatch(html,new RegExp(token));
 const failed=renderToStaticMarkup(React.createElement(context.ResidentRecoveryPanel,{snapshot:{...snapshot,busy:true,residentRecovery:{step:'unavailable'}}}));
 assert.doesNotMatch(failed,/Your data is safe/);assert.match(failed,/<button disabled=""/);
});
const settings=readFileSync(new URL('../apps/app/src/prototype/settings-adapter.ts',import.meta.url),'utf8');
const start=settings.indexOf("    if ((current === 'agent-connection' || current === 'history') && native && !testMocksEnabled) {");
const end=settings.indexOf("    if (current === 'listening'",start);
assert.ok(start>0&&end>start,'actual Agent page located');
// Execute the current Agent page with controlled native state and its real action callbacks.
function nativeFixture(overrides={},current='agent-connection'){
 const actions=[];
 const connection={...snapshot,kind:'recovering',residentInference:'unavailable',cloudAccount:null,conversations:[],actionHistory:[],...overrides};
 const context={current,native:true,testMocksEnabled:false,connection,agentStatus:'Needs review',serviceName:'Nebula',stack:[],
  info:(label,value)=>({label,value}),log:(label,value)=>({label,value}),row:(label,go)=>({label,go}),group:rows=>({rows}),subpage:(title,groups)=>({title,groups}),
  api:{set:value=>actions.push(value)},connectionController:{confirmRecovery:()=>actions.push('confirm'),reviewRecovery:()=>actions.push('review'),cancelRecoveryReview:()=>actions.push('cancel-review'),cancel:()=>actions.push('cancel'),startLocal:()=>actions.push('start')}};
 vm.createContext(context);vm.runInContext(transformSync(settings.slice(start,end),{loader:'ts'}).code,context);
 const rows=context.stack.flatMap(page=>page.groups.flatMap(group=>group.rows));
 return {context,actions,rows};
}
test('the native Agent page requires the reviewed recovery before confirming restart',()=>{
 const f=nativeFixture();
 assert.deepEqual(f.actions,[]);
 assert.deepEqual(f.rows.filter(row=>row.go).map(row=>row.label),['Keep records and restart','Cancel']);
 assert.match(JSON.stringify(f.rows),/keep 8 old startup records/);
 assert.doesNotMatch(JSON.stringify(f.rows),new RegExp(token));
 assert.doesNotMatch(JSON.stringify(f.rows),/Your data is safe/);
 f.rows.find(row=>row.label==='Keep records and restart').go();
 assert.deepEqual(f.actions,['confirm']);
 f.rows.find(row=>row.label==='Cancel').go();
 assert.deepEqual(f.actions,['confirm','cancel-review']);
});
test('partial and unavailable recovery keep a review action and do not claim completion',()=>{
 for(const step of ['partial','unavailable']){
  const f=nativeFixture({residentRecovery:{step}});
  assert.deepEqual(f.rows.filter(row=>row.go).map(row=>row.label),['Review recovery']);
  assert.match(JSON.stringify(f.rows),/Your records were kept/);
  assert.doesNotMatch(JSON.stringify(f.rows),/Your data is safe|Keep records and restart/);
  f.rows.find(row=>row.label==='Review recovery').go();assert.deepEqual(f.actions,['review']);
 }
});
test('unknown recovery cannot restart and archiving cannot be cancelled from Settings',()=>{
 const unknown=nativeFixture({residentRecoveryReason:'runtime-identity-unavailable',residentRecovery:undefined});
 assert.equal(unknown.rows.filter(row=>row.go).length,0);
 const archiving=nativeFixture({busy:true,residentRecovery:{step:'archiving'}});
 assert.equal(archiving.rows.filter(row=>row.go).length,0);
 assert.deepEqual(nativeFixture({},'agent-recovery-details').context.stack,[]);
});
