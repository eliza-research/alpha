import type {PluginListenerHandle} from '@capacitor/core';
import {resolveNoticeTap,type NoticeTapNotice,type PendingNoticeTap} from '../../../../.eliza/client-features/packages/contracts/src/notice-routes.ts';
import type {WorkflowNoticeRoute} from './device-actions';
import type {WorkflowRun,RemoteWorkflow} from './workflow-protocol';
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
