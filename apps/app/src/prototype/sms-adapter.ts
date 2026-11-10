import {isIncompleteSmsRow} from '../../../../.eliza/client-features/packages/contracts/src/native-telephony.ts';
import {registerPlugin} from '../platform-plugins';
import {aospImage} from '../runtime/aosp-image';
import {createSmsSession,mmsProblemLabel,mmsReceiptLabel,receiptLabel} from '../runtime/image-sms';
import {smsSubscriptionRevision} from '../runtime/sms-subscription-revision';
import {createAospTelephony,registerTelephonyProfile,MMS_MAX_ATTACHMENTS,reviewMms,reviewSms,type AlphaTelephonyPlugin,type MmsAttachmentDraft,type MmsReview,type SmsReview,type SmsReviewProblem,type SmsSendResult} from '../runtime/aosp-telephony';
import {watchReturnToApp} from './native-adapter';
import {formatDateTime} from './locale-time';
type Bag=Record<string,any>;
const MMS_PICTURES:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/gif':'gif'};
/* Native rejects with these codes before it journals or sends anything, so its message is the
 * reason and the next Send opens a new review. */
const SMS_NOT_SENT=new Set(['too-long','invalid','busy','unavailable']);
/* Owner text for the shared review's refusals; a handoff allows more people and a longer text. */
function smsProblemLabel(problem:SmsReviewProblem,mode:'direct'|'handoff',chosen:boolean){
 return {'no-recipient':'Enter at least one phone number.','invalid-recipient':'Check the phone numbers.','too-many-recipients':mode==='direct'?'A text can go to at most five people.':'A text can go to at most ten people.','empty-body':'Enter a message.','body-too-long':mode==='direct'?'A text is limited to 1,600 characters.':'A text is limited to 5,000 characters.','invalid-body':'The message contains characters that cannot be sent.','sim-unknown':chosen?'That SIM is no longer active. Select a SIM again.':'No active SIM is available.','sim-required':'Select a SIM for this text.','sim-not-selectable':'Choose the SIM in your messaging app.'}[problem];
}
export function installSmsAdapter(Component:any,views:Bag){
 if(!aospImage)return;
 const client=createAospTelephony(registerPlugin<AlphaTelephonyPlugin>('AlphaTelephony'),true),p=Component.prototype,mount=p.componentDidMount,update=p.componentDidUpdate,unmount=p.componentWillUnmount;
 let owner:any,recipients='',body='',sim='',operationId='',busy=false,notice='',active=false,lifecycle=0,draftRevision=0,picking=false;
 let receipt:SmsSendResult|null=null;
 /* The reviewed text an operation ID was assigned for: the native send and its read-back hash exactly this. */
 let smsReview:(SmsReview&{subscriptionId:number})|null=null;
 /* A reviewed MMS (group message or pictures) keeps its own operation ID and the exact reviewed
  * content, so a result is read back only for what the owner reviewed. */
 let attachments:MmsAttachmentDraft[]=[],pictureSeq=0,mmsOperationId='',mmsReview:MmsReview|null=null;
 const changed=()=>owner?.setState({smsNativeRevision:Date.now()});
 /* The verified image's reviewed client is the shared Messages and Phone profile while this shell
  * is installed; off the image this adapter returns above, so nothing is registered. */
 registerTelephonyProfile(client);
 const session=createSmsSession(client,true,changed,id=>{if(id===operationId)void reconcile();},id=>{if(id===mmsOperationId)void reconcileMms();});
 /* Android's picture chooser covers the WebView and reports it hidden; the draft stays while it is open. */
 const sync=()=>{const next=!!owner&&owner.S().view==='messages'&&(!document.hidden||picking);if(next===active)return;active=next;lifecycle++;session.setActive(next);if(!next){busy=false;draftRevision++;
  // Provider rows and observation are cleared by the inactive session. Keep the
  // owner's unfinished draft in memory across navigation/backgrounding. Preserve
  // its operation identity so returning cannot replay an uncertain send.
 }else{void reconcile();void reconcileMms();}};
 const resetMms=(pictures:boolean)=>{mmsOperationId='';mmsReview=null;if(pictures){attachments=[];pictureSeq=0;}};
 const draftRecipients=()=>recipients.split(',').map(v=>v.trim()).filter(Boolean);
 async function reconcile(){if(!active||!operationId||!smsReview)return;const token=lifecycle,draft=draftRevision,id=operationId,review=smsReview;try{const value=await client.smsSendResult(review,id);if(active&&token===lifecycle&&draft===draftRevision){receipt=value;notice=receiptLabel(value.status);changed();}}catch{/* No record or unavailable is never evidence of not sent. */}}
 async function send(){if(!active||busy)return;const token=lifecycle,draft=draftRevision;busy=true;changed();try{
  const status=session.state.status;if(!status){notice='Refresh Messages, then review the text again.';return;}
  /* The shared review normalizes and dedupes numbers and takes the only active SIM; a SIM that is no longer active is refused. */
  const checked=reviewSms({recipients:draftRecipients(),body,subscriptionId:sim?Number(sim):undefined},status,'direct');
  if('problem' in checked){notice=checked.problem==='sim-unknown'&&!status.subscriptions?'Grant SIM access to select a SIM.':smsProblemLabel(checked.problem,'direct',!!sim);return;}
  if(!operationId||!smsReview){operationId=crypto.randomUUID();smsReview={...checked.review,subscriptionId:checked.review.subscriptionId as number};}
  const result=await client.sendSms(smsReview,operationId);if(!active||token!==lifecycle||draft!==draftRevision)return;receipt=result;notice=receiptLabel(result.status);
  /* Cancelled and denied prove nothing was sent: the next Send opens a new review. */
  if(result.status==='cancelled'||result.status==='denied'){operationId='';draftRevision++;}await session.refresh();
 }catch(error){if(active&&token===lifecycle&&draft===draftRevision){const code=(error as {code?:string})?.code,message=error instanceof Error?error.message:'';
  if(operationId&&code&&SMS_NOT_SENT.has(code)&&message){operationId='';notice=message;}else if(operationId&&code==='expired'&&message)notice=message;
  else notice=operationId?'This text may have sent. Check your messaging app before sending again.':message||'SMS review could not open.';}}finally{if(token===lifecycle){busy=false;changed();}}}
 async function reconcileMms(){if(!active||!mmsOperationId||!mmsReview)return;const token=lifecycle,draft=draftRevision,id=mmsOperationId,review=mmsReview;try{const value=await client.mmsSendResult(review,id);if(active&&token===lifecycle&&draft===draftRevision){notice=mmsReceiptLabel(value.status);changed();}}catch{/* No record or unavailable is never evidence of not sent. */}}
 /** One MMS to every recipient, with the text and the picked pictures. Android's review dialog shows
  * it again; only the owner's Send there sends. A repeated operation ID never sends twice. */
 async function sendMms(){if(!active||busy)return;const token=lifecycle,draft=draftRevision;let dispatched=false;busy=true;changed();try{
  const status=session.state.status;if(!status)throw Error('Refresh Messages, then review the MMS again.');
  const checked=reviewMms({recipients:draftRecipients(),body,attachments,subscriptionId:sim?Number(sim):undefined},status);
  if('problem' in checked)throw Error(mmsProblemLabel(checked.problem));
  if(!mmsOperationId){mmsOperationId=crypto.randomUUID();mmsReview=checked.review;}
  dispatched=true;const result=await client.sendMms(mmsReview??checked.review,mmsOperationId);if(!active||token!==lifecycle||draft!==draftRevision)return;receipt=null;notice=mmsReceiptLabel(result.status);await session.refresh();
 }catch(error){if(active&&token===lifecycle&&draft===draftRevision)notice=dispatched?'This MMS may have sent. Check the conversation before sending again.':error instanceof Error?error.message:'MMS review could not open.';}finally{if(token===lifecycle){busy=false;changed();}}}
 /** Picking pictures only changes the draft; nothing is read beyond the files the owner chose. */
 function attach(){if(!active||busy)return;if(attachments.length>=MMS_MAX_ATTACHMENTS){notice='An MMS can carry at most five pictures.';changed();return;}const token=lifecycle,draft=draftRevision,input=document.createElement('input');input.type='file';input.accept=Object.keys(MMS_PICTURES).join(',');input.multiple=true;
  /* A result that arrives while the page is still hidden waits for it to show again; pagehide always ends the pick. */
  const done=(event?:Event)=>{if(document.hidden&&event?.type!=='pagehide')return;window.removeEventListener('pagehide',done);if(!picking)return;picking=false;sync();};input.oncancel=()=>done();window.addEventListener('pagehide',done);
  input.onchange=async()=>{done();const files=[...(input.files||[])];input.value='';try{const picked:Omit<MmsAttachmentDraft,'name'>[]=[];for(const file of files){if(!MMS_PICTURES[file.type])throw Error('Only JPEG, PNG and GIF pictures can be sent.');if(!file.size||file.size>1024*1024)throw Error('Each picture must be smaller than 1 MB.');picked.push({contentType:file.type,bytes:new Uint8Array(await file.arrayBuffer())});}
   if(!active||token!==lifecycle||draft!==draftRevision||busy)return;if(attachments.length+picked.length>MMS_MAX_ATTACHMENTS)throw Error('An MMS can carry at most five pictures.');
   for(const item of picked)attachments.push({...item,name:`picture-${++pictureSeq}.${MMS_PICTURES[item.contentType]}`});draftRevision++;operationId='';resetMms(false);receipt=null;notice='';changed();
  }catch(error){if(active&&token===lifecycle){notice=error instanceof Error?error.message:'The pictures could not be read.';changed();}}};
  picking=true;input.click();}
 async function handoff(){if(!active||busy)return;const token=lifecycle,draft=draftRevision;busy=true;changed();try{
  /* The messaging app chooses the SIM, so a handoff never carries one. */
  const status=session.state.status;if(!status){notice='Refresh Messages, then review the text again.';return;}
  const checked=reviewSms({recipients:draftRecipients(),body},status,'handoff');if('problem' in checked){notice=smsProblemLabel(checked.problem,'handoff',false);return;}
  const result=await client.composeSms(checked.review);if(active&&token===lifecycle&&draft===draftRevision)notice=result.message;}catch{if(active&&token===lifecycle)notice='Enter recipients and text, then review them in your messaging app.';}finally{if(token===lifecycle){busy=false;changed();}}}
 const edit=(setter:(value:string)=>void)=>(event:Event)=>{if(busy)return;setter((event.target as HTMLInputElement).value);draftRevision++;operationId='';resetMms(false);notice='';receipt=null;changed();};
 /* Prefilled recipients only change the draft; Send still opens Android's review. */
 /* Recipients a thread filled follow the next thread opened until the owner edits them. */
 let threadFill='';
 const address=(value:string)=>{if(busy)return false;recipients=value;draftRevision++;operationId='';resetMms(false);notice='';receipt=null;return true;};
 const threadAddresses=(addresses:readonly string[])=>{const numbers=addresses.map(v=>v.replace(/[\s().-]/g,''));return numbers.length&&numbers.length<=5&&numbers.every(v=>/^\+?[0-9]{2,20}$/.test(v))?[...new Set(numbers)].join(', '):'';};
 async function permission(access:'sms'|'sendSms'|'phoneState'){const token=lifecycle;try{await session.request(access);}catch{if(active&&token===lifecycle){notice='SMS access could not be requested.';changed();}}}
 /* Back in a conversation returns to the list and keeps the draft. */
 const back=views.messages.back;views.messages.back=(st:Bag,api:Bag)=>{if(session.state.thread){session.openThread(null);return true;}return back?back(st,api):false;};
 views.messages.reply=()=>null;views.messages.suggestions=()=>[];
 views.messages.render=(st:Bag,api:Bag)=>{
 /* A number handed over from Contacts fills the recipients once. */
 if(typeof st?.prefill==='string'&&st.prefill){address(st.prefill.slice(0,230));queueMicrotask(()=>api.set?.({prefill:null}));}
 /* An incomplete provider row has no content or recipients to present. Listing or
  * selecting one must not imply that its message was shown or prefill a reply. */
 const nativeRows=session.state.rows.map(row=>isIncompleteSmsRow(row)
  ? {id:row.id,address:'Content unavailable',direction:'',when:formatDateTime(new Date(row.date)),body:'Use the system messaging app to view this message.'}
  : {...row,address:row.addresses.join(', '),direction:`${row.direction} · ${row.kind.toUpperCase()} · ${row.status}${row.attachments?' · '+row.attachments+' attachments':''}`,when:formatDateTime(new Date(row.date))});
 const nativeThreads=session.state.threads.map(row=>isIncompleteSmsRow(row)
  ? {id:row.id,label:'Conversation content unavailable',snippet:'Use the system messaging app to view this conversation.',open:()=>{notice='Content unavailable. Use the system messaging app to view this conversation.';changed();}}
  : {...row,label:row.addresses.join(', ')||'Conversation',open:()=>{session.openThread(row.id);const value=threadAddresses(row.addresses);if((!recipients.trim()||recipients===threadFill)&&recipients!==value&&address(value)){threadFill=value;changed();}}});
 return {nativeManaged:true,nativePrototype:false,nativeStatus:session.state.message,nativeRows,nativeReceipts:session.state.receipts.map(row=>({id:row.operationId,label:`${formatDateTime(new Date(row.createdAt))} · Subscription ${row.subscriptionId} · ${receiptLabel(row.status)}`})),nativeThreads,nativeInThread:!!session.state.thread,nativeBack:()=>session.openThread(null),nativeMore:!!session.state.next,nativeBusy:busy||session.state.busy,nativeRefresh:()=>{void session.refresh();void reconcile();},nativeLoadMore:()=>void session.refresh(true),nativeRead:()=>void permission('sms'),nativeSendAccess:()=>void permission('sendSms'),nativeSimAccess:()=>void permission('phoneState'),nativeSims:(session.state.status?.subscriptions||[]).map(row=>({...row,label:`SIM ${row.slot+1}: ${row.displayName}`,pick:()=>{if(busy)return;receipt=null;notice='';sim=String(row.id);draftRevision++;operationId='';resetMms(false);changed();}})),nativeSim:sim?`Selected subscription ${sim}`:session.state.status?.permissions.phoneState!=='granted'?'Grant SIM access to select a SIM.':session.state.status?.subscriptions?.length===0?'No active SIM is available.':'Select a SIM below',nativeRecipients:recipients,nativeBody:body,nativeOnRecipients:edit(value=>recipients=value),nativeOnBody:edit(value=>body=value),nativeSend:()=>void send(),nativeSendMms:()=>void sendMms(),nativeAttach:()=>attach(),nativeMmsAvailable:!!session.state.status?.mmsSend,nativeAttachments:attachments.map((item,index)=>({label:`${item.name} · ${Math.max(1,Math.round(item.bytes.length/1024))} KB`,remove:()=>{if(busy)return;attachments.splice(index,1);draftRevision++;operationId='';resetMms(false);receipt=null;notice='';changed();}})),nativeHandoff:()=>void handoff(),nativeNotice:notice,nativeClear:()=>{if(busy)return;draftRevision++;recipients='';body='';operationId='';resetMms(true);notice='';receipt=null;changed();}};};
 p.componentDidMount=function(){mount?.call(this);owner=this;this.smsSelection=()=>{const selected=session.state.status?.subscriptions?.find(row=>String(row.id)===sim);return active&&selected?{kind:'sms-subscription',id:String(selected.id),revision:smsSubscriptionRevision(selected)}:undefined;};lifecycle++;this.smsReturn=watchReturnToApp(()=>void session.refresh());this.smsHide=()=>{if(!document.hidden)picking=false;sync();};document.addEventListener('visibilitychange',this.smsHide);sync();};
 p.componentDidUpdate=function(...args:any[]){update?.apply(this,args);sync();};
 p.componentWillUnmount=function(){this.smsSelection=undefined;this.smsReturn?.();document.removeEventListener('visibilitychange',this.smsHide);if(owner===this){owner=null;active=false;lifecycle++;session.setActive(false);}unmount?.call(this);};
}
