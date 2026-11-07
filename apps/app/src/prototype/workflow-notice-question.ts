import {reviewContentQuestion} from '../browser/content-question';
import {sensitiveReadingText} from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/page-reading.ts';
import {noticeExcerpt,noticeReviewable} from './context-selection';
import type {resolveWorkflowTap} from '../runtime/workflow-notice-taps';
type Result=Awaited<ReturnType<typeof resolveWorkflowTap>>;
/** An Android Ask action has only an opaque route; authenticated resolution supplies its own live excerpt. */
export function reviewWorkflowNoticeQuestion(options:{result:Extract<Result,{kind:'ready'}>;current:()=>boolean;recheck:()=>Promise<Result>;consume:()=>Promise<void>;discard:()=>Promise<void>;compose:(draft:string)=>void;report:(message:string)=>void;closed:()=>void}):(()=>void)|undefined{
 const {result}=options,notice=result.notice?{...result.notice}:undefined;
 if(!result.question||!notice||!noticeReviewable(notice)){options.report('This notification is no longer available to review. Nothing was added.');return;}
 const excerpt=noticeExcerpt(notice),same=(fresh:Result)=>fresh.kind==='ready'&&fresh.question&&fresh.token===result.token&&JSON.stringify(fresh.notice)===JSON.stringify(notice);
 let canceled=false,composing=false,ended=false;
 const done=()=>{if(ended)return;ended=true;window.removeEventListener('launcher-home',abort);window.removeEventListener('blur',abort);options.closed();};
 let abort=()=>{};
 const close=reviewContentQuestion({name:'Alpha Phone notification',text:excerpt,question:'Help me with this notification.',current:options.current,validate:text=>!sensitiveReadingText(text),closed:dismissed=>{queueMicrotask(()=>{if(!composing){
  // An explicit Cancel settles the native tap so the review never reopens itself; interruptions keep it.
  if(dismissed&&!canceled)void options.discard().catch(()=>{});
  canceled=true;done();}});},compose:draft=>{
  composing=true;
  // The modal closes before this callback; keep the account/view fence through native verification.
  void(async()=>{try{
   if(canceled||!options.current()||!same(await options.recheck())||!options.current())throw Error();
   await options.consume();
   if(canceled||!options.current())throw Error();
   options.compose(draft);
  }catch{options.report('This notification or account changed. Nothing was added to your conversation.');}finally{done();}})();
 }});
 abort=()=>{canceled=true;close();done();};
 window.addEventListener('launcher-home',abort);window.addEventListener('blur',abort);
 return abort;
}
