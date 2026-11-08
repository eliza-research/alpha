import {reviewContentQuestion} from '../browser/content-question';
import {sensitiveReadingText} from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/page-reading.ts';
import {noticeReviewable} from '../prototype/context-selection';
import {alphaClient} from './alpha-client';
import {digestSummaryText} from './hosted-digests';
import type {resolveHostedResultTap} from './hosted-result-notices';
type Result=Awaited<ReturnType<typeof resolveHostedResultTap>>;
/** The opaque Android action resolves only a retained result from the same owner and agent.
 * A result that cannot be reviewed here is handed back through `unreviewable` so the caller opens it like an ordinary tap. */
export function reviewHostedNoticeQuestion(options:{signal?:AbortSignal;result:Extract<Result,{kind:'ready'}>;current:()=>boolean;recheck:()=>Promise<Result>;canCompose:()=>boolean;consume:()=>Promise<void>;discard:()=>Promise<void>;compose:(draft:string)=>void;report:(message:string)=>void;unreviewable:()=>void;closed:()=>void}):(()=>void)|undefined {
 const {result}=options,text=digestSummaryText(result.result),snapshot=JSON.stringify(result.result);
 const current=()=>options.current()&&!alphaClient.getState().context.sensitive;
 if(text==='No readable summary was returned. Open execution details to inspect this result.'||!result.question||!current()||!noticeReviewable({source:'own',id:result.result.runId,revision:result.token,title:'Scheduled result',text})||sensitiveReadingText(text)){
  options.unreviewable();return;
 }
 let composing=false,interrupted=false,ended=false;
 const done=()=>{if(ended)return;ended=true;window.removeEventListener('blur',abort);window.removeEventListener('launcher-home',abort);options.closed();};
 let abort=()=>{};
 const close=reviewContentQuestion({signal:options.signal,name:'Scheduled result notification',text,question:'Help me understand this saved result.',current,validate:value=>!sensitiveReadingText(value),closed:dismissed=>queueMicrotask(()=>{
  if(!composing){if(dismissed&&!interrupted)void options.discard().catch(()=>{});interrupted=true;done();}
 }),compose:draft=>{
  composing=true;
  void(async()=>{try{
   if(interrupted||!current())throw Error();
   const fresh=await options.recheck();
   if(interrupted||!current()||fresh.kind!=='ready'||!fresh.question||fresh.token!==result.token||JSON.stringify(fresh.result)!==snapshot)throw Error();
   // Keep the notice and pending Ask unless the conversation can take the draft right now.
   if(!options.canCompose())throw Error();
   await options.consume();
   if(interrupted||!current())throw Error();
   options.compose(draft);
  }catch{options.report('The result or account changed. Nothing was added to your conversation.');}finally{done();}})();
 }});
 abort=()=>{interrupted=true;close();done();};
 window.addEventListener('blur',abort);window.addEventListener('launcher-home',abort);
 return abort;
}

/** Reserve before asynchronous native resolution so overlapping resume/poll events cannot open two reviews. */
export function hostedTapResolver() {
 let resolving=false;
 return async (resolve:()=>Promise<void>)=>{
  if(resolving)return;
  resolving=true;
  try{await resolve();}finally{resolving=false;}
 };
}
