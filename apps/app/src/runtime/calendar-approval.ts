export const CALENDAR_APPROVAL_READ_PATH='/api/approvals?state=all&limit=500';
/** Calendar markup identifies a candidate review; only the authenticated queue can authorize it. */
const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
export const calendarApprovalId=(value:unknown):value is string=>typeof value==='string'&&new RegExp('^'+uuid+'$','i').test(value);
// String.replace resets a global pattern's lastIndex, so one shared pattern is safe.
const reviewPattern=new RegExp('\\[CHOICE:approval-('+uuid+') id=\\1\\]\\s*\\r?\\n([\\s\\S]*?)\\r?\\n\\[/CHOICE\\]','gi');
export function calendarReviewText(text:string){
 const ids:string[]=[];
 const rendered=text.replace(reviewPattern,(whole,id,body)=>{
  const values=body.split(/\r?\n/).map((line:string)=>line.trim()).filter(Boolean).map((line:string)=>{const at=line.indexOf('=');return at>0&&line.slice(at+1).trim()?line.slice(0,at).trim():'';});
  if(values.length!==2||!values.includes('approve '+id)||!values.includes('reject '+id))return whole;
  if(!ids.includes(id))ids.push(id);return '';
 });
 // Ordinary messages keep their exact text, including indentation and trailing paragraphs.
 const displayText=ids.length?rendered.trim():rendered;
 return {displayText,ids};
}
/** Inbox queue choices name commands whose adapter capability Alpha cannot check, so they are
 * shown as prose only. Complete blocks are removed; malformed ones stay literal. */
export function inboxChoiceText(text:string){
 let removed=false;
 const pattern=/\[CHOICE:inbox-(?:draft|thread)-([^\s\]]{1,200}) id=\1\]\r?\n([\s\S]*?)\r?\n\[\/CHOICE\]/g;
 const rendered=text.replace(pattern,(whole,id:string,body:string)=>{
  const lines=body.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const valid=lines.length>0&&lines.every(line=>{const at=line.indexOf('=');return at>0&&!!line.slice(at+1).trim()&&/^inbox [a-z]+ (.+)$/.exec(line.slice(0,at).trim())?.[1]===id;});
  if(!valid)return whole;removed=true;return '';
 });
 return removed?rendered.replace(/\n{3,}/g,'\n\n').trim():text;
}
export type CalendarApproval={id:string;ownerVerified:boolean;state:string;action:'schedule_event'|'modify_event'|'cancel_event';reason:string;expiresAt:string;payload:Record<string,unknown>;revision:string};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function calendarApprovalFromList(raw:unknown,id:string,ownerId:string):CalendarApproval|null{
 if(!calendarApprovalId(id)||!ownerId||!object(raw)||!Array.isArray(raw.approvals))throw Error('Calendar review status is unavailable.');
 const matches=raw.approvals.filter(row=>object(row)&&row.id===id);
 if(matches.length!==1)return null;
 const row=matches[0];
 if(typeof row.subjectUserId!=='string'||!['schedule_event','modify_event','cancel_event'].includes(row.action)||!object(row.payload)||row.payload.action!==row.action||row.payload.side!=='owner'||typeof row.payload.calendarId!=='string'||!row.payload.calendarId||typeof row.reason!=='string'||typeof row.expiresAt!=='string'||!Number.isFinite(Date.parse(row.expiresAt))||typeof row.updatedAt!=='string'||!Number.isFinite(Date.parse(row.updatedAt))||!['pending','approved','executing','retryable','reconciliation_required','done','rejected','expired'].includes(row.state))return null;
 const authority=raw.ownerEntityId===undefined?ownerId:calendarApprovalId(raw.ownerEntityId)?raw.ownerEntityId:null;
 return {id,ownerVerified:authority===row.subjectUserId,state:row.state,action:row.action,reason:row.reason,expiresAt:row.expiresAt,payload:row.payload,revision:JSON.stringify([row.id,row.subjectUserId,row.state,row.action,row.payload,row.reason,row.expiresAt,row.updatedAt])};
}
export function calendarApprovalPending(row:CalendarApproval|null,now=Date.now()){return !!row&&row.ownerVerified&&row.state==='pending'&&Date.parse(row.expiresAt)>now;}
export function calendarApprovalStatus(row:CalendarApproval|null,now=Date.now()){
 if(!row)return 'Status unavailable';
 if(row.state==='expired'||row.state==='pending'&&Date.parse(row.expiresAt)<=now)return 'Review expired';
 if(row.state==='pending')return row.ownerVerified?'Awaiting your approval':'Approval unavailable';
 if(row.state==='rejected')return 'Request declined';
 if(row.state==='done')return 'Review closed';
 return 'Change not confirmed';
}
export type CalendarApprovalDecision = 'approve' | 'reject';
export type CalendarApprovalResolution = {requestId:string;decision:CalendarApprovalDecision;kind:'succeeded'|'rejected'|'invalidated'|'retryable'|'blocked';text:string};
export function calendarApprovalBody(row:CalendarApproval,decision:CalendarApprovalDecision){
 if(!calendarApprovalPending(row)||!['approve','reject'].includes(decision))throw Error('This Calendar request is no longer pending.');
 return {decision,revision:row.revision};
}
