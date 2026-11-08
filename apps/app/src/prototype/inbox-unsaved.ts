import {Capacitor} from '@capacitor/core';
import {AssistantDraftController} from './assistant-draft-controller';
import type {AssistantDraft} from '../runtime/assistant-draft-record';
import {secureConnectionStore} from '../runtime/native-connection';
import {nativeAssistantDraftRecovery} from '../runtime/native-assistant-draft-recovery';
import {encodeInboxUnsaved,readInboxUnsaved,inboxUnsavedLimit,type InboxUnsaved} from '../runtime/inbox-unsaved-record';
import {openDomainRecovery} from '../browser/domain-recovery';
import {browserDevProfile} from '../browser/dev-profile';
/** Status copy for retained email edits; the shared defaults are written for chat messages. */
const retainedMessages={
 unsettled:'This email may already have been sent. Check Sent before sending it again.',
 reviewUnsettled:'This email may already have been sent. Check Sent before sending another.',
 storageUnavailable:'Local draft storage is unavailable. Check it before sending.',
 tooLarge:'Current email edits are too large to retain. Shorten them before closing.',
 clearFailed:'Email sent, but its retained edits could not be cleared. Review them before sending again.',
 preparing:'Clearing retained edits…',
};
/** Account-scoped recovery copies remain separate from the explicitly saved local draft. */
export function inboxUnsaved(owner:string,publish:()=>void,restore:(value:InboxUnsaved)=>void){
 let text='',alive=true,applying=false,invalid=false,recoveryAbort:AbortController|undefined;
 let readStored:(()=>Promise<AssistantDraft|null>)|undefined;
 let retiredReadback:Promise<boolean>|undefined;
 const binding=JSON.stringify(['inbox-unsaved',browserDevProfile?'development':'app',owner]);
 const controller=new AssistantDraftController(async()=>{
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(binding))),n=>n.toString(16).padStart(2,'0')).join('');
  const slot='inbox-drafts:v1:unsaved:'+hash,native=Capacitor.getPlatform()==='android';
  const domain=native?null:new (await import('../browser/json-domain-document')).BrowserJsonDomainDocument('alpha.browser.'+slot);
  const check=(row:any):AssistantDraft|null=>{if(row===null)return null;if(!row||Object.keys(row).sort().join(',')!=='binding,revision,text,version'||row.version!==1||row.binding!==binding||typeof row.revision!=='string'||!row.revision||typeof row.text!=='string'||new TextEncoder().encode(row.text).length>inboxUnsavedLimit)throw Error('Retained email edits need recovery.');if(row.text)readInboxUnsaved(row.text,owner);return row;};
  const read=readStored=async()=>check(native?await secureConnectionStore.read(slot):await domain!.readJson());
  const empty=()=>({version:1,binding,revision:crypto.randomUUID(),text:''});
  return {
   recovery:domain?{capture:(signal?:AbortSignal)=>domain.capture(signal),reset:async(expected:any,signal?:AbortSignal)=>{await domain.restore(expected,JSON.stringify({raw:JSON.stringify(empty())}),signal);}}:nativeAssistantDraftRecovery(binding,{read:()=>secureConnectionStore.readRaw(slot),compareExchange:(expected,value)=>secureConnectionStore.compareExchangeRaw(slot,expected,value)}),
   read,
   save:async(expected:AssistantDraft|null,nextText:string)=>{const value={version:1 as const,binding,revision:crypto.randomUUID(),text:nextText};check(value);if(new TextEncoder().encode(JSON.stringify(value)).length>8*1024*1024)throw Error('Retained email is too large.');if(native){const receipt=await secureConnectionStore.compareExchange(slot,expected,value);if(receipt.status!=='saved')throw Error('Retained email changed.');}else await domain!.editJson(actual=>{check(actual);if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Retained email changed.');return value;});return value;},
  };
 },()=>text,value=>{text=value;if(applying&&value)restore(readInboxUnsaved(value,owner));},()=>{if(alive)publish();},retainedMessages);
 return {
  ready:controller.open(binding),
  get available(){return !!text;},
  get retired(){return !alive;},
  async flushForAppUpdate(current:()=>boolean){
   if(retiredReadback){
    if(!await retiredReadback||!current())throw Error('Retired email edits could not be verified');
   }else{
    await controller.flush(()=>current()&&alive&&!invalid);
   }
  },
  /** The retained copy as stored, or null when there is none or it cannot be read. */
  peek():InboxUnsaved|null{try{return text?readInboxUnsaved(text,owner):null;}catch{return null;}},
  get conflict(){return controller.state.conflict;},
  get error(){return controller.state.error;},
  get status(){return invalid?retainedMessages.tooLarge:controller.state.message;},
  edit(value:InboxUnsaved){try{text=encodeInboxUnsaved(value);invalid=false;controller.edit(text);}catch{invalid=true;}publish();},
  resume(){if(controller.state.conflict){applying=true;try{controller.restoreSaved();}finally{applying=false;}}else if(text)restore(readInboxUnsaved(text,owner));},
  replace(){controller.keepCurrent();},
  retry(){return controller.retry();},
  async clear(){const expected=text;if(expected)await controller.consume(expected,()=>alive&&text===expected);},
  recover(current:unknown){const recovery=controller.recovery();if(!recovery)return;recoveryAbort?.abort();recoveryAbort=new AbortController();openDomainRecovery({capture:async signal=>{const captured=await recovery.capture(signal);return {...captured,raw:JSON.stringify({saved:captured.raw,current})};},reset:recovery.reset},'email edits','Email edit recovery','Back up retained edits before resetting this recovery copy. Explicitly saved drafts and provider mail will not change.',recoveryAbort.signal,undefined,Capacitor.getPlatform()==='android'?'device':'browser');},
  retire(){
   if(!alive)return;
   const expected=text;
   alive=false;text='';
   controller.retire(false);recoveryAbort?.abort();
   retiredReadback=(async()=>{
    await controller.flush(()=>!invalid);
    return !expected||(await readStored?.())?.text===expected;
   })().catch(()=>false);
  },
 };
}
