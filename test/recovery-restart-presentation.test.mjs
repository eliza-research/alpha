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
 assert.match(html,/Restart needed/);assert.doesNotMatch(html,/Your data is safe/);assert.doesNotMatch(html,/<details|<summary|Startup records to keep/);assert.doesNotMatch(html,new RegExp(token));
 const failed=renderToStaticMarkup(React.createElement(context.ResidentRecoveryPanel,{snapshot:{...snapshot,busy:true,residentRecovery:{step:'unavailable'}}}));
 assert.doesNotMatch(failed,/Your data is safe/);assert.match(failed,/<button disabled=""/);
 for(const [reason,buttons] of [['runtime-identity-unavailable',['Try again']],['ipc-recovery-required',[]]]){
  const html=renderToStaticMarkup(React.createElement(context.ResidentRecoveryPanel,{snapshot:{...snapshot,residentRecoveryReason:reason,residentRecovery:undefined}}));
  assert.deepEqual(Array.from(html.matchAll(/<button[^>]*>([^<]*)<\/button>/g),m=>m[1]),buttons);
 }
});
const settings=readFileSync(new URL('../apps/app/src/prototype/settings-adapter.ts',import.meta.url),'utf8');
const start=settings.indexOf("        if(native&&developerTools&&state.page==='agent-recovery-details')");
const end=settings.indexOf("        if(native&&!testMocksEnabled&&state.page==='agent-connection')",start);
// Execute the actual detail page and recovery rows with the existing adapter helper boundaries.
const rowsStart=settings.indexOf('          if(connection.residentRecoveryReason&&!connection.session){',end);
const rowsEnd=settings.indexOf('          if(connection.busy){',rowsStart);
const rows=settings.slice(rowsStart,rowsEnd);
function nativeFixture(connection=snapshot,page='agent-connection',developerTools=true){
 const actions=[];const context={native:true,testMocksEnabled:false,developerTools,state:{page},connection,agentRows:[],out:{stack:[]},residentRecoveryCopy,info:(label,value)=>({label,value}),action:(label,go)=>({label,go}),diagnosticsRow:()=>({label:'Export diagnostics'}),group:rows=>rows,api:{set:value=>actions.push(value)},connectionController:{restartRecovery:()=>actions.push('restart'),retryStartup:()=>actions.push('retry'),startLocal:()=>actions.push('start')}};
 vm.createContext(context);vm.runInContext(transformSync(page==='agent-connection'?rows:settings.slice(start,end),{loader:'ts'}).code,context);return {context,actions};
}
test('the product keeps the plain recovery status and Restart Alpha, with no raw Restart details',()=>{
 assert.ok(start>0&&end>start,'Restart details is gated by the Developer gate');
 const f=nativeFixture(snapshot,'agent-connection',false);
 assert.deepEqual(Array.from(f.context.agentRows,r=>r.label),['Status','Restart Alpha']);
 assert.equal(f.context.agentRows[0].value,residentRecoveryCopy(snapshot.residentRecoveryReason,snapshot.residentRecovery));
 // Unfinished work says to restart the phone and offers diagnostics, never Retry.
 const required=nativeFixture({...snapshot,residentRecoveryReason:'ipc-recovery-required',residentRecovery:undefined},'agent-connection',false).context.agentRows;
 assert.deepEqual(Array.from(required,r=>r.label),['Status','Export diagnostics']);
 assert.equal(required[0].value,'Restart phone');
 // An unchecked runtime identity can be checked again: Try again asks native to start, which re-verifies.
 const identity=nativeFixture({...snapshot,residentRecoveryReason:'runtime-identity-unavailable',residentRecovery:undefined},'agent-connection',false);
 assert.deepEqual(Array.from(identity.context.agentRows,r=>r.label),['Status','Try again','Export diagnostics']);
 assert.match(identity.context.agentRows[0].value,/Startup check failed/);assert.doesNotMatch(identity.context.agentRows[0].value,/reinstall|clear/i);
 identity.context.agentRows[1].go();assert.deepEqual(identity.actions,['retry']);
 const busy=nativeFixture({...snapshot,busy:true,residentRecoveryReason:'runtime-identity-unavailable',residentRecovery:undefined},'agent-connection',false).context.agentRows;
 assert.ok(!Array.from(busy,r=>r.label).includes('Try again'));
 // A stale or direct selection of the details page renders nothing in the product.
 assert.deepEqual(nativeFixture(snapshot,'agent-recovery-details',false).context.out.stack,[]);
});
test('behind the Developer gate, Settings navigates to details without starting recovery',()=>{
 const f=nativeFixture();assert.deepEqual(f.actions,[]);
 assert.deepEqual(Array.from(f.context.agentRows,r=>r.label),['Status','Restart Alpha','Details']);
 f.context.agentRows[2].go();assert.equal(f.actions[0].page,'agent-recovery-details');
 f.context.agentRows[1].go();assert.equal(f.actions[1],'restart');
 const details=nativeFixture(snapshot,'agent-recovery-details');const page=details.context.out.stack[0];
 assert.match(JSON.stringify(page),/Kept items/);assert.doesNotMatch(JSON.stringify(page),new RegExp(token));page.back();assert.equal(details.actions[0].page,'agent-connection');
});
test('native unknown and partial states never claim safe data; unsupported reasons cannot restart',()=>{
 for(const step of ['partial','unavailable']){const f=nativeFixture({...snapshot,residentRecovery:{step}});assert.doesNotMatch(JSON.stringify(f.context.agentRows),/Your data is safe/);}
 const f=nativeFixture({...snapshot,residentRecoveryReason:'runtime-identity-unavailable',residentRecovery:undefined});assert.deepEqual(Array.from(f.context.agentRows,r=>r.label),['Status','Try again','Export diagnostics','Details']);
 const completed=nativeFixture({...snapshot,residentRecoveryReason:undefined,residentRecovery:undefined,session:{}},'agent-recovery-details');assert.match(JSON.stringify(completed.context.out.stack),/"Running"/);
});
