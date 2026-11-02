import {recordManagedGoogleFailure,type ManagedGoogleFailureStage} from './managed-google-failure-stage.ts';
import {gmailAgentMailbox,type AgentMailboxChange} from '../scripts/gmail-agent-mailbox-host.ts';
import {calendarAgentWrite} from '../vendor/eliza/plugins/plugin-calendar/src/service/managed-calendar-host.ts';
/** Owner-only Google tools. Provider credentials remain in the private Cloud
 * store; Gmail sends use the canonical prepared-review/dispatch/receipt flow. */
import {createHash} from 'node:crypto';
import {CloudProtocol,type CloudCredential,type CloudNativeRequest} from '../apps/app/src/runtime/cloud-protocol.ts';
export type ManagedGoogleAgentPort={agentCredential():Promise<CloudCredential|null>;agentRead:CloudNativeRequest;agentGmailOperation:CloudNativeRequest;agentCalendarOperation:CloudNativeRequest};
import {decodeBasicHtmlEntities} from '../vendor/eliza/plugins/plugin-assistant/src/utils/html-entities.ts';
export type AgentSendContent={to:string[];subject:string;bodyText:string};
function sendProposal(input:AgentSendContent){
 if(!Array.isArray(input.to)||input.to.length<1||input.to.length>20||input.to.some(value=>typeof value!=='string'||value.length>320||!/^\S+@[^\s@]+\.[^\s@]+$/.test(value)||/[\p{Cc}\p{Cf}]/u.test(value))||typeof input.subject!=='string'||input.subject.length>998||/[\r\n]/.test(input.subject)||typeof input.bodyText!=='string'||input.bodyText.length>64000)throw Error('Review valid recipients, subject, and email text before preparing this send.');
 return {kind:'send',mode:'compose',to:input.to,cc:[],bcc:[],subject:input.subject,bodyText:input.bodyText,attachments:[]};
}
/** The owner's Settings switches. Off refuses agent writes before any Google request; reads, receipts and the connection stay. */
export type GoogleAgentAccess={gmailChanges:boolean;calendarEdits:boolean};
/** How long one source lookup can serve one read's feed step, from the lookup's start. */
const CALENDAR_READ_STEP_MS=5_000;
export function createManagedGoogleAgentHost(host:ManagedGoogleAgentPort,access:()=>GoogleAgentAccess=()=>({gmailChanges:true,calendarEdits:true})){
 const allowed=(kind:keyof GoogleAgentAccess)=>{if(access()[kind]!==true)throw Error(kind==='gmailChanges'?'Gmail changes are turned off in Settings › Google accounts. Google stays connected; nothing was changed.':'Calendar edits are turned off in Settings › Google accounts. Google stays connected; nothing was changed.');};
 const refuseWrite=()=>{throw Error('Gmail agent reads cannot change credentials or mail.');};
 // One Calendar read lists sources, then reads each feed. Without this the feed verifies the owner and lists calendars
 // again. A feed reuses the source step's lookups for seconds, and concurrent reads join one lookup. Source lists only
 // ever join a lookup still in flight, never a finished one, and every read ends with a fresh grant check.
 const shared=new Map<string,{monotonic:number;wall:number;pending:boolean;value:Promise<unknown>}>();
 let sharedOwner:string|undefined;
 async function sharedLookup<T>(key:string,read:()=>Promise<T>,reuseFinished:boolean):Promise<T>{
  const entry=shared.get(key);
  // Age takes the larger clock: the wall clock counts a suspended phone, the monotonic clock a corrected wall clock.
  const young=entry&&Math.max(performance.now()-entry.monotonic,Date.now()-entry.wall)<CALENDAR_READ_STEP_MS;
  // A failed lookup belongs to its caller, whose request may have ended: a joiner reads for itself.
  if(entry&&young&&(entry.pending||reuseFinished))return (entry.value as Promise<T>).catch(read);
  const value=read(),next={monotonic:performance.now(),wall:Date.now(),pending:true,value};shared.set(key,next);
  const drop=()=>{if(shared.get(key)===next)shared.delete(key);};
  value.then(()=>{next.pending=false;setTimeout(drop,CALENDAR_READ_STEP_MS).unref?.();},drop);
  return value;
 }
 const googleCalendars=(client:CloudProtocol,grantId:string,scope:string,signal:AbortSignal,reuseFinished:boolean)=>sharedLookup(`${scope}:calendars`,()=>client.googleCalendars(grantId,signal),reuseFinished);
 /** The verified Cloud owner and its connected accounts holding `capability`, each with its owner-scoped id. */
 async function ownerAccounts(parent:AbortSignal|undefined,capability:string,operation:false|true|'calendar',reuseFinished=false){
  let stage:ManagedGoogleFailureStage='credential';
  try{
  const credential=await host.agentCredential();if(!credential)throw Error('Sign in to Eliza Cloud before reading Gmail.');
  stage='signal';
  const identity=JSON.stringify(credential),signal=parent?AbortSignal.any([parent,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000);
  const current=async()=>{signal.throwIfAborted();if(JSON.stringify(await host.agentCredential())!==identity)throw Error('Cloud account changed while reading Gmail.');};
  stage='client';
  const client=new CloudProtocol('production',operation==='calendar'?host.agentCalendarOperation:operation?host.agentGmailOperation:host.agentRead,{acceptsReferences:true,read:async()=>{await current();return credential;},write:async()=>refuseWrite(),clear:async()=>refuseWrite()},async()=>refuseWrite());
  const calendarRead=capability==='google.calendar.read',ownerKey=createHash('sha256').update(identity).digest('hex');
  const listOwned=async()=>{
   stage='identity';
   const owner=await client.identity(signal);await current();
   if(owner.userId!==credential.userId||owner.organizationId!==credential.organizationId)throw Error('Cloud owner could not be verified for Gmail.');
   stage='accounts';
   return client.gmailAccounts(signal);
  };
  if(calendarRead&&sharedOwner!==ownerKey){shared.clear();sharedOwner=ownerKey;}
  const listed=calendarRead?await sharedLookup(ownerKey,listOwned,reuseFinished):await listOwned();
  stage='account-projection';
  const accounts=listed.filter(a=>a.connected&&a.connectionId&&a.grantedCapabilities.includes(capability)).map(account=>({account,grantId:account.connectionId!,scope:createHash('sha256').update(identity+':'+account.connectionId).digest('hex')}));
  stage='credential-recheck';
  await current();
  // Every grant used by the read must still hold the capability after it, or nothing is returned.
  const confirm=async(grantIds:string[])=>{try{const latest=await client.gmailAccounts(signal);if(grantIds.some(id=>!latest.some(a=>a.connectionId===id&&a.connected&&a.grantedCapabilities.includes(capability))))throw Error('Gmail permission changed.');await current();}catch(error){if(calendarRead)shared.clear();recordManagedGoogleFailure(error,'permission-recheck');throw error;}};
  return {client,signal,accounts,confirm};
  }catch(error){recordManagedGoogleFailure(error,stage);throw error;}
 }
 async function verified<T>(run:(client:CloudProtocol,grantId:string,scope:string,signal:AbortSignal)=>Promise<T>,parent?:AbortSignal,capability='google.gmail.triage',operation:false|true|'calendar'=false){
  const {client,signal,accounts,confirm}=await ownerAccounts(parent,capability,operation);
  if(accounts.length!==1)throw Error(accounts.length?'More than one Gmail account is connected. Select an account before an agent read.':capability==='google.gmail.mailbox'?'Gmail mailbox changes need permission. Enable Gmail changes in Settings → Connections.':'No readable Gmail account is connected.');
  const value=await run(client,accounts[0].grantId,accounts[0].scope,signal);await confirm([accounts[0].grantId]);return value;
 }
 return {
  async mailbox(input:AgentMailboxChange,parent?:AbortSignal){allowed('gmailChanges');return verified((client,grantId,scope,signal)=>gmailAgentMailbox(client,grantId,scope,input,signal),parent,'google.gmail.mailbox',true);},
  async calendarWrite(input:Record<string,unknown>,parent?:AbortSignal){
   allowed('calendarEdits');
   const {client,signal,accounts,confirm}=await ownerAccounts(parent,'google.calendar.write','calendar');
   const selected=accounts.filter(account=>input.grantId===`alpha-google:${account.scope}`);
   if(selected.length!==1)throw Error('Select a Calendar from the current owner connection.');
   const account=selected[0],result=await calendarAgentWrite(client,account.grantId,account.scope,input,signal,'alpha-google');
   await confirm([account.grantId]);return result;
  },
  async prepareSend(input:AgentSendContent&{requestId:string},parent?:AbortSignal){
   allowed('gmailChanges');const proposal=sendProposal(input);if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId))throw Error('Invalid send request identity.');
   return verified(async(client,grantId,scope,signal)=>{
    const prepared=await client.gmailPrepareOperation(grantId,input.requestId,proposal,signal);
    const digest=createHash('sha256').update(JSON.stringify(prepared.review)).digest('hex');
    if(prepared.receipt.kind!=='send'||prepared.receipt.state!=='prepared'||prepared.receipt.reviewDigest!==digest)throw Error('The prepared email review could not be verified.');
    if(prepared.review.kind!=='send'||typeof prepared.review.from!=='string'||!prepared.review.from||prepared.review.subject!==proposal.subject||prepared.review.bodyText!==proposal.bodyText||['to','cc','bcc'].some(key=>JSON.stringify(prepared.review[key])!==JSON.stringify(proposal[key as 'to'|'cc'|'bcc'])))throw Error('The provider review does not match the requested email. Nothing was sent.');
    return {id:`alpha-gmail-send:${scope}:${input.requestId}`,reviewDigest:digest,review:prepared.review,receipt:prepared.receipt};
   },parent,'google.gmail.send',true);
  },
  async sendReceipt(id:string,parent?:AbortSignal){
   return verified(async(client,grantId,scope,signal)=>{
    const prefix=`alpha-gmail-send:${scope}:`,requestId=id.slice(prefix.length);
    if(!id.startsWith(prefix)||!/^[-a-f0-9]{36}$/i.test(requestId))throw Error('This send belongs to another account or credential.');
    const receipt=await client.gmailOperation(grantId,requestId,signal);if(receipt.kind!=='send')throw Error('This is not an email send receipt.');return receipt;
   },parent,'google.gmail.send',true);
  },
  async dispatchSend(input:AgentSendContent&{id:string;reviewDigest:string},parent?:AbortSignal){
   allowed('gmailChanges');const proposal=sendProposal(input);if(!/^[a-f0-9]{64}$/.test(input.reviewDigest))throw Error('An exact prepared review is required.');
   return verified(async(client,grantId,scope,signal)=>{
    const prefix=`alpha-gmail-send:${scope}:`,requestId=input.id.slice(prefix.length);
    if(!input.id.startsWith(prefix)||!/^[-a-f0-9]{36}$/i.test(requestId))throw Error('This send belongs to another account or credential.');
    const prior=await client.gmailOperation(grantId,requestId,signal);
    if(prior.kind!=='send'||prior.reviewDigest!==input.reviewDigest)throw Error('The reviewed email changed. Nothing was sent.');
    if(prior.state==='succeeded')return prior;
    if(prior.state!=='prepared')throw Error('The send outcome needs review. This request will not be dispatched again.');
    return client.gmailDispatchOperation(grantId,requestId,input.reviewDigest,proposal,signal);
   },parent,'google.gmail.send',true);
  },
  async calendarSources(parent?:AbortSignal){
   try{
   // An unconnected optional provider contributes no sources. Connected-owner
   // identity/permission/provider failures still propagate.
   if(!await host.agentCredential())return [];
   // Calendar reads are scoped per grant, so every connected account's calendars are listed. Alpha shows one
   // merged Calendar: each account's own calendar and every calendar the owner shows in Google Calendar join the
   // agent feed by default (CalendarService keeps an explicit per-calendar choice once the owner makes one).
   const {client,signal,accounts,confirm}=await ownerAccounts(parent,'google.calendar.read','calendar');
   const sources=(await Promise.all(accounts.map(async({account,grantId,scope})=>(await googleCalendars(client,grantId,scope,signal,false)).filter(row=>['reader','writer','owner'].includes(row.accessRole)).map(row=>({...row,provider:'google',side:'owner',grantId:`alpha-google:${scope}`,connectorAccountId:`alpha-google:${scope}`,managedGoogleConnectionId:grantId,accountEmail:account.label,includeInFeed:row.primary||row.selected,selectionVersion:1}))))).flat();
   await confirm(accounts.map(a=>a.grantId));return sources;
   }catch(error){recordManagedGoogleFailure(error,'calendar-sources');throw error;}
  },
  async calendarFeed(input:{grantId:string;calendarId:string;timeMin:string;timeMax:string;timeZone:string},parent?:AbortSignal){
   const {client,signal,accounts,confirm}=await ownerAccounts(parent,'google.calendar.read','calendar',true);
   try{
   const owned=accounts.find(a=>input.grantId===`alpha-google:${a.scope}`);if(!owned)throw Error('Select a calendar from the current owner connection.');
   const {grantId,scope}=owned,readable=(rows:Awaited<ReturnType<typeof googleCalendars>>)=>rows.find(row=>row.calendarId===input.calendarId&&['reader','writer','owner'].includes(row.accessRole));
   // A calendar added since the previous step is still readable.
   let calendar=readable(await googleCalendars(client,grantId,scope,signal,true));
   if(!calendar)calendar=readable(await googleCalendars(client,grantId,scope,signal,false));
   if(!calendar)throw Error('This calendar is not currently readable.');
   const result=await client.googleCalendarFeed(grantId,input.calendarId,{timeMin:input.timeMin,timeMax:input.timeMax,timeZone:input.timeZone},signal);
   const key={provider:'google',side:'owner',grantId:input.grantId,connectorAccountId:input.grantId,calendarId:input.calendarId};
   await confirm([grantId]);
   return {...result,source:'synced',state:'complete',timeMin:input.timeMin,timeMax:input.timeMax,
    sources:[{key,summary:calendar.summary,accessRole:calendar.accessRole,visibility:'details',status:'fresh',syncedAt:result.syncedAt,error:null}],
    events:result.events.map(event=>({...event,id:`${input.grantId}:${event.externalId}`,agentId:'',provider:'google',side:'owner',grantId:input.grantId,connectorAccountId:input.grantId,syncedAt:result.syncedAt,updatedAt:typeof event.metadata.updated==='string'?event.metadata.updated:result.syncedAt,calendarSummary:calendar.summary}))};
   }catch(error){shared.clear();throw error;}
  },
  async list({limit=25,query='',since}:{limit?:number;query?:string;since?:string},parent?:AbortSignal){
   if(!Number.isSafeInteger(limit)||limit<1||limit>51||typeof query!=='string'||query.length>4096)throw Error('Choose a Gmail read limit from 1 to 50 plus its overflow probe.');
   const parts=[query||'in:inbox'];if(since!==undefined){const date=Date.parse(since);if(!Number.isFinite(date))throw Error('Invalid Gmail read date.');parts.push(`after:${Math.floor(date/1000)}`);}
   return verified(async(client,grantId,scope,signal)=>{
    const result=await client.gmailSearch(grantId,parts.join(' '),signal,limit<=10?10:limit<=25?25:50);
    const rows=[...result.messages];
    if(rows.length<limit&&result.nextPageToken){
     if(!result.mailboxHistoryId)throw Error('The mailbox cannot verify this paged read. Use a smaller limit.');
     const next=await client.gmailSearch(grantId,parts.join(' '),signal,10,result.nextPageToken);
     if(next.mailboxHistoryId!==result.mailboxHistoryId)throw Error('The Gmail mailbox changed during this read. Search again.');
     const ids=new Set(rows.map(row=>row.id));for(const row of next.messages)if(!ids.has(row.id)){ids.add(row.id);rows.push(row);}
    }
    return rows.slice(0,limit).map(row=>{if(!Number.isFinite(Date.parse(row.receivedAt)))throw Error('Gmail returned an invalid received date.');return {id:`alpha-gmail:${scope}:${row.id}`,platform:'gmail' as const,channel:'gmail',senderName:row.from,...(row.fromEmail?{senderIdentifier:row.fromEmail}:{}),snippet:decodeBasicHtmlEntities(row.snippet),receivedAt:row.receivedAt,threadTopic:decodeBasicHtmlEntities(row.subject),unread:row.unread};});
   },parent);
  },
  async message(messageId:string,parent?:AbortSignal){
   return verified(async(client,grantId,scope,signal)=>{
    const prefix=`alpha-gmail:${scope}:`;if(!messageId.startsWith(prefix))throw Error('Select an email from the current owner and Gmail account.');
    const providerId=messageId.slice(prefix.length);if(!/^[A-Za-z0-9_-]{1,160}$/.test(providerId))throw Error('Invalid Gmail message identity.');
    const result=await client.gmailRead(grantId,providerId,signal);return {id:messageId,from:result.message.from,subject:decodeBasicHtmlEntities(result.message.subject),bodyText:result.bodyText,receivedAt:result.message.receivedAt,unread:result.message.unread,hasAttachments:result.message.hasAttachments===true};
   },parent);
  }
 };
}
