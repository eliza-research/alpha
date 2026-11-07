/** Native startup refusals that require review, rather than repeated start attempts. */
export type ResidentRecoveryReason = 'ipc-recovery-retention-limit' | 'ipc-recovery-required' | 'runtime-identity-unavailable';
export function residentRecoveryReason(error:unknown):ResidentRecoveryReason|undefined {
 if(!error||typeof error!=='object'||!('code' in error))return;
 const code=error.code;
 return code==='ipc-recovery-retention-limit'||code==='ipc-recovery-required'||code==='runtime-identity-unavailable'?code:undefined;
}
export function residentRecoveryMessage(reason:ResidentRecoveryReason):string {
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
 return 'Alpha couldn’t start. Check the details in Settings.';
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
