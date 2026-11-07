import {Capacitor} from '@capacitor/core';
import type {BrowserDomainDocument} from '../browser/domain-document';
import {WorkflowIntentStore as SharedWorkflowIntentStore,emptyWorkflowIntentArchive,storageWorkflowIntentBackend,workflowIntentKey as sharedWorkflowIntentKey,workflowIntentOwnerPrefix,type WorkflowIntentArchive,type WorkflowIntentOwner as SharedWorkflowIntentOwner} from '../../../../.eliza/client-features/packages/contracts/src/workflow-intents.ts';
/** Pending workflow requests use the shared owner-isolated `@elizaos/contracts/workflow-intents` store.
 * Alpha keeps its installed key namespace and slots: per-key localStorage on the phone and a browser
 * domain document (with the legacy slots as its seed) on the development host. */
export type WorkflowIntentOwner=SharedWorkflowIntentOwner;
const prefix='alpha.workflow.pending.v1:';
export const workflowIntentKey=(owner:WorkflowIntentOwner,id:string)=>sharedWorkflowIntentKey(owner,id,prefix);
export class WorkflowIntentStore extends SharedWorkflowIntentStore {
 readonly documentKey:string;
 private document?:Promise<BrowserDomainDocument>;
 constructor(owner:WorkflowIntentOwner){
  const ownerPrefix=workflowIntentOwnerPrefix(owner,prefix),slots=storageWorkflowIntentBackend(localStorage,ownerPrefix,()=>Object.keys(localStorage));
  const holder:{store?:WorkflowIntentStore}={};
  const android=()=>Capacitor.getPlatform()==='android';
  super(owner,{
   keyPrefix:prefix,
   // Preserve the installed renderer slots on the phone; native durable storage is a separate gate.
   backend:{
    read:async signal=>android()?slots.read(signal):(await holder.store!.recoveryDocument()).read(emptyWorkflowIntentArchive,signal),
    edit:async(update,signal)=>{if(android())return slots.edit(update,signal);await (await holder.store!.recoveryDocument()).edit(emptyWorkflowIntentArchive,(value:WorkflowIntentArchive)=>{update(value);},signal);},
   },
   onChange:()=>{
    window.dispatchEvent(new Event('alpha:workflow-intents'));
    if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('alpha.workflow-intents');channel.postMessage(holder.store!.documentKey);channel.close();}
   },
  });
  holder.store=this;
  this.documentKey='alpha.browser.workflow-intents.v1:'+JSON.stringify([owner.origin,owner.ownerId,owner.agentId]);
 }
 async recoveryDocument(){
  if(Capacitor.getPlatform()==='android')throw Error('Browser workflow recovery is unavailable on this device');
  return this.document??=Promise.all([import('../browser/domain-document'),import('../browser/documents')]).then(([{BrowserDomainDocument},{browserDocuments}])=>new BrowserDomainDocument(browserDocuments,this.documentKey,()=>{const value=this.legacy();return Object.keys(value.entries).length?JSON.stringify(value):null;}));
 }
 /** The installed per-key slots of this owner, read synchronously as the document's seed. */
 private legacy():WorkflowIntentArchive{
  const entries:Record<string,string>={};
  for(const key of Object.keys(localStorage).sort())if(key.startsWith(this.ownerPrefix)){const raw=localStorage.getItem(key);if(raw!==null)entries[key]=raw;}
  return {entries};
 }
}
