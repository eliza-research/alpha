import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
// Scheduled digests panel decisions: pause keeps the saved schedule, a vanished calendar is reported,
// a result tap before the digest binding exists opens nothing, and only a request still in review
// (never dispatched) may be discarded. Not Android/device evidence.
const root=resolve(import.meta.dirname,'..');
const script=`
const d=await import(${JSON.stringify(resolve(root,'apps/app/src/runtime/hosted-digests.ts'))});
const spec={version:1,template:'morning',sourceId:'s',sourceRevision:'r',timeZone:'America/New_York',localTime:'07:15',enabled:true};
const out={};
out.paused=d.digestToggledSpec(spec,false);
out.resumed=d.digestToggledSpec({...spec,enabled:false},true);
out.missing=d.digestMissingCalendars(['work','home'],[{id:'home'}]);
out.present=d.digestMissingCalendars(['home'],[{id:'home'},{id:'other'}]);
out.unbound=[d.digestTapNotice('other-account',false),d.digestTapNotice('unavailable',false)];
out.bound=[d.digestTapNotice('other-account',true),d.digestTapNotice('unavailable',true)];
out.discard=[d.digestPendingDiscardable({phase:'review'}),d.digestPendingDiscardable({phase:'dispatched'}),d.digestPendingDiscardable({})];
console.log(JSON.stringify(out));`;
const out=JSON.parse(execFileSync(process.execPath,['--import=tsx','--input-type=module','-e',script],{cwd:root,encoding:'utf8',timeout:60000}));
test('pause and resume keep the saved time, zone and source',()=>{
 assert.deepEqual(out.paused,{version:1,template:'morning',sourceId:'s',sourceRevision:'r',timeZone:'America/New_York',localTime:'07:15',enabled:false});
 assert.equal(out.resumed.localTime,'07:15');assert.equal(out.resumed.timeZone,'America/New_York');assert.equal(out.resumed.enabled,true);
});
test('a selected calendar the phone no longer lists is reported, not looked up',()=>{
 assert.deepEqual(out.missing,['work']);
 assert.deepEqual(out.present,[]);
});
test('a result tap before the digest binding exists opens nothing',()=>{
 assert.deepEqual(out.unbound,[null,null]);
 assert.deepEqual(out.bound,['Sign in to the matching account to open this result.','This result isn’t available.']);
});
test('only a request still in review can be discarded; dispatched and older records stay Retry-only',()=>{
 assert.deepEqual(out.discard,[true,false,false]);
});
