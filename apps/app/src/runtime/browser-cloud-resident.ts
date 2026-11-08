import {productionCloud, stagingCloud} from './cloud-deployment.generated.ts';
import {managedServiceRequest} from './managed-service-routes.ts';
import {Capacitor} from '@capacitor/core';
/** Explicit loopback development host with real Cloud services; never enabled in built artifacts. */
export const browserCloudResidentEnabled=import.meta.env!==undefined&&import.meta.env.DEV===true&&import.meta.env.VITE_ALPHA_CLOUD_RESIDENT==='1'&&!Capacitor.isNativePlatform();
export const browserCloudResidentEnvironment=browserCloudResidentEnabled&&import.meta.env.VITE_ALPHA_CLOUD_ENVIRONMENT==='staging'?'staging':'production';
/** Why an own-key setup failed, without provider text: the host sends none, and a key never reaches the screen. */
export const OWN_KEYS_NOT_SET_UP='Own API keys could not be set up. Check the keys and try again.';
export async function browserResidentCall(operation:'residentOwn'|'residentCloud'|'residentBind'|'residentClear'|'residentStatus'|'residentStart'|'residentGoogleCalendarAccess',credentialId?:string,calendarEdits?:boolean,keys?:{apiKey:string;cartesiaKey?:string},signal?:AbortSignal){
 signal?.throwIfAborted();
 if(!browserCloudResidentEnabled)throw Error('Cloud resident host unavailable');
 const response=await fetch('/__alpha-browser-cloud',{method:'POST',headers:{'Content-Type':'application/json','X-Alpha-Browser-Cloud':'1'},body:JSON.stringify({...keys,operation,environment:browserCloudResidentEnvironment,credentialId,...(operation==='residentGoogleCalendarAccess'?{calendarEdits}:{})}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000),redirect:'error'});
 signal?.throwIfAborted();
 if(!response.ok)throw Error(operation==='residentOwn'?OWN_KEYS_NOT_SET_UP:'Cloud resident binding unavailable');
 return response.json();
}

/** The loopback browser Cloud host signs in through the Cloud sign-in hand-off (cli-session). It is a
 * development route only; product route policy (managed-service-routes.ts) never admits it. */
function browserCloudSignInHandOff(input:string,method:string,hasBody:boolean):boolean {
 if(!browserCloudResidentEnabled)return false;
 let url:URL;try{url=new URL(input);}catch{return false;}
 const api=browserCloudResidentEnvironment==='staging'?stagingCloud.api:productionCloud.api;
 if(url.origin!==api||url.username||url.password||url.hash||url.search)return false;
 if(method==='POST')return url.pathname==='/api/auth/cli-session';
 return method==='GET'&&!hasBody&&/^\/api\/auth\/cli-session\/[0-9a-fA-F-]{36}$/.test(url.pathname);
}
/** Reuse the production route policy for one exact, explicitly selected development issuer. */
export function browserCloudManagedServiceAllowed(input:string,method:string,hasBody=false):boolean {
 if(browserCloudSignInHandOff(input,method,hasBody))return true;
 if(browserCloudResidentEnabled&&browserCloudResidentEnvironment==='staging'){
  let url:URL;try{url=new URL(input);}catch{return false;}
  if(url.origin!==stagingCloud.api)return false;
  // Policy comparison only. The transport still dispatches the original staging URL.
  url.hostname=new URL(productionCloud.api).hostname;
  return managedServiceRequest(url.href,method,hasBody);
 }
 return managedServiceRequest(input,method,hasBody);
}
