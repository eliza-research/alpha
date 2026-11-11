import {isIncompleteSmsRow,normalizePhoneNumber} from '../../../../.eliza/client-features/packages/contracts/src/native-telephony.ts';
import {registerPlugin} from '../platform-plugins';
import {aospImage} from '../runtime/aosp-image';
import {createSmsSession,mmsProblemLabel,mmsReceiptLabel,receiptLabel} from '../runtime/image-sms';
import {smsSubscriptionRevision} from '../runtime/sms-subscription-revision';
import {createAospTelephony,registerTelephonyProfile,MMS_MAX_ATTACHMENTS,reviewMms,reviewSms,type AlphaTelephonyPlugin,type MmsAttachmentDraft,type MmsReview,type SmsReview,type SmsReviewProblem,type SmsSendResult} from '../runtime/aosp-telephony';
import {watchReturnToApp} from './native-adapter';
import {formatDateTime} from './locale-time';
import {displayNumber,initials,numberKey,shortWhen,threadTitle} from './telephony-presenters';
import {askedDraftPlaced,canSuggest,emptyDraft,readinessLost,reviewFinished,suggestionDismissed,suggestionReplied,suggestionRequested,threadChanged,typed,type DraftState} from '../runtime/message-draft';
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
/** What became of a draft Alpha was asked to put in the open conversation's text field. */
export type AskedDraft='drafted'|'none-selected'|'occupied'|'unavailable';
let askedDraftWriter:((text:string,number?:string)=>AskedDraft)|null=null;
/**
 * Puts a draft the owner asked Alpha for into the open conversation's text field; with `number`, only
 * when that conversation is with exactly that number. It never sends: Send stays the owner's tap.
 */
export const placeAskedSmsDraft=(text:string,number?:string):AskedDraft=>askedDraftWriter?askedDraftWriter(text,number):'none-selected';
const THREAD_TAIL=20;
type Bag=Record<string,any>;
const MMS_PICTURES:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/gif':'gif'};
/* Native rejects with these codes before it journals or sends anything, so its message is the
 * reason and the next Send opens a new review. */
const SMS_NOT_SENT=new Set(['too-long','invalid','busy','unavailable']);
/* Owner text for the shared review's refusals; a handoff allows more people and a longer text. */
function smsProblemLabel(problem:SmsReviewProblem,mode:'direct'|'handoff',chosen:boolean,length=0){
 return {'no-recipient':'Add a number','invalid-recipient':'Invalid number','too-many-recipients':mode==='direct'?'Max 5':'Max 10','empty-body':'Enter a message.','body-too-long':`${length.toLocaleString('en-US')}/${mode==='direct'?'1,600':'5,000'}`,'invalid-body':'Unsupported characters','sim-unknown':chosen?'SIM inactive':'No SIM','sim-required':'Pick a SIM','sim-not-selectable':'Pick SIM in Messages'}[problem];
}
export function installSmsAdapter(Component:any,views:Bag){
 if(!aospImage)return;
 const client=createAospTelephony(registerPlugin<AlphaTelephonyPlugin>('AlphaTelephony'),true),p=Component.prototype,mount=p.componentDidMount,update=p.componentDidUpdate,unmount=p.componentWillUnmount;
 let owner:any,recipients='',body='',sim='',operationId='',busy=false,notice='',active=false,lifecycle=0,draftRevision=0,picking=false;
 let receipt:SmsSendResult|null=null,selectedThread:{id:string;addresses:string[]}|null=null;
 /* Composer draft and suggested reply (MessageThreads.qnt); contact names for the visit only. */
 let draft:DraftState=emptyDraft(),draftThread:string|null=null,composing=false,suggestConfirm=false,suggesting:AbortController|null=null,namesLoaded=false,api:Bag|null=null;
 const names=new Map<string,string>(),people:{name:string;number:string}[]=[];
 /* The reviewed text an operation ID was assigned for: the native send and its read-back hash exactly this. */
 let smsReview:(SmsReview&{subscriptionId:number})|null=null;
 /* The last text sent this visit: its composer is clear, and its result is still read back for exactly what was reviewed. */
 let sent:{id:string;review:SmsReview&{subscriptionId:number}}|null=null;
 /* A reviewed MMS (group message or pictures) keeps its own operation ID and the exact reviewed
  * content, so a result is read back only for what the owner reviewed. */
 let attachments:MmsAttachmentDraft[]=[],pictureSeq=0,mmsOperationId='',mmsReview:MmsReview|null=null,mmsSent:{id:string;review:MmsReview}|null=null;
 const paint=()=>owner?.setState({smsNativeRevision:Date.now()});
 const changed=()=>{drive();paint();};
 /* The verified image's reviewed client is the shared Messages and Phone profile while this shell
  * is installed; off the image this adapter returns above, so nothing is registered. */
 registerTelephonyProfile(client);
 const session=createSmsSession(client,true,changed,id=>void reconcile(id),id=>void reconcileMms(id));
 /* Android's picture chooser covers the WebView and reports it hidden; the draft stays while it is open. */
 const sync=()=>{const next=!!owner&&owner.S().view==='messages'&&(!document.hidden||picking);if(next===active)return;active=next;lifecycle++;session.setActive(next);if(!next){busy=false;suggestConfirm=false;draftRevision++;
  // Provider rows and observation are cleared by the inactive session. Keep the
  // owner's unfinished draft in memory across navigation/backgrounding. Preserve
  // its operation identity so returning cannot replay an uncertain send.
  // Contact names, a suggestion in flight and an untouched automatic suggestion are for the visit only.
  suggesting?.abort();suggesting=null;if(draft.draft==='agent'&&!operationId&&!mmsOperationId){body='';draft=emptyDraft();}else draft=readinessLost(draft);names.clear();people.length=0;selectedThread=null;namesLoaded=false;
 }else{void reconcile();void reconcileMms();}};
 const resetMms=(pictures:boolean)=>{mmsOperationId='';mmsReview=null;if(pictures){attachments=[];pictureSeq=0;}};
 const inputRecipients=()=>recipients.split(',').map(v=>v.trim()).filter(Boolean);
 const inFront=()=>active&&owner?.S().view==='messages'&&!document.hidden;
 const ready=()=>inFront()&&!busy&&session.state.status?.permissions.sms==='granted';
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
 const clearDraft=()=>{
  suggesting?.abort();suggesting=null;draft=emptyDraft();body='';draftRevision++;
  operationId='';smsReview=null;resetMms(true);notice='';receipt=null;sent=null;mmsSent=null;
 };
 const chooseThread=(id:string,addresses:readonly string[])=>{
  if(busy||!inFront())return;
  const normalized=normalizeRecipients(addresses);
  if(!normalized.length||!sameRecipients(normalizeRecipients(inputRecipients()),normalized)||(draftThread&&draftThread!==id))clearDraft();
  selectedThread={id,addresses:[...addresses]};draftThread=id;recipients=normalized.join(', ');composing=false;suggestConfirm=false;session.openThread(id);
 };
 const closeThread=()=>{if(!busy){selectedThread=null;suggestConfirm=false;session.openThread(null);}};
 const compose=(prefill?:string)=>{
  if(busy)return;
  if(draftThread!==null||(prefill!==undefined&&recipients!==prefill)){clearDraft();recipients=prefill??'';}
  draftThread=null;composing=true;selectedThread=null;suggestConfirm=false;
  if(session.state.thread)session.openThread(null);else changed();
 };
 const threadRows=():any[]=>session.state.thread?session.state.rows.filter(row=>!isIncompleteSmsRow(row)&&(row as any).threadId===session.state.thread).sort((a,b)=>a.date-b.date):[];
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
  if(draft.draft==='owner'||(body&&!drafted())||attachments.length||operationId||mmsOperationId)return 'occupied';
  const next=askedDraftPlaced(draft,text.trim().slice(0,1600),true);if(next===draft)return 'unavailable';
  suggesting?.abort();suggesting=null;draft=next;body=next.text;draftRevision++;operationId='';resetMms(false);notice='';receipt=null;paint();return 'drafted';
 };
 function loadNames(){if(namesLoaded||!active||session.state.status?.permissions.contacts!=='granted')return;namesLoaded=true;const token=lifecycle;
  void client.searchContacts('',100).then(cards=>{if(token!==lifecycle)return;for(const card of cards)for(const number of card.phoneNumbers){const key=numberKey(number);if(!key||!card.displayName)continue;if(!names.has(key))names.set(key,card.displayName);people.push({name:card.displayName,number});}paint();}).catch(()=>{namesLoaded=false;});}
 /* Applies thread changes to the draft and asks for a suggestion when one is due. It never sends. */
 function drive(){
  if(!active){draft=readinessLost(draft);return;}
  loadNames();
  const latest=latestInbound(),before=draft;if(!busy&&!operationId&&!mmsOperationId)draft=threadChanged(draft,latest);
  if(before.draft==='agent'&&draft.draft==='none'){body='';draftRevision++;operationId='';suggesting?.abort();suggesting=null;}
  if(!suggester||!suggestOn()||body||attachments.length||!canSuggest(draft,latest,ready()))return;
  // Group and short-code conversations can carry data unrelated to a one-person reply.
  const recipients=draftRecipients();
  if(recipients.length!==1||!/^\+?\d{9,20}$/.test(recipients[0]))return;
  const thread=openThread();if(!thread||!latest)return;
  draft=suggestionRequested(draft,latest,true);const ticket=latest,token=lifecycle,controller=new AbortController();suggesting?.abort();suggesting=controller;
  void suggester(thread,controller.signal).then(text=>text&&text.trim()?text.trim().slice(0,1600):null,()=>null).then(text=>{
   if(token!==lifecycle||controller.signal.aborted)return;if(suggesting===controller)suggesting=null;
   const was=draft;draft=suggestionReplied(draft,ticket,latestInbound(),ready()&&!body&&!attachments.length,text);
   if(draft.draft==='agent'&&was.draft!=='agent'){body=draft.text;draftRevision++;operationId='';resetMms(false);notice='';receipt=null;}paint();});
 }
 /* A confirmed review that did not fail clears the composer; nothing is ever sent again from here. */
 const finished=(status:string)=>{const result=status==='cancelled'||status==='denied'?null:status==='failed'?'failed' as const:status==='unknown'?'unknown' as const:'sent' as const;if(!result)return;draft=reviewFinished(draft,result);if(result==='sent'){body='';attachments=[];pictureSeq=0;composing=false;}};
 const accepted=(status:string)=>status==='submitted'||status==='sent'||status==='delivered';
 const drafted=()=>draft.draft==='agent'||draft.draft==='asked';
 const dismissSuggestion=()=>{if(busy||!drafted())return;draft=suggestionDismissed(draft);body='';draftRevision++;operationId='';notice='';changed();};
 async function reconcile(id=operationId||sent?.id){const review=id===operationId?smsReview:id===sent?.id?sent?.review:null;if(!inFront()||!id||!review)return;const token=lifecycle,draft=draftRevision;try{const value=await client.smsSendResult(review,id);if(active&&token===lifecycle&&draft===draftRevision){receipt=value;notice=receiptLabel(value.status);changed();}}catch{/* No record or unavailable is never evidence of not sent. */}}
 async function send(){if(!inFront()||busy)return;const token=lifecycle,draft=draftRevision;busy=true;changed();try{
  const status=session.state.status;if(!status){notice='Refresh Messages, then review the text again.';return;}
  /* The shared review normalizes and dedupes numbers and takes the only active SIM; a SIM that is no longer active is refused. */
  const checked=reviewSms({recipients:draftRecipients(),body,subscriptionId:sim?Number(sim):undefined},status,'direct');
  if('problem' in checked){notice=checked.problem==='sim-unknown'&&!status.subscriptions?'Allow SIM':smsProblemLabel(checked.problem,'direct',!!sim,body.length);return;}
  if(!operationId||!smsReview){operationId=crypto.randomUUID();smsReview={...checked.review,subscriptionId:checked.review.subscriptionId as number};}
  const result=await client.sendSms(smsReview,operationId);if(!active||token!==lifecycle||draft!==draftRevision)return;receipt=result;notice=receiptLabel(result.status);
  /* Cancelled and denied prove nothing was sent: the next Send opens a new review. */
  if(result.status==='cancelled'||result.status==='denied'){operationId='';draftRevision++;}else{finished(result.status);if(accepted(result.status)){sent={id:operationId,review:smsReview};operationId='';smsReview=null;draftRevision++;}}await session.refresh();
 }catch(error){if(active&&token===lifecycle&&draft===draftRevision){const code=(error as {code?:string})?.code,message=error instanceof Error?error.message:'';
  if(operationId&&code&&SMS_NOT_SENT.has(code)&&message){operationId='';notice=message;}else if(operationId&&code==='expired'&&message)notice=message;
  else notice=operationId?'May have sent':message||'Couldn’t open';}}finally{if(token===lifecycle){busy=false;changed();}}}
 async function reconcileMms(id=mmsOperationId||mmsSent?.id){const review=id===mmsOperationId?mmsReview:id===mmsSent?.id?mmsSent?.review:null;if(!inFront()||!id||!review)return;const token=lifecycle,draft=draftRevision;try{const value=await client.mmsSendResult(review,id);if(active&&token===lifecycle&&draft===draftRevision){notice=mmsReceiptLabel(value.status);changed();}}catch{/* No record or unavailable is never evidence of not sent. */}}
 /** One MMS to every recipient, with the text and the picked pictures. Android's review dialog shows
  * it again; only the owner's Send there sends. A repeated operation ID never sends twice. */
 async function sendMms(){if(!inFront()||busy)return;const token=lifecycle,draft=draftRevision;let dispatched=false;busy=true;changed();try{
  const status=session.state.status;if(!status)throw Error('Refresh Messages, then review the MMS again.');
  const checked=reviewMms({recipients:draftRecipients(),body,attachments,subscriptionId:sim?Number(sim):undefined},status);
  if('problem' in checked)throw Error(mmsProblemLabel(checked.problem));
  if(!mmsOperationId){mmsOperationId=crypto.randomUUID();mmsReview=checked.review;}
  dispatched=true;const result=await client.sendMms(mmsReview??checked.review,mmsOperationId);if(!active||token!==lifecycle||draft!==draftRevision)return;receipt=null;notice=mmsReceiptLabel(result.status);const sentMms=mmsReview??checked.review;finished(result.status);if(result.status==='cancelled'||result.status==='denied'){resetMms(false);draftRevision++;}else if(accepted(result.status)){mmsSent={id:mmsOperationId,review:sentMms};resetMms(true);draftRevision++;}await session.refresh();
 }catch(error){if(active&&token===lifecycle&&draft===draftRevision)notice=dispatched?'May have sent':error instanceof Error?error.message:'Couldn’t open';}finally{if(token===lifecycle){busy=false;changed();}}}
 /** Picking pictures only changes the draft; nothing is read beyond the files the owner chose. */
 function attach(){if(!active||busy)return;if(attachments.length>=MMS_MAX_ATTACHMENTS){notice='Max 5 pictures';changed();return;}const token=lifecycle,draft=draftRevision,input=document.createElement('input');input.type='file';input.accept=Object.keys(MMS_PICTURES).join(',');input.multiple=true;
  /* A result that arrives while the page is still hidden waits for it to show again; pagehide always ends the pick. */
  const done=(event?:Event)=>{if(document.hidden&&event?.type!=='pagehide')return;window.removeEventListener('pagehide',done);if(!picking)return;picking=false;sync();};input.oncancel=()=>done();window.addEventListener('pagehide',done);
  input.onchange=async()=>{done();const files=[...(input.files||[])];input.value='';try{const picked:Omit<MmsAttachmentDraft,'name'>[]=[];for(const file of files){if(!MMS_PICTURES[file.type])throw Error('Only JPEG, PNG and GIF pictures can be sent.');if(!file.size||file.size>1024*1024)throw Error('Each picture must be smaller than 1 MB.');picked.push({contentType:file.type,bytes:new Uint8Array(await file.arrayBuffer())});}
   if(!active||token!==lifecycle||draft!==draftRevision||busy)return;if(attachments.length+picked.length>MMS_MAX_ATTACHMENTS)throw Error('Max 5 pictures');
   for(const item of picked)attachments.push({...item,name:`picture-${++pictureSeq}.${MMS_PICTURES[item.contentType]}`});draftRevision++;operationId='';resetMms(false);receipt=null;notice='';changed();
  }catch(error){if(active&&token===lifecycle){notice=error instanceof Error?error.message:'Unreadable pictures';changed();}}};
  picking=true;input.click();}
 async function handoff(){if(!inFront()||busy||operationId||mmsOperationId||attachments.length)return;const token=lifecycle,draft=draftRevision;busy=true;changed();try{
  /* The messaging app chooses the SIM, so a handoff never carries one. */
  const status=session.state.status;if(!status){notice='Refresh needed';return;}
  const checked=reviewSms({recipients:draftRecipients(),body},status,'handoff');if('problem' in checked){notice=smsProblemLabel(checked.problem,'handoff',false,body.length);return;}
  const result=await client.composeSms(checked.review);if(active&&token===lifecycle&&draft===draftRevision)notice=result.message;}catch{if(active&&token===lifecycle)notice='Couldn’t open';}finally{if(token===lifecycle){busy=false;changed();}}}
 const edit=(setter:(value:string)=>void)=>(event:Event)=>{if(busy)return;setter((event.target as HTMLInputElement).value);draftRevision++;operationId='';resetMms(false);notice='';receipt=null;changed();};
 async function permission(access:'sms'|'sendSms'|'phoneState'){
  if(!inFront()||busy)return;const token=lifecycle;busy=true;changed();
  try{await session.request(access);}
  catch{if(token===lifecycle)notice='SMS access could not be requested.';}
  finally{if(token===lifecycle){busy=false;changed();}}
 }
 /* Back returns to the list and keeps the draft bound to its recipients. */
 const back=views.messages.back;views.messages.back=(st:Bag,api:Bag)=>{if(session.state.thread){if(suggestConfirm){suggestConfirm=false;paint();}else closeThread();return true;}if(composing){if(!busy){composing=false;changed();}return true;}return back?back(st,api):false;};
 views.messages.reply=()=>null;views.messages.suggestions=()=>[];
 /* One Send: several recipients or pictures go as one reviewed MMS, otherwise a reviewed SMS. */
 /* The orb in the conversation bar is Alpha. Text the owner typed there goes with it as the request,
  * so "tell her I'm running late" can be typed in place and is sent to Alpha by the same tap; a draft Alpha wrote stays where it is. */
 const askAlpha=()=>{if(busy)return;const request=draft.draft==='owner'?body.trim():'';if(request){draft=typed(draft,'');body='';draftRevision++;operationId='';notice='';paint();api?.send?.(request);}else api?.chat?.();};
 /* People to address a new message to: contacts matching what is typed in To, by name or number. */
 const picks=()=>{const typedTo=inputRecipients(),last=recipients.trim().endsWith(',')?'':(typedTo[typedTo.length-1]||''),query=last.toLowerCase(),digits=last.replace(/\D/g,''),chosen=new Set(typedTo.map(numberKey));
  return people.filter(person=>!chosen.has(numberKey(person.number))&&(!query||person.name.toLowerCase().includes(query)||(digits.length>=3&&person.number.replace(/\D/g,'').includes(digits)))).slice(0,30)
   .map(person=>({name:person.name,number:displayNumber(person.number),ini:initials(person.name),label:`${person.name}, ${displayNumber(person.number)}`,pick:()=>{if(busy)return;const kept=recipients.trim().endsWith(',')?typedTo:typedTo.slice(0,-1);recipients=[...kept,person.number].join(', ');draftRevision++;operationId='';resetMms(false);notice='';paint();}}));};
 const submit=()=>{if(attachments.length||draftRecipients().length>1)void sendMms();else void send();};
 /** Values of the designed Messages view: a thread list, one thread with its composer, or a new message. */
 function designed(opens:readonly {open:()=>void}[]){
  const state=session.state,now=Date.now(),status=state.status,access=!!status&&status.permissions.sms!=='granted',thread=openRow();
  const sims=status?.subscriptions||[],sole=thread?.addresses.length===1?normalizePhoneNumber(thread.addresses[0]):null,title=thread?threadTitle(thread.addresses,names):'';
  const sendingTo=draftRecipients(),showThread=!access&&!!state.thread,showNew=!state.thread&&composing,showComposer=showThread||showNew;
  const direct=!!status&&status.sendMode==='direct'&&sims.length>0&&(sendingTo.length<=1||status.mmsSend);
  const hasBody=!!body.trim(),hasDraft=hasBody||attachments.length>0;
  return {
   needsAccess:access&&!showNew,showList:!access&&!state.thread&&!composing,showThread,showNew,showComposer,
   showNewButton:!state.thread&&!composing,readFailed:!status&&!state.busy,showEmpty:!!status&&!state.busy&&state.threads.length===0,
   compose:()=>compose(),closeNew:()=>{if(!busy){composing=false;changed();}},
   needsSendAccess:!!status&&status.permissions.sendSms!=='granted',needsSimAccess:!!status&&status.permissions.phoneState!=='granted',
   canHandoff:!!status&&!direct&&!attachments.length&&!operationId&&!mmsOperationId&&hasBody&&sendingTo.length>0,
   threads:state.threads.map((row,index)=>{const incomplete=isIncompleteSmsRow(row),full=row as any,name=incomplete?'Conversation content unavailable':threadTitle(full.addresses,names),unread=!incomplete&&full.unread===true,when=shortWhen(row.date,now);
    return {id:row.id,open:()=>opens[index]?.open(),title:name,ini:initials(name),when,snippet:incomplete?'Use the system messaging app to view this conversation.':String(full.snippet||''),unread,weight:unread?700:600,color:unread?'var(--fg)':'var(--mut)',label:`${name}, ${when}${unread?', unread':''}`};}),
   title,ini:initials(title),canCall:!!sole,call:()=>{if(sole)api?.open?.('phone',{prefill:sole});},callLabel:`Call ${title}`,
   bubbles:state.rows.filter(row=>row.threadId===state.thread).slice().sort((a,b)=>a.date-b.date).map(row=>{
    if(isIncompleteSmsRow(row))return {id:row.id,text:'Use the system messaging app to view this message.',hasText:true,side:'flex-start',bg:'var(--s2)',fg:'var(--mut)',failed:false,picture:false};
    const mine=row.direction!=='incoming';return {id:row.id,text:String(row.body||''),hasText:!!row.body,side:mine?'flex-end':'flex-start',bg:mine?'var(--fg)':'var(--s2)',fg:mine?'var(--bg)':'var(--fg)',
    failed:mine&&row.status==='failed',picture:row.attachments>0,pictureLabel:row.attachments>1?`${row.attachments} pictures`:'Picture'};}),
   suggested:drafted(),dismissSuggestion,ownsDock:showComposer,askAlpha,picks:composing&&!state.thread?picks():[],
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
   cannotSend:busy||!direct||!hasDraft||!sendingTo.length,submit,
   pickSim:sims.length>1,sims:sims.map(row=>{const on=String(row.id)===sim;return {label:row.displayName||`SIM ${row.slot+1}`,on,bg:on?'var(--fg)':'var(--s2)',fg:on?'var(--bg)':'var(--fg)',
    pick:()=>{if(busy)return;receipt=null;notice='';sim=String(row.id);draftRevision++;operationId='';resetMms(false);changed();}};}),
   pictures:attachments.map((item,index)=>({label:item.name,remove:()=>{if(busy)return;attachments.splice(index,1);draftRevision++;operationId='';resetMms(false);receipt=null;notice='';changed();}})),hasPictures:attachments.length>0,
   hasNotice:!!notice};
 }
 views.messages.render=(st:Bag,viewApi:Bag)=>{api=viewApi;
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
 return {nativeManaged:true,nativePrototype:false,nativeStatus:session.state.message,nativeRows,nativeReceipts:session.state.receipts.map(row=>({id:row.operationId,label:`${formatDateTime(new Date(row.createdAt))} · Subscription ${row.subscriptionId} · ${receiptLabel(row.status)}`})),nativeThreads,nativeInThread:!!session.state.thread,nativeBack:closeThread,nativeMore:!!session.state.next,nativeBusy:busy||session.state.busy,nativeRefresh:()=>{void session.refresh();void reconcile();void reconcileMms();},nativeLoadMore:()=>void session.refresh(true),nativeRead:()=>void permission('sms'),nativeSendAccess:()=>void permission('sendSms'),nativeSimAccess:()=>void permission('phoneState'),nativeSims:(session.state.status?.subscriptions||[]).map(row=>({...row,label:`SIM ${row.slot+1}: ${row.displayName}`,pick:()=>{if(busy)return;receipt=null;notice='';sim=String(row.id);draftRevision++;operationId='';resetMms(false);changed();}})),nativeSim:sim?`Selected subscription ${sim}`:session.state.status?.permissions.phoneState!=='granted'?'Grant SIM access to select a SIM.':session.state.status?.subscriptions?.length===0?'No active SIM is available.':'Select a SIM below',nativeRecipients:recipients,nativeBody:body,nativeOnRecipients:(event:Event)=>{if(draftThread===null&&!session.state.thread)edit(value=>recipients=value)(event);},nativeOnBody:edit(value=>{body=value;suggesting?.abort();suggesting=null;draft=typed(draft,value);}),nativeSend:()=>void send(),nativeSendMms:()=>void sendMms(),nativeAttach:()=>attach(),nativeMmsAvailable:!!session.state.status?.mmsSend,nativeAttachments:attachments.map((item,index)=>({label:`${item.name} · ${Math.max(1,Math.round(item.bytes.length/1024))} KB`,remove:()=>{if(busy)return;attachments.splice(index,1);draftRevision++;operationId='';resetMms(false);receipt=null;notice='';changed();}})),nativeHandoff:()=>void handoff(),nativeNotice:notice,nativeClear:()=>{if(busy)return;clearDraft();if(draftThread===null)recipients='';changed();},
  ...designed(nativeThreads)};};
 p.componentDidMount=function(){mount?.call(this);owner=this;this.smsSelection=()=>{const selected=session.state.status?.subscriptions?.find(row=>String(row.id)===sim);return inFront()&&selected?{kind:'sms-subscription',id:String(selected.id),revision:smsSubscriptionRevision(selected)}:undefined;};lifecycle++;this.smsReturn=watchReturnToApp(()=>void session.refresh());this.smsHide=()=>{if(!document.hidden)picking=false;sync();};document.addEventListener('visibilitychange',this.smsHide);sync();};
 p.componentDidUpdate=function(...args:any[]){update?.apply(this,args);sync();};
 p.componentWillUnmount=function(){this.smsSelection=undefined;this.smsReturn?.();document.removeEventListener('visibilitychange',this.smsHide);if(owner===this){owner=null;active=false;lifecycle++;session.setActive(false);clearDraft();recipients='';draftThread=null;composing=false;suggestConfirm=false;api=null;names.clear();people.length=0;selectedThread=null;namesLoaded=false;}unmount?.call(this);};
}
