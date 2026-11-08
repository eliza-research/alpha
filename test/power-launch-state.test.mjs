import test from 'node:test';
import assert from 'node:assert/strict';
import {protectedPowerLaunchState} from '../apps/app/src/runtime/power-launch-state.ts';
const user='11111111-1111-4111-8111-111111111111',org='22222222-2222-4222-8222-222222222222';
const ready={startupResolved:true,automaticRestore:false,open:false,busy:false,error:'',cloudAccount:{environment:'production',userId:user,organizationId:org},session:{sessionId:'local-current'}};
test('initial renderer and quiet automatic restoration wait, bounded only by native grant',()=>{
 for(const automaticRestore of [undefined,true])assert.deepEqual(protectedPowerLaunchState({...ready,startupResolved:false,automaticRestore,cloudAccount:null,session:null}),{initialRestorePending:true,accountRef:null});
 assert.deepEqual(protectedPowerLaunchState({...ready,startupResolved:false,automaticRestore:false}),{initialRestorePending:false,accountRef:null});
});
test('canonical verified user and organization constrain the native protected grant',()=>{
 assert.equal(protectedPowerLaunchState(ready).accountRef,JSON.stringify(['cloud','production',user,org]));
 assert.equal(protectedPowerLaunchState({...ready,cloudAccount:{...ready.cloudAccount,organizationId:undefined}}).accountRef,JSON.stringify(['cloud','production',user,null]));
 for(const cloudAccount of [null,{...ready.cloudAccount,environment:'staging'},{...ready.cloudAccount,userId:'unverified'},{...ready.cloudAccount,organizationId:'unverified'}])assert.equal(protectedPowerLaunchState({...ready,cloudAccount}).accountRef,null);
});
test('interactive auth, setup, modal and failed restoration cannot wait for later approval',()=>{
 for(const patch of [{signIn:{step:'choose'}},{setupRevision:1},{error:'restore failed'},{open:true}]){
  const result=protectedPowerLaunchState({...ready,startupResolved:false,automaticRestore:false,...patch});assert.equal(result.initialRestorePending,false);assert.equal(result.accountRef,null);
 }
 for(const patch of [{busy:true},{session:null},{open:true},{signIn:{step:'code'}},{setupRevision:1}])assert.equal(protectedPowerLaunchState({...ready,...patch}).accountRef,null);
});
