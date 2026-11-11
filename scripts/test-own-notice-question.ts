import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from '../test/support/strip-types.mjs';
import {noticeExcerpt,noticeReviewable} from '../apps/app/src/prototype/context-selection.ts';
import {sensitiveReadingText} from '../.eliza/client-features/plugins/plugin-native-browser-surface/src/page-reading.ts';
import type {reviewContentQuestion} from '../apps/app/src/browser/content-question.ts';
import type {reviewOwnNoticeQuestion} from '../apps/app/src/prototype/own-notice-question.ts';

const source=(await readFile(new URL('../apps/app/src/prototype/own-notice-question.ts',import.meta.url),'utf8'))
 .replace(/^import .*;\n/gm,'').replace('export function','function')+'\nglobalThis.review=reviewOwnNoticeQuestion;';
const reviewScript=new vm.Script(stripTypeScriptTypes(source,{mode:'strip'}));
const tick=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};

type Modal = Parameters<typeof reviewContentQuestion>[0];
type Review = typeof reviewOwnNoticeQuestion;
function fixture(){
 let modal: Modal | undefined;
 let current=true,recheck=true,consumed=0,released=0,closed=0;
 const drafts: string[]=[];
 const reports: string[]=[];
 const sandbox={
  noticeExcerpt,noticeReviewable,sensitiveReadingText,queueMicrotask,
  window:{addEventListener(){},removeEventListener(){}},
  reviewContentQuestion(input: Modal){
   modal=input;
   return ()=>input.closed?.(false);
  },
  review: undefined as Review | undefined,
 };
 reviewScript.runInNewContext(sandbox);
 assert.ok(sandbox.review);
 const review=sandbox.review;
 const options: Parameters<Review>[0]={
  notice:{source:'own',id:'reminder',revision:'a'.repeat(64),title:'Owned reminder',text:'Prepare the meeting',appLabel:'Alpha Phone'},
  current:()=>current,recheck:async()=>recheck,consume:async()=>{consumed++;},release:async()=>{released++;},
  compose:text=>{drafts.push(text);},report:text=>{reports.push(text);},closed:()=>{closed++;},
 };
 return {
  options,
  open:()=>review(options),
  modal:()=>{
   assert.ok(modal?.validate && modal.closed);
   return {validate:modal.validate,closed:modal.closed,compose:modal.compose};
  },
  hasModal:()=>modal!==undefined,
  state:()=>({consumed,released,closed,drafts,reports}),
  change:()=>{current=false;},
  stale:()=>{recheck=false;},
 };
}
{
 const f=fixture();f.open();assert.equal(f.modal().validate('Verification code 123456'),false);assert.equal(f.modal().validate('Public meeting plan'),true);f.modal().closed(true);await tick();assert.equal(f.state().released,1);assert.equal(f.state().consumed,0);assert.deepEqual(f.state().drafts,[]);
}
{
 const f=fixture();f.open();f.modal().closed(false);f.modal().compose('Reviewed draft');await tick();assert.equal(f.state().consumed,1);assert.deepEqual(f.state().drafts,['Reviewed draft']);assert.equal(f.state().released,0);
}
{
 const f=fixture();const check=Promise.withResolvers<boolean>();f.options.recheck=()=>check.promise;f.open();f.modal().closed(false);f.modal().compose('No stale draft');await tick();f.change();check.resolve(true);await tick();assert.equal(f.state().consumed,0);assert.deepEqual(f.state().drafts,[]);
}
{
 const f=fixture();f.open();f.stale();f.modal().closed(false);f.modal().compose('No replaced source');await tick();assert.equal(f.state().consumed,0);assert.deepEqual(f.state().drafts,[]);
}
{
 const f=fixture();const abort=f.open();assert.ok(abort);abort();await tick();assert.equal(f.state().released,0);assert.equal(f.state().consumed,0);assert.deepEqual(f.state().drafts,[]);
}
{
 const f=fixture();f.stale();f.open();f.modal().closed(false);f.modal().compose('Changed source');await tick();assert.deepEqual(f.state().reports,['This notification changed.']);
}
{
 const f=fixture();const consumption=Promise.withResolvers<void>();f.options.consume=()=>consumption.promise;const abort=f.open();assert.ok(abort);f.modal().closed(false);f.modal().compose('Spent tap');await tick();abort();consumption.resolve();await tick();assert.deepEqual(f.state().drafts,['Spent tap']);assert.deepEqual(f.state().reports,[]);assert.equal(f.state().closed,1);
}
{
 const f=fixture();const consumption=Promise.withResolvers<void>();f.options.consume=()=>consumption.promise;f.open();f.modal().closed(false);f.modal().compose('Lost question');await tick();f.change();consumption.resolve();await tick();assert.deepEqual(f.state().drafts,[]);assert.deepEqual(f.state().reports,['Couldn’t keep']);
}
{
 const f=fixture();const check=Promise.withResolvers<boolean>();f.options.recheck=()=>check.promise;const abort=f.open();assert.ok(abort);f.modal().closed(false);f.modal().compose('Canceled during recheck');await tick();abort();check.resolve(true);await tick();assert.equal(f.state().consumed,0);assert.deepEqual(f.state().drafts,[]);assert.equal(f.state().closed,1);
}
{
 const f=fixture();f.options.notice.source='third-party';assert.equal(f.open(),undefined);assert.equal(f.hasModal(),false);assert.deepEqual(f.state().reports,['Unavailable']);
}
console.log('PASS own-notice question review, reusable cancellation, source and owner fences');
