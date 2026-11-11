import {formatDateTime} from './locale-time';
import {createWorkflowApprovalPoster,definiteNoticeFailure} from '../../../../.eliza/client-features/packages/contracts/src/workflow-approval-poster.ts';
import {reviewWorkflowNoticeQuestion} from './workflow-notice-question';
import {NoticeOwnerCoordinator,revalidateWorkflowApprovalNotice} from '../../../../.eliza/client-features/packages/contracts/src/notice-routes.ts';
import {WorkflowIntentStore,workflowIntentKey,runIntentReconcilable} from '../runtime/workflow-intents';
import {Capacitor} from '@capacitor/core';
import {registerPlugin} from '../platform-plugins';
import {resolveWorkflowTap,readyTapStep,tapRecheck,type WorkflowTapNative} from '../runtime/workflow-device-contract';
import { createWorkflowAuthoring } from './workflow-authoring';
import { homeReadIsStale, presentHomeWorkflowFreshness } from './home-cards';
import { alphaClient, type ActionProposal } from '../runtime/alpha-client';
import { workflowApprovalNotice, type WorkflowPhoneReview } from '../runtime/workflow-device-contract';
import type { WorkflowNoticeRoute } from '../runtime/device-actions';
import { connectionController, agentAvailabilityNotice, residentAlwaysPresent } from '../runtime/connection-ui';
import { testMocksEnabled } from '../build-flags';
import { showAgentStatus } from './workflow-authoring';
import { WorkflowAdmissionRejected, WorkflowMetadataRejected, WorkflowLifecycleRejected, WorkflowActivationRejected, type RemoteWorkflow, type WorkflowRun, type WorkflowApproval, type WorkflowApprovalReceipt } from '../runtime/workflow-protocol';
import { describePhoneTrigger, normalizePhoneSpec, type PhoneTimeTrigger } from '../runtime/phone-workflow-authoring';
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
/** A typed phone workflow with a manual trigger: it starts only when the owner chooses Run now. A typed workflow may instead have a reviewed local-time trigger (scheduledPhoneTrigger); hosted digests are managed in Scheduled digests. */
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
 if(run.occurrence?.status==='missed')return 'Missed';
 if(run.occurrence?.status==='overlap')return 'Skipped';
 if(runOutcomeUnknown(run))return 'Interrupted';
 if(runWorkerRunning(run))return 'Running';
 if(run.finished&&run.reconciliation?.state==='outcome-unknown')return run.status+' · after an interrupted, unknown outcome';
 return run.status;
}
/** P-10 consent shown before a schedule is turned on, as a toast and as the workflow's status line; the switch itself reads “Confirm”. */
function enableReview(workflow:RemoteWorkflow):string{
 const schedule=scheduledPhoneTrigger(workflow);
 return schedule?`${describePhoneTrigger(schedule)} · Phone must be on`:'';
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
 let removedList=false,lifecycleAvailable=false,lifecycleReview=false,unknownReview=false,reviewRerun=false,noSchedule=false;
 // A retained run request the agent just reported it never admitted (same reviewed version). Only then may the
 // owner send that exact request again; the agent admits a submission ID at most once.
 let unadmitted:{workflowId:string;versionId:string;submissionId:string;raw:string}|null=null,reviewResend=false;
 // A retained run request that can never be matched to a receipt: it has no submission identity, or the agent keeps
 // none. The executions list is the only evidence; the owner clears the request explicitly after checking it.
 let unverifiable:{workflowId:string;raw:string}|null=null,reviewClear=false;
 // A retained removal or restore the agent just reported it holds no receipt for, named against the version that is
 // still current. It may never have been sent. Only then may the owner send that exact request again; the agent
 // applies a mutation ID at most once.
 let unsentLifecycle:{workflowId:string;versionId:string;mutationId:string;operation:'remove'|'restore';raw:string}|null=null,reviewLifecycleResend=false;
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
 const lockKey=(id:string)=>{const s=connectionController.getSnapshot().session;if(!s)throw new Error('Unavailable');return workflowIntentKey(s,id);};
 const locked=(id:string)=>intentStore?.locked(lockKey(id))??true;
 let intentStore:WorkflowIntentStore|null=null;
 let suspended=false,listPhase:'idle'|'loading'|'ready'|'failed'='idle',listSession:string|null=null,listReadAt:number|null=null,homeVisit:string|null=null;
 // Retirement still cancels work, but must not render after document storage is revoked.
 const publish=()=>{if(!suspended&&!document.hidden)owner?.vset('workflows',{remoteWorkflowTick:Date.now()});};
 const authoring=createWorkflowAuthoring(()=>owner,publish,async(id)=>{await open(id);});
 p.flushWorkflowsForAppUpdate=async function(current:()=>boolean){
  const exact=()=>current()&&(!owner||owner===this)&&!operation&&!editor;
  if(!exact())throw Error('Workflow changes are still pending');
  await authoring.flushForAppUpdate(exact);
 };
 let noticeQuestion:(()=>void)|undefined;
 const clear=(keepList=false)=>{noticeQuestion?.();noticeQuestion=undefined;unadmitted=null;reviewResend=false;unverifiable=null;reviewClear=false;unsentLifecycle=null;reviewLifecycleResend=false;intentStore=null;authoring.close();phoneReview=null;phoneSteps=[];phoneConfirm=null;phoneStatus='';generation++;operation?.abort();operation=null;editor=null;removedList=false;lifecycleAvailable=false;lifecycleReview=false;unknownReview=false;reviewRerun=false;noSchedule=false;if(!keepList){flows=[];listPhase='idle';listSession=null;}homeVisit=null;detail=null;detailSession=null;runs=[];receipt=null;approvalReceipt=null;approvalReview=null;reviewRun=false;reviewActivation=false;reviewCancel=false;phase='idle';publish();};
 // The unified list owns its reads, but retained workflow history still needs this capability.
 // Share that list's cancellation/current authority without fetching the legacy workflow list again.
 view.refreshManagement=async(signal:AbortSignal,current:()=>boolean)=>{
  const shell=owner,session=connectionController.getSnapshot().session,binding=connectionController.getWorkflowClient();
  const valid=()=>!signal.aborted&&current()&&owner===shell&&connectionController.getSnapshot().session===session&&binding?.sessionId===connectionController.getWorkflowClient()?.sessionId;
  if(!valid())return;
  try{const available=binding?await binding.client.lifecycleSupported(signal):false;if(valid()){lifecycleAvailable=available;publish();}}
  catch(error){if(valid()){lifecycleAvailable=false;publish();}throw error;}
 };
 async function work(task:(client:NonNullable<ReturnType<typeof connectionController.getWorkflowClient>>['client'],signal:AbortSignal,valid:()=>boolean,sessionId:string,intents:WorkflowIntentStore)=>Promise<void>){
  if(operation)return;const binding=connectionController.getWorkflowClient();if(!binding){showAgentStatus(owner);return;}
  const controller=new AbortController(),token=++generation;operation=controller;phase='busy';publish();const valid=()=>token===generation&&!controller.signal.aborted&&binding.sessionId===connectionController.getWorkflowClient()?.sessionId;
  const session=connectionController.getSnapshot().session;if(!session){operation=null;return;}const intents=new WorkflowIntentStore(session);intentStore=intents;
  try{await intents.load(controller.signal);if(!valid())return;await task(binding.client,controller.signal,valid,binding.sessionId,intents);}catch(error){if(valid()){status=(error instanceof WorkflowAdmissionRejected||error instanceof WorkflowMetadataRejected||error instanceof WorkflowLifecycleRejected||error instanceof WorkflowActivationRejected)?error.message:'Unavailable';api?.toast(status);}}finally{if(valid()){try{await intents.load(controller.signal);}catch{intents.invalidate();}}if(token===generation){operation=null;phase='ready';publish();
   // A change notice that arrived during this operation only invalidated the snapshot. Reload it now, or every
   // request on this workflow would keep reading as an unknown outcome until the workflow is reopened.
   if(intentStore===intents&&intents.stale)refreshIntents();
   // A notification tap that arrived during this operation was not handled. Check it now.
   if(tapDeferred){tapDeferred=false;queueMicrotask(()=>void checkNotice('event'));}}}
 }
 // Only identity and version cross into agent context. The detail must have
 // been fetched under this still-current authenticated runtime binding.
 p.workflowSelection=function(){
  const binding=connectionController.getWorkflowClient();
  if(authoring.active||this!==owner||this.S().view!=='workflows'||!api?.isActive()||!detail||!detailSession||binding?.sessionId!==detailSession)return undefined;
  if(receipt&&receipt.workflowId!==detail.id)return undefined;
  return receipt?{kind:'workflow-run' as const,id:receipt.id,revision:receipt.versionId}:{kind:'workflow' as const,id:detail.id,revision:detail.versionId};
 };
 // A run card in chat opens that exact run: its workflow is read first, then the run's own receipt.
 p.openWorkflowRun=function(workflowId:string,runId:string){
  if(this!==owner)return;if(!connectionController.getWorkflowClient()){showAgentStatus(this);return;}
  this.openView('workflows');
  void open(workflowId).then(()=>{if(this!==owner||this.S().view!=='workflows'||detail?.id!==workflowId)return;const run=runs.find(r=>r.id===runId&&r.workflowId===workflowId);if(run)void read(run);else api?.toast('Pending');});
 };
 let tapBusy=false,tapRequested:{request:'event'|'user';current:()=>boolean}|null=null;
 // A tap check that a workflow operation displaced is repeated when that operation ends. The token of a tap whose
 // run is already open is kept until its consume succeeds, so a failed consume never reopens that run.
 let tapDeferred=false,openedTap:string|null=null;
 // A tap this session cannot open: toasted once per token, and offered to the owner to dismiss so older taps can surface.
 let toastedTap:string|null=null,heldTap:{token:string;question:boolean}|null=null;
 // A tapped notification whose run could not be read just now. Its row offers the retry; no row is shown otherwise.
 let tapUnopened=false;
 const notificationNative=()=>registerPlugin<WorkflowTapNative>('AlphaNotifications');
 async function checkNotice(request:'poll'|'event'|'user'='poll'){
  if(noticeQuestion||!owner?.live)return;
  const shell=owner,selected=connectionController.getWorkflowClient(),session=connectionController.getSnapshot().session,epoch=generation,initialView=shell.S().view;
  const current=()=>owner===shell&&!authoring.active&&!editor&&shell.live&&!document.hidden&&!connectionController.getSnapshot().open&&!alphaClient.getState().context.sensitive&&generation===epoch&&shell.S().view===initialView&&selected?.sessionId===connectionController.getWorkflowClient()?.sessionId;
  if(tapBusy){if(request!=='poll'&&(request==='user'||tapRequested?.request!=='user'||!tapRequested.current()))tapRequested={request,current};return;}
  if(!Capacitor.isNativePlatform())return;
  if(operation){if(tapRecheck({operationRunning:true,generationChanged:false})==='after-operation')tapDeferred=true;return;}
  if(authoring.active||editor||document.hidden||connectionController.getSnapshot().open||alphaClient.getState().context.sensitive)return;
  // An operation that started while the tap was being read moved the view on. The tap is still pending, so it is
  // checked again when that operation ends, or at once when nothing is running.
  const recheck=()=>{const again=tapRecheck({operationRunning:!!operation,generationChanged:generation!==epoch});if(again==='after-operation')tapDeferred=true;else if(again==='now')tapRequested??={request:'event',current};};
  tapBusy=true;const signal=new AbortController().signal;
  try{
   const native=notificationNative();
   const bound=selected?.scope&&session?{scope:selected.scope,origin:session.origin,ownerId:session.ownerId,agentId:session.agentId,current,receipt:(id:string,workflowId:string,s:AbortSignal)=>selected.client.receipt(id,workflowId,s),detail:(id:string,s:AbortSignal)=>selected.client.detail(id,s)}:null;
   // The agent is still starting or busy: nothing is consumed and the next connection update checks again.
   if(!bound){if(request==='user')shell.toast('Not ready');return;}
   let peeked:{token?:string;question?:boolean}={};
   const result=await resolveWorkflowTap({pendingWorkflowTap:async()=>{const tap=await native.pendingWorkflowTap();peeked=tap;return tap;}},bound,signal);
   if(!current()){recheck();return;}
   if(result.kind==='none'){const shown=!!heldTap||tapUnopened;heldTap=null;tapUnopened=false;openedTap=null;if(shown)publish();return;}
   // A failed native probe establishes no retained notification. Resume may precede window focus.
   if(result.kind==='lookup-unavailable'){if(request==='user')shell.toast('Couldn’t check');return;}
   if(result.kind!=='ready'){
    const token=peeked.token??null;heldTap=token?{token,question:!!peeked.question}:null;publish();
    // A new tap is news even on a background check; the same tap is not repeated unless the owner asks.
    if(request==='user'||token!==toastedTap){toastedTap=token;shell.toast(result.kind==='other-account'?'Other agent':'Run gone');}
    return;
   }
   heldTap=null;tapUnopened=false;
   if(result.question){
    noticeQuestion=reviewWorkflowNoticeQuestion({result,current,recheck:()=>resolveWorkflowTap(native,bound,signal),consume:()=>native.consumeWorkflowTap({token:result.token,noticeRevision:result.notice?.revision}),discard:()=>native.consumeWorkflowTap({token:result.token,discard:true}),compose:draft=>shell.api(shell.S().view).composeContentQuestion(draft),report:message=>shell.toast(message),closed:()=>{noticeQuestion=undefined;}});
    return;
   }
   // This run is already open from the same tap; only its consume is repeated.
   if(readyTapStep(result.token,openedTap)==='consume-only'){try{await native.consumeWorkflowTap({token:result.token});openedTap=null;}catch{/* The opened run stays; the consume is repeated at the next check. */}return;}
   authoring.close();editor=null;phoneReview=null;phoneSteps=[];phoneConfirm=null;phoneStatus='';approvalReceipt=null;approvalReview=null;reviewRun=false;reviewActivation=false;reviewCancel=false;
   detail=result.workflow;detailSession=selected!.sessionId;receipt=result.run;runs=[result.run];phase='ready';
   // Load this session's saved requests as work() does, so the run shows its real lock state, not an unknown outcome.
   const intents=new WorkflowIntentStore(session!);intentStore=intents;
   shell.openView('workflows');publish();
   // The run is open either way. A failed consume leaves the tap pending; the next check repeats only the consume.
   openedTap=result.token;
   try{await native.consumeWorkflowTap({token:result.token});openedTap=null;}catch{/* Repeated at the next check. */}
   try{await intents.load(signal);}catch{intents.invalidate();}
   if(intentStore===intents)publish();
  }catch{if(!current())recheck();else{tapUnopened=true;publish();if(request!=='poll')shell.toast('Couldn’t open · Kept');}}
  finally{tapBusy=false;if(tapRequested){const requested=tapRequested;tapRequested=null;queueMicrotask(()=>void checkNotice(requested.request==='user'&&requested.current()?'user':'event'));}}
 }
 const dismissTap=()=>{
  const held=heldTap;if(!held)return;heldTap=null;publish();
  // Only the owner's explicit Dismiss consumes a tap this session cannot open; it is never consumed automatically.
  void notificationNative().consumeWorkflowTap({token:held.token,...(held.question?{discard:true}:{})}).then(()=>void checkNotice('event'),()=>{api?.toast('Couldn’t dismiss');});
 };
 const refreshIntents=()=>{
  const captured=intentStore,epoch=generation;if(!captured)return;captured.invalidate();
  if(operation||suspended||document.hidden)return;
  void captured.load().catch(()=>captured.invalidate()).finally(()=>{if(intentStore===captured&&epoch===generation)publish();});
 };
 const refresh=async()=>{
  if(operation)return;
  listPhase='loading';publish();
  const pending=work(async(client,signal,valid,sessionId)=>{const homeRequest=!owner?.S().view;let available=homeRequest?lifecycleAvailable:await client.lifecycleSupported(signal);const list=removedList?await client.removedWorkflows(signal):await client.list(signal);if(homeRequest&&owner?.S().view==='workflows')available=await client.lifecycleSupported(signal);if(valid()){lifecycleAvailable=available;flows=list;listPhase='ready';listSession=sessionId;listReadAt=Date.now();status=removedList?'Removed':list.length?'Workflows':'None';}}),token=generation;
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
  const out=values.call(this),binding=connectionController.getWorkflowClient(),current=binding?.sessionId===listSession&&listPhase==='ready',saved=current?flows.filter(flow=>!flow.removed):[],rows=saved.slice(0,2);
  const loaded=presentHomeWorkflowFreshness({loadedAt:current?listReadAt:null,now:Date.now(),unified:false});
  return {...out,homeWorkflowFreshness:loaded.visible,homeWorkflowDescription:loaded.description,homeWorkflowRows:rows.map(flow=>({name:flow.name,status:flow.active?'Enabled':'Paused'})),homeWorkflowHasRows:rows.length>0,
   homeWorkflowConfirmedEmpty:current&&!removedList&&saved.length===0&&listReadAt!=null&&listReadAt>0&&listReadAt<=Date.now()&&!homeReadIsStale(listReadAt,Date.now()),
   homeWorkflowTitle:rows.length?'':!binding?'Connect':listPhase==='failed'?'Couldn’t load':listPhase==='ready'?'No workflows yet':'Loading workflows…',
   homeWorkflowTime:!binding||listPhase!=='ready'?'':saved.length>2?`+${saved.length-2} more`:saved.length?'View '+(saved.length===1?'workflow':'workflows'):'',
   homeWorkflowLabel:!binding?'Connect agent':listPhase==='failed'?'Retry workflows':'Open workflows',
   goFlows:()=>{if(!binding){showAgentStatus(this);return;}if(listPhase==='failed'){void refresh();return;}if(!operation)phase='idle';this.openView('workflows');}
  };
 };

 const open=(id:string)=>work(async(client,signal,valid,sessionId,intents)=>{
  const key=lockKey(id),lifeKey=key+':lifecycle',metaKey=key+':metadata';
  const pendingLife=await intents.read(lifeKey,signal),pendingMetadata=await intents.read(metaKey,signal),retained=await intents.read(key,signal);
  let current=await client.detail(id,signal),notApplied:typeof unsentLifecycle=null;
  // As for run requests below, `current` is read before each receipt: a change the agent has no receipt for, named
  // against a version that is no longer current, can never apply. The same version stays locked.
  if(pendingLife){try{const intent=JSON.parse(pendingLife),before=current,resolved=await client.reconcileLifecycle(id,intent.versionId,intent.mutationId,intent.operation,signal);if(resolved&&valid()){await intents.acknowledge(lifeKey,pendingLife,signal);current=await client.detail(id,signal);}else if(!resolved&&valid()){if(before.versionId!==intent.versionId){await intents.acknowledge(lifeKey,pendingLife,signal);if(valid())api?.toast('Nothing changed.');}else if(valid()){notApplied={workflowId:id,versionId:intent.versionId,mutationId:intent.mutationId,operation:intent.operation,raw:pendingLife};api?.toast('Not received · Resend available');}}}catch{if(valid())api?.toast('Outcome unknown');}}
  if(pendingMetadata){try{const intent=JSON.parse(pendingMetadata),before=current,resolved=await client.reconcileMetadata(id,intent.versionId,intent.mutationId,signal);if(resolved&&valid()){await intents.acknowledge(metaKey,pendingMetadata,signal);current=await client.detail(id,signal);}else if(!resolved&&valid()){if(before.versionId!==intent.versionId){await intents.acknowledge(metaKey,pendingMetadata,signal);if(valid())api?.toast('Nothing changed.');}else if(valid())api?.toast('Unconfirmed');}}catch{if(valid())api?.toast('Outcome unknown');}}
  const history=await client.executions(id,signal),available=await client.lifecycleSupported(signal);let notAdmitted:typeof unadmitted=null,stuck:typeof unverifiable=null;
  // The agent refuses every Run now request for a hosted digest (it runs only from Scheduled digests), so a retained
  // request for one never started anything.
  if(retained&&current.hostedDigest){await intents.acknowledge(key,retained,signal);}
  else if(retained){try{let intent:any=null;try{intent=JSON.parse(retained);}catch{/* An unreadable request can never be matched. */}if(runIntentReconcilable(intent,id,await client.supportsSubmissionReconciliation(signal))){const resolved=await client.reconcile(id,intent.versionId,intent.submissionId,signal);if(resolved&&valid()){await intents.acknowledge(key,retained,signal);if(!history.some(r=>r.id===resolved.id))history.unshift(resolved);}
    // The agent has no run for this request. It admits a request only for the version it was reviewed against, so a
    // changed workflow can never start it: that is a known non-run. For an unchanged workflow the request stays
    // retained and the owner may explicitly send the same request again.
    // Soundness depends on order: `current` was read before this receipt. Version IDs never recur, so a request still
    // in flight at the receipt read is refused once the version it names is no longer current. Never re-read the
    // workflow after the receipt and compare that; a run admitted in between would then be labelled not run.
    // The resend needs no such argument: the agent admits one submission ID at most once, atomically.
    else if(!resolved&&valid()){if(current.versionId!==intent.versionId){await intents.acknowledge(key,retained,signal);if(valid())api?.toast('Not run · Workflow changed');}else notAdmitted={workflowId:id,versionId:intent.versionId,submissionId:intent.submissionId,raw:retained};}}else if(valid())stuck={workflowId:id,raw:retained};}catch{if(valid())api?.toast('Couldn’t check run');}}
  if(valid()){unadmitted=notAdmitted;reviewResend=false;unverifiable=stuck;reviewClear=false;unsentLifecycle=notApplied;reviewLifecycleResend=false;noSchedule=false;editor=null;lifecycleAvailable=available;lifecycleReview=false;unknownReview=false;reviewRerun=false;detail=current;detailSession=sessionId;runs=history;receipt=null;reviewCancel=false;reviewRun=false;reviewActivation=false;}
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
 // after leaving the app. An open receipt posts its own steps; the poller below posts steps of every other
 // waiting run (scheduled, agent- or owner-started) while Alpha's process runs. A killed process posts nothing.
 // A tap only opens the run read-only; a decision or expiry withdraws it.
 interface ApprovalNoticeNative {postWorkflowApprovalNotice(input:{id:string;bindingHash:string;expiresAt:number;route:WorkflowNoticeRoute}):Promise<{status:string}>;withdrawWorkflowApprovalNotice(input:{id:string}):Promise<void>;resumeWorkflowApprovalNotice(input:{id:string;bindingHash:string;expiresAt:number;route:WorkflowNoticeRoute}):Promise<{status:string}>;withdrawOtherOwnerApprovalNotices(input:{owner:{origin:string;ownerId:string;agentId:string}|null}):Promise<{withdrawn:number;suspended?:Array<{id:string;bindingHash:string;expiresAt:number;route:WorkflowNoticeRoute}>}>}
 const approvalNative=()=>registerPlugin<ApprovalNoticeNative>('AlphaHostedResults');
 const noticeRoute=(run:WorkflowRun):WorkflowNoticeRoute|null=>{const selected=connectionController.getWorkflowClient(),session=connectionController.getSnapshot().session;if(!Capacitor.isNativePlatform()||!selected?.scope||!session)return null;return {scope:selected.scope,origin:session.origin,ownerId:session.ownerId,agentId:session.agentId,workflowId:run.workflowId,runId:run.id,versionId:run.versionId};};
 async function syncApprovalNotices(route:WorkflowNoticeRoute,identity:string,pending:ActionProposal[],resolved:string[]){
  const native=approvalNative();
  // A failed withdrawal stays remembered, so the poller withdraws it again once the step is no longer pending.
  for(const proposalId of resolved){try{const {id}=await workflowApprovalNotice(route,proposalId);poster.remember(id,identity,route.workflowId);await native.withdrawWorkflowApprovalNotice({id});poster.forget(id);}catch{/* It still expires with the approval. */}}
  for(const step of pending){if(!(step.expiresAt>Date.now()))continue;try{const {id,bindingHash}=await workflowApprovalNotice(route,step.id);await native.postWorkflowApprovalNotice({id,bindingHash,expiresAt:step.expiresAt,route});poster.remember(id,identity,route.workflowId);}catch{/* The step stays waiting in Workflows. */}}
 }
 // Serialized: a decision's withdrawal always reaches the native ledger after any post still in flight
 // from the preceding review, so a decided approval can never be posted afterwards.
 // The route is the one the caller read while its session was still the run's own: a queued request that
 // only starts after the owner changed must not take the next owner's identity, or its notice would
 // be posted for that owner and survive the withdrawal below.
 let approvalNotices:Promise<void>=Promise.resolve();
 const queueApprovalNotices=(route:WorkflowNoticeRoute|null,pending:ActionProposal[],resolved:string[])=>{const identity=connectionController.getSnapshot().session?.sessionId;if(!route||!identity)return;approvalNotices=approvalNotices.then(()=>syncApprovalNotices(route,identity,pending,resolved)).catch(()=>{});};
 const poster=createWorkflowApprovalPoster<WorkflowRun,WorkflowPhoneReview>({
  session:()=>{
   const snapshot=connectionController.getSnapshot(),selected=connectionController.getWorkflowClient(),session=snapshot.session;
   if(!owner||!Capacitor.isNativePlatform()||suspended||document.hidden||!session||!selected?.scope||snapshot.open||snapshot.busy||!connectionController.getWorkflowDeviceTarget())return null;
   const reads=selected.client,scope=selected.scope;
   return {identity:session.sessionId,current:()=>!!owner&&!suspended&&connectionController.getSnapshot().session?.sessionId===session.sessionId&&connectionController.getWorkflowClient()?.sessionId===selected.sessionId&&!connectionController.getSnapshot().open&&!document.hidden,
    route:run=>({scope,origin:session.origin,ownerId:session.ownerId,agentId:session.agentId,workflowId:run.workflowId,runId:run.id,versionId:run.versionId}),
    list:signal=>reads.list(signal),executions:(id,signal)=>reads.executions(id,signal),phoneReview:(run,signal)=>reads.phoneReview(run,signal),pending:(review,signal)=>connectionController.workflowNoticeActions(review,signal)};
  },
  native:approvalNative,enqueue:work=>{approvalNotices=approvalNotices.then(work).catch(()=>{});},changed:()=>publish(),
 });
 // A return restores only exact pending metadata, never an executable approval context.
 const ownerNotices=new NoticeOwnerCoordinator({
  transition:(snapshot)=>approvalNative().withdrawOtherOwnerApprovalNotices({owner:snapshot.owner}),
  enqueue:(work)=>{approvalNotices=approvalNotices.then(work).catch(()=>{});},
  available:(snapshot)=>connectionController.getSnapshot().session?.sessionId===snapshot.identity&&!connectionController.getSnapshot().open&&!document.hidden,
  restore:async(result,snapshot,valid)=>{
   const session=connectionController.getSnapshot().session,client=connectionController.getWorkflowClient();
   if(!session||session.sessionId!==snapshot.identity||!client)throw Error('Unavailable');
   const native=approvalNative(),signal=new AbortController().signal;let transient=0;
   for(const suspended of result.suspended??[]){
    if(!valid())return;const route=suspended.route;
    if(route.ownerId!==session.ownerId||route.origin!==session.origin||route.agentId!==session.agentId||route.scope!==client.scope)continue;
    // One unreadable notice must not strand the rest. A missing run or a changed identity withdraws it; a
    // transient failure keeps it suspended and the coordinator retries the restore.
    try{
     const reads=client.client,decision=await revalidateWorkflowApprovalNotice(suspended,{detail:(id,signal)=>reads.detail(id,signal),receipt:(runId,workflowId,signal)=>reads.receipt(runId,workflowId,signal),phoneReview:(run,signal)=>reads.phoneReview(run,signal),pending:(review,signal)=>connectionController.workflowNoticeActions(review,signal)},valid,signal);
     if(decision==='stale')return;
     if(decision==='resume'){await native.resumeWorkflowApprovalNotice(suspended);poster.remember(suspended.id,session.sessionId,route.workflowId);}
     else await native.withdrawWorkflowApprovalNotice({id:suspended.id});
    }catch(error){if(!valid())return;if(definiteNoticeFailure(error)){try{await native.withdrawWorkflowApprovalNotice({id:suspended.id});}catch{transient++;}}else transient++;}
   }
   // Posted notices of this session are swept too: the poller withdraws any whose step is no longer pending.
   // It runs after this restore, on the same serialized queue.
   void poster.poll(true);
   if(transient)throw Error(`${transient} approval notice${transient===1?'':'s'} could not be checked`);
  },
 });
 const retireOtherOwnerNotices=()=>{
  if(!Capacitor.isNativePlatform())return;
  const session=connectionController.getSnapshot().session;
  ownerNotices.update({identity:session?.sessionId??'',owner:session?{origin:session.origin,ownerId:session.ownerId,agentId:session.agentId}:null,hasSession:!!session,startupResolved:connectionController.getSnapshot().startupResolved,busy:connectionController.getSnapshot().busy});
 };
 const reviewPhone=()=>{if(!receipt||operation)return;const selected=receipt,previous=phoneReview?.runId===selected.id?phoneSteps.map(step=>step.id):[];phoneSteps=[];phoneConfirm=null;void work(async(client,signal,valid)=>{const context=phoneContext(selected),review=await client.phoneReview(selected,signal);if(!valid())return;phoneContext(selected);const steps=review.finished||review.cancellationRequestedAt?[]:await connectionController.workflowPhoneActions(review,context,signal);if(valid()){phoneContext(selected);queueApprovalNotices(noticeRoute(selected),steps,previous.filter(id=>!steps.some(step=>step.id===id)));phoneReview=review;phoneSteps=steps;phoneStatus=steps.length?`${steps.length} waiting`:'None pending';}});};
 const decidePhone=(proposal:ActionProposal,approved:boolean)=>{
  if(!receipt||!phoneReview||operation)return;
  const key=proposal.id+':'+String(approved);if(phoneConfirm!==key){phoneConfirm=key;publish();return;}
  const selected=receipt,reviewed=phoneReview;phoneConfirm=null;
  void work(async(client,signal,valid)=>{
   const context=phoneContext(selected),route=noticeRoute(selected),current=await client.phoneReview(selected,signal);signal.throwIfAborted();if(!valid())return;phoneContext(selected);
   if(current.finished||current.cancellationRequestedAt||current.specDigest!==reviewed.specDigest)throw new Error('Workflow execution changed; review again');
   if(approved){const result=await connectionController.execute(proposal,context,signal);queueApprovalNotices(route,[],[proposal.id]);if(valid())phoneStatus=result.summary;}
   else{await connectionController.rejectWorkflowPhoneAction(proposal.id,current,context,signal);queueApprovalNotices(route,[],[proposal.id]);if(valid())phoneStatus='Denied';}
   if(valid()){phoneSteps=[];phoneReview=null;phoneConfirm=null;}
  });
 };
 const syncPhone=()=>{if(!receipt||operation)return;const selected=receipt;void work(async(client,signal,valid)=>{phoneContext(selected);const review=await client.phoneReview(selected,signal);if(!valid())return;phoneContext(selected);await connectionController.syncWorkflowPhoneReceipts(review,signal);if(valid()){phoneStatus='Receipts sent';phoneSteps=[];phoneReview=null;}});};
 const pause=()=>{if(!detail)return;const id=detail.id;void work(async(client,signal,valid)=>{const current=await client.pause(id,signal);if(valid()){detail=current;flows=flows.map(f=>f.id===id?current:f);api?.toast('Paused');}});};
 const activate=()=>{if(!detail||operation||detail.removed)return;
  // The agent refuses to enable a manual typed workflow: it has no schedule. Nothing is sent.
  if(manualPhoneWorkflow(detail)){noSchedule=true;api?.toast('No schedule');publish();return;}
  const schedule=scheduledPhoneTrigger(detail);if(!reviewActivation){reviewActivation=true;const review=enableReview(detail);if(review)api?.toast(review);publish();return;}const selected=detail;reviewActivation=false;void work(async(client,signal,valid)=>{try{const current=await client.activate(selected.id,selected.versionId,signal);if(valid()){detail=current;flows=flows.map(f=>f.id===current.id?current:f);api?.toast(schedule?describePhoneTrigger(schedule):'On');}}catch(error){if(error instanceof WorkflowActivationRejected&&valid()){const current=await client.detail(selected.id,signal);if(valid()){detail=current;flows=flows.map(f=>f.id===current.id?current:f);}}throw error;}});};
 const unresolvedRuns=(id:string)=>runs.filter(r=>r.workflowId===id&&(runOutcomeUnknown(r)||runWorkerRunning(r)));
 const submitRun=(selected:RemoteWorkflow)=>{
  const key=lockKey(selected.id);
  void work(async(client,signal,valid,_session,intents)=>{
   let started,intent:string|undefined;
   try{started=await client.run(selected.id,selected.versionId,signal,async submissionId=>{intent=await intents.admit(key,{workflowId:selected.id,versionId:selected.versionId,submittedAt:Date.now(),...(submissionId?{submissionId}:{})},signal);await beforeDispatch(intents,key,intent,signal,valid);});}
   catch(error){if(error instanceof WorkflowAdmissionRejected&&intent){await intents.acknowledge(key,intent);if(valid()){const refreshed=await client.detail(selected.id,signal);if(valid()){detail=refreshed;reviewRun=false;}}}throw error;}
   if(intent)await intents.acknowledge(key,intent);
   if(valid()){receipt=started;approvalReceipt=null;approvalReview=null;reviewCancel=false;reviewRerun=false;runs=[started,...runs.filter(r=>r.id!==started.id)];api?.toast('Accepted');}
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
   if(valid()){receipt=started;approvalReceipt=null;approvalReview=null;reviewCancel=false;reviewRerun=false;runs=[started,...runs.filter(r=>r.id!==started!.id)];api?.toast('Accepted');}
  });
 };
 /** Explicit, confirmed removal of one retained run request that no receipt can ever match. It sends nothing to the agent and starts nothing. */
 const clearRunRequest=(id:string,raw:string)=>{
  const key=lockKey(id);
  void work(async(_client,signal,valid,_session,intents)=>{
   unverifiable=null;
   if(await intents.read(key,signal)!==raw)throw new Error('Retained run request changed');
   await intents.acknowledge(key,raw,signal);
   if(valid()){reviewRun=false;api?.toast('Earlier run request cleared. Nothing was sent. Review the steps before starting a new run.');}
  });
 };
 const run=()=>{
  if(!detail||operation||detail.removed)return;
  if(detail.hostedDigest){api?.toast('In Digests');return;}
  if(!intentStore||intentStore.stale){api?.toast('Check history');return;}
  const request=unadmitted?.workflowId===detail.id&&unadmitted.versionId===detail.versionId?unadmitted:null;
  const stuck=unverifiable?.workflowId===detail.id&&locked(detail.id)?unverifiable:null;
  if(stuck){if(!reviewClear){reviewClear=true;api?.toast('May have run · Clear request?');publish();return;}reviewClear=false;clearRunRequest(detail.id,stuck.raw);return;}
  if(locked(detail.id)&&!request){api?.toast('May have run');return;}
  // Side-effecting workflows never start beside an interrupted run whose effects are unknown.
  if(!readOnlyDigestWorkflow(detail)&&unresolvedRuns(detail.id).length){api?.toast('Interrupted run · cancel first');return;}
  if(request){if(!reviewResend){reviewResend=true;api?.toast('Not received · Resend once');publish();return;}reviewResend=false;resubmitRun(detail,request);return;}
  if(!reviewRun){reviewRun=true;publish();return;}
  if(locked(detail.id)){api?.toast('May have run');return;}
  const selected=detail;reviewRun=false;submitRun(selected);
 };
 /** Explicit, separately confirmed new run (new run ID) for a read-only digest whose earlier run was interrupted. The interrupted run is never replayed or modified. */
 const runAgain=()=>{if(!receipt||!detail||operation||!runOutcomeUnknown(receipt)||!readOnlyDigestWorkflow(detail)||detail.id!==receipt.workflowId)return;if(detail.versionId!==receipt.versionId){api?.toast('Workflow changed');return;}if(locked(detail.id)){api?.toast('May have run');return;}if(!reviewRerun){reviewRerun=true;api?.toast('New run?');publish();return;}reviewRerun=false;submitRun(detail);};
 const read=(run:WorkflowRun)=>{
  phoneSteps=[];phoneReview=null;phoneConfirm=null;phoneStatus='';const key=approvalKey(run);
  return work(async(client,signal,valid,_session,intents)=>{
   const retained=await intents.read(key,signal),result=await client.receipt(run.id,run.workflowId,signal);let approvals:WorkflowApprovalReceipt|null=null;
   try{approvals=await client.approvals(result,signal);}catch{if(valid())api?.toast('Unavailable');}
   if(approvals&&retained&&valid()){const intent=JSON.parse(retained),matched=approvals.approvals.find(a=>a.nodeId===intent.nodeId&&a.iteration===intent.iteration&&a.requestDigest===intent.requestDigest);
    if(intent.versionId===result.versionId&&matched&&matched.status!=='pending')await intents.acknowledge(key,retained,signal);
    // The engine accepts no decision once a run is finished or being cancelled, or for an approval it no longer
    // lists, so a decision it never recorded can no longer take effect: a known non-decision.
    else if(intent.versionId===result.versionId&&(approvals.finished||approvals.cancellationRequested)){await intents.acknowledge(key,retained,signal);if(valid())api?.toast('Decision not recorded');}}
   if(valid()){receipt=result;approvalReceipt=approvals;approvalReview=null;reviewCancel=false;reviewRerun=false;runs=runs.map(r=>r.id===result.id?result:r);}
  });
 };
 const decide=(a:WorkflowApproval,approved:boolean)=>{
  if(receipt&&!operation&&(!intentStore||intentStore.stale)){api?.toast('Check history');return;}
  if(!receipt||operation||approvalLocked(receipt)||approvalReceipt?.finished||approvalReceipt?.cancellationRequested||(approved&&!a.supported))return;
  if(approvalReview?.digest!==a.requestDigest||approvalReview.approved!==approved){approvalReview={digest:a.requestDigest,approved};publish();return;}
  const selected=receipt,key=approvalKey(selected);approvalReview=null;
  void work(async(client,signal,valid,_session,intents)=>{const intent=await intents.admit(key,{nodeId:a.nodeId,iteration:a.iteration,requestDigest:a.requestDigest,approved,versionId:selected.versionId},signal);await beforeDispatch(intents,key,intent,signal,valid);signal.throwIfAborted();const resolved=await client.decideApproval(selected,a,approved,signal);await intents.acknowledge(key,intent);if(valid()){approvalReceipt=resolved;api?.toast('Recorded');}});
 };
 const cancel=()=>{if(!receipt||receipt.finished||operation)return;if(!reviewCancel){reviewCancel=true;if(runOutcomeUnknown(receipt))api?.toast('Cancel run? Completed actions stay.');publish();return;}const selected=receipt;reviewCancel=false;void work(async(client,signal,valid)=>{const result=await client.cancel(selected.id,selected.workflowId,signal);if(valid()){receipt=result;approvalReceipt=null;approvalReview=null;runs=runs.map(r=>r.id===result.id?result:r);api?.toast(result.finished?'Finished':'Cancelling');}});};
 const cancelEdit=()=>{generation++;operation?.abort();operation=null;editor=null;phase='ready';publish();};
 const edit=()=>{if(!detail||operation||detail.removed)return;if(detail.phoneSpec){const id=detail.id;if(runs.some(r=>r.workflowId===id&&!r.finished))api?.toast('Run in progress');void authoring.open(detail);return;}if(metadataLocked(detail.id)){api?.toast('Checking');void open(detail.id);return;}const selected=detail;void work(async(client,signal,valid)=>{if(!await client.metadataSupported(signal)){if(valid())api?.toast('Not supported');return;}if(valid())editor={id:selected.id,versionId:selected.versionId,name:selected.name,description:selected.description};});};
 const saveMetadata=()=>{
  if(!editor||operation||metadataLocked(editor.id)||!editor.name.trim()||editor.name.length>200||editor.description.length>4000)return;
  const selected={...editor},key=metadataKey(selected.id);
  void work(async(client,signal,valid,_session,intents)=>{
   let intent:string|undefined;
   try{await client.changeMetadata(selected.id,selected.versionId,selected.name,selected.description,signal,async mutationId=>{intent=await intents.admit(key,{mutationId,versionId:selected.versionId},signal);await beforeDispatch(intents,key,intent,signal,valid);});if(intent)await intents.acknowledge(key,intent);if(valid()){const current=await client.detail(selected.id,signal);if(valid()){detail=current;editor=null;flows=flows.map(f=>f.id===current.id?current:f);api?.toast('Saved');}}}
   catch(error){if(error instanceof WorkflowMetadataRejected&&intent){await intents.acknowledge(key,intent);if(valid()){const current=await client.detail(selected.id,signal);if(valid()){detail=current;editor=null;}}}throw error;}
  });
 };
 /** Explicit, confirmed resend of one retained removal or restore under its original identity. A receipt releases it
  * as applied. A refusal says only that this copy was not applied: an earlier copy may still be on its way, so the
  * request is released only once the workflow has moved to another version, which no copy can then apply to.
  * Otherwise, and on any other failure, it stays retained and can be sent again. */
 const resendLifecycle=(selected:RemoteWorkflow,request:NonNullable<typeof unsentLifecycle>)=>{
  const key=lifecycleKey(selected.id);
  void work(async(client,signal,valid,_session,intents)=>{
   unsentLifecycle=null;
   if(await intents.read(key,signal)!==request.raw)throw new Error('Retained lifecycle request changed');
   let refusal:unknown=null;
   try{await client.resendLifecycle(selected.id,request.versionId,request.mutationId,request.operation,signal);}
   catch(error){if(!(error instanceof WorkflowLifecycleRejected))throw error;refusal=error;}
   if(refusal){
    // As when the workflow is opened, the workflow is read before the receipt.
    const current=await client.detail(selected.id,signal),held=await client.reconcileLifecycle(selected.id,request.versionId,request.mutationId,request.operation,signal);
    if(!held){
     if(current.versionId!==request.versionId)await intents.acknowledge(key,request.raw);
     else if(valid())unsentLifecycle=request;
     if(valid()){const history=await client.executions(selected.id,signal);if(valid()){detail=current;runs=history;}}
     throw refusal;
    }
   }
   await intents.acknowledge(key,request.raw);
   if(valid()){const current=await client.detail(selected.id,signal);if(valid()){detail=current;flows=flows.filter(f=>f.id!==selected.id);api?.toast(current.removed?'Removed · History kept':'Restored · Paused');}}
  });
 };
 const lifecycle=()=>{if(!detail||operation)return;if(lifecycleLocked(detail.id)){
   // Without a fresh "no receipt" answer for the version on screen, the tap only reads the receipt again.
   const request=unsentLifecycle?.workflowId===detail.id&&unsentLifecycle.versionId===detail.versionId?unsentLifecycle:null;
   if(!request){void open(detail.id);return;}
   if(!reviewLifecycleResend){reviewLifecycleResend=true;api?.toast('Confirm resend');publish();return;}
   reviewLifecycleResend=false;resendLifecycle(detail,request);return;}if(!lifecycleAvailable){api?.toast('Not supported');return;}const interrupted=runs.filter(runOutcomeUnknown);if(runs.some(r=>!r.finished&&!runOutcomeUnknown(r))){api?.toast('Cancel runs first');return;}
  // Upstream plugin-workflow refuses removal while any execution is unfinished and has no
  // acknowledgement-only API. The supported path is an explicit, confirmed cancellation of each
  // interrupted run; removing past an unknown outcome without cancelling requires a tested change to the upstream workflow runtime.
  if(interrupted.length){if(!unknownReview){unknownReview=true;lifecycleReview=true;publish();return;}const selected=detail;unknownReview=false;lifecycleReview=false;void work(async(client,signal,valid)=>{let failed=0;for(const r of interrupted){try{await client.cancel(r.id,r.workflowId,signal);}catch(error){if(signal.aborted)throw error;failed++;}}const history=await client.executions(selected.id,signal),current=await client.detail(selected.id,signal);if(valid()){runs=history;detail=current;api?.toast(failed?'Some interrupted runs could not be cancelled. Removal stays blocked; refresh and review them.':history.some(r=>!r.finished)?'Cancellation requested. Removal stays blocked until the agent confirms every run has stopped.':'Interrupted runs cancelled; their earlier outcome remains unknown. Tap Remove again to review removal.');}});return;}if(detail.removed&&detail.triggerCleanup==='pending'){api?.toast('Scheduled trigger cleanup is pending on the agent. Restore is blocked until cleanup is confirmed.');return;}if(!lifecycleReview){lifecycleReview=true;publish();return;}const selected=detail,operationName=selected.removed?'restore':'remove',key=lifecycleKey(selected.id);lifecycleReview=false;void work(async(client,signal,valid,_session,intents)=>{let intent:string|undefined;try{await client.lifecycle(selected.id,selected.versionId,operationName,signal,async mutationId=>{intent=await intents.admit(key,{mutationId,versionId:selected.versionId,operation:operationName},signal);await beforeDispatch(intents,key,intent,signal,valid);});if(intent)await intents.acknowledge(key,intent);if(valid()){const current=await client.detail(selected.id,signal);if(valid()){detail=current;flows=flows.filter(f=>f.id!==selected.id);api?.toast(current.removed?'Workflow removed; execution history retained.':manualPhoneWorkflow(current)?'Workflow restored paused. It has no schedule and runs only when you tap Run now.':'Workflow restored paused. Review its schedule before enabling.');}}}catch(error){if(error instanceof WorkflowLifecycleRejected){if(intent)await intents.acknowledge(key,intent);if(valid()){const current=await client.detail(selected.id,signal),history=await client.executions(selected.id,signal);if(valid()){detail=current;runs=history;}}}throw error;}});};
 view.back=()=>{if(authoring.active){authoring.close();return true;}if(lifecycleReview){lifecycleReview=false;unknownReview=false;publish();return true;}if(reviewLifecycleResend){reviewLifecycleResend=false;publish();return true;}if(editor){cancelEdit();return true;}if(receipt){receipt=null;approvalReceipt=null;approvalReview=null;reviewCancel=false;reviewRerun=false;publish();return true;}if(detail){detail=null;reviewRun=false;reviewResend=false;reviewClear=false;reviewLifecycleResend=false;publish();return true;}return false;};view.onLeave=()=>clear(true);
 view.render=(_state:Bag,current:Bag)=>{api=current;const binding=connectionController.getWorkflowClient();if(!view.automationsManaged&&phase==='idle'&&binding&&current.isActive()){phase='scheduled';queueMicrotask(()=>{if(api?.isActive())void refresh();});}
 const track=(on:boolean)=>current.track(on),kx=(on:boolean)=>current.kx(on);
 const waitingSession=connectionController.getSnapshot().session?.sessionId;
 const cards:Bag[]=flows.map(f=>({name:f.name,short:f.description||'Agent workflow',statusLabel:f.removed?'Removed':poster.waiting(waitingSession,f.id)?'Waiting for you':f.active?'Active':'Paused',on:f.active,track:track(f.active),kx:kx(f.active),dim:'',failed:false,open:()=>void open(f.id),toggle:()=>{void open(f.id);}}));
 cards.unshift({name:phase==='busy'?'Loading workflows…':binding?status:(agentAvailabilityNotice(connectionController.getSnapshot(),'Connect agent')||'Workflows'),short:binding?'':residentAlwaysPresent||!testMocksEnabled?'Agent offline':'Connect agent',on:false,track:track(false),kx:kx(false),dim:'',failed:false,open:()=>binding?void refresh():connectionController.open(),toggle:()=>binding?void refresh():connectionController.open()});
 if(lifecycleAvailable)cards.push({name:removedList?'Active workflows':'Removed workflows',short:'',busy:!!operation,on:false,track:track(false),kx:kx(false),dim:'',failed:false,open:()=>{if(operation)return;removedList=!removedList;detail=null;void refresh();},toggle:()=>{}});
 for(const id of operation||phase==='scheduled'?[]:pendingLifecycle())if(!flows.some(f=>f.id===id))cards.push({name:'Pending',short:'',on:false,track:track(false),kx:kx(false),dim:'',failed:false,open:()=>void open(id),toggle:()=>{}});
 // A tapped notification this session could not open is offered here until it opens or is dismissed. With none
 // waiting there is no row: a notification tap opens its run by itself.
 if(Capacitor.isNativePlatform()&&(heldTap||tapUnopened))cards.push({name:'Open notification',short:'Couldn’t open it yet',on:false,track:track(false),kx:kx(false),dim:'',failed:false,open:()=>void checkNotice('user'),toggle:()=>{}});
 if(Capacitor.isNativePlatform()&&heldTap)cards.push({name:'Dismiss notification',short:'',on:false,track:track(false),kx:kx(false),dim:'',failed:false,open:dismissTap,toggle:()=>{}});
 const hasDeviceSteps=!!receipt&&runHasDeviceSteps(receipt,detail,phoneReview);
 const phonePending=!!receipt&&!receipt.finished&&(phoneSteps.length>0||(hasDeviceSteps&&receipt.status==='waiting-approval'));
 const phoneReconcile=!!receipt&&hasDeviceSteps&&(phonePending||receipt.reconciliation?.state==='outcome-unknown');
 const phoneAvailable=phonePending||phoneReconcile;
 /** P-10: a missed scheduled time is never replayed; it offers an explicit Run now, which goes through the workflow's own reviewed run confirmation as a new run. Only a typed scheduled workflow offers it: the agent admits a hosted digest only at its own scheduled occurrence and refuses a manual run. */
 const missedRunNow=(r:WorkflowRun)=>r.finished&&r.occurrence?.status==='missed'&&!!detail&&detail.id===r.workflowId&&!detail.removed&&!!scheduledPhoneTrigger(detail);
 const closeReceipt=()=>{receipt=null;approvalReceipt=null;approvalReview=null;reviewCancel=false;reviewRerun=false;publish();};
 const runIcon=(r:WorkflowRun)=>r.occurrence?.status==='missed'||r.occurrence?.status==='overlap'?current.ic.minus:runOutcomeUnknown(r)?current.ic.info:!r.finished?current.ic.clock:/fail|error/i.test(r.status)?current.ic.x:/cancel/i.test(r.status)?current.ic.stop:current.ic.check;
 const history=runs.map(r=>({when:r.occurrence?'Scheduled '+formatDateTime(new Date(r.occurrence.scheduledAt)):formatDateTime(new Date(r.startedAt)),sum:workflowRunLabel(r),label:`${workflowRunLabel(r)} execution`,d:runIcon(r),css:'background:var(--s2)',open:()=>void read(r)}));
 return {cards,managementCards:cards.slice(flows.length+1),removedList,waitingFor:(id:string)=>poster.waiting(connectionController.getSnapshot().session?.sessionId,id),openWorkflow:(id:string)=>void open(id),newFlow:()=>void authoring.open(),builder:authoring.active||!!editor,b:authoring.active?authoring.render(current):editor?{metadataOnly:true,fullEditor:false,name:editor.name,description:editor.description,onName:(event:Bag)=>{if(editor&&!operation){editor.name=String(event.target.value);publish();}},onDescription:(event:Bag)=>{if(editor&&!operation){editor.description=String(event.target.value);publish();}},saveOff:phase==='busy'||metadataLocked(editor.id)||!editor.name.trim()||editor.name.length>200||editor.description.length>4000,saveCss:'background:var(--acc);color:#fff',save:saveMetadata,cancel:cancelEdit,metadataStatus:metadataLocked(editor.id)?'Unknown':'',unknown:metadataLocked(editor.id),refresh:()=>void open(editor!.id),steps:[],palette:[],hasApps:false,empty:false,sheetOn:false}:null,detail:!!detail,runOpen:!!receipt,noop:()=>{},fd:detail?{deleteLabel:unsentLifecycle?.workflowId===detail.id&&unsentLifecycle.versionId===detail.versionId?(reviewLifecycleResend?'Confirm resend':'Resend'):detail.removed?'Restore workflow':'Remove workflow',lifecycleReview,lifecycleText:unknownReview?`${runs.filter(runOutcomeUnknown).length} interrupted. Completed actions stay.`:detail.removed?'Restore paused; review before enabling.':'Keeps history; stops future runs.',lifecycleLabel:unknownReview?'Cancel runs':detail.removed?'Confirm restore':'Remove',lifecycleConfirm:lifecycle,lifecycleCancel:()=>{lifecycleReview=false;unknownReview=false;publish();},name:detail.name,summary:detail.description||'',on:detail.active,track:track(detail.active)+(detail.removed||(!detail.active&&manualPhoneWorkflow(detail))?';opacity:.45':''),kx:kx(detail.active),toggle:()=>detail?.removed?api?.toast('Restore first'):detail?.active?pause():activate(),toggleOff:!!detail.removed||(!detail.active&&manualPhoneWorkflow(detail)),confirmToggle:reviewActivation&&!detail.active,runLabel:unverifiable?.workflowId===detail.id&&locked(detail.id)?(reviewClear?'Confirm clear':'Clear request'):unadmitted?.workflowId===detail.id&&unadmitted.versionId===detail.versionId&&locked(detail.id)?(reviewResend?'Confirm resend':'Resend'):reviewRun?'Confirm run':'Run',runAria:unverifiable?.workflowId===detail.id&&locked(detail.id)?(reviewClear?'Confirm clearing earlier run request':'Clear earlier run request'):unadmitted?.workflowId===detail.id&&unadmitted.versionId===detail.versionId&&locked(detail.id)?(reviewResend?'Confirm resend':'Resend'):reviewRun?'Confirm run':'Run now',mayHaveRun:!!intentStore&&!intentStore.stale&&!lifecycleLocked(detail.id)&&!detail.removed&&!metadataLocked(detail.id)&&!detail.hostedDigest&&!noSchedule&&!(unadmitted?.workflowId===detail.id&&unadmitted.versionId===detail.versionId)&&(locked(detail.id)||runs.some(runOutcomeUnknown)),checking:(!intentStore||intentStore.stale)&&phase==='busy',delOff:!lifecycleAvailable&&!lifecycleLocked(detail.id),delCss:!lifecycleAvailable&&!lifecycleLocked(detail.id)?'opacity:.45':'',apps:[],hasApps:false,steps:detail.steps.map((step,i)=>({k:'Step',t:step.description||step.label,d:current.ic.check,label:step.label,dotCss:'background:var(--s2)',lineColor:i===detail!.steps.length-1?'transparent':'var(--line)',boxCss:'background:var(--s2)',kindColor:'var(--mut)',tap:()=>{}})),isRunning:runs.some(r=>r.workflowId===detail!.id&&!r.finished&&!r.reconciliation&&r.status==='running'),busy:phase==='busy',notRunning:!detail.removed&&!detail.hostedDigest,digestLink:detail.hostedDigest&&!detail.removed?()=>{window.dispatchEvent(new Event('alpha:hosted-digests'));}:null,last:(!intentStore||intentStore.stale)?(phase==='busy'?'Checking':'Check history'):lifecycleLocked(detail.id)?(unsentLifecycle?.workflowId===detail.id&&unsentLifecycle.versionId===detail.versionId?(reviewLifecycleResend?'Confirm resend':'Not received'):'Unknown'):detail.removed?'Removed':metadataLocked(detail.id)?'Unknown':detail.hostedDigest?'In Digests':noSchedule?'Manual':unadmitted?.workflowId===detail.id&&unadmitted.versionId===detail.versionId&&locked(detail.id)?(reviewResend?'Not received · Resend once':'Not received'):unverifiable?.workflowId===detail.id&&locked(detail.id)?(reviewClear?'Confirm clear · Nothing sent':'Check runs · Clear request'):locked(detail.id)?'Check before running again':runs.some(runOutcomeUnknown)?(readOnlyDigestWorkflow(detail)?'Interrupted · open to run again':'Interrupted · cancel first'):reviewActivation?(scheduledPhoneTrigger(detail)?enableReview(detail):''):reviewRun?'':(()=>{const schedule=scheduledPhoneTrigger(detail);return schedule?describePhoneTrigger(schedule):detail.active?'On':'Paused';})(),runs:history,hasRuns:!!runs.length,close:()=>{detail=null;lifecycleReview=false;reviewResend=false;reviewLifecycleResend=false;publish();},edit,del:lifecycle,run}:null,
 r:receipt?{phoneAvailable,phoneReviewAvailable:phonePending,phoneSyncAvailable:phoneReconcile,phoneInspectAvailable:!receipt.finished&&!phoneAvailable&&detail?.versionId!==receipt.versionId&&(receipt.status==='waiting-approval'||runOutcomeUnknown(receipt)),phoneNotice:phoneAvailable?'':phoneStatus,mayHaveRun:receipt.reconciliation?.state==='outcome-unknown',notice:reviewCancel?'Completed actions stay.':receipt.reconciliation?.state==='outcome-unknown'?'Check before running again':runWorkerRunning(receipt)||!receipt.finished?'Running':'',versionNotice:detail&&detail.id===receipt.workflowId&&detail.versionId!==receipt.versionId?'Older version':'',showRefresh:!receipt.finished||!!receipt.reconciliation,phoneReview:reviewPhone,phoneSync:syncPhone,phoneBusy:phase==='busy',phoneSpeaking:phase==='busy'&&phoneSteps.some(p=>p.title==='speak text'),phoneStopSpeech:()=>window.dispatchEvent(new Event('alpha:stop-workflow-speech')),phoneStatus,phoneSteps:phoneSteps.map(proposal=>({title:proposal.title==='speak text'?'Read aloud':proposal.title==='post notification'?'Post notification':proposal.title,description:proposal.reviewScope??proposal.description,identity:proposal.reviewIdentity||'',hasIdentity:!!proposal.reviewIdentity,expires:formatDateTime(new Date(proposal.expiresAt)),disabled:phase==='busy'||proposal.expiresAt<=Date.now(),approveLabel:phoneConfirm===proposal.id+':true'?'Confirm approve':'Approve',denyLabel:phoneConfirm===proposal.id+':false'?'Confirm deny':'Deny',approve:()=>decidePhone(proposal,true),deny:()=>decidePhone(proposal,false)})),approvals:(approvalReceipt?.approvals??[]).map(a=>({title:a.title||'Workflow approval',summary:a.summary,identity:a.nodeId+' · '+a.iteration+' · '+a.workflowVersionId,disclosure:[a.operation,a.target,a.account].filter(Boolean).join(' · '),status:a.status==='pending'?(!intentStore||intentStore.stale?'Check history':approvalReceipt?.finished||approvalReceipt?.cancellationRequested?'Closed':approvalLocked(receipt!)?'Unknown':!a.supported?'Approve in agent':approvalReview?.digest===a.requestDigest?'':'Waiting'):a.status,canDecide:a.status==='pending'&&!approvalReceipt?.finished&&!approvalReceipt?.cancellationRequested&&!approvalLocked(receipt!),approveDisabled:phase==='busy'||!a.supported,denyDisabled:phase==='busy',approveLabel:approvalReview?.digest===a.requestDigest&&approvalReview.approved?'Confirm approve':'Approve',denyLabel:approvalReview?.digest===a.requestDigest&&!approvalReview.approved?'Confirm deny':'Deny',approve:()=>decide(a,true),deny:()=>decide(a,false)})),when:formatDateTime(new Date(receipt.startedAt)),flow:detail?.name||'Workflow',status:workflowRunLabel(receipt),sd:runIcon(receipt),scss:'background:var(--s2)',log:[{k:'Execution',t:receipt.id},{k:'Version',t:receipt.versionId},{k:'Status',t:receipt.finished&&receipt.occurrence?.status==='missed'?'Missed':receipt.finished&&receipt.occurrence?.status==='overlap'?'Skipped':runOutcomeUnknown(receipt)?'Interrupted':runWorkerRunning(receipt)?'Running':receipt.finished?'Finished':'Unknown'},...(receipt.reconciliation?[{k:'Reconciliation',t:receipt.reconciliation.message||receipt.reconciliation.state}]:[]),...(receipt.stoppedAt?[{k:'Stopped',t:receipt.stoppedAt}]:[]),...receipt.events.map(e=>({k:e.type,t:[e.at,e.node].filter(Boolean).join(' · ')}))].map(e=>({...e,kd:current.ic.clock,d:current.ic.clock,css:'background:var(--s2)',line:'transparent',tcss:''})),hasOut:!!receipt.output,out:receipt.output||'',hasFix:!!receipt.error,fix:receipt.error||'',askLabel:'Refresh',askAria:'Refresh',...(()=>{const rerun=runOutcomeUnknown(receipt)&&readOnlyDigestWorkflow(detail)&&detail?.id===receipt.workflowId,missed=missedRunNow(receipt);return {againLabel:missed?'Run now':receipt.finished?'Done':rerun?(reviewRerun?'Confirm new run':'Run again'):reviewCancel?'Confirm cancel':'Cancel run',againAria:missed?'Review and run now':receipt.finished?'Back to workflow':rerun?(reviewRerun?'Confirm new run':'Run again'):reviewCancel?'Confirm cancel':'Cancel run'};})(),againDisabled:phase==='busy',close:closeReceipt,ask:()=>void read(receipt!),again:()=>receipt&&missedRunNow(receipt)?(reviewRun=false,reviewResend=false,closeReceipt(),run()):receipt?.finished?closeReceipt():runOutcomeUnknown(receipt!)&&readOnlyDigestWorkflow(detail)&&detail?.id===receipt!.workflowId?runAgain():cancel()}:null};};
 const update=p.componentDidUpdate;p.componentDidUpdate=function(...args:unknown[]){update?.apply(this,args);syncHome();};
 const mount=p.componentDidMount,unmount=p.componentWillUnmount;p.componentDidMount=function(){mount.call(this);owner=this;this.workflowIntentChanged=()=>refreshIntents();window.addEventListener('alpha:workflow-intents',this.workflowIntentChanged);window.addEventListener('storage',this.workflowIntentChanged);if(typeof BroadcastChannel!=='undefined'){this.workflowIntentChannel=new BroadcastChannel('alpha.workflow-intents');this.workflowIntentChannel.onmessage=(event:MessageEvent)=>{if(event.data===intentStore?.documentKey)refreshIntents();};}if(Capacitor.isNativePlatform()){this.workflowNoticeListener=notificationNative().addListener('pendingWorkflowTap',()=>{void checkNotice('event');}).catch(()=>null);queueMicrotask(()=>void checkNotice());this.workflowPoster=setInterval(()=>void poster.poll(true),60_000);queueMicrotask(()=>void poster.poll());}
  // A notification tap can land while the window regains focus without a visibility change.
  this.workflowFocus=()=>{void checkNotice('event');void poster.poll();};window.addEventListener('focus',this.workflowFocus);retireOtherOwnerNotices();let session=connectionController.getSnapshot().session?.sessionId;this.workflowUnsubscribe=connectionController.subscribe(()=>{retireOtherOwnerNotices();const next=connectionController.getSnapshot().session?.sessionId;if(next!==session||connectionController.getSnapshot().open){session=next;clear();}if(!connectionController.getSnapshot().open)queueMicrotask(()=>{void checkNotice();void poster.poll();});syncHome();});suspended=document.hidden;this.workflowSuspend=()=>{suspended=true;clear();};this.workflowResume=()=>{suspended=false;retireOtherOwnerNotices();publish();void checkNotice('event');void poster.poll(true);syncHome();};this.workflowVisibility=()=>{if(document.hidden)this.workflowSuspend();else this.workflowResume();};document.addEventListener('visibilitychange',this.workflowVisibility);window.addEventListener('pagehide',this.workflowSuspend);window.addEventListener('pageshow',this.workflowResume);syncHome();};p.componentWillUnmount=function(){window.removeEventListener('alpha:workflow-intents',this.workflowIntentChanged);window.removeEventListener('focus',this.workflowFocus);clearInterval(this.workflowPoster);window.removeEventListener('storage',this.workflowIntentChanged);this.workflowIntentChannel?.close();document.removeEventListener('visibilitychange',this.workflowVisibility);window.removeEventListener('pagehide',this.workflowSuspend);window.removeEventListener('pageshow',this.workflowResume);this.workflowUnsubscribe?.();void this.workflowNoticeListener?.then((listener:any)=>listener?.remove());owner=null;clear();unmount.call(this);};
}
