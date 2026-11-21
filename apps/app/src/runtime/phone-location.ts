import {Capacitor} from '@capacitor/core';
import {registerPlugin} from '../platform-plugins';
import {parseClientLocationObservation,type ClientLocationObservation} from '../../../../.eliza/client-features/packages/contracts/src/client-turn-observation.ts';

/** The slice of the native ElizaLocation bridge this reader uses. */
export interface PhoneLocationBridge {
 checkPermissions():Promise<{location:'granted'|'denied'|'prompt'}>;
 getCurrentPosition(options:{accuracy:'high'|'medium';maxAge:number;timeout:number}):Promise<{coords:{latitude:number;longitude:number;accuracy?:number;timestamp:number}}>;
}
export interface PhoneLocationPorts {
 /** True only in the native app with the location plugin present. */
 available():boolean;
 bridge:PhoneLocationBridge;
 now():number;
}
/** A fix this recent is reused without asking the platform again. */
export const PHONE_LOCATION_REUSE_MS=60_000;
/** The platform may answer from a fix this old, which is immediate. */
export const PHONE_LOCATION_PLATFORM_MAX_AGE_MS=5*60_000;
/** A chat turn waits at most this long for a fresh fix. */
export const PHONE_LOCATION_WAIT_MS=1_500;
/** Without a fresh fix, an earlier one is still reported up to this age. */
export const PHONE_LOCATION_STALE_MS=30*60_000;

function observation(coords:{latitude:number;longitude:number;accuracy?:number;timestamp:number}):ClientLocationObservation|undefined {
 try{
  // About a meter of precision; nothing more is meaningful for a phone fix.
  const round=(value:number)=>Math.round(value*1e5)/1e5;
  const accuracy=typeof coords.accuracy==='number'&&Number.isFinite(coords.accuracy)&&coords.accuracy>=0?Math.round(coords.accuracy):undefined;
  return parseClientLocationObservation({latitude:round(coords.latitude),longitude:round(coords.longitude),...(accuracy===undefined?{}:{accuracyMeters:accuracy}),capturedAt:Math.round(coords.timestamp)});
 }catch{return undefined;}
}

/**
 * The phone's last known position for the agent. The launcher's location
 * permission is the only gate: it is read with checkPermissions, never
 * requested, so a chat turn never shows a prompt. Without the permission
 * nothing is reported and any earlier fix is forgotten.
 */
export class PhoneLocationReader {
 private last:ClientLocationObservation|undefined;
 private pending:Promise<ClientLocationObservation|undefined>|undefined;
 constructor(private readonly ports:PhoneLocationPorts){}
 async read(signal:AbortSignal):Promise<ClientLocationObservation|undefined>{
  signal.throwIfAborted();
  if(!this.ports.available())return undefined;
  let granted=false;
  try{granted=(await this.ports.bridge.checkPermissions()).location==='granted';}catch{granted=false;}
  signal.throwIfAborted();
  if(!granted){this.last=undefined;return undefined;}
  const now=this.ports.now();
  if(this.last&&now-this.last.capturedAt<PHONE_LOCATION_REUSE_MS)return this.last;
  const pending=this.pending??=this.ports.bridge.getCurrentPosition({accuracy:'high',maxAge:PHONE_LOCATION_PLATFORM_MAX_AGE_MS,timeout:10_000})
   .then(result=>{const fix=observation(result.coords);if(fix&&(!this.last||fix.capturedAt>=this.last.capturedAt))this.last=fix;return fix;},()=>undefined)
   .finally(()=>{if(this.pending===pending)this.pending=undefined;});
  let timer:ReturnType<typeof setTimeout>|undefined,abort:(()=>void)|undefined;
  try{
   await Promise.race([pending,new Promise<void>(resolve=>{timer=setTimeout(resolve,PHONE_LOCATION_WAIT_MS);abort=()=>resolve();signal.addEventListener('abort',abort,{once:true});})]);
  }finally{if(timer!==undefined)clearTimeout(timer);if(abort)signal.removeEventListener('abort',abort);}
  signal.throwIfAborted();
  const last=this.last;
  return last&&this.ports.now()-last.capturedAt<=PHONE_LOCATION_STALE_MS?last:undefined;
 }
 clear(){this.last=undefined;}
}

let shared:PhoneLocationReader|undefined;
/** The app's one reader over the native ElizaLocation plugin. */
export function phoneLocationReader():PhoneLocationReader {
 return shared??=new PhoneLocationReader({available:()=>Capacitor.isNativePlatform()&&Capacitor.isPluginAvailable('ElizaLocation'),bridge:registerPlugin<PhoneLocationBridge>('ElizaLocation'),now:()=>Date.now()});
}
