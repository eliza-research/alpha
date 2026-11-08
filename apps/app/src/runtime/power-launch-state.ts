import type { ConnectionSnapshot } from './connection-ui';

/** Public identity constraint on an actual native protected launch, never launch authority. */
export function protectedPowerLaunchState(snapshot: Pick<ConnectionSnapshot, 'startupResolved'|'automaticRestore'|'open'|'busy'|'error'|'signIn'|'setupRevision'|'cloudAccount'|'session'>): {initialRestorePending:boolean;accountRef:string|null} {
  const interactive=!!snapshot.signIn||!!snapshot.setupRevision||!!snapshot.error||(snapshot.open&&!snapshot.automaticRestore);
  const initialRestorePending=!interactive&&snapshot.startupResolved!==true&&snapshot.automaticRestore!==false;
  const account=snapshot.cloudAccount;
  if(interactive||initialRestorePending||snapshot.startupResolved!==true||snapshot.open||snapshot.busy||!snapshot.session||!account||account.environment!=='production')return {initialRestorePending,accountRef:null};
  const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)?value.toLowerCase():null;
  const user=uuid(account.userId),organization=account.organizationId==null?null:uuid(account.organizationId);
  if(!user||(account.organizationId!=null&&!organization))return {initialRestorePending:false,accountRef:null};
  return {initialRestorePending:false,accountRef:JSON.stringify(['cloud','production',user,organization])};
}
