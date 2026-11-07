import {isReminderCreate,validateReminderCreate,validateReminderCreateResult} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-create-contract.ts';
import {actionScope} from './device-actions';
import {isReminderOperation,validateReminderOperation,validateReminderResult} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-contract.ts';
import type {ActionJournal} from './device-actions';
// The host storage bridge exists only on the development server with
// test mocks or the explicit private local preview, matching local-agent.ts. Node
// contract tests import this module without Vite and pass their own request.
const developmentBridgeAllowed:boolean=import.meta.env!==undefined&&import.meta.env.DEV===true&&(import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS==='1'||(import.meta.env.VITE_ALPHA_PRIVATE_LOCAL_PREVIEW==='1'&&import.meta.env.VITE_LOCAL_AGENT==='1'));
const operation:(input:Record<string,unknown>)=>Promise<any>=developmentBridgeAllowed?async input=>{
 const response=await fetch('/__alpha-local-agent',{method:'POST',headers:{'Content-Type':'application/json','X-Alpha-Local-Agent':'1'},body:JSON.stringify({storage:input}),signal:AbortSignal.timeout(15000),redirect:'error'});
 if(!response.ok)throw Error('Development device storage unavailable');return response.json();
}:async()=>{throw Error('Device storage is unavailable here.');};
export const developmentDeviceStore={
 async read<T>(slot:string):Promise<T|null>{return (await operation({operation:'read',slot})).value;},
 async write(slot:string,value:unknown){await operation({operation:'write',slot,value});},
};
export const developmentWorkflowDraftStore={
 secureRead:(input:{slot:string})=>operation({...input,operation:'draftRead'}),
 secureCompareExchange:(input:{slot:string;expectedValue:string|null;value:string|null})=>operation({...input,operation:'draftCompareExchange'}),
};
export const developmentActionJournal:ActionJournal={
 reserve:input=>operation({...input,operation:'reserve'}),
 markApplying:input=>operation({...input,operation:'markApplying'}),
 finish:input=>operation({...input,operation:'finish'}),
 recoverNotification:async input=>{
  const {entry}=await operation({...input,operation:'get'});if(!entry)throw Error('Notification journal is missing');
  if(entry.phase==='terminal'&&entry.status!=='unknown')return {entry};
  const effect=entry.record.operation;if(effect?.type!=='post_notification'||!entry.record.workflow||!entry.attemptId||entry.phase!=='applying'&&!(entry.phase==='terminal'&&entry.status==='unknown'))throw Error('Notification recovery requires an admitted workflow attempt');
  const binding=await actionScope(JSON.stringify([input.scope,entry.record.ownerId,entry.record.agentId,entry.record.sessionId,entry.record.origin,entry.record.installationId,entry.record.enrollmentId,input.proposalId,entry.record.digest,entry.operationId]));
  if(binding!==input.bindingHash||await actionScope(JSON.stringify(effect))!==entry.operationHash)throw Error('Notification recovery binding changed');
  const {workflowNoticeReceipt}=await import('../browser/workflow-notices');const receipt=await workflowNoticeReceipt(entry.operationId,effect.title,effect.body,input.bindingHash,AbortSignal.timeout(15000));if(receipt.status!=='succeeded')return {entry};
  return operation({...input,operation:'recoverNotification',expectedEntry:entry});
 },
 recoverDeletion:async input=>{
  const {entry}=await operation({...input,operation:'get'});if(!entry)throw Error('Deletion journal missing');
  if(entry.phase==='terminal'&&entry.status!=='unknown')return {entry};
  const {deletions}=await import('./deletions');const {recovery}=await deletions.receipt({entry});if(!recovery)return {entry};
  return operation({...input,operation:'recoverDeletion',expectedEntry:entry,recovery});
 },
 recoverReminder:async input=>{
  const {entry}=await operation({...input,operation:'get'});if(!entry)throw Error('Reminder journal is missing');
  if(entry.phase==='terminal'&&entry.status!=='unknown')return {entry};
  const effect=isReminderCreate(entry.record.operation)?validateReminderCreate(entry.record.operation):validateReminderOperation(entry.record.operation);if(!(isReminderOperation(effect)||isReminderCreate(effect))||!entry.attemptId||entry.phase!=='applying'&&entry.status!=='unknown')throw Error('Reminder recovery requires an admitted attempt');
  const binding=await actionScope(JSON.stringify([input.scope,entry.record.ownerId,entry.record.agentId,entry.record.sessionId,entry.record.origin,entry.record.installationId,entry.record.enrollmentId,input.proposalId,entry.record.digest,entry.operationId]));
  if(binding!==input.bindingHash||await actionScope(JSON.stringify(effect))!==entry.operationHash)throw Error('Reminder recovery binding changed');
  const {DailyApps}=await import('../daily');const receipt=await DailyApps.reminderOperationReceipt({operationId:entry.operationId,bindingHash:input.bindingHash,operation:effect});if(receipt.status!=='succeeded')return {entry};
  const reminderResult=isReminderCreate(effect)?validateReminderCreateResult(effect,receipt.result,entry.operationId):validateReminderResult(effect,receipt.result);
  return operation({...input,operation:'recoverReminder',expectedEntry:entry,reminderResult});
 },
 get:input=>operation({...input,operation:'get'}),
 list:input=>operation({...input,operation:'list'}),
};

// One store per selected connection. CAS prevents stale tabs from overwriting
// result indexes or clearing another tab's uncertain mutation recovery record.
export function developmentDigestStore(request:typeof operation=operation) {
 const observed=new Map<string,string|null>();
 async function read<T>(slot:string):Promise<T|null>{
  const {value}=await request({operation:'digestRead',slot});
  observed.set(slot,value);return value===null?null:JSON.parse(value) as T;
 }
 async function save(slot:string,value:string|null){
  if(!observed.has(slot))await read(slot);
  const expectedValue=observed.get(slot)!;
  if(slot.endsWith(':pending')&&expectedValue!==null&&value!==null&&expectedValue!==value)throw Error('A digest request is already awaiting recovery');
  const result=await request({operation:'digestCompareExchange',slot,expectedValue,value});
  if(result.status!=='saved')throw Error('Digest storage changed in another tab. Refresh before continuing.');
  observed.set(slot,value);
 }
 return {read,write:(slot:string,value:unknown)=>save(slot,JSON.stringify(value)),remove:(slot:string)=>save(slot,null)};
}
