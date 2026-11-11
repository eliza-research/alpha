/** Native startup refusals that require review, rather than repeated start attempts. */
export type ResidentRecoveryReason = 'ipc-recovery-retention-limit' | 'ipc-recovery-required' | 'runtime-identity-unavailable';
export function residentRecoveryReason(error:unknown):ResidentRecoveryReason|undefined {
 if(!error||typeof error!=='object'||!('code' in error))return;
 const code=error.code;
 return code==='ipc-recovery-retention-limit'||code==='ipc-recovery-required'||code==='runtime-identity-unavailable'?code:undefined;
}
export function residentRecoveryMessage(reason:ResidentRecoveryReason):string {
 if(reason==='runtime-identity-unavailable')return 'Alpha couldn’t check its installed files. Open Settings › Agent connection to try again.';
 return reason==='ipc-recovery-retention-limit'?'Alpha needs a restart. Open Settings › Agent connection.':'Alpha couldn’t start. Open Settings › Agent connection for details.';
}
export const RESIDENT_RECOVERY_PENDING='Alpha couldn’t start. Open Settings › Agent connection.';
/** Only a fresh, reviewable native snapshot supports restart readiness. */
export function residentRecoveryCopy(reason:ResidentRecoveryReason,view?:ResidentRecoveryView):string {
 if(view?.step==='unavailable')return 'Alpha couldn’t confirm a safe restart. Try again later.';
 if(view?.step==='partial')return 'Alpha couldn’t finish restarting. Check the details before trying again.';
 if(view?.step==='reviewing')return 'Checking restart…';
 if(view?.step==='archiving')return 'Restarting Alpha…';
 if(reason==='ipc-recovery-retention-limit')return view?.step==='review'?'Alpha is ready to restart.':'Alpha needs a restart.';
 // Never suggests reinstalling: on Android that clears app data.
 if(reason==='runtime-identity-unavailable')return 'Alpha couldn’t check its installed files. Try again. If this keeps happening, update Alpha. Your conversations and notes are kept.';
 return 'Restart your phone to try again.';
}

export type RecoveryReview = {status:'reviewable';retainedCount:number;reviewToken:string}|{status:'unavailable';retainedCount:number};
export type RecoveryArchive = {status:'archived'|'unavailable'|'partial';archivedCount:number;retainedCount:number};
export type ResidentRecoveryView = {step:'reviewing'|'archiving'|'unavailable'|'partial'}|{step:'review';review:Extract<RecoveryReview,{status:'reviewable'}>};
const count=(value:unknown):value is number=>Number.isInteger(value)&&Number(value)>=0&&Number(value)<=64;
export function parseRecoveryReview(value:unknown):RecoveryReview {
 const v=value as Partial<RecoveryReview>|null;
 if(!v||!count(v.retainedCount))throw Error('Recovery could not be checked. Your records were kept.');
 if(v.status==='unavailable')return {status:'unavailable',retainedCount:v.retainedCount};
 if(v.status==='reviewable'&&v.retainedCount>0&&typeof v.reviewToken==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v.reviewToken))return {status:'reviewable',retainedCount:v.retainedCount,reviewToken:v.reviewToken};
 throw Error('Recovery could not be checked. Your records were kept.');
}
export function parseRecoveryArchive(value:unknown):RecoveryArchive {
 const v=value as Partial<RecoveryArchive>|null;
 if(!v||!count(v.archivedCount)||!count(v.retainedCount)||!['archived','unavailable','partial'].includes(v.status||''))throw Error('Recovery could not be confirmed. Review again before restarting your agent.');
 return {status:v.status!,archivedCount:v.archivedCount,retainedCount:v.retainedCount};
}

export type ResidentBootStatus = {state?:string;reason?:string};
/** Boot states where the resident this renderer was bound to is gone. Listening (busy or idle) and an owner's stop are not. */
export function residentBootLost(status:ResidentBootStatus|undefined):boolean {
 //@ verify
 //@ ensures status === undefined ==> !\result
 //@ ensures status !== undefined ==> (\result <==> (status.state === 'dead' || status.state === 'restarting' || status.state === 'booting'))
 //@ ensures (status !== undefined && (status.state === 'listening' || status.state === 'stopped')) ==> !\result
 if(!status)return false;
 return status.state==='dead'||status.state==='restarting'||status.state==='booting';
}
/** One plain line for a native boot reason; raw codes never reach the owner. */
export function residentBootMessage(reason:unknown):string {
 const code=typeof reason==='string'?reason:'';
 if(code.startsWith('agent startup blocked'))return 'Alpha couldn’t start your agent. Restart your phone to try again.';
 if(code==='fatal')return 'Your agent stopped unexpectedly. Retry in Settings › Agent connection.';
 if(code==='agent-update-deferred')return 'An agent update is waiting. Restart Alpha to finish it.';
 return 'Your agent stopped. Retry in Settings › Agent connection.';
}
/**
 * A rate-limited native boot-state read after a channel or request failure: one in flight, at most
 * one per interval. It resolves the boot status only when the resident is gone, otherwise undefined.
 */
export function residentLivenessCheck(read:()=>Promise<ResidentBootStatus|undefined>,now:()=>number=Date.now,interval=10_000):()=>Promise<ResidentBootStatus|undefined> {
 let inFlight=false,last=-Infinity;
 return async()=>{
  if(inFlight||now()-last<interval)return;
  inFlight=true;last=now();
  try{const status=await read();return residentBootLost(status)?status:undefined;}
  catch{return;}
  finally{inFlight=false;}
 };
}
