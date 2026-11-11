import {HostedDigestProtocol} from './hosted-digests';
import {normalizePhoneSpec,type PhoneSpec} from './phone-workflow-authoring';
import type {WorkflowDeviceTarget} from './workflow-device-contract';
import {WorkflowClient,WorkflowHttpError,WorkflowLifecycleRejected,type PhoneWorkflowSaveExpectation,type WorkflowLifecycleReceipt,type WorkflowRequest} from '../../../../.eliza/client-features/packages/contracts/src/workflow-client.ts';
import type {PhoneWorkflowCatalog,PhoneWorkflowSpec} from '../../../../.eliza/client-features/packages/contracts/src/phone-workflow.ts';
/** The receipt-checked workflow route client is the shared `@elizaos/contracts/workflow-client`.
 * The phone-step review read (`phoneReview`) is shared too; Alpha only adds its digest result routes and keeps the
 * development enrollment labels (test-mocks builds only) through its spec normalizer. */
export {WorkflowHttpError,WorkflowAdmissionRejected,WorkflowTypedRejected,WorkflowMetadataRejected,WorkflowLifecycleRejected,WorkflowActivationRejected} from '../../../../.eliza/client-features/packages/contracts/src/workflow-client.ts';
export type {RemoteWorkflow,WorkflowRun,WorkflowRunReconciliation,WorkflowRunOccurrence,WorkflowApproval,WorkflowApprovalReceipt,WorkflowMetadataReceipt,WorkflowLifecycleReceipt} from '../../../../.eliza/client-features/packages/contracts/src/workflow-client.ts';
/** The shared client reads a generic schedule's missed occurrence only from the engine-written
 * `missedOccurrenceAt` (elizaOS/eliza#38100), so Alpha adds no run filtering of its own. */
export class WorkflowProtocol extends WorkflowClient {
 constructor(request:WorkflowRequest){
  super(request,{normalizePhoneSpec:value=>normalizePhoneSpec(value) as unknown as PhoneWorkflowSpec});
 }
 // The editor's loosely indexed PhoneSpec is normalized by the shared validator on every path.
 override generatePhone(prompt:string,catalog:PhoneWorkflowCatalog,operations:string[],signal:AbortSignal,existing?:PhoneSpec,device?:WorkflowDeviceTarget){return super.generatePhone(prompt,catalog,operations,signal,existing as unknown as PhoneWorkflowSpec|undefined,device);}
 override validatePhone(spec:PhoneSpec,catalog:PhoneWorkflowCatalog,signal:AbortSignal){return super.validatePhone(spec as unknown as PhoneWorkflowSpec,catalog,signal);}
 override savePhone(spec:PhoneSpec,catalog:PhoneWorkflowCatalog,expected:PhoneWorkflowSaveExpectation,signal:AbortSignal){return super.savePhone(spec as unknown as PhoneWorkflowSpec,catalog,expected,signal);}
 /** An agent without submission identities cannot refuse a version it was not asked for, so the reviewed version is
  * compared here for every accepted run. A run of another version is reported; it is never shown as the accepted run. */
 override async run(id:string,version:string,signal:AbortSignal,beforeSubmit?:(submissionId?:string)=>void|Promise<void>){
  const run=await super.run(id,version,signal,beforeSubmit);
  if(run.versionId!==version)throw new Error('Execution identity or reviewed version changed');
  return run;
 }
 /** Sends one retained reviewed removal or restore again under its original identity. The agent applies a mutation
  * ID at most once and answers a repeat with the receipt it already holds, so this can never apply a second change.
  * A refusal naming this exact request says only that this copy was not applied; an earlier copy may still arrive.
  * The receipt is read back through the checked route. */
 async resendLifecycle(id:string,version:string,mutationId:string,operation:'remove'|'restore',signal:AbortSignal):Promise<WorkflowLifecycleReceipt>{
  const held=await this.reconcileLifecycle(id,version,mutationId,operation,signal);
  if(held)return held;
  signal.throwIfAborted();
  try{await this.request(`/api/workflow/workflows/${encodeURIComponent(id)}/lifecycle`,{mutationId,expectedVersionId:version,operation},signal);}
  catch(error){
   if(error instanceof WorkflowHttpError&&error.status===409&&error.code==='WORKFLOW_LIFECYCLE_NOT_APPLIED'&&error.workflowId===id&&error.mutationId===mutationId&&error.expectedVersionId===version)throw new WorkflowLifecycleRejected();
   throw error;
  }
  const receipt=await this.reconcileLifecycle(id,version,mutationId,operation,signal);
  if(!receipt)throw new Error('Lifecycle outcome unknown');
  return receipt;
 }
 hosted(){return new HostedDigestProtocol(this.request);}
}
