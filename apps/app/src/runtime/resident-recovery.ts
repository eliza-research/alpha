/** Native startup refusals that require review, rather than repeated start attempts. */
export type ResidentRecoveryReason = 'ipc-recovery-retention-limit' | 'ipc-recovery-required' | 'runtime-identity-unavailable';
export function residentRecoveryReason(error:unknown):ResidentRecoveryReason|undefined {
 if(!error||typeof error!=='object'||!('code' in error))return;
 const code=error.code;
 return code==='ipc-recovery-retention-limit'||code==='ipc-recovery-required'||code==='runtime-identity-unavailable'?code:undefined;
}
export function residentRecoveryMessage(reason:ResidentRecoveryReason):string {
 if(reason==='runtime-identity-unavailable')return 'Startup check failed';
 return reason==='ipc-recovery-retention-limit'?'Restart needed':'Couldn’t start';
}
export const RESIDENT_RECOVERY_PENDING='Couldn’t start';
/** Only a fresh, reviewable native snapshot supports restart readiness. */
export function residentRecoveryCopy(reason:ResidentRecoveryReason,view?:ResidentRecoveryView):string {
 if(view?.step==='unavailable')return 'Restart blocked';
 if(view?.step==='partial')return 'Restart incomplete';
 if(view?.step==='reviewing')return 'Checking restart';
 if(view?.step==='archiving')return 'Restarting';
 if(reason==='ipc-recovery-retention-limit')return 'Restart needed';
 // Never suggests reinstalling: on Android that clears app data.
 if(reason==='runtime-identity-unavailable')return 'Startup check failed';
 return 'Restart phone';
}

export type RecoveryReview = {status:'reviewable';retainedCount:number;reviewToken:string}|{status:'unavailable';retainedCount:number};
export type RecoveryArchive = {status:'archived'|'unavailable'|'partial';archivedCount:number;retainedCount:number};
export type ResidentRecoveryView = {step:'reviewing'|'archiving'|'unavailable'|'partial'}|{step:'review';review:Extract<RecoveryReview,{status:'reviewable'}>};
const count=(value:unknown):value is number=>Number.isInteger(value)&&Number(value)>=0&&Number(value)<=64;
export function parseRecoveryReview(value:unknown):RecoveryReview {
 const v=value as Partial<RecoveryReview>|null;
 if(!v||!count(v.retainedCount))throw Error('Couldn’t check');
 if(v.status==='unavailable')return {status:'unavailable',retainedCount:v.retainedCount};
 if(v.status==='reviewable'&&v.retainedCount>0&&typeof v.reviewToken==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v.reviewToken))return {status:'reviewable',retainedCount:v.retainedCount,reviewToken:v.reviewToken};
 throw Error('Couldn’t check');
}
export function parseRecoveryArchive(value:unknown):RecoveryArchive {
 const v=value as Partial<RecoveryArchive>|null;
 if(!v||!count(v.archivedCount)||!count(v.retainedCount)||!['archived','unavailable','partial'].includes(v.status||''))throw Error('Not confirmed');
 return {status:v.status!,archivedCount:v.archivedCount,retainedCount:v.retainedCount};
}

export type ResidentBootStatus = {state?:string;reason?:string};
/** Exact native states which invalidate a renderer's resident binding. */
//@ verify
//@ ensures \result <==> (state === 'dead' || state === 'restarting' || state === 'booting')
function residentBootStateLost(state:string|undefined):boolean {
 return state==='dead'||state==='restarting'||state==='booting';
}
/** Boot states where the resident this renderer was bound to is gone. Listening (busy or idle) and an owner's stop are not. */
export function residentBootLost(status:ResidentBootStatus|undefined):boolean {
 return !!status&&residentBootStateLost(status.state);
}
/** One plain line for a native boot reason; raw codes never reach the owner. */
export function residentBootMessage(reason:unknown):string {
 const code=typeof reason==='string'?reason:'';
 if(code.startsWith('agent startup blocked'))return 'Agent didn’t start';
 if(code==='fatal')return 'Agent stopped';
 if(code==='agent-update-deferred')return 'Update ready';
 return 'Agent stopped';
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
