import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {noticeExcerpt,noticeReviewable} from '../apps/app/src/prototype/context-selection.ts';
import {sensitiveReadingText} from '../.eliza/client-features/plugins/plugin-native-browser-surface/src/page-reading.ts';
let source=await readFile(new URL('../apps/app/src/prototype/own-notice-question.ts',import.meta.url),'utf8');source=source.replace(/^import .*;\n/gm,'').replace('export function','function')+'\nglobalThis.review=reviewOwnNoticeQuestion;';
const tick=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
function fixture(){let modal,current=true,recheck=true,consumed=0,released=0,closed=0,drafts=[],reports=[];const sandbox={noticeExcerpt,noticeReviewable,sensitiveReadingText,queueMicrotask,window:{addEventListener(){},removeEventListener(){}},reviewContentQuestion:input=>{modal=input;return ()=>input.closed(false);}};vm.createContext(sandbox);vm.runInContext(stripTypeScriptTypes(source,{mode:'transform'}),sandbox);const options={notice:{source:'own',id:'reminder',revision:'a'.repeat(64),title:'Owned reminder',text:'Prepare the meeting',appLabel:'Alpha Phone'},current:()=>current,recheck:async()=>recheck,consume:async()=>{consumed++;},release:async()=>{released++;},compose:text=>drafts.push(text),report:text=>reports.push(text),closed:()=>{closed++;}};return {options,sandbox,open:()=>sandbox.review(options),modal:()=>modal,state:()=>({consumed,released,closed,drafts,reports}),change:()=>{current=false;},stale:()=>{recheck=false;}};}
{
 const f=fixture();f.open();assert.equal(f.modal().validate('Verification code 123456'),false);assert.equal(f.modal().validate('Public meeting plan'),true);f.modal().closed(true);await tick();assert.equal(f.state().released,1);assert.equal(f.state().consumed,0);assert.deepEqual(f.state().drafts,[]);
}
{
 const f=fixture();f.open();f.modal().closed(false);f.modal().compose('Reviewed draft');await tick();assert.equal(f.state().consumed,1);assert.deepEqual(f.state().drafts,['Reviewed draft']);assert.equal(f.state().released,0);
}
{
 const f=fixture();let release;f.options.recheck=()=>new Promise(resolve=>{release=resolve;});f.open();f.modal().closed(false);f.modal().compose('No stale draft');await tick();f.change();release(true);await tick();assert.equal(f.state().consumed,0);assert.deepEqual(f.state().drafts,[]);
}
{
 const f=fixture();f.open();f.stale();f.modal().closed(false);f.modal().compose('No replaced source');await tick();assert.equal(f.state().consumed,0);assert.deepEqual(f.state().drafts,[]);
}
{
 const f=fixture();const abort=f.open();abort();await tick();assert.equal(f.state().released,0);assert.equal(f.state().consumed,0);assert.deepEqual(f.state().drafts,[]);
}
{
 const f=fixture();f.options.notice.source='third-party';assert.equal(f.open(),undefined);assert.equal(f.modal(),undefined);
}
console.log('PASS own-notice question review, reusable cancellation, source and owner fences');
