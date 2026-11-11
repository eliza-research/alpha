import {workflowClockSchedule,workflowClockExpression,workflowClockContext,workflowSnoozeTime} from '../runtime/workflow-local-time';
import {CRON_PRESETS,formatSchedule} from '../../../../.eliza/client-features/packages/ui/src/utils/cron-format.ts';
import {canSnoozeReminder,reminderDue} from '../../../../.eliza/client-features/packages/ui/src/utils/reminder-presentation';
import {AUTOMATIONS_COMMITTED_EVENT} from '../runtime/automation-completion';
import {openWorkflowFilters,workflowFilterLabel,type WorkflowTypeFilter,type WorkflowStatusFilter} from './workflow-filters';
import {FEED_FILTERS,passesFilter,type FeedFilter} from '../../../../.eliza/client-features/packages/ui/src/utils/automation-feed-filter';
import {AutomationsProtocol,AutomationOutcomeError,automationIssue,automationLocalDateInput,automationWhen,workflowDeviceTimeZone,mergeAutomationRows,scheduledTaskEnded,scheduledSnoozeAt,type AutomationRow,type AutomationIssue,type PromptDraft,type ReminderDraft,type AutomationRequest} from '../runtime/automations-protocol';
import {connectionController,agentPendingText,agentAvailabilityNotice} from '../runtime/connection-ui';
import {showAgentStatus} from './workflow-authoring';
import {DailyApps,type Reminder} from '../daily';
import {WorkflowIntentStore,workflowIntentKey} from '../runtime/workflow-intents';
import {createWorkflowRequestRecovery} from '../runtime/workflow-request-recovery';
import {Capacitor} from '@capacitor/core';
import {homeReadIsStale,presentHomeWorkflowFreshness} from './home-cards';
import {BrowserReviews} from '../browser/review';
import './automations.css';
type Bag=Record<string,any>;
type Binding={sessionId:string;conversationId?:string;request:AutomationRequest};
type Editor={kind:'prompt';draft:PromptDraft;row?:AutomationRow}|{kind:'reminder';draft:ReminderDraft;row?:AutomationRow};
const dateInput=automationLocalDateInput;
const future=()=>dateInput(Date.now()+3600000);
const timeZone=workflowDeviceTimeZone;
/** Prompt presets share the daily/weekly parser with the inline schedule editor. */
function recurringClock(expression:string){
 const clock=workflowClockSchedule(expression);if(!clock)return null;
 return {...clock,preset:{expression:workflowClockExpression('09:00',clock.days),label:''}};
}
function presetAt(preset:typeof CRON_PRESETS[number],time:string){
 const match=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
 return match?[String(Number(match[2])),String(Number(match[1])),...preset.expression.split(/\s+/).slice(2)].join(' '):preset.expression;
}

const filters=[...FEED_FILTERS.slice(0,4),'schedules',...FEED_FILTERS.slice(4)] as const;
type Filter=FeedFilter|'schedules';
const filterNames:Record<Filter,string>={all:'All',reminders:'Reminders',prompts:'Prompts',workflows:'Workflows',schedules:'Schedules',active:'Active',inactive:'Inactive'};
const SCHEDULE_INVALID='Pick a time and day';
const rowStatus=(row:AutomationRow)=>row.kind==='schedule'&&row.status==='snoozed'?'':(row.kind==='reminder'?({blocked:'Delivery blocked',duplicate:'Duplicate skipped',unknown:'Unknown',unscheduled:'—'} as Record<string,string>)[row.status]:undefined)||(row.status?row.status.charAt(0).toUpperCase()+row.status.slice(1).replaceAll('-',' '):(row.enabled?'Active':'Inactive'));
const rowPasses=(row:AutomationRow,filter:Filter)=>filter==='reminders'?row.kind==='reminder'||row.kind==='device-reminder':filter==='schedules'?row.kind==='schedule':passesFilter({kind:row.kind==='workflow'?'workflow':'task',active:row.enabled},filter)&&!(filter==='prompts'&&(row.kind==='reminder'||row.kind==='device-reminder'||row.kind==='schedule'||row.kind==='routine'));
function deviceRow(row:Reminder):AutomationRow {
 return {key:'device-reminder:'+row.id,id:row.id,kind:'device-reminder',title:row.title,description:row.body||'',status:row.status,enabled:['pending','scheduled','posted'].includes(row.status),source:'On this phone',schedule:automationWhen(row.dueAt||row.at),record:row};
}
/** One Alpha list over existing engines. Only explicit owner actions submit mutations. */
export function installAutomationsAdapter(Component:any,views:Bag){
 const view=views.workflows,p=Component.prototype,render=view.render,back=view.back,leave=view.onLeave;
 view.automationsManaged=true;
 let owner:any,api:Bag|undefined,rows:AutomationRow[]=[],issues:AutomationIssue[]=[],typeFilter:WorkflowTypeFilter='all',statusFilter:WorkflowStatusFilter='all';
 let promptMore=false,newMore=false;
 let closeFilters:(()=>void)|undefined;
 const dismissFilters=()=>{closeFilters?.();closeFilters=undefined;};
 let detail:AutomationRow|null=null,editor:Editor|null=null,creating=false,review:{label:string;key:string;run:(client:AutomationsProtocol,signal:AbortSignal)=>Promise<unknown>}|null=null;
 let state:'idle'|'loading'|'ready'|'failed'='idle',message='',controller:AbortController|null=null,epoch=0,session:string|null=null,loadedSession:string|null=null,history:string[]=[];
 let scheduleDraft:string|null=null;
 let scheduleTime='';
 let scheduleHour='8',scheduleMinute='00',schedulePeriod='AM',scheduleDays=[0,1,2,3,4,5,6];
 const setClock=(time:string)=>{scheduleTime=time;const [hour,minute]=time.split(':');scheduleHour=/^([01]\d|2[0-3]):[0-5]\d$/.test(time)?String(Number(hour)%12||12):hour;scheduleMinute=minute||'00';schedulePeriod=Number(hour)>=12?'PM':'AM';};
 const readClock=()=>{const hour=Number(scheduleHour),minute=Number(scheduleMinute);return /^\d{1,2}$/.test(scheduleHour)&&/^\d{1,2}$/.test(scheduleMinute)&&hour>=1&&hour<=12&&minute<=59?String(hour%12+(schedulePeriod==='PM'?12:0)).padStart(2,'0')+':'+String(minute).padStart(2,'0'):'';};
 const repeatFor=(days:number[])=>days.length===7?'daily':days.join(',')==='1,2,3,4,5'?'weekdays':days.join(',')==='0,6'?'weekends':'custom';
 let completionDirty=false;
 const uncertain=new Set<string>();
 let releaseReviews:BrowserReviews|undefined;
 let intentStore:WorkflowIntentStore|null=null,suspended=document.hidden;
 const recovery=createWorkflowRequestRecovery(async()=>(await import('../browser/domain-recovery')).openDomainRecovery);
 let homeCache:{sessionId:string;rows:Array<{name:string;status:string}>;total:number;complete:boolean;partial:boolean;stale:boolean;error:boolean;loadedAt:number}|null=null;
 const binding=():Binding|null=>(connectionController as typeof connectionController & {getAutomationsClient():Binding|null}).getAutomationsClient();
 const reminderBlock=()=>!binding()?agentPendingText():loadedSession!==binding()?.sessionId||state!=='ready'?'Refresh first':issues.find(issue=>issue.source==='reminders')?.message||'';
 const automationBlock=()=>!binding()?agentPendingText():loadedSession!==binding()?.sessionId||state!=='ready'?'Refresh first':issues.find(issue=>issue.source==='automations'&&issue.unavailable)?.message||'';
 const scheduleBlock=()=>!binding()?agentPendingText():loadedSession!==binding()?.sessionId||state!=='ready'?'Refresh first':issues.find(issue=>issue.source==='schedules')?.message||'';
 const publish=()=>{if(owner?.live&&!suspended&&!document.hidden)owner.vset('workflows',{automationTick:Date.now()});};
 const retire=(clear=false)=>{releaseReviews?.cancelAll();dismissFilters();recovery.retire();epoch++;controller?.abort();controller=null;detail=null;scheduleDraft=null;editor=null;creating=false;review=null;message='';if(clear){completionDirty=false;rows=[];issues=[];intentStore=null;state='idle';loadedSession=null;}publish();};
 const requestKey=(id:string)=>{const owner=connectionController.getSnapshot().session;return owner?workflowIntentKey(owner,'automation:'+id):'offline:'+id;};
 const key=(row:AutomationRow)=>requestKey(row.key);
 const locked=(row:AutomationRow)=>uncertain.has(key(row))||(!!binding()&&(intentStore?.locked(key(row))??true));
 const visible=()=>owner?.live&&!suspended&&owner.S().view==='workflows'&&!document.hidden&&!connectionController.getSnapshot().open;
 const recoverRequests=()=>{
  const store=intentStore, ticket=epoch, sessionId=connectionController.getSnapshot().session?.sessionId;
  if(!store||!sessionId||Capacitor.isNativePlatform())return;
  void recovery.open({
   store,
   current:()=>!!visible()&&!controller&&epoch===ticket&&intentStore===store&&connectionController.getSnapshot().session?.sessionId===sessionId,
   changed:()=>{store.invalidate();publish();},
   unavailable:()=>api?.toast('Recovery unavailable'),
  });
 };
 /** Retained requests that fresh rows prove applied: a delete whose row is gone, or an enable/reminder edit whose fields match.
  * Run now, fire, snooze and new items never settle here, since a row's absence or presence proves nothing about them. */
 const settled=(entries:Record<string,string>,fresh:AutomationRow[],complete:(source:AutomationIssue['source'])=>boolean)=>Object.entries(entries).filter(([id,raw])=>{
  let intent:Bag;try{intent=JSON.parse(raw);}catch{return false;}
  if(intent?.kind!=='automation'||typeof intent.path!=='string')return false;
  const body:Bag=intent.body&&typeof intent.body==='object'?intent.body:{},fields=Object.keys(body),row=fresh.find(row=>requestKey(row.key)===id);
  if(/^\/api\/triggers\/[^/]+$/.test(intent.path)&&complete('automations'))return intent.method==='DELETE'?!row:intent.method==='PUT'&&fields.join()==='enabled'&&row?.kind==='prompt'&&row.enabled===body.enabled;
  if(/^\/api\/lifeops\/definitions\/[^/]+$/.test(intent.path)&&intent.method==='PUT'&&complete('reminders')&&row?.kind==='reminder'&&fields.length){const definition=row.record.definition;return fields.every(field=>field==='cadence'?definition.cadence?.dueAt===body.cadence?.dueAt:definition[field]===body[field]);}
  return false;
 });
 async function refresh(preserveMessage=false){
  if(controller||!visible())return;
  recovery.retire();
  const selected=binding(),ticket=++epoch,abort=controller=new AbortController();state='loading';if(homeCache)homeCache.stale=true;if(!preserveMessage)message='';publish();
  const valid=()=>ticket===epoch&&!abort.signal.aborted&&visible()&&selected?.sessionId===binding()?.sessionId;
  try{
   const ownerContext=connectionController.getSnapshot().session,store=ownerContext?new WorkflowIntentStore(ownerContext):null;
   const [remote,local,pending]=await Promise.allSettled([selected?new AutomationsProtocol(selected.request).list(abort.signal):Promise.resolve({rows:[] as AutomationRow[],issues:ownerContext?[{source:'automations' as const,unavailable:true,message:'Unavailable'}]:[]}),DailyApps.listReminders(),store?.load(abort.signal),view.refreshManagement?.(abort.signal,valid)]);
   if(!valid())return;
   const next:AutomationRow[]=[],failures:AutomationIssue[]=[];
   if(remote.status==='fulfilled'){next.push(...remote.value.rows);failures.push(...remote.value.issues);}else failures.push(automationIssue('automations',remote.reason));
   if(local.status==='fulfilled')next.push(...local.value.reminders.map(deviceRow));else failures.push(automationIssue('device',local.reason));
   const fresh=mergeAutomationRows(next),complete=(source:AutomationIssue['source'])=>remote.status==='fulfilled'&&!remote.value.issues.some(issue=>issue.source===source);
   if(store&&pending.status==='fulfilled'&&pending.value)for(const [id,raw] of settled(pending.value,fresh,complete)){try{await store.acknowledge(id,raw,abort.signal);uncertain.delete(id);}catch{await store.load(abort.signal).catch(()=>undefined);break;}}
   if(!valid())return;
   intentStore=store;if(pending.status==='rejected'||store?.stale)failures.push({source:'automations',unavailable:false,message:'Pending check failed'});
   rows=fresh;issues=failures;state='ready';loadedSession=selected?.sessionId||'offline';
   const enabled=rows.filter(row=>row.enabled);
   // Home shows only enabled automations; with none its card is hidden.
   homeCache={sessionId:loadedSession,rows:enabled.map(row=>({name:row.title,status:''})),total:enabled.length,complete:!!selected&&failures.length===0,partial:failures.some(issue=>!issue.unavailable||issue.source==='device'),stale:false,error:false,loadedAt:Date.now()};
   if(!selected)message=ownerContext?'':agentAvailabilityNotice();
   if(detail){
    const freshDetail=rows.find(row=>row.key===detail!.key);
    if(freshDetail)detail=freshDetail;
    else if(detail.kind==='schedule'){
     if(!failures.some(issue=>issue.source==='schedules')){
      detail=null;scheduleDraft=null;scheduleTime='';review=null;
     }
    }else if(!failures.length)detail=null;
   }
  }catch{if(valid()){state='failed';if(homeCache)homeCache.error=true;message='Couldn’t refresh';}}
  finally{if(ticket===epoch){controller=null;publish();}}
 }
 async function work(task:(client:AutomationsProtocol,signal:AbortSignal)=>Promise<unknown>,rowKey?:string){
  if(controller)return;const selected=binding();if(!selected){showAgentStatus(owner);return;}
  const ownerContext=connectionController.getSnapshot().session;if(!ownerContext)return;
  const intents=new WorkflowIntentStore(ownerContext),ticket=++epoch,abort=controller=new AbortController();let dispatched=false,retained:string|undefined,sent='';message='';publish();
  const valid=()=>ticket===epoch&&!abort.signal.aborted&&visible()&&selected.sessionId===binding()?.sessionId;
  const client=new AutomationsProtocol(async(path,method,body,signal)=>{if(!valid())throw Error('Automation connection changed.');if(method!=='GET'){const blocked=path.startsWith('/api/lifeops/scheduled-tasks/')?scheduleBlock():path.startsWith('/api/lifeops/definitions')||path.startsWith('/api/lifeops/occurrences/')?reminderBlock():path.startsWith('/api/triggers')?automationBlock():'';if(blocked)throw new AutomationOutcomeError(blocked);if(!rowKey)throw Error('Missing automation request identity.');retained=await intents.admit(rowKey,{kind:'automation',path,method,body},signal);sent=method+' '+path;if(!valid())throw Error('Automation connection changed.');dispatched=true;uncertain.add(rowKey);}return selected.request(path,method,body,signal);},selected.conversationId);
  try{await intents.load(abort.signal);await task(client,abort.signal);if(!valid())return;if(rowKey&&retained)await intents.acknowledge(rowKey,retained,abort.signal);if(!valid())return;if(rowKey)uncertain.delete(rowKey);if(dispatched){editor=null;review=null;creating=false;message=sent.endsWith('/fire')?'Run started.':'Saved';}}
  catch(error){const status=error&&typeof error==='object'&&'status' in error?Number(error.status):0,code=error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'?error.code:'',known=error instanceof AutomationOutcomeError,rejected=([400,401,403,404,405,409,410,413,414,415,422].includes(status)||status===429&&sent==='POST /api/triggers')&&!/unknown|unconfirmed|ambiguous/i.test(code);if(rowKey&&(rejected||known)&&retained&&valid()){try{await intents.acknowledge(rowKey,retained,abort.signal);uncertain.delete(rowKey);}catch{/* Keep unconfirmed requests in the existing journal. */}}if(valid())message=dispatched&&!rejected&&!known?'Unknown':error instanceof Error?error.message:'Automation request failed.';}
  finally{if(ticket===epoch){intentStore=intents;controller=null;publish();}}
  if(valid()&&!editor&&!review)await refresh(true);
 }
 /** The owner's informed release of an unconfirmed request, after checking the record. Never retries it. */
 async function allowAnother(id:string){
  if(controller||!id)return;
  if(!await (releaseReviews??=new BrowserReviews()).confirm('allow-another-automation','Allow another try?','The last request may already have gone through. Trying again could run it twice.','Allow another try',{current:()=>!controller&&!!visible()})||controller)return;
  const ownerContext=connectionController.getSnapshot().session;if(!ownerContext)return;
  const intents=new WorkflowIntentStore(ownerContext),ticket=++epoch,abort=controller=new AbortController();message='';publish();
  try{const raw=await intents.read(id,abort.signal);if(raw!==null)await intents.acknowledge(id,raw,abort.signal);if(ticket===epoch)uncertain.delete(id);}
  catch{if(ticket===epoch)message='Couldn’t release';}
  finally{if(ticket===epoch){intentStore=intents;controller=null;publish();}}
 }
 function show(row:AutomationRow){
  if(controller)return;creating=false;editor=null;review=null;message='';history=[];
  if(row.kind==='workflow'&&row.workflowId){detail=null;const out=render(owner.vget('workflows'),owner.api('workflows'));out.openWorkflow(row.workflowId);return;}
  if(row.kind==='device-reminder'){owner.openView('calendar');void owner.refreshReminders(row.id,row.record.occurrenceId);return;}
  scheduleDraft=null;detail=row;if(row.kind==='reminder'){const attempt=row.record.latestAttempt;history=attempt?.attemptedAt?[(String(attempt.outcome).startsWith('delivered')?'Delivered':String(attempt.outcome).startsWith('blocked')?'Delivery blocked':'Unknown')+' · '+new Date(attempt.attemptedAt).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})]:[];}publish();
 }
 function ask(label:string,row:AutomationRow,run:(client:AutomationsProtocol,signal:AbortSignal)=>Promise<unknown>){if(controller||locked(row))return;const blocked=row.kind==='schedule'?scheduleBlock():'';if(blocked){message=blocked;publish();return;}review={label,key:key(row),run};message='';publish();}
 async function editPrompt(row:AutomationRow){
  if(!row.triggerId||locked(row))return;
  await work(async(client,signal)=>{const trigger=await client.prompt(row.triggerId!,signal);promptMore=trigger.triggerType==='event'||trigger.triggerType==='cron'&&!recurringClock(trigger.cronExpression||'');editor={kind:'prompt',row,draft:{title:trigger.displayName||row.title,instructions:trigger.instructions||row.description,triggerType:trigger.triggerType==='event'?'event':trigger.triggerType==='cron'?'cron':'once',scheduledAt:dateInput(trigger.scheduledAtIso||Date.now()+3600000),cron:trigger.cronExpression||'',eventKind:trigger.eventKind||'',timezone:trigger.timezone||timeZone(),originalScheduledAt:trigger.scheduledAtIso,originalEnabled:trigger.enabled}};});
 }
 function editReminder(row:AutomationRow){const d=row.record.definition;editor={kind:'reminder',row,draft:{message:d.cadence?.kind==='once'&&d.metadata?.ownerSurface==='OWNER_REMINDERS'&&d.description?.trim()?d.description:d.title,due:dateInput(reminderDue(row.record as Parameters<typeof reminderDue>[0])||''),timezone:timeZone(),idempotencyKey:''}};publish();}
 function create(kind:'prompt'|'reminder'){if(controller)return;promptMore=false;const blocked=kind==='reminder'?reminderBlock():automationBlock();if(blocked){message=blocked;publish();return;}creating=false;detail=null;review=null;message='';editor=kind==='prompt'?{kind,draft:{title:'',instructions:'',triggerType:'once',scheduledAt:future(),cron:'',eventKind:'',timezone:timeZone()}}:{kind,draft:{message:'',due:future(),timezone:timeZone(),idempotencyKey:crypto.randomUUID()}};publish();}
 function save(){
  if(!editor||controller)return;const selected=editor,id=selected.row?key(selected.row):requestKey('new:'+selected.kind);
  // The recovered form makes a name optional; retain the existing protocol's required title.
  if(selected.kind==='prompt'&&!selected.draft.title.trim())selected.draft.title=Array.from(selected.draft.instructions.trim().split(/\r?\n/)[0]).slice(0,80).join('');
  const blocked=selected.kind==='reminder'?reminderBlock():automationBlock();if(blocked){message=blocked;publish();return;}
  if(uncertain.has(id)||intentStore?.locked(id)){message='Unconfirmed save';publish();return;}
  void work((client,signal)=>selected.kind==='prompt'?client.savePrompt(selected.draft,signal,selected.row?.triggerId):selected.row?client.editReminder(selected.row,selected.draft.message,selected.draft.due,signal):client.createReminder(selected.draft,signal),id);
 }
 const close=()=>{if(controller)return;if(scheduleDraft!==null){scheduleDraft=null;publish();return;}editor=null;detail=null;creating=false;review=null;message='';publish();};
 const newDeviceReminder=()=>{close();owner.openView('calendar');owner.newDeviceReminderDraft();};
 view.back=()=>{if(closeFilters){dismissFilters();return true;}if(editor||detail||creating||review){close();return true;}return back?.();};
 view.onLeave=()=>{retire(true);leave?.();};
 p.cachedAutomationsHome=function(){return this===owner&&homeCache?.sessionId===(binding()?.sessionId||'offline')?homeCache:null;};
 const values=p.renderVals;
 p.renderVals=function(){const out=values?.call(this)||{},cached=this.cachedAutomationsHome();if(!cached)return out.homeWorkflowHasRows?out:{...out,homeWorkflowFreshness:'',homeWorkflowDescription:'',homeWorkflowConfirmedEmpty:false,homeWorkflowTitle:'Workflows',homeWorkflowTime:'Open to view',homeWorkflowLabel:'Open workflows',goFlows:()=>this.openView('workflows')};const loaded=presentHomeWorkflowFreshness({loadedAt:cached.loadedAt,now:Date.now(),unified:true,agent:cached.sessionId!=='offline'});return {...out,homeWorkflowFreshness:loaded.visible,homeWorkflowDescription:loaded.description,homeWorkflowRows:cached.rows.slice(0,2),homeWorkflowHasRows:cached.total>0,homeWorkflowConfirmedEmpty:cached.complete&&!cached.stale&&!cached.error&&cached.total===0&&cached.loadedAt>0&&cached.loadedAt<=Date.now()&&!homeReadIsStale(cached.loadedAt,Date.now()),homeWorkflowTitle:cached.total?'':cached.partial?'Some unavailable':'None',homeWorkflowTime:cached.error?'Stale':cached.stale?'Not current':cached.partial?'Some unavailable':cached.total>2?`+${cached.total-2} more`:cached.total?'View automations':'',homeWorkflowLabel:'Open workflows',goFlows:()=>this.openView('workflows')};};
 view.render=(value:Bag,current:Bag)=>{
  api=current;const workflow=render(value,current),currentSession=binding()?.sessionId||'offline';
  if(visible()&&(state==='idle'||completionDirty)&&!controller&&!editor&&!detail&&!creating&&!review&&!workflow.detail&&!workflow.builder&&!workflow.runOpen&&!workflow.removedList){completionDirty=false;state='loading';queueMicrotask(()=>void refresh(true));}
  if(workflow.detail||workflow.builder||workflow.runOpen||workflow.removedList)return {...workflow,workflowDetail:workflow.detail,automation:null};
  const cards=rows.filter(row=>rowPasses(row,typeFilter)&&rowPasses(row,statusFilter)).map(row=>({name:row.title,icon:current.ic[row.kind==='reminder'||row.kind==='device-reminder'?'bell':row.kind==='prompt'?'spark':row.kind==='schedule'||row.kind==='routine'?'cal':'flow'],short:row.schedule||row.source.replace(/^Agent /,''),statusLabel:locked(row)?'Outcome unknown':row.kind==='workflow'&&row.workflowId&&workflow.waitingFor?.(row.workflowId)?'Waiting for you':rowStatus(row),on:row.enabled,track:current.track(row.enabled),kx:current.kx(row.enabled),dim:'',failed:row.status==='failed',open:()=>show(row),toggle:()=>show(row)}));
  const empty=state==='ready'&&!cards.length&&!issues.length;
  const managementCards=[...(workflow.managementCards||[])];
  managementCards.push({
   name:'Scheduled digests',short:'',open:()=>window.dispatchEvent(new Event('alpha:hosted-digests')),
  });

  if(intentStore&&!Capacitor.isNativePlatform())managementCards.push({
   name:'Recovery',short:'Back up or reset',open:recoverRequests,
  });
  const selected=editor?.row||detail,selectedLocked=!!selected&&locked(selected);
  const scheduleBlocked=detail?.kind==='schedule'&&!!scheduleBlock();
  const lockId=selected?key(selected):editor?requestKey('new:'+editor.kind):'',formLocked=!selected&&!!editor&&(uncertain.has(lockId)||!!intentStore?.locked(lockId));
  const actions:Array<{label:string;run:()=>void;disabled:boolean;aria?:string;icon?:string}>=[];
  const action=(label:string,fn:(client:AutomationsProtocol,signal:AbortSignal)=>Promise<unknown>)=>{if(detail)actions.push({label,run:()=>ask(label,detail!,fn),disabled:!!controller||selectedLocked||scheduleBlocked});};
  if(detail?.kind==='prompt'&&detail.triggerId){const row=detail,id=row.triggerId!;if(!row.record.system)actions.push({label:'Edit prompt',run:()=>void editPrompt(row),disabled:!!controller||selectedLocked});actions.push({label:'Refresh execution history',icon:current.ic?.calRepeat,run:()=>void work(async(client,signal)=>{history=(await client.promptRuns(id,signal)).map(value=>{const run=value as Bag;return [run.startedAtIso||run.startedAt,run.status,run.error].filter(Boolean).join(' · ');});publish();}),disabled:!!controller});if(!row.record.system){action(row.enabled?'Pause':'Enable',(client,signal)=>client.setPromptEnabled(id,!row.enabled,signal));action('Run now',(client,signal)=>client.runPrompt(id,signal));action('Delete prompt',(client,signal)=>client.deletePrompt(id,signal));}}
  const scheduled=detail?.kind==='schedule'?detail:null;
  const scheduleClock=scheduled?.record.trigger?.kind==='cron'?recurringClock(String(scheduled.record.trigger.expression||'')):null;
  const ended=scheduled&&scheduledTaskEnded(scheduled.status);
  if(scheduled && scheduleDraft===null && !review){
   if(ended)action('Reopen',(client,signal)=>client.scheduledVerb(scheduled.id,'reopen',signal));
   else {
    action('Run now',(client,signal)=>client.scheduledVerb(scheduled.id,'fire',signal));
    actions.push({label:'Edit schedule',disabled:!!controller||selectedLocked||scheduleBlocked,run:()=>{if(controller||locked(scheduled)||scheduleBlock())return;scheduleDraft=scheduled.description;setClock(scheduleClock?.time??'');scheduleDays=scheduleClock?[...scheduleClock.days]:[0,1,2,3,4,5,6];publish();}});
    actions.push({label:'10 min',aria:'Snooze 10 minutes',disabled:!!controller||selectedLocked||scheduleBlocked,run:()=>{if(controller||locked(scheduled)||scheduleBlocked)return;const untilIso=scheduledSnoozeAt(scheduled);ask('Snooze until '+workflowSnoozeTime(untilIso),scheduled,(client,signal)=>client.snoozeSchedule(scheduled.id,untilIso,signal));}});
    for(const [label,verb] of [['Complete','complete'],['Dismiss','dismiss']] as const)
     action(label,(client,signal)=>client.scheduledVerb(scheduled.id,verb,signal));
   }
  }
  if(detail?.kind==='reminder'&&!['archived','completed'].includes(detail.record.definition.status)){const row=detail;actions.push({label:'Edit reminder',run:()=>editReminder(row),disabled:!!controller||selectedLocked});actions.push({label:'10 min',aria:'Snooze 10 minutes',run:()=>{if(canSnoozeReminder(row.record as Parameters<typeof canSnoozeReminder>[0])&&row.occurrenceId)ask('Snooze 10 minutes',row,(client,signal)=>client.snoozeReminder(row.occurrenceId!,signal));},disabled:!!controller||selectedLocked||!canSnoozeReminder(row.record as Parameters<typeof canSnoozeReminder>[0])});action('Cancel reminder',(client,signal)=>client.cancelReminder(row.id,signal));}
  if(detail?.kind==='routine'){const row=detail,noun=row.source.replace(/^Agent /,'');if(['active','paused'].includes(row.status))action(row.enabled?'Pause':'Resume',(client,signal)=>client.setDefinitionEnabled(row.id,!row.enabled,signal));action('Delete '+noun,(client,signal)=>client.deleteDefinition(row.id,signal));}
  const field=(name:string,label:string,fieldValue:string,type='text')=>({name,label,value:fieldValue,type,multiline:name==='instructions'||name==='message',singleLine:name!=='instructions'&&name!=='message',change:(event:Bag)=>{if(editor&&!controller){const value=String(event.target.value);if(name==='recurringTime'&&editor.kind==='prompt'){const clock=recurringClock(editor.draft.cron);if(clock&&/^([01]\d|2[0-3]):([0-5]\d)$/.test(value))editor.draft.cron=presetAt(clock.preset,value);}else (editor.draft as unknown as Bag)[name]=value;publish();}}});
  const fields:Bag[]=[],moreFields:Bag[]=[],whenFields:Bag[]=[];if(editor?.kind==='prompt'){fields.push(field('instructions','Task',editor.draft.instructions));moreFields.push(field('title','Name (optional)',editor.draft.title));if(editor.draft.triggerType==='once')whenFields.push(field('scheduledAt','Date and time',editor.draft.scheduledAt,'datetime-local'));if(editor.draft.triggerType==='cron'){const clock=recurringClock(editor.draft.cron);if(clock)whenFields.push(field('recurringTime','Time',clock.time,'time'));moreFields.push(field('cron','Cron',editor.draft.cron));}if(editor.draft.triggerType==='event')moreFields.push(field('eventKind','Event name',editor.draft.eventKind));}else if(editor){fields.push(field('message','Reminder',editor.draft.message));if(!editor.row||editor.row.record.definition.cadence?.kind==='once')fields.push(field('due','Due',editor.draft.due,'datetime-local'));}
  const shownActions=actions.map(entry=>({...entry,aria:entry.aria||entry.label,text:entry.icon?'':entry.label}));
  return {...workflow,cards,newFlow:()=>{newMore=false;creating=true;detail=null;editor=null;publish();},listToggles:false,automation:{
   filters:filters.map(name=>({name:filterNames[name],selected:name===typeFilter||name===statusFilter&&name!=='all',pick:()=>{if(name==='active'||name==='inactive')statusFilter=name;else typeFilter=name;publish();}})),filterLabel:workflowFilterLabel(typeFilter,statusFilter),itemCount:state==='ready'?`${cards.length} ${cards.length===1?'item':'items'}`:'',openFilters:()=>{dismissFilters();const selectedSession=binding()?.sessionId||'offline';closeFilters=openWorkflowFilters({type:typeFilter,status:statusFilter,current:()=>visible()&&(binding()?.sessionId||'offline')===selectedSession,apply:(type,status)=>{typeFilter=type;statusFilter=status;publish();},refresh:()=>void refresh(),busy:!!controller,closed:()=>{closeFilters=undefined;}});},loading:state==='loading',stale:loadedSession!==null&&loadedSession!==currentSession,empty,emptyLabel:typeFilter==='all'&&statusFilter==='all'?'No automations':'No matches',failed:state==='failed',message,issues,refresh:()=>void refresh(),busy:!!controller,managementCards,history,
   detail:!!(detail||editor||creating),title:creating?'Add to Workflows':editor?editor.kind==='prompt'?(editor.row?'Edit automation':'New automation'):(editor.row?'Edit reminder':'New reminder'):detail?.title||'',close,creating,agentUnavailable:!!controller||!!automationBlock(),newMore,newMoreLabel:newMore?'Fewer options':'More options',toggleNewMore:()=>{newMore=!newMore;publish();},workflowDescription:automationBlock(),promptDescription:automationBlock(),agentReminderUnavailable:!!controller||!!reminderBlock(),agentReminderDescription:reminderBlock(),saveDisabled:!!controller||!!editor&&!!(editor.kind==='reminder'?reminderBlock():automationBlock()),createWorkflow:()=>{if(controller)return;const blocked=automationBlock();if(blocked){message=blocked;publish();return;}creating=false;render(value,current).newFlow();publish();},createPrompt:()=>create('prompt'),createReminder:()=>create('reminder'),createDeviceReminder:newDeviceReminder,
   editing:!!editor,fields,moreFields,whenFields,promptSaveNote:editor?.row?.enabled?'':'Paused',promptMore,promptMoreLabel:promptMore?'Fewer options':'More options',togglePromptMore:()=>{promptMore=!promptMore;publish();},whenLabel:editor?.kind==='prompt'?(editor.draft.triggerType==='once'?'Once':editor.draft.triggerType==='cron'?formatSchedule(editor.draft.cron)===editor.draft.cron?'Custom schedule':formatSchedule(editor.draft.cron)||'Schedule':'On an event'):'',scheduleOptions:editor?.kind==='prompt'?[{label:'Once',selected:editor.draft.triggerType==='once',pick:()=>{if(editor?.kind==='prompt'&&!controller){editor.draft.triggerType='once';publish();}}},...CRON_PRESETS.slice(1,4).map(preset=>({label:formatSchedule(editor?.kind==='prompt'&&recurringClock(editor.draft.cron)?presetAt(preset,recurringClock(editor.draft.cron)!.time):preset.expression),selected:editor?.kind==='prompt'&&editor.draft.triggerType==='cron'&&recurringClock(editor.draft.cron)?.preset.expression===preset.expression,pick:()=>{if(editor?.kind==='prompt'&&!controller){const clock=recurringClock(editor.draft.cron);editor.draft.triggerType='cron';editor.draft.cron=clock?presetAt(preset,clock.time):preset.expression;publish();}}}))]:[],save,saveLabel:'Save',prompt:editor?.kind==='prompt',scheduleKinds:['once','cron','event'].map(kind=>({label:kind==='once'?'Once':kind==='cron'?'Recurring':'On event',selected:editor?.kind==='prompt'&&editor.draft.triggerType===kind,pick:()=>{if(editor?.kind==='prompt'&&!controller){editor.draft.triggerType=kind as PromptDraft['triggerType'];if(kind==='cron'&&!editor.draft.cron)editor.draft.cron=CRON_PRESETS[1].expression;publish();}}})),
   description:scheduleDraft!==null?'':detail?.description||'',source:scheduled?'':detail?.source||'',schedule:scheduleDraft!==null?'':detail?.kind==='reminder'?(()=>{const due=reminderDue(detail.record as Parameters<typeof reminderDue>[0]);return due?new Date(due).toLocaleString(undefined,{dateStyle:'full',timeStyle:'short'}):'—';})():detail?.schedule||'',status:detail?rowStatus(detail):'',actions:scheduled?[]:shownActions,
   schedulePrimary:scheduled?shownActions.slice(0,1):[],scheduleMore:scheduled&&shownActions.length>1?shownActions.slice(1):null,scheduleInvalid:message===SCHEDULE_INVALID,scheduleInvalidCss:message===SCHEDULE_INVALID?'outline:2px solid var(--alpha-call-red);outline-offset:4px;border-radius:12px':'',
   clockContext:scheduleDraft!==null&&scheduled?workflowClockContext(String(scheduled.record.trigger?.tz||'')):editor?.kind==='prompt'&&editor.draft.triggerType==='cron'?workflowClockContext(editor.draft.timezone):'',
   scheduleClockEditable:!!scheduleClock,editedScheduleTime:scheduleTime,
   changeScheduleTime:(event:Event)=>{setClock((event.target as HTMLInputElement).value);publish();},
   scheduleHour,scheduleMinute,schedulePeriod,
   changeScheduleHour:(event:Event)=>{scheduleHour=(event.target as HTMLInputElement).value;scheduleTime=readClock();publish();},
   changeScheduleMinute:(event:Event)=>{scheduleMinute=(event.target as HTMLInputElement).value;scheduleTime=readClock();publish();},
   schedulePeriods:['AM','PM'].map(period=>({label:period,selected:period===schedulePeriod,pick:()=>{schedulePeriod=period;scheduleTime=readClock();publish();}})),
   schedulePresets:[{label:'Every day',value:'daily',days:[0,1,2,3,4,5,6]},{label:'Weekdays',value:'weekdays',days:[1,2,3,4,5]},{label:'Weekends',value:'weekends',days:[0,6]}].map(preset=>({label:preset.label,selected:repeatFor(scheduleDays)===preset.value,pick:()=>{scheduleDays=[...preset.days];publish();}})),
   scheduleDays:[1,2,3,4,5,6,0].map(day=>({name:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][day],label:['S','M','T','W','T','F','S'][day],selected:scheduleDays.includes(day),pick:()=>{scheduleDays=scheduleDays.includes(day)?scheduleDays.filter(value=>value!==day):[...scheduleDays,day].sort((a,b)=>a-b);publish();}})),
   editingSchedule:!!scheduled&&scheduleDraft!==null,scheduleInstructions:scheduleDraft??'',scheduleSaveDisabled:!!controller||selectedLocked||scheduleBlocked||!scheduleDraft?.trim()||!!scheduleClock&&(!readClock()||!scheduleDays.length),
   changeScheduleInstructions:(event:Event)=>{scheduleDraft=(event.target as HTMLTextAreaElement).value;publish();},
   cancelScheduleEdit:()=>{scheduleDraft=null;publish();},
   saveScheduleEdit:()=>{if(!scheduled||!scheduleDraft?.trim()||locked(scheduled)||controller||scheduleBlock())return;const instructions=scheduleDraft.trim(),time=readClock();if(scheduleClock&&(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||!scheduleDays.length)){message=SCHEDULE_INVALID;publish();return;}
    const expression=scheduleClock?workflowClockExpression(time,scheduleDays):'';
    const trigger=scheduleClock&&expression!==workflowClockExpression(scheduleClock.time,scheduleClock.days)?{kind:'cron' as const,expression,tz:String(scheduled.record.trigger.tz)}:undefined;
    ask('Save schedule',scheduled,(client,signal)=>client.editSchedule(scheduled.id,instructions,trigger,signal));scheduleDraft=null;publish();},
   locked:selectedLocked||formLocked,allowAnother:()=>void allowAnother(lockId),
   review:!!review,reviewLabel:review?.label||'',reviewPrompt:`${review?.label||''}?`,reviewDetails:detail?.kind==='reminder'?[detail.title,detail.description,detail.schedule].filter(Boolean).join('\n'):'',reviewConfirmLabel:review?.label.startsWith('Snooze until ')?'Snooze':`Confirm ${review?.label||''}`,confirm:()=>{const selected=review;if(selected){review=null;void work(selected.run,selected.key);}},cancelReview:()=>{review=null;publish();},
  }};
 };
 const mount=p.componentDidMount,unmount=p.componentWillUnmount;
 p.componentDidMount=function(){mount.call(this);owner=this;session=binding()?.sessionId||null;this.automationCommitted=(event:CustomEvent<{sessionId:string}>)=>{const selected=binding();if(!owner?.live||suspended||!selected||!event.detail?.sessionId||event.detail.sessionId!==selected.sessionId)return;completionDirty=true;if(homeCache)homeCache.stale=true;publish();};window.addEventListener(AUTOMATIONS_COMMITTED_EVENT,this.automationCommitted);this.automationConnection=connectionController.subscribe(()=>{const next=binding()?.sessionId||null;if(next!==session||connectionController.getSnapshot().open){session=next;homeCache=null;retire(true);}});this.automationSuspend=()=>{suspended=true;homeCache=null;retire(true);};this.automationResume=()=>{suspended=false;publish();};this.automationVisibility=()=>document.hidden?this.automationSuspend():this.automationResume();document.addEventListener('visibilitychange',this.automationVisibility);window.addEventListener('pagehide',this.automationSuspend);window.addEventListener('pageshow',this.automationResume);};
 p.componentWillUnmount=function(){window.removeEventListener(AUTOMATIONS_COMMITTED_EVENT,this.automationCommitted);this.automationConnection?.();document.removeEventListener('visibilitychange',this.automationVisibility);window.removeEventListener('pagehide',this.automationSuspend);window.removeEventListener('pageshow',this.automationResume);suspended=true;retire(true);owner=null;unmount.call(this);};
}
