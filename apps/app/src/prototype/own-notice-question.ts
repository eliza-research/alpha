import {reviewContentQuestion} from '../browser/content-question';
import {sensitiveReadingText} from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/page-reading.ts';
import {noticeExcerpt,noticeReviewable,type Notice} from './context-selection';
/** The publisher supplies an exact current own-notice excerpt, never an arbitrary deep-link payload. */
export function reviewOwnNoticeQuestion(options:{notice:Notice;current:()=>boolean;recheck:()=>Promise<boolean>;consume:()=>Promise<void>;release:()=>Promise<void>;compose:(draft:string)=>void;report:(message:string)=>void;closed:()=>void}):(()=>void)|undefined{
 if(!options.current()||!noticeReviewable(options.notice)){options.report('Unavailable');return;}
 let canceled=false,composing=false,ended=false;
 const done=()=>{if(ended)return;ended=true;window.removeEventListener('launcher-home',abort);window.removeEventListener('blur',abort);options.closed();};
 let abort=()=>{};
 const close=reviewContentQuestion({name:'Alpha Phone notification',text:noticeExcerpt(options.notice),question:'Help me with this notification.',current:options.current,validate:text=>!sensitiveReadingText(text),closed:dismissed=>{queueMicrotask(()=>{if(composing)return;canceled=true;if(dismissed)void options.release().catch(()=>options.report('Couldn’t keep'));done();});},compose:draft=>{
  composing=true;void(async()=>{let consumed=false;try{
   if(canceled||!options.current()||!await options.recheck()||canceled||!options.current())throw Error();
   // The tap is spent once consume resolves, so a later Home or blur still drafts the question.
   await options.consume();consumed=true;if(!options.current())throw Error();options.compose(draft);
  }catch{options.report(consumed?'Couldn’t keep':'This notification changed.');}finally{done();}})();
 }});
 abort=()=>{canceled=true;close();done();};window.addEventListener('launcher-home',abort);window.addEventListener('blur',abort);return abort;
}
