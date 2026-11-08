import {browserDocuments} from './documents';
import {BrowserDomainDocument,type DomainRecovery} from './domain-document';
const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('alpha.browser.documents.v1');
const events=new Map<string,string>();
if(channel)channel.onmessage=event=>{const name=events.get(event.data?.key);if(name)window.dispatchEvent(new Event(name));};
function document(key:string,event:string){
 events.set(key,event);const domain=new BrowserDomainDocument(browserDocuments,key,()=>localStorage.getItem(key)),changed=()=>channel?.postMessage({key});
 return {
  read:<T>(initial:()=>T|Promise<T>,signal?:AbortSignal)=>domain.read(initial,signal),
  readRaw:(signal?:AbortSignal)=>domain.readRaw(signal),
  capture:(signal?:AbortSignal)=>domain.capture(signal),
  async reset(expected:DomainRecovery,signal?:AbortSignal){await domain.reset(expected,signal);changed();},
  async edit<T,R>(initial:()=>T|Promise<T>,edit:(state:T)=>R|Promise<R>,signal?:AbortSignal,expected?:DomainRecovery):Promise<R>{
   let modified=false;const result=await domain.edit(initial,async state=>{const before=JSON.stringify(state),result=await edit(state);modified=before!==JSON.stringify(state);return result;},signal,expected);if(modified)changed();return result;
  }
 };
}
export const bookmarkDocument=document('alpha.browser.bookmarks.v1','alpha:bookmarks-document-changed');
/** Normal-tab history and restorable tabs; private tabs are never written. */
export const browsingSessionDocument=document('alpha.browser.session.v1','alpha:browser-session-document-changed');
export const alertSoundDocument=document('alpha.browser.alert-sounds.v1','alpha:alert-sounds-document-changed');

export const passwordProviderDocument=document('alpha.browser.password-provider.v1','alpha:password-provider-document-changed');

export const albumDocument=document('alpha.browser.albums.v1','alpha:albums-document-changed');
export const devicePreferencesDocument=document('alpha.browser.device.v1','alpha:device-preferences-document-changed');
export const deviceRolesDocument=document('alpha.browser.roles.v1','alpha:device-roles-document-changed');
