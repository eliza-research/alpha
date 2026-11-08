import {reviewWorkflowNoticeQuestion} from './workflow-notice-question';
import {NoticeOwnerCoordinator,revalidateWorkflowApprovalNotice} from '../../../../.eliza/client-features/packages/contracts/src/notice-routes.ts';
import {WorkflowIntentStore,workflowIntentKey} from '../runtime/workflow-intents';
import {Capacitor} from '@capacitor/core';
import {registerPlugin} from '../platform-plugins';
import {resolveWorkflowTap,type WorkflowTapNative} from '../runtime/workflow-notice-taps';
import { createWorkflowAuthoring } from './workflow-authoring';
import { presentHomeWorkflowFreshness } from './home-cards';
import { alphaClient, type ActionProposal } from '../runtime/alpha-client';
import { workflowApprovalNotice, type WorkflowPhoneReview } from '../runtime/workflow-device-contract';
import type { WorkflowNoticeRoute } from '../runtime/device-actions';
import { connectionController, agentAvailabilityNotice, residentAlwaysPresent } from '../runtime/connection-ui';
import { testMocksEnabled } from '../build-flags';
import { WorkflowAdmissionRejected, WorkflowMetadataRejected, WorkflowLifecycleRejected, WorkflowActivationRejected, type RemoteWorkflow, type WorkflowRun, type WorkflowApproval, type WorkflowApprovalReceipt } from '../runtime/workflow-protocol';
import { describePhoneTrigger, normalizePhoneSpec, phoneTriggerClockChangeNote, type PhoneTimeTrigger } from '../runtime/phone-workflow-authoring';
type Bag=Record<string,any>;
// Run-state policy stays local to this module (its boundary fixtures evaluate it without imports).
/** An interrupted run whose effects cannot be known. The agent does not replay it; neither does this phone. */
const runOutcomeUnknown=(run:WorkflowRun)=>!run.finished&&run.reconciliation?.state==='outcome-unknown';
/** A worker that outlived its host is still being reconciled by the agent. */
const runWorkerRunning=(run:WorkflowRun)=>!run.finished&&run.reconciliation?.state==='worker-running';
/** Typed phone operations that only read selected sources or draft text. Writes, notifications and speech are excluded. */
const READ_ONLY_PHONE_OPERATIONS:ReadonlySet<string>=new Set(['supplied_text','selected_notes','selected_reminders','calendar_range','contains','compose_draft','model_draft']);
/** True only for a typed phone workflow whose every step reads or drafts text (a read-only digest). Hosted digests are excluded: the agent admits them only at their scheduled occurrence. */
function readOnlyDigestWorkflow(workflow:RemoteWorkflow|null|undefined):boolean{
 if(!workflow||workflow.hostedDigest||workflow.removed)return false;
 const spec=workflow.phoneSpec as {trigger?:{kind?:unknown};steps?:unknown}|undefined;
 if(!spec||typeof spec!=='object'||!Array.isArray(spec.steps)||!spec.steps.length||(spec.trigger?.kind!=='manual'&&spec.trigger?.kind!=='time'))return false;
 return spec.steps.every(step=>!!step&&typeof step==='object'&&READ_ONLY_PHONE_OPERATIONS.has(String((step as {operation?:unknown}).operation)));
}
/** A typed phone workflow has a manual trigger only: it starts when the owner chooses Run now and has no schedule. Hosted digests are the only scheduled kind and are managed in Scheduled digests. */
function manualPhoneWorkflow(workflow:RemoteWorkflow|null|undefined):boolean{
 if(!workflow||workflow.hostedDigest)return false;
 const spec=workflow.phoneSpec as {trigger?:{kind?:unknown}}|undefined;
 return !!spec&&typeof spec==='object'&&spec.trigger?.kind==='manual';
}
/** The reviewed local-time trigger of a typed workflow, when it has one. Its schedule runs only while the agent runs. */
function scheduledPhoneTrigger(workflow:RemoteWorkflow|null|undefined):PhoneTimeTrigger|undefined{
 if(!workflow||workflow.hostedDigest||!workflow.phoneSpec)return undefined;
 try{const trigger=normalizePhoneSpec(workflow.phoneSpec).trigger;return trigger.kind==='time'?trigger:undefined;}catch{return undefined;}
}
/** Honest run state. An interrupted worker's effects are unknown; nothing is replayed automatically. */
function workflowRunLabel(run:WorkflowRun):string{
 if(run.occurrence?.status==='missed')return 'Missed — did not run';
 if(run.occurrence?.status==='overlap')return 'Skipped — an earlier run was still active';
 if(runOutcomeUnknown(run))return 'Interrupted — outcome unknown';
 if(runWorkerRunning(run))return 'Worker still running — agent reconciling';
 if(run.finished&&run.reconciliation?.state==='outcome-unknown')return run.status+' · after an interrupted, unknown outcome';
 return run.status;
}
/** Presentation hint only. Exact pinned reviews and existing approval gates still authorize all effects. */
function runHasDeviceSteps(run:WorkflowRun,workflow:RemoteWorkflow|null,review:WorkflowPhoneReview|null):boolean{
 const spec=review?.runId===run.id&&review.workflowId===run.workflowId&&review.versionId===run.versionId?review.spec:workflow?.id===run.workflowId&&workflow.versionId===run.versionId?workflow.phoneSpec as Record<string,any>|undefined:undefined;
 return !!spec?.device&&Array.isArray(spec.steps)&&spec.steps.some((step:Record<string,unknown>)=>['selected_notes','selected_reminders','calendar_range','save_note','app_notification','read_aloud'].includes(String(step?.operation)));
}
/** Existing remote workflows only; prototype trigger objects are never executed. */
export function installWorkflowAdapter(Component:any,views:Bag){
 const view=views.workflows,p=Component.prototype;view.persist=[];view.reply=()=>null;
 let owner:any,api:Bag|undefined,flows:RemoteWorkflow[]=[],detail:RemoteWorkflow|null=null,runs:WorkflowRun[]=[],receipt:WorkflowRun|null=null;
 let phoneReview:WorkflowPhoneReview|null=null,phoneSteps:ActionProposal[]=[],phoneConfirm:string|null=null,phoneStatus='';
 let removedList=false,lifecycleAvailable=false,lifecycleReview=false,unknownReview=false,reviewRerun=false;
 // A retained run request the agent just reported it never admitted (same reviewed version). Only then may the
 // owner send that exact request again; the agent admits a submission ID at most once.
 let unadmitted:{workflowId:string;versionId:string;submissionId:string;raw:string}|null=null,reviewResend=false;
 const lifecycleKey=(id:string)=>lockKey(id)+':lifecycle';
 const lifecycleLocked=(id:string)=>intentStore?.locked(lifecycleKey(id))??true;
 const pendingLifecycle=()=>intentStore?.pendingLifecycle()??[];
 let editor:{id:string;versionId:string;name:string;description:string}|null=null;
 const metadataKey=(id:string)=>lockKey(id)+':metadata';
 const metadataLocked=(id:string)=>intentStore?.locked(metadataKey(id))??true;
 let detailSession:string|null=null, approvalReceipt:WorkflowApprovalReceipt|null=null, approvalReview:{digest:string;approved:boolean}|null=null;
 const approvalKey=(run:WorkflowRun)=>lockKey(run.workflowId)+':approval:'+run.id;
 const approvalLocked=(run:WorkflowRun)=>intentStore?.locked(approvalKey(run))??true;
 let phase='idle',status=agentAvailabilityNotice(),operation:AbortController|null=null,generation=0,reviewRun=false,reviewActivation=false,reviewCancel=false;
 const lockKey=(id:string)=>{const s=connectionController.getSnapshot().session;if(!s)throw new Error('Workflow account unavailable');return workflowIntentKey(s,id);};
 const locked=(id:string)=>intentStore?.locked(lockKey(id))??true;
 let intentStore:WorkflowIntentStore|null=null,recovery:AbortController|null=null;
 let suspended=false,listPhase:'idle'|'loading'|'ready'|'failed'='idle',listSession:string|null=null,listReadAt:number|null=null,homeVisit:string|null=null;
 // Retirement still cancels work, but must not render after document storage is revoked.
 const publish=()=>{if(!suspended&&!document.hidden)owner?.vset('workflows',{remoteWorkflowTick:Date.now()});};
 const authoring=createWorkflowAuthoring(()=>owner,publish,async(id)=>{await open(id);});
 let noticeQuestion:(()=>void)|undefined;
 const clear=(keepList=false)=>{noticeQuestion?.();noticeQuestion=undefined;unadmitted=null;reviewResend=false;intentStore=null;recovery?.abort();recovery=null;authoring.close();phoneReview=null;phoneSteps=[];phoneConfirm=null;phoneStatus='';generation++;operation?.abort();operation=null;editor=null;removedList=false;lifecycleAvailable=false;lifecycleReview=false;unknownReview=false;reviewRerun=false;if(!keepList){flows=[];listPhase='idle';listSession=null;}homeVisit=null;detail=null;detailSession=null;runs=[];receipt=null;approvalReceipt=null;approvalReview=null;reviewRun=false;reviewActivation=false;reviewCancel=false;phase='idle';publish();};
 async function work(task:(client:NonNullable<ReturnType<typeof connectionController.getWorkflowClient>>['client'],signal:AbortSignal,valid:()=>boolean,sessionId:string,intents:WorkflowIntentStore)=>Promise<void>){
  if(operation)return;const binding=connectionController.getWorkflowClient();if(!binding){connectionController.open();return;}
  const controller=new AbortController(),token=++generation;operation=controller;phase='busy';publish();const valid=()=>token===generation&&!controller.signal.aborted&&binding.sessionId===connectionController.getWorkflowClient()?.sessionId;
  const session=connectionController.getSnapshot().session;if(!session){operation=null;return;}const intents=new WorkflowIntentStore(session);intentStore=intents;
  try{await intents.load(controller.signal);if(!valid())return;await task(binding.client,controller.signal,valid,binding.sessionId,intents);}catch(error){if(valid()){status=(error instanceof WorkflowAdmissionRejected||error instanceof WorkflowMetadataRejected||error instanceof WorkflowLifecycleRejected||error instanceof WorkflowActivationRejected)?error.message:'Workflow request unavailable. Refresh history before repeating any run.';api?.toast(status);}}finally{if(valid()){try{await intents.load(controller.signal);}catch{intents.invalidate();}}if(token===generation){operation=null;phase='ready';publish();
   // A change notice that arrived during this operation only invalidated the snapshot. Reload it now, or every
   // request on this workflow would keep reading as an unknown outcome until the workflow is reopened.
   if(intentStore===intents&&intents.stale)refreshIntents();}}
 }
 // Only identity and version cross into agent context. The detail must have
 // been fetched under this still-current authenticated runtime binding.
 p.workflowSelection=function(){
  const binding=connectionController.getWorkflowClient();
  if(authoring.active||this!==owner||this.S().view!=='workflows'||!api?.isActive()||!detail||!detailSession||binding?.sessionId!==detailSession)return undefined;
  if(receipt&&receipt.workflowId!==detail.id)return undefined;
  return receipt?{kind:'workflow-run' as const,id:receipt.id,revision:receipt.versionId}:{kind:'workflow' as const,id:detail.id,revision:detail.versionId};
 };
 let tapBusy=false,tapRequested:{request:'event'|'user';current:()=>boolean}|null=null;
 const notificationNative=()=>registerPlugin<WorkflowTapNative>('AlphaNotifications');
 async function checkNotice(request:'poll'|'event'|'user'='poll'){
  if(noticeQuestion||!owner?.live)return;
  const shell=owner,selected=connectionController.getWorkflowClient(),session=connectionController.getSnapshot().session,epoch=generation,initialView=shell.S().view;
  const current=()=>owner===shell&&!authoring.active&&!editor&&shell.live&&!document.hidden&&!connectionController.getSnapshot().open&&!alphaClient.getState().context.sensitive&&generation===epoch&&shell.S().view===initialView&&selected?.sessionId===connectionController.getWorkflowClient()?.sessionId;
  if(tapBusy){if(request!=='poll'&&(request==='user'||tapRequested?.request!=='user'||!tapRequested.current()))tapRequested={request,current};return;}
  if(!Capacitor.isNativePlatform()||operation||authoring.active||editor||document.hidden||connectionController.getSnapshot().open||alphaClient.getState().context.sensitive)return;
  tapBusy=true;const signal=new AbortController().signal;
  try{
   const native=notificationNative();
   const bound=selected?.scope&&session?{scope:selected.scope,origin:session.origin,ownerId:session.ownerId,agentId:session.agentId,current,receipt:(id:string,workflowId:string,s:AbortSignal)=>selected.client.receipt(id,workflowId,s),detail:(id:string,s:AbortSignal)=>selected.client.detail(id,s)}:null;
   const result=await resolveWorkflowTap(native,bound,signal);
   if(!current())return;
   if(result.kind==='none')return;
   // A failed native probe establishes no retained notification. Resume may precede window focus.
   if(result.kind==='lookup-unavailable'){if(request==='user')shell.toast('Workflow notifications could not be checked. Try again when Alpha is active.');return;}
   if(result.kind!=='ready'){shell.toast(result.kind==='other-account'?'Workflow notification saved. Connect its original agent to open it.':'Workflow notification saved. Its exact execution is unavailable; retry from Workflows.');return;}
   if(result.question){
    noticeQuestion=reviewWorkflowNoticeQuestion({result,current,recheck:()=>resolveWorkflowTap(native,bound,signal),consume:()=>native.consumeWorkflowTap({token:result.token,noticeRevision:result.notice?.revision}),discard:()=>native.consumeWorkflowTap({token:result.token,discard:true}),compose:draft=>shell.api(shell.S().view).composeContentQuestion(draft),report:message=>shell.toast(message),closed:()=>{noticeQuestion=undefined;}});
    return;
   }
   authoring.close();editor=null;phoneReview=null;phoneSteps=[];phoneConfirm=null;phoneStatus='';approvalReceipt=null;approvalReview=null;reviewRun=false;reviewActivation=false;reviewCancel=false;
   detail=result.workflow;detailSession=selected!.sessionId;receipt=result.run;runs=[result.run];phase='ready';
   shell.openView('workflows');publish();
   await native.consumeWorkflowTap({token:result.token});
  }catch{if(current())shell.toast('Workflow notification retained. Retry from Workflows when the agent is available.');}
  finally{tapBusy=false;if(tapRequested){const requested=tapRequested;tapRequested=null;queueMicrotask(()=>void checkNotice(requested.request==='user'&&requested.current()?'user':'event'));}}
 }
 const refreshIntents=()=>{
  const captured=intentStore,epoch=generation;if(!captured)return;captured.invalidate();
  if(operation||suspended||document.hidden)return;
  void captured.load().catch(()=>captured.invalidate()).finally(()=>{if(intentStore===captured&&epoch===generation)publish();});
 };
 const recoverIntents=async()=>{
  const captured=intentStore,epoch=generation;if(!captured||operation||Capacitor.isNativePlatform())return;
  recovery?.abort();const controller=recovery=new AbortController();
  try{const domain=await captured.recoveryDocument(),{openDomainRecovery}=await import('../browser/domain-recovery');if(controller.signal.aborted||captured!==intentStore||epoch!==generation)return;
   openDomainRecovery({capture:signal=>domain.capture(signal),reset:async(expected,signal)=>{await domain.reset(expected,signal);refreshIntents();}},'workflow requests','Browser workflow request recovery','Download pending requests before resetting. An uncertain operation may already have run. Check execution history before repeating it. Reset clears only this agent account’s browser requests; it does not cancel executions, undo changes or revoke approvals. Close older Alpha tabs before continuing.',controller.signal);
  }catch{if(!controller.signal.aborted&&captured===intentStore)api?.toast('Workflow request recovery unavailable. Saved requests remain retained.');}
 };
 const refresh=async()=>{
  if(operation)return;
  listPhase='loading';publish();
  const pending=work(async(client,signal,valid,sessionId)=>{const homeRequest=!owner?.S().view;let available=homeRequest?lifecycleAvailable:await client.lifecycleSupported(signal);const list=removedList?await client.removedWorkflows(signal):await client.list(signal);if(homeRequest&&owner?.S().view==='workflows')available=await client.lifecycleSupported(signal);if(valid()){lifecycleAvailable=available;flows=list;listPhase='ready';listSession=sessionId;listReadAt=Date.now();status=removedList?'Removed workflows — history retained':list.length?'Workflows on this agent':'No workflows on this agent';}}),token=generation;
  await pending;
  if(token===generation&&listPhase==='loading'){listPhase='failed';publish();}
 };
 const syncHome=()=>{
  const snapshot=connectionController.getSnapshot(),binding=connectionController.getWorkflowClient();
  if(!owner?.live||owner.S().view||suspended||document.hidden||snapshot.open||snapshot.busy||alphaClient.getState().context.sensitive||!binding){homeVisit=null;return;}
  if(homeVisit===binding.sessionId||operation)return;
  homeVisit=binding.sessionId;queueMicrotask(()=>{if(owner?.live&&!owner.S().view&&!suspended&&!document.hidden&&!connectionController.getSnapshot().open&&binding.sessionId===connectionController.getWorkflowClient()?.sessionId)void refresh();});
 };
 const values=p.renderVals;
 p.renderVals=function(){
  const out=values.call(this),binding=connectionController.getWorkflowClient(),current=binding?.sessionId===listSession&&listPhase==='ready',saved=current?flows.filter(flow=>!flow.removed&&flow.active):[],rows=saved.slice(0,2);
  const loaded=presentHomeWorkflowFreshness({loadedAt:current?listReadAt:null,now:Date.now(),unified:false});
  // Home lists only enabled workflows (docs/daily-overview.md); with none its card is hidden.
  return {...out,homeWorkflowFreshness:loaded.visible,homeWorkflowDescription:loaded.description,homeWorkflowRows:rows.map(flow=>({name:flow.name,status:''})),homeWorkflowHasRows:rows.length>0,
   homeWorkflowTitle:rows.length?'':!binding?'Connect your agent':listPhase==='failed'?'Couldn’t load workflows':listPhase==='ready'?'No workflows yet':'Loading workflows…',
   homeWorkflowTime:!binding?'Tap to connect':listPhase==='failed'?'Tap to retry':listPhase!=='ready'?'':saved.length>2?`+${saved.length-2} more`:saved.length?'View '+(saved.length===1?'workflow':'workflows'):'',
   homeWorkflowLabel:!binding?'Connect agent for workflows':listPhase==='failed'?'Retry workflows':'Open workflows',
   goFlows:()=>{if(!binding){connectionController.open();return;}if(listPhase==='failed'){void refresh();return;}if(!operation)phase='idle';this.openView('workflows');}
  };
 };

 const open=(id:string)=>work(async(client,signal,valid,sessionId,intents)=>{
  const key=lockKey(id),lifeKey=key+':lifecycle',metaKey=key+':metadata';
  const pendingLife=await intents.read(lifeKey,signal),pendingMetadata=await intents.read(metaKey,signal),retained=await intents.read(key,signal);
  let current=await client.detail(id,signal);
  if(pendingLife){try{const intent=JSON.parse(pendingLife),resolved=await client.reconcileLifecycle(id,intent.versionId,intent.mutationId,intent.operation,signal);if(resolved&&valid()){await intents.acknowledge(lifeKey,pendingLife,signal);current=await client.detail(id,signal);if(valid())api?.toast('Workflow change matched its exact receipt.');}}catch{if(valid())api?.toast('Workflow removal or restore outcome unknown. Another change remains blocked.');}}
  if(pendingMetadata){try{const intent=JSON.parse(pendingMetadata),resolved=await client.reconcileMetadata(id,intent.versionId,intent.mutationId,signal);if(resolved&&valid()){await intents.acknowledge(metaKey,pendingMetadata,signal);current=await client.detail(id,signal);if(valid())api?.toast('Saved change matched its exact mutation receipt.');}}catch{if(valid())api?.toast('Save outcome unknown. Another edit remains blocked until its receipt is confirmed.');}}
  const history=await client.executions(id,signal),available=await client.lifecycleSupported(signal);let notAdmitted:typeof unadmitted=null;
  if(retained){try{const intent=JSON.parse(retained);if(await client.supportsSubmissionReconciliation(signal)&&intent.workflowId===id&&typeof intent.submissionId==='string'&&typeof intent.versionId==='string'){const resolved=await client.reconcile(id,intent.versionId,intent.submissionId,signal);if(resolved&&valid()){await intents.acknowledge(key,retained,signal);if(!history.some(r=>r.id===resolved.id))history.unshift(resolved);if(valid())api?.toast('Prior submission matched its exact execution receipt.');}
    // The agent has no run for this request. It admits a request only for the version it was reviewed against, so a
    // changed workflow can never start it: that is a known non-run. For an unchanged workflow the request stays
    // retained and the owner may explicitly send the same request again.
    // Soundness depends on order: `current` was read before this receipt. Version IDs never recur, so a request still
    // in flight at the receipt read is refused once the version it names is no longer current. Never re-read the
    // workflow after the receipt and compare that; a run admitted in between would then be labelled not run.
    // The resend needs no such argument: the agent admits one submission ID at most once, atomically.
    else if(!resolved&&valid()){if(current.versionId!==intent.versionId){await intents.acknowledge(key,retained,signal);if(valid())api?.toast('Your earlier run request was never accepted, and this workflow has changed since, so it can no longer start. Nothing ran. Review the current steps before a new run.');}else notAdmitted={workflowId:id,versionId:intent.versionId,submissionId:intent.submissionId,raw:retained};}}}catch{if(valid())api?.toast('Prior submission could not be reconciled. History remains available; another run is blocked.');}}
  if(valid()){unadmitted=notAdmitted;reviewResend=false;editor=null;lifecycleAvailable=available;lifecycleReview=false;unknownReview=false;reviewRerun=false;detail=current;detailSession=sessionId;runs=history;receipt=null;reviewCancel=false;reviewRun=false;reviewActivation=false;}
 });
 // A committed intent can outlive cancellation while awaiting storage. Remove only
 // that exact undispatched request; an uncertain provider response stays retained.
 const beforeDispatch=async(intents:WorkflowIntentStore,key:string,intent:string,signal:AbortSignal,valid:()=>boolean)=>{if(signal.aborted||!valid()){await intents.acknowledge(key,intent);throw Error('Workflow request cancelled before dispatch');}};
 const phoneContext=(selected:WorkflowRun)=>{
  const context=alphaClient.getState().context;
  if(!owner?.live||!api?.isActive()||owner.S().view!=='workflows'||document.hidden||connectionController.getSnapshot().open||context.sensitive||context.view!=='workflows'||context.selectedObject?.kind!=='workflow-run'||context.selectedObject.id!==selected.id||context.selectedObject.revision!==selected.versionId||receipt?.id!==selected.id||receipt.versionId!==selected.versionId)throw new Error('Open this exact execution in the foreground to review its phone steps');
  return structuredClone(context);
 };
 // One redacted OS notice per pending phone-step approval, so a waiting step stays discoverable
 // after leaving the app. A tap only opens the run read-only; a decision or expiry withdraws it.
 interface ApprovalNoticeNative {postWorkflowApprovalNotice(input:{id:string;bindingHash:string;expiresAt:number;route:WorkflowNoticeRoute}):Promise<{status:string}>;withdrawWorkflowApprovalNotice(input:{id:string}):Promise<void>;resumeWorkflowApprovalNotice(input:{id:string;bindingHash:string;expiresAt:number;route:WorkflowNoticeRoute}):Promise<{status:string}>;withdrawOtherOwnerApprovalNotices(input:{owner:{origin:string;ownerId:string;agentId:string}|null}):Promise<{withdrawn:number;suspended?:Array<{id:string;bindingHash:string;expiresAt:number;route:WorkflowNoticeRoute}>}>}
 const approvalNative=()=>registerPlugin<ApprovalNoticeNative>('AlphaHostedResults');
 const noticeRoute=(run:WorkflowRun):WorkflowNoticeRoute|null=>{const selected=connectionController.getWorkflowClient(),session=connectionController.getSnapshot().session;if(!Capacitor.isNativePlatform()||!selected?.scope||!session)return null;return {scope:selected.scope,origin:session.origin,ownerId:session.ownerId,agentId:session.agentId,workflowId:run.workflowId,runId:run.id,versionId:run.versionId};};
 async function syncApprovalNotices(route:WorkflowNoticeRoute,pending:ActionProposal[],resolved:string[]){
  const native=approvalNative();
  for(const proposalId of resolved){try{await native.withdrawWorkflowApprovalNotice({id:(await workflowApprovalNotice(route,proposalId)).id});}catch{/* It still expires with the approval. */}}
  for(const step of pending){if(!(step.expiresAt>Date.now()))continue;try{const {id,bindingHash}=await workflowApprovalNotice(route,step.id);await native.postWorkflowApprovalNotice({id,bindingHash,expiresAt:step.expiresAt,route});}catch{/* The step stays waiting in Workflows. */}}
 }
 // Serialized: a decision's withdrawal always reaches the native ledger after any post still in flight
 // from the preceding review, so a decided approval can never be posted afterwards.
 // The route is the one the caller read while its session was still the run's own: a queued request that
 // only starts after the owner changed must not take the next owner's identity, or its notice would
 // be posted for that owner and survive the withdrawal below.
 let approvalNotices:Promise<void>=Promise.resolve();
 const queueApprovalNotices=(route:WorkflowNoticeRoute|null,pending:ActionProposal[],resolved:string[])=>{if(!route)return;approvalNotices=approvalNotices.then(()=>syncApprovalNotices(route,pending,resolved)).catch(()=>{});};
 // A return restores only exact pending metadata, never an executable approval context.
 const ownerNotices=new NoticeOwnerCoordinator({
  transition:(snapshot)=>approvalNative().withdrawOtherOwnerApprovalNotices({owner:snapshot.owner}),
  enqueue:(work)=>{approvalNotices=approvalNotices.then(work).catch(()=>{});},
  available:(snapshot)=>connectionController.getSnapshot().session?.sessionId===snapshot.identity&&!connectionController.getSnapshot().open&&!document.hidden,
  restore:async(result,snapshot,valid)=>{
   const session=connectionController.getSnapshot().session,client=connectionController.getWorkflowClient();
   if(!session||session.sessionId!==snapshot.identity||!client)throw Error('Notice session unavailable');
   const native=approvalNative(),signal=new AbortController().signal;
   for(const suspended of result.suspended??[]){
    if(!valid())return;const route=suspended.route;
    if(route.ownerId!==session.ownerId||route.origin!==session.origin||route.agentId!==session.agentId||route.scope!==client.scope)continue;
    const reads=client.client,decision=await revalidateWorkflowApprovalNotice(suspended,{detail:(id,signal)=>reads.detail(id,signal),receipt:(runId,workflowId,signal)=>reads.receipt(runId,workflowId,signal),phoneReview:(run,signal)=>reads.phoneReview(run,signal),pending:(review,signal)=>connectionController.workflowNoticeActions(review,signal)},valid,signal);
    if(decision==='stale')return;
    if(decision==='resume')await native.resumeWorkflowApprovalNotice(suspended);
    else await native.withdrawWorkflowApprovalNotice({id:suspended.id});
   }
  },
 });
 const retireOtherOwnerNotices=()=>{
  if(!Capacitor.isNativePlatform())return;
  const session=connectionController.getSnapshot().session;
  ownerNotices.update({identity:session?.sessionId??'',owner:session?{origin:session.origin,ownerId:session.ownerId,agentId:session.agentId}:null,hasSession:!!session,startupResolved:connectionController.getSnapshot().startupResolved,busy:connectionController.getSnapshot().busy});
 };
 const reviewPhone=()=>{if(!receipt||operation)return;const selected=receipt,previous=phoneReview?.runId===selected.id?phoneSteps.map(step=>step.id):[];phoneSteps=[];phoneConfirm=null;void work(async(client,signal,valid)=>{const context=phoneContext(selected),review=await client.phoneReview(selected,signal);if(!valid())return;phoneContext(selected);const steps=review.finished||review.cancellationRequestedAt?[]:await connectionController.workflowPhoneActions(review,context,signal);if(valid()){phoneContext(selected);queueApprovalNotices(noticeRoute(selected),steps,previous.filter(id=>!steps.some(step=>step.id===id)));phoneReview=review;phoneSteps=steps;phoneStatus=steps.length?'Review the exact destination, sources and operation. Each step needs separate approval.':'No pending phone steps in this execution. Refresh explicitly if its next step becomes ready.';}});};
 const decidePhone=(proposal:ActionProposal,approved:boolean)=>{
  if(!receipt||!phoneReview||operation)return;
  const key=proposal.id+':'+String(approved);if(phoneConfirm!==key){phoneConfirm=key;publish();return;}
  const selected=receipt,reviewed=phoneReview;phoneConfirm=null;
  void work(async(client,signal,valid)=>{
   const context=phoneContext(selected),route=noticeRoute(selected),current=await client.phoneReview(selected,signal);signal.throwIfAborted();if(!valid())return;phoneContext(selected);
   if(current.finished||current.cancellationRequestedAt||current.specDigest!==reviewed.specDigest)throw new Error('Workflow execution changed; review again');
   if(approved){const result=await connectionController.execute(proposal,context,signal);queueApprovalNotices(route,[],[proposal.id]);if(valid())phoneStatus=result.summary;}
   else{await connectionController.rejectWorkflowPhoneAction(proposal.id,current,context,signal);queueApprovalNotices(route,[],[proposal.id]);if(valid())phoneStatus='Phone step denied. No device action was performed.';}
   if(valid()){phoneSteps=[];phoneReview=null;phoneConfirm=null;}
  });
 };
 const syncPhone=()=>{if(!receipt||operation)return;const selected=receipt;void work(async(client,signal,valid)=>{phoneContext(selected);const review=await client.phoneReview(selected,signal);if(!valid())return;phoneContext(selected);await connectionController.syncWorkflowPhoneReceipts(review,signal);if(valid()){phoneStatus='Saved phone receipts sent for reconciliation. No Notes or Calendar source was read again.';phoneSteps=[];phoneReview=null;}});};
 const pause=()=>{if(!detail)return;const id=detail.id;void work(async(client,signal,valid)=>{const current=await client.pause(id,signal);if(valid()){detail=current;flows=flows.map(f=>f.id===id?current:f);api?.toast('Workflow paused. An already-running execution may continue.');}});};
 const activate=()=>{if(!detail||operation||detail.removed)return;const schedule=scheduledPhoneTrigger(detail);if(!reviewActivation){reviewActivation=true;api?.toast(manualPhoneWorkflow(detail)?'This workflow has no schedule. It runs only when you tap Run now. Review the steps, then tap the switch again to enable it.':schedule?`Turning this on runs it ${describePhoneTrigger(schedule)} while this phone is on.${(note=>note?' '+note:'')(phoneTriggerClockChangeNote(schedule))} A time that passes without a run is recorded as missed and never run later. Each phone step still waits for your approval. Review the steps, then tap the switch again to confirm.`:'Enabling may start scheduled runs. Review the steps, then tap the switch again to confirm.');publish();return;}const selected=detail;reviewActivation=false;void work(async(client,signal,valid)=>{try{const current=await client.activate(selected.id,selected.versionId,signal);if(valid()){detail=current;flows=flows.map(f=>f.id===current.id?current:f);api?.toast(schedule?`Schedule on: ${describePhoneTrigger(schedule)}.`:'Workflow enabled on your agent.');}}catch(error){if(error instanceof WorkflowActivationRejected&&valid()){const current=await client.detail(selected.id,signal);if(valid()){detail=current;flows=flows.map(f=>f.id===current.id?current:f);}}throw error;}});};
 const unresolvedRuns=(id:string)=>runs.filter(r=>r.workflowId===id&&(runOutcomeUnknown(r)||runWorkerRunning(r)));
 const submitRun=(selected:RemoteWorkflow)=>{
  const key=lockKey(selected.id);
  void work(async(client,signal,valid,_session,intents)=>{
   let started,intent:string|undefined;
   try{started=await client.run(selected.id,selected.versionId,signal,async submissionId=>{intent=await intents.admit(key,{workflowId:selected.id,versionId:selected.versionId,submittedAt:Date.now(),...(submissionId?{submissionId}:{})},signal);await beforeDispatch(intents,key,intent,signal,valid);});}
   catch(error){if(error instanceof WorkflowAdmissionRejected&&intent){await intents.acknowledge(key,intent);if(valid()){const refreshed=await client.detail(selected.id,signal);if(valid()){detail=refreshed;reviewRun=false;}}}throw error;}
   if(intent)await intents.acknowledge(key,intent);
   if(valid()){receipt=started;approvalReceipt=null;approvalReview=null;reviewCancel=false;reviewRerun=false;runs=[started,...runs.filter(r=>r.id!==started.id)];api?.toast('Run accepted. Refresh its receipt to check completion.');}
  });
 };
 /** Explicit, confirmed repeat of the one retained request under its original submission ID. It first asks for the receipt again, so a request that did arrive is shown rather than re-sent. */
 const resubmitRun=(selected:RemoteWorkflow,request:NonNullable<typeof unadmitted>)=>{
  const key=lockKey(selected.id);
  void work(async(client,signal,valid,_session,intents)=>{
   unadmitted=null;
   if(await intents.read(key,signal)!==request.raw)throw new Error('Retained run request changed');
   let started=await client.reconcile(selected.id,request.versionId,request.submissionId,signal);
   if(!started){try{started=await client.resubmit(selected.id,request.versionId,request.submissionId,signal);}catch(error){if(error instanceof WorkflowAdmissionRejected){await intents.acknowledge(key,request.raw);if(valid()){const refreshed=await client.detail(selected.id,signal);if(valid()){detail=refreshed;reviewRun=false;}}}throw error;}}
   await intents.acknowledge(key,request.raw);
   if(valid()){receipt=started;approvalReceipt=null;approvalReview=null;reviewCancel=false;reviewRerun=false;runs=[started,...runs.filter(r=>r.id!==started!.id)];api?.toast('Run accepted under your original request. Refresh its receipt to check completion.');}
  });
 };
 const run=()=>{
  if(!detail||operation||detail.removed)return;const request=unadmitted?.workflowId===detail.id&&unadmitted.versionId===detail.versionId?unadmitted:null;
  if(locked(detail.id)&&!request){api?.toast('Run outcome unknown. Refresh history; automatic retry is blocked.');return;}
  // Side-effecting workflows never start beside an interrupted run whose effects are unknown.
  if(!readOnlyDigestWorkflow(detail)&&unresolvedRuns(detail.id).length){api?.toast('An interrupted run of this workflow has an unknown outcome or is still being reconciled. Open it below and cancel it explicitly before starting another run. Nothing is replayed automatically.');return;}
  if(request){if(!reviewResend){reviewResend=true;api?.toast('The agent has no run for your earlier request, so it may never have arrived. Tap Run now again to send that same request once more. It keeps its original identity and can start at most one run.');publish();return;}reviewResend=false;resubmitRun(detail,request);return;}
  if(!reviewRun){reviewRun=true;api?.toast('Review the steps, then tap Run now again to start this workflow once.');publish();return;}
  if(locked(detail.id)){api?.toast('A prior run submission has an unknown outcome. Inspect history on this agent; this phone will not submit another run.');return;}
  const selected=detail;reviewRun=false;submitRun(selected);
 };
 /** Explicit, separately confirmed new run (new run ID) for a read-only digest whose earlier run was interrupted. The interrupted run is never replayed or modified. */
 const runAgain=()=>{if(!receipt||!detail||operation||!runOutcomeUnknown(receipt)||!readOnlyDigestWorkflow(detail)||detail.id!==receipt.workflowId)return;if(detail.versionId!==receipt.versionId){api?.toast('This workflow changed after the interrupted run. Close the receipt and review the current steps before using Run now.');return;}if(locked(detail.id)){api?.toast('A prior run submission has an unknown outcome. Inspect history on this agent; this phone will not submit another run.');return;}if(!reviewRerun){reviewRerun=true;api?.toast('Run again starts a new, separate run of these read-only steps. The interrupted run is not replayed or changed. Tap Confirm new run to start it.');publish();return;}reviewRerun=false;submitRun(detail);};
 const read=(run:WorkflowRun)=>{
  phoneSteps=[];phoneReview=null;phoneConfirm=null;phoneStatus='';const key=approvalKey(run);
  return work(async(client,signal,valid,_session,intents)=>{
   const retained=await intents.read(key,signal),result=await client.receipt(run.id,run.workflowId,signal);let approvals:WorkflowApprovalReceipt|null=null;
   try{approvals=await client.approvals(result,signal);}catch{if(valid())api?.toast('Approval review unavailable. No decision has been sent.');}
   if(approvals&&retained&&valid()){const intent=JSON.parse(retained),matched=approvals.approvals.find(a=>a.nodeId===intent.nodeId&&a.iteration===intent.iteration&&a.requestDigest===intent.requestDigest);
    if(intent.versionId===result.versionId&&matched&&matched.status!=='pending')await intents.acknowledge(key,retained,signal);
    // The engine accepts no decision once a run is finished or being cancelled, or for an approval it no longer
    // lists, so a decision it never recorded can no longer take effect: a known non-decision.
    else if(intent.versionId===result.versionId&&(approvals.finished||approvals.cancellationRequested)){await intents.acknowledge(key,retained,signal);if(valid())api?.toast('Your earlier decision was never recorded and this execution no longer accepts decisions. Nothing was approved or denied by it.');}}
   if(valid()){receipt=result;approvalReceipt=approvals;approvalReview=null;reviewCancel=false;reviewRerun=false;runs=runs.map(r=>r.id===result.id?result:r);}
  });
 };
 const decide=(a:WorkflowApproval,approved:boolean)=>{
  if(!receipt||operation||approvalLocked(receipt)||approvalReceipt?.finished||approvalReceipt?.cancellationRequested||(approved&&!a.supported))return;
  if(approvalReview?.digest!==a.requestDigest||approvalReview.approved!==approved){approvalReview={digest:a.requestDigest,approved};publish();return;}
  const selected=receipt,key=approvalKey(selected);approvalReview=null;
  void work(async(client,signal,valid,_session,intents)=>{const intent=await intents.admit(key,{nodeId:a.nodeId,iteration:a.iteration,requestDigest:a.requestDigest,approved,versionId:selected.versionId},signal);await beforeDispatch(intents,key,intent,signal,valid);signal.throwIfAborted();const resolved=await client.decideApproval(selected,a,approved,signal);await intents.acknowledge(key,intent);if(valid()){approvalReceipt=resolved;api?.toast('Decision recorded by the workflow engine. Refresh the execution receipt for its outcome.');}});
 };
 const cancel=()=>{if(!receipt||receipt.finished||operation)return;if(!reviewCancel){reviewCancel=true;if(runOutcomeUnknown(receipt))api?.toast('Cancelling records that this interrupted run must not continue. It does not reveal or undo anything it already did, and nothing is replayed. Tap Confirm cancellation to send it.');publish();return;}const selected=receipt;reviewCancel=false;void work(async(client,signal,valid)=>{const result=await client.cancel(selected.id,selected.workflowId,signal);if(valid()){receipt=result;approvalReceipt=null;approvalReview=null;runs=runs.map(r=>r.id===result.id?result:r);api?.toast(result.finished?'Terminal execution receipt received.':'Cancellation requested. Refresh receipt to verify terminal status; completed effects are not undone.');}});};
 const cancelEdit=()=>{generation++;operation?.abort();operation=null;editor=null;phase='ready';publish();};
 const edit=()=>{if(!detail||operation||detail.removed)return;if(detail.phoneSpec){const id=detail.id;if(runs.some(r=>r.workflowId===id&&!r.finished))api?.toast('An execution of this workflow is still in progress. Changes apply to new runs only; that execution keeps the steps it started with.');void authoring.open(detail);return;}if(metadataLocked(detail.id)){api?.toast('Save outcome unknown. Refreshing the exact change receipt; another edit is blocked.');void open(detail.id);return;}const selected=detail;void work(async(client,signal,valid)=>{if(!await client.metadataSupported(signal)){if(valid())api?.toast('This agent does not support safe name and description changes.');return;}if(valid())editor={id:selected.id,versionId:selected.versionId,name:selected.name,description:selected.description};});};
 const saveMetadata=()=>{
  if(!editor||operation||metadataLocked(editor.id)||!editor.name.trim()||editor.name.length>200||editor.description.length>4000)return;
  const selected={...editor},key=metadataKey(selected.id);
  void work(async(client,signal,valid,_session,intents)=>{
   let intent:string|undefined;
   try{await client.changeMetadata(selected.id,selected.versionId,selected.name,selected.description,signal,async mutationId=>{intent=await intents.admit(key,{mutationId,versionId:selected.versionId},signal);await beforeDispatch(intents,key,intent,signal,valid);});if(intent)await intents.acknowledge(key,intent);if(valid()){const current=await client.detail(selected.id,signal);if(valid()){detail=current;editor=null;flows=flows.map(f=>f.id===current.id?current:f);api?.toast('Name and description saved.');}}}
   catch(error){if(error instanceof WorkflowMetadataRejected&&intent){await intents.acknowledge(key,intent);if(valid()){const current=await client.detail(selected.id,signal);if(valid()){detail=current;editor=null;}}}throw error;}
  });
 };
 const lifecycle=()=>{if(!detail||operation)return;if(lifecycleLocked(detail.id)){void open(detail.id);return;}if(!lifecycleAvailable){api?.toast('This agent does not support reviewed removal and restore.');return;}const interrupted=runs.filter(runOutcomeUnknown);if(runs.some(r=>!r.finished&&!runOutcomeUnknown(r))){api?.toast('Open each ongoing execution below and cancel it explicitly before removing this workflow.');return;}
  // Upstream plugin-workflow refuses removal while any execution is unfinished and has no
  // acknowledgement-only API. The supported path is an explicit, confirmed cancellation of each
  // interrupted run; removing past an unknown outcome without cancelling would need a tested patch in patches/eliza.
  if(interrupted.length){if(!unknownReview){unknownReview=true;lifecycleReview=true;publish();return;}const selected=detail;unknownReview=false;lifecycleReview=false;void work(async(client,signal,valid)=>{let failed=0;for(const r of interrupted){try{await client.cancel(r.id,r.workflowId,signal);}catch(error){if(signal.aborted)throw error;failed++;}}const history=await client.executions(selected.id,signal),current=await client.detail(selected.id,signal);if(valid()){runs=history;detail=current;api?.toast(failed?'Some interrupted runs could not be cancelled. Removal stays blocked; refresh and review them.':history.some(r=>!r.finished)?'Cancellation requested. Removal stays blocked until the agent confirms every run has stopped.':'Interrupted runs cancelled; their earlier outcome remains unknown. Tap Remove again to review removal.');}});return;}if(detail.removed&&detail.triggerCleanup==='pending'){api?.toast('Scheduled trigger cleanup is pending on the agent. Restore is blocked until cleanup is confirmed.');return;}if(!lifecycleReview){lifecycleReview=true;publish();return;}const selected=detail,operationName=selected.removed?'restore':'remove',key=lifecycleKey(selected.id);lifecycleReview=false;void work(async(client,signal,valid,_session,intents)=>{let intent:string|undefined;try{await client.lifecycle(selected.id,selected.versionId,operationName,signal,async mutationId=>{intent=await intents.admit(key,{mutationId,versionId:selected.versionId,operation:operationName},signal);await beforeDispatch(intents,key,intent,signal,valid);});if(intent)await intents.acknowledge(key,intent);if(valid()){const current=await client.detail(selected.id,signal);if(valid()){detail=current;flows=flows.filter(f=>f.id!==selected.id);api?.toast(current.removed?'Workflow removed; execution history retained.':manualPhoneWorkflow(current)?'Workflow restored paused. It has no schedule and runs only when you tap Run now.':'Workflow restored paused. Review its schedule before enabling.');}}}catch(error){if(error instanceof WorkflowLifecycleRejected){if(intent)await intents.acknowledge(key,intent);if(valid()){const current=await client.detail(selected.id,signal),history=await client.executions(selected.id,signal);if(valid()){detail=current;runs=history;}}}throw error;}});};
 view.back=()=>{if(authoring.active){authoring.close();return true;}if(lifecycleReview){lifecycleReview=false;unknownReview=false;publish();return true;}if(editor){cancelEdit();return true;}if(receipt){receipt=null;approvalReceipt=null;approvalReview=null;reviewCancel=false;reviewRerun=false;publish();return true;}if(detail){detail=null;reviewRun=false;reviewResend=false;publish();return true;}return false;};view.onLeave=()=>clear(true);
 view.render=(_state:Bag,current:Bag)=>{api=current;const binding=connectionController.getWorkflowClient();if(!view.automationsManaged&&phase==='idle'&&binding&&current.isActive()){phase='scheduled';queueMicrotask(()=>{if(api?.isActive())void refresh();});}
 const track=(on:boolean)=>current.track(on),kx=(on:boolean)=>current.kx(on);
 const cards:Bag[]=flows.map(f=>({name:f.name,short:f.description||'Agent workflow',statusLabel:f.removed?'Removed':f.active?'Active':'Paused',on:f.active,track:track(f.active),kx:kx(f.active),dim:'',failed:false,open:()=>void open(f.id),toggle:()=>{void open(f.id);current.toast('Open the workflow to review it before pausing.');}}));
 cards.unshift({name:phase==='busy'?'Loading workflows…':binding?status:(agentAvailabilityNotice(connectionController.getSnapshot(),'Agent connection required')||'Workflows'),short:binding?'Tap to refresh from this agent':residentAlwaysPresent||!testMocksEnabled?'Workflows appear when your agent is running':'Connect your remote agent to manage workflows',on:false,track:track(false),kx:kx(false),dim:'',failed:false,open:()=>binding?void refresh():connectionController.open(),toggle:()=>binding?void refresh():connectionController.open()});
 if(intentStore&&!Capacitor.isNativePlatform())cards.push({name:'Workflow request recovery',short:'Back up or reset this agent’s pending requests',on:false,track:track(false),kx:kx(false),dim:'',failed:false,open:()=>void recoverIntents(),toggle:()=>{}});
 if(lifecycleAvailable)cards.push({name:removedList?'Active workflows':'Removed workflows',short:removedList?'Return to current workflows':'Review removed workflows and retained execution history',on:false,track:track(false),kx:kx(false),dim:'',failed:false,open:()=>{if(operation)return;removedList=!removedList;detail=null;void refresh();},toggle:()=>{}});
 for(const id of operation||phase==='scheduled'?[]:pendingLifecycle())if(!flows.some(f=>f.id===id))cards.push({name:'Pending workflow change',short:'Tap to reconcile this exact removal or restore',on:false,track:track(false),kx:kx(false),dim:'',failed:false,open:()=>void open(id),toggle:()=>{}});
 if(Capacitor.isNativePlatform())cards.push({name:'Saved workflow notification',short:'Open the exact execution from a notification tap',on:false,track:track(false),kx:kx(false),dim:'',failed:false,open:()=>void checkNotice('user'),toggle:()=>{}});
 const hasDeviceSteps=!!receipt&&runHasDeviceSteps(receipt,detail,phoneReview);
 const phonePending=!!receipt&&!receipt.finished&&(phoneSteps.length>0||(hasDeviceSteps&&receipt.status==='waiting-approval'));
 const phoneReconcile=!!receipt&&hasDeviceSteps&&(phonePending||receipt.reconciliation?.state==='outcome-unknown');
 const phoneAvailable=phonePending||phoneReconcile;
 /** P-10: a missed scheduled time is never replayed; it offers an explicit Run now, which goes through the workflow's own reviewed run confirmation as a new run. Only a typed scheduled workflow offers it: the agent admits a hosted digest only at its own scheduled occurrence and refuses a manual run. */
 const missedRunNow=(r:WorkflowRun)=>r.finished&&r.occurrence?.status==='missed'&&!!detail&&detail.id===r.workflowId&&!detail.removed&&!!scheduledPhoneTrigger(detail);
 const closeReceipt=()=>{receipt=null;approvalReceipt=null;approvalReview=null;reviewCancel=false;reviewRerun=false;publish();};
 const history=runs.map(r=>({when:r.occurrence?'Scheduled '+new Date(r.occurrence.scheduledAt).toLocaleString():new Date(r.startedAt).toLocaleString(),sum:workflowRunLabel(r),label:`${workflowRunLabel(r)} execution`,d:current.ic.clock,css:'background:var(--s2)',open:()=>void read(r)}));
 return {cards,managementCards:cards.slice(flows.length+1),removedList,openWorkflow:(id:string)=>void open(id),newFlow:()=>void authoring.open(),builder:authoring.active||!!editor,b:authoring.active?authoring.render(current):editor?{metadataOnly:true,fullEditor:false,name:editor.name,description:editor.description,onName:(event:Bag)=>{if(editor&&!operation){editor.name=String(event.target.value);publish();}},onDescription:(event:Bag)=>{if(editor&&!operation){editor.description=String(event.target.value);publish();}},saveOff:phase==='busy'||metadataLocked(editor.id)||!editor.name.trim()||editor.name.length>200||editor.description.length>4000,saveCss:'background:var(--acc);color:#fff',save:saveMetadata,cancel:cancelEdit,metadataStatus:metadataLocked(editor.id)?'Save outcome unknown — refresh the exact change receipt before editing again.':'Change the name and description. Workflow steps and scheduling stay as reviewed.',unknown:metadataLocked(editor.id),refresh:()=>void open(editor!.id),steps:[],palette:[],hasApps:false,empty:false,sheetOn:false}:null,detail:!!detail,runOpen:!!receipt,noop:()=>{},fd:detail?{deleteLabel:detail.removed?'Restore workflow':'Remove workflow',lifecycleReview,lifecycleText:unknownReview?`${runs.filter(runOutcomeUnknown).length} interrupted run${runs.filter(runOutcomeUnknown).length===1?' has':'s have'} an unknown outcome. The agent keeps this workflow until each is explicitly cancelled. Cancelling does not reveal or undo what those runs did, and nothing is replayed.`:detail.removed?(manualPhoneWorkflow(detail)?'Restore workflow paused. Review the retained steps before enabling. It has no schedule and runs only when you tap Run now.':'Restore workflow paused. Review the retained steps and schedule before enabling.'):'Remove workflow; keep execution history. Future runs are blocked. This does not undo completed effects.',lifecycleLabel:unknownReview?'Cancel interrupted runs':detail.removed?'Confirm restore':'Remove workflow; keep execution history',lifecycleConfirm:lifecycle,lifecycleCancel:()=>{lifecycleReview=false;unknownReview=false;publish();},name:detail.name,summary:detail.description||'Review this agent-managed workflow before running.',on:detail.active,track:track(detail.active),kx:kx(detail.active),toggle:()=>detail?.removed?api?.toast('Restore this workflow paused before enabling it.'):detail?.active?pause():activate(),apps:[],hasApps:false,steps:detail.steps.map((step,i)=>({k:'Step',t:step.description||step.label,d:current.ic.check,label:step.label,dotCss:'background:var(--s2)',lineColor:i===detail!.steps.length-1?'transparent':'var(--line)',boxCss:'background:var(--s2)',kindColor:'var(--mut)',tap:()=>{}})),isRunning:phase==='busy',notRunning:phase!=='busy'&&!detail.removed,last:(!intentStore||intentStore.stale)?(phase==='busy'?'Checking saved workflow history…':'Saved workflow history needs checking. Refresh before making changes.'):lifecycleLocked(detail.id)?'Removal or restore outcome unknown — tap the workflow action to refresh its receipt':detail.removed?(detail.triggerCleanup==='pending'?'Removed; scheduled trigger cleanup pending':'Removed; execution history retained. Restore returns it paused'):metadataLocked(detail.id)?'Save outcome unknown — tap Change to refresh its receipt':unadmitted?.workflowId===detail.id&&unadmitted.versionId===detail.versionId&&locked(detail.id)?(reviewResend?'Tap Run now again to send your earlier request once more':'The agent has no run for your earlier request. Run now sends that same request again'):locked(detail.id)?'Prior run outcome unknown — inspect history; repeat submission blocked':runs.some(runOutcomeUnknown)?(readOnlyDigestWorkflow(detail)?'An earlier run was interrupted — outcome unknown. Open it to run these read-only steps again':'An earlier run was interrupted — outcome unknown. New runs stay blocked until you cancel it'):reviewActivation?(manualPhoneWorkflow(detail)?'Tap the switch again to enable. Manual runs only; no schedule':'Tap the switch again to enable scheduled runs'):reviewRun?'Tap Run now again to confirm':(()=>{const schedule=scheduledPhoneTrigger(detail);return schedule?(detail.active?'Schedule on: ':'Schedule off: ')+describePhoneTrigger(schedule):detail.active?'Enabled on this agent':'Paused on this agent';})(),runs:history,hasRuns:!!runs.length,close:()=>{detail=null;lifecycleReview=false;reviewResend=false;publish();},edit,del:lifecycle,run}:null,
 r:receipt?{phoneAvailable,phoneReviewAvailable:phonePending,phoneSyncAvailable:phoneReconcile,phoneInspectAvailable:!receipt.finished&&!phoneAvailable&&detail?.versionId!==receipt.versionId&&(receipt.status==='waiting-approval'||runOutcomeUnknown(receipt)),phoneNotice:phoneAvailable?'':phoneStatus,notice:receipt.reconciliation?.state==='outcome-unknown'?'Outcome unknown. Check any changes before starting another run. Nothing was retried.':runWorkerRunning(receipt)?'This run is still running. Its progress is being checked; no new run was started.':!receipt.finished?'This run is still in progress. Cancelling does not undo completed actions.':'',versionNotice:detail&&detail.id===receipt.workflowId&&detail.versionId!==receipt.versionId?'This run used an earlier version. Later changes do not apply to it.':'',showRefresh:!receipt.finished||!!receipt.reconciliation,phoneReview:reviewPhone,phoneSync:syncPhone,phoneBusy:phase==='busy',phoneSpeaking:phase==='busy'&&phoneSteps.some(p=>p.title==='speak text'),phoneStopSpeech:()=>window.dispatchEvent(new Event('alpha:stop-workflow-speech')),phoneStatus,phoneSteps:phoneSteps.map(proposal=>({title:proposal.title==='speak text'?'Read aloud':proposal.title==='post notification'?'Post notification':proposal.title,description:proposal.reviewScope??proposal.description,identity:proposal.reviewIdentity||'',hasIdentity:!!proposal.reviewIdentity,expires:new Date(proposal.expiresAt).toLocaleString(),disabled:phase==='busy'||proposal.expiresAt<=Date.now(),approveLabel:phoneConfirm===proposal.id+':true'?'Confirm phone step':'Approve phone step',denyLabel:phoneConfirm===proposal.id+':false'?'Confirm phone denial':'Deny phone step',approve:()=>decidePhone(proposal,true),deny:()=>decidePhone(proposal,false)})),approvals:(approvalReceipt?.approvals??[]).map(a=>({title:a.title||'Workflow approval',summary:a.summary,identity:a.nodeId+' · '+a.iteration+' · '+a.workflowVersionId,disclosure:[a.operation,a.target,a.account].filter(Boolean).join(' · '),status:a.status==='pending'?(approvalReceipt?.finished||approvalReceipt?.cancellationRequested?'Not decided. This execution has stopped or is being cancelled and accepts no decision':approvalLocked(receipt!)?'Decision outcome unknown — refresh receipt, or cancel the execution; another decision is blocked':!a.supported?'This approval needs review in your agent; approval on this phone is unavailable':approvalReview?.digest===a.requestDigest?'Review the operation, target and account, then confirm the selected decision':'Awaiting your explicit decision'):a.status,canDecide:a.status==='pending'&&!approvalReceipt?.finished&&!approvalReceipt?.cancellationRequested&&!approvalLocked(receipt!),approveDisabled:phase==='busy'||!a.supported,denyDisabled:phase==='busy',approveLabel:approvalReview?.digest===a.requestDigest&&approvalReview.approved?'Confirm approval':'Approve',denyLabel:approvalReview?.digest===a.requestDigest&&!approvalReview.approved?'Confirm denial':'Deny',approve:()=>decide(a,true),deny:()=>decide(a,false)})),when:new Date(receipt.startedAt).toLocaleString(),flow:detail?.name||'Workflow',status:workflowRunLabel(receipt),sd:current.ic.clock,scss:'background:var(--s2)',log:[{k:'Execution',t:receipt.id},{k:'Version',t:receipt.versionId},...(detail&&detail.id===receipt.workflowId&&detail.versionId!==receipt.versionId?[{k:'Version note',t:'This execution uses an earlier version of the workflow. Later changes do not apply to it.'}]:[]),{k:'Status',t:receipt.finished&&receipt.occurrence?.status==='missed'?'Missed — nothing ran at this scheduled time: the phone or agent was off, or Android delayed the run past its start window. It is never run later.'+(missedRunNow(receipt)?' Use Run now to start it once.':detail?.hostedDigest&&detail.id===receipt.workflowId?' This digest runs again only at its next scheduled occurrence.':''):receipt.finished&&receipt.occurrence?.status==='overlap'?'Skipped — an earlier run was still active, so nothing ran for this scheduled time.':runOutcomeUnknown(receipt)?'Interrupted — outcome unknown. The worker stopped before reporting a result. The agent did not replay it and this phone will not retry it. Check any effects directly before starting another run.'+(detail?.hostedDigest&&detail.id===receipt.workflowId?' This digest runs again only at its next scheduled occurrence.':''):runWorkerRunning(receipt)?'The worker is still running outside the agent host. The agent is reconciling it; refresh the receipt later.':receipt.finished?'Terminal execution reported by agent':'Completion is not confirmed; cancellation does not undo prior effects'},...(receipt.reconciliation?[{k:'Reconciliation',t:receipt.reconciliation.message||receipt.reconciliation.state}]:[]),...(receipt.stoppedAt?[{k:'Stopped',t:receipt.stoppedAt}]:[]),...receipt.events.map(e=>({k:e.type,t:[e.at,e.node].filter(Boolean).join(' · ')}))].map(e=>({...e,kd:current.ic.clock,d:current.ic.clock,css:'background:var(--s2)',line:'transparent',tcss:''})),hasOut:!!receipt.output,out:receipt.output||'',hasFix:!!receipt.error,fix:receipt.error||'',askLabel:'Refresh receipt',askAria:'Refresh execution receipt',...(()=>{const rerun=runOutcomeUnknown(receipt)&&readOnlyDigestWorkflow(detail)&&detail?.id===receipt.workflowId,missed=missedRunNow(receipt);return {againLabel:missed?'Run now':receipt.finished?'Done':rerun?(reviewRerun?'Confirm new run':'Run again'):reviewCancel?'Confirm cancellation':'Cancel execution',againAria:missed?'Back to workflow to review and start one new run now':receipt.finished?'Back to workflow':rerun?(reviewRerun?'Confirm new run of this read-only workflow':'Run this read-only workflow again as a new run'):reviewCancel?'Confirm execution cancellation':'Cancel execution'};})(),againDisabled:phase==='busy',close:closeReceipt,ask:()=>void read(receipt!),again:()=>receipt&&missedRunNow(receipt)?(reviewRun=false,reviewResend=false,closeReceipt(),run()):receipt?.finished?closeReceipt():runOutcomeUnknown(receipt!)&&readOnlyDigestWorkflow(detail)&&detail?.id===receipt!.workflowId?runAgain():cancel()}:null};};
 const update=p.componentDidUpdate;p.componentDidUpdate=function(...args:unknown[]){update?.apply(this,args);syncHome();};
 const mount=p.componentDidMount,unmount=p.componentWillUnmount;p.componentDidMount=function(){mount.call(this);owner=this;this.workflowIntentChanged=()=>refreshIntents();window.addEventListener('alpha:workflow-intents',this.workflowIntentChanged);window.addEventListener('storage',this.workflowIntentChanged);if(typeof BroadcastChannel!=='undefined'){this.workflowIntentChannel=new BroadcastChannel('alpha.workflow-intents');this.workflowIntentChannel.onmessage=(event:MessageEvent)=>{if(event.data===intentStore?.documentKey)refreshIntents();};}if(Capacitor.isNativePlatform()){this.workflowNoticeListener=notificationNative().addListener('pendingWorkflowTap',()=>{void checkNotice('event');}).catch(()=>null);queueMicrotask(()=>void checkNotice());}retireOtherOwnerNotices();let session=connectionController.getSnapshot().session?.sessionId;this.workflowUnsubscribe=connectionController.subscribe(()=>{retireOtherOwnerNotices();const next=connectionController.getSnapshot().session?.sessionId;if(next!==session||connectionController.getSnapshot().open){session=next;clear();}if(!connectionController.getSnapshot().open)queueMicrotask(()=>void checkNotice());syncHome();});suspended=document.hidden;this.workflowSuspend=()=>{suspended=true;clear();};this.workflowResume=()=>{suspended=false;retireOtherOwnerNotices();publish();void checkNotice('event');syncHome();};this.workflowVisibility=()=>{if(document.hidden)this.workflowSuspend();else this.workflowResume();};document.addEventListener('visibilitychange',this.workflowVisibility);window.addEventListener('pagehide',this.workflowSuspend);window.addEventListener('pageshow',this.workflowResume);syncHome();};p.componentWillUnmount=function(){window.removeEventListener('alpha:workflow-intents',this.workflowIntentChanged);window.removeEventListener('storage',this.workflowIntentChanged);this.workflowIntentChannel?.close();document.removeEventListener('visibilitychange',this.workflowVisibility);window.removeEventListener('pagehide',this.workflowSuspend);window.removeEventListener('pageshow',this.workflowResume);this.workflowUnsubscribe?.();void this.workflowNoticeListener?.then((listener:any)=>listener?.remove());owner=null;clear();unmount.call(this);};
}
