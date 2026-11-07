import {reminderDeliveryLabel,reminderDue} from "../../../../.eliza/client-features/packages/ui/src/utils/reminder-presentation";
import {formatSchedule} from '../../../../.eliza/client-features/packages/ui/src/utils/cron-format.ts';
/** Alpha presentation over OG's canonical automation, ScheduledTask and LifeOps contracts.
 * No runner, mirroring, task storage or automatic execution lives in this client. */
import type {AutomationsMethod} from './automations-route-policy.ts';
export type AutomationRequest = (path:string,method:AutomationsMethod,body:unknown|undefined,signal:AbortSignal)=>Promise<unknown>;
export type AutomationKind = 'workflow'|'prompt'|'schedule'|'reminder'|'device-reminder';
type ObjectValue = Record<string,any>;
export interface AutomationRow {
 key:string;id:string;kind:AutomationKind;title:string;description:string;status:string;enabled:boolean;
 source:string;schedule:string;record:ObjectValue;workflowId?:string;triggerId?:string;occurrenceId?:string;
}
export interface AutomationIssue {source:'automations'|'schedules'|'reminders'|'device';message:string;unavailable:boolean}
export interface AutomationSnapshot {rows:AutomationRow[];issues:AutomationIssue[]}
export interface PromptDraft {title:string;instructions:string;triggerType:'once'|'cron'|'event';scheduledAt:string;cron:string;eventKind:string;timezone:string;originalScheduledAt?:string;originalEnabled?:boolean}
export interface ReminderDraft {message:string;due:string;timezone:string;idempotencyKey:string}
export type ScheduledVerb = 'snooze'|'skip'|'complete'|'dismiss'|'escalate'|'acknowledge'|'edit'|'reopen'|'fire';
const object=(value:unknown):ObjectValue=>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid automation response.');return value as ObjectValue;};
const text=(value:unknown):string=>typeof value==='string'?value:'';
export function automationId(value:unknown):string {const id=text(value);if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id)||id.includes('..'))throw Error('Automation identity is unavailable.');return id;}
const list=(value:unknown):unknown[]=>{if(!Array.isArray(value))throw Error('Invalid automation list.');return value;};
export class AutomationOutcomeError extends Error {readonly outcomeKnown=true;}
// Since elizaOS/eliza #trigger-routes (pin 4557621650) the agent refuses PUT that enables a paused
// trigger with 429 once its active-trigger limit is reached, before changing anything. A 429 alone
// stays an unknown outcome (a proxy may answer 429 after the agent applied the write), so enable
// re-reads the trigger: still paused means a known refusal, enabled means the write landed.
export const AUTOMATION_LIMIT_MESSAGE='This automation was not enabled. The agent is at its limit of active automations or is busy; pause another automation or try again later.';
/** Native datetime-local controls use the browser's zone; stored instants keep their zone. */
export function automationLocalDateInput(stamp:string|number):string{const date=new Date(stamp);return Number.isFinite(date.getTime())?new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16):'';}
function localDate(value:string):Date{
 const fields=/^(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value),date=new Date(value);
 if(!fields||!Number.isFinite(date.getTime()))throw Error('Choose a valid local date and time.');
 const expected=fields.slice(1,7).map(part=>Number(part||0)),actual=[date.getFullYear(),date.getMonth()+1,date.getDate(),date.getHours(),date.getMinutes(),date.getSeconds()];
 if(expected.some((part,index)=>part!==actual[index])||date.getMilliseconds()!==Number((fields[7]||'').padEnd(3,'0')))throw Error('This local time does not exist. Choose another time.');
 return date;
}
/** One instant label for every list row ("Oct 29, 2026, 6:00 PM"), in the record's zone when it names a valid one. */
export function automationWhen(stamp:string|number,zone?:string):string{const date=new Date(stamp);if(!Number.isFinite(date.getTime()))return '';const options:Intl.DateTimeFormatOptions={year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'};try{return date.toLocaleString(undefined,{...options,...(zone?{timeZone:zone}:{})});}catch{return date.toLocaleString(undefined,options);}}
function schedule(value:unknown):string {
 const t=object(value);switch(t.triggerType??t.kind){
  case 'once':return automationWhen(Date.parse(text(t.scheduledAtIso??t.atIso??t.dueAt)),text(t.timezone??t.tz).trim()||undefined)||'Once';
  case 'cron': {
   const expression=text(t.cronExpression??t.expression).trim(),description=expression?formatSchedule(expression):'';
   let zone=text(t.timezone??t.tz).trim();
   if(zone){try{new Intl.DateTimeFormat('en',{timeZone:zone});}catch{zone+=' (unrecognized time zone)';}}
   return [description?(description===expression?'Cron: '+expression:description):'Schedule unavailable',zone||'Time zone not specified'].join(' · ');
  }
  case 'interval':return t.everyMinutes?`Every ${t.everyMinutes} minutes`:t.intervalMs?`Every ${t.intervalMs/60000} minutes`:'Interval';
  case 'event':return `On ${text(t.eventKind)||'event'}`;
  case 'manual':return 'Manual';
  case 'relative_to_anchor':return text(t.anchorKey)||'Relative schedule';
  case 'during_window':return text(t.windowKey)||'Scheduled window';
  case 'after_task':return 'After another task';
  default:return '';
 }
}
function automation(value:unknown):AutomationRow {
 const row=object(value),id=automationId(row.id);if(typeof row.enabled!=='boolean'||typeof row.title!=='string'||!['workflow','coordinator_text','automation_draft'].includes(row.type))throw Error('Invalid automation record.');
 const workflowId=row.workflowId===undefined?undefined:automationId(row.workflowId),triggerId=row.triggerId===undefined?undefined:automationId(row.triggerId);
 return {key:id,id,kind:row.type==='workflow'?'workflow':'prompt',title:row.title,description:text(row.description),status:text(row.status),enabled:row.enabled,source:row.system?'System automation':'Agent automation',schedule:list(row.schedules).map(schedule).filter(Boolean).join(' · '),record:row,...(workflowId?{workflowId}:{}),...(triggerId?{triggerId}:{})};
}
function scheduled(value:unknown):AutomationRow {
 const row=object(value),id=automationId(row.taskId),state=object(row.state),trigger=object(row.trigger);
 if(row.ownerVisible!==true)throw Error('An unlisted scheduled item was returned.');
 const labels:Record<string,string>={gm:'Good morning',gn:'Good night',checkin:'Daily check-in','weekly-review':'Weekly review'};
 const title=labels[text(row.metadata?.recordKey)]||text(row.metadata?.slot)||text(row.kind)||'Scheduled task';
 return {key:'scheduled:'+id,id,kind:'schedule',title,description:text(row.promptInstructions),status:trigger.kind==='manual'?'paused':text(state.status),enabled:trigger.kind!=='manual'&&!['completed','skipped','expired','failed','dismissed'].includes(state.status),source:'Agent schedule',schedule:schedule(trigger),record:row};
}
function reminder(value:unknown):AutomationRow {
 const row=object(value),definition=object(row.definition),id=automationId(definition.id),occurrence=row.occurrence?object(row.occurrence):null;
 const presentation={definition:row.definition,occurrence:row.occurrence??null,latestAttempt:row.latestAttempt??null},due=reminderDue(presentation);
 return {key:'reminder:'+id,id,kind:'reminder',title:text(definition.title)||'Reminder',description:text(definition.description),status:reminderDeliveryLabel(presentation),enabled:definition.status==='active',source:'Agent reminder',schedule:due?automationWhen(due,text(definition.timezone)||undefined):'No upcoming occurrence',record:row,...(occurrence?{occurrenceId:automationId(occurrence.id)}:{})};
}
export function automationIssue(source:AutomationIssue['source'],error:unknown):AutomationIssue {
 const status=error&&typeof error==='object'&&'status' in error?Number(error.status):0;
 const name={automations:'Automations',schedules:'Scheduled items',reminders:'Agent reminders',device:'Device reminders'}[source];
 const unavailable=status===404||status===501;
 return {source,unavailable,message:unavailable?`${name} are not available on this agent.`:status===401||status===403?`${name} require the original owner connection.`:`${name} could not refresh. Retry to check the current records.`};
}
/** Merge for display only. Namespaced canonical IDs never write across stores. */
export function mergeAutomationRows(rows:AutomationRow[]):AutomationRow[] {
 const records=new Map<string,AutomationRow>();for(const row of rows)if(!records.has(row.key))records.set(row.key,row);
 return [...records.values()].sort((a,b)=>Number(b.enabled)-Number(a.enabled)||a.title.localeCompare(b.title));
}
export class AutomationsProtocol {
 constructor(private request:AutomationRequest){}
 async list(signal:AbortSignal):Promise<AutomationSnapshot>{
  const sources=[['automations','/api/automations','automations',automation],['schedules','/api/lifeops/scheduled-tasks?ownerVisibleOnly=1','tasks',scheduled],['reminders','/api/lifeops/reminders','reminders',reminder]] as const;
  const results=await Promise.allSettled(sources.map(async([source,path,key,parse])=>{const data=object(await this.request(path,'GET',undefined,signal));return {rows:list(data[key]).map(parse),issue:source==='automations'&&(text(data.workflowFetchError)||(Array.isArray(data.executionFetchErrors)&&data.executionFetchErrors.length))?{source:'automations' as const,unavailable:false,message:'Some workflow data or execution history could not refresh. Open the workflow to check it before running.'}:null};}));
  signal.throwIfAborted();const rows:AutomationRow[]=[],issues:AutomationIssue[]=[];
  results.forEach((result,index)=>{if(result.status==='fulfilled'){rows.push(...result.value.rows);if(result.value.issue)issues.push(result.value.issue);}else issues.push(automationIssue(sources[index][0],result.reason));});
  return {rows:mergeAutomationRows(rows),issues};
 }
 async prompt(id:string,signal:AbortSignal):Promise<ObjectValue>{const result=object(await this.request('/api/triggers/'+automationId(id),'GET',undefined,signal)),trigger=object(result.trigger);if(automationId(trigger.id)!==id)throw Error('Prompt identity changed.');return trigger;}
 async promptRuns(id:string,signal:AbortSignal):Promise<unknown[]>{return list(object(await this.request('/api/triggers/'+automationId(id)+'/runs','GET',undefined,signal)).runs);}
 async savePrompt(draft:PromptDraft,signal:AbortSignal,id?:string):Promise<void>{
  const title=draft.title.trim(),instructions=draft.instructions.trim();if(!title||!instructions)throw Error('Add a name and instructions.');
  const request:ObjectValue={kind:'prompt',displayName:title,instructions,triggerType:draft.triggerType,timezone:draft.timezone};
  if(draft.triggerType==='once'){const unchanged=!!id&&!!draft.originalScheduledAt&&draft.scheduledAt===automationLocalDateInput(draft.originalScheduledAt),date=unchanged?new Date(draft.originalScheduledAt!):localDate(draft.scheduledAt);if(!Number.isFinite(date.getTime())||(date.getTime()<=Date.now()&&!(unchanged&&draft.originalEnabled===false)))throw Error('Choose a future time.');request.scheduledAtIso=unchanged?draft.originalScheduledAt:date.toISOString();}
  else if(draft.triggerType==='cron'){if(!draft.cron.trim())throw Error('Add a cron schedule.');request.cronExpression=draft.cron.trim();}
  else {if(!draft.eventKind.trim())throw Error('Add an event name.');request.eventKind=draft.eventKind.trim();}
  if(!id)Object.assign(request,{wakeMode:'inject_now',enabled:false});
  const result=object(await this.request(id?'/api/triggers/'+automationId(id):'/api/triggers',id?'PUT':'POST',request,signal)),trigger=object(result.trigger);automationId(trigger.id);
  if((id&&trigger.id!==id)||trigger.displayName!==title||trigger.instructions!==instructions||(!id&&trigger.enabled!==false))throw Error('Prompt save was not confirmed. Check this agent before saving again.');
 }
 async setPromptEnabled(id:string,enabled:boolean,signal:AbortSignal){
  let response:unknown;
  try{response=await this.request('/api/triggers/'+automationId(id),'PUT',{enabled},signal);}
  catch(error){
   if(!enabled||!error||typeof error!=='object'||!('status' in error)||Number(error.status)!==429)throw error;
   let current:ObjectValue;try{current=await this.prompt(id,signal);}catch{throw error;}
   if(current.id===id&&current.enabled===true)return;
   if(current.id===id&&current.enabled===false)throw new AutomationOutcomeError(AUTOMATION_LIMIT_MESSAGE);
   throw error;
  }
  const result=object(response),trigger=object(result.trigger);if(trigger.id!==id||trigger.enabled!==enabled)throw Error('Prompt state was not confirmed.');}
 async deletePrompt(id:string,signal:AbortSignal){if(object(await this.request('/api/triggers/'+automationId(id),'DELETE',undefined,signal)).ok!==true)throw Error('Prompt deletion was not confirmed.');}
 async runPrompt(id:string,signal:AbortSignal){const result=object(await this.request('/api/triggers/'+automationId(id)+'/execute','POST',{},signal)),run=object(result.result);if(result.ok!==true||!['success','error','skipped'].includes(run.status))throw Error('Prompt execution was not confirmed.');if(run.status!=='success')throw new AutomationOutcomeError(text(run.error)||'The prompt did not run. Check its execution history.');return result;}
 async scheduledVerb(id:string,verb:ScheduledVerb,signal:AbortSignal):Promise<unknown>{
  const result=object(await this.request('/api/lifeops/scheduled-tasks/'+automationId(id)+'/'+verb,'POST',verb==='snooze'?{minutes:60}:{},signal));
  if(verb==='fire'){const fire=object(result.fire);if(!['fired','raced','skipped','dispatch_deferred','dispatch_failed'].includes(fire.kind))throw Error('Scheduled execution was not confirmed.');if(!['fired','raced'].includes(fire.kind))throw new AutomationOutcomeError(text(fire.reason)||text(fire.error)||'This item did not run. Read its current status before trying again.');}
  else if(object(result.task).taskId!==id)throw Error('Scheduled change was not confirmed.');
  return result;
 }
 async createReminder(draft:ReminderDraft,signal:AbortSignal):Promise<void>{
  const title=draft.message.trim(),due=localDate(draft.due);if(!title||due.getTime()<=Date.now())throw Error('Add a reminder and a future time.');
  const result=object(await this.request('/api/lifeops/definitions','POST',{idempotencyKey:draft.idempotencyKey,kind:'habit',title,timezone:draft.timezone,cadence:{kind:'once',dueAt:due.toISOString(),visibilityLeadMinutes:0},metadata:{ownerSurface:'OWNER_REMINDERS',nativeProjection:'in_app_only'},reminderPlan:{steps:[{channel:'in_app',offsetMinutes:0,label:'Notify'}]}},signal));
  if(!object(result.definition).id)throw Error('Reminder creation was not confirmed.');
 }
 async editReminder(row:AutomationRow,message:string,due:string,signal:AbortSignal){
  if(row.kind!=='reminder'||!message.trim())throw Error('Add a reminder message.');const definition=object(row.record.definition),payload:ObjectValue=definition.cadence?.kind==='once'&&definition.metadata?.ownerSurface==='OWNER_REMINDERS'&&text(definition.description).trim()?{description:message.trim()}:{title:message.trim()};
  if(definition.cadence?.kind==='once'&&due&&due!==automationLocalDateInput(reminderDue({definition:row.record.definition,occurrence:row.record.occurrence??null,latestAttempt:row.record.latestAttempt??null})||definition.cadence.dueAt)){const date=localDate(due);if(date.getTime()<=Date.now())throw Error('Choose a future time.');payload.cadence={...definition.cadence,dueAt:date.toISOString()};}
  const result=object(await this.request('/api/lifeops/definitions/'+automationId(row.id),'PUT',payload,signal)),saved=object(result.definition);if(saved.id!==row.id||Object.entries(payload).some(([field,value])=>field!=='cadence'&&saved[field]!==value)||(payload.cadence&&saved.cadence?.dueAt!==payload.cadence.dueAt))throw Error('Reminder edit was not confirmed.');
 }
 async cancelReminder(id:string,signal:AbortSignal){const definition=object(object(await this.request('/api/lifeops/definitions/'+automationId(id),'PUT',{status:'archived'},signal)).definition);if(definition.id!==id||definition.status!=='archived')throw Error('Reminder cancellation was not confirmed.');}
 async snoozeReminder(id:string,signal:AbortSignal){if(object(object(await this.request('/api/lifeops/occurrences/'+automationId(id)+'/snooze','POST',{minutes:10},signal)).occurrence).id!==id)throw Error('Reminder snooze was not confirmed.');}
}
