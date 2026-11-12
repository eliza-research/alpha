// Cloud speech HTTP 429 (voice-http-429): the native plugin and the development browser route carry
// only its retry facts (limit code, wait, reset); cloudVoiceFailure maps them to plan-limit wording
// with the retry time, keeps the recording, and records the shared lastLimit for the same account.
// Real cloud-voice source with stub ports; the shared readServiceLimit is the projected SDK.
// This is not Cloud, provider, APK or device evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {tsImport} from './support/ts-import.mjs';

const limitModule=await tsImport(new URL('../apps/app/src/runtime/cloud-voice-limit.ts',import.meta.url).href,{parentURL:import.meta.url});
const {readCloudVoiceLimit,cloudVoiceLimitOf}=limitModule;
const now=Date.UTC(2026,9,28,12);
const SENTINEL='PRIVATE_PROVIDER_BODY_SENTINEL';

test('retry facts: body, Retry-After seconds or date, and bounds',()=>{
 assert.deepEqual(readCloudVoiceLimit('17',{error:{code:'rate_limited',retryAfterSeconds:12,message:SENTINEL,plan:{id:'pro'}}},now),{retryAfterSeconds:12,limitCode:'rate_limited'});
 assert.deepEqual(readCloudVoiceLimit('17',null,now),{retryAfterSeconds:17});
 assert.deepEqual(readCloudVoiceLimit(new Date(now+90_000).toUTCString(),null,now),{retryAfterSeconds:90});
 assert.deepEqual(readCloudVoiceLimit(null,{error:{retryAt:new Date(now+4_000).toISOString()}},now),{retryAfterSeconds:4});
 assert.deepEqual(readCloudVoiceLimit(null,{code:'allowance_exhausted',resetAt:new Date(now+86_400_000).toISOString()},now),{limitCode:'allowance_exhausted',resetAt:now+86_400_000});
 for(const [header,body] of [['999999',null],['soon',null],[null,{error:{code:'Rate Limited!',retryAfterSeconds:-1}}],[null,{error:{resetAt:new Date(now-1).toISOString()}}],[null,{error:{resetAt:new Date(now+500*86_400_000).toISOString()}}],[null,'not json'],[null,[{code:'rate_limited'}]]])
  assert.deepEqual(readCloudVoiceLimit(header,body,now),{});
 assert.deepEqual(cloudVoiceLimitOf({code:'voice-http-429',data:{retryAfterSeconds:5,limitCode:'rate_limited',resetAt:now,extra:SENTINEL}}),{retryAfterSeconds:5,limitCode:'rate_limited',resetAt:now});
 assert.equal(cloudVoiceLimitOf({code:'voice-http-402',data:{retryAfterSeconds:5}}),null);
});
