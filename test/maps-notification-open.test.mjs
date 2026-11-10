import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createMapsNotificationOpen} from '../apps/app/src/runtime/maps-notification-open.ts';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 let ready=false,pending=true,opened=0,consumed=0;
 const control=createMapsNotificationOpen({ready:()=>ready,consume:async()=>{consumed++;const open=pending;pending=false;return {open};},clear:async()=>{pending=false;},open:()=>opened++});
 return {control,ready:value=>{ready=value;},tap:()=>{pending=true;control.request();},get opened(){return opened;},get consumed(){return consumed;}};
}
test('a cold renderer waits for a safe live shell, opens Maps without an in-memory route, and consumes once',async()=>{
 const f=fixture();await f.control.flush();assert.equal(f.consumed,0);
 f.ready(true);await f.control.flush();assert.equal(f.opened,1);
 await f.control.flush();await f.control.flush();assert.equal(f.opened,1);assert.equal(f.consumed,1);
 f.tap();await tick();assert.equal(f.opened,2);assert.equal(f.consumed,2);
});
test('unsafe readiness keeps the native tap pending; HOME cancels it',async()=>{
 const f=fixture();f.tap();await tick();assert.equal(f.consumed,0);
 f.control.cancel();f.ready(true);await f.control.flush();assert.equal(f.opened,0);
 f.tap();await tick();assert.equal(f.opened,1);
});
test('HOME or disposal during a bridge reply prevents a late screen change',async()=>{
 for(const operation of ['cancel','dispose']){
  let resolve,opened=0;const control=createMapsNotificationOpen({ready:()=>true,consume:()=>new Promise(done=>{resolve=done;}),clear:async()=>{},open:()=>opened++});
  const pending=control.flush();control[operation]();resolve({open:true});await pending;assert.equal(opened,0);
 }
});
test('native capture expires, survives renderer startup and never replays after consume or HOME',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-maps-tap-'));
 try {const binary=name=>process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',name):name;
  execFileSync(binary('javac'),['--release','11','-d',directory,'android/app/src/main/java/ai/elizaresearch/alphaphone/NavigationOpenRequest.java','test/fixtures/NavigationOpenRequestTest.java']);
  assert.match(execFileSync(binary('java'),['-cp',directory,'ai.elizaresearch.alphaphone.NavigationOpenRequestTest'],{encoding:'utf8'}),/PASS bounded one-use Maps notification requests/);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
 const activity=fs.readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/MainActivity.java','utf8');
 assert.match(activity,/captureNavigationOpen\(getIntent\(\)\)/);
 assert.match(activity,/boolean showMaps = captureNavigationOpen\(intent\)/);
 assert.match(activity,/intent\.setAction\(Intent\.ACTION_MAIN\)/,'recreation does not recapture the launch action');
});
