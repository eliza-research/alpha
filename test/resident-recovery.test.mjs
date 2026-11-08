import test from 'node:test';
import assert from 'node:assert/strict';
import {residentRecoveryReason,residentRecoveryMessage,residentRecoveryCopy,parseRecoveryReview,parseRecoveryArchive} from '../apps/app/src/runtime/resident-recovery.ts';
const token='d32f7f34-962b-47b7-8f0d-f2fe7f12610a';
test('only exact native hard-block codes change recovery guidance',()=>{
 for(const code of ['ipc-recovery-retention-limit','ipc-recovery-required','runtime-identity-unavailable']){
  assert.equal(residentRecoveryReason(Object.assign(Error('opaque native detail'),{code})),code);
  assert.doesNotMatch(residentRecoveryMessage(code),/another connection|Retry|connect another/i);
 }
 for(const value of [null,Error('ipc-recovery-retention-limit'),{code:'temporary'},{message:'ipc-recovery-required'}])assert.equal(residentRecoveryReason(value),undefined);
});
test('review accepts only a bounded actual-native snapshot and retains no extra metadata',()=>{
 assert.deepEqual(parseRecoveryReview({status:'reviewable',retainedCount:8,reviewToken:token,files:['PRIVATE_PATH']}),{status:'reviewable',retainedCount:8,reviewToken:token});
 for(const value of [null,{status:'reviewable',retainedCount:0,reviewToken:token},{status:'reviewable',retainedCount:65,reviewToken:token},{status:'reviewable',retainedCount:8,reviewToken:'../path'},{status:'ready',retainedCount:8,reviewToken:token}])assert.throws(()=>parseRecoveryReview(value));
 assert.deepEqual(parseRecoveryReview({status:'unavailable',retainedCount:8,reviewToken:token}),{status:'unavailable',retainedCount:8});
});
test('archive outcomes stay finite and incomplete or unknown data cannot mean success',()=>{
 for(const status of ['archived','unavailable','partial'])assert.deepEqual(parseRecoveryArchive({status,archivedCount:3,retainedCount:5,extra:'PRIVATE_PATH'}),{status,archivedCount:3,retainedCount:5});
 for(const value of [null,{status:'success',archivedCount:8,retainedCount:0},{status:'archived',archivedCount:-1,retainedCount:0},{status:'archived',archivedCount:8,retainedCount:NaN}])assert.throws(()=>parseRecoveryArchive(value));
});

test('only reviewable state offers restart readiness; incomplete states remain truthful',()=>{
 const reason='ipc-recovery-retention-limit';
 assert.equal(residentRecoveryCopy(reason,{step:'review',review:{status:'reviewable',retainedCount:8,reviewToken:token}}),'Alpha is ready to restart.');
 for(const view of [undefined,{step:'reviewing'},{step:'archiving'},{step:'unavailable'},{step:'partial'}])assert.doesNotMatch(residentRecoveryCopy(reason,view),/ready to restart|data is safe/);
 for(const reason of ['ipc-recovery-required','runtime-identity-unavailable'])assert.doesNotMatch(residentRecoveryCopy(reason),/ready to restart|data is safe/);
});
