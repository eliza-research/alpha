/** Account-personal Cloud contract; transport remains native and credential-fenced.
 * No background activation, scheduler, automatic paid retry or credential storage. */
export interface PersonalOwner { environment: string; credentialId: string; userId: string; organizationId: string }
export interface PersonalIdentity { personalElizaId: string; agentName: string; runtime: 'shared'|'dedicated'; activeAgentId?: string; apiBase?: string }
export interface PersonalReview {
  action: 'activate_dedicated'|'adopt_existing_dedicated'; personalElizaId: string; quoteId: string;
  dedicatedAgentId?: string; status?: string; startsCompute?: boolean;
  hourlyRateUsd:number; minimumActivationChargeUsd:number; dailyRateUsd:number;
  minimumBalanceUsd:number; minimumRunwayDays:number; balanceUsd:number; deficitUsd:number;
  stateDisposition?:string; requiresCatalogRestore?:boolean; available:boolean;
}
export interface PersonalReceipt { personalElizaId:string; dedicatedAgentId:string; jobId?:string }
export type PersonalView = {kind:'ready';identity:PersonalIdentity} | {kind:'review';review:Readonly<PersonalReview>}
  | {kind:'unavailable';review:Readonly<PersonalReview>} | {kind:'pending';receipt:Readonly<PersonalReceipt>;phase:'provisioning'|'cutover'};
export class PersonalProtocolError extends Error {
  constructor(readonly code:'invalid-response'|'http'|'account-changed'|'review-consumed'|'outcome-unknown'|'job-failed'|'receipt-invalid',readonly status?:number){super(`Cloud personal setup: ${code}`);}
}
type ResponseValue={status:number;data:unknown};
type Transport=(path:string,signal:AbortSignal,body?:unknown)=>Promise<ResponseValue>;
const obj=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new PersonalProtocolError('invalid-response');return v as Record<string,unknown>;};
const str=(v:unknown):string=>{if(typeof v!=='string'||!v.trim()||v.length>512)throw new PersonalProtocolError('invalid-response');return v;};
const id=(v:unknown):string=>{const s=str(v);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s))throw new PersonalProtocolError('invalid-response');return s;};
const personalId=(v:unknown):string=>{const s=str(v);if(!/^personal:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s))throw new PersonalProtocolError('invalid-response');return s;};
const code=(r:ResponseValue)=>{const d=obj(r.data);return typeof d.code==='string'?d.code:typeof d.error==='object'&&d.error?obj(d.error).code:null;};
const data=(r:ResponseValue)=>{if(r.status<200||r.status>=300)throw new PersonalProtocolError('http',r.status);const d=obj(r.data);if(d.success!==true)throw new PersonalProtocolError('invalid-response');return obj(d.data);};
const retryCutover=new Set(['shared_history_unavailable','personal_identity_convergence_in_progress','dedicated_not_healthy','dedicated_not_reachable','dedicated_transport_unavailable','personal_reminder_cutover_in_progress','dedicated_history_import_failed','shared_personal_snapshot_unstable','dedicated_reminder_activation_failed']);
export class CloudPersonalProtocol {
  private usedQuotes=new Set<string>(); private cutoverTargets=new Set<string>(); private reviews=new WeakSet<object>(); private receipts=new WeakSet<object>(); private finalized=new WeakSet<object>();
  constructor(readonly owner:Readonly<PersonalOwner>,private readonly request:Transport,
    private readonly targetStatus:(target:string,signal:AbortSignal,expectedApiBase?:string)=>Promise<string>) {}
  private route(personal:string){return `/api/v1/eliza/agents/${encodeURIComponent(personalId(personal))}/upgrade-tier`;}
  private pending(personal:string,target:string,jobId?:string,phase:'provisioning'|'cutover'=jobId?'provisioning':'cutover'):PersonalView {
    const receipt=Object.freeze({personalElizaId:personalId(personal),dedicatedAgentId:id(target),...(jobId?{jobId:id(jobId)}:{})});this.receipts.add(receipt);return {kind:'pending',receipt,phase};
  }
  private review(value:unknown,personal:string,adoption=false,target?:string,status?:string):PersonalView {
    const d=obj(value),quoteId=str(d.quoteId);if(!/^[a-f0-9]{64}$/.test(quoteId)||d.requiresConfirmation!==true||d.action!==(adoption?'adopt_existing_dedicated':'activate_dedicated'))throw new PersonalProtocolError('invalid-response');
    if(!adoption&&d.sourceAgentId!==personal)throw new PersonalProtocolError('invalid-response');
    const amounts={} as Pick<PersonalReview,'hourlyRateUsd'|'minimumActivationChargeUsd'|'dailyRateUsd'|'minimumBalanceUsd'|'minimumRunwayDays'|'balanceUsd'|'deficitUsd'>;
    for(const key of ['hourlyRateUsd','minimumActivationChargeUsd','dailyRateUsd','minimumBalanceUsd','minimumRunwayDays','balanceUsd','deficitUsd'] as const){const n=d[key];if(typeof n!=='number'||!Number.isFinite(n)||(key!=='balanceUsd'&&n<0))throw new PersonalProtocolError('invalid-response');amounts[key]=n;}
    const available=adoption?d.canAdopt:d.canActivate;if(typeof available!=='boolean')throw new PersonalProtocolError('invalid-response');
    const extras:Partial<PersonalReview>={};
    if(adoption){extras.dedicatedAgentId=id(d.dedicatedAgentId);if(target&&extras.dedicatedAgentId!==target)throw new PersonalProtocolError('invalid-response');if(!['available','adopted'].includes(String(d.adoptionState))||typeof d.startsCompute!=='boolean'||typeof d.requiresCatalogRestore!=='boolean'||!['fresh_boot_no_verified_backup','verified_backup_present','unreviewed_existing_target'].includes(String(d.stateDisposition)))throw new PersonalProtocolError('invalid-response');Object.assign(extras,{status:str(d.status),startsCompute:d.startsCompute,requiresCatalogRestore:d.requiresCatalogRestore,stateDisposition:d.stateDisposition});}
    else if(target){extras.dedicatedAgentId=target;if(status)extras.status=status;}
    const review=Object.freeze({...amounts,...extras,personalElizaId:personal,quoteId,action:adoption?'adopt_existing_dedicated' as const:'activate_dedicated' as const,available});this.reviews.add(review);return {kind:available?'review':'unavailable',review};
  }
  private async adoption(personal:string,signal:AbortSignal,target?:string):Promise<PersonalView|null>{const r=await this.request(`${this.route(personal)}/adopt-existing`,signal);if(r.status===404&&code(r)==='dedicated_adoption_unavailable')return null;return this.review(data(r),personal,true,target);}
  async identity(signal:AbortSignal):Promise<PersonalIdentity>{
    const d=obj(data(await this.request('/api/v1/eliza/personal',signal)).identity);
    const identity:PersonalIdentity={personalElizaId:personalId(d.id),agentName:str(d.displayName),runtime:d.runtime as PersonalIdentity['runtime']};
    if(d.runtime==='dedicated'){identity.activeAgentId=id(d.activeAgentId);identity.apiBase=str(d.apiBase);await this.targetStatus(identity.activeAgentId,signal,identity.apiBase);}
    else if(d.runtime!=='shared')throw new PersonalProtocolError('invalid-response');return Object.freeze(identity);
  }
  /** Read-only recovery after cancellation, restart or ambiguous activation. */
  async inspect(signal:AbortSignal):Promise<PersonalView>{const identity=await this.identity(signal);if(identity.runtime==='dedicated'&&(await this.targetStatus(identity.activeAgentId!,signal,identity.apiBase))==='running')return {kind:'ready',identity};return this.quote(identity.personalElizaId,signal,identity.activeAgentId);}
  private async quote(personal:string,signal:AbortSignal,expectedTarget?:string):Promise<PersonalView>{
    const d=data(await this.request(this.route(personal),signal)),a=obj(d.activation);
    if(a.state==='in_progress'){const target=id(a.dedicatedAgentId),status=str(a.status);if(expectedTarget&&target!==expectedTarget)throw new PersonalProtocolError('invalid-response');// Cloud keeps a disconnected target's container and reconnects it; it still owns the upgrade.
      if(['pending','provisioning','running','disconnected'].includes(status)){this.review(d,personal,false,target);return this.pending(personal,target,undefined,status==='running'?'cutover':'provisioning');}
      if(!['error','stopped','sleeping'].includes(status))throw new PersonalProtocolError('invalid-response');const adopted=await this.adoption(personal,signal,target);return adopted??this.review(d,personal,false,target,status);}
    if(a.state!=='available'||expectedTarget)throw new PersonalProtocolError('invalid-response');return this.review(d,personal);
  }
  /** Exactly one attempted activation/adoption per adapter-issued reviewed object. */
  async accept(review:Readonly<PersonalReview>,signal:AbortSignal):Promise<PersonalView>{
    signal.throwIfAborted();const key=review.action+':'+review.quoteId;if(!this.reviews.delete(review)||!review.available||this.usedQuotes.has(key))throw new PersonalProtocolError('review-consumed');this.usedQuotes.add(key);
    const adoption=review.action==='adopt_existing_dedicated';let r:ResponseValue;
    try{r=await this.request(this.route(review.personalElizaId)+(adoption?'/adopt-existing':''),signal,{action:review.action,quoteId:review.quoteId,minimumActivationChargeUsd:review.minimumActivationChargeUsd});}
    catch{throw new PersonalProtocolError('outcome-unknown');}
    if(r.status===409){const c=code(r);if(c==='dedicated_adoption_selection_required'||c==='dedicated_adoption_quote_changed'){const next=await this.adoption(review.personalElizaId,signal,review.dedicatedAgentId);if(!next)throw new PersonalProtocolError('invalid-response');return next;}if(c==='dedicated_quote_changed')return this.quote(review.personalElizaId,signal,review.dedicatedAgentId);}
    if(r.status>=500||r.status===408)throw new PersonalProtocolError('outcome-unknown');
    if(r.status<200||r.status>=300)throw new PersonalProtocolError('http',r.status);
    try {const d=data(r),target=id(d.dedicatedAgentId);if(review.dedicatedAgentId&&target!==review.dedicatedAgentId)throw new PersonalProtocolError('outcome-unknown');
    if(adoption&&d.runtime!=='dedicated_pending_cutover')throw new PersonalProtocolError('outcome-unknown');
    if(r.status===202&&!d.jobId)throw new PersonalProtocolError('outcome-unknown');return this.pending(review.personalElizaId,target,d.jobId==null?undefined:id(d.jobId));} catch {throw new PersonalProtocolError('outcome-unknown');}
  }
  /** One read; UI owns bounded polling and can stop without cancelling accepted work. */
  async poll(receipt:Readonly<PersonalReceipt>,signal:AbortSignal):Promise<PersonalView>{
    if(!this.receipts.has(receipt))throw new PersonalProtocolError('receipt-invalid');
    const identity=await this.identity(signal);if(identity.personalElizaId!==receipt.personalElizaId)throw new PersonalProtocolError('account-changed');
    if(identity.runtime==='dedicated'){if(identity.activeAgentId!==receipt.dedicatedAgentId)throw new PersonalProtocolError('invalid-response');if((await this.targetStatus(receipt.dedicatedAgentId,signal,identity.apiBase))==='running')return {kind:'ready',identity};}
    if(!receipt.jobId){const status=await this.targetStatus(receipt.dedicatedAgentId,signal);if(['stopped','sleeping','error'].includes(status))return this.quote(receipt.personalElizaId,signal,receipt.dedicatedAgentId);if(!['pending','provisioning','running','disconnected'].includes(status))throw new PersonalProtocolError('invalid-response');return {kind:'pending',receipt,phase:status==='running'?'cutover':'provisioning'};}
    const r=await this.request(`/api/v1/jobs/${encodeURIComponent(receipt.jobId)}`,signal);
    if([408,429,500,502,503,504].includes(r.status))return {kind:'pending',receipt,phase:'provisioning'};
    const d=data(r);if(d.id!==receipt.jobId)throw new PersonalProtocolError('invalid-response');if(d.status==='failed')throw new PersonalProtocolError('job-failed');if(!['pending','in_progress','completed'].includes(String(d.status)))throw new PersonalProtocolError('invalid-response');return {kind:'pending',receipt,phase:d.status==='completed'?'cutover':'provisioning'};
  }
  /** Explicit continuation of accepted server work. Unknown responses are not retried.
   * Only server-declared retryable cutover codes permit another explicit attempt. */
  async finalize(receipt:Readonly<PersonalReceipt>,signal:AbortSignal):Promise<PersonalView>{
    signal.throwIfAborted();if(!this.receipts.has(receipt)||this.finalized.has(receipt)||this.cutoverTargets.has(receipt.dedicatedAgentId))throw new PersonalProtocolError('receipt-invalid');
    const current=await this.poll(receipt,signal);if(current.kind!=='pending'||current.phase==='provisioning')return current;
    this.finalized.add(receipt);this.cutoverTargets.add(receipt.dedicatedAgentId);let r:ResponseValue;try{r=await this.request(`${this.route(receipt.personalElizaId)}/cutover`,signal,{dedicatedAgentId:receipt.dedicatedAgentId});}catch{throw new PersonalProtocolError('outcome-unknown');}
    if(r.status>=400&&retryCutover.has(String(code(r)))){this.finalized.delete(receipt);this.cutoverTargets.delete(receipt.dedicatedAgentId);return {kind:'pending',receipt,phase:'cutover'};}
    const d=data(r);if(d.personalElizaId!==receipt.personalElizaId||d.activeAgentId!==receipt.dedicatedAgentId||d.runtime!=='dedicated'||typeof d.importedMessages!=='number'||!Number.isSafeInteger(d.importedMessages)||d.importedMessages<0)throw new PersonalProtocolError('outcome-unknown');
    const identity=await this.identity(signal);if(identity.runtime!=='dedicated'||identity.personalElizaId!==receipt.personalElizaId||identity.activeAgentId!==receipt.dedicatedAgentId||identity.apiBase!==d.apiBase||(await this.targetStatus(receipt.dedicatedAgentId,signal,identity.apiBase))!=='running')throw new PersonalProtocolError('outcome-unknown');return {kind:'ready',identity};
  }
}
