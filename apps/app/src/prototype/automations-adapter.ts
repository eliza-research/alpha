import {FEED_FILTERS,passesFilter,type FeedFilter} from '../../../../.eliza/client-features/packages/ui/src/utils/automation-feed-filter';
import {AutomationsProtocol,AutomationOutcomeError,automationIssue,automationLocalDateInput,mergeAutomationRows,type AutomationRow,type AutomationIssue,type PromptDraft,type ReminderDraft,type AutomationRequest,type ScheduledVerb} from '../runtime/automations-protocol';
import {connectionController,agentPendingText,agentAvailabilityNotice} from '../runtime/connection-ui';
import {DailyApps,type Reminder} from '../daily';
import {WorkflowIntentStore,workflowIntentKey} from '../runtime/workflow-intents';
import {presentHomeWorkflowFreshness} from './home-cards';
import './automations.css';
type Bag=Record<string,any>;
type Binding={sessionId:string;request:AutomationRequest};
type Editor={kind:'prompt';draft:PromptDraft;row?:AutomationRow}|{kind:'reminder';draft:ReminderDraft;row?:AutomationRow};
const dateInput=automationLocalDateInput;
const future=()=>dateInput(Date.now()+3600000);
const timeZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone;
const filters=[...FEED_FILTERS.slice(0,4),'schedules',...FEED_FILTERS.slice(4)] as const;
type Filter=FeedFilter|'schedules';
const filterNames:Record<Filter,string>={all:'All',reminders:'Reminders',prompts:'Prompts',workflows:'Workflows',schedules:'Schedules',active:'Active',inactive:'Inactive'};
const rowStatus=(row:AutomationRow)=>row.status?row.status.charAt(0).toUpperCase()+row.status.slice(1).replaceAll('-',' '):(row.enabled?'Active':'Inactive');
const rowPasses=(row:AutomationRow,filter:Filter)=>filter==='reminders'?row.kind==='reminder'||row.kind==='device-reminder':filter==='schedules'?row.kind==='schedule':passesFilter({kind:row.kind==='workflow'?'workflow':'task',active:row.enabled},filter)&&!(filter==='prompts'&&(row.kind==='reminder'||row.kind==='device-reminder'||row.kind==='schedule'));
function deviceRow(row:Reminder):AutomationRow {
 return {key:'device-reminder:'+row.id,id:row.id,kind:'device-reminder',title:row.title,description:row.body||'',status:row.status,enabled:['pending','scheduled','posted'].includes(row.status),source:'On this phone',schedule:new Date(row.dueAt||row.at).toLocaleString(),record:row};
}
/** One Alpha list over existing engines. Only explicit owner actions submit mutations. */
export function installAutomationsAdapter(Component:any,views:Bag){
 const view=views.workflows,p=Component.prototype,render=view.render,back=view.back,leave=view.onLeave;
 view.automationsManaged=true;
 let owner:any,api:Bag|undefined,rows:AutomationRow[]=[],issues:AutomationIssue[]=[],filter:Filter='all';
 let detail:AutomationRow|null=null,editor:Editor|null=null,creating=false,review:{label:string;key:string;run:(client:AutomationsProtocol,signal:AbortSignal)=>Promise<unknown>}|null=null;
 let state:'idle'|'loading'|'ready'|'failed'='idle',message='',controller:AbortController|null=null,epoch=0,session:string|null=null,loadedSession:string|null=null,history:string[]=[];
 const uncertain=new Set<string>();
 let intentStore:WorkflowIntentStore|null=null,suspended=document.hidden;
 let homeCache:{sessionId:string;rows:Array<{name:string;status:string}>;total:number;partial:boolean;stale:boolean;error:boolean;loadedAt:number}|null=null;
 const binding=():Binding|null=>(connectionController as typeof connectionController & {getAutomationsClient():Binding|null}).getAutomationsClient();
 const reminderBlock=()=>!binding()?agentPendingText():loadedSession!==binding()?.sessionId||state!=='ready'?'Refresh agent reminders before creating or changing one.':issues.find(issue=>issue.source==='reminders')?.message||'';
 const automationBlock=()=>!binding()?agentPendingText():loadedSession!==binding()?.sessionId||state!=='ready'?'Refresh agent automations before creating one.':issues.find(issue=>issue.source==='automations'&&issue.unavailable)?.message||'';
 const publish=()=>{if(owner?.live&&!suspended&&!document.hidden)owner.vset('workflows',{automationTick:Date.now()});};
 const retire=(clear=false)=>{epoch++;controller?.abort();controller=null;detail=null;editor=null;creating=false;review=null;message='';if(clear){rows=[];issues=[];intentStore=null;state='idle';loadedSession=null;}publish();};
 const requestKey=(id:string)=>{const owner=connectionController.getSnapshot().session;return owner?workflowIntentKey(owner,'automation:'+id):'offline:'+id;};
 const key=(row:AutomationRow)=>requestKey(row.key);
 const locked=(row:AutomationRow)=>uncertain.has(key(row))||(!!binding()&&(intentStore?.locked(key(row))??true));
 const visible=()=>owner?.live&&!suspended&&owner.S().view==='workflows'&&!document.hidden&&!connectionController.getSnapshot().open;
 async function refresh(preserveMessage=false){
  if(controller||!visible())return;
  const selected=binding(),ticket=++epoch,abort=controller=new AbortController();state='loading';if(homeCache)homeCache.stale=true;if(!preserveMessage)message='';publish();
  const valid=()=>ticket===epoch&&!abort.signal.aborted&&visible()&&selected?.sessionId===binding()?.sessionId;
  try{
   const ownerContext=connectionController.getSnapshot().session,store=ownerContext?new WorkflowIntentStore(ownerContext):null;
   const [remote,local,pending]=await Promise.allSettled([selected?new AutomationsProtocol(selected.request).list(abort.signal):Promise.resolve({rows:[] as AutomationRow[],issues:ownerContext?[{source:'automations' as const,unavailable:true,message:'Agent automations are unavailable on this connection.'}]:[]}),DailyApps.listReminders(),store?.load(abort.signal)]);
   if(!valid())return;
   const next:AutomationRow[]=[],failures:AutomationIssue[]=[];
   if(remote.status==='fulfilled'){next.push(...remote.value.rows);failures.push(...remote.value.issues);}else failures.push(automationIssue('automations',remote.reason));
   if(local.status==='fulfilled')next.push(...local.value.reminders.map(deviceRow));else failures.push(automationIssue('device',local.reason));
   intentStore=store;if(pending.status==='rejected')failures.push({source:'automations',unavailable:false,message:'Pending requests could not be checked. Changes stay blocked until this agent’s request history is available.'});
   rows=mergeAutomationRows(next);issues=failures;state='ready';loadedSession=selected?.sessionId||'offline';
   const enabled=rows.filter(row=>row.enabled);
   // Home shows only enabled automations; with none its card is hidden.
   homeCache={sessionId:loadedSession,rows:enabled.map(row=>({name:row.title,status:''})),total:enabled.length,partial:failures.some(issue=>!issue.unavailable||issue.source==='device'),stale:false,error:false,loadedAt:Date.now()};
   if(!selected)message=ownerContext?'Reminders on this phone stay available.':[agentAvailabilityNotice(),'Reminders on this phone stay available.'].filter(Boolean).join(' ');
   if(detail)detail=rows.find(row=>row.key===detail!.key)||null;
  }catch{if(valid()){state='failed';if(homeCache)homeCache.error=true;message='Automations could not refresh. Retry to check their current state.';}}
  finally{if(ticket===epoch){controller=null;publish();}}
 }
 async function work(task:(client:AutomationsProtocol,signal:AbortSignal)=>Promise<unknown>,rowKey?:string){
  if(controller)return;const selected=binding();if(!selected){connectionController.open();return;}
  const ownerContext=connectionController.getSnapshot().session;if(!ownerContext)return;
  const intents=new WorkflowIntentStore(ownerContext),ticket=++epoch,abort=controller=new AbortController();let dispatched=false,retained:string|undefined;message='';publish();
  const valid=()=>ticket===epoch&&!abort.signal.aborted&&visible()&&selected.sessionId===binding()?.sessionId;
  const client=new AutomationsProtocol(async(path,method,body,signal)=>{if(!valid())throw Error('Automation connection changed.');if(method!=='GET'){const blocked=path.startsWith('/api/lifeops/definitions')||path.startsWith('/api/lifeops/occurrences/')?reminderBlock():path.startsWith('/api/triggers')?automationBlock():'';if(blocked)throw new AutomationOutcomeError(blocked);if(!rowKey)throw Error('Missing automation request identity.');retained=await intents.admit(rowKey,{kind:'automation',path,method,body},signal);if(!valid())throw Error('Automation connection changed.');dispatched=true;uncertain.add(rowKey);}return selected.request(path,method,body,signal);});
  try{await intents.load(abort.signal);await task(client,abort.signal);if(!valid())return;if(rowKey&&retained)await intents.acknowledge(rowKey,retained,abort.signal);if(!valid())return;if(rowKey)uncertain.delete(rowKey);if(dispatched){editor=null;review=null;creating=false;message='Saved on this agent.';}}
  catch(error){const status=error&&typeof error==='object'&&'status' in error?Number(error.status):0,code=error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'?error.code:'',known=error instanceof AutomationOutcomeError,rejected=[400,401,403,404,405,410,413,414,415,422].includes(status)&&!/unknown|unconfirmed|ambiguous/i.test(code);if(rowKey&&(rejected||known)&&retained&&valid()){try{await intents.acknowledge(rowKey,retained,abort.signal);uncertain.delete(rowKey);}catch{/* Keep unconfirmed requests in the existing journal. */}}if(valid())message=dispatched&&!rejected&&!known?'Outcome unknown. Check the current record and history before repeating this action.':error instanceof Error?error.message:'Automation request failed.';}
  finally{if(ticket===epoch){intentStore=intents;controller=null;publish();}}
  if(valid()&&!editor&&!review)await refresh(true);
 }
 function show(row:AutomationRow){
  if(controller)return;creating=false;editor=null;review=null;message='';history=[];
  if(row.kind==='workflow'&&row.workflowId){detail=null;const out=render(owner.vget('workflows'),owner.api('workflows'));out.openWorkflow(row.workflowId);return;}
  if(row.kind==='device-reminder'){owner.openView('calendar');void owner.refreshReminders(row.id,row.record.occurrenceId);return;}
  detail=row;publish();
 }
 function ask(label:string,row:AutomationRow,run:(client:AutomationsProtocol,signal:AbortSignal)=>Promise<unknown>){if(controller||locked(row))return;review={label,key:key(row),run};message='';publish();}
 async function editPrompt(row:AutomationRow){
  if(!row.triggerId||locked(row))return;
  await work(async(client,signal)=>{const trigger=await client.prompt(row.triggerId!,signal);editor={kind:'prompt',row,draft:{title:trigger.displayName||row.title,instructions:trigger.instructions||row.description,triggerType:trigger.triggerType==='event'?'event':trigger.triggerType==='cron'?'cron':'once',scheduledAt:dateInput(trigger.scheduledAtIso||Date.now()+3600000),cron:trigger.cronExpression||'',eventKind:trigger.eventKind||'',timezone:trigger.timezone||timeZone(),originalScheduledAt:trigger.scheduledAtIso,originalEnabled:trigger.enabled}};});
 }
 function editReminder(row:AutomationRow){const d=row.record.definition;editor={kind:'reminder',row,draft:{message:d.cadence?.kind==='once'&&d.metadata?.ownerSurface==='OWNER_REMINDERS'&&d.description?.trim()?d.description:d.title,due:dateInput(d.cadence?.dueAt||''),timezone:d.timezone||timeZone(),idempotencyKey:''}};publish();}
 function create(kind:'prompt'|'reminder'){if(controller)return;const blocked=kind==='reminder'?reminderBlock():automationBlock();if(blocked){message=blocked;publish();return;}creating=false;detail=null;review=null;message='';editor=kind==='prompt'?{kind,draft:{title:'',instructions:'',triggerType:'once',scheduledAt:future(),cron:'',eventKind:'',timezone:timeZone()}}:{kind,draft:{message:'',due:future(),timezone:timeZone(),idempotencyKey:crypto.randomUUID()}};publish();}
 function save(){
  if(!editor||controller)return;const selected=editor,id=selected.row?key(selected.row):requestKey('new:'+selected.kind);
  const blocked=selected.kind==='reminder'?reminderBlock():automationBlock();if(blocked){message=blocked;publish();return;}
  if(uncertain.has(id)||intentStore?.locked(id)){message='The earlier save is not confirmed. Check this agent before creating another.';publish();return;}
  void work((client,signal)=>selected.kind==='prompt'?client.savePrompt(selected.draft,signal,selected.row?.triggerId):selected.row?client.editReminder(selected.row,selected.draft.message,selected.draft.due,signal):client.createReminder(selected.draft,signal),id);
 }
 const close=()=>{if(controller)return;editor=null;detail=null;creating=false;review=null;message='';publish();};
 const newDeviceReminder=()=>{close();owner.openView('calendar');owner.newDeviceReminderDraft();};
 view.back=()=>{if(editor||detail||creating||review){close();return true;}return back?.();};
 view.onLeave=()=>{retire(true);leave?.();};
 p.cachedAutomationsHome=function(){return this===owner&&homeCache?.sessionId===(binding()?.sessionId||'offline')?homeCache:null;};
 const values=p.renderVals;
 p.renderVals=function(){const out=values?.call(this)||{},cached=this.cachedAutomationsHome();if(!cached)return out.homeWorkflowHasRows?out:{...out,homeWorkflowFreshness:'',homeWorkflowDescription:'',homeWorkflowTitle:'Workflows',homeWorkflowTime:'Open to view',homeWorkflowLabel:'Open workflows and automations',goFlows:()=>this.openView('workflows')};const loaded=presentHomeWorkflowFreshness({loadedAt:cached.loadedAt,now:Date.now(),unified:true,agent:cached.sessionId!=='offline'});return {...out,homeWorkflowFreshness:loaded.visible,homeWorkflowDescription:loaded.description,homeWorkflowRows:cached.rows.slice(0,2),homeWorkflowHasRows:cached.total>0,homeWorkflowTitle:cached.total?'':cached.partial?'Some automations unavailable':'No automations yet',homeWorkflowTime:cached.error?'Couldn’t refresh · last loaded':cached.stale?'Last loaded items':cached.partial?'Some items unavailable':cached.total>2?`+${cached.total-2} more`:cached.total?'View automations':'',homeWorkflowLabel:'Open workflows and automations',goFlows:()=>this.openView('workflows')};};
 view.render=(value:Bag,current:Bag)=>{
  api=current;const workflow=render(value,current),currentSession=binding()?.sessionId||'offline';
  if(visible()&&state==='idle'&&!controller){state='loading';queueMicrotask(()=>void refresh());}
  if(workflow.detail||workflow.builder||workflow.runOpen||workflow.removedList)return {...workflow,workflowDetail:workflow.detail,automation:null};
  const cards=rows.filter(row=>rowPasses(row,filter)).map(row=>({name:row.title,short:[row.source,row.schedule].filter(Boolean).join(' · '),statusLabel:locked(row)?'Outcome unknown':rowStatus(row),on:row.enabled,track:current.track(row.enabled),kx:current.kx(row.enabled),dim:'',failed:row.status==='failed',open:()=>show(row),toggle:()=>show(row)}));
  const empty=state==='ready'&&!cards.length&&!issues.length;
  const selected=editor?.row||detail,selectedLocked=!!selected&&locked(selected);
  const actions:Array<{label:string;run:()=>void;disabled:boolean}>=[];
  const action=(label:string,fn:(client:AutomationsProtocol,signal:AbortSignal)=>Promise<unknown>)=>{if(detail)actions.push({label,run:()=>ask(label,detail!,fn),disabled:!!controller||selectedLocked});};
  if(detail?.kind==='prompt'&&detail.triggerId){const row=detail,id=row.triggerId!;if(!row.record.system)actions.push({label:'Edit prompt',run:()=>void editPrompt(row),disabled:!!controller||selectedLocked});actions.push({label:'Refresh execution history',run:()=>void work(async(client,signal)=>{history=(await client.promptRuns(id,signal)).map(value=>{const run=value as Bag;return [run.startedAtIso||run.startedAt,run.status,run.error].filter(Boolean).join(' · ');});publish();}),disabled:!!controller});if(!row.record.system){action(row.enabled?'Pause':'Enable',(client,signal)=>client.setPromptEnabled(id,!row.enabled,signal));action('Run now',(client,signal)=>client.runPrompt(id,signal));action('Delete prompt',(client,signal)=>client.deletePrompt(id,signal));}}
  if(detail?.kind==='schedule'){const row=detail;for(const [label,verb] of [['Run now','fire'],['Acknowledge','acknowledge'],['Snooze 1 hour','snooze'],['Complete','complete'],['Dismiss','dismiss'],['Reopen','reopen']] as Array<[string,ScheduledVerb]>)action(label,(client,signal)=>client.scheduledVerb(row.id,verb,signal));}
  if(detail?.kind==='reminder'){const row=detail;actions.push({label:'Edit reminder',run:()=>editReminder(row),disabled:!!controller||selectedLocked});if(row.occurrenceId)action('Snooze 10 minutes',(client,signal)=>client.snoozeReminder(row.occurrenceId!,signal));action('Cancel reminder',(client,signal)=>client.cancelReminder(row.id,signal));}
  const field=(name:string,label:string,fieldValue:string,type='text')=>({name,label,value:fieldValue,type,multiline:name==='instructions'||name==='message',singleLine:name!=='instructions'&&name!=='message',change:(event:Bag)=>{if(editor&&!controller){(editor.draft as unknown as Bag)[name]=String(event.target.value);publish();}}});
  const fields:Bag[]=[];if(editor?.kind==='prompt'){fields.push(field('title','Name',editor.draft.title),field('instructions','Instructions',editor.draft.instructions));if(editor.draft.triggerType==='once')fields.push(field('scheduledAt',`Run time · ${timeZone()}`,editor.draft.scheduledAt,'datetime-local'));if(editor.draft.triggerType==='cron')fields.push(field('cron',`Cron schedule · ${editor.draft.timezone}`,editor.draft.cron));if(editor.draft.triggerType==='event')fields.push(field('eventKind','Event name',editor.draft.eventKind));}else if(editor){fields.push(field('message','Reminder',editor.draft.message));if(!editor.row||editor.row.record.definition.cadence?.kind==='once')fields.push(field('due',`Due · ${timeZone()}`,editor.draft.due,'datetime-local'));}
  return {...workflow,cards,newFlow:()=>{creating=true;detail=null;editor=null;publish();},listToggles:false,automation:{
   filters:filters.map(name=>({name:filterNames[name],selected:filter===name,pick:()=>{filter=name;publish();}})),loading:state==='loading',stale:loadedSession!==null&&loadedSession!==currentSession,empty,emptyLabel:filter==='all'?'No automations yet':`No ${filterNames[filter].toLowerCase()} here`,message,issues,refresh:()=>void refresh(),busy:!!controller,managementCards:workflow.managementCards||[],history,
   detail:!!(detail||editor||creating),title:creating?'New automation':editor?(editor.row?'Edit ':'New ')+editor.kind:detail?.title||'',close,creating,agentUnavailable:!!controller||!!automationBlock(),workflowDescription:automationBlock()||'Build reviewed steps on this agent. Runs only when you start it',promptDescription:automationBlock()||'Save paused, then review its schedule',agentReminderUnavailable:!!controller||!!reminderBlock(),agentReminderDescription:reminderBlock()||'A one-time in-app reminder on this agent',saveDisabled:!!controller||!!editor&&!!(editor.kind==='reminder'?reminderBlock():automationBlock()),createWorkflow:()=>{if(controller)return;const blocked=automationBlock();if(blocked){message=blocked;publish();return;}creating=false;render(value,current).newFlow();publish();},createPrompt:()=>create('prompt'),createReminder:()=>create('reminder'),createDeviceReminder:newDeviceReminder,
   editing:!!editor,fields,save,saveLabel:editor?.kind==='prompt'&&!editor.row?'Save paused':'Save',prompt:editor?.kind==='prompt',scheduleKinds:['once','cron','event'].map(kind=>({label:kind==='once'?'Once':kind==='cron'?'Recurring':'On event',selected:editor?.kind==='prompt'&&editor.draft.triggerType===kind,pick:()=>{if(editor?.kind==='prompt'&&!controller){editor.draft.triggerType=kind as PromptDraft['triggerType'];publish();}}})),
   description:detail?.description||'',source:detail?.source||'',schedule:detail?.schedule||'',status:detail?.status||'',actions,locked:selectedLocked,
   review:!!review,reviewLabel:review?.label||'',confirm:()=>{const selected=review;if(selected){review=null;void work(selected.run,selected.key);}},cancelReview:()=>{review=null;publish();},
  }};
 };
 const mount=p.componentDidMount,unmount=p.componentWillUnmount;
 p.componentDidMount=function(){mount.call(this);owner=this;session=binding()?.sessionId||null;this.automationConnection=connectionController.subscribe(()=>{const next=binding()?.sessionId||null;if(next!==session||connectionController.getSnapshot().open){session=next;homeCache=null;retire(true);}});this.automationSuspend=()=>{suspended=true;homeCache=null;retire(true);};this.automationResume=()=>{suspended=false;publish();};this.automationVisibility=()=>document.hidden?this.automationSuspend():this.automationResume();document.addEventListener('visibilitychange',this.automationVisibility);window.addEventListener('pagehide',this.automationSuspend);window.addEventListener('pageshow',this.automationResume);};
 p.componentWillUnmount=function(){this.automationConnection?.();document.removeEventListener('visibilitychange',this.automationVisibility);window.removeEventListener('pagehide',this.automationSuspend);window.removeEventListener('pageshow',this.automationResume);suspended=true;retire(true);owner=null;unmount.call(this);};
}
