import {validateCalendarOperation,validateCalendarResult} from '../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/calendar-contract.ts';
import {isReminderCreate,validateReminderCreate,validateReminderCreateResult} from '../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-create-contract.ts';
import {validateReminderOperation,validateReminderResult} from '../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-contract.ts';
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {sha256} from './sha256.ts';
// Development only. Synchronous atomic mutations serialize all browser tabs in
// the owning Vite process. Production uses the native journal and Keystore.
export function localAgentStorage(directory:string,input:any):unknown {
 mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
 const {operation}=input;
 const scoped=typeof input.scope==='string'&&/^[a-f0-9]{64}$/.test(input.scope);
 const identified=typeof input.proposalId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(input.proposalId);
 const digestOperation=operation==='digestRead'||operation==='digestCompareExchange';
 const draftOperation=operation==='draftRead'||operation==='draftCompareExchange';
 const slot=operation==='read'||operation==='write'||draftOperation||digestOperation?input.slot:`journal:${input.scope}`;
 if(typeof slot!=='string'||!(digestOperation?/^(?:renderer-)?hosted-digests:v1:[a-f0-9]{64}(?::[A-Za-z0-9][A-Za-z0-9_-]{0,127})?$/:draftOperation?/^workflow-draft:v1:[a-f0-9]{64}$/:/^(device|journal):[a-f0-9]{64}$/).test(slot))throw Error('Invalid local storage scope');
 const file=join(directory,sha256(slot)+'.json');
 const saved=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):null;
 const write=(value:unknown)=>{const bytes=JSON.stringify(value);if(Buffer.byteLength(bytes)>2*1024*1024)throw Error('Local storage limit');const temporary=file+'.'+randomUUID();writeFileSync(temporary,bytes,{mode:0o600,flag:'wx'});renameSync(temporary,file);};
 if(digestOperation){
  const valid=(value:unknown)=>value===null||(typeof value==='string'&&Buffer.byteLength(value)<=800000);
  if(!valid(saved))throw Error('Invalid saved digest record');
  if(operation==='digestRead')return {value:saved};
  if(!valid(input.expectedValue)||!valid(input.value))throw Error('Invalid digest record');
  if(saved!==input.expectedValue)return {status:'conflict'};
  write(input.value);return {status:'saved'};
 }
 if(draftOperation){
  const valid=(value:unknown)=>value===null||(typeof value==='string'&&Buffer.byteLength(value)<=100000);
  if(!valid(saved))throw Error('Invalid saved workflow draft');
  if(operation==='draftRead')return {value:saved};
  if(!valid(input.expectedValue)||!valid(input.value))throw Error('Invalid workflow draft');
  if(saved!==input.expectedValue)return {status:'conflict'};
  write(input.value);return {status:'saved'};
 }
 if(operation==='read')return {value:saved};
 if(operation==='write'){
  if(!slot.startsWith('device:')||!input.value||!/^[a-f0-9]{64}$/.test(input.value.key)||!/^[a-f0-9-]{36}$/.test(input.value.installationId))throw Error('Invalid device credential');
  if(saved&&(saved.key!==input.value.key||saved.installationId!==input.value.installationId))throw Error('Device identity changed');
  write(input.value);return {};
 }
 if(!scoped)throw Error('Invalid journal scope');
 const entries=saved||{};
 if(operation==='list')return {entries:Object.values(entries)};
 if(!identified)throw Error('Invalid journal proposal');
 const previous=Object.hasOwn(entries,input.proposalId)?entries[input.proposalId]:null;
 if(operation==='get')return {entry:previous};
 if(operation==='reserve'){
  if(previous){if(previous.operationId!==input.operationId||previous.operationHash!==input.operationHash)throw Error('Journal identity conflict');return {created:false,entry:previous};}
  if(!/^[a-f0-9]{64}$/.test(input.operationHash)||typeof input.operationId!=='string'||!input.record||typeof input.record!=='object')throw Error('Invalid journal reservation');
  const entry={scope:input.scope,proposalId:input.proposalId,operationId:input.operationId,operationHash:input.operationHash,record:input.record,phase:'reserved'};
  entries[input.proposalId]=entry;write(entries);return {created:true,entry};
 }
 if(!previous)throw Error('Journal reservation missing');
 if(operation==='markApplying'){
  if(previous.phase==='applying'&&previous.attemptId===input.attemptId)return {};
  if(previous.phase!=='reserved'||typeof input.attemptId!=='string'||!input.attemptId)throw Error('Invalid journal transition');
  entries[input.proposalId]={...previous,phase:'applying',attemptId:input.attemptId};write(entries);return {};
 }
 if(operation==='recoverNotification'){
  if(JSON.stringify(previous)!==JSON.stringify(input.expectedEntry))throw Error('Notification journal changed. Refresh history.');
  if(previous.phase==='terminal'&&previous.status!=='unknown')return {entry:previous};
  const effect=previous.record.operation,hash=(value:unknown)=>sha256(JSON.stringify(value));
  if(!previous.attemptId||previous.phase!=='applying'&&!(previous.phase==='terminal'&&previous.status==='unknown')||effect?.type!=='post_notification'||!previous.record.workflow)throw Error('Notification recovery requires an admitted workflow attempt');
  const binding=hash([input.scope,previous.record.ownerId,previous.record.agentId,previous.record.sessionId,previous.record.origin,previous.record.installationId,previous.record.enrollmentId,input.proposalId,previous.record.digest,previous.operationId]);
  if(binding!==input.bindingHash||hash(effect)!==previous.operationHash)throw Error('Notification recovery binding changed');
  const entry={...previous,phase:'terminal',status:'succeeded',summary:'Recovered the original notification delivery receipt. Nothing was posted again.',result:{operationId:previous.operationId}};
  entries[input.proposalId]=entry;write(entries);return {entry};
 }
 if(operation==='recoverDeletion'){
  if(JSON.stringify(previous)!==JSON.stringify(input.expectedEntry))throw Error('Deletion journal changed. Refresh history.');
  if(previous.phase==='terminal'&&previous.status!=='unknown')return {entry:previous};
  const effect=previous.record.operation,recovery=input.recovery;
  if(!previous.attemptId||previous.phase!=='applying'&&previous.status!=='unknown'||!['calendar_delete','reminder_cancel'].includes(effect?.type)||sha256(JSON.stringify(effect))!==previous.operationHash)throw Error('Deletion recovery requires the exact admitted operation.');
  if(!recovery||!['succeeded','failed'].includes(recovery.status)||typeof recovery.summary!=='string'||recovery.summary.length>2000||recovery.result?.operationId!==previous.operationId)throw Error('Deletion receipt unavailable.');
  if(recovery.status==='succeeded'){if(effect.type==='calendar_delete')validateCalendarResult(validateCalendarOperation(effect),recovery.result.calendarResult);else validateReminderResult(validateReminderOperation(effect),recovery.result.reminderResult);}
  else if(Object.keys(recovery.result).length!==1)throw Error('Cancelled deletion cannot report a write.');
  const entry={...previous,phase:'terminal',status:recovery.status,summary:recovery.summary,result:recovery.result};entries[input.proposalId]=entry;write(entries);return {entry};
 }
 if(operation==='recoverReminder'){
  if(JSON.stringify(previous)!==JSON.stringify(input.expectedEntry))throw Error('Reminder journal changed. Refresh history.');
  if(previous.phase==='terminal'&&previous.status!=='unknown')return {entry:previous};
  if(!previous.attemptId||previous.phase!=='applying'&&previous.status!=='unknown')throw Error('Reminder recovery requires an admitted attempt');
  const effect=isReminderCreate(previous.record.operation)?validateReminderCreate(previous.record.operation):validateReminderOperation(previous.record.operation),hash=(value:unknown)=>sha256(JSON.stringify(value));
  const binding=hash([input.scope,previous.record.ownerId,previous.record.agentId,previous.record.sessionId,previous.record.origin,previous.record.installationId,previous.record.enrollmentId,input.proposalId,previous.record.digest,previous.operationId]);
  if(binding!==input.bindingHash||hash(effect)!==previous.operationHash)throw Error('Reminder recovery binding changed');
  const reminderResult=isReminderCreate(effect)?validateReminderCreateResult(effect,input.reminderResult,previous.operationId):validateReminderResult(effect,input.reminderResult);
  const entry={...previous,phase:'terminal',status:'succeeded',summary:'Recovered the original saved reminder receipt. No action was repeated.',result:{operationId:previous.operationId,reminderResult}};
  entries[input.proposalId]=entry;write(entries);return {entry};
 }
 if(operation==='finish'){
  if(!['succeeded','failed','unknown','cancelled'].includes(input.status)||typeof input.summary!=='string')throw Error('Invalid journal result');
  if(previous.phase==='terminal'){if(previous.status!==input.status||previous.summary!==input.summary||JSON.stringify(previous.result)!==JSON.stringify(input.result))throw Error('Terminal result conflict');return {};}
  if(input.status==='succeeded'&&previous.phase!=='applying')throw Error('Action was not admitted');
  entries[input.proposalId]={...previous,phase:'terminal',status:input.status,summary:input.summary,...(input.result?{result:input.result}:{})};write(entries);return {};
 }
 throw Error('Unsupported local storage operation');
}
