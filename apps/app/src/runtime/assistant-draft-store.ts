import {nativeAssistantDraftRecovery} from './native-assistant-draft-recovery';
import {Capacitor} from '@capacitor/core';
import {secureConnectionStore} from './native-connection';
import {compareExchangeDraftStore,emptyDurableDraft,transactionalDraftStore} from '../../../../.eliza/client-features/packages/ui/src/state/durable-draft.ts';
import type {DomainRecovery} from '../browser/domain-document';

/**
 * Alpha's installed draft storage over the shared durable draft stores. The slot name
 * (`assistant-draft:v1:` + SHA-256 of the binding), the Android secure slot and the browser
 * document key under `alpha.browser.` are installed-data identifiers and stay unchanged.
 */
export async function assistantDraftStore(binding:string){
 if(!binding||binding.length>4096)throw Error('Invalid assistant draft identity.');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(binding))),n=>n.toString(16).padStart(2,'0')).join('');
 const slot='assistant-draft:v1:'+hash;
 if(Capacitor.getPlatform()==='android'){
  const raw={read:()=>secureConnectionStore.readRaw(slot),compareExchange:(expected:string|null,value:string)=>secureConnectionStore.compareExchangeRaw(slot,expected,value)};
  return compareExchangeDraftStore(binding,raw,{recovery:nativeAssistantDraftRecovery(binding,raw)});
 }
 const domain=new (await import('../browser/json-domain-document')).BrowserJsonDomainDocument('alpha.browser.'+slot);
 return transactionalDraftStore(binding,domain,{recovery:{
  capture:(signal?:AbortSignal)=>domain.capture(signal),
  reset:async(expected:DomainRecovery,signal?:AbortSignal)=>{await domain.restore(expected,JSON.stringify({raw:JSON.stringify(emptyDurableDraft(binding))}),signal);},
 }});
}
