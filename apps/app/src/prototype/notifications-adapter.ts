import {alphaClient} from '../runtime/alpha-client';
import {connectionController} from '../runtime/connection-ui';
import { registerPlugin } from '../platform-plugins';
import { Capacitor } from '@capacitor/core';
import { reviewContentQuestion } from '../browser/content-question';
import { sensitiveReadingText } from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/page-reading.ts';
import { noticeCurrent, noticeExcerpt, noticeReviewable } from './context-selection';
const opaque=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** Agent-context identity for one of Alpha Phone's own notifications. Other apps' and
 * hosted rows are never selectable; titles and text stay on the phone. */
export function ownNotificationSelection(notice:{id:string;revision:string;source:string}){
 return notice.source==='own'&&opaque.test(notice.id)&&opaque.test(notice.revision)?{kind:'notification',id:notice.id,revision:notice.revision,accountId:'own'}:undefined;
}
type Notice = { id: string; revision:string; source:'own'|'external'|'hosted'; kind?:string; appLabel:string; title: string; text: string; at: number; clearable: boolean; canOpen: boolean };
const native = registerPlugin<{canonicalPending():Promise<{token?:string;ownerId?:string;agentId?:string;notificationId?:string;view?:string;conversationId?:string;messageId?:string}>;acknowledgeCanonical(options:{token:string}):Promise<{ok:boolean}>;addListener(name:'canonicalNotificationTap',listener:()=>void):Promise<{remove():Promise<void>}>;list(): Promise<{items: Notice[]; scope: string; calendarStatus?:string}>;open(options:{id:string;revision:string;source:string}):Promise<void>;dismiss(options:{id:string;revision:string;source:string}):Promise<void>;clear(options:{items:Array<{id:string;revision:string;source:string}>}):Promise<{outcomes:Array<{status:string}>}>}>('AlphaNotifications');
/** Active rows only. Android access and per-app opt-in are enforced natively. */
export function installNotificationsAdapter(Component: any) {
 const p=Component.prototype, render=p.renderVals, mount=p.componentDidMount, unmount=p.componentWillUnmount;
 p.componentDidMount=function(){mount?.call(this);this.alphaNotices=[];this.alphaNoticesLive=true;this.alphaNoticeEpoch=0;
  this.alphaNoticeVisibility=()=>{this.alphaNoticeEpoch++;if(document.hidden){this.alphaNotices=[];this.alphaNoticeSelection=undefined;}else{this.setState({nativeNoticeRevision:Date.now()});if(this.S().shade)void this.refreshAlphaNotices();}};
  document.addEventListener('visibilitychange',this.alphaNoticeVisibility);
  this.alphaCanonicalTap=async()=>{
   if(!Capacitor.isNativePlatform()||!this.alphaNoticesLive||document.hidden||this.alphaCanonicalOpening||this.S().typing||this.S().recording||String(this.S().draft||'').trim())return;
   const current=connectionController.getSnapshot(),session=current.session;if(!session||current.busy||current.open)return;
   const origin={view:this.S().view,revision:alphaClient.getState().context.revision,conversation:connectionController.getSelectedConversationId(),history:current.history};
   this.alphaCanonicalOpening=true;this.alphaCanonicalDrainRequested=false;
   try{
    const tap=await native.canonicalPending();
    if(!tap.token||tap.ownerId!==session.ownerId||tap.agentId!==session.agentId||document.hidden||String(this.S().draft||'').trim()||connectionController.getSnapshot().session!==session)return;
    const canCommit=()=>this.alphaNoticesLive&&!document.hidden&&!this.S().typing&&!this.S().recording&&!String(this.S().draft||'').trim()&&connectionController.getSnapshot().session===session&&!connectionController.getSnapshot().open;
    const originCurrent=()=>canCommit()&&this.S().view===origin.view&&alphaClient.getState().context.revision===origin.revision&&connectionController.getSelectedConversationId()===origin.conversation&&connectionController.getSnapshot().history===origin.history;
    if(!originCurrent())return;
    if(tap.view==='chat'){
     if(!tap.conversationId||!tap.messageId)return;
     await connectionController.restoreHistory(tap.conversationId,originCurrent);
     const after=connectionController.getSnapshot();
     if(after.session!==session||after.history?.conversationId!==tap.conversationId||!after.history.messages.some(row=>row.id===tap.messageId)||document.hidden)return;
    }
    if(!canCommit())return;
    const restored=connectionController.getSnapshot().history;
    const exactChat=()=>!!restored&&this.S().view===origin.view&&alphaClient.getState().context.revision===origin.revision&&connectionController.getSelectedConversationId()===tap.conversationId&&connectionController.getSnapshot().history===restored&&restored.conversationId===tap.conversationId&&restored.messages.some(row=>row.id===tap.messageId);
    if(tap.view==='chat'&&!exactChat())return;
    const views:Record<string,string>={calendar:'calendar',notes:'notes',automations:'workflows'};
    const targetView=tap.view!=='chat'&&tap.view?views[tap.view]:undefined;
    if(tap.view!=='chat'){if(!targetView)return;this.openView(targetView);}
    this.setState(tap.view==='chat'?{chat:'full'}:{},()=>{
     if(canCommit()&&(tap.view==='chat'?exactChat():!!targetView&&this.S().view===targetView))void native.acknowledgeCanonical({token:tap.token!}).catch(()=>{});
    });
   }catch{/* Native custody retains or retires the tap; never replay a read acknowledgement. */}
   finally{this.alphaCanonicalOpening=false;if(this.alphaCanonicalDrainRequested&&this.alphaNoticesLive)queueMicrotask(this.alphaCanonicalTap);}
  };
  this.alphaCanonicalWake=()=>{this.alphaCanonicalDrainRequested=true;void this.alphaCanonicalTap();};
  if(Capacitor.isNativePlatform()){
   this.alphaCanonicalListener=native.addListener('canonicalNotificationTap',this.alphaCanonicalWake);
   this.alphaCanonicalUnsubscribe=connectionController.subscribe(()=>{if(!this.alphaCanonicalOpening)void this.alphaCanonicalTap();});
   window.addEventListener('focus',this.alphaCanonicalWake);
   void this.alphaCanonicalTap();
  }

  this.alphaNoticeDeviceState=()=>{this.alphaNoticeEpoch++;this.alphaNoticeQuestion?.();this.alphaNotices=[];this.alphaNoticeSelection=undefined;this.setState({nativeNoticeRevision:Date.now()});};
  if(!Capacitor.isNativePlatform())window.addEventListener('alpha:device-state',this.alphaNoticeDeviceState);
  this.alphaNoticeTimer=window.setInterval(()=>{if(this.alphaNoticesLive&&this.S().shade&&!document.hidden){this.publishAlphaNoticeSelection();void this.refreshAlphaNotices();}},1000);
 };
 p.componentWillUnmount=function(){this.alphaNoticesLive=false;this.alphaCanonicalUnsubscribe?.();if(this.alphaCanonicalListener)void this.alphaCanonicalListener.then((listener:{remove():Promise<void>})=>listener.remove());window.removeEventListener('focus',this.alphaCanonicalWake);this.alphaNoticeQuestion?.();this.alphaNoticeSelection=undefined;this.alphaNoticeEpoch++;document.removeEventListener('visibilitychange',this.alphaNoticeVisibility);window.removeEventListener('alpha:device-state',this.alphaNoticeDeviceState);clearInterval(this.alphaNoticeTimer);unmount?.call(this);};
 p.refreshAlphaNotices=async function(){
  if(this.alphaNoticesBusy||!this.alphaNoticesLive||document.hidden)return;this.alphaNoticesBusy=true;const epoch=this.alphaNoticeEpoch;
  try{const result=await native.list();if(!this.alphaNoticesLive||document.hidden||epoch!==this.alphaNoticeEpoch)return;if(result.calendarStatus==='unavailable'){if(!this.alphaCalendarAlertError)this.toast('Calendar alerts could not load. Open Calendar to review the problem.');this.alphaCalendarAlertError=true;}else this.alphaCalendarAlertError=false;const next=result.items;const chosen=this.alphaNoticeSelection;if(chosen&&!next.some((n:Notice)=>n.id===chosen.id&&n.revision===chosen.revision&&n.source==='own'))this.alphaNoticeSelection=undefined;if(JSON.stringify(next)!==JSON.stringify(this.alphaNotices)){this.alphaNotices=next;this.setState({nativeNoticeRevision:Date.now()});}this.alphaNoticeError=false;}
  catch{if(this.alphaNoticesLive&&!document.hidden&&epoch===this.alphaNoticeEpoch&&!this.alphaNoticeError){this.alphaNoticeError=true;this.alphaNotices=[];this.alphaNoticeSelection=undefined;this.setState({nativeNoticeRevision:Date.now()});this.toast('Alpha Phone notifications are unavailable.');}}
  finally{this.alphaNoticesBusy=false;}
 };
 /** A press records the selection without rendering, so a swipe or tap in progress is never
  * interrupted. This renders once afterwards so the agent context carries the pressed
  * notification (or drops a replaced one) instead of waiting for an unrelated render. */
 p.publishAlphaNoticeSelection=function(){if(!this.alphaNoticesLive||JSON.stringify(this.alphaNoticeSelection??null)===this.alphaNoticeSelectionRendered)return;this.setState({nativeNoticeRevision:Date.now()});};
 /** The own notification the owner last pressed while the shade is open, for agent context. */
 p.notificationSelection=function(){if(!this.S().shade||document.hidden){this.alphaNoticeSelection=undefined;return undefined;}const chosen=this.alphaNoticeSelection;return chosen?{...chosen}:undefined;};
 p.renderVals=function(){
  const out=render.call(this),self=this;
  // A press from an earlier shade session never becomes context for a later one.
  if(!this.S().shade)this.alphaNoticeSelection=undefined;
  // A notification review never outlives the shade it was opened from (Home, lock, another view).
  const reviewEnded=()=>{const now=self.S();return !now.shade||now.screen==='lock'||now.screen==='off';};
  if(this.alphaNoticeQuestion&&reviewEnded())queueMicrotask(()=>{if(reviewEnded())self.alphaNoticeQuestion?.();});
  this.alphaNoticeSelectionRendered=JSON.stringify(this.alphaNoticeSelection??null);
  const action=async(task:()=>Promise<void>)=>{try{await task();await self.refreshAlphaNotices();}catch{if(self.alphaNoticesLive&&!document.hidden){self.toast('The notification changed or could not be updated.');await self.refreshAlphaNotices();}}};
  const shadeN=(this.alphaNotices||[]).map((n:Notice)=>{
   const swipe=this.sw(()=>{if(n.clearable)void action(()=>native.dismiss({id:n.id,revision:n.revision,source:n.source}));else this.toast('This is an ongoing notification.');},{axis:'x'});
   const select=()=>{this.alphaNoticeSelection=ownNotificationSelection(n);};
   /** Review scope: this one Alpha Phone notification's shown title and text, editable before
    * anything reaches the conversation draft. Other apps' and hosted rows offer no question.
    * The list is read again when the owner continues, so a dismissed, replaced or updated
    * notification (or one hidden by a lock) adds nothing and never becomes its neighbor. */
   const ask=()=>{
    if(this.swallowed()||!noticeReviewable(n))return;
    self.alphaNoticeQuestion?.();select();self.publishAlphaNoticeSelection();
    const reviewed={id:n.id,revision:n.revision,source:n.source},excerpt=noticeExcerpt(n);
    const live=()=>self.alphaNoticesLive&&!document.hidden&&!!self.S().shade&&noticeCurrent(reviewed,self.alphaNotices);
    const refused=()=>{self.toast('This notification changed or is no longer shown. Nothing was added to your conversation.');void self.refreshAlphaNotices();};
    self.alphaNoticeQuestion=reviewContentQuestion({name:(n.appLabel||'Alpha Phone')+' notification',text:excerpt,question:'Help me with this notification.',current:live,validate:text=>!sensitiveReadingText(text),closed:()=>{self.alphaNoticeQuestion=undefined;},compose:draft=>{void (async()=>{
     if(!live()){refused();return;}
     const epoch=self.alphaNoticeEpoch;
     try{
      const fresh=(await native.list()).items,same=fresh.find((row:Notice)=>row.id===reviewed.id&&row.source===reviewed.source);
      if(epoch!==self.alphaNoticeEpoch||!live()||!noticeCurrent(reviewed,fresh)||!same||noticeExcerpt(same)!==excerpt){refused();return;}
      self.api(self.S().view).composeContentQuestion(draft);
     }catch{if(self.alphaNoticesLive)self.toast('This notification could not be checked. Nothing was added to your conversation.');}
    })();}});
   };
   return {canAsk:noticeReviewable(n),ask,askLabel:'Ask Alpha about this '+(n.appLabel||'Alpha Phone')+' notification',id:n.id,d:out.ic.bell,who:n.source==='external'?n.appLabel:n.title||'Alpha Phone',text:n.source==='external'&&n.title!==n.appLabel?[n.title,n.text].filter(Boolean).join(' · '):n.text,time:new Date(n.at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}),tx:0,op:1,down:(event:unknown)=>{select();return swipe.down(event);},up:(event:unknown)=>{window.setTimeout(()=>self.publishAlphaNoticeSelection(),0);return swipe.up(event);},open:()=>{if(this.swallowed())return;if(!n.canOpen){this.toast('This notification has no available action.');return;}void action(()=>native.open({id:n.id,revision:n.revision,source:n.source}));}};
  });
  return {...out,shadeN,clearAll:()=>{const items=(this.alphaNotices||[]).filter((n:Notice)=>n.clearable).map((n:Notice)=>({id:n.id,revision:n.revision,source:n.source}));void action(async()=>{const result=await native.clear({items});if(result.outcomes.some(row=>row.status==='unavailable'))self.toast('Some notifications changed. Review the refreshed list.');});}};
 };
}
