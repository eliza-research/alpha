import {Capacitor} from '@capacitor/core';
import {secureConnectionStore} from './native-connection';
import {BrowserJsonDomainDocument} from '../browser/json-domain-document';
import {ServiceReadCache,type ReadCacheStore} from './service-read-cache';
export type ReadCacheOwner={environment:string;userId:string;organizationId:string;credentialId:string};
/** A service that keeps its offline snapshots in a document of its own, apart from the account document. */
export type ReadCacheService='gmail';
/** Mail snapshots the account document held before mail had its own document. */
export const sharedMailKeys=['gmail:mailbox','gmail:home'] as const;
/** The identity a document is bound to: the verified local account, and the service for a service's
 * own document. Mail never shares the account document, so clearing mail, its entry bound and its
 * size bound cannot remove or evict what Calendar saved there, and the reverse. */
export function readCacheIdentity(owner:ReadCacheOwner,service?:ReadCacheService):string{
 const account=[owner.environment,owner.userId,owner.organizationId,owner.credentialId];
 return JSON.stringify(service?[...account,service]:account);
}
async function platformStore(identity:string):Promise<ReadCacheStore>{
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity))),v=>v.toString(16).padStart(2,'0')).join(''),slot='connected-read-cache:v1:'+hash;
 if(Capacitor.isNativePlatform())return {read:()=>secureConnectionStore.read(slot),compareExchange:async(before,value)=>(await secureConnectionStore.compareExchange(slot,before,value)).status};
 const document=new BrowserJsonDomainDocument('alpha.browser.'+slot);
 return {read:()=>document.readJson(),compareExchange:async(before,value)=>{let saved=false;await document.editJson(actual=>{if(JSON.stringify(actual)!==JSON.stringify(before))return actual;saved=true;return value;});return saved?'saved':'conflict';}};
}
/** Erases the mail snapshots left in the account document. They are not migrated: mail is read from
 * its provider again. The account document's other entries are untouched. */
export async function retireSharedMail(account:Pick<ServiceReadCache,'get'|'put'>):Promise<void>{
 for(const key of sharedMailKeys)if((await account.get(key))?.value!=null)await account.put(key,null);
}
const opened=new Map<string,Promise<ServiceReadCache>>(),retired=new Set<string>();
/** Cost: one SHA256 and one cached document handle per verified local account identity and document. */
export function serviceReadCache(owner:ReadCacheOwner,service?:ReadCacheService):Promise<ServiceReadCache>{
 if(Object.values(owner).some(v=>typeof v!=='string'||!v||v.length>1024)||service!==undefined&&service!=='gmail')return Promise.reject(Error('Read cache owner is unavailable'));
 const identity=readCacheIdentity(owner,service);
 let result=opened.get(identity);
 if(!result){
  result=(async()=>new ServiceReadCache(identity,await platformStore(identity)))();
  opened.set(identity,result);result.catch(()=>opened.delete(identity));
 }
 // Once per account and app start; a failure leaves it to the next open.
 const account=readCacheIdentity(owner);
 if(service&&!retired.has(account)){retired.add(account);void serviceReadCache(owner).then(retireSharedMail).catch(()=>{retired.delete(account);});}
 return result;
}
