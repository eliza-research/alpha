import {alphaClient} from '../runtime/alpha-client';
import {connectionController} from '../runtime/connection-ui';
import { registerPlugin } from '../platform-plugins';
import { Capacitor } from '@capacitor/core';
import { reviewContentQuestion } from '../browser/content-question';
import { sensitiveReadingText } from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/page-reading.ts';
import { noticeCurrent, noticeExcerpt, noticeReviewable } from './context-selection';
import { isMvpView } from './mvp-features';
import { formatTime } from './locale-time';
const opaque=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** Agent-context identity for one of Alpha Phone's own notifications. Other apps' and
 * hosted rows are never selectable; titles and text stay on the phone. */
export function ownNotificationSelection(notice:{id:string;revision:string;source:string}){
 return notice.source==='own'&&opaque.test(notice.id)&&opaque.test(notice.revision)?{kind:'notification',id:notice.id,revision:notice.revision,accountId:'own'}:undefined;
}
type Notice = { id: string; revision:string; source:'own'|'external'|'hosted'; kind?:string; appLabel:string; title: string; text: string; at: number; clearable: boolean; canOpen: boolean };
const native = registerPlugin<{canonicalPending():Promise<{token?:string;ownerId?:string;agentId?:string;notificationId?:string;view?:string;conversationId?:string;messageId?:string}>;acknowledgeCanonical(options:{token:string}):Promise<{ok:boolean}>;addListener(name:'canonicalNotificationTap',listener:()=>void):Promise<{remove():Promise<void>}>;list(): Promise<{items: Notice[]; scope: string; calendarStatus?:string}>;open(options:{id:string;revision:string;source:string}):Promise<void>;dismiss(options:{id:string;revision:string;source:string}):Promise<void>;clear(options:{items:Array<{id:string;revision:string;source:string}>}):Promise<{outcomes:Array<{status:string}>}>}>('AlphaNotifications');
/** Opens the view a tapped canonical Alpha notification names. Android posts these from the
 * system shade, so this runs on every Android build, independent of the simulated shade. */
export function installCanonicalNotificationTaps(Component: any) {
 const p=Component.prototype, mount=p.componentDidMount, unmount=p.componentWillUnmount;
 p.componentDidMount=function(){
  mount?.call(this);
  const owner={live:true,opening:false,drainRequested:false,releaseCommit:undefined as (()=>void)|undefined};
  const tapCurrent=async()=>{
   if(!Capacitor.isNativePlatform()||!owner.live||document.hidden||owner.opening||this.S().typing||this.S().recording||String(this.S().draft||'').trim())return;
   const current=connectionController.getSnapshot(),session=current.session;if(!session||current.busy||current.open)return;
   const origin={view:this.S().view,revision:alphaClient.getState().context.revision,conversation:connectionController.getSelectedConversationId(),history:current.history};
   owner.opening=true;owner.drainRequested=false;
   try{
    const tap=await native.canonicalPending(),token=tap.token;
    if(!token||tap.ownerId!==session.ownerId||tap.agentId!==session.agentId)return;
    const canCommit=()=>{
     const snapshot=connectionController.getSnapshot();
     return owner.live&&!document.hidden&&!this.S().typing&&!this.S().recording&&!String(this.S().draft||'').trim()&&snapshot.session===session&&!snapshot.open;
    };
    const canNavigate=()=>canCommit()&&!connectionController.getSnapshot().busy;
    const originCurrent=()=>canCommit()&&this.S().view===origin.view&&alphaClient.getState().context.revision===origin.revision&&connectionController.getSelectedConversationId()===origin.conversation&&connectionController.getSnapshot().history===origin.history;
    if(!canNavigate()||!originCurrent())return;
    // Exact history restoration temporarily owns the connection's busy state.
    // The origin guard stays usable inside that read, and navigation checks busy again after it.
    const exact=tap.view==='chat'&&!!tap.conversationId&&!!tap.messageId;
    if(exact){
     await connectionController.restoreHistory(tap.conversationId!,originCurrent);
     const after=connectionController.getSnapshot();
     if(after.session!==session||after.history?.conversationId!==tap.conversationId||!after.history?.messages.some(row=>row.id===tap.messageId)||document.hidden)return;
    }
    if(!canNavigate())return;
    const restored=connectionController.getSnapshot().history;
    const exactChat=()=>!!restored&&this.S().view===origin.view&&alphaClient.getState().context.revision===origin.revision&&connectionController.getSelectedConversationId()===tap.conversationId&&connectionController.getSnapshot().history===restored&&restored.conversationId===tap.conversationId&&restored.messages.some(row=>row.id===tap.messageId);
    if(exact&&!exactChat())return;
    // Clock and device reminders live in Calendar.
    const views:Record<string,string>={calendar:'calendar',notes:'notes',automations:'workflows',clock:'calendar',reminders:'calendar','apps/tasks':'calendar'};
    const mapped=tap.view&&tap.view!=='chat'?views[tap.view]:undefined;
    const targetView=mapped&&isMvpView(mapped)?mapped:undefined;
    if(targetView)this.openView(targetView);
    await new Promise<void>(resolve=>{
     owner.releaseCommit=resolve;
     this.setState(targetView?{}:{chat:'full'},()=>{
      try{
       if(canNavigate()&&(exact?exactChat():targetView?this.S().view===targetView:this.S().chat==='full'))void native.acknowledgeCanonical({token}).catch(()=>{});
      }catch{/* Native read status is unconfirmed. */}
      finally{resolve();}
     });
    });
   }catch{/* Native custody retains or retires the tap; never replay a read acknowledgement. */}
   finally{
    owner.opening=false;owner.releaseCommit=undefined;
    if(owner.drainRequested&&owner.live)queueMicrotask(tapCurrent);
   }
  };
  const wake=()=>{if(!owner.live)return;owner.drainRequested=true;void tapCurrent();};
  this.alphaCanonicalTap=tapCurrent;this.alphaCanonicalWake=wake;
  this.alphaCanonicalStop=()=>{owner.live=false;owner.releaseCommit?.();};
  if(Capacitor.isNativePlatform()){
   const listener=native.addListener('canonicalNotificationTap',wake).catch(()=>undefined);
   const unsubscribe=connectionController.subscribe(()=>{if(!owner.opening)void tapCurrent();});
   window.addEventListener('focus',wake);
   this.alphaCanonicalStop=()=>{
    if(!owner.live)return;
    owner.live=false;owner.releaseCommit?.();
    unsubscribe();window.removeEventListener('focus',wake);
    void listener.then(handle=>handle?.remove()).catch(()=>{});
   };
   void tapCurrent();
  }
 };
 p.componentWillUnmount=function(){this.alphaCanonicalStop?.();unmount?.call(this);};
}
/** Active rows only. Android access and per-app opt-in are enforced natively. */
export function installNotificationsAdapter(Component: any) {
 const p=Component.prototype, render=p.renderVals, mount=p.componentDidMount, update=p.componentDidUpdate, unmount=p.componentWillUnmount;
 const shadeActive=(shell:any)=>{const state=shell.S();return !!state.shade&&state.screen==='home';};
 const active=(shell:any)=>shell.alphaNoticesLive&&!document.hidden&&shadeActive(shell);
 const key=(row:Notice)=>({id:row.id,revision:row.revision,source:row.source});
 const clearableKeys=(rows:Notice[])=>rows.filter(row=>row.clearable).map(key);
 const retireQuestion=(shell:any)=>{
  const close=shell.alphaNoticeQuestion;
  shell.alphaNoticeQuestion=undefined;
  shell.alphaNoticeQuestionLease=undefined;
  close?.();
 };
 const retireVisit=(shell:any)=>{
  shell.alphaNoticeVisit={};
  shell.alphaNoticeSelection=undefined;
  retireQuestion(shell);
 };
 p.componentDidMount=function(){mount?.call(this);this.alphaNotices=[];this.alphaNoticesLive=true;this.alphaNoticeEpoch=0;
  this.alphaNoticeVisit={};
  this.alphaNoticeShadeActive=shadeActive(this);
  this.alphaNoticeVisibility=()=>{
   this.alphaNoticeEpoch++;
   retireVisit(this);
   if(document.hidden)this.alphaNotices=[];
   else{this.setState({nativeNoticeRevision:Date.now()});void this.refreshAlphaNotices();}
  };
  document.addEventListener('visibilitychange',this.alphaNoticeVisibility);
  this.alphaNoticeDeviceState=()=>{this.alphaNoticeEpoch++;retireVisit(this);this.alphaNotices=[];this.setState({nativeNoticeRevision:Date.now()});};
  if(!Capacitor.isNativePlatform())window.addEventListener('alpha:device-state',this.alphaNoticeDeviceState);
  this.alphaNoticeTimer=window.setInterval(()=>{if(active(this)){this.publishAlphaNoticeSelection();void this.refreshAlphaNotices();}},1000);
 };
 p.componentDidUpdate=function(...args:any[]){
  update?.apply(this,args);
  const showing=shadeActive(this);
  if(this.alphaNoticeShadeActive&&!showing)retireVisit(this);
  this.alphaNoticeShadeActive=showing;
 };
 p.componentWillUnmount=function(){this.alphaNoticesLive=false;retireVisit(this);this.alphaNoticeEpoch++;document.removeEventListener('visibilitychange',this.alphaNoticeVisibility);window.removeEventListener('alpha:device-state',this.alphaNoticeDeviceState);clearInterval(this.alphaNoticeTimer);unmount?.call(this);};
 p.refreshAlphaNotices=async function(){
  if(this.alphaNoticesBusy||!active(this))return;
  this.alphaNoticesBusy=true;
  const visit=this.alphaNoticeVisit;
  const current=()=>active(this)&&this.alphaNoticeVisit===visit;
  try{const result=await native.list();if(!current())return;if(result.calendarStatus==='unavailable'){if(!this.alphaCalendarAlertError)this.toast('Alerts didn’t load');this.alphaCalendarAlertError=true;}else this.alphaCalendarAlertError=false;const next=result.items;const chosen=this.alphaNoticeSelection;if(chosen&&!next.some((n:Notice)=>n.id===chosen.id&&n.revision===chosen.revision&&n.source==='own'))this.alphaNoticeSelection=undefined;if(JSON.stringify(next)!==JSON.stringify(this.alphaNotices)){this.alphaNotices=next;this.setState({nativeNoticeRevision:Date.now()});}this.alphaNoticeError=false;}
  catch{if(current()&&!this.alphaNoticeError){this.alphaNoticeError=true;this.alphaNotices=[];this.alphaNoticeSelection=undefined;this.setState({nativeNoticeRevision:Date.now()});this.toast('Unavailable');}}
  finally{this.alphaNoticesBusy=false;}
 };
 /** A press records the selection without rendering, so a swipe or tap in progress is never
  * interrupted. This renders once afterwards so the agent context carries the pressed
  * notification (or drops a replaced one) instead of waiting for an unrelated render. */
 p.publishAlphaNoticeSelection=function(){if(!active(this)||JSON.stringify(this.alphaNoticeSelection??null)===this.alphaNoticeSelectionRendered)return;this.setState({nativeNoticeRevision:Date.now()});};
 /** The own notification the owner last pressed while the shade is open, for agent context. */
 p.notificationSelection=function(){if(!active(this)){this.alphaNoticeSelection=undefined;return undefined;}const chosen=this.alphaNoticeSelection;return chosen?{...chosen}:undefined;};
 p.renderVals=function(){
  const out=render.call(this),self=this;
  // A press from an earlier shade session never becomes context for a later one.
  if(!shadeActive(this))this.alphaNoticeSelection=undefined;
  this.alphaNoticeSelectionRendered=JSON.stringify(this.alphaNoticeSelection??null);
  const visit=this.alphaNoticeVisit;
  const currentVisit=()=>active(self)&&self.alphaNoticeVisit===visit;
  const action=async(task:()=>Promise<void|boolean>)=>{
   try{
    const unavailable=await task();
    if(currentVisit()&&unavailable===true)self.toast('Updated');
   }catch{if(currentVisit())self.toast('Changed');}
   if(currentVisit())await self.refreshAlphaNotices();
  };
  const rows:Notice[]=this.alphaNotices||[];
  const items=clearableKeys(rows);
  const shadeN=rows.map((n:Notice)=>{
   const target=key(n);
   const current=()=>currentVisit()?self.alphaNotices.find((row:Notice)=>row.id===target.id&&row.revision===target.revision&&row.source===target.source):undefined;
   const swipe=this.sw(()=>{
    const row=current();
    if(!row)return;
    if(row.clearable)void action(()=>native.dismiss(target));
    else this.toast('Ongoing');
   },{axis:'x'});
   const select=()=>{this.alphaNoticeSelection=ownNotificationSelection(n);};
   /** Review scope: this one Alpha Phone notification's shown title and text, editable before
    * anything reaches the conversation draft. Other apps' and hosted rows offer no question.
    * The list is read again when the owner continues, so a dismissed, replaced or updated
    * notification (or one hidden by a lock) adds nothing and never becomes its neighbor. */
   const ask=()=>{
    if(this.swallowed()||!current()||!noticeReviewable(n))return;
    retireQuestion(self);select();self.publishAlphaNoticeSelection();
    const lease=self.alphaNoticeQuestionLease={};
    const reviewed={id:n.id,revision:n.revision,source:n.source},excerpt=noticeExcerpt(n);
    const owned=()=>self.alphaNoticeQuestionLease===lease;
    const live=()=>owned()&&self.alphaNoticesLive&&!document.hidden&&shadeActive(self)&&noticeCurrent(reviewed,self.alphaNotices);
    const refused=()=>{self.toast('Gone');void self.refreshAlphaNotices();};
    self.alphaNoticeQuestion=reviewContentQuestion({name:(n.appLabel||'Alpha Phone')+' notification',text:excerpt,question:'Help me with this notification.',current:live,validate:text=>!sensitiveReadingText(text),closed:dismissed=>{
     if(!owned())return;
     self.alphaNoticeQuestion=undefined;
     // The dialog closes before Continue starts the final list read.
     if(dismissed)retireQuestion(self);
    },compose:draft=>{void (async()=>{
     if(!owned())return;
     try{
      if(!live()){refused();return;}
      const epoch=self.alphaNoticeEpoch;
      const fresh=(await native.list()).items,same=fresh.find((row:Notice)=>row.id===reviewed.id&&row.source===reviewed.source);
      if(!owned())return;
      if(epoch!==self.alphaNoticeEpoch||!live()||!noticeCurrent(reviewed,fresh)||!same||noticeExcerpt(same)!==excerpt){refused();return;}
      self.api(self.S().view).composeContentQuestion(draft);
     }catch{if(owned()&&self.alphaNoticesLive)self.toast('Couldn’t check');}
     finally{if(owned())retireQuestion(self);}
    })();}});
   };
   return {canAsk:noticeReviewable(n),ask,askLabel:'Ask Alpha about this '+(n.appLabel||'Alpha Phone')+' notification',id:n.id,d:out.ic.bell,who:n.source==='external'?n.appLabel:n.title||'Alpha Phone',text:n.source==='external'&&n.title!==n.appLabel?[n.title,n.text].filter(Boolean).join(' · '):n.text,time:formatTime(new Date(n.at)),tx:0,op:1,down:(event:unknown)=>{if(!current())return;select();return swipe.down(event);},up:(event:unknown)=>{if(currentVisit())window.setTimeout(()=>{if(currentVisit())self.publishAlphaNoticeSelection();},0);return swipe.up(event);},open:()=>{
    const row=current();
    if(this.swallowed()||!row)return;
    if(!row.canOpen){this.toast('No action');return;}
    void action(()=>native.open(target));
   }};
  });
  return {...out,shadeN,clearAll:()=>{
   if(!currentVisit()||!items.length||JSON.stringify(items)!==JSON.stringify(clearableKeys(self.alphaNotices)))return;
   void action(async()=>{const result=await native.clear({items});return result.outcomes.some(row=>row.status==='unavailable');});
  }};
 };
}
