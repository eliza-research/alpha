import {createInlineModal} from '../runtime/inline-modal';
import {currentClockTimeZone,buildClockRequest,describeClockDays,type ClockDay} from '../runtime/clock-contract';
import { DailyApps, type ClockRequest, type ClockResult } from '../daily';
import { testMocksEnabled } from '../build-flags';
type Bag=Record<string,any>;
import {createClockHandoffHistory,clockHandoffLegacyKey,type ClockHandoffSnapshot} from '../runtime/clock-handoff-history';
import {secureConnectionStore} from '../runtime/native-connection';
const actions=['set','show','snooze','dismiss'] as const;
/** A reviewed handoff, never a local alarm database or a provider-success claim. */
export function installClockAdapter(Component:any,views:Bag,options:{simulated:boolean;browser?:boolean}) {
 const p=Component.prototype,render=views.calendar.render,leave=views.calendar.onLeave;
 const draftId=crypto.randomUUID();let draftRevision=0;
 const selection=()=>open?{kind:'clock-draft',id:draftId,revision:String(draftRevision)}:undefined;
 let owner:any,open=false,action:ClockRequest['action']='set',time='07:00',label='',snooze='10',days:ClockDay[]=[],review:ClockRequest|null=null,busy=false,message='',generation=0;
 // Repeat days reach Clock only when the native handoff reports it carries EXTRA_DAYS
 // (surfaceInfo clockRepeatDaysVersion 1 or later). Otherwise the chips are hidden and a repeat is refused,
 // so a reviewed repeat is never sent as, or silently reduced to, a one-time alarm.
 let repeatSupported=false;
 // Mock simulation exists only in test-mocks builds. A flag-off build that is
 // somehow asked to simulate fails closed instead of opening the real Clock.
 const mockRequested=()=>options.simulated||document.documentElement.dataset.connectionMode==='mock';
 const simulated=()=>testMocksEnabled&&mockRequested();
 const repeatAvailable=()=>simulated()||repeatSupported;
 const blocked=()=>!testMocksEnabled&&mockRequested();
 const publish=()=>{++draftRevision;owner?.vset('calendar',{});};
 const history=createClockHandoffHistory(secureConnectionStore,()=>localStorage.getItem(clockHandoffLegacyKey));
 let snapshot:ClockHandoffSnapshot|null=null,loading=false,historyGeneration=0;
 const restore=async()=>{
  if(simulated()||options.browser)return;
  if(!repeatSupported)void Promise.resolve().then(()=>DailyApps.surfaceInfo()).then(info=>{const version=info.clockRepeatDaysVersion;if(typeof version==='number'&&Number.isInteger(version)&&version>=1&&!repeatSupported){repeatSupported=true;publish();}}).catch(()=>{/* Unknown support keeps repeats off. */});
  const token=++historyGeneration,view=generation;snapshot=null;loading=true;publish();
  try {
   const saved=await history.read();if(token!==historyGeneration||view!==generation)return;
   snapshot=saved;const last=saved.record;
   message=last?(last.status==='opening'||last.status==='unknown'?'Previous Clock result is unknown. Check Clock before repeating a request.':'Previous request was a handoff. Check Clock for its result.'):'';
  }catch {if(token===historyGeneration&&view===generation)message='Clock handoff history could not be read. Check Clock before repeating a request.';}
  finally{if(token===historyGeneration){loading=false;if(view===generation)publish();}}
 };
 const close=()=>{if(!busy){open=false;review=null;publish();}};
 const back=(event:Event)=>{if(!open)return;event.preventDefault();event.stopImmediatePropagation();close();};
 const modal=createInlineModal(close,()=>document.querySelector<HTMLElement>('button[aria-label="Clock alarms"]'));
 views.calendar.onLeave=(...args:any[])=>{open=false;review=null;++generation;return leave?.(...args);};
 const retireReview=()=>{review=null;++generation;};
 const hidden=()=>{if(document.hidden)retireReview();else if(open&&!busy)void restore();};
 const mount=p.componentDidMount,unmount=p.componentWillUnmount;
 p.componentDidMount=function(){mount.call(this);owner=this;this.clockSelection=selection;void restore();window.addEventListener('alpha-back',back,true);window.addEventListener('pagehide',retireReview);document.addEventListener('visibilitychange',hidden);};
 p.componentWillUnmount=function(){if(owner===this){window.removeEventListener('alpha-back',back,true);window.removeEventListener('pagehide',retireReview);document.removeEventListener('visibilitychange',hidden);delete this.clockSelection;owner=null;open=false;review=null;++generation;}unmount.call(this);};
 const change=(fn:()=>void)=>{if(busy)return;fn();review=null;publish();};
 const build=():ClockRequest=>{
  if(action==='set'&&days.length&&!repeatAvailable())throw Error('Repeating alarms are not available in this version. Clear the repeat days, or set the repeat in Clock.');
  return buildClockRequest({action,time,label,snooze,days},action==='set'?currentClockTimeZone():'');
 };
 const dayNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
 const description=(request:ClockRequest)=>request.action==='set'?`Ask Clock to set ${request.days?`a repeating alarm (${describeClockDays(request.days)})`:'an alarm'} at ${String(request.hour).padStart(2,'0')}:${String(request.minute).padStart(2,'0')}${request.label?` named “${request.label}”`:''}, using the phone’s local time. Review the alarm in Clock.`:request.action==='show'?'Open the installed Clock app’s alarms page.':request.action==='snooze'?`Ask Clock to snooze ringing alarms, requesting ${request.snoozeMinutes} minutes. Clock may use its default duration and snooze all ringing alarms. If nothing is ringing, Clock may do nothing.`:'Ask Clock to dismiss the active alarm. If there is more than one, Clock may ask you to choose. A one-time alarm is disabled; a repeated alarm skips its upcoming occurrence.';
 const dispatch=async(request:ClockRequest)=>{
  if(busy||review!==request)return;
  if(document.hidden){message='Return to Alpha Phone and review again.';review=null;publish();return;}
  if(testMocksEnabled&&simulated()){message='Mock mode: Clock request simulated. No alarm was changed and no app was opened.';review=null;publish();return;}
  if(blocked()){message='Clock is unavailable without a live connection. No alarm was changed and no app was opened.';review=null;publish();return;}
  if(request.action==='set'&&request.timeZone!==currentClockTimeZone()){message='Phone time zone changed. Review the Clock request again.';review=null;publish();return;}
  if(!snapshot||loading){message='Clock request was not sent because its handoff history is unavailable. Close and reopen Clock to retry.';publish();return;}
  const id=crypto.randomUUID(),token=generation,expected=snapshot;
  busy=true;review=null;message='Saving Clock request…';publish();
  let retained:ClockHandoffSnapshot;
  try {retained=await history.save(expected,{id,action:request.action,status:'opening',at:new Date().toISOString()});}
  catch {busy=false;snapshot=null;if(token===generation){message='Clock request was not sent because its handoff record could not be saved. Close and reopen Clock to retry.';publish();}return;}
  // Admission is asynchronous. A retired review must never dispatch after it completes.
  let cancelled=token!==generation||document.hidden||simulated();
  try{if(request.action==='set'&&request.timeZone!==currentClockTimeZone())cancelled=true;}catch{cancelled=true;}
  let result:ClockResult;
  if(cancelled)result={action:request.action,status:'failed',message:'Clock request was not sent. Return to Alpha Phone and review again.'};
  else{
   message='Opening Clock…';publish();
   try {result=await DailyApps.clockHandoff(request);if(result.action!==request.action||!['opened','unavailable','denied','failed','unknown'].includes(result.status))throw Error();}
   catch {result={action:request.action,status:'unknown',message:'Clock result is unknown. Check Clock before repeating the request.'};}
  }
  // Only this exact admitted record can be completed; never replay a handoff.
  try {snapshot=await history.save(retained,{id,action:request.action,status:result.status,at:new Date().toISOString()});}
  catch {snapshot=null;result={...result,message:cancelled?'Clock request was not sent, but its cancelled record could not be saved. Check Clock before trying again.':'Clock may have opened, but its handoff record could not be saved. Check Clock before trying again.'};}
  busy=false;
  if(token===generation){message=result.message;publish();}
  else if(open&&!document.hidden)void restore();
 };
 views.calendar.render=(state:Bag,api:Bag)=>{
  const out=render(state,api);
  out.openClock=()=>{if(busy)return;if(options.browser&&!simulated()&&!blocked()){void DailyApps.clockHandoff({action:'show',reviewed:true}).catch(()=>api.toast('Clock could not be opened. Try again.'));return;}open=true;review=null;void restore();publish();};
  const currentReview=review;
  out.clock=open?{
   modalRef:modal.ref,title:'Clock',topPadding:simulated()?'76px':'var(--native-top-inset,0px)',message,busy:busy||loading,isSet:action==='set',isSnooze:action==='snooze',time,label,snooze,
   zone:Intl.DateTimeFormat().resolvedOptions().timeZone,
   close,
   actions:actions.map(kind=>({label:kind==='set'?'Set alarm':kind==='show'?'Show alarms':kind==='snooze'?'Snooze':'Dismiss',pick:()=>change(()=>{action=kind;}),css:action===kind?'background:var(--fg);color:var(--bg)':'background:var(--s2);color:var(--fg)'})),
   // Repeat-day chips (Sunday=1 … Saturday=7), Monday first; none selected is a one-time alarm.
   // null, not [], when repeats are unavailable: the template renders the Repeat group for any array.
   repeatAvailable:repeatAvailable(),
   days:!repeatAvailable()&&!days.length?null:[2,3,4,5,6,7,1].map(day=>({label:dayNames[day-1],on:days.includes(day as ClockDay),aria:`Repeat on ${dayNames[day-1]}`,toggle:()=>change(()=>{days=days.includes(day as ClockDay)?days.filter(d=>d!==day):[...days,day as ClockDay].sort((a,b)=>a-b);})})),
   repeatText:days.length?`Repeats ${describeClockDays(days)}`:'One time',
   onTime:(e:Bag)=>change(()=>{time=e.target.value;}),onLabel:(e:Bag)=>change(()=>{label=e.target.value;}),onSnooze:(e:Bag)=>change(()=>{snooze=e.target.value;}),
   prepare:()=>{if(busy||loading)return;try{review=build();message='';}catch(error){message=(error as Error).message;}publish();},
   review:currentReview?{text:description(currentReview),confirm:()=>dispatch(currentReview),cancel:()=>change(()=>{}),label:testMocksEnabled&&simulated()?'Simulate Clock request':'Continue to Clock'}:null,
  }:null;
  return out;
 };
}
