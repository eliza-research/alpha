import type {PluginListenerHandle} from '@capacitor/core';
import {resolveNoticeTap,type NoticeTapNotice,type PendingNoticeTap} from '../../../../.eliza/client-features/packages/contracts/src/notice-routes.ts';
import type {WorkflowNoticeRoute} from './device-actions';
import type {WorkflowRun,RemoteWorkflow} from './workflow-protocol';
import {
 parseWorkflowPhoneReview as parseSharedPhoneReview,
 workflowApprovalNotice,
 parseWorkflowReminderRead,
 validateWorkflowReadResult,
 workflowId,
 type WorkflowPhoneReview,
 type WorkflowReadOperation,
 type WorkflowReadResult,
 type WorkflowReminderReadOperation,
 type WorkflowReminderRow,
} from '../../../../.eliza/client-features/packages/contracts/src/workflow-device.ts';
import {browserDevProfile} from '../browser/dev-profile';
/** Workflow data scopes are the shared `@elizaos/contracts/workflow-device` contract: reviewed read
 * operations and results, the run's phone review and the step-request check. Alpha only keeps the
 * development enrollment labels (test-mocks builds only) through its spec normalizer. */
export {
 SELECTED_REMINDERS_WINDOW,
 assertWorkflowOperation,
 parseWorkflowBinding,
 parseWorkflowRead,
 parseWorkflowReminderRead,
 workflowApprovalNotice,
 workflowBytes,
 workflowId,
 workflowObject,
 workflowSha,
} from '../../../../.eliza/client-features/packages/contracts/src/workflow-device.ts';
export type {
 WorkflowDeviceBinding,
 WorkflowDeviceTarget,
 WorkflowPhoneReview,
 WorkflowReadOperation,
 WorkflowReadResult,
 WorkflowReminderReadOperation,
 WorkflowReminderRow,
} from '../../../../.eliza/client-features/packages/contracts/src/workflow-device.ts';
/** Preserve existing public dev enrollment labels without broadening native identifiers. */
export function workflowEnrollmentId(value:unknown):string{if(browserDevProfile&&typeof value==='string'&&/^development-cloud\.(first|second)-enrollment$/.test(value))return value;return workflowId(value);}
/** Validates a phone read result against its reviewed scope before any model sees it. */
export const validateWorkflowResult=(operation:WorkflowReadOperation,value:unknown):Promise<WorkflowReadResult>=>validateWorkflowReadResult(operation,value);
/** Validates a phone reminder read against its reviewed owner-day window. */
export async function validateWorkflowReminderResult(operation:WorkflowReminderReadOperation,value:unknown):Promise<{kind:'reminders';reminders:WorkflowReminderRow[]}>{
 const result=await validateWorkflowReadResult(parseWorkflowReminderRead(operation),value);
 if(result.kind!=='reminders')throw new Error('Workflow phone scope could not be verified');
 return result;
}
export async function parseWorkflowPhoneReview(value:unknown,expected:{id:string;workflowId:string;versionId:string}):Promise<WorkflowPhoneReview>{
 const {normalizePhoneSpec}=await import('./phone-workflow-authoring');
 return parseSharedPhoneReview(value,expected,{normalizePhoneSpec:spec=>normalizePhoneSpec(spec) as never});
}

// workflow-notice-coordination:begin
/** A pending tap of one of Alpha's workflow notices (native NoticeRoutes with workflowId, runId and versionId). */
export interface WorkflowTap extends WorkflowNoticeRoute {token:string;operationId:string;bindingHash:string;retained:boolean;question?:boolean;notice?:NoticeTapNotice}
export interface WorkflowTapNative {
 pendingWorkflowTap():Promise<Partial<WorkflowTap>>;
 /** `discard` returns an explicitly canceled Ask tap to its untapped state; it opens and fills nothing. */
 consumeWorkflowTap(input:{token:string;noticeRevision?:string;discard?:boolean}):Promise<void>;
 addListener(event:'pendingWorkflowTap',listener:()=>void):Promise<PluginListenerHandle>;
}
export interface WorkflowTapBinding {
 scope:string;origin:string;ownerId:string;agentId:string;
 current():boolean;
 receipt(runId:string,workflowId:string,signal:AbortSignal):Promise<WorkflowRun>;
 detail(workflowId:string,signal:AbortSignal):Promise<RemoteWorkflow>;
}
/** Only an authenticated read can open a tap (shared resolveNoticeTap). Never starts, retries or approves a run. */
export async function resolveWorkflowTap(native:Pick<WorkflowTapNative,'pendingWorkflowTap'>,binding:WorkflowTapBinding|null,signal:AbortSignal){
 const result=await resolveNoticeTap({pending:()=>native.pendingWorkflowTap() as Promise<Partial<PendingNoticeTap>>,binding,identifiers:['workflowId','runId','versionId'],signal,
  load:async(tap,signal,checkpoint)=>{
   const runId=tap.runId as string,workflowId=tap.workflowId as string;
   const run=await binding!.receipt(runId,workflowId,signal);checkpoint();
   if(run.id!==runId||run.workflowId!==workflowId||run.versionId!==tap.versionId)return null;
   const workflow=await binding!.detail(workflowId,signal);checkpoint();
   return workflow.id===workflowId?{run,workflow}:null;
  }});
 return result.kind==='ready'?{kind:'ready' as const,token:result.token,run:result.target.run,workflow:result.target.workflow,question:result.question,notice:result.notice}:result;
}
/** The current enrolled workflow session. `pending` is the redacted notice read: proposal ids and expiries only, never an executable review. */
export interface ApprovalPosterSession {
 identity:string;
 current():boolean;
 route(run:WorkflowRun):WorkflowNoticeRoute;
 list(signal:AbortSignal):Promise<RemoteWorkflow[]>;
 executions(id:string,signal:AbortSignal):Promise<WorkflowRun[]>;
 phoneReview(run:WorkflowRun,signal:AbortSignal):Promise<WorkflowPhoneReview>;
 pending(review:WorkflowPhoneReview,signal:AbortSignal):Promise<Array<{id:string;expiresAt:number}>>;
}
export interface ApprovalPosterNative {
 postWorkflowApprovalNotice(input:{id:string;bindingHash:string;expiresAt:number;route:WorkflowNoticeRoute}):Promise<{status:string}>;
 withdrawWorkflowApprovalNotice(input:{id:string}):Promise<void>;
}
/** Only the endpoint's explicit missing-resource status proves an old notice cannot resolve. */
export function definiteNoticeFailure(error:unknown):boolean{
 return (error as {status?:unknown})?.status===404;
}
/**
 * Finds phone steps waiting for approval in any run (owner-, schedule- or agent-started) and posts one redacted
 * notice per step through the same identity and native ledger as an open receipt. A tap still opens the exact run,
 * where the step is reviewed. Notices whose step is no longer pending are withdrawn; a failed withdrawal is retried.
 * Runs only while Alpha's process does: a killed process posts nothing.
 */
export function createWorkflowApprovalPoster(options:{session:()=>ApprovalPosterSession|null;native:()=>ApprovalPosterNative;enqueue:(work:()=>Promise<void>)=>void;changed:()=>void;now?:()=>number}){
 const now=options.now??(()=>Date.now());
 /** Notices this process posted or saw posted, by notice id. */
 const posted=new Map<string,{identity:string;workflowId:string}>();
 let waiting=new Set<string>(),waitingIdentity='',running:Promise<void>|null=null,again=false,last={identity:'',at:-Infinity};
 const remember=(id:string,identity:string,workflowId:string)=>{posted.set(id,{identity,workflowId});};
 const forget=(id:string)=>{posted.delete(id);};
 async function sweep(session:ApprovalPosterSession){
  const signal=new AbortController().signal,found:Array<{route:WorkflowNoticeRoute;id:string;bindingHash:string;expiresAt:number}>=[],unread=new Set<string>(),nextWaiting=new Set<string>();
  const flows=await session.list(signal);
  if(!session.current())return;
  // A current definition can lose its phone steps while an older immutable version still waits.
  // Recheck known notices even if their workflow no longer appears in the current list.
  const workflowIds=new Set(flows.map(flow=>flow.id));
  for(const notice of posted.values())if(notice.identity===session.identity)workflowIds.add(notice.workflowId);
  for(const workflowId of workflowIds){
   try{
    for(const run of await session.executions(workflowId,signal)){
     if(!session.current())return;
     // Every unfinished run is read, not only those labelled waiting-approval, so a notice an open receipt posted
     // is never withdrawn while its step is still pending.
     if(run.finished)continue;
     const review=await session.phoneReview(run,signal);if(!session.current())return;if(review.finished||review.cancellationRequestedAt)continue;
     const route=session.route(run);
     for(const step of await session.pending(review,signal)){if(!(step.expiresAt>now()))continue;const {id,bindingHash}=await workflowApprovalNotice(route,step.id);found.push({route,id,bindingHash,expiresAt:step.expiresAt});nextWaiting.add(workflowId);}
    }
   }catch(error){if(!session.current())return;if(!definiteNoticeFailure(error))unread.add(workflowId);}
  }
  if(!session.current())return;
  // A workflow that could not be read keeps its last state, as its notices do.
  if(waitingIdentity===session.identity)for(const id of unread)if(waiting.has(id))nextWaiting.add(id);
  waiting=nextWaiting;waitingIdentity=session.identity;options.changed();
  const stale=[...posted].filter(([id,notice])=>notice.identity===session.identity&&!found.some(entry=>entry.id===id)&&!unread.has(notice.workflowId)).map(([id])=>id);
  // Another owner's notices are fenced natively (NoticeOwnerCoordinator); this process stops tracking them.
  for(const [id,notice] of posted)if(notice.identity!==session.identity)posted.delete(id);
  await new Promise<void>(resolve=>options.enqueue(async()=>{
   try{
    if(!session.current())return;
    const native=options.native();
    for(const id of stale){if(!session.current())return;try{await native.withdrawWorkflowApprovalNotice({id});if(!session.current())return;posted.delete(id);}catch{/* Retried on the next sweep; it also expires with the approval. */}}
    for(const entry of found){if(!session.current())return;try{await native.postWorkflowApprovalNotice(entry);if(!session.current())return;remember(entry.id,session.identity,entry.route.workflowId);}catch{/* The step stays waiting in Workflows. */}}
   }finally{resolve();}
  }));
 }
 /** Connection updates can arrive in bursts; a sweep for the same session at most every 5 s unless forced. */
 const poll=(force=false):Promise<void>=>{
  if(running){again=true;return running;}
  const session=options.session();if(!session)return Promise.resolve();
  if(!force&&last.identity===session.identity&&now()-last.at<5_000)return Promise.resolve();
  last={identity:session.identity,at:now()};
  running=sweep(session).catch(()=>{/* Retried on the next tick. */}).finally(()=>{running=null;if(again){again=false;void poll(true);}});
  return running;
 };
 return {
  poll,remember,forget,
  /** True when the last sweep for this session found a phone step waiting for the owner. */
  waiting:(identity:string|undefined,workflowId:string)=>!!identity&&identity===waitingIdentity&&waiting.has(workflowId),
 };
}
