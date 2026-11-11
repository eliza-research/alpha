import React,{useEffect,useId,useRef,useState} from 'react';
import './cloud-membership-ui.css';
import {Busy,StatusDot} from './status-ui';
import {iconStyle} from '../icon-style';
export type MembershipBalance='checking'|'zero'|'funded'|'member'|'unavailable';
/** A plan is needed before the account can use Cloud inference. */
export const FUNDING_NEEDED='Plan needed';
/** Cloud declined a turn for this account's billing: the chat's one answer, beside this sheet. */
export function fundingRefusedReply(serviceName:string):string {void serviceName;return 'Billing declined';}
import {alphaSubscriptionCopy,type ServiceLimit,type SubscriptionView} from './subscription-entitlement';
import {useCloudSubscriptionSummary} from '../../../../.eliza/client-features/packages/ui/src/components/settings/cloud-subscription-summary.tsx';
function endLabel(endsAt:number):string {
 const date=new Date(endsAt).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
 const days=Math.ceil((endsAt-Date.now())/86400000);
 return days>0?`${days}d left`:`Ended ${date}`;
}
/**
 * Shared Account presentation (owner consolidation, 2026-11-09). Plan and
 * actions remain bound to the current Cloud account. The shared subscription summary
 * (`@elizaos/cloud-sdk/subscription-entitlement`, through the shared `useCloudSubscriptionSummary` hook) adds, read-only, the plan allowance Cloud reports and
 * the latest Cloud limit with its retry time (#410). Plan management opens Cloud's
 * billing page after the account review; Enter membership code reveals the code field.
 * A grant's access window is never presented as a paid renewal date.
 *
 * `refused`: Cloud declined this account's last AI request for billing, so the sheet says so.
 *
 */
export function CloudMembershipControls({balance,busy,error,connectionError,notice,email,plan,endsAt,lastLimit,refused=false,serviceName='Cloud',codeEntry=false,credits,onRedeem,onManagePlan,onRefresh}:{balance:MembershipBalance;credits?:{usd:string;observedAt:number}|null;busy:boolean;error?:string;connectionError?:string;notice?:string;email?:string;plan?:SubscriptionView|null;endsAt?:number|null;lastLimit?:(ServiceLimit&{observedAt:number})|null;refused?:boolean;serviceName?:string;codeEntry?:boolean;onRedeem:(code:string)=>Promise<boolean>;onManagePlan:()=>void;onRefresh:()=>void}){
 const code=useRef<HTMLInputElement>(null),pending=useRef(false),codeEntryId=useId(),errorId=useId();
 // A retained redemption error must keep its associated input exposed.
 const [codeVisible,setCodeVisible]=useState(Boolean(error)),[submitting,setSubmitting]=useState(false),[submissionError,setSubmissionError]=useState(''),[codeValue,setCodeValue]=useState('');
 const active=plan?.kind==='active',disabled=busy||submitting,showCode=codeVisible||codeEntry,explicitEntry=useRef(codeEntry);
 // The shared hook (elizaOS/eliza#38105) renders again only when the shown limit's wait ends or its
 // reset passes, so a lapsed retry time is not left on screen; it is not a per-second countdown.
 const summary=useCloudSubscriptionSummary(plan,{planEndsAt:endsAt??null,lastLimit:lastLimit??null,copy:alphaSubscriptionCopy(serviceName)});
 const noPlan=plan?.kind==='inactive'||plan?.kind==='credits';
 const checking=plan?.kind==='checking'||(!plan&&balance==='checking');
 const planName=active?plan.planName:plan?.kind==='expired'?plan.planName:noPlan?<StatusDot tone="off">No plan</StatusDot>:checking?<Busy label="Checking"/>:<StatusDot tone="warn">Unconfirmed</StatusDot>;
 // Used share of a published allowance, for the usage bar; never estimated.
 const allowance=active?plan.allowance:null;
 const usedShare=!allowance?null:'granted' in allowance?(allowance.granted>0?1-allowance.remaining/allowance.granted:null):allowance.limit&&allowance.used!==null?allowance.used/allowance.limit:null;
 const accessEndsAt=summary.planEndsAt;
 // Leaving an explicit code entry clears the code it held; a retained redemption error keeps the input.
 useEffect(()=>{if(explicitEntry.current&&!codeEntry){setCodeValue('');setSubmissionError('');setCodeVisible(Boolean(error));}explicitEntry.current=codeEntry;},[codeEntry,error]);
 useEffect(()=>{if(showCode)code.current?.focus();},[showCode]);
 async function redeem(event:React.FormEvent){
  event.preventDefault();const input=code.current;
  if(!input||!input.value.trim()||disabled||pending.current)return;
  pending.current=true;setSubmitting(true);setSubmissionError('');
  try{const ok=await onRedeem(input.value);if(ok&&code.current===input)setCodeValue('');}
  catch{setSubmissionError('Not confirmed');}
  finally{pending.current=false;setSubmitting(false);}
 }
 return <section className="alpha-membership" aria-label="Balance and membership">
   <p className="alpha-membership-account">{email||<><span aria-hidden="true" style={iconStyle('user-round')}/><span className="alpha-sr">Signed in to {serviceName}</span></>}</p>
   <dl className="alpha-membership-facts">
    <div className="alpha-membership-balance-fact"><dt>Balance</dt><dd><strong className="alpha-membership-amount">{credits?`$${Number(credits.usd).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`:balance==='checking'?<Busy label="Checking"/>:<><span aria-hidden="true">—</span><span className="alpha-sr">Not available</span></>}</strong><button type="button" className="alpha-membership-refresh" aria-label="Refresh account" disabled={disabled||checking} onClick={onRefresh}><span aria-hidden="true" className="alpha-account-refresh-icon"/></button></dd></div>
    <div className="alpha-membership-plan-fact"><dt>Plan</dt><dd>
     <div className="alpha-membership-plan-heading"><strong className="alpha-membership-plan-name">{planName}</strong></div>
     {active&&<small className="alpha-membership-plan-status alpha-plan-pill" data-status={plan.status}><StatusDot tone={plan.status==='past_due'?'err':plan.status==='trialing'?'warn':'ok'}>{plan.status==='past_due'?'Payment due':plan.status==='trialing'?'Trial':'Active'}</StatusDot></small>}
     {active&&typeof accessEndsAt==='number'&&Number.isFinite(accessEndsAt)&&<small>{endLabel(accessEndsAt)}</small>}
    </dd></div>
    {active&&summary.allowance&&<div className="alpha-membership-usage-fact"><dt>Usage</dt><dd className="alpha-membership-allowance">{usedShare!==null&&<span className="alpha-usage-bar" aria-hidden="true"><span style={{width:`${Math.round(Math.min(1,Math.max(0,usedShare))*100)}%`}}/></span>}{summary.allowance}</dd></div>}
    {summary.limit&&<div className="alpha-membership-limit-fact"><dt>Limit</dt><dd role="status">{summary.limit}</dd></div>}
   </dl>
   <p className="alpha-membership-support" role="status">{refused?<StatusDot tone="err">Billing declined</StatusDot>:checking?'':noPlan?'':!active?'Couldn’t refresh':plan.status==='past_due'?'Update payment':plan.refreshFailed?'Couldn’t refresh':''}</p>
   <div className="alpha-membership-main-actions"><button type="button" className="alpha-membership-primary" disabled={disabled} onClick={onManagePlan}><span className="alpha-account-button-icon alpha-account-plan-icon" aria-hidden="true"/>{noPlan?'Choose plan':'Plan'}</button><div className="alpha-membership-secondary-actions"><button type="button" className="alpha-membership-secondary" disabled={disabled} onClick={onManagePlan}><span className="alpha-account-button-icon alpha-account-balance-icon" aria-hidden="true"/>Add funds</button>{!showCode&&<button type="button" className="alpha-membership-secondary" aria-expanded={false} aria-controls={codeEntryId} disabled={disabled} onClick={()=>setCodeVisible(true)}><span className="alpha-account-button-icon alpha-account-code-icon" aria-hidden="true"/>Code</button>}</div></div>
   {showCode&&<div id={codeEntryId} className="alpha-membership-code-entry"><form aria-label="Redeem a membership code" onSubmit={event=>void redeem(event)}>
     <label><span className="alpha-sr">Membership code</span><input ref={code} name="membership-code" value={codeValue} onChange={event=>setCodeValue(event.target.value)} placeholder="Enter code" autoComplete="one-time-code" autoCapitalize="characters" autoCorrect="off" spellCheck={false} data-autofill-ignore="true" maxLength={64} disabled={disabled} required aria-invalid={!!error||!!submissionError||undefined} aria-describedby={error||submissionError?errorId:undefined}/></label>
     <button type="submit" disabled={disabled||!codeValue.trim()}>{submitting?<Busy label="Redeeming"/>:'Redeem'}</button>
   </form></div>}
   {[...new Set([error||submissionError,connectionError].filter((value):value is string=>!!value))].map((value,index)=><p key={value} id={index===0?errorId:undefined} role="alert">{value}</p>)}{notice&&<p role="status">{notice}</p>}
 </section>;
}
