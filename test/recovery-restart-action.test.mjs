import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
const method=source.slice(source.indexOf('  async restartRecovery()'),source.indexOf('  cancelRecoveryReview()'));
function fixture(change=()=>{},initial={}){
 const calls=[];
 const context={operation:null,document:{hidden:false},epoch:1,state:{residentRecoveryReason:'ipc-recovery-retention-limit',session:null,...initial}};
 context.connectionController={async reviewRecovery(){calls.push('review');context.state.residentRecovery={step:'review'};await change(context);},async confirmRecovery(){calls.push('confirm');}};
 vm.createContext(context);vm.runInContext('restart=({'+method+'}).restartRecovery',context);
 return {context,calls,run:()=>context.restart()};
}
test('restart is explicit and obtains a new review before existing confirmation',async()=>{
 const f=fixture();assert.deepEqual(f.calls,[]);await f.run();assert.deepEqual(f.calls,['review','confirm']);
});
for(const [name,change] of Object.entries({unavailable:c=>c.state.residentRecovery={step:'unavailable'},partial:c=>c.state.residentRecovery={step:'partial'},cancelled:c=>c.state.residentRecovery=undefined,retired:c=>c.epoch++,background:c=>c.document.hidden=true,busy:c=>c.operation={},connected:c=>c.state.session={},reasonChanged:c=>c.state.residentRecoveryReason='ipc-recovery-required'})){
 test(`fresh review cannot confirm after ${name}`,async()=>{const f=fixture(change);await f.run();assert.deepEqual(f.calls,['review']);});
}
test('busy, background, connected and unsupported reasons cannot begin restart',async()=>{
 for(const setup of [c=>c.operation={},c=>c.document.hidden=true,c=>c.state.session={},c=>c.state.residentRecoveryReason='ipc-recovery-required']){
  const f=fixture();setup(f.context);await f.run();assert.deepEqual(f.calls,[]);
 }
});
const recoveryMethods=source.slice(source.indexOf('  async reviewRecovery()'),source.indexOf('  async restoreSavedSignIn()'));
function fullFixture(result){
 const calls=[];const token='d32f7f34-962b-47b7-8f0d-f2fe7f12610a';
 const context={operation:null,document:{hidden:false},epoch:1,state:{residentRecoveryReason:'ipc-recovery-retention-limit',session:null},reviewLocalRecovery:async()=>{calls.push('review');return {status:'reviewable',retainedCount:8,reviewToken:token};},archiveLocalRecovery:async value=>{assert.equal(value,token);calls.push('archive');return result;}};
 context.update=value=>Object.assign(context.state,value);
 context.work=async(message,fn)=>{context.operation=new AbortController();try{await fn(context.operation.signal);}finally{context.operation=null;}};
 vm.createContext(context);vm.runInContext('connectionController={'+recoveryMethods+'async startLocal(){ start(); }}',context);context.start=()=>calls.push('start');
 return {context,calls};
}
test('actual recovery methods only start after matching complete native archive',async()=>{
 const f=fullFixture({status:'archived',archivedCount:8,retainedCount:0});await f.context.connectionController.restartRecovery();assert.deepEqual(f.calls,['review','archive','start']);assert.equal(f.context.state.residentRecoveryReason,undefined);
});
test('actual incomplete and mismatched native outcomes never start or clear the refusal',async()=>{
 for(const result of [{status:'partial',archivedCount:3,retainedCount:5},{status:'unavailable',archivedCount:0,retainedCount:8},{status:'archived',archivedCount:7,retainedCount:0},{status:'archived',archivedCount:8,retainedCount:1}]){
  const f=fullFixture(result);await f.context.connectionController.restartRecovery();assert.deepEqual(f.calls,['review','archive']);assert.equal(f.context.state.residentRecoveryReason,'ipc-recovery-retention-limit');assert.ok(['unavailable','partial'].includes(f.context.state.residentRecovery.step));
 }
});
