import type {PluginListenerHandle} from '@capacitor/core';
import {resolveNoticeTap,type NoticeTapNotice,type PendingNoticeTap} from '../../../../.eliza/client-features/packages/contracts/src/notice-routes.ts';
import type {WorkflowNoticeRoute} from './device-actions';
import type {WorkflowRun,RemoteWorkflow} from './workflow-protocol';
import {workflowApprovalNotice,type WorkflowPhoneReview} from './workflow-device-contract';
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
/** A 404 or an identity mismatch means the notice can never become valid again; anything else may be transient. */
export function definiteNoticeFailure(error:unknown):boolean{
 return (error as {status?:unknown})?.status===404||/identity|enrollment|mismatch/i.test(String((error as {message?:unknown})?.message??''));
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
  const flows=(await session.list(signal)).filter(flow=>!flow.removed&&!!flow.phoneSpec);
  if(!session.current())return;
  for(const flow of flows){
   try{
    for(const run of await session.executions(flow.id,signal)){
     // Every unfinished run is read, not only those labelled waiting-approval, so a notice an open receipt posted
     // is never withdrawn while its step is still pending.
     if(run.finished)continue;
     const review=await session.phoneReview(run,signal);if(review.finished||review.cancellationRequestedAt)continue;
     const route=session.route(run);
     for(const step of await session.pending(review,signal)){if(!(step.expiresAt>now()))continue;const {id,bindingHash}=await workflowApprovalNotice(route,step.id);found.push({route,id,bindingHash,expiresAt:step.expiresAt});nextWaiting.add(flow.id);}
    }
   }catch(error){if(!session.current())return;if(!definiteNoticeFailure(error))unread.add(flow.id);}
  }
  if(!session.current())return;
  // A workflow that could not be read keeps its last state, as its notices do.
  if(waitingIdentity===session.identity)for(const id of unread)if(waiting.has(id))nextWaiting.add(id);
  waiting=nextWaiting;waitingIdentity=session.identity;options.changed();
  const live=new Set(flows.map(flow=>flow.id)),stale=[...posted].filter(([id,notice])=>notice.identity===session.identity&&!found.some(entry=>entry.id===id)&&(!live.has(notice.workflowId)||!unread.has(notice.workflowId))).map(([id])=>id);
  // Another owner's notices are fenced natively (NoticeOwnerCoordinator); this process stops tracking them.
  for(const [id,notice] of posted)if(notice.identity!==session.identity)posted.delete(id);
  await new Promise<void>(resolve=>options.enqueue(async()=>{
   try{
    const native=options.native();
    for(const id of stale){try{await native.withdrawWorkflowApprovalNotice({id});posted.delete(id);}catch{/* Retried on the next sweep; it also expires with the approval. */}}
    for(const entry of found){if(!session.current())return;try{await native.postWorkflowApprovalNotice(entry);remember(entry.id,session.identity,entry.route.workflowId);}catch{/* The step stays waiting in Workflows. */}}
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
