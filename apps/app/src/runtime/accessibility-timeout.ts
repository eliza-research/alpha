import {Capacitor} from '@capacitor/core';
import {registerPlugin} from '../platform-plugins';

/**
 * Android's "Time to take action" accessibility setting, as a multiplier for the shell's own
 * timeouts (toasts). AlphaDevice.recommendedTimeout asks AccessibilityManager for its recommended
 * timeout for a 5 s base; the scale is that reply over the base. It is 1 off Android, before the
 * first reply and when the setting is unset. TalkBack focus raises no DOM event, so this setting is
 * what keeps a toast up for screen-reader users.
 */
export type TimeoutPort={recommendedTimeout(options:{baseMs:number}):Promise<{timeoutMs?:unknown}>};
export type ResumePort={addListener(event:'appResumed',listener:()=>void):Promise<unknown>};

export const ACCESSIBILITY_TIMEOUT_BASE_MS=5000;
let scale=1;
let latestRefresh: object | undefined;

export function accessibilityTimeoutScale():number{return scale;}

const nativePort=():TimeoutPort|null=>Capacitor.getPlatform()==='android'?registerPlugin<TimeoutPort>('AlphaDevice'):null;

/** Reads the setting again; a failed or malformed reply keeps the last known scale. */
export async function refreshAccessibilityTimeout(port:TimeoutPort|null=nativePort()):Promise<number>{
 const refresh={};
 latestRefresh=refresh;
 if(!port)return scale=1;
 try{
  const {timeoutMs}=await port.recommendedTimeout({baseMs:ACCESSIBILITY_TIMEOUT_BASE_MS});
  if(latestRefresh===refresh&&typeof timeoutMs==='number'&&Number.isFinite(timeoutMs)&&timeoutMs>0)scale=Math.max(1,timeoutMs/ACCESSIBILITY_TIMEOUT_BASE_MS);
 }catch{/* Keep the last scale: the toast still shows for its own minimum. */}
 return scale;
}

/** Reads the setting at start and again whenever the app returns, since it can change in Android settings. */
export function startAccessibilityTimeout(resume:ResumePort,port:TimeoutPort|null=nativePort()):void{
 if(!port)return;
 void refreshAccessibilityTimeout(port);
 void resume.addListener('appResumed',()=>void refreshAccessibilityTimeout(port)).catch(()=>{});
}
