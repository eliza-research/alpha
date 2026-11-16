import {nativeAssistantDraftRecovery} from './native-assistant-draft-recovery';
import {Capacitor} from '@capacitor/core';
import {secureConnectionStore} from './native-connection';
import {compareExchangeDraftStore,emptyDurableDraft,transactionalDraftStore,type DurableDraftStore} from '../../../../.eliza/client-features/packages/ui/src/state/durable-draft.ts';
import type {DomainRecovery} from '../browser/domain-document';

/**
 * One durable draft slot over the shared durable draft stores: the Android secure slot, or the
 * browser document key under `alpha.browser.`, named `prefix` + SHA-256 of the binding. With a
 * native recovery, unreadable bytes go to the owner's recovery dialog. Without one, a slot that no
 * longer reads as a draft is reset to an empty draft on read and reads as no draft.
 */
export async function durableDraftSlotStore(prefix:string,binding:string,nativeRecovery:typeof nativeAssistantDraftRecovery|null){
 if(!binding||binding.length>4096)throw Error('Invalid draft identity.');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(binding))),n=>n.toString(16).padStart(2,'0')).join('');
 const slot=prefix+hash;
 if(Capacitor.getPlatform()==='android'){
  const raw={read:()=>secureConnectionStore.readRaw(slot),compareExchange:(expected:string|null,value:string)=>secureConnectionStore.compareExchangeRaw(slot,expected,value)};
  /* Without an owner recovery, the same capture and reset run here, with no prompt. */
  const store=compareExchangeDraftStore(binding,raw,{recovery:(nativeRecovery??nativeAssistantDraftRecovery)(binding,raw)});
  return nativeRecovery?store:resetUnreadable(store);
 }
 const domain=new (await import('../browser/json-domain-document')).BrowserJsonDomainDocument('alpha.browser.'+slot);
 const store=transactionalDraftStore(binding,domain,{recovery:{
  capture:(signal?:AbortSignal)=>domain.capture(signal),
  reset:async(expected:DomainRecovery,signal?:AbortSignal)=>{await domain.restore(expected,JSON.stringify({raw:JSON.stringify(emptyDurableDraft(binding))}),signal);},
 }});
 return nativeRecovery?store:resetUnreadable(store);
}
type ResettableStore=DurableDraftStore<{capture:(signal?:AbortSignal)=>Promise<any>;reset:(expected:any,signal?:AbortSignal)=>Promise<void>}>;
/** A slot with no owner recovery: bytes that no longer read as a draft are reset, and read as none. */
function resetUnreadable<T extends ResettableStore>(store:T):T{
 const read=store.read.bind(store),recovery=store.recovery!;
 return {...store,read:async(signal?:AbortSignal)=>{
  try{return await read(signal);}
  catch(error){if(signal?.aborted)throw error;await recovery.reset(await recovery.capture(signal),signal);return null;}
 }};
}

/**
 * Alpha's installed draft storage. The slot name (`assistant-draft:v1:` + SHA-256 of the binding),
 * the Android secure slot and the browser document key under `alpha.browser.` are installed-data
 * identifiers and stay unchanged.
 */
export async function assistantDraftStore(binding:string){
 return durableDraftSlotStore('assistant-draft:v1:',binding,nativeAssistantDraftRecovery);
}
