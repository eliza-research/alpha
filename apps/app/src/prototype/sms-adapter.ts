import {isIncompleteSmsRow,normalizePhoneNumber} from '../../../../.eliza/client-features/packages/contracts/src/native-telephony.ts';
import {createAddressBookClient,type AddressBookNativePlugin} from '../../../../.eliza/client-features/packages/contracts/src/native-address-book.ts';
import {registerPlugin} from '../platform-plugins';
import {aospImage} from '../runtime/aosp-image';
import {createSmsSession,mmsProblemLabel,mmsReceiptLabel,receiptLabel} from '../runtime/image-sms';
import {smsSubscriptionRevision} from '../runtime/sms-subscription-revision';
import {createAospTelephony,registerTelephonyProfile,MMS_MAX_ATTACHMENTS,reviewMms,reviewSms,type AlphaTelephonyPlugin,type MmsAttachmentDraft,type MmsReview,type SmsMessage,type SmsReviewProblem,type SmsSendResult} from '../runtime/aosp-telephony';
import {createNativeSmsDraftShelf,reviewedDraft,type ReviewedSms,type SmsDraft,type SmsDraftStore} from '../runtime/native-sms-drafts';
import {watchReturnToApp} from './native-adapter';
import {formatDateTime,formatMonthDay,formatTime} from './locale-time';
import {displayNumber,initials,numberKey,shortWhen,threadTitle} from './telephony-presenters';
import {createSmsRecipientPicker} from './sms-recipient-picker';
import {askedDraftPlaced,canSuggest,draftAdopted,draftStageFit,draftUndone,emptyDraft,readinessLost,reviewFinished,suggestionDismissed,suggestionReplied,suggestionRequested,threadChanged,typed,type DraftState} from '../runtime/message-draft';
import {setListFilterHandler,type CommsBarSpec,type CommsListFilter} from '../runtime/comms-bar';
/** The open thread's visible tail, handed to the reply suggester and to the agent's selected-thread read. */
export type OpenThread={participant:string|null;messages:{direction:'in'|'out';date:number;body:string}[];truncated:boolean};
export type SmsReplySuggester=(thread:OpenThread,signal:AbortSignal)=>Promise<string|null>;
let suggester:SmsReplySuggester|null=null;
/** Installed only while the owner has suggested replies turned on; null turns them off. */
export function setSmsReplySuggester(next:SmsReplySuggester|null){suggester=next;}
/* Suggested replies are off until the owner turns them on in a conversation; the choice stays on this phone. */
const SUGGEST_KEY='alpha.messages.suggest-replies.v1';
const suggestOn=()=>{try{return globalThis.localStorage?.getItem(SUGGEST_KEY)==='1';}catch{return false;}};
const setSuggest=(on:boolean)=>{try{if(on)globalThis.localStorage?.setItem(SUGGEST_KEY,'1');else globalThis.localStorage?.removeItem(SUGGEST_KEY);}catch{/* The switch then simply stays off. */}};
let openThreadReader:(()=>OpenThread|null)|null=null,openThreadSelection:(()=>string|null)|null=null;
/** The selected thread identity for on-device approval checks. */
export const openSmsThreadSelection=()=>openThreadSelection?.()??null;
/** What the owner has open in Messages right now, for `messages_read_selected`; null when no thread is open. */
export const openSmsThread=()=>openThreadReader?.()??null;
/** What became of a draft Alpha was asked to put in the open conversation's draft slot. */
export type AskedDraft='drafted'|'none-selected'|'occupied'|'unavailable';
let askedDraftWriter:((text:string,number?:string)=>AskedDraft)|null=null;
/**
 * Puts a draft the owner asked Alpha for into the open conversation's draft slot (AC-14); with
 * `number`, only when that conversation is with exactly that number. It replaces the slot, the owner's
 * text included, and keeps the previous text for one Undo. 'occupied' means a message is being sent
 * or has pictures attached. It never sends: Send stays the owner's tap.
 */
export const placeAskedSmsDraft=(text:string,number?:string):AskedDraft=>askedDraftWriter?askedDraftWriter(text,number):'none-selected';
let draftUndoer:(()=>boolean)|null=null,draftReader:(()=>SmsDraftView|null)|null=null;
/** Puts back the text Alpha's last draft replaced. False when there is nothing to undo or a send is in flight. */
export const undoSmsDraft=():boolean=>draftUndoer?draftUndoer():false;
export type SmsDraftView={by:'owner'|'alpha'|'suggestion';text:string;canUndo:boolean;threadId:string};
/** The open thread's draft slot, for local presentation and tests only: never agent context (AC-31). */
export const readSmsDraft=():SmsDraftView|null=>draftReader?draftReader():null;
const THREAD_TAIL=20;
const SMS_NOTICE_OPEN='alpha:sms-notice-open';
const COMPOSER_REPLY_TIMEOUT_MS=30_000;
type SmsComposeRequest=Parameters<AlphaTelephonyPlugin['sendSms']>[0];
type MmsComposeRequest=Parameters<NonNullable<AlphaTelephonyPlugin['sendMms']>>[0];
type MessagesBridge=AlphaTelephonyPlugin&{
 smsNoticePending():Promise<{threadId?:string;token?:string}>;
 acknowledgeSmsNotice(options:{token:string}):Promise<void>;
};
type ComposerPort=Pick<EventTarget,'addEventListener'|'removeEventListener'>&{postMessage(value:string):void};
type Bag=Record<string,any>;
type SentFrom={by:'alpha'|'owner';text:string;title:string};
type OutgoingSms={id:string;threadId:string|null;review:ReviewedSms;startedAt:number;createdAt?:number;seen:Set<string>};
const quietNotices=new Set([
 receiptLabel('submitted'),receiptLabel('sent'),receiptLabel('delivered'),receiptLabel('cancelled'),receiptLabel('denied'),receiptLabel('failed'),receiptLabel('unknown'),
 mmsReceiptLabel('submitted'),mmsReceiptLabel('sent'),mmsReceiptLabel('cancelled'),mmsReceiptLabel('denied'),mmsReceiptLabel('failed'),mmsReceiptLabel('unknown'),
]);
const failureNotices=new Set([receiptLabel('failed'),mmsReceiptLabel('failed')]);
const MMS_PICTURES:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/gif':'gif'};
/* Native rejects with these codes before it journals or sends anything, so its message is the
 * reason and the next Send opens a new review. */
const SMS_NOT_SENT=new Set(['too-long','invalid','busy','unavailable']);
/* Owner text for the shared review's refusals; a handoff allows more people and a longer text. */
function smsProblemLabel(problem:SmsReviewProblem,mode:'direct'|'handoff',chosen:boolean,length=0){
 return {'no-recipient':'Add a number','invalid-recipient':'Invalid number','too-many-recipients':mode==='direct'?'Max 5':'Max 10','empty-body':'Enter a message.','body-too-long':`${length.toLocaleString('en-US')}/${mode==='direct'?'1,600':'5,000'}`,'invalid-body':'Unsupported characters','sim-unknown':chosen?'SIM inactive':'No SIM','sim-required':'Pick a SIM','sim-not-selectable':'Pick SIM in Messages'}[problem];
}
export function installSmsAdapter(Component:any,views:Bag,draftStore?:SmsDraftStore){
 if(!aospImage)return;
 const shelf=draftStore?createNativeSmsDraftShelf(draftStore):null;
 let retained:Awaited<ReturnType<NonNullable<typeof shelf>['open']>>|null=null,draftLoading=false,draftTicket=0;
 let storageNotice='';
 const native=registerPlugin<MessagesBridge>('AlphaTelephony');
 const client=createAospTelephony(native,true),p=Component.prototype,mount=p.componentDidMount,update=p.componentDidUpdate,unmount=p.componentWillUnmount;
 let owner:any,recipients='',body='',sim='',operationId='',busy=false,notice='',active=false,lifecycle=0,draftRevision=0,picking=false;
 let receipt:SmsSendResult|null=null,selectedThread:{id:string;addresses:string[]}|null=null;
 /* Composer draft and suggested reply (MessageThreads.qnt); contact names for the visit only. */
 let draft:DraftState=emptyDraft(),draftThread:string|null=null,composing=false,suggestConfirm=false,suggesting:AbortController|null=null,namesLoaded=false,api:Bag|null=null;
 /* AC-22: the list filter, typed in the bar or applied by Alpha. AC-15: the bubble just sent, until the provider lists it. */
 let listFilter:CommsListFilter|null=null,bubbleSent:{by:'alpha'|'owner';text:string}|null=null;
 const names=new Map<string,string>(),people:{name:string;number:string}[]=[];
 /* The reviewed text an operation ID was assigned for: the native send and its read-back hash exactly this. */
 let smsReview:ReviewedSms|null=null;
 let composerAbort=new AbortController();
 /* The last text sent this visit: its composer is clear, and its result is still read back for exactly what was reviewed. */
 let sent:{id:string;review:ReviewedSms}|null=null;
 const outgoing=new Map<string,OutgoingSms>(),matchedProviderRows=new Set<string>();
 /* A reviewed MMS (group message or pictures) keeps its own operation ID and the exact reviewed
  * content, so a result is read back only for what the owner reviewed. */
 let attachments:MmsAttachmentDraft[]=[],pictureSeq=0,mmsOperationId='',mmsReview:MmsReview|null=null,mmsSent:{id:string;review:MmsReview}|null=null;
 const paint=()=>owner?.setState({smsNativeRevision:Date.now()});
 const changed=()=>{updateOutgoing();drive();paint();};
 /* The verified image's reviewed client is the shared Messages and Phone profile while this shell
  * is installed; off the image this adapter returns above, so nothing is registered. */
 registerTelephonyProfile(client);
 const session=createSmsSession(client,true,changed,id=>void reconcile(id),id=>void reconcileMms(id));
 /* Android's picture chooser covers the WebView and reports it hidden; the draft stays while it is open. */
 const sync=()=>{const next=!!owner&&owner.S().view==='messages'&&(!document.hidden||picking);if(next===active)return;active=next;lifecycle++;
  if(next)composerAbort=new AbortController();else composerAbort.abort();
  session.setActive(next);if(!next){recipientPicker.close();busy=false;suggestConfirm=false;draftRevision++;
  // Provider rows are visit-only. The owner's draft and its operation identity are stored separately.
  // Contact names, a suggestion in flight and an untouched automatic suggestion are for the visit only.
  suggesting?.abort();suggesting=null;if(draft.draft==='agent'&&!operationId&&!mmsOperationId)draft=emptyDraft();else draft=readinessLost(draft);names.clear();people.length=0;selectedThread=null;namesLoaded=false;listFilter=null;bubbleSent=null;
  outgoing.clear();matchedProviderRows.clear();
 }else{void reconcile();void reconcileMms();}};
 const resetMms=(pictures:boolean)=>{mmsOperationId='';mmsReview=null;if(pictures){attachments=[];pictureSeq=0;}};
 const inputRecipients=()=>recipients.split(',').map(v=>v.trim()).filter(Boolean);
 const inFront=()=>active&&owner?.S().view==='messages'&&!document.hidden;
 /* Keep the shared profile on reviewed sends. Only this click's local client substitutes
  * the origin-checked composer port, retaining the shared digest and receipt validation. */
 function composerClient(visit:number){
  const signal=composerAbort.signal;
  const unavailable=()=>Object.assign(new Error('Open the Messages composer to send this draft.'),{code:'unavailable'});
  const post=(kind:'sms'|'mms',draft:SmsComposeRequest|MmsComposeRequest)=>{
   const port=(window as Window&{alphaMessagesComposer?:ComposerPort}).alphaMessagesComposer;
   if(!port||signal.aborted||!inFront()||visit!==lifecycle||owner?.props?.assistantSurface)throw unavailable();
   const requestId=crypto.randomUUID();
   return new Promise<unknown>((resolve,reject)=>{
    const cleanup=()=>{
     window.clearTimeout(timer);
     port.removeEventListener('message',receive);
     signal.removeEventListener('abort',abort);
    };
    const abort=()=>{cleanup();reject(unavailable());};
    const receive=(event:Event)=>{
     const data=(event as MessageEvent).data;
     if(typeof data!=='string')return;
     let reply;
     try{reply=JSON.parse(data);}catch{return;}
     if(!reply||reply.requestId!==requestId)return;
     cleanup();
     if(reply.error)reject(Object.assign(new Error(reply.error.message),{code:reply.error.code}));
     else resolve(reply.result);
    };
    const timer=window.setTimeout(()=>{
     cleanup();
     // A missing reply leaves the send outcome unknown. Keep the operation ID for journaled retry.
     reject(new Error('Messages composer did not reply.'));
    },COMPOSER_REPLY_TIMEOUT_MS);
    port.addEventListener('message',receive);
    signal.addEventListener('abort',abort,{once:true});
    try{port.postMessage(JSON.stringify({requestId,kind,draft}));}
    catch(error){cleanup();reject(error);}
   });
  };
  return createAospTelephony(new Proxy(native,{
   get(bridge,method,receiver){
    if(method==='sendSms')return (request:SmsComposeRequest)=>post('sms',request);
    if(method==='sendMms')return (request:MmsComposeRequest)=>post('mms',request);
    return Reflect.get(bridge,method,receiver);
   },
  }),true);
 }
 const editable=()=>!busy&&!draftLoading;
 const recipientPicker=createSmsRecipientPicker(
  createAddressBookClient(registerPlugin<AddressBookNativePlugin>('AlphaContacts')),
  ()=>inFront()&&editable()&&!owner?.props?.assistantSurface&&composing&&draftThread===null&&!session.state.thread,
  paint,
 );
 const ready=()=>inFront()&&editable()&&session.state.status?.permissions.sms==='granted';
 const normalizeRecipients=(addresses:readonly string[])=>{
  const normalized=addresses.map(normalizePhoneNumber);
  return normalized.every((number):number is string=>number!==null)?[...new Set(normalized)]:[];
 };
 const sameRecipients=(a:readonly string[],b:readonly string[])=>a.length===b.length&&a.every(number=>b.includes(number));
 const draftRecipients=()=>{
  if(draftThread===null)return session.state.thread?[]:inputRecipients();
  const selected=openRow();
  if(selected?.id!==draftThread)return [];
  const addresses=normalizeRecipients(selected.addresses);
  return sameRecipients(inputRecipients(),addresses)?addresses:[];
 };
 function snapshotDraft():SmsDraft|null{
  const operation=operationId&&smsReview?{kind:'sms' as const,id:operationId,recipients:smsReview.recipients,subscriptionId:smsReview.subscriptionId}
   :mmsOperationId&&mmsReview?{kind:'mms' as const,id:mmsOperationId,recipients:mmsReview.recipients,subscriptionId:mmsReview.subscriptionId}:null;
  const ownedBody=draft.draft==='agent'&&!operation?'':body;
  if(!ownedBody&&!attachments.length&&!operation&&(draftThread!==null||!recipients||sent||mmsSent))return null;
  return {recipients,body:ownedBody,origin:draft.draft==='asked'?'asked':'owner',sim,pictures:[...attachments],operation};
 }
 async function persistDraft(){
  if(!shelf)return;
  if(owner?.props?.assistantSurface)throw Error('Message drafts are available in Messages.');
  const opened=retained;
  if(!opened)throw Error('Couldn’t open the saved message draft. Reopen the composer to retry.');
  await opened.save(snapshotDraft());
 }
 function retainDraft(){
  if(!shelf)return;
  const ticket=draftTicket;
  void persistDraft().then(()=>{
   if(ticket===draftTicket&&storageNotice){storageNotice='';paint();}
  },()=>{
   if(ticket===draftTicket){storageNotice='Message draft couldn’t be saved.';paint();}
  });
 }
 function loadDraft(thread:string|null,addresses:readonly string[]=[]){
  if(!shelf||owner?.props?.assistantSurface)return;
  retained=null;storageNotice='';draftLoading=true;
  const ticket=++draftTicket;
  void shelf.open(thread).then(opened=>{
   if(ticket!==draftTicket)return;
   retained=opened;
   const saved=opened.draft;
   if(!saved){if(thread===null&&recipients)retainDraft();return;}
   const actual=normalizeRecipients(saved.recipients.split(',').map(value=>value.trim()).filter(Boolean));
   if(thread!==null&&!sameRecipients(actual,addresses))return;
   if(saved.operation&&!sameRecipients(actual,saved.operation.recipients))throw Error('Saved Messages operation recipients changed');
   recipients=saved.recipients;body=saved.body;sim=saved.sim;attachments=saved.pictures;
   pictureSeq=Math.max(0,...attachments.map(picture=>Number(picture.name.split('.')[0].slice(8))));
   draft=saved.origin==='asked'?askedDraftPlaced(emptyDraft(),body,true):typed(emptyDraft(),body);
   const reviewed=reviewedDraft(saved);
   if(reviewed?.kind==='sms'){operationId=reviewed.id;smsReview=reviewed.review;}
   if(reviewed?.kind==='mms'){mmsOperationId=reviewed.id;mmsReview=reviewed.review;}
   draftRevision++;
  }).catch(()=>{
   if(ticket===draftTicket){retained=null;storageNotice='Saved message draft couldn’t be opened.';}
  }).finally(()=>{
   if(ticket!==draftTicket)return;
   draftLoading=false;changed();void reconcile();void reconcileMms();
  });
 }
 const clearDraft=()=>{
  recipientPicker.close();
  suggesting?.abort();suggesting=null;draft=emptyDraft();body='';draftRevision++;
  operationId='';smsReview=null;resetMms(true);notice='';receipt=null;sent=null;mmsSent=null;
 };
 const chooseThread=(id:string,addresses:readonly string[])=>{
  if(!editable()||!inFront())return;
  recipientPicker.close();
  const normalized=normalizeRecipients(addresses);
  const switching=(shelf?draftThread!==id:!!draftThread&&draftThread!==id)||!sameRecipients(normalizeRecipients(inputRecipients()),normalized);
  if(switching||!normalized.length)clearDraft();
  selectedThread={id,addresses:[...addresses]};draftThread=id;recipients=normalized.join(', ');composing=false;suggestConfirm=false;bubbleSent=null;
  if(normalized.length&&(switching||!retained))loadDraft(id,normalized);
  session.openThread(id);
 };
 let noticeRequested=false,noticeOpening=false,noticeSignal=0;
 const canOpenNotice=(shell:any)=>{
  const state=shell.S();
  return owner===shell&&!shell.props?.assistantSurface&&!document.hidden&&state.screen==='home'
   &&!state.typing&&!state.recording&&!state.draft&&(!state.voice||state.voice==='off')
   &&editable()&&!picking&&!recipientPicker.snapshot()&&!suggestConfirm&&!body&&!attachments.length&&!operationId&&!mmsOperationId
   &&!(draftThread===null&&recipients&&!sent&&!mmsSent);
 };
 async function drainSmsNotice(){
  const shell=owner;
  if(!noticeRequested||noticeOpening||!shell||!canOpenNotice(shell))return;
  noticeRequested=false;noticeOpening=true;
  const signal=noticeSignal,view=shell.S().view,selected=session.state.thread;
  const current=()=>owner===shell&&signal===noticeSignal;
  const canContinue=()=>{
   if(!current()||shell.S().view!==view||session.state.thread!==selected)return false;
   if(canOpenNotice(shell))return true;
   noticeRequested=true;
   return false;
  };
  try{
   const {threadId,token}=await native.smsNoticePending();
   if(typeof token!=='string'||!/^\d+$/.test(token)||typeof threadId!=='string'||!/^thread:[1-9]\d{0,18}$/.test(threadId)||!canContinue())return;
   const acknowledge=()=>{
    // The old draft only gates navigation. The opened thread can now load a draft of its own.
    if(current()&&!shell.props?.assistantSurface&&shell.S().screen==='home'&&inFront()&&openRow()?.id===threadId)
     void native.acknowledgeSmsNotice({token}).catch(()=>{});
   };
   if(inFront()&&selected===threadId){void session.refresh();acknowledge();return;}
   // Look up only the named conversation's participants. Never open another thread as a fallback.
   let cursor:string|undefined;
   for(let page=0;page<3;page++){
    const result=await client.threadPage(cursor);
    if(!canContinue())return;
    const target=result.rows.find(row=>row.id===threadId);
    if(target){
     if(isIncompleteSmsRow(target))return;
     const open=()=>{
      if(!current()||!canOpenNotice(shell)||!inFront())return;
      chooseThread(threadId,target.addresses);
      shell.setState({},acknowledge);
     };
     if(inFront())open();
     else{shell.openView('messages');shell.setState({},open);}
     return;
    }
    if(!result.next)return;
    cursor=result.next;
   }
  }catch{/* A foreground retry can read the native pending tap. */}
  finally{
   noticeOpening=false;
   if(noticeRequested&&signal!==noticeSignal)void drainSmsNotice();
  }
 }
 const wakeSmsNotice=()=>{noticeSignal++;noticeRequested=true;void drainSmsNotice();};
 const closeThread=()=>{if(!busy){selectedThread=null;suggestConfirm=false;session.openThread(null);}};
 const compose=(prefill?:string)=>{
  if(!editable())return;
  recipientPicker.close();
  const switching=draftThread!==null;
  if(switching||(!shelf&&prefill!==undefined&&recipients!==prefill)){clearDraft();recipients=prefill??'';}
  if(shelf&&prefill&&!recipients)recipients=prefill;
  draftThread=null;composing=true;selectedThread=null;suggestConfirm=false;
  if(switching||!retained)loadDraft(null);
  if(session.state.thread)session.openThread(null);else changed();
 };
 const threadRows=()=>session.state.thread?session.state.rows.filter((row):row is SmsMessage=>!isIncompleteSmsRow(row)&&row.threadId===session.state.thread).sort((a,b)=>a.date-b.date):[];
 function matchProviderRow(entry:OutgoingSms,claimed:ReadonlySet<string>){
  return threadRows().find(row=>row.direction==='outgoing'&&row.kind==='sms'&&row.subscriptionId===entry.review.subscriptionId
   &&row.body===entry.review.body&&sameRecipients(normalizeRecipients(row.addresses),entry.review.recipients)
   &&!entry.seen.has(row.id)&&!claimed.has(row.id)
   &&(entry.createdAt===undefined?row.date>=entry.startedAt:row.date===entry.createdAt));
 }
 /** On this image the provider's outgoing SMS date is the native receipt's creation time. */
 function updateOutgoing(){
  if(!active||session.state.status?.permissions.sms!=='granted')return;
  if(!session.state.thread&&composing&&!body){
   const to=normalizeRecipients(inputRecipients());
   const entry=[...outgoing.values()].reverse().find(row=>row.threadId===null&&row.createdAt!==undefined
    &&sameRecipients(to,row.review.recipients));
   const targets=entry?session.state.threads.filter(row=>!isIncompleteSmsRow(row)
    &&sameRecipients(normalizeRecipients(row.addresses),entry.review.recipients)):[];
   const target=targets.length===1?targets[0]:null;
   if(entry&&target&&!isIncompleteSmsRow(target)){
    entry.threadId=target.id;selectedThread={id:target.id,addresses:[...target.addresses]};
    draftThread=target.id;recipients=entry.review.recipients.join(', ');composing=false;loadDraft(target.id,entry.review.recipients);session.openThread(target.id);
   }
  }
  for(const entry of outgoing.values()){
   if(entry.threadId===null||entry.threadId!==session.state.thread||entry.createdAt===undefined)continue;
   const row=matchProviderRow(entry,matchedProviderRows);
   if(row){matchedProviderRows.add(row.id);outgoing.delete(entry.id);}
  }
 }
 const outgoingResult=(result:SmsSendResult,id=result.operationId)=>{
  const entry=outgoing.get(id);
  if(!entry)return;
  if(accepted(result.status))entry.createdAt=result.createdAt;
  else if(result.status!=='unknown'||entry.createdAt===undefined)outgoing.delete(entry.id);
 };
 const showLatest=()=>owner?.setState({},()=>{
  const list=document.querySelector?.<HTMLElement>('[data-alpha-messages-thread]');
  if(list)list.scrollTop=list.scrollHeight;
 });
 /* The newest message when it is inbound: the one a reply would answer. */
 const latestInbound=()=>{const rows=threadRows(),last=rows[rows.length-1];return last&&last.direction==='incoming'?String(last.id):null;};
 /* Opening a thread drops the session's thread list. Keep only the selected addresses. */
 const openRow=()=>selectedThread?.id===session.state.thread?selectedThread:null;
 const openThread=():OpenThread|null=>{const thread=openRow();if(!inFront()||!thread||session.state.status?.permissions.sms!=='granted'||session.state.busy)return null;const rows=threadRows(),one=thread.addresses.length===1?names.get(numberKey(thread.addresses[0]))||null:null;
  return {participant:one,messages:rows.slice(-THREAD_TAIL).map(row=>({direction:row.direction==='incoming'?'in' as const:'out' as const,date:row.date,body:String(row.body).slice(0,1600)})),truncated:rows.length>THREAD_TAIL||!!session.state.next};};
 openThreadReader=openThread;
 openThreadSelection=()=>inFront()&&session.state.status?.permissions.sms==='granted'?openRow()?.id??null:null;
 askedDraftWriter=(text,number)=>{
  const thread=active?openRow():null;
  if(!thread)return 'none-selected';
  if(number!==undefined){
   const key=numberKey(number);
   if(!key||thread.addresses.length!==1||numberKey(thread.addresses[0])!==key)return 'none-selected';
  }
  if(!draftRecipients().length)return 'unavailable';
  if(!ready())return 'unavailable';
  if(attachments.length||operationId||mmsOperationId)return 'occupied';
  const next=askedDraftPlaced(draft,text.trim().slice(0,1600),true);if(next===draft)return 'unavailable';
  suggesting?.abort();suggesting=null;draft=next;body=next.text;draftRevision++;operationId='';smsReview=null;resetMms(false);notice='';receipt=null;bubbleSent=null;retainDraft();paint();return 'drafted';
 };
 draftUndoer=()=>{
  if(!active||!editable()||!draft.undo||operationId||mmsOperationId||!openRow())return false;
  suggesting?.abort();suggesting=null;draft=draftUndone(draft);body=draft.draft==='agent'?'':draft.text;draftRevision++;operationId='';smsReview=null;resetMms(false);notice='';receipt=null;retainDraft();paint();return true;
 };
 draftReader=()=>{const thread=active?openRow():null;if(!thread||draft.draft==='none')return null;
  return {by:draft.draft==='owner'?'owner':draft.draft==='asked'?'alpha':'suggestion',text:draft.text,canUndo:!!draft.undo,threadId:thread.id};};
 function loadNames(){if(namesLoaded||!active||session.state.status?.permissions.contacts!=='granted')return;namesLoaded=true;const token=lifecycle;
  void client.searchContacts('',100).then(cards=>{if(token!==lifecycle)return;for(const card of cards)for(const number of card.phoneNumbers){const key=numberKey(number);if(!key||!card.displayName)continue;if(!names.has(key))names.set(key,card.displayName);people.push({name:card.displayName,number});}paint();}).catch(()=>{namesLoaded=false;});}
 /* Applies thread changes to the draft and asks for a suggestion when one is due. It never sends. */
 function drive(){
  if(!active){draft=readinessLost(draft);return;}
  loadNames();
  const latest=latestInbound(),before=draft;if(!busy&&!operationId&&!mmsOperationId)draft=threadChanged(draft,latest);
  if(before.draft==='agent'&&draft.draft==='none'){suggesting?.abort();suggesting=null;}
  if(!suggester||!suggestOn()||body||attachments.length||!canSuggest(draft,latest,ready()))return;
  // Group and short-code conversations can carry data unrelated to a one-person reply.
  const recipients=draftRecipients();
  if(recipients.length!==1||!/^\+?\d{9,20}$/.test(recipients[0]))return;
  const thread=openThread();if(!thread||!latest)return;
  draft=suggestionRequested(draft,latest,true);const ticket=latest,token=lifecycle,controller=new AbortController();suggesting?.abort();suggesting=controller;
  void suggester(thread,controller.signal).then(text=>text&&text.trim()?text.trim().slice(0,1600):null,()=>null).then(text=>{
   if(token!==lifecycle||controller.signal.aborted)return;if(suggesting===controller)suggesting=null;
   /* A suggestion is offered as faint text in the bar (AC-24); it is not the field's text until accepted. */
   draft=suggestionReplied(draft,ticket,latestInbound(),ready()&&!body&&!attachments.length,text);paint();});
 }
 /* A confirmed review that did not fail clears the composer; nothing is ever sent again from here. */
 const finished=(status:string)=>{const result=status==='cancelled'||status==='denied'?null:status==='failed'?'failed' as const:status==='unknown'?'unknown' as const:'sent' as const;if(!result)return;draft=reviewFinished(draft,result);if(result==='sent'){body='';attachments=[];pictureSeq=0;composing=false;}};
 const accepted=(status:string)=>status==='submitted'||status==='sent'||status==='delivered';
 const drafted=()=>draft.draft==='agent'||draft.draft==='asked';
 const dismissSuggestion=()=>{if(!editable()||!drafted()||operationId||mmsOperationId)return;draft=suggestionDismissed(draft);body='';draftRevision++;operationId='';resetMms(false);notice='';receipt=null;retainDraft();changed();};
 /* Text in the bar is the owner's (AC-10). */
 const ownerTyped=(value:string)=>changeDraft(()=>{body=value;suggesting?.abort();suggesting=null;draft=typed(draft,value);bubbleSent=null;});
 /* Accepting the faint suggestion puts it in the field; nothing is sent (AC-24). */
 const acceptSuggestion=()=>{if(!editable()||draft.draft!=='agent'||body)return;ownerTyped(draft.text);};
 function confirmSms(review:ReviewedSms,result:SmsSendResult,roleHeld:boolean){
  finished(result.status);
  sent={id:result.operationId,review};
  operationId='';smsReview=null;draftRevision++;retainDraft();
  if(outgoing.get(result.operationId)?.createdAt!==undefined&&session.state.thread===null&&roleHeld)composing=true;
 }
 async function reconcile(id=operationId||sent?.id){
  if(!inFront()||!id)return;
  const review=id===operationId?smsReview:id===sent?.id?sent.review:outgoing.get(id)?.review;
  if(!review)return;
  const token=lifecycle,draft=draftRevision;
  try{
   const value=await client.smsSendResult(review,id);
   if(!active||token!==lifecycle)return;
   outgoingResult(value);
   if(draft===draftRevision&&(id===operationId||id===sent?.id)){
    receipt=value;notice=receiptLabel(value.status);
    // A late journal receipt can settle the original draft after the composer times out.
    if(!busy&&id===operationId){
     if(accepted(value.status))confirmSms(review,value,session.state.status?.roles?.sms?.held===true);
     else if(value.status==='cancelled'||value.status==='denied'){operationId='';smsReview=null;draftRevision++;retainDraft();}
    }
   }
   changed();
  }catch{/* No record or unavailable is never evidence of not sent. */}
 }
 /** `from` is the draft bubble (AC-15): the same review and journal, then the bubble turns solid and Alpha notes the send. */
 async function send(sender=client,from?:SentFrom){if(!inFront()||!editable())return;const token=lifecycle,draft=draftRevision;let sentTo='';busy=true;changed();try{
  const status=session.state.status;if(!status){notice='Refresh Messages, then review the text again.';return;}
  /* The shared review normalizes and dedupes numbers and takes the only active SIM; a SIM that is no longer active is refused. */
  const checked=reviewSms({recipients:draftRecipients(),body,subscriptionId:sim?Number(sim):undefined},status,'direct');
  if('problem' in checked){notice=checked.problem==='sim-unknown'&&!status.subscriptions?'Allow SIM':smsProblemLabel(checked.problem,'direct',!!sim,body.length);return;}
  const firstAttempt=!operationId||!smsReview;
  if(firstAttempt){operationId=crypto.randomUUID();smsReview={...checked.review,subscriptionId:checked.review.subscriptionId as number};}
  const id=operationId,review=smsReview!;
  if(shelf){
   try{await persistDraft();storageNotice='';}
   catch{if(firstAttempt&&id===operationId){operationId='';smsReview=null;retainDraft();}if(token===lifecycle)storageNotice='Save the message draft before sending. Try again.';return;}
   if(!inFront()||token!==lifecycle||draft!==draftRevision)return;
  }
  if(firstAttempt&&review.recipients.length===1){
   outgoing.set(id,{id,threadId:session.state.thread,review,startedAt:Date.now(),seen:new Set(threadRows().map(row=>row.id))});
   paint();showLatest();
  }
  const result=await sender.sendSms(review,id);if(!active||token!==lifecycle||draft!==draftRevision)return;receipt=result;notice=receiptLabel(result.status);
  outgoingResult(result,id);
  /* Cancelled and denied prove nothing was sent: the next Send opens a new review. */
  if(result.status==='cancelled'||result.status==='denied'){operationId='';smsReview=null;draftRevision++;retainDraft();}
  else if(accepted(result.status)){confirmSms(review,result,status.roles?.sms?.held===true);if(from){bubbleSent={by:from.by,text:from.text};sentTo=from.title;}}
  else finished(result.status);
  changed();await session.refresh();
  if(status.roles?.sms?.held===false)outgoing.delete(id);
 }catch(error){if(active&&token===lifecycle&&draft===draftRevision){const code=(error as {code?:string})?.code,message=error instanceof Error?error.message:'';
  if(operationId)outgoing.delete(operationId);
  if(operationId&&code&&SMS_NOT_SENT.has(code)&&message){operationId='';smsReview=null;notice=message;retainDraft();}else if(operationId&&code==='expired'&&message)notice=message;
  else notice=operationId?'May have sent':message||'Couldn’t open';}}finally{if(token===lifecycle){busy=false;bubbleSent=null;changed();if(operationId)void reconcile(operationId);}}
  if(sentTo)noteSent(sentTo);}
 function confirmMms(id:string,review:MmsReview,status:'submitted'|'sent'){
  finished(status);
  mmsSent={id,review};resetMms(true);draftRevision++;retainDraft();
 }
 async function reconcileMms(id=mmsOperationId||mmsSent?.id){
  if(!inFront()||!id)return;
  const review=id===mmsOperationId?mmsReview:id===mmsSent?.id?mmsSent.review:null;
  if(!review)return;
  const token=lifecycle,draft=draftRevision;
  try{
   const value=await client.mmsSendResult(review,id);
   if(!active||token!==lifecycle||draft!==draftRevision||(id!==mmsOperationId&&id!==mmsSent?.id))return;
   notice=mmsReceiptLabel(value.status);
   if(!busy&&id===mmsOperationId){
    if(value.status==='submitted'||value.status==='sent'){confirmMms(id,review,value.status);void session.refresh();}
    else if(value.status==='cancelled'||value.status==='denied'){resetMms(false);draftRevision++;retainDraft();}
   }
   changed();
  }catch{/* No record or unavailable is never evidence of not sent. */}
 }
 /** One MMS to every recipient, with the text and the picked pictures. A repeated operation ID never sends twice. */
 async function sendMms(sender=client,from?:SentFrom){if(!inFront()||!editable())return;const token=lifecycle,draft=draftRevision;let dispatched=false,sentTo='';busy=true;changed();try{
  const status=session.state.status;if(!status)throw Error('Refresh Messages, then review the MMS again.');
  const checked=reviewMms({recipients:draftRecipients(),body,attachments,subscriptionId:sim?Number(sim):undefined},status);
  if('problem' in checked)throw Error(mmsProblemLabel(checked.problem));
  const firstAttempt=!mmsOperationId;
  if(firstAttempt){mmsOperationId=crypto.randomUUID();mmsReview=checked.review;}
  const id=mmsOperationId,review=mmsReview??checked.review;
  if(shelf){
   try{await persistDraft();storageNotice='';}
   catch{if(firstAttempt&&id===mmsOperationId){resetMms(false);retainDraft();}if(token===lifecycle)storageNotice='Save the message draft before sending. Try again.';return;}
   if(!inFront()||token!==lifecycle||draft!==draftRevision)return;
  }
  dispatched=true;
  const result=await sender.sendMms(review,id);
  if(!active||token!==lifecycle||draft!==draftRevision)return;
  receipt=null;notice=mmsReceiptLabel(result.status);
  if(result.status==='cancelled'||result.status==='denied'){resetMms(false);draftRevision++;retainDraft();}
  else if(result.status==='submitted'||result.status==='sent'){confirmMms(id,review,result.status);if(from){bubbleSent={by:from.by,text:from.text};sentTo=from.title;}}
  else finished(result.status);
  await session.refresh();
 }catch(error){if(active&&token===lifecycle&&draft===draftRevision)notice=dispatched?'May have sent':error instanceof Error?error.message:'Couldn’t open';}
 finally{if(token===lifecycle){busy=false;bubbleSent=null;changed();if(mmsOperationId&&dispatched)void reconcileMms(mmsOperationId);}}
  if(sentTo)noteSent(sentTo);}
 /** Picking pictures only changes the draft; nothing is read beyond the files the owner chose. */
 function attach(){if(!active||!editable())return;if(attachments.length>=MMS_MAX_ATTACHMENTS){notice='Max 5 pictures';changed();return;}const token=lifecycle,draft=draftRevision,input=document.createElement('input');input.type='file';input.accept=Object.keys(MMS_PICTURES).join(',');input.multiple=true;
  /* A result that arrives while the page is still hidden waits for it to show again; pagehide always ends the pick. */
  const done=(event?:Event)=>{if(document.hidden&&event?.type!=='pagehide')return;window.removeEventListener('pagehide',done);if(!picking)return;picking=false;sync();};input.oncancel=()=>done();window.addEventListener('pagehide',done);
  input.onchange=async()=>{done();const files=[...(input.files||[])];input.value='';try{const picked:Omit<MmsAttachmentDraft,'name'>[]=[];for(const file of files){if(!MMS_PICTURES[file.type])throw Error('Only JPEG, PNG and GIF pictures can be sent.');if(!file.size||file.size>1024*1024)throw Error('Each picture must be smaller than 1 MB.');picked.push({contentType:file.type,bytes:new Uint8Array(await file.arrayBuffer())});}
   if(!active||token!==lifecycle||draft!==draftRevision||busy)return;if(attachments.length+picked.length>MMS_MAX_ATTACHMENTS)throw Error('Max 5 pictures');
   for(const item of picked)attachments.push({...item,name:`picture-${++pictureSeq}.${MMS_PICTURES[item.contentType]}`});draftRevision++;operationId='';resetMms(false);receipt=null;notice='';retainDraft();changed();
  }catch(error){if(active&&token===lifecycle){notice=error instanceof Error?error.message:'Unreadable pictures';changed();}}};
  picking=true;input.click();}
 async function handoff(){if(!inFront()||!editable()||operationId||mmsOperationId||attachments.length)return;const token=lifecycle,draft=draftRevision;busy=true;changed();try{
  /* The messaging app chooses the SIM, so a handoff never carries one. */
  const status=session.state.status;if(!status){notice='Refresh needed';return;}
  const checked=reviewSms({recipients:draftRecipients(),body},status,'handoff');if('problem' in checked){notice=smsProblemLabel(checked.problem,'handoff',false,body.length);return;}
  const result=await client.composeSms(checked.review);if(active&&token===lifecycle&&draft===draftRevision)notice=result.message;}catch{if(active&&token===lifecycle)notice='Couldn’t open';}finally{if(token===lifecycle){busy=false;changed();}}}
 const changeDraft=(mutate:()=>void)=>{
  if(!editable())return;
  mutate();draftRevision++;operationId='';smsReview=null;resetMms(false);notice='';receipt=null;retainDraft();changed();
 };
 const edit=(setter:(value:string)=>void)=>(event:Event)=>changeDraft(()=>setter((event.target as HTMLInputElement).value));
 async function permission(access:'sms'|'sendSms'|'phoneState'){
  if(!inFront()||busy)return;const token=lifecycle;busy=true;changed();
  try{await session.request(access);}
  catch{if(token===lifecycle)notice='SMS access could not be requested.';}
  finally{if(token===lifecycle){busy=false;changed();}}
 }
 /* Back returns to the list and keeps the draft bound to its recipients. */
 const closeNew=()=>{
  if(busy)return;
  if(!recipientPicker.close())composing=false;
  changed();
 };
 const back=views.messages.back;views.messages.back=(st:Bag,api:Bag)=>{if(session.state.thread){if(suggestConfirm){suggestConfirm=false;paint();}else closeThread();return true;}if(composing){closeNew();return true;}return back?back(st,api):false;};
 views.messages.reply=()=>null;views.messages.suggestions=()=>[];
 /* AC-15: a quiet line in the chat; it is never written to the SMS provider or a thread (AC-31). */
 const noteSent=(title:string)=>api?.note?.('Sent to '+title);
 /* People to address a new message to: contacts matching what is typed in To, by name or number. */
 const picks=()=>{const typedTo=inputRecipients(),last=recipients.trim().endsWith(',')?'':(typedTo[typedTo.length-1]||''),query=last.toLowerCase(),digits=last.replace(/\D/g,''),chosen=new Set(typedTo.map(numberKey));
  return people.filter(person=>!chosen.has(numberKey(person.number))&&(!query||person.name.toLowerCase().includes(query)||(digits.length>=3&&person.number.replace(/\D/g,'').includes(digits)))).slice(0,30)
   .map(person=>({name:person.name,number:displayNumber(person.number),ini:initials(person.name),label:`${person.name}, ${displayNumber(person.number)}`,pick:()=>{if(!inFront()||!composing||session.state.thread)return;const kept=recipients.trim().endsWith(',')?typedTo:typedTo.slice(0,-1);changeDraft(()=>{recipients=[...kept,person.number].join(', ');});}}));};
 type SendTap=MouseEvent&{nativeEvent?:MouseEvent};
 /* The Send controls that show the visible draft: the composer's, the bar's (AC-01), the draft bubble's (AC-15) and the strip's. */
 const SEND_CONTROLS=['data-alpha-messages-send','data-alpha-bar-send','data-alpha-draft-send'];
 const sendControl=(target:EventTarget|null)=>target instanceof HTMLButtonElement&&(SEND_CONTROLS.some(name=>target.hasAttribute(name))||target.getAttribute('data-alpha-strip-action')==='send');
 /* One trusted Send tap approves the current visible draft, including its recipient set and SIM.
  * One Send: several recipients or pictures go as one reviewed MMS, otherwise a reviewed SMS. */
 const submit=(event?:SendTap,from?:SentFrom)=>{
  if(!event||!inFront()||!editable()||recipientPicker.snapshot()||owner?.props?.assistantSurface||!(event.nativeEvent??event).isTrusted||!sendControl(event.currentTarget))return;
  const sender=composerClient(lifecycle);
  if(attachments.length||draftRecipients().length>1)void sendMms(sender,from);else void send(sender,from);
 };
 const firstOf=(title:string)=>/^[+(\d]/.test(title)||title.includes(',')?title:title.split(/\s+/)[0];
 /** The open conversation, or a new message's recipients; null on the list. */
 const subject=():{id:string;title:string|null;first:string|null}|null=>{
  const thread=openRow();
  if(session.state.thread&&thread){const title=threadTitle(thread.addresses,names);return {id:thread.id,title,first:firstOf(title)};}
  if(!session.state.thread&&composing){const typedTo=normalizeRecipients(inputRecipients());if(!typedTo.length)return {id:'new',title:null,first:null};const title=threadTitle(typedTo,names);return {id:'new',title,first:firstOf(title)};}
  return null;
 };
 const sendable=()=>{const status=session.state.status,sims=status?.subscriptions||[],sendingTo=draftRecipients();
  return editable()&&!recipientPicker.snapshot()&&!!status&&status.sendMode==='direct'&&sims.length>0&&(sendingTo.length<=1||!!status.mmsSend)&&(!!body.trim()||attachments.length>0)&&sendingTo.length>0;};
 /* A draft waits while the slot holds Alpha's draft or the owner's own text. */
 const waiting=()=>(draft.draft==='asked'||draft.draft==='owner')&&!!body.trim();
 const bubbleSend=(event?:SendTap)=>{const who=subject();if(!waiting()||!who||!editable())return;submit(event,{by:draft.draft==='asked'?'alpha':'owner',text:body,title:who.title||''});};
 /** AC-14/15/16: the draft bubble in the stage while the chat is open; null otherwise. */
 function bubble(viewApi:Bag|undefined){
  const open=viewApi?.S?.chat==='sheet'||viewApi?.S?.chat==='full',alpha=viewApi?.name||'Alpha';
  if(!open)return null;
  if(bubbleSent)return {by:bubbleSent.by,alpha:bubbleSent.by==='alpha',sent:true,label:'Sent',aria:'Sent: '+bubbleSent.text,text:bubbleSent.text,canUndo:false,canAct:false};
  if(!waiting()||!subject())return null;
  const by=draft.draft==='asked'?'alpha' as const:'owner' as const;
  return {by,alpha:by==='alpha',sent:undefined,label:by==='alpha'?`${alpha}'s draft · not sent`:'Your draft',aria:by==='alpha'?`${alpha}'s draft, not sent`:'Your draft, not sent',text:body,canUndo:!!draft.undo,canAct:true,
   edit:()=>{if(!editable())return;draft=draftAdopted(draft);retainDraft();paint();api?.toPerson?.();},send:bubbleSend,undo:()=>{undoSmsDraft();}};
 }
 const clock=(at:number)=>{const date=new Date(at);return date.toDateString()===new Date().toDateString()?'at '+formatTime(date):'on '+formatMonthDay(date);};
 /** AC-25: facts from this phone's own rows; null when nothing is known. */
 function briefing(who:{first:string|null}|null){
  if(who){const rows=threadRows(),last=rows[rows.length-1];if(!last||!who.first)return null;
   return last.direction==='incoming'?`${who.first} texted ${clock(last.date)} and hasn't had a reply.`:`You last texted ${who.first} ${clock(last.date)}.`;}
  const rows=session.state.threads.filter(row=>!isIncompleteSmsRow(row)) as any[];if(!rows.length)return null;
  const unread=rows.filter(row=>row.unread===true);
  return !unread.length?'No unread conversations.':unread.length===1?`${threadTitle(unread[0].addresses,names)} sent an unread text.`:`${unread.length} conversations have unread texts.`;
 }
 /** AC-01: the one bottom bar. In a conversation it addresses the person; on the list it filters (AC-22). */
 views.messages.bar=(_st:Bag,_viewApi:Bag):CommsBarSpec=>{
  const who=subject();
  if(who){
   const name=who.title,first=who.first,ini=name?initials(name):null,waits=waiting();
   const suggestion=draft.draft==='agent'&&!body&&suggestOn()?draft.text:null;
   return {target:{kind:'thread',app:'Messages',name,first,initials:ini},
    closed:{kind:'person',placeholder:first?'Text '+first:'Message',value:body,onText:ownerTyped,submit:(event?:SendTap)=>submit(event),canSubmit:sendable(),maxLength:1600,suggestion,acceptSuggestion:suggestion?acceptSuggestion:null},
    left:{icon:'avatar',label:first?'Back to texting '+first:'Back to the message',initials:ini,run:null},
    context:name?name+' · Messages':'Messages',contextKey:'messages:thread:'+who.id,
    strip:{title:name||'Messages',subtitle:waits?'Messages · draft waiting':'Messages',initials:ini,live:false,actions:waits?[{id:'send',label:'Send draft',run:bubbleSend}]:[]},
    end:null,incoming:null,emergency:false,fit:()=>draftStageFit(),briefing:briefing(who)};
  }
  return {target:{kind:'list',app:'Messages',name:null,first:null,initials:null},
   closed:{kind:'filter',placeholder:'Search or ask',value:listFilter?.by==='owner'?listFilter.query:'',onText:(text:string)=>{listFilter=text.trim()?{query:text,label:text.trim(),by:'owner'}:null;paint();},submit:null,canSubmit:false,maxLength:null,suggestion:null,acceptSuggestion:null},
   left:{icon:'search',label:'Back to search',initials:null,run:null},
   context:'Messages',contextKey:'messages:list:',strip:{title:'Messages',subtitle:'',initials:null,live:false,actions:[]},
   end:null,incoming:null,emergency:false,fit:null,briefing:briefing(null)};
 };
 /* AC-22: the list filters on this phone over each conversation's title and snippet; no request is made. */
 const listMatches=(title:string,snippet:string)=>{const query=listFilter?.query.trim().toLowerCase();return !query||(title+' '+snippet).toLowerCase().includes(query);};
 const listFilterHandler={apply:(filter:CommsListFilter)=>{listFilter=filter.query.trim()?{...filter}:null;paint();return true;},clear:()=>{listFilter=null;paint();},current:()=>listFilter};
 /** Values of the designed Messages view: a thread list, one thread with its composer, or a new message. */
 function designed(opens:readonly {open:()=>void}[],viewApi:Bag){
  const state=session.state,now=Date.now(),status=state.status,access=!!status&&status.permissions.sms!=='granted',thread=openRow();
  const sims=status?.subscriptions||[],sole=thread?.addresses.length===1?normalizePhoneNumber(thread.addresses[0]):null,title=thread?threadTitle(thread.addresses,names):'';
  const sendingTo=draftRecipients(),showThread=!access&&!!state.thread,showNew=!state.thread&&composing,showComposer=showThread||showNew;
  const picker=showNew?recipientPicker.snapshot():null;
  const addRecipient=(number:string)=>{
   const existing=inputRecipients();
   if(existing.some(value=>numberKey(value)===numberKey(number)))return;
   const next=[...existing,number].join(', ');
   if(next.length>230)return;
   recipientPicker.close();
   changeDraft(()=>{recipients=next;});
  };
  const direct=!!status&&status.sendMode==='direct'&&sims.length>0&&(sendingTo.length<=1||status.mmsSend);
  const hasBody=!!body.trim(),hasDraft=hasBody||attachments.length>0;
  const claimed=new Set(matchedProviderRows);
  const local=[...outgoing.values()].filter(entry=>{
   if(!active||entry.threadId!==state.thread)return false;
   if(entry.threadId===null)return showNew&&sameRecipients(normalizeRecipients(sendingTo),entry.review.recipients);
   if(status?.permissions.sms!=='granted')return false;
   const row=matchProviderRow(entry,claimed);
   if(row){claimed.add(row.id);return false;}
   return true;
  }).map(entry=>({id:entry.id,text:entry.review.body,hasText:true,side:'flex-end',bg:'var(--fg)',fg:'var(--bg)',
   failed:false,picture:false,opacity:entry.createdAt===undefined?0.68:1,date:entry.createdAt??entry.startedAt}));
  const listed=state.threads.map((row,index)=>{const incomplete=isIncompleteSmsRow(row),full=row as any,name=incomplete?'Conversation content unavailable':threadTitle(full.addresses,names),unread=!incomplete&&full.unread===true,when=shortWhen(row.date,now);
   return {id:row.id,open:()=>opens[index]?.open(),title:name,ini:initials(name),when,snippet:incomplete?'Use the system messaging app to view this conversation.':String(full.snippet||''),unread,weight:unread?700:600,color:unread?'var(--fg)':'var(--mut)',label:`${name}, ${when}${unread?', unread':''}`,stageLast:undefined as true|undefined};})
   .filter(row=>listMatches(row.title,row.snippet));
  if(listed[0])listed[0].stageLast=true;
  const bubbles=[...state.rows.filter(row=>row.threadId===state.thread).map(row=>{
    if(isIncompleteSmsRow(row))return {id:row.id,text:'Use the system messaging app to view this message.',hasText:true,side:'flex-start',bg:'var(--s2)',fg:'var(--mut)',failed:false,picture:false,opacity:1,date:row.date,inbound:false};
    const mine=row.direction!=='incoming';return {id:row.id,text:String(row.body||''),hasText:!!row.body,side:mine?'flex-end':'flex-start',bg:mine?'var(--fg)':'var(--s2)',fg:mine?'var(--bg)':'var(--fg)',
    failed:mine&&row.status==='failed',picture:row.attachments>0,pictureLabel:row.attachments>1?`${row.attachments} pictures`:'Picture',opacity:1,date:row.date,inbound:!mine};}),
    ...(showThread?local.map(entry=>({...entry,inbound:false})):[])].sort((a,b)=>a.date-b.date);
  /* The stage keeps the newest inbound message above the sheet, never the owner's own (AC-02). */
  let newestIn=-1;bubbles.forEach((row,index)=>{if(row.inbound)newestIn=index;});
  return {
   needsAccess:access&&!showNew,showList:!access&&!state.thread&&!composing,showThread,showNew,showComposer:showComposer&&!picker,
   showNewButton:!state.thread&&!composing,readFailed:!status&&!state.busy,showEmpty:!!status&&!state.busy&&state.threads.length===0,
   compose:()=>compose(),closeNew,
   contactsOpen:!!picker,
   contactsLabel:picker?'Close contact picker':'Choose contacts',
   toggleContacts:()=>{if(recipientPicker.close())paint();else recipientPicker.open();},
   contacts:picker&&{
    ...picker,onQuery:(event:Event)=>recipientPicker.setQuery((event.target as HTMLInputElement).value),
    onKey:(event:KeyboardEvent)=>{if(event.key==='Enter'){event.preventDefault();void recipientPicker.search();}},
    search:()=>void recipientPicker.search(),allow:()=>void recipientPicker.allow(),loadMore:()=>void recipientPicker.more(),
    choices:picker.rows.filter(row=>!sendingTo.some(value=>numberKey(value)===numberKey(row.number))).map(row=>({
     key:row.key,name:row.name,number:displayNumber(row.number),ini:initials(row.name),
     label:`${row.name}, ${displayNumber(row.number)}`,
     pick:()=>{const number=recipientPicker.selected(row);if(number)addRecipient(number);},
    })),
   },
   needsSendAccess:!!status&&status.permissions.sendSms!=='granted',needsSimAccess:!!status&&status.permissions.phoneState!=='granted',
   canHandoff:!!status&&!direct&&!attachments.length&&!operationId&&!mmsOperationId&&hasBody&&sendingTo.length>0,
   threads:listed,noMatches:!!listFilter&&!listed.length&&state.threads.length>0,
   filterChip:listFilter?.by==='alpha'?{label:listFilter.label,clearLabel:'Clear filter '+listFilter.label,clear:listFilterHandler.clear}:null,
   title,ini:initials(title),canCall:!!sole,call:()=>{if(sole)api?.open?.('phone',{prefill:sole});},callLabel:`Call ${title}`,
   newBubbles:showNew?local:[],bubbles:bubbles.map(({inbound:_inbound,...row},index)=>({...row,stageLast:index===newestIn?true as const:undefined})),
   draftBubble:bubble(viewApi),picks:composing&&!picker&&!state.thread&&!local.length?picks():[],
   canSuggest:!!suggester,suggesting:suggestOn(),suggestLabel:suggestOn()?'Suggested replies on':'Suggested replies off',suggestBg:suggestOn()?'var(--s2)':'transparent',suggestFill:suggestOn()?'var(--acct)':'var(--mut)',
   suggestConfirm,enableSuggest:()=>{if(!suggestConfirm||!inFront()||!openRow())return;suggestConfirm=false;setSuggest(true);changed();},
   cancelSuggest:()=>{suggestConfirm=false;paint();},
   toggleSuggest:()=>{
    if(!inFront()||!openRow())return;
    if(!suggestOn()){suggestConfirm=true;paint();return;}
    setSuggest(false);suggesting?.abort();suggesting=null;draft=readinessLost(draft);
    if(draft.draft==='agent'&&!operationId&&!mmsOperationId)dismissSuggestion();
    changed();
   },
   cannotSend:!editable()||!direct||!hasDraft||!sendingTo.length,submit,
   pickSim:sims.length>1,sims:sims.map(row=>{const on=String(row.id)===sim;return {label:row.displayName||`SIM ${row.slot+1}`,on,bg:on?'var(--fg)':'var(--s2)',fg:on?'var(--bg)':'var(--fg)',
    pick:()=>{if(!editable())return;receipt=null;notice='';sim=String(row.id);draftRevision++;operationId='';resetMms(false);retainDraft();changed();}};}),
   pictures:attachments.map((item,index)=>({label:item.name,remove:()=>{if(!editable())return;attachments.splice(index,1);draftRevision++;operationId='';resetMms(false);receipt=null;notice='';retainDraft();changed();}})),hasPictures:attachments.length>0,
   nativeNotice:storageNotice||(quietNotices.has(notice)?'':notice),hasNotice:!!storageNotice||!!notice&&!quietNotices.has(notice),sendFailed:failureNotices.has(notice)};
 }
 const simLabel=(id:number)=>{const row=session.state.status?.subscriptions?.find(value=>value.id===id);return row?`SIM ${row.slot+1}`:'SIM';};
 views.messages.render=(st:Bag,viewApi:Bag)=>{api=viewApi;setListFilterHandler('messages',listFilterHandler);
 /* A number handed over from Contacts fills the recipients once. */
 if(typeof st?.prefill==='string'&&st.prefill){const value=st.prefill.slice(0,230);queueMicrotask(()=>{if(inFront()&&!busy){viewApi.set?.({prefill:null});compose(value);}});}
 /* Home's Messages card names the one unread thread; it opens once that thread is listed. */
 if(typeof st?.openThread==='string'&&st.openThread){
  const wanted=st.openThread,row=session.state.threads.find(row=>row.id===wanted);
  if(row&&!isIncompleteSmsRow(row))queueMicrotask(()=>{if(inFront()&&!busy&&!session.state.thread){viewApi.set?.({openThread:null});chooseThread(wanted,row.addresses);}});
  else if(!session.state.busy&&session.state.status?.permissions.sms==='granted')queueMicrotask(()=>viewApi.set?.({openThread:null}));
 }
 /* An incomplete provider row has no content or recipients to present. Listing or
  * selecting one must not imply that its message was shown or prefill a reply. */
 const nativeRows=session.state.rows.map(row=>isIncompleteSmsRow(row)
  ? {id:row.id,address:'Content unavailable',direction:'',sim:'',when:formatDateTime(new Date(row.date)),body:''}
  : {...row,address:row.addresses.join(', '),direction:`${row.direction} · ${row.kind.toUpperCase()} · ${row.status}${row.attachments?' · '+row.attachments+' attachments':''}`,sim:typeof row.subscriptionId==='number'?simLabel(row.subscriptionId):'',when:formatDateTime(new Date(row.date))});
 const nativeThreads=session.state.threads.map(row=>isIncompleteSmsRow(row)
  ? {id:row.id,label:'Conversation content unavailable',snippet:'Use the system messaging app to view this conversation.',open:()=>{notice='Content unavailable. Use the system messaging app to view this conversation.';changed();}}
  : {...row,label:row.addresses.join(', ')||'Conversation',open:()=>chooseThread(row.id,row.addresses)});
 return {nativeManaged:true,nativePrototype:false,nativeStatus:session.state.message,nativeRows,nativeReceipts:session.state.receipts.map(row=>({id:row.operationId,label:`${formatDateTime(new Date(row.createdAt))} · Subscription ${row.subscriptionId} · ${receiptLabel(row.status)}`})),nativeThreads,nativeInThread:!!session.state.thread,nativeBack:closeThread,nativeMore:!!session.state.next,nativeBusy:!editable()||session.state.busy,nativeRefresh:()=>{void session.refresh();void reconcile();void reconcileMms();},nativeLoadMore:()=>void session.refresh(true),nativeRead:()=>void permission('sms'),nativeSendAccess:()=>void permission('sendSms'),nativeSimAccess:()=>void permission('phoneState'),nativeSims:(session.state.status?.subscriptions||[]).map(row=>({...row,label:`SIM ${row.slot+1}: ${row.displayName}`,pick:()=>{if(!editable())return;receipt=null;notice='';sim=String(row.id);draftRevision++;operationId='';resetMms(false);retainDraft();changed();}})),nativeSim:sim?`Selected subscription ${sim}`:session.state.status?.permissions.phoneState!=='granted'?'Grant SIM access to select a SIM.':session.state.status?.subscriptions?.length===0?'No active SIM is available.':'Select a SIM below',nativeRecipients:recipients,nativeBody:body,nativeOnRecipients:(event:Event)=>{if(draftThread===null&&!session.state.thread)edit(value=>recipients=value)(event);},nativeOnBody:(event:Event)=>ownerTyped((event.target as HTMLTextAreaElement).value),nativeSend:()=>void send(),nativeSendMms:()=>void sendMms(),nativeAttach:()=>attach(),nativeMmsAvailable:!!session.state.status?.mmsSend,nativeAttachments:attachments.map((item,index)=>({label:`${item.name} · ${Math.max(1,Math.round(item.bytes.length/1024))} KB`,remove:()=>{if(!editable())return;attachments.splice(index,1);draftRevision++;operationId='';resetMms(false);receipt=null;notice='';retainDraft();changed();}})),nativeHandoff:()=>void handoff(),nativeClear:()=>{if(!editable())return;clearDraft();if(draftThread===null)recipients='';retainDraft();changed();},
  ...designed(nativeThreads,viewApi)};};
 if(shelf)p.flushMessagesForAppUpdate=async function(current:()=>boolean){
  if(owner!==this||!current()||busy||picking||draftLoading)throw Error('Finish the current Messages activity before updating');
  const revision=draftRevision;
  await shelf.flush();
  if(owner!==this||!current()||busy||picking||draftLoading||revision!==draftRevision)throw Error('Messages draft changed');
 };
 p.componentDidMount=function(){
  mount?.call(this);owner=this;lifecycle++;
  this.smsSelection=()=>{
   if(owner!==this||!inFront())return;
   const subscriptions=session.state.status?.subscriptions??[];
   const soleSubscription=subscriptions.length===1?subscriptions[0]:undefined;
   const selected=sim?subscriptions.find(row=>String(row.id)===sim):soleSubscription;
   if(selected)return {kind:'sms-subscription',id:String(selected.id),revision:smsSubscriptionRevision(selected)};
  };
  this.smsNoticeWake=()=>{if(owner===this)wakeSmsNotice();};
  this.smsReturn=watchReturnToApp(()=>{void session.refresh();this.smsNoticeWake();});
  this.smsHide=()=>{if(!document.hidden)picking=false;sync();};
  document.addEventListener('visibilitychange',this.smsHide);
  window.addEventListener(SMS_NOTICE_OPEN,this.smsNoticeWake);
  sync();wakeSmsNotice();
 };
 p.componentDidUpdate=function(...args:any[]){update?.apply(this,args);sync();void drainSmsNotice();};
 p.componentWillUnmount=function(){
  this.smsSelection=undefined;this.smsReturn?.();
  document.removeEventListener('visibilitychange',this.smsHide);
  window.removeEventListener(SMS_NOTICE_OPEN,this.smsNoticeWake);
  if(owner===this){owner=null;active=false;busy=false;picking=false;lifecycle++;composerAbort.abort();noticeSignal++;noticeRequested=false;session.setActive(false);draftTicket++;draftLoading=false;retained=null;storageNotice='';clearDraft();recipients='';sim='';draftThread=null;listFilter=null;bubbleSent=null;composing=false;suggestConfirm=false;api=null;setListFilterHandler('messages',null);names.clear();people.length=0;selectedThread=null;namesLoaded=false;outgoing.clear();matchedProviderRows.clear();}
  unmount?.call(this);
 };
}
