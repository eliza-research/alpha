import test from 'node:test';
import assert from 'node:assert/strict';
import {googleOutcome} from '../apps/app/src/runtime/cloud-sign-in.ts';

const attemptId='12345678-1234-1234-1234-123456789abc';
const required=()=>({status:'mfa',method:'totp',expiresAt:Date.now()+60000,attemptId,environment:'production'});

test('Google MFA outcome is bound to the native attempt and environment, with no credential or challenge disclosure',()=>{
 const outcome=required();assert.deepEqual(googleOutcome(outcome,'production'),outcome);
 for(const patch of [{attemptId:undefined},{attemptId:'---'},{environment:'staging'},{method:'unknown'},{challengeId:'server-secret'},{token:'secret'},{expiresAt:0}]) {
  assert.throws(()=>googleOutcome({...required(),...patch},'production'));
 }
 assert.throws(()=>googleOutcome({...required(),expiresAt:Date.now()-1},'production'),error=>error.code==='expired');
});
