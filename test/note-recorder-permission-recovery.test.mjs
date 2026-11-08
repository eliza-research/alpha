import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=readFileSync(new URL('../apps/app/src/runtime/note-recorder-driver.ts',import.meta.url),'utf8');
const start=source.indexOf('export function createNoteRecorderDriver'),end=source.indexOf('/** An empty result',start);
assert.ok(start>=0&&end>start);
function fixture(startRecording){
 const events=[];
 const context=vm.createContext({native:{startNoteRecording:startRecording},window:{dispatchEvent:event=>events.push(event)},CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}}});
 vm.runInContext(stripTypeScriptTypes(source.slice(start,end).replace('export function','function')+';globalThis.driver=createNoteRecorderDriver();',{mode:'transform'}),context);
 return {driver:context.driver,events};
}
for(const error of [new DOMException('Blocked','NotAllowedError'),Object.assign(Error('Denied'),{code:'permission-denied'})])
 test(`Notes opens the existing microphone access panel after ${error.name}/${error.code}`,async()=>{
  let calls=0,allowed=false;const f=fixture(async()=>{calls++;if(!allowed)throw error;return {state:'recording',recordingId:'recording'};});
  await assert.rejects(f.driver.start({ownerDigest:'owner',folderId:null}),value=>value===error);
  assert.equal(calls,1);assert.equal(f.events.length,1);assert.equal(f.events[0].type,'alpha:setup-permissions');assert.equal(f.events[0].detail.permission,'microphone');
  allowed=true;assert.equal((await f.driver.start({ownerDigest:'owner',folderId:null})).state,'recording');assert.equal(calls,2);assert.equal(f.events.length,1,'a later granted start does not reopen setup or reset permissions');
 });
test('a recorder device failure does not misdirect the user to permission setup',async()=>{
 const error=Error('Audio device disconnected'),f=fixture(async()=>{throw error;});
 await assert.rejects(f.driver.start({ownerDigest:'owner',folderId:null}),value=>value===error);assert.equal(f.events.length,0);
});
