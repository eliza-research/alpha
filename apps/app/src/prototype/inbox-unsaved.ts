import {Capacitor} from '@capacitor/core';
import {AssistantDraftController} from './assistant-draft-controller';
import type {AssistantDraft} from '../runtime/assistant-draft-record';
import {secureConnectionStore} from '../runtime/native-connection';
import {nativeAssistantDraftRecovery} from '../runtime/native-assistant-draft-recovery';
import {encodeInboxUnsaved,readInboxUnsaved,inboxUnsavedLimit,type InboxUnsaved} from '../runtime/inbox-unsaved-record';
import {editCoalescer} from '../runtime/inbox-edit-coalescer';
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
 // Each edit is retained in the task after it is made, with no typing pause: a recovery copy exists
 // as soon as the composer is idle. The latest copy waits here, replaces any earlier unwritten one,
 // and is encoded only when written, so edits made in one task cost one write. A store write in
 // flight holds the next one, so a slow store receives only the latest copy when it finishes.
 const queue=editCoalescer<InboxUnsaved>(value=>{try{text=encodeInboxUnsaved(value);invalid=false;controller.edit(text);}catch{invalid=true;}if(alive)publish();},{delay:0});
 // Leaving the app writes the waiting copy at once, held or not.
 const hidden=()=>{if(document.hidden)queue.flush();};
 document.addEventListener('visibilitychange',hidden);
 let parsed:{raw:string;value:InboxUnsaved|null}|null=null;
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
   save:async(expected:AssistantDraft|null,nextText:string)=>{queue.hold();try{const value={version:1 as const,binding,revision:crypto.randomUUID(),text:nextText};check(value);if(new TextEncoder().encode(JSON.stringify(value)).length>8*1024*1024)throw Error('Retained email is too large.');if(native){const receipt=await secureConnectionStore.compareExchange(slot,expected,value);if(receipt.status!=='saved')throw Error('Retained email changed.');}else await domain!.editJson(actual=>{check(actual);if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Retained email changed.');return value;});return value;}finally{queue.release();}},
  };
 },()=>text,value=>{text=value;if(applying&&value)restore(readInboxUnsaved(value,owner));},()=>{if(alive)publish();},retainedMessages);
 return {
  ready:controller.open(binding),
  get available(){return !!text||queue.pending;},
  get retired(){return !alive;},
  async flushForAppUpdate(current:()=>boolean){
   if(retiredReadback){
    if(!await retiredReadback||!current())throw Error('Retired email edits could not be verified');
   }else{
    queue.flush();
    await controller.flush(()=>current()&&alive&&!invalid);
   }
  },
  /** The retained copy: the edit waiting to be written, else the copy as stored; null when there is
   * none or it cannot be read. The stored text is parsed once and the same object returned until
   * it changes; callers treat the result as read-only. */
  peek():InboxUnsaved|null{
   const waiting=queue.peek();if(waiting)return waiting;
   if(!text)return null;
   if(parsed?.raw!==text){let value:InboxUnsaved|null=null;try{value=readInboxUnsaved(text,owner);}catch{}parsed={raw:text,value};}
   return parsed!.value;
  },
  get conflict(){return controller.state.conflict;},
  get error(){return controller.state.error;},
  get status(){return invalid?retainedMessages.tooLarge:controller.state.message;},
  edit(value:InboxUnsaved){queue.push(value);publish();},
  resume(){queue.flush();if(controller.state.conflict){applying=true;try{controller.restoreSaved();}finally{applying=false;}}else if(text)restore(readInboxUnsaved(text,owner));},
  replace(){controller.keepCurrent();},
  retry(){return controller.retry();},
  async clear(){queue.flush();const expected=text;if(expected)await controller.consume(expected,()=>alive&&!queue.pending);},
  recover(current:unknown){const recovery=controller.recovery();if(!recovery)return;recoveryAbort?.abort();recoveryAbort=new AbortController();openDomainRecovery({capture:async signal=>{const captured=await recovery.capture(signal);return {...captured,raw:JSON.stringify({saved:captured.raw,current})};},reset:recovery.reset},'email edits','Email edit recovery','Back up retained edits before resetting this recovery copy. Explicitly saved drafts and provider mail will not change.',recoveryAbort.signal,undefined,Capacitor.getPlatform()==='android'?'device':'browser');},
  retire(){
   if(!alive)return;
   // The waiting edit is written before the account changes, without publishing to the view that
   // is being left; the readback below covers it.
   alive=false;queue.flush();document.removeEventListener('visibilitychange',hidden);
   const expected=text;
   text='';
   controller.retire(false);recoveryAbort?.abort();
   retiredReadback=(async()=>{
    await controller.flush(()=>!invalid);
    return !expected||(await readStored?.())?.text===expected;
   })().catch(()=>false);
  },
 };
}
