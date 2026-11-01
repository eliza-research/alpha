import {cloudServiceName} from '../runtime/cloud-protocol';
import {browserNavigationSummary,projectActionMessages} from '../runtime/action-message-presentation';
import {CanonicalNotesUi} from './canonical-notes-ui';
import {openExistingBrowserNotes,openExistingDeviceNotes} from './legacy-notes-access';
import {executeNamedCalendarRead,type NamedCalendarReadProvider} from '../../../../.eliza/client-features/plugins/plugin-calendar/src/client/named-read.ts';
import {reconcileNotesEditor} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-draft.ts';
import {CAMERA_CONTEXT_NOTICE,publishCommittedDeviceChanges} from '../runtime/device-actions';
import {captureAgentPhoto} from './camera-adapter';
import {isCameraCapture} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/camera-contract.ts';
import {dismissMailFolderMenu} from '../../../../.eliza/client-features/plugins/plugin-inbox/src/components/mailbox/MailFolderPicker.tsx';
import {aospImage} from '../runtime/aosp-image';
import {localTurnStatus,batchVoiceProgressEvents,batchVoiceReplyEvents,type BatchProgressCue} from '../runtime/local-agent-stream';
import {smsSubscriptionRevision} from '../runtime/sms-subscription-revision';
import {createAospTelephony,type AlphaTelephonyPlugin} from '../runtime/aosp-telephony';
import {isSmsSend,validateSmsResult,smsAgentHash,smsDeviceStatus} from '../runtime/sms-agent-contract';
import {isPhoneDial,dialDeviceStatus,phoneDialResultText,type PhoneDialResult} from '../runtime/phone-dial-contract';
import {receiptLabel} from '../runtime/image-sms';
import {deletions,refreshDeletionViews,reminderDeletionRefusal} from '../runtime/deletions';
import {BrowserReviews} from '../browser/review';
import type {ConversationMessageTarget} from '../runtime/alpha-client';
import {formatDeviceRecordDateTime} from "../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/device-record-presentation.ts";
import {isNativeNotesQuery} from '../../../../.eliza/client-features/packages/contracts/src/native-notes-query.ts';
import {executeNotesQuery} from './notes-query-executor';
import {executeCalendarAvailability,type AvailabilityProvider} from '../runtime/calendar-availability';
import {availabilityReview} from './calendar-availability-review';
import {presentDeviceRecordOperation} from '../runtime/device-record-presentation';
import { passwordSurfaceOpen } from '../passwords/password-manager';
import {AssistantDraftController} from './assistant-draft-controller';
import {assistantDraftStore} from '../runtime/assistant-draft-store';
import {browserNotesPort,browserNotesRecovery} from '../runtime/browser-notes-document';
import {audioDeletionRecovery} from '../runtime/note-audio-deletions';
import {addNotesTrashEntry,editNotesTrash,isNotesTrashFull,withNotesDeletionLock} from '../runtime/notes-trash';
import {openDomainRecovery} from '../browser/domain-recovery';
import {reviewSummaryNote} from './summary-note-review';
import {summarySourceOf as sourceOf,recordingSourceOf,recordingRevision,type SummarySource as Source} from './summary-source';
import {reviewAgentClock} from '../runtime/clock-agent-review';
import {isReminderCreate,validateReminderCreateResult} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-create-contract.ts';
import {publishWorkflowNotice} from '../browser/workflow-notices';
import {speakAppText} from '../runtime/app-speech';
import {browserDevProfile} from '../browser/dev-profile';
import {stampNoteChanges} from '../runtime/note-dates';
import {isClockOperation,assertClockTimeZone,currentClockTimeZone,validateClockResult} from '../runtime/clock-contract';
import { Capacitor } from '@capacitor/core';
import { isMapsOperation } from '../runtime/maps-contract';
import { readMapsSelection } from '../maps/agent-context';
import { isLibraryOperation } from '../runtime/photo-library';
import { deviceLibraryAgent, LibraryAgentRefusal } from './photo-library-adapter';
import {isReminderOperation,validateReminderResult} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-contract.ts';
import { SecureNotesStore, notesDraftBase, applyNotesDraft, notesDraftConflicts, NotesStorageFull, SECURE_NOTES_SLOT, SECURE_NOTES_DRAFT_SLOT, type NotesDraft, type NotesDraftReason } from '../runtime/notes-secure-store';
import { secureConnectionStore } from '../runtime/native-connection';
import {NotesCommitUncertain,isStorageFull} from '../runtime/notes-store';
import {isNotesOperation,validateNotesOperation,notesTarget} from '../runtime/notes-contract';
import {isCalendarOperation,validateCalendarResult} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/calendar-contract.ts';
import { isMvpView } from "./mvp-features";
import { alphaViewKey, alphaViewPaths } from "../product/alpha-product";
import { workflowSha, validateWorkflowResult } from '../runtime/workflow-device-contract';
import { WorkflowReminderOverflow, workflowReminderRows } from '../runtime/workflow-reminder-read';
import { getMapsSelectedObject, clearMapsSelection } from '../maps/agent-context';
import { alphaClient, AlphaClientError, type AlphaView } from '../runtime/alpha-client';
import { testMocksEnabled, devSurfacesEnabled, privateLocalPreviewEnabled } from '../build-flags';
import { DailyApps } from '../daily';
import { isAndroid } from '../native';
import { registerPlugin } from '../platform-plugins';
import { SystemBars, SystemBarsStyle } from '@capacitor/core';
import {mergeConversationDelivery, connectionController, STOPPED_REPLY_NOTICE, STOPPED_CANCELLED_NOTICE, STOPPED_CONFIRMED_NOTICE, INFERENCE_OFFLINE_NOTICE, RESIDENT_STARTING_NOTICE, RESIDENT_RECOVERING_NOTICE, NO_AGENT_SEND, NO_AGENT_VOICE, residentAlwaysPresent, agentPendingText, agentAvailabilityNotice } from '../runtime/connection-ui';
import { broaderPageNotice, honestTiles, handoffGate, watchReturnToApp, tileFactsFromSnapshot, tileSettingsPages, type TileFacts, type TileKey } from './native-adapter';
const alphaDevice = registerPlugin<{ snapshot(): Promise<Record<string, unknown>>; openSettings(input: { page: string }): Promise<{ status: string; specific?: boolean }> }>('AlphaDevice');
const elizaSystem = registerPlugin<{ setFlashlight(input: { enabled: boolean }): Promise<{ available: boolean; enabled: boolean }> }>('ElizaSystem');

// The reference renderer is a JavaScript state machine. Its presentation API is
// intentionally kept intact; authenticated effects are installed at this seam.
type Shell = any;
/** One composer send. A message is dispatched once the transport accepted it for delivery. */
type SendAttempt={transportCalled:boolean;preDispatch:boolean;streamed:boolean;settled?:Promise<unknown>};
/** Refused before any request carrying the message could leave this phone. */
class NotDispatched extends Error {}
// connectionController.send refuses these before creating a conversation or posting the message.
// Set while the page is being torn down (reload, Activity teardown). A send that fails then has
// shown its outcome to no one, so its saved copy keeps the sending mark for review at the next start.
// A page entering the back/forward cache (`persisted`) is restored later, so it is not leaving.
let pageLeaving=false;
if(typeof window!=='undefined'){window.addEventListener('pagehide',(event:PageTransitionEvent)=>{if(!event.persisted)pageLeaving=true;});window.addEventListener('pageshow',()=>{pageLeaving=false;});}
/**
 * A new chat's first message is held (marked as sending) in the owner and agent's "no conversation
 * yet" draft slot; its send then creates the conversation and saves it as the restart selection.
 * If the page goes away mid-send, the next start opens that conversation, so the mark would only be
 * offered when a later new chat opens. While nothing is held here, a conversation binding whose
 * owner and agent have such a mark opens that slot first: the message is offered for review
 * ("may already have been sent"), never restored as a draft and never resent; sending stays
 * refused until it is reviewed. `open` is the slot to open instead of `key`. Once the review is
 * resolved, `moved` names the slot so its resolved text can follow the composer into the
 * conversation's own draft.
 */
async function firstSendReview(shell:Shell,key:string,signal:AbortSignal):Promise<{open?:string;moved?:string}>{
  let identity:unknown;try{identity=JSON.parse(key);}catch{return {};}
  if(!Array.isArray(identity)||identity.length!==4||typeof identity[3]!=='string'||!identity[3])return {};
  const slot=JSON.stringify([...identity.slice(0,3),null]),draft=shell.composerDraft;
  if(shell.firstSendReview===slot&&draft.binding===slot){
    if(draft.state.conflict||draft.state.opening)return {open:slot};
    shell.firstSendReview=undefined;return {moved:slot};
  }
  shell.firstSendReview=undefined;
  // Checked when the composer moves to this conversation, not on every connection update.
  if(draft.holding||draft.binding===key)return {};
  // An unreadable slot keeps its own recovery for when a new chat opens it.
  let saved;try{saved=await(await assistantDraftStore(slot)).read(signal);}catch{return {};}
  signal.throwIfAborted();
  if(saved?.sending!==true||draft.holding)return {};
  shell.firstSendReview=slot;return {open:slot};
}
/**
 * After a first-send review is resolved, the composer's text is saved in the conversation's slot
 * (by the binding that just opened). Only then is the same text cleared from the "no conversation
 * yet" slot, by compare-and-exchange, so a later new chat does not offer it again. Unconfirmed,
 * both copies stay: nothing is lost and nothing is sent.
 */
async function settleFirstSendSlot(slot:string,conversation:string,text:string,current:()=>boolean){
  if(!text)return;// Replaced with an empty composer: the review itself cleared the slot.
  try{
    const from=await assistantDraftStore(slot),to=await assistantDraftStore(conversation);
    for(const delay of [0,150,600,1500]){
      if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
      if(!current())return;
      if((await to.read())?.text!==text)continue;
      const saved=await from.read();
      if(!saved||saved.text!==text)return;
      if(saved.sending===true)continue;
      try{await from.save(saved,'');return;}catch{/* A newer write won; read it again. */}
    }
  }catch{/* Storage review stays with the slot's own recovery. */}
}
/**
 * A new chat's first message is held in the owner and agent's "no conversation yet" slot, and its
 * send creates and selects the conversation before it can be refused (for example a resident
 * stream refused by native IPC or HTTP 429). The shared controller then keeps the unsent text in
 * the slot it was held in and never puts it in the next binding's editor, because a different
 * binding may be another owner, agent or conversation. Here the next binding is the conversation
 * this send created for the same owner and agent, so the text is that conversation's draft: an
 * empty composer gets it back and saves it there, and only once the conversation holds it is the
 * "no conversation yet" copy cleared (compare-and-exchange), so a later new chat does not offer it.
 */
function createdFromSlot(slot:string,key:string){
  try{
    const from=JSON.parse(slot),to=JSON.parse(key);
    return Array.isArray(from)&&Array.isArray(to)&&from.length===4&&to.length===4&&from[3]===null&&typeof to[3]==='string'&&!!to[3]&&JSON.stringify(from.slice(0,3))===JSON.stringify(to.slice(0,3));
  }catch{return false;}
}
function releaseComposerSend(shell:Shell,heldKey:string|undefined,heldText:string){
  const draft=shell.composerDraft;draft.release();
  const key=draft.binding;
  if(!heldKey||!key||key===heldKey||!heldText.trim()||String(shell.S().draft||'').trim()||!createdFromSlot(heldKey,key))return;
  shell.setState((previous:Shell)=>draft.binding!==key||String(previous.draft||'').trim()?null:{draft:heldText},()=>{
    if(!shell.live||draft.binding!==key||String(shell.S().draft||'')!==heldText)return;
    draft.edit(heldText);
    void settleFirstSendSlot(heldKey,key,heldText,()=>shell.live&&draft.binding===key);
  });
}
const preDispatchRefusals=new Set(['Finish the connection or history operation before sending.','Wait for the current reply before sending another message.',NO_AGENT_SEND,RESIDENT_STARTING_NOTICE,RESIDENT_RECOVERING_NOTICE]);
// It also marks every failure that happened before it posted the message (`notDispatched`).
function isPreDispatchError(error:unknown){return !!error&&typeof error==='object'&&((error as {notDispatched?:unknown}).notDispatched===true||error instanceof Error&&(preDispatchRefusals.has(error.message)||(error as {code?:unknown}).code==='session_expired'));}
function dispatched(attempt:SendAttempt,error:unknown){return !(error instanceof NotDispatched)&&(attempt.streamed||attempt.transportCalled&&!attempt.preDispatch);}
/** Mark the in-flight composer send as handed to the transport, and classify early refusals. */
async function trackDispatch<T>(shell:Shell,run:()=>Promise<T>):Promise<T>{
  const attempt:SendAttempt|null=shell.sendAttempt??null;if(attempt)attempt.transportCalled=true;
  const task=run().catch(error=>{if(attempt&&isPreDispatchError(error))attempt.preDispatch=true;throw error;});
  // A cancellation can reject the client first; the classification waits for the transport's own result.
  if(attempt)attempt.settled=task.then(()=>undefined,()=>undefined);
  return task;
}
/** Settle the transport outcome (bounded) before deciding whether a failed send was dispatched. */
async function transportSettled(attempt:SendAttempt){
  if(!attempt.settled)return;
  await Promise.race([attempt.settled,new Promise(resolve=>setTimeout(resolve,5000))]);
}
function selectedCloudName():string {
  const snapshot=connectionController.getSnapshot();
  return cloudServiceName(connectionController.getCloudEnvironment()??snapshot.cloudAccount?.environment??snapshot.signIn?.environment??'production');
}
/** The action offered with the on-device agent's answer while Eliza Cloud AI is not connected. */
function planActionCard(action:unknown):Shell|undefined{
  if(action==='plan')return {type:'generic',icon:'info',title:'Redeem code or choose a plan',sub:`Opens ${selectedCloudName()} account & plan. Nothing is purchased automatically.`,planAction:'plan'};
  if(action==='sign-in')return {type:'generic',icon:'info',title:`Sign in with ${selectedCloudName()}`,sub:'Connects AI to your plan. Your agent keeps running on this phone.',planAction:'sign-in'};
  if(action==='retry')return {type:'generic',icon:'info',title:`Check ${selectedCloudName()} again`,sub:'AI replies return when Cloud is reachable.',planAction:'retry'};
  // Cloud declined a turn for billing: open the account's subscription controls.
  if(action==='funding')return {type:'generic',icon:'info',title:'Check subscription or enter a membership code',sub:`Opens your ${selectedCloudName()} subscription. Nothing is purchased automatically.`,planAction:'funding'};
  return undefined;
}
/** A saved row keeps its authoritative content and any richer card; only a missing final plan control is enriched. */
function enrichSettledAssistant(message:Shell,card:Shell|undefined,binding?:{conversationId:string;session:unknown}):Shell {
  if(!card||!['plan','retry','sign-in'].includes(card.planAction)||message.card!=null||message.from!=='agent'||!binding||message.messageBinding?.conversationId!==binding.conversationId||JSON.stringify(message.messageBinding?.session)!==JSON.stringify(binding.session))return message;
  return {...message,card};
}
/** Context notices for proposals that exist but are not reviewable on this screen. */
function replyNotices(reply:unknown):string[]{
  const notices=reply&&typeof reply==='object'?(reply as {notices?:unknown}).notices:undefined;
  return Array.isArray(notices)?notices.filter((n):n is string=>typeof n==='string'&&!!n.trim()&&n.length<=500).slice(0,5):[];
}
/** Decline one pending proposal without executing it. */
export async function declineProposal(id:string):Promise<{ok:boolean;message:string}>{
  if(connectionController.getSnapshot().busy)return {ok:false,message:'Wait for the current connection step, then decline again. Nothing was performed.'};
  try{await connectionController.rejectProposal(id);}
  catch(error){return {ok:false,message:error instanceof Error?error.message:'The proposal could not be declined.'};}
  const after=connectionController.getSnapshot();
  if(after.error)return {ok:false,message:after.error};
  return {ok:true,message:'Declined. No phone action was performed.'};
}
export function installAgentAdapter(Component: Shell, views: Shell) {
  const p = Component.prototype;
  let activeShell:Shell|null=null,notesRecovery:AbortController|null=null;
  function updateBackAvailability(shell:Shell) {
    const s=shell.S();
    document.documentElement.dataset.alphaCanGoBack = String(!!document.querySelector('dialog[open]') || connectionController.getSnapshot().open || !!s.view || s.shade || s.chat === 'sheet' || s.chat === 'full' || s.voice !== 'off');
  }
  const notesLeave=views.notes.onLeave;
  views.notes.onLeave=(...args:Shell[])=>{notesRecovery?.abort();return notesLeave?.(...args);};
  const originalMount = p.componentDidMount;
  const originalUpdate = p.componentDidUpdate;
  const originalUnmount = p.componentWillUnmount;
  const originalSet = p.vset;
  const originalApi = p.api;
  const originalVals = p.renderVals;
  const messageReviews=new BrowserReviews();
  const notesRender = views.notes.render;
  // Navigation resets transient view state, but must retain the actual storage receipt.
  views.notes.persist = [...new Set([...(views.notes.persist || []), 'storageStatus'])];

  function sizeComposer(){
    for(const input of document.querySelectorAll<HTMLTextAreaElement>('textarea[data-alpha-composer]')){
      input.style.height='44px';input.style.height=`${Math.max(44,input.scrollHeight)}px`;
    }
  }
  const notesDataset=(name:'notesStorageState'|'notesDraftState',value:string)=>{document.documentElement.dataset[name]=value;};
  /** Status for a Notes save that did not complete. `kept` reports a confirmed encrypted draft. */
  function failedNotesStatus(shell:Shell,kept:boolean){
    if(shell.notesStorageFull){notesDataset('notesStorageState','full');return kept?'Notes storage is full. Unsaved changes are kept in an encrypted draft on this device. Delete notes you no longer need or empty Trash.':'Notes storage is full. Delete notes you no longer need or empty Trash. Keep this screen open to preserve unsaved text.';}
    return kept?'Save unconfirmed. Unsaved changes are kept in an encrypted draft on this device; reopen Alpha to resume.':'Save unconfirmed. Keep this screen open to preserve unsaved text.';
  }
  /** Android: keep the attempted edits in the encrypted draft slot after a failed or uncertain commit. */
  function keepNotesDraft(shell:Shell,list:unknown,reason:NotesDraftReason){
    if(!isAndroid||!Array.isArray(list))return;
    let records:Shell[];try{records=JSON.parse(JSON.stringify(list));}catch{return;}
    const savedRaw=typeof shell.notesRaw==='string'?shell.notesRaw:'';
    shell.notesDraftTask=Promise.resolve(shell.notesDraftTask).then(async()=>{
      let saved:Shell[]=[];try{const parsed=JSON.parse(savedRaw).records;if(Array.isArray(parsed))saved=parsed;}catch{/* no saved collection */}
      shell.notesDraftSaved=await SecureNotesStore.saveDraft(secureConnectionStore,{savedRaw,reason,list:records,saved,own:shell.notesDraftSaved,kept:shell.notesDraftKept});
      notesDataset('notesDraftState','saved');
      if(shell.live&&shell.notesStorageFailed)originalSet.call(shell,'notes',{storageStatus:failedNotesStatus(shell,true)});
    }).catch(()=>{
      shell.notesDraftSaved=null;notesDataset('notesDraftState','failed');
      if(shell.live&&shell.notesStorageFailed)originalSet.call(shell,'notes',{storageStatus:failedNotesStatus(shell,false)});
    });
  }
  /** Android: after a clean open, finish a draft kept from an earlier failed or uncertain save. */
  async function resumeNotesDraft(shell:Shell,known?:NotesDraft){
    let draft:NotesDraft|null;
    try{draft=known??await SecureNotesStore.readDraft(secureConnectionStore);}
    catch{shell.notesDraftUnreadable=true;notesDataset('notesDraftState','unreadable');if(shell.live)originalSet.call(shell,'notes',{storageStatus:'An unsaved Notes draft could not be read. Open Notes recovery to download it.'});return;}
    shell.notesDraftDeferred=null;
    // Until it is cleared, a later failed save merges this draft instead of replacing it.
    shell.notesDraftKept=draft;
    if(!draft||!shell.live||!shell.notesStore||shell.notesStorageFailed||shell.notesPending)return;
    const current=shell.notesStore.list,next=applyNotesDraft(current,draft),conflicts=notesDraftConflicts(current,draft);
    // A note edited again since the draft was kept keeps its newer saved text; the draft stays
    // encrypted on this device instead of overwriting it.
    const conflicted=()=>{
      shell.notesDraftConflict=true;notesDataset('notesDraftState','conflict');
      if(shell.live){originalSet.call(shell,'notes',{storageStatus:'Some unsaved changes from an earlier session conflict with newer edits. Your newer notes were kept. Open Notes recovery to download the older changes.'});context(shell);}
    };
    // An uncertain commit that did complete leaves nothing to apply.
    if(JSON.stringify(next)===JSON.stringify(current)){
      if(conflicts.length){conflicted();return;}
      if(await SecureNotesStore.clearDraft(secureConnectionStore,draft).catch(()=>false))shell.notesDraftKept=null;
      notesDataset('notesDraftState','none');return;
    }
    // Retrying a full collection before anything was freed would fail again and lock editing.
    if(draft.reason==='storage-full'&&draft.base===await notesDraftBase(shell.notesStore.raw)){
      shell.notesDraftDeferred=draft;notesDataset('notesDraftState','deferred');
      originalSet.call(shell,'notes',{storageStatus:'Notes storage was full, so recent changes are kept in an encrypted draft. Delete notes you no longer need or empty Trash; Alpha saves the draft after your next saved change.'});return;
    }
    notesDataset('notesDraftState','resuming');
    if(await shell.vset('notes',{list:next},{exact:true})!==true)return;// A new draft was kept by the failed save.
    if(conflicts.length){conflicted();if(shell.live)shell.toast('Recovered some unsaved Notes changes. Others conflict with newer edits.');return;}
    if(await SecureNotesStore.clearDraft(secureConnectionStore,draft).catch(()=>false))shell.notesDraftKept=null;
    notesDataset('notesDraftState','resumed');
    if(shell.live){originalSet.call(shell,'notes',{storageStatus:'Recovered unsaved changes from your last session and saved them on this device.'});shell.toast('Recovered unsaved Notes changes.');}
  }
  /** Android Notes recovery: export saved Notes with the draft; reset clears only what is broken. */
  function openNativeNotesRecovery(shell:Shell,signal:AbortSignal){
    const collection=!!shell.notesOpenFailed,captures=new WeakMap<object,{saved:string|null;draft:string|null}>();
    openDomainRecovery({
      async capture(abort?:AbortSignal){
        abort?.throwIfAborted();
        // A failed native read never produces reset authority.
        const saved=await secureConnectionStore.readRaw(SECURE_NOTES_SLOT),draft=await secureConnectionStore.readRaw(SECURE_NOTES_DRAFT_SLOT);abort?.throwIfAborted();
        const raw=JSON.stringify({saved,draft,editor:shell.vget('notes').list}),snapshot={revision:crypto.randomUUID(),raw};captures.set(snapshot,{saved,draft});
        return {snapshot,raw,legacy:null,format:'domain' as const,legacyChanged:false};
      },
      async reset(expected,abort?:AbortSignal){
        abort?.throwIfAborted();const snapshot=expected.snapshot,captured=snapshot&&captures.get(snapshot);
        if(!captured)throw Error('Read the saved Notes again before resetting.');
        const [slot,value]=collection?[SECURE_NOTES_SLOT,captured.saved]:[SECURE_NOTES_DRAFT_SLOT,captured.draft];
        if(value===null)throw Error(collection?'No saved Notes collection to reset.':'No unsaved Notes draft to clear.');
        if((await secureConnectionStore.compareExchangeRaw(slot,value,null)).status!=='saved')throw Error('Saved Notes changed. Close recovery and review again.');
        captures.delete(snapshot!);
        // A cleared draft is no longer kept, merged or offered for recovery.
        if(!collection){shell.notesDraftKept=null;shell.notesDraftSaved=null;shell.notesDraftDeferred=null;shell.notesDraftConflict=false;shell.notesDraftUnreadable=false;notesDataset('notesDraftState','none');}
      },
    },collection?'Notes':'Notes draft',collection?'Notes recovery':'Unsaved Notes recovery',collection
      ?'Download the encrypted Notes collection and any unsaved draft before resetting. Reset clears only the damaged Notes collection on this device so Notes can open again; the unsaved draft, recordings and Trash are kept.'
      :'Download your saved notes together with the unsaved draft. Clearing the draft does not change saved notes. To resume instead, free space by deleting notes or emptying Trash, then reopen Alpha.',signal,undefined,'device');
  }
  function retainReadReply(shell:Shell,proposal:import('../runtime/alpha-client').ActionProposal,identity?:{conversationId:string;session:unknown},userMessageId?:string){
    const read=proposal.readReply;if(!read||shell.readReplyLeases?.has(proposal.id))return;
    const origin=read.origin;
    const original=identity&&userMessageId===origin.inReplyTo&&identity.conversationId===origin.conversationId||shell.S().msgs.some((message:Shell)=>message.id===origin.inReplyTo&&message.from==='user'&&message.messageBinding?.conversationId===origin.conversationId&&JSON.stringify(message.messageBinding.session)===JSON.stringify(connectionController.getSnapshot().session));
    if(!original)return;
    try{const binding=connectionController.readReplyBinding(origin.conversationId,proposal.id,read.digest);shell.readReplyLeases??=new Map();shell.readReplyLeases.set(proposal.id,{origin:structuredClone(origin),digest:read.digest,binding,controller:new AbortController(),phase:'pending'});}catch{}
  }
  function proposalCard(proposal:import('../runtime/alpha-client').ActionProposal){
    const home=proposal.reviewDestination==='home',notes=proposal.reviewDestination==='notes',calendar=proposal.reviewDestination==='calendar';
    return {type:'generic',icon:'check',title:home?'Review Notes on Home':notes?'Review note':calendar?'Choose event in Calendar':proposal.title,sub:home?'Open Home to choose and review a note. Nothing is shared yet.':notes?'Open the matching note to review this request. Nothing changes until you approve it.':calendar?'Choose the matching event, then review what to share. Nothing changes yet.':proposal.description,proposalId:proposal.id,privateNotesRead:proposal.privateNotesRead,reviewDestination:proposal.reviewDestination,reviewNoteTarget:proposal.reviewNoteTarget,expiresAt:proposal.expiresAt};
  }
  p.cancelReadReplyCompletions=function(onlyProposalId?:string){
    for(const [proposalId,lease] of this.readReplyLeases||[]){
      if(onlyProposalId!==undefined&&proposalId!==onlyProposalId)continue;
      if(this.pendingActionApprovalProposalId===proposalId)this.pendingActionApproval?.abort();
      if(lease.phase==='cancelled'||lease.phase==='done')continue;
      lease.phase='cancelled';lease.controller.abort();
      void connectionController.cancelReadReply(lease.binding).catch(()=>{});
    }
  };
  async function completeReadReply(shell:Shell,receipt:import('../runtime/alpha-client').OperationReceipt){
    const hint=receipt.readReply,lease=hint&&shell.readReplyLeases?.get(hint.proposalId);
    if(!hint||!lease||lease.phase!=='pending')return false;
    const current=()=>{lease.controller.signal.throwIfAborted();if(!shell.live||document.hidden||alphaClient.getState().context.sensitive||!connectionController.readReplyCurrent(lease.binding)||hint.digest!==lease.digest||JSON.stringify({version:hint.version,requestId:hint.requestId,conversationId:hint.conversationId,inReplyTo:hint.inReplyTo})!==JSON.stringify(lease.origin)||!shell.S().msgs.some((m:Shell)=>m.id===hint.inReplyTo&&m.from==='user'&&m.messageBinding?.conversationId===hint.conversationId&&JSON.stringify(m.messageBinding.session)===JSON.stringify(lease.binding.session)))throw Error('The original Notes conversation changed.');};
    current();lease.phase='completing';
    try{
      const reply=await connectionController.completeReadReply(hint,lease.binding,lease.controller.signal);current();
      await new Promise<void>(resolve=>shell.setState((previous:Shell)=>{
        try{current();}catch{return null;}
        if(previous.msgs.some((m:Shell)=>m.id===reply.messageId))return null;
        return {msgs:[...previous.msgs,{id:reply.messageId,from:'agent',text:reply.text,messageBinding:{conversationId:reply.conversationId,session:lease.binding.session},inReplyTo:reply.inReplyTo,card:null}]};
      },resolve));current();lease.phase='done';
      if(reply.continuation){shell.pendingActionRecoveryKey=null;shell.pendingActionRecoveryFailedKey=null;recoverPendingActions(shell);}
      shell.resumeReadReplyVoice?.(hint,reply);return true;
    }catch(error){
      if(lease.phase!=='cancelled')lease.phase='unconfirmed';
      throw error;
    }
  }
  function recoverPendingActions(shell:Shell) {
    const connection=connectionController.getSnapshot(),currentContext=alphaClient.getState().context;
    if(shell.pendingActionApproval&&(document.hidden||currentContext.sensitive||connection.open||JSON.stringify(shell.pendingActionApprovalContext)!==JSON.stringify(currentContext)||JSON.stringify(shell.pendingActionApprovalSession)!==JSON.stringify(connection.session)))shell.pendingActionApproval.abort();
    const blocked=currentContext.view==='workflows'||!shell.live||!connection.session||!connection.phoneActionsAvailable||connection.open||connection.busy||document.hidden||currentContext.sensitive||shell.S().typing||shell.pendingActionApproval;
    const key=blocked?null:JSON.stringify([connection.session,connection.history?.revision,currentContext]);
    if(!key)shell.pendingActionRecoveryFailedKey=null;
    if(shell.pendingActionRecoveryKey===key||key!==null&&shell.pendingActionRecoveryFailedKey===key)return;
    shell.pendingActionRecoveryFailedKey=null;shell.pendingActionRecoveryKey=key;shell.pendingActionRecoveryAbort?.abort();
    clearTimeout(shell.pendingActionExpiryTimer);shell.pendingActionExpiryTimer=null;
    if(!key)return;
    const controller=shell.pendingActionRecoveryAbort=new AbortController();
    const bound=()=>shell.live&&!controller.signal.aborted&&JSON.stringify(connectionController.getSnapshot().session)===JSON.stringify(connection.session)&&connectionController.getSnapshot().history?.revision===connection.history?.revision&&JSON.stringify(alphaClient.getState().context)===JSON.stringify(currentContext)&&!document.hidden&&!connectionController.getSnapshot().open&&!connectionController.getSnapshot().busy;
    const current=()=>bound()&&shell.pendingActionRecoveryKey===key;
    const scheduleExpiry=()=>{
      clearTimeout(shell.pendingActionExpiryTimer);shell.pendingActionExpiryTimer=null;
      if(!bound())return;
      const nearest=Math.min(...shell.S().msgs.filter((message:Shell)=>message.card?.proposalId&&!message.card.done&&!message.card.reviewUnavailable&&Number.isFinite(message.card.expiresAt)).map((message:Shell)=>message.card.expiresAt));
      if(!Number.isFinite(nearest))return;
      shell.pendingActionExpiryTimer=setTimeout(()=>{
        shell.pendingActionExpiryTimer=null;
        if(!bound())return;
        shell.setState((previous:Shell)=>{
          if(!bound())return null;
          return {msgs:previous.msgs.map((message:Shell)=>message.card?.proposalId&&!message.card.done&&!message.card.reviewUnavailable&&message.card.expiresAt<=Date.now()?{...message,card:{...message.card,reviewUnavailable:true,title:'Review expired',sub:'This review has expired. Request a new action if still needed.'}}:message)};
        },()=>{
          if(!bound())return;
          // A failed read cannot erase known expiries or start retry polling.
          if(shell.pendingActionRecoveryFailedKey===key)scheduleExpiry();
          else{shell.pendingActionRecoveryKey=null;recoverPendingActions(shell);}
        });
      },Math.min(2147483647,Math.max(0,Math.ceil(nearest-Date.now())+1)));
    };
    void connectionController.pendingActions(currentContext,controller.signal).then(proposals=>{
      if(!current())return;
      for(const proposal of proposals)if(proposal.readReply)retainReadReply(shell,proposal);
      shell.setState((previous:Shell)=>{
        if(!current())return null;
        const pending=new Map(proposals.map(proposal=>[proposal.id,proposal]));
        const msgs=previous.msgs.map((message:Shell)=>{
          const card=message.card;
          if(!card?.proposalId||card.done)return message;
          const proposal=pending.get(card.proposalId);
          if(proposal){
            if(card.recovered&&!card.reviewUnavailable&&card.expiresAt===proposal.expiresAt&&card.privateNotesRead===proposal.privateNotesRead&&card.reviewDestination===proposal.reviewDestination&&JSON.stringify(card.reviewNoteTarget)===JSON.stringify(proposal.reviewNoteTarget)&&JSON.stringify(card.proposalSession)===JSON.stringify(connection.session))return message;
            return {...message,card:{...card,...proposalCard(proposal),recovered:true,proposalSession:connection.session,reviewUnavailable:false}};
          }
          // Absence can also mean different source preconditions. It proves no
          // rejection or execution; preserve the history and disable only review.
          if(card.reviewUnavailable)return message;
          return {...message,card:{...card,reviewUnavailable:true,title:'Review unavailable',sub:'Not pending for this screen. Open the original selection to check again.'}};
        });
        const existing=new Set(msgs.map((message:Shell)=>message.card?.proposalId));
        const recovered=proposals.filter(proposal=>!existing.has(proposal.id)).map(proposal=>({id:crypto.randomUUID(),from:'agent',text:proposal.description,card:{...proposalCard(proposal),recovered:true,proposalSession:connection.session}}));
        return recovered.length||msgs.some((message:Shell,index:number)=>message!==previous.msgs[index])?{msgs:[...msgs,...recovered]}:null;
      },()=>{if(current())scheduleExpiry();});
    }).catch(()=>{
      if(!current())return;
      shell.pendingActionRecoveryKey=null;shell.pendingActionRecoveryFailedKey=key;
      // Background refresh stays quiet. Preserve the failed binding and known
      // expiry; returning/reopening retries through the existing scoped lifecycle.
      scheduleExpiry();
    });
  }
  /** The stopped-reply state is shown in the chat it describes, not only in Agent connection. One
   * bubble follows the controller's notice; it never sends, and a finished reply replaces it. */
  function syncStoppedReplyNotice(shell:Shell,history:unknown){
    const snapshot=connectionController.getSnapshot(),notice=snapshot.replyNotice||'',before=shell.stoppedReplyNotice||'';
    const replaced=shell.stoppedReplyHistory!==history||shell.stoppedReplySession!==snapshot.session?.sessionId;
    shell.stoppedReplyHistory=history;shell.stoppedReplySession=snapshot.session?.sessionId;
    if(notice===before)return;
    shell.stoppedReplyNotice=notice;
    if(!shell.live)return;
    const pending=notice===STOPPED_REPLY_NOTICE||notice===STOPPED_CANCELLED_NOTICE,sessionId=snapshot.session?.sessionId;
    // Without a notice: a restored conversation already shows the outcome; otherwise say why the check ended.
    const text=notice||(replaced?'':snapshot.message===STOPPED_CONFIRMED_NOTICE?STOPPED_CONFIRMED_NOTICE:'The stopped reply was not checked because another message was sent. Load this conversation from Agent connection to see whether it finished.');
    // A check that already reported its result keeps that statement (and its offer) when a later send clears the notice.
    const reported=!notice&&!replaced&&!!before&&before!==STOPPED_REPLY_NOTICE&&before!==STOPPED_CANCELLED_NOTICE;
    shell.setState((previous:Shell)=>{
      const msgs=previous.msgs||[],at=msgs.findIndex((message:Shell)=>message.stoppedReplyNotice);
      if(reported)return at<0?null:{msgs:msgs.map((message:Shell,index:number)=>index===at?{...message,id:crypto.randomUUID(),stoppedReplyNotice:undefined}:message)};
      if(!text)return at<0?null:{msgs:msgs.filter((message:Shell)=>!message.stoppedReplyNotice)};
      const bubble={id:notice?'stopped-reply-notice':crypto.randomUUID(),from:'agent',text,interrupted:true,...(notice?{stoppedReplyNotice:true}:{}),
        card:null};
      // The bubble keeps its place in the transcript, directly after the stopped turn.
      return {msgs:at<0?[...msgs,bubble]:msgs.map((message:Shell,index:number)=>index===at?bubble:message)};
    });
  }
  function openInternalView(shell:Shell,target:string,chat?:string):boolean {
    const view=alphaViewKey(target);
    if(!view||view!=='home'&&!views[view])return false;
    if(view==='home')shell.goHome(chat);else shell.openView(view,undefined,chat);
    return true;
  }
  async function deliverChatNavigation(shell:Shell,navigation:ReturnType<typeof connectionController.captureViewNavigation>,results:readonly unknown[]|undefined,current?:()=>void,continuation?:import('../runtime/alpha-client').VoiceNavigationContinuation){
    if(!navigation||!results?.length)return false;
    const attempt={...navigation.attempt,current:()=>{navigation.attempt.current();current?.();}};
    const delivered=await navigation.client.deliver(results,attempt,(view,check)=>{
      const commit=(chat?:string,onCommitted?:(value:import('../runtime/alpha-client').ContextEnvelope)=>void)=>new Promise<boolean>((resolve,reject)=>{
        try{check();if(!openInternalView(shell,view,chat)){resolve(false);return;}shell.setState({},()=>{try{context(shell);const switched=shell.live&&(shell.S().view||'home')===view;if(switched)onCommitted?.(alphaClient.getState().context);resolve(switched);}catch(error){reject(error);}});}catch(error){reject(error);}
      });
      // Keep an open conversation at its current detent during typed navigation.
      // Read at delivery time so closing it while a reply is pending stays respected.
      const chat=shell.S().chat;
      return continuation?continuation.apply(view,check,commit):commit(chat==='sheet'||chat==='full'?chat:undefined);
    });
    if(delivered.status==='unknown')shell.toast('Could not confirm the screen change. Check your screen.');
    return delivered.status==='delivered';
  }
  function canonicalNotesKey(port:ReturnType<typeof connectionController.getAppRecordClient>):string|null {
    return port?JSON.stringify([port.sessionId,port.scope??null,port.identity.ownerId,port.identity.agentId,port.identity.sessionId,port.identity.origin]):null;
  }
  function syncCanonicalNotes(shell:Shell):void {
    if(!shell.live||shell.notesSourceMode==='legacy')return;
    const port=connectionController.getAppRecordClient(),key=canonicalNotesKey(port);
    if(shell.canonicalNotesKey===key&&(key===null||shell.canonicalNotesUi?.current))return;
    const previous=shell.canonicalNotesUi;shell.canonicalNotesUi=null;shell.canonicalNotesKey=key;previous?.retire();
    shell.notesSelectionKey=null;shell.notesSelection=null;shell.notesStorageFailed=true;shell.notesPending=0;
    if(!port){shell.notesReady=Promise.resolve();originalSet.call(shell,'notes',{list:[],open:null,trash:[],trashOpen:false,storageStatus:agentAvailabilityNotice(undefined,'Notes is unavailable for this agent connection. Check Settings › Agent connection.')});return;}
    let binding:CanonicalNotesUi;
    const paint=()=>{if(shell.live&&shell.canonicalNotesUi===binding)shell.setState({},()=>context(shell));};
    binding=new CanonicalNotesUi(port,{paint,review:paint,committed:()=>paint()});
    shell.canonicalNotesUi=binding;
    shell.notesReady=binding.refresh().catch(()=>{if(shell.canonicalNotesUi===binding)paint();});
  }
  async function previousNotesObservation(store:Shell,current:()=>boolean):Promise<Shell>{
    const first=store.list[0],target=first?await store.target(first.id):null;
    if(!current())throw new DOMException('Notes source changed.','AbortError');
    if(target)return {kind:'note-source',id:target.sourceId,revision:target.sourceRevision,accountId:target.sourceId,sourceRevision:target.sourceRevision};
    // A viewport namespace/fingerprint, never a made-up native source identity.
    const revision=await notesDraftBase(store.raw);if(!current())throw new DOMException('Notes source changed.','AbortError');
    return {kind:'legacy-app-notes-source',id:'previous-notes',accountId:'device-local-legacy',revision};
  }
  async function selectNotesSource(shell:Shell,source:'canonical'|'legacy'):Promise<boolean>{
    if(!shell.live||source===shell.notesSourceMode)return true;
    if(shell.notesSourceMode==='legacy'&&shell.vget('notes').rec){shell.toast('Finish the recording before switching notes.');return false;}
    if(shell.notesPending||shell.canonicalNotesUi?.pending||shell.canonicalNotesUi?.dirty){shell.toast('Finish or review the current note before switching.');return false;}
    shell.cancelReadReplyCompletions?.();shell.notesOpenAbort?.abort();shell.notesOpenAbort=new AbortController();
    const previous=shell.canonicalNotesUi;shell.canonicalNotesUi=null;shell.canonicalNotesKey=null;previous?.retire();
    shell.notesLegacySource=null;shell.notesSourceMode=source;shell.notesSourceEpoch=(shell.notesSourceEpoch??0)+1;shell.notesSelectionKey=null;shell.notesSelection=null;
    originalSet.call(shell,'notes',{list:[],open:null,q:null,trashOpen:false,trashChecked:false,storageStatus:'Opening Notes…'});
    if(source==='canonical'){syncCanonicalNotes(shell);context(shell);return true;}
    const epoch=shell.notesSourceEpoch,signal=shell.notesOpenAbort.signal,current=()=>shell.live&&shell.notesSourceMode==='legacy'&&shell.notesSourceEpoch===epoch;
    shell.notesStorageFailed=true;shell.notesPending=0;
    shell.notesReady=(async()=>{
      const store=isAndroid?await openExistingDeviceNotes(secureConnectionStore,localStorage,signal,current):await openExistingBrowserNotes(browserNotesPort,signal,current);
      if(!current())return;const observation=await previousNotesObservation(store,current);if(!current())return;shell.notesStore=store;shell.notesRaw=store.raw;shell.notesLegacySource=observation;shell.notesStorageFailed=false;
      originalSet.call(shell,'notes',{list:store.list,storageStatus:isAndroid?'Note text encrypted on this device':''});context(shell);
      // Existing unsaved device drafts remain in their original slot. Recovery
      // stays an explicit existing action; source selection never applies them.
    })().catch(()=>{if(current()){shell.notesStorageFailed=true;originalSet.call(shell,'notes',{list:[],storageStatus:'Previous notes need a recovery review. Nothing was moved or changed.'});context(shell);}});
    await shell.notesReady;return !shell.notesStorageFailed;
  }
  function context(shell: Shell) {
    const s = shell.S();
    const view = s.view || 'home';
    document.documentElement.dataset.activeView = view;
    const notes = view === 'notes' ? shell.vget('notes') : null;
    const selected = notes?.list?.find((note: Shell) => note.id === notes.open)?.id;
    const selectedRecord=notes?.list?.find((note:Shell)=>note.id===selected);
    const selectedKey=shell.notesSourceMode==='canonical'?null:selectedRecord?JSON.stringify(selectedRecord):null;
    if(shell.notesSourceMode==='canonical'){shell.notesSelectionKey=null;shell.notesSelection=view==='notes'?shell.canonicalNotesUi?.selection()??null:null;}
    else if(shell.notesSelectionKey!==selectedKey||(selected&&!shell.notesSelection&&!shell.notesPending&&!shell.notesStorageFailed)){
      shell.notesSelectionKey=selectedKey;shell.notesSelection=null;
      if(selected&&shell.notesStore&&!shell.notesStorageFailed&&!shell.notesPending)void shell.notesStore.target(String(selected)).then((target:Shell)=>{
        if(shell.live&&shell.notesSourceMode==='legacy'&&!shell.notesPending&&!shell.notesStorageFailed&&shell.notesSelectionKey===selectedKey){shell.notesSelection={kind:'note',id:target.noteId,revision:target.revision,accountId:target.sourceId,sourceRevision:target.sourceRevision};context(shell);}
      }).catch(()=>{});
    }

    const previousNotesScope=view==='notes'&&shell.notesSourceMode==='legacy'?(shell.notesLegacySource??{kind:'legacy-app-notes-source',id:'previous-notes',accountId:'device-local-legacy'}):undefined;
    let providerSelection = view === 'browser' ? shell.browserSelection?.() : undefined;
    if (view === 'workflows') providerSelection = shell.workflowSelection?.();
    if (view === 'maps') providerSelection = getMapsSelectedObject();
    if (view === 'photos') {
      const state = shell.vget('photos');
      if (state.open === state.nativePhotoSelection?.id) providerSelection = state.nativePhotoSelection;
      // Device library: exactly one owner-selected item, by identity and a local revision only.
      else if (state.album === 'device' && !state.open && state.nativeLibrarySelection) providerSelection = state.nativeLibrarySelection;
    }
    if (view === 'inbox') {
      const state = shell.vget('inbox');
      if (state.open === state.nativeMailSelection?.id) providerSelection = state.nativeMailSelection;
    }
    if(view==='messages')providerSelection=shell.smsSelection?.();
    if(view==='calendar')providerSelection=shell.calendarSelection?.();
    if (view === 'contacts' || view==='calendar'&&!providerSelection) {
      const state = shell.vget(view);
      const record = (view === 'calendar' ? state.events : state.list)?.find((row: Shell) => row.id === state.open);
      // Only native-backed rows have authority; fixture records never become
      // agent targets. Content stays local; only identity/revision is sent.
      if (record && (view === 'contacts' || record.alphaReminderId)) {
        const id = String(record.alphaCalendarId || record.alphaReminderId || record.id), key = `${view}:${id}`;
        shell.entityRevisions ||= new Map();
        const signature = JSON.stringify(record), previous = shell.entityRevisions.get(key);
        const revision = previous?.signature === signature ? previous.revision : (previous?.revision || 0) + 1;
        shell.entityRevisions.set(key, { signature, revision });
        providerSelection = { kind: view === 'contacts' ? 'contact' : record.alphaCalendarId ? 'calendar-event' : 'reminder', id, revision: String(revision) };
        if(record.alphaReminderId){const target=shell.reminderTargets?.get(id);providerSelection=target?{kind:'reminder',id:target.reminderId,revision:target.revision,accountId:target.sourceId,sourceRevision:target.sourceRevision,occurrenceId:target.occurrenceId,...(target.timingVersion===2?{timingVersion:2}: {})}:undefined;}
      }
    }
    if(view==='calendar'&&shell.clockSelection?.())providerSelection=shell.clockSelection();
    // Folder, notification and settings selections are published by the views that own them.
    if(view==='files'&&!providerSelection&&shell.vget('files').open!=='__native_selected_document'&&shell.folderSelection?.())providerSelection=shell.folderSelection();
    if(view==='settings'&&!providerSelection&&shell.settingsSelection?.())providerSelection=shell.settingsSelection();
    if(s.shade&&shell.notificationSelection?.())providerSelection=shell.notificationSelection();
    // The owning Calendar hook checks readiness/privacy; a chat overlay does not replace its underlying view.
    const calendarDay=view==='calendar'?shell.calendarDayObservation?.():undefined;
    alphaClient.setViewContext({
      timeZone:currentClockTimeZone(),
      ...(calendarDay?{calendarDay}:{}),
      view: (view === 'wallet' ? 'passwords' : view) as AlphaView,
      // Suspension invalidates this turn and approvals, but retains the account
      // and conversation. Visibility is not a claim about Android lock state.
      // Password manager pages pause observation entirely: no view, selection or revision.
      sensitive: view === 'wallet' || (view === 'settings' && passwordSurfaceOpen(shell.vget('settings'))) || s.secure === true || s.screen === 'lock' || s.screen === 'off' || document.hidden || shell.pageSuspended === true || connectionController.getSnapshot().open,
      ...(view==='notes'&&shell.notesSelection ? { selectedObject: shell.notesSelection } : previousNotesScope ? { selectedObject:previousNotesScope } : providerSelection ? { selectedObject: providerSelection } : ['files','photos'].includes(view) && shell.vget(view).open === '__native_selected_document' && shell.selectedContext ? { selectedObject: shell.selectedContext } : {}),
    });
    if(alphaClient.getState().context.sensitive||[...(shell.readReplyLeases?.values()||[])].some((lease:any)=>lease.phase!=='cancelled'&&lease.phase!=='done'&&!connectionController.readReplyCurrent(lease.binding)))shell.cancelReadReplyCompletions?.();
    updateBackAvailability(shell);
    recoverPendingActions(shell);
  }
  p.componentDidMount = function () {
    activeShell=this;this.notesSourceMode='canonical';this.notesSourceEpoch=0;this.notesStorageFailed=true;this.notesReady=Promise.resolve();this.notesOpenAbort=new AbortController();
    originalMount.call(this);
    this.live = true;
    // An open shade never keeps a switch state Android may have changed while the owner was away.
    this.stopTileWatch = watchReturnToApp(() => { if (this.live && this.S().shade) this.refreshTileFacts(); });
    this.dialogBackObserver = new MutationObserver(() => updateBackAvailability(this));
    this.dialogBackObserver.observe(document.body, {subtree:true, childList:true, attributes:true, attributeFilter:['open']});
    this.composerDraft=new AssistantDraftController(assistantDraftStore,()=>String(this.S().draft||''),(text,expected,current)=>new Promise<void>(resolve=>{if(!this.live||current&&!current()){resolve();return;}this.setState((previous:Shell)=>{if(current&&!current()||expected!==undefined&&String(previous.draft||'')!==expected)return null;if(this.startupDraft!==null)this.startupDraft=undefined;this.reviewedSourceDraft=null;return {draft:text};},resolve);}),()=>{if(this.live)this.setState({});});
    this.refreshDraftBinding=()=>{this.draftBindingAbort?.abort();if(residentAlwaysPresent&&!connectionController.getSnapshot().session){this.draftBindingTask=Promise.resolve();return;}const controller=this.draftBindingAbort=new AbortController();this.draftBindingTask=connectionController.assistantDraftBinding(controller.signal).then(async key=>{if(!this.live||controller.signal.aborted)return;const review=await firstSendReview(this,key,controller.signal);if(!this.live||controller.signal.aborted)return;await this.composerDraft.open(review.open??key);if(review.moved&&this.composerDraft.binding===key)void settleFirstSendSlot(review.moved,key,String(this.S().draft||''),()=>this.live&&this.composerDraft.binding===key);}).catch(()=>{if(this.live&&!controller.signal.aborted)this.composerDraft.unavailable();});};
    this.refreshDraftBinding();
    this.connectionSession = connectionController.getSnapshot().session?.sessionId;
    // Only fresh typing before the first verified session can cross startup admission.
    this.startupDraft=this.connectionSession?null:undefined;
    this.connectionUnsubscribe = connectionController.subscribe(() => {
      const connection=connectionController.getSnapshot(),session=connection.session?.sessionId;
      if (session !== this.connectionSession) {
        const preserveStartupDraft=!this.connectionSession&&!!session&&!connection.startupResolved&&typeof this.startupDraft==='string'&&this.startupDraft===String(this.S().draft||'');
        this.startupDraft=null;
        cancelMessageContext(this);
        this.draftRecoveryAbort?.abort();this.composerDraft.retire();
        this.closeSummaryReview?.();this.reviewedSourceDraft=null;
        clearMapsSelection();
        this.connectionSession = session;
        alphaClient.disconnect();
        if (this.live) this.setState({ msgs: [], ...(preserveStartupDraft?{}:{draft:''}), typing: false });
      }
      const history = connectionController.getSnapshot().history;
      if (history && history.sessionId === session && this.restoredHistory !== history) {
        if(!history.automatic){cancelMessageContext(this);this.draftRecoveryAbort?.abort();this.composerDraft.retire();this.reviewedSourceDraft=null;}
        this.restoredHistory = history;
        alphaClient.disconnect();
        if (this.live) this.setState((previous:Shell)=>{
          if(!this.live||connectionController.getSnapshot().history!==history)return null;
          const messages=history.messages.map(message => ({ ...message, messageBinding:message.deviceReceipt?undefined:{conversationId:history.conversationId,session:connectionController.getSnapshot().session}, card:null }));
          const newer=history.deliveryRevisionAtStart===undefined?[]:previous.msgs.filter((message:any)=>typeof message.conversationDeliveryRevision==='number'&&(history.automatic||message.conversationDeliveryRevision>history.deliveryRevisionAtStart!)&&message.messageBinding?.conversationId===history.conversationId);
          return {msgs:mergeConversationDelivery(messages,newer),typing:false,...(history.automatic?{}:{draft:'',chat:'full'})};
        });
      }
      const delivery=connectionController.getSnapshot().conversationDelivery;
      if(delivery&&delivery.sessionId===session&&delivery.conversationId===connectionController.getSelectedConversationId()&&this.lastConversationDelivery!==delivery){
        this.lastConversationDelivery=delivery;
        const currentSession=connectionController.getSnapshot().session;
        if(this.live)this.setState((previous:Shell)=>{
          if(!this.live||connectionController.getSnapshot().session!==currentSession||connectionController.getSelectedConversationId()!==delivery.conversationId)return null;
          const messages=delivery.messages.map(message=>({...message,messageBinding:message.deviceReceipt?undefined:{conversationId:delivery.conversationId,session:currentSession},conversationDeliveryRevision:delivery.revision,card:null}));
          const msgs=mergeConversationDelivery(previous.msgs,messages);return msgs===previous.msgs?null:{msgs};
        });
      }
      syncStoppedReplyNotice(this,session!==undefined&&history?.sessionId===session?history:null);
      const offline=!!connectionController.getSnapshot().inferenceOffline;
      if(offline!==!!this.inferenceOffline){this.inferenceOffline=offline;if(this.live)this.setState({});}
      if (this.live) {syncCanonicalNotes(this);context(this);this.refreshDraftBinding();}
    });
    // Canonical is the default; no legacy store/migration/cleanup is opened.
    syncCanonicalNotes(this);
    this.notesCommittedHandler=()=>{
      if(this.notesSourceMode!=='legacy')return;
      const store=this.notesStore,epoch=this.notesSourceEpoch,current=()=>this.live&&this.notesSourceMode==='legacy'&&this.notesSourceEpoch===epoch&&this.notesStore===store;
      if(store&&!this.notesPending&&!this.notesStorageFailed)void previousNotesObservation(store,current).then(value=>{if(current()){this.notesLegacySource=value;context(this);}}).catch(()=>{});
      if(!this.live||!this.notesStore||this.notesStorageFailed||this.notesPending||this.notesStore.needsRecovery)return;
      const update=reconcileNotesEditor(this.notesRaw,this.vget('notes').list,this.notesStore.raw,this.notesStore.list);
      if(update.kind==='unchanged')return;
      if(update.kind==='conflict'){
        originalSet.call(this,'notes',{storageStatus:'A newer saved note is available. Your unsaved text is still here.'});return;
      }
      this.notesRaw=this.notesStore.raw;
      originalSet.call(this,'notes',{...(update.list?{list:update.list}:{}),storageStatus:isAndroid?'Note text encrypted on this device':''});context(this);
    };
    window.addEventListener('alpha:notes-committed',this.notesCommittedHandler);
    this.visibilityHandler = () => { if(document.hidden)connectionController.cancelViewNavigation();else connectionController.warmInference();if (this.live) {if(!document.hidden&&this.notesSourceMode==='canonical'&&this.S().view==='notes')void this.canonicalNotesUi?.refresh().catch(()=>{});context(this);} };
    this.pageHideHandler = () => { notesRecovery?.abort();this.pageSuspended = true; if (this.live) context(this); };
    this.pageShowHandler = () => { this.pageSuspended = false; if (this.live) context(this); };
    document.addEventListener('visibilitychange', this.visibilityHandler);
    window.addEventListener('pagehide', this.pageHideHandler);
    window.addEventListener('pageshow', this.pageShowHandler);
    this.backHandler = (event: Event) => {
      // Native Back closes a menu first. A dialog toast is a live region, not a navigation layer.
      const popover = typeof HTMLElement.prototype.hidePopover === 'function' ? Array.from(document.querySelectorAll<HTMLElement>('[popover]:popover-open:not([data-alpha-dialog-toast])')).at(-1) : undefined;
      if (popover) { event.preventDefault(); event.stopImmediatePropagation(); popover.hidePopover(); Array.from(document.querySelectorAll<HTMLElement>('[popovertarget]')).find(trigger=>trigger.getAttribute('popovertarget')===popover.id&&trigger.getAttribute('popovertargetaction')!=='hide')?.focus(); return; }
      // A modal owns Back while the underlying phone is inert. Window-targeted
      // native events must not navigate the shell before its dialog closes.
      const dialog = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]')).at(-1);
      if (dialog) { event.preventDefault(); event.stopImmediatePropagation(); if(dialog.dispatchEvent(new Event('cancel',{cancelable:true})))dialog.close(); return; }
      const inlineModal=Array.from(document.querySelectorAll<HTMLElement>('.os [role="dialog"][aria-modal="true"]:not([data-alpha-layer="drawer"])')).some(dialog=>!dialog.closest('[inert],[hidden]')&&dialog.getAttribute('aria-hidden')!=='true'&&dialog.getClientRects().length>0&&getComputedStyle(dialog).visibility!=='hidden');
      if (inlineModal||document.querySelector<HTMLElement>('.os')?.inert) return;
      if(dismissMailFolderMenu()){event.preventDefault();event.stopImmediatePropagation();return;}
      // Back that only collapses the chat or a sheet keeps a reply streaming; it arrives in the
      // transcript. Back that changes the view retires the request through the view context, which
      // the connection reports with the Stop reconciliation (one cancel, one later history check).
      connectionController.cancelViewNavigation(); this.back();
    };
    window.addEventListener('alpha-back', this.backHandler);
    // HOME behaves the same way: from Home itself only the chat collapses; from another app the view
    // change is an explicit Stop with its reconciliation statement. Nothing is resent.
    this.homeHandler = () => { connectionController.cancelViewNavigation(); this.goHome(); };
    window.addEventListener('launcher-home', this.homeHandler);
    this.selectionHandler = (event: CustomEvent) => { this.selectedContext = event.detail; context(this); };
    window.addEventListener('alpha-selected-context', this.selectionHandler);
    this.assistListener = DailyApps.addListener('assistantInvoked', () => this.setState({ chat: 'full' })).catch(() => null);
    void DailyApps.surfaceInfo().then(r => {
      if (!this.live) return;
      if (Number.isFinite(r.bottomInset)) document.documentElement.style.setProperty('--native-bottom-inset', `${r.bottomInset}px`);
      if (r.assistant) this.setState({ chat: 'full' });
    }).catch(() => {});
    this.connectAgent = async () => {
      if (alphaClient.getState().connection === 'ready') return;
      const connection = connectionController.getSnapshot();
      if (connection.session) {
        alphaClient.attachVerifiedTransport({
          session: connection.session,
          send: ({ text, context, requestId, signal, onText, replyTo, onReplyReady, channelType, expectedConversationId,voiceTurnSignal }) => trackDispatch(this,()=>connectionController.send(text, context, requestId, signal, onText,replyTo,onReplyReady,channelType,expectedConversationId,voiceTurnSignal)),
          // Remote text is not authority to execute device actions. This path
          // accepts chat only until the server supports verified proposals.
          execute: ({ proposal, context, signal }) => connectionController.execute(proposal, context, signal),
        }, connection.kind === 'local' ? { developmentOrigin: connection.session.origin } : {});
        return;
      }
      // P-43: where the resident is always present, a send before it has a session waits for the
      // start already in progress and then says it is starting (or recovering); nothing is sent and
      // no chooser opens.
      if (residentAlwaysPresent) {
        await connectionController.initialize().catch(() => {});
        const after = connectionController.getSnapshot();
        if (after.session) return this.connectAgent();
        throw Object.assign(new Error(after.kind === 'recovering' ? RESIDENT_RECOVERING_NOTICE : RESIDENT_STARTING_NOTICE), { notDispatched: true });
      }
      // An explicit offline choice never falls through to an old development
      // credential that may still be installed on a test device. Without a
      // saved selection, product builds open the chooser; only test-mocks builds
      // (web development server, or a native development build) may try the
      // emulator development transport.
      const preference = localStorage.getItem('alpha.connection.selection.v1');
      if (!testMocksEnabled || preference || !(Capacitor.isNativePlatform()
        ? await DailyApps.surfaceInfo().then(info => info.developmentBuild === true, () => false)
        : devSurfacesEnabled)) {
        connectionController.open();
        throw new Error('Choose an agent connection to send a message.');
      }
      if (testMocksEnabled) await this.connectDevelopmentTransport();
    };
    // Test-mocks builds only; flag-off bundles drop this and its lazy chunk.
    if (testMocksEnabled) this.connectDevelopmentTransport = async () => {
      const { createDevelopmentTransport } = await import('../runtime/development-transport');
      const transport = await createDevelopmentTransport(async operation => {
        if (operation.type === 'open_view') {
        if (!['home','reminders','notifications'].includes(operation.view) && !isMvpView(operation.view)) return {status:'failed',summary:'This app is not available on this phone yet.'};
          const target = operation.view;
          if (target === 'home') this.goHome();
          else if (target === 'notifications') this.setState({ shade: true });
          else if (views[target]) this.openView(target);
          else return { status: 'failed', summary: 'That screen is not available.' };
          return { status: 'succeeded', summary: `Opened ${target}.` };
        }
        return { status:'failed', summary:'Development previews cannot write records.' };
      });
      if (this.live) { const send=transport.send.bind(transport);transport.send=input=>trackDispatch(this,()=>send(input));alphaClient.attachVerifiedTransport(transport); this.toast('Connected to the development agent'); }
      else transport.close?.();
    };
    connectionController.setDeviceRecovery(async(operation,operationId,bindingHash,signal)=>{
      signal.throwIfAborted();
      if(isSmsSend(operation)){if(!aospImage)throw Error('Native SMS receipt unavailable');const client=createAospTelephony(registerPlugin<AlphaTelephonyPlugin>('AlphaTelephony'),true);const smsResult=validateSmsResult(operation,await client.smsSendResult(operation,operationId),operationId,await smsAgentHash(operation));signal.throwIfAborted();return {status:smsDeviceStatus(smsResult),smsResult};}
      if(!isReminderOperation(operation)&&!isReminderCreate(operation))return {status:'unknown'};
      const result=await DailyApps.reminderOperationReceipt({operation,operationId,bindingHash});signal.throwIfAborted();
      return result.status==='succeeded'?{status:'succeeded',reminderResult:isReminderCreate(operation)?validateReminderCreateResult(operation,result.result,operationId):validateReminderResult(operation,result.result)}:{status:'unknown'};
    });
    connectionController.setViewInteractionExecutor(async(view,capability,params,signal,current)=>{
      current();if(!this.live||view!=='browser'||capability!=='browser-command'||!params||typeof params!=='object'||!this.browserCommand)throw Error('Native view capability is unavailable');
      return this.browserCommand((params as Record<string,unknown>).command,signal,current);
    });
    connectionController.setNavigationContext(()=>this.live?alphaClient.getState().context:null);
    connectionController.setDeviceReadReview(async(proposal,expectedContext,signal)=>{
      if(typeof this.prepareDeviceReadReview!=='function')throw Error('Notes review is unavailable. Nothing was shared.');
      await this.prepareDeviceReadReview(proposal.id,proposal.readReply?.digest,signal);signal.throwIfAborted();context(this);
      if(!this.live||document.hidden||JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext))throw Error('The Notes review changed. Nothing was shared.');
    });
    // Foreground free/busy: the owner picks calendars and reviews the exact answer on this
    // phone. Bound to the approving session, enrollment, screen and phone context throughout.
    connectionController.setForegroundExecutor(async (operation, operationId, expectedContext, signal, _bindingHash, journalIdentity, capabilities) => {
      if(operation.type==='calendar_named'&&operation.action==='read'){
        const ownerSession=connectionController.getSnapshot().session,ownerTarget=JSON.stringify(connectionController.getWorkflowDeviceTarget());
        const current=()=>{signal.throwIfAborted();context(this);if(!ownerSession||connectionController.getSnapshot().session!==ownerSession||JSON.stringify(connectionController.getWorkflowDeviceTarget())!==ownerTarget||!this.live||document.hidden||expectedContext.sensitive||expectedContext.view!=='calendar'||JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext))throw Error('Calendar selection or review changed');};
        current();return executeNamedCalendarRead(registerPlugin<NamedCalendarReadProvider>('AlphaCalendar'),operation,operationId,expectedContext,capabilities,signal,current,journalIdentity);
      }
      if(operation.type!=='calendar_availability')return {status:'failed',summary:'This review is not available on this phone yet. Nothing was shared or changed.'};
      const ownerSession=connectionController.getSnapshot().session,ownerTarget=JSON.stringify(connectionController.getWorkflowDeviceTarget());
      const current=()=>{signal.throwIfAborted();context(this);if(!ownerSession||connectionController.getSnapshot().session!==ownerSession||JSON.stringify(connectionController.getWorkflowDeviceTarget())!==ownerTarget||!this.live||document.hidden||expectedContext.sensitive||!['home','calendar'].includes(expectedContext.view)||JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext))throw Error('Availability review context changed');};
      return executeCalendarAvailability(registerPlugin<AvailabilityProvider>('AlphaCalendar'),operation,expectedContext.timeZone,signal,current,availabilityReview);
    });
    connectionController.setDeviceExecutor(async (operation, operationId, expectedContext, signal, bindingHash, workflowRoute, journalIdentity, agendaSource) => {
      signal.throwIfAborted(); context(this);
      if (!this.live || JSON.stringify(alphaClient.getState().context) !== JSON.stringify(expectedContext)) throw new Error('Phone context changed');
      if(isCameraCapture(operation)){
        const ownerSession=connectionController.getSnapshot().session;
        const current=()=>{signal.throwIfAborted();context(this);if(!this.live||document.hidden||expectedContext.sensitive||expectedContext.view!=='camera'||ownerSession!==connectionController.getSnapshot().session||JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext))throw Error('Camera request changed');};
        return captureAgentPhoto(operationId,signal,current);
      }
      if(isPhoneDial(operation)){
        // Reviewed dial handoff on the verified image only: the system dial screen opens with the
        // approved number and the owner places the call there. Contact targets are not negotiated.
        if(!aospImage||operation.target.kind!=='number'||expectedContext.sensitive||document.hidden)throw Error('Open Alpha on the Alpha image to review this number');
        const client=createAospTelephony(registerPlugin<AlphaTelephonyPlugin>('AlphaTelephony'),true);
        signal.throwIfAborted();context(this);
        if(!this.live||document.hidden||JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext))throw Error('Dial review context changed');
        const handoff=await client.dial(operation.target.number);
        const dialResult:PhoneDialResult={kind:'phone-dial',status:handoff.status,handler:handoff.status==='handed-off'?handoff.handler:null,contact:false};
        return {status:dialDeviceStatus(dialResult),summary:phoneDialResultText(dialResult),dialResult};
      }
      if(isSmsSend(operation)){
        if(!aospImage||expectedContext.sensitive||document.hidden||expectedContext.view!=='messages'||expectedContext.selectedObject?.kind!=='sms-subscription'||expectedContext.selectedObject.id!==String(operation.subscriptionId))throw Error('Open Messages on the Alpha image and select the approved SIM');
        const plugin=registerPlugin<AlphaTelephonyPlugin>('AlphaTelephony'),client=createAospTelephony(plugin,true);
        const ownerSession=connectionController.getSnapshot().session,ownerTarget=JSON.stringify(connectionController.getWorkflowDeviceTarget());
        const current=()=>{signal.throwIfAborted();context(this);if(!ownerSession||connectionController.getSnapshot().session!==ownerSession||JSON.stringify(connectionController.getWorkflowDeviceTarget())!==ownerTarget||!this.live||document.hidden||JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext))throw Error('SMS review context changed');};
        const status=await client.status();current();
        const selectedSim=status.subscriptions?.find(sim=>sim.id===operation.subscriptionId);
        if(!selectedSim||expectedContext.selectedObject.revision!==smsSubscriptionRevision(selectedSim))throw Error('The selected SIM changed; refresh Messages and select it again');
        const cancel=()=>{void plugin.cancelSmsReview({operationId}).catch(()=>{});};
        signal.addEventListener('abort',cancel,{once:true});
        try{current();const native=await client.sendSms(operation,operationId);const smsResult=validateSmsResult(operation,native,operationId,await smsAgentHash(operation));return {status:smsDeviceStatus(smsResult),smsResult,summary:receiptLabel(smsResult.status)};}
        finally{signal.removeEventListener('abort',cancel);}
      }
      if(isClockOperation(operation)){
        if(Capacitor.getPlatform()!=='android'&&!browserDevProfile)return {status:'failed',summary:'Native Clock handoff is unavailable in browser development. No alarm request was sent.'};
        assertClockTimeZone(operation,expectedContext.timeZone);signal.throwIfAborted();
        if(expectedContext.sensitive||document.hidden)throw Error('Return to Alpha Phone and review again');
        const clockSession=connectionController.getSnapshot().session;const clockEnrollment=JSON.stringify(connectionController.getWorkflowDeviceTarget());
        const {type,...request}=operation;
        const result=browserDevProfile?await DailyApps.clockHandoff({...request,reviewed:true}):null;
        if(!browserDevProfile&&!journalIdentity)throw Error('Exact approved Clock journal unavailable');
        const clockResult=validateClockResult(operation,result?{kind:'clock-handoff',action:result.action,status:result.status}:await reviewAgentClock(operation,operationId,journalIdentity!,signal,()=>{signal.throwIfAborted();context(this);if(!clockSession||connectionController.getSnapshot().session!==clockSession||JSON.stringify(connectionController.getWorkflowDeviceTarget())!==clockEnrollment||!this.live||document.hidden||JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext))throw Error('Clock review context changed');}));
        const status=clockResult.status==='opened'?'succeeded':clockResult.status==='unknown'?'unknown':'failed';
        return {status,clockResult,summary:browserDevProfile&&clockResult.status==='opened'?result!.message:clockResult.status==='opened'?(operation.action==='dismiss'||operation.action==='snooze'?'Clock opened for manual completion. Choose the intended alarm in Clock; no snooze or dismissal was performed by Alpha.':'Approved Clock handoff sent. Check Clock; Alpha cannot confirm an alarm was changed.'):clockResult.status==='unknown'?'Clock result is unknown. Check Clock before another request.':clockResult.status==='unavailable'?'No installed Clock app handles this request.':clockResult.status==='denied'?'Android did not allow this Clock request.':'Clock request was not sent. Review its time and the current phone state.'};
      }
      if(isMapsOperation(operation)){
        const mapsResult=readMapsSelection(operation);signal.throwIfAborted();context(this);
        if(JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext))throw Error('Maps context changed');
        return {status:'succeeded',summary:'Shared the exact selected Maps snapshot with approval. Navigation was not started.',mapsResult};
      }
      if(isLibraryOperation(operation)){
        // Device library (issue 408): reads stay local and return identity-only rows; select and
        // review act only on the owner-visible Photos > Device library, never directly on media.
        const library=deviceLibraryAgent();
        if(!library||expectedContext.sensitive||expectedContext.view!=='photos'||document.hidden)return {status:'failed',summary:'Open Photos on the unlocked phone to use the device library. Nothing was shared or changed.'};
        let photoLibraryResult;
        try{photoLibraryResult=await library.run(operation,signal);}
        catch(failure){if(failure instanceof LibraryAgentRefusal)return {status:'failed',summary:failure.message};throw failure;}
        signal.throwIfAborted();context(this);
        // Selection deliberately changes the selected object; every other operation must leave the context as approved.
        if(operation.type!=='photo_library_select'&&JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext))throw Error('Photos context changed');
        const summary=photoLibraryResult.kind==='photo_library_search'?`Shared ${photoLibraryResult.items.length} library ${photoLibraryResult.items.length===1?'item':'items'} by id, kind, date and size in pixels. No names, location or pixels were shared.`:photoLibraryResult.kind==='photo_library_inspect'?'Shared one library item by id, kind, date and size in pixels. No name, location or pixels were shared.':photoLibraryResult.kind==='photo_library_select'?`Selected ${photoLibraryResult.selected} ${photoLibraryResult.selected===1?'item':'items'} in Photos. Nothing was changed or shared.`:'Opened the review in Photos > Device library. Nothing changes until you confirm there and in Android.';
        return {status:'succeeded',summary,photoLibraryResult};
      }
      if(isCalendarOperation(operation)){
        if(operation.type==='calendar_create_local'||operation.type==='calendar_read_next'){if(operation.type==='calendar_read_next'&&Capacitor.isNativePlatform()&&Capacitor.getPlatform()!=='android'||expectedContext.sensitive||document.hidden)throw Error('Return to the supported foreground Calendar');const permission=await registerPlugin<{requestAccess():Promise<{status:string}>;requestWorkflowReadAccess():Promise<{status:string}>}>('AlphaCalendar')[operation.type==='calendar_create_local'?'requestAccess':'requestWorkflowReadAccess']();signal.throwIfAborted();context(this);if(permission.status!=='granted'||JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext))throw Error('Calendar permission or phone context changed');}
        const calendar=registerPlugin<{executeAgent(input:{operation:unknown;operationId:string;journalIdentity?:{scope:string;proposalId:string}}):Promise<{status:string;result?:unknown}>;cancelAgent(input:{operationId:string}):Promise<unknown>}>('AlphaCalendar');
        const cancel=()=>{void calendar.cancelAgent({operationId}).catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
        let result:{status:string;result?:unknown};try{signal.throwIfAborted();result=await calendar.executeAgent({operation,operationId,journalIdentity});}finally{signal.removeEventListener('abort',cancel);}
        if(result.status==='queued'){refreshDeletionViews();return {status:'unknown',summary:'Deletion queued with 10 seconds to Undo. Final outcome remains pending.'};}
        if(result.status==='applied'){
          const calendarResult=validateCalendarResult(operation,result.result);
          // Return the receipt immediately; DeviceActions must journal it before
          // the existing committed event refreshes native or browser rows.
          return {status:'succeeded',summary:calendarResult.kind==='calendar_read_next'?(calendarResult.event?`Shared ${calendarResult.event.timing==='ongoing'?'the ongoing all-day':'the next'} Calendar event “${calendarResult.event.title}”.`:`No events found from ${formatDeviceRecordDateTime(calendarResult.window.start,calendarResult.window.timeZone)} to ${formatDeviceRecordDateTime(calendarResult.window.end,calendarResult.window.timeZone)} (${calendarResult.window.timeZone}), the reviewed 30-local-day window.`):presentDeviceRecordOperation(operation,expectedContext.timeZone).appliedSummary,calendarResult};
        }
        return {status:result.status==='unknown'?'unknown':'failed',summary:result.status==='unknown'?'Calendar outcome is unconfirmed. Inspect action history before another action.':result.status==='cancelled'?'Calendar review cancelled. Nothing was changed.':'Calendar target changed, access was denied, or the operation is unsupported. Nothing was changed.'};
      }
      if(isNativeNotesQuery(operation)){
        if(this.notesSourceMode!=='legacy'||this.notesStorageFailed||this.notesPending||!this.notesStore)return {status:'failed',summary:'Select Previous notes to review this device-record request. Nothing was shared.'};
        const ownerSession=connectionController.getSnapshot().session,ownerTarget=JSON.stringify(connectionController.getWorkflowDeviceTarget());
        const current=()=>{signal.throwIfAborted();context(this);if(!ownerSession||connectionController.getSnapshot().session!==ownerSession||JSON.stringify(connectionController.getWorkflowDeviceTarget())!==ownerTarget||!this.live||this.notesPending||this.notesStorageFailed||document.hidden||expectedContext.sensitive||!['home','notes'].includes(expectedContext.view)||JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext))throw Error('Notes query or connection changed');};
        try{return await executeNotesQuery(this.notesStore,operation,operationId,signal,current);
        }catch{return {status:'failed',summary:'Notes changed or sharing became unavailable. Review the query again; nothing was shared.'};}
      }
      if(isNotesOperation(operation)){
        try{
          if(this.notesSourceMode!=='legacy'||this.notesStorageFailed||!this.notesStore)throw Error('Select Previous notes before reviewing a device-record change');
          const current=()=>{signal.throwIfAborted();context(this);if(!this.live||document.hidden||JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext)||expectedContext.sensitive||expectedContext.view!=='notes')throw Error('Selected Notes context changed');};
          const execute=()=>this.notesStore.execute(operation,operationId,signal,current);
          // An approved agent deletion moves the note to Trash: the restorable copy is
          // written ahead of the tombstone commit, under the same deletion-effects lock.
          const notesResult=operation.type!=='notes_delete'?await execute():await withNotesDeletionLock(async()=>{
            current();const list=this.notesStore.list,index=list.findIndex((n:Shell)=>n.id===operation.target.noteId);
            if(index<0)throw Error('Selected note is missing');
            const target=await this.notesStore.target(operation.target.noteId);
            if(JSON.stringify(target)!==JSON.stringify(operation.target))throw Error('Selected note revision changed');
            const note=list[index],voice=this.api('notes')?.trashVoiceNoteWithRecording;
            // A voice note's recording moves to the audio trash under the same operation id,
            // so Trash restores or erases the note and its recording together.
            const result=note.kind==='voice'&&note.audio&&typeof voice==='function'?await voice(note,target,operationId,index,execute):
              (await editNotesTrash(doc=>addNotesTrashEntry(doc,{id:operationId,note,target,index,deletedAt:Date.now()})),await execute());
            window.dispatchEvent(new Event('alpha:notes-trash-changed'));return result;
          },signal);
          return {status:'succeeded',summary:presentDeviceRecordOperation(operation,expectedContext.timeZone).appliedSummary,notesResult};
        }catch(error){
          const uncertain=error instanceof NotesCommitUncertain;
          // Cancellation or stale approval before mutation is not a storage failure.
          if(uncertain||this.notesStore?.needsRecovery){
            this.notesStorageFailed=true;this.notesCommitUncertain=this.notesCommitUncertain||uncertain;
            if(error instanceof NotesStorageFull)this.notesStorageFull=true;
            this.notesSelectionKey=null;this.notesSelection=null;
            if(this.live){originalSet.call(this,'notes',{storageStatus:this.notesStorageFull?failedNotesStatus(this,false):this.notesCommitUncertain?'Save outcome unknown. Reopen the app to inspect saved notes; do not repeat.':'Notes storage needs recovery. Reopen the app to inspect saved notes before editing.'});context(this);}
          }
          // A full Trash refuses the write-ahead copy before the note is touched.
          if(!uncertain&&operation.type==='notes_delete'&&isNotesTrashFull(error))return {status:'failed',summary:'Trash is full. Empty Trash in Notes, then review this deletion again. Nothing was deleted.'};
          return {status:uncertain?'unknown':'failed',summary:uncertain?'Notes outcome is uncertain. Review history; do not repeat automatically.':(error as Error).message};
        }
      }
      if(operation.type==='read_calendar_range'&&agendaSource){
        const current=()=>{signal.throwIfAborted();context(this);if(!this.live||document.hidden||JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext)||expectedContext.sensitive)throw Error('Calendar read context changed');};current();
        const calendar=registerPlugin<{readAgenda(input:unknown):Promise<{status:string;events:unknown[]}>}>('AlphaCalendar');
        const result=await calendar.readAgenda({operationId,source:agendaSource,operation});current();
        if(result.status!=='ready')return {status:'failed',summary:'The local Calendar range was not shared. Permission, source or review changed; no empty result is implied.'};
        const events=await Promise.all(result.events.map(async(event:any)=>({...event,revision:await workflowSha([event.id,event.calendarId,event.title,event.start,event.end,event.allDay])})));
        const readResult=await validateWorkflowResult(operation,{kind:'calendar',events});current();return {status:'succeeded',summary:`Read ${events.length} app Calendar events within the approved range.`,readResult};
      }
      if(operation.type==='read_selected_reminders'){
        const current=()=>{signal.throwIfAborted();context(this);if(!this.live||document.hidden||JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext)||expectedContext.sensitive||expectedContext.view!=='workflows'||expectedContext.selectedObject?.kind!=='workflow-run')throw new Error('Workflow read context changed');};current();
        const {reminders}=await DailyApps.listReminders();current();
        try{const readResult=await workflowReminderRows(operation,reminders);current();return {status:'succeeded',summary:`Read ${readResult.reminders.length} reminders for ${operation.day}. The exact result is retained for this workflow receipt.`,readResult};}
        catch(error){if(error instanceof WorkflowReminderOverflow)return {status:'failed',summary:error.message};throw error;}
      }
      if(operation.type==='read_selected_notes'||operation.type==='read_calendar_range'){
        const current=()=>{signal.throwIfAborted();context(this);if(!this.live||document.hidden||JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext)||expectedContext.sensitive||expectedContext.view!=='workflows'||expectedContext.selectedObject?.kind!=='workflow-run')throw new Error('Workflow read context changed');};current();
        if(operation.type==='read_selected_notes'){
          await this.notesStore?.assertCurrent();const raw=this.notesStore?.raw;if(this.notesStorageFailed||this.notesPending||raw!==this.notesRaw)return {status:'failed',summary:'Notes changed or storage is unavailable. Review the selected notes again.'};
          const source=this.vget('notes').list;const snapshot=operation.notes.map(selected=>{const matches=source.filter((n:Shell)=>n.id===selected.id);if(matches.length!==1||typeof matches[0].title!=='string'||typeof matches[0].body!=='string')throw new Error('A selected note is missing');return {id:selected.id,revision:selected.revision,title:matches[0].title,text:matches[0].body};});
          const result=await validateWorkflowResult(operation,{kind:'notes',notes:snapshot});current();await this.notesStore.assertCurrent();current();if(this.notesStore.raw!==raw)throw new Error('Notes changed while preparing the approved read');
          return {status:'succeeded',summary:`Read ${snapshot.length} selected notes. The exact result is retained for this workflow receipt.`,readResult:result};
        }
        const calendar=registerPlugin<{readWorkflowRange(input:{calendarIds:string[];start:string;end:string;timeZone:string;maximumEvents:number}):Promise<{status:string;events:Array<{id:string;calendarId:string;title:string;start:string;end:string;allDay:boolean}>}>}>('AlphaCalendar');
        const result=await calendar.readWorkflowRange({calendarIds:operation.calendarIds,start:operation.start,end:operation.end,timeZone:operation.timeZone,maximumEvents:operation.maximumEvents});current();
        if(result.status!=='ready')return {status:'failed',summary:'Calendar read permission is unavailable. No calendar content was uploaded.'};
        const events=await Promise.all(result.events.map(async event=>({...event,revision:await workflowSha([event.id,event.calendarId,event.title,event.start,event.end,event.allDay])})));
        const readResult=await validateWorkflowResult(operation,{kind:'calendar',events});current();return {status:'succeeded',summary:`Read ${events.length} events within the selected calendar range.`,readResult};
      }
      if(operation.type==='post_notification'||operation.type==='speak_text'){
        if(connectionController.getWorkflowPresentationProtocol()!==2)return {status:'failed',summary:'This device has not negotiated workflow presentation support.'};
        signal.throwIfAborted();context(this);if(!this.live||document.hidden||JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext)||expectedContext.sensitive||expectedContext.view!=='workflows')throw Error('Workflow review context changed');
        if(operation.type==='post_notification'&&Capacitor.isNativePlatform()){
          const notices=registerPlugin<{postWorkflow(input:{operationId:string;bindingHash:string;title:string;body:string;route:NonNullable<typeof workflowRoute>}):Promise<{status:unknown}>}>('AlphaNotifications');
          if(!bindingHash||!workflowRoute)throw Error('Workflow notification binding is missing');
          const result=await notices.postWorkflow({operationId,bindingHash,title:operation.title,body:operation.body,route:workflowRoute});
          signal.throwIfAborted();
          const status=result.status==='succeeded'?'succeeded':result.status==='failed'?'failed':'unknown';
          return {status,summary:status==='succeeded'?'Posted the reviewed notification on this device.':status==='failed'?'Notification delivery is unavailable on this device.':'Notification outcome is unconfirmed. It will not be repeated automatically.'};
        }
        if(operation.type==='post_notification'){await publishWorkflowNotice(operationId,operation.body,signal,operation.title,bindingHash);return {status:'succeeded',summary:'Posted the reviewed notification in the browser Inbox.'};}
        const speechAbort=new AbortController(),stop=()=>speechAbort.abort();signal.addEventListener('abort',stop,{once:true});window.addEventListener('alpha:stop-workflow-speech',stop);
        const currentSpeech=()=>{speechAbort.signal.throwIfAborted();context(this);if(!this.live||document.hidden||JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext))throw Error('Workflow review context changed');};
        const unsubscribe=alphaClient.subscribe(()=>{try{currentSpeech();}catch(error){speechAbort.abort(error);}});
        try{signal.throwIfAborted();await speakAppText(operation.text,speechAbort.signal,undefined,true,currentSpeech);currentSpeech();return {status:'succeeded',summary:'Finished reading the reviewed text aloud.'};}finally{unsubscribe();signal.removeEventListener('abort',stop);window.removeEventListener('alpha:stop-workflow-speech',stop);}
      }
      if (operation.type === 'create_note') {
        if (this.notesSourceMode!=='legacy'||this.notesStorageFailed) return { status: 'failed', summary: 'Select Previous notes to review this device-record creation. Nothing saved.' };
        const existing = this.vget('notes').list.find((note: Shell) => note.id === operationId);
        if (existing) return { status: 'unknown', summary: 'A note already has this action identifier; review it before resolving.' };
        const note = { id: operationId, kind: 'text', title: operation.title, body: operation.body, pinned: false, when: 'Now', createdAt:Date.now(), modifiedAt:Date.now() };
        const saved = await this.vset('notes', { list: [note, ...this.vget('notes').list] });
        return { status: saved ? 'succeeded' : this.notesCommitUncertain?'unknown':'failed', summary: saved ? presentDeviceRecordOperation(operation,expectedContext.timeZone).appliedSummary : 'The note save is unconfirmed. Inspect saved notes before repeating.' };
      }
      if(isReminderCreate(operation)){
        const support=await DailyApps.surfaceInfo();signal.throwIfAborted();
        context(this);if(!this.live||JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext))throw Error('Phone context changed');
        if(support.reminderCreationVersion!==1)return {status:'failed',summary:'This phone does not support reviewed reminder creation. Nothing was created.'};
        const result=await DailyApps.operateReminder({operationId,bindingHash,operation});
        if(result.status!=='succeeded')return {status:'unknown',summary:'Reminder creation outcome is unknown. Check action history; it will not be repeated.'};
        const reminderResult=validateReminderCreateResult(operation,result.result,operationId);
        return {status:'succeeded',reminderResult,summary:reminderResult.status==='permission-denied'?'Reminder saved; notifications are disabled.':reminderResult.status==='scheduling-failed'?'Reminder saved; notification scheduling failed.':presentDeviceRecordOperation(operation,expectedContext.timeZone).appliedSummary};
      }
      if(isReminderOperation(operation)){
        signal.throwIfAborted();context(this);if(JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext)||expectedContext.sensitive||document.hidden)throw Error('Reminder context changed');
        const target=await DailyApps.selectedReminder({id:operation.target.reminderId});signal.throwIfAborted();
        if(JSON.stringify(target)!==JSON.stringify(operation.target)) { // property order is normalized below
          for(const key of ['sourceId','sourceRevision','reminderId','occurrenceId','revision','timingVersion'] as const)if(target[key]!==operation.target[key])return {status:'failed',summary:'This reminder changed. Review it again before applying the action.'};
        }
        context(this);if(JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext))throw Error('Reminder context changed');
        signal.throwIfAborted();
        if(operation.type==='reminder_cancel'){
          const queued=await deletions.reviewAgentReminder({operationId,bindingHash,operation,journalIdentity});
          if(queued.status==='queued')refreshDeletionViews();
          if(reminderDeletionRefusal(queued.status))return {status:'failed',summary:'Deletion was not queued. Nothing changed.'};
          return {status:queued.status==='cancelled'?'failed':'unknown',summary:queued.status==='queued'?'Deletion queued with 10 seconds to Undo. Final outcome remains pending.':queued.status==='cancelled'?'Deletion cancelled before admission.':'Deletion outcome requires review; it will not be repeated.'};
        }
        const result=await DailyApps.operateReminder({operationId,bindingHash,operation});
        // Publish the new revision only after the receipt attempt; refreshing here
        // cancels this context-bound action before it can acknowledge the server.
        if(result.status!=='succeeded')return {status:'unknown',summary:'Reminder outcome requires review. It was not repeated.'};
        const reminderResult=validateReminderResult(operation,result.result);
        return {status:'succeeded',summary:reminderResult.status==='permission-denied'||reminderResult.status==='scheduling-failed'?`Reminder ${reminderResult.status}.${Capacitor.isNativePlatform()?' Android delivery is approximate.':''}`:presentDeviceRecordOperation(operation,expectedContext.timeZone).appliedSummary,reminderResult};
      }
      if (operation.type === 'create_reminder') {
        const at = Date.parse(operation.dueAt);
        if (!Number.isSafeInteger(at) || at <= Date.now()) return { status: 'failed', summary: 'Reminder time has passed. Nothing scheduled.' };
        const result = await DailyApps.scheduleReminder({ id: operationId, title: operation.title, body: '', at });
        if (result.status !== 'scheduled' || result.id !== operationId) return { status: 'failed', summary: 'Scheduling was not confirmed. Check notification settings and the reminder time.' };
        // Publish the new revision only after the receipt attempt; refreshing here
        // cancels this context-bound action before it can acknowledge the server.
        return { status: 'succeeded', summary: presentDeviceRecordOperation(operation,expectedContext.timeZone).appliedSummary };
      }
      if (operation.type === 'open_view') {
        // Navigation changes the view epoch; journal completion still runs after it.
        if(!openInternalView(this,operation.view))return {status:'failed',summary:'This view is unavailable.'};
        return { status: 'succeeded', summary: `Opened ${operation.view} on this phone.` };
      }
      if (operation.type !== 'browser_navigate') return {status:'failed',summary:'This device operation is unavailable.'};
      if (!this.browserNavigateApproved) return { status: 'failed', summary: 'Approved browser navigation is unavailable. No page opened.' };
      const browserSession=connectionController.getSnapshot().session;
      const present=await this.browserNavigateApproved(operation.url, signal, true);
      return { status: 'succeeded', summary: browserNavigationSummary(operation.url),presentBrowser:()=>{
        const show=()=>{
          if(!this.live||document.hidden||alphaClient.getState().pending||connectionController.getSnapshot().session!==browserSession||JSON.stringify(alphaClient.getState().context)!==JSON.stringify(expectedContext))return;
          present?.();
        };
        // Showing Browser changes the view, and a view change cancels the active request. A directly
        // requested open runs inside the chat request that still carries its reply: show Browser after
        // that request settles, so the reply stays whole instead of "Stopped." with a stop notice.
        if(!alphaClient.getState().pending){show();return;}
        const stop=alphaClient.subscribe(()=>{if(alphaClient.getState().pending)return;stop();setTimeout(()=>{try{show();}catch{/* A retired tab keeps its journaled receipt. */}},0);});
      } };
    });
    context(this);
  };
  p.componentDidUpdate = function (prev: Shell) { originalUpdate.call(this, prev); const notesView=this.S().view==='notes';if(notesView&&!this.wasCanonicalNotesView&&this.notesSourceMode==='canonical')void this.canonicalNotesUi?.refresh().catch(()=>{});this.wasCanonicalNotesView=notesView; context(this); void connectionController.observeCommittedView(); sizeComposer();this.composerDraft?.edit(String(this.S().draft||''));const shade=!!this.S().shade;if(shade&&!this.shadeWasOpen)this.refreshTileFacts();this.shadeWasOpen=shade;const chatOpen=this.S().chat==='sheet'||this.S().chat==='full',drafting=!!String(this.S().draft||'').trim();if((chatOpen&&!this.chatWasOpen)||(drafting&&!this.wasDrafting))connectionController.warmInference();this.chatWasOpen=chatOpen;this.wasDrafting=drafting;const selected=this.messageReplyTarget||this.messageEditTarget;if(selected&&(JSON.stringify(selected.session)!==JSON.stringify(connectionController.getSnapshot().session)||!this.S().msgs.some((m:Shell)=>m.id===selected.messageId&&m.text===selected.text))){cancelMessageContext(this);this.setState({});} };
  p.componentWillUnmount = function () {
    const notes=this.canonicalNotesUi;this.canonicalNotesUi=null;notes?.retire();this.notesSourceEpoch=(this.notesSourceEpoch??0)+1;
    this.cancelReadReplyCompletions?.();
    cancelMessageContext(this);connectionController.cancelViewNavigation();
    this.pendingActionRecoveryAbort?.abort();this.pendingActionApproval?.abort();clearTimeout(this.pendingActionExpiryTimer);
    this.draftRecoveryAbort?.abort();this.composerDraft?.retire(false);this.draftBindingAbort?.abort();
    this.notesOpenAbort?.abort();if(activeShell===this){activeShell=null;notesRecovery?.abort();}
    this.closeSummaryReview?.();
    this.connectionUnsubscribe?.();
    window.removeEventListener('alpha:notes-committed',this.notesCommittedHandler);
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    window.removeEventListener('pagehide', this.pageHideHandler);
    window.removeEventListener('pageshow', this.pageShowHandler);
    this.dialogBackObserver?.disconnect();this.stopTileWatch?.();
    this.live = false; alphaClient.disconnect(); window.removeEventListener('alpha-back', this.backHandler); window.removeEventListener('launcher-home', this.homeHandler); window.removeEventListener('alpha-selected-context', this.selectionHandler);
    void this.assistListener?.then((l: Shell) => l?.remove()); originalUnmount.call(this);
  };
  p.vset = function (key: string, patch: Shell, options?: {exact?: boolean}) {
    if(key==='notes'&&Object.hasOwn(patch,'list')&&this.notesSourceMode!=='legacy'){originalSet.call(this,key,{compose:false,record:false});this.toast('That note change could not be saved. Your draft is still open.');return false;}
    if (key !== 'notes' || !patch.list) { originalSet.call(this,key,patch);return true; }
    if (this.notesStorageFailed||!this.notesStore) {
      // Recovery can race the next input event. Retain its text only as a draft;
      // unavailable storage must never turn this edit into an action receipt.
      this.notesSelectionKey=null;this.notesSelection=null;
      originalSet.call(this,key,{...patch,storageStatus:failedNotesStatus(this,false)});
      this.toast('Notes storage needs recovery. Unsaved text is kept on this screen; saved drafts are retained in Alpha.');context(this);
      keepNotesDraft(this,patch.list,this.notesStorageFull?'storage-full':this.notesCommitUncertain?'uncertain':'failed');return false;
    }
    try {
      // A Trash restore reinstates the exact saved record; it is not a content modification.
      if(!options?.exact)patch={...patch,list:stampNoteChanges(this.notesStore.list,patch.list)};
      // While this editor's own write is still settling, the store already holds that write's
      // revision; only a revision that is neither confirmed nor ours is a concurrent change.
      if((this.notesPending?this.notesLocalRaw:this.notesRaw)!==this.notesStore.raw)throw Error('Notes changed while this editor had unsaved text. Review recovery before saving.');
      const pending=this.notesStore.replace(patch.list);
      this.notesLocalRaw=this.notesStore.raw;
      this.notesPending++;
      this.notesSelectionKey=null;this.notesSelection=null;
      // Text remains visible while the native commit is pending; this is not a saved receipt.
      originalSet.call(this,key,{...patch,storageStatus:'Saving on this device…'});
      context(this);
      return Promise.resolve(pending).then(()=>{
        this.notesPending--;this.notesRaw=this.notesStore.raw;
        if(this.live&&!this.notesPending&&!this.notesStorageFailed){originalSet.call(this,'notes',{storageStatus:''});context(this);}
        // A change was saved, so space may have been freed: retry a draft kept from a full collection.
        const deferred=this.notesDraftDeferred;if(deferred&&!this.notesPending){this.notesDraftDeferred=null;setTimeout(()=>{if(this.live)void resumeNotesDraft(this,deferred);},0);}
        return true;
      }).catch((error)=>{
        this.notesPending--;this.notesStorageFailed=true;this.notesCommitUncertain=error instanceof NotesCommitUncertain;
        const full=error instanceof NotesStorageFull||isStorageFull(error);if(full)this.notesStorageFull=true;
        if(this.live){
          originalSet.call(this,'notes',{storageStatus:failedNotesStatus(this,false)});
          this.toast(full?'Notes storage is full. Nothing new was saved; unsaved text remains on this screen.':error instanceof NotesCommitUncertain?'Save outcome unknown. Reopen to inspect saved notes; do not repeat the action.':'Notes could not be saved. Unsaved text remains on this screen.');context(this);
        }
        keepNotesDraft(this,this.vget('notes').list,full?'storage-full':this.notesCommitUncertain?'uncertain':'failed');
        return false;
      });
    } catch (error) {
      // Browser storage and revision checks can fail synchronously, before the
      // optimistic state above is installed. Preserve the attempted draft just
      // as we do for a rejected native commit, without retrying the write.
      this.notesStorageFailed=true;
      this.notesCommitUncertain=error instanceof NotesCommitUncertain;
      this.notesSelectionKey=null;this.notesSelection=null;
      originalSet.call(this,key,{...patch,storageStatus:failedNotesStatus(this,false)});
      keepNotesDraft(this,patch.list,this.notesCommitUncertain?'uncertain':'failed');
      this.toast(this.notesCommitUncertain?'Save outcome unknown. Unsaved text remains on this screen; do not repeat the action.':'Notes changed or storage is unavailable. Unsaved text remains on this screen.');
      context(this);
      return false;
    }
  };
  p.api = function (key: string) {
    const api = originalApi.call(this, key);
    if(key==='notes')api.notesSourceOptions=[{id:'canonical',label:'Notes',selected:this.notesSourceMode!=='legacy',css:this.notesSourceMode!=='legacy'?'background:var(--acc);color:#fff':'background:var(--s2);color:var(--fg)',choose:()=>void selectNotesSource(this,'canonical')},{id:'legacy',label:'Previous notes',selected:this.notesSourceMode==='legacy',css:this.notesSourceMode==='legacy'?'background:var(--acc);color:#fff':'background:var(--s2);color:var(--fg)',choose:()=>void selectNotesSource(this,'legacy')}];
    if(key==='workflows'&&!isAndroid){
      api.localWorkflowReady=()=>{context(this);return this.live&&!alphaClient.getState().pending&&!alphaClient.getState().context.sensitive&&(alphaClient.getState().connection==='ready'||!!connectionController.getSnapshot().session);};
      api.localWorkflowBusy=()=>alphaClient.getState().pending;
      api.localWorkflowIdle=(signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
        signal.throwIfAborted();let unsubscribe=()=>{};
        const finish=(error?:Error)=>{unsubscribe();signal.removeEventListener('abort',cancel);error?reject(error):resolve();};
        const cancel=()=>finish(new DOMException('Workflow cancelled','AbortError'));
        const check=()=>{const state=alphaClient.getState();if(state.context.sensitive)finish(Error('Return to the device before generating a workflow result.'));else if(!state.pending)finish();};
        unsubscribe=alphaClient.subscribe(check);signal.addEventListener('abort',cancel,{once:true});check();
      });
      api.localWorkflowText=async(instruction:string,input:string,signal:AbortSignal,automatic=false)=>{
        signal.throwIfAborted();
        if(alphaClient.getState().connection!=='ready'&&!connectionController.getSnapshot().session)return undefined;
        context(this);
        if(!this.live||!automatic&&this.S().view!=='workflows'||alphaClient.getState().context.sensitive)throw Error('Open the workflow to generate its result.');
        const expectedSession=alphaClient.getState().session||connectionController.getSnapshot().session,expectedRevision=alphaClient.getState().context.revision;
        await this.connectAgent();signal.throwIfAborted();context(this);
        if(!this.live||alphaClient.getState().context.sensitive||!automatic&&(this.S().view!=='workflows'||alphaClient.getState().context.revision!==expectedRevision)||JSON.stringify(alphaClient.getState().session)!==JSON.stringify(expectedSession))throw Error('The workflow or agent connection changed. Run the step again.');
        return alphaClient.generateWorkflowText(instruction,input,signal,automatic);
      };

      api.localWorkflowNotes=async(input:{operationId?:string;text?:string},signal:AbortSignal)=>{
        signal.throwIfAborted();
        if(this.notesStorageFailed||this.notesPending||!this.notesStore)throw Error('Reopen Notes before running this step.');
        await this.notesStore.assertCurrent();signal.throwIfAborted();
        if(this.notesPending||this.notesRaw!==this.notesStore.raw)throw Error('Notes changed during this step.');
        const list=this.notesStore.list;
        if(!input.operationId)return list;
        const text=input.text||'';
        if(!text.trim()||text.length>32000)throw Error('Choose note content between 1 and 32000 characters.');
        const existing=list.find((note:Shell)=>note.id===input.operationId);
        if(existing){if(existing.body!==text||existing.workflowStep!==input.operationId)throw Error('Saved note receipt does not match this step.');return existing;}
        const note={id:input.operationId,kind:'text',title:'Workflow note',body:text,pinned:false,when:'Today',createdAt:Date.now(),workflowStep:input.operationId};
        signal.throwIfAborted();
        if(await this.vset('notes',{list:[note,...list]})!==true)throw Error('Note save is unconfirmed. Reopen Notes to inspect it before retrying.');
        return note;
      };
    }
    if(key==='notes'){api.set=(patch:Shell)=>this.vset('notes',patch);api.storageReady=()=>!this.notesStorageFailed&&!this.notesPending; }
    api.say = () => this.toast('Connect the underlying account or select real content before requesting this action.');
    // Open the real conversation without sending a prompt or uploading content.
    // Keep the current view/selection so a subsequent user message is scoped.
    api.sendReviewedMail = async (text:string, expected:{sessionId:string;agentId:string;ownerId:string;origin:string}) => {
      const current=connectionController.getSnapshot().session;
      if(!current||JSON.stringify(current)!==JSON.stringify(expected)||document.hidden||connectionController.getSnapshot().open||document.documentElement.dataset.connectionMode==='mock')throw new Error('Agent changed. Review this message again.');
      if(this.S().typing)throw new Error('Wait for the current agent reply before sharing this email.');
      context(this);await this.send(text,expected);
    };
    api.openReviewedWebSource=(url:string,signal:AbortSignal)=>this.browserNavigateApproved(url,signal);
    api.composeContentQuestion=(draft:string,source?:Source)=>{
      this.reviewedSourceDraft={draft,source:sourceOf(source)};
      context(this);this.setState({chat:'sheet',shade:false,draft});
    };
    api.assist = (notice: string) => {
      context(this);
      this.setState({ chat: 'sheet', shade: false });
      this.agentSay(notice);
    };
    return api;
  };
  function cancelMessageContext(shell:Shell){if(shell.messageEditTarget)messageReviews.cancel('edit-message-'+shell.messageEditTarget.messageId);shell.messageEditTarget=undefined;shell.messageReplyTarget=undefined;}
  function messageTarget(message:Shell):ConversationMessageTarget|undefined {
    if(!message.messageBinding||message.streaming||message.interrupted||message.card)return;
    return {...message.messageBinding,messageId:message.id,text:message.text,from:message.from};
  }
  p.canReplyMessage=function(message:Shell){const target=messageTarget(message);return !!target&&!this.S().typing&&!this.draftSendPending&&connectionController.messageTargetCurrent(target);};
  p.canEditMessage=function(message:Shell){return message.from==='user'&&this.canReplyMessage(message)&&connectionController.canEditMessages();};
  p.replyToMessage=function(message:Shell){if(!this.canReplyMessage(message))return;this.messageEditTarget=undefined;this.messageReplyTarget=messageTarget(message);this.setState({chat:'full'},()=>document.querySelector<HTMLTextAreaElement>('[data-alpha-layer="conversation"] textarea[data-alpha-composer]')?.focus());};
  p.editMessage=function(message:Shell){if(!this.canEditMessage(message))return;if(this.S().draft.trim()){this.toast('Finish or clear your current draft before editing a message.');return;}this.messageReplyTarget=undefined;this.messageEditTarget=messageTarget(message);this.setState({draft:message.text,chat:'full'},()=>document.querySelector<HTMLTextAreaElement>('[data-alpha-layer="conversation"] textarea[data-alpha-composer]')?.focus());};
  function typedSendBinding(){return JSON.stringify([connectionController.getSnapshot().session,connectionController.getSnapshot().history?.conversationId,connectionController.getCloudEnvironment?.(),connectionController.getCloudClient()?.sessionId,connectionController.getCloudClient()?.credentialId]);}
  function sendFromComposer(shell:Shell){
    const origin=document.querySelector<HTMLTextAreaElement>('textarea[data-alpha-composer]:not([disabled])');
    if(!origin){void shell.send();return;}
    const before=shell.S(),binding=typedSendBinding(),previousFocus=document.activeElement,events=new AbortController();
    let eligible=true,unsubscribe=()=>{};
    const retire=()=>{eligible=false;events.abort();unsubscribe();};
    document.addEventListener('pointerdown',retire,{capture:true,signal:events.signal});
    document.addEventListener('keydown',retire,{capture:true,signal:events.signal});
    document.addEventListener('focusin',event=>{if(event.target!==origin)retire();},{capture:true,signal:events.signal});
    document.addEventListener('visibilitychange',retire,{signal:events.signal});
    unsubscribe=connectionController.subscribe(()=>{if(typedSendBinding()!==binding)retire();});
    const restore=()=>{
      const now=shell.S(),active=document.activeElement,selected=connectionController.getSnapshot();
      const current=eligible&&shell.live&&!document.hidden&&!selected.open&&!selected.busy&&typedSendBinding()===binding&&now.view===before.view&&now.screen===before.screen
        &&(active===origin||active===previousFocus||active===document.body)&&!document.querySelector('[data-alpha-chat-recorder],[data-alpha-pill-voice]');
      retire();
      if(!current)return;
      const input=document.querySelector<HTMLTextAreaElement>('textarea[data-alpha-composer]:not([disabled])');
      input?.focus({preventScroll:true});input?.setSelectionRange(input.value.length,input.value.length);
    };
    // Focus follows the accepted optimistic commit, never a later network reply.
    void shell.send(undefined,undefined,restore).finally(retire);
  }
  p.renderVals = function () {
    const out = originalVals.call(this);
    const composeTarget=this.messageEditTarget||this.messageReplyTarget;
    out.messageComposeContext=composeTarget?(this.messageEditTarget?'Editing message':'Replying to '+(composeTarget.from==='user'?'your message':out.name))+': '+composeTarget.text.replace(/\s+/g,' ').slice(0,160):'';
    out.cancelMessageContext=()=>{cancelMessageContext(this);this.setState({});};
    const draft=this.composerDraft?.state;
    out.draftRecovery=!!draft?.error&&!!this.composerDraft?.recovery();
    out.recoverDraft=()=>{const recovery=this.composerDraft?.recovery();if(!recovery)return;this.draftRecoveryAbort?.abort();const controller=this.draftRecoveryAbort=new AbortController();openDomainRecovery({capture:async signal=>{const captured=await recovery.capture(signal);return {...captured,raw:JSON.stringify({saved:captured.raw,currentDraft:String(this.S().draft||'')})};},reset:recovery.reset},'assistant draft','Assistant draft recovery','Download the saved bytes and current text before resetting this conversation’s draft. Reset does not delete messages or send anything. Reloading discards the current unsaved text.',controller.signal,undefined,Capacitor.getPlatform()==='android'?'device':'browser');};
    // The resident's hosted inference needs a network; local apps keep working without one.
    const connection=connectionController.getSnapshot(),offline=connection.inferenceOffline&&connection.kind==='resident'&&!!connection.session;
    // Routine startup stays quiet. Recovery failures remain actionable, and an
    // attempted send still explains why it cannot dispatch before readiness.
    const residentPending=residentAlwaysPresent&&!connection.session&&connection.kind==='recovering'?agentPendingText(connection):'';
    out.draftRetry=!!draft?.error;out.draftStatus=[draft?.message,offline?INFERENCE_OFFLINE_NOTICE:'',residentPending].filter(Boolean).join(' ');out.draftConflict=!!draft?.conflict;out.draftSavedText=draft?.savedText||'(Empty saved draft)';out.draftOpening=!!draft?.consuming;
    out.restoreSavedDraft=()=>{this.composerDraft?.restoreSaved();if(this.firstSendReview)this.refreshDraftBinding();};out.keepCurrentDraft=()=>{this.composerDraft?.keepCurrent();if(this.firstSendReview)this.refreshDraftBinding();};out.retryDraft=()=>{this.composerDraft?.retire();this.refreshDraftBinding();};
    const onDraft=out.onDraft;
    out.onDraft=(event:Event&{target:HTMLTextAreaElement})=>{
      const connection=connectionController.getSnapshot(),current=String(this.S().draft||'');
      if(this.startupDraft!==null&&!connection.startupResolved&&!connection.session){
        this.startupDraft=!current||this.startupDraft===current?event.target.value:undefined;
      }else this.startupDraft=null;
      onDraft(event);
    };
    out.composerPointer=(event:PointerEvent)=>event.stopPropagation();
    out.sendNow=()=>sendFromComposer(this);
    out.onKey=(event:KeyboardEvent&{nativeEvent?:KeyboardEvent})=>{
      if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&!event.nativeEvent?.isComposing&&event.keyCode!==229){event.preventDefault();sendFromComposer(this);}
    };
    // Pending proposals offer Decline beside approval. The digest card renders one button per row.
    const live:Shell[]=this.S().msgs||[];
    out.msgs=(out.msgs||[]).map((m:Shell)=>{
      const c=m.c||{};
      // A system notice card already carries its text; do not print it a second time above the card.
      if(c.systemNotice&&m.cGeneric&&m.displayText===c.sub)return {...m,hasCalendarText:false};
      if(!c.proposalId||c.done||c.reviewUnavailable||!m.cGeneric)return m;
      const message=live.find(item=>item.card===c);if(!message)return m;
      const ic=out.ic||{},busy=!!this.decliningProposal||!!this.pendingActionApproval;
      return {...m,hasCalendarText:m.hasCalendarText&&m.displayText!==c.sub,cGeneric:false,cDigest:true,actionReviewClass:'alpha-action-review',rows:[
        {ini:'',who:busy?'Working…':c.title,text:typeof c.sub==='string'&&c.sub.startsWith(c.title+'\n')?c.sub.slice(c.title.length+1):c.sub,icon:ic.right,open:()=>{if(!busy)void this.cardAct(message);}},
        {ini:'',who:this.decliningProposal===c.proposalId?'Cancelling…':'Cancel',text:'Keep things as they are.',icon:ic.x,open:()=>{if(!busy)void this.declineCard(message);}},
      ]};
    });
    out.msgs=projectActionMessages(out.msgs||[],live);
    out.canStopReply=!!this.S().typing&&alphaClient.getState().pending;
    // While a reply is pending the composer's send/talk button becomes Stop; Send and Talk stay hidden for the whole turn so a tap after the request ends cannot start voice.
    const turn=!!this.S().typing;
    out.sendVisible=!!out.hasDraft&&!turn;out.talkVisible=!!out.noDraft&&!turn;out.replyIdle=!turn;
    out.stopReply=()=>{connectionController.cancelViewNavigation();alphaClient.cancel();};
    if (isAndroid) {
      out.showStatus = false; out.showIndicator = false;
      const style = out.sbColor === 'var(--alpha-white)' ? SystemBarsStyle.Dark : SystemBarsStyle.Light;
      if (this.barStyle !== style) { this.barStyle = style; void SystemBars.setStyle({ style }).catch(() => {}); }
    }
    out.shadeN = (out.shadeN || []).filter((n: Shell) => n.id !== 'n4');
    out.headsOk = () => this.toast('Connect Messages before replying. Nothing has been sent.');
    if (isAndroid) {
      // Tile state comes only from native facts; each tile hands off to its own settings page.
      const facts:TileFacts=this.S().q?.tileFacts||{};
      out.tiles = honestTiles(out.tiles || [], facts, { flashlight: this.flashlightAvailable !== false, act: key => void this.tileAction(key) });
      out.onBright = () => void this.displayHandoff();
    } else {
      out.tiles = (out.tiles || []).map((tile: Shell) => ({ ...tile, pressed: undefined, toggle: () => void DailyApps.perform({ action: 'settings' }).catch(() => this.toast('Android settings is unavailable.')) }));
      out.onBright = () => void DailyApps.perform({ action: 'settings' }).catch(() => this.toast('Android settings is unavailable.'));
    }
    return out;
  };
  /** Read tile facts when the shade opens. A failed read leaves every tile without a state. */
  p.refreshTileFacts = function () {
    if (!isAndroid) return;
    // A read already in flight may predate the change: read once more when it settles.
    if (this.tileFactsReading) { this.tileFactsAgain = true; return; }
    this.tileFactsReading = true;
    void alphaDevice.snapshot().then(snapshot => tileFactsFromSnapshot(snapshot, this.flashlightOn), () => tileFactsFromSnapshot(null, this.flashlightOn))
      .then(tileFacts => { if (this.live) this.setState((previous: Shell) => ({ q: { ...previous.q, tileFacts } })); })
      .finally(() => { this.tileFactsReading = false; if (this.tileFactsAgain) { this.tileFactsAgain = false; if (this.live) this.refreshTileFacts(); } });
  };
  p.tileAction = async function (key: TileKey | null) {
    if (key === 'torch') {
      // A direct control: request the opposite of the last confirmed state and show what Android reports.
      try {
        const result = await elizaSystem.setFlashlight({ enabled: this.flashlightOn !== true });
        if (!result?.available) { this.flashlightAvailable = false; this.flashlightOn = undefined; this.toast('This phone has no flashlight Alpha can control.'); }
        else this.flashlightOn = result.enabled === true;
      } catch (error) {
        this.flashlightOn = undefined;
        // ElizaSystem refuses definitively when the phone has no controllable flashlight: hide the tile.
        if (/does not have an available flashlight|requires Android 6/.test(error instanceof Error ? error.message : '')) { this.flashlightAvailable = false; this.toast('This phone has no flashlight Alpha can control.'); }
        else this.toast('The flashlight state could not be confirmed.');
      }
      if (this.live) this.setState((previous: Shell) => ({ q: { ...previous.q, tileFacts: { ...(previous.q?.tileFacts || {}), torch: this.flashlightOn } } }));
      if (this.flashlightOn === undefined && this.live) this.setState((previous: Shell) => { const tileFacts = { ...(previous.q?.tileFacts || {}) }; delete tileFacts.torch; return { q: { ...previous.q, tileFacts } }; });
      return;
    }
    const page = key ? tileSettingsPages[key] : undefined;
    // Alpha cannot change these switches: the tile opens the Android page; the shade re-reads on return.
    try { if (!page) throw Error('No settings page'); const notice = broaderPageNotice(page, await alphaDevice.openSettings({ page })); if (notice) this.toast(notice); }
    catch { await DailyApps.perform({ action: 'settings' }).then(result => this.toast(result?.status === 'opened' ? 'Opened Android Settings. This phone has no separate page for that switch.' : 'Android settings is unavailable.'), () => this.toast('Android settings is unavailable.')); }
  };
  /** Brightness is a Display settings handoff: one per gesture, never a value Alpha claims to set. */
  p.displayHandoff = async function () {
    this.brightnessGate ||= handoffGate();
    if (!this.brightnessGate.begin()) return;
    try { await alphaDevice.openSettings({ page: 'display' }); }
    catch { this.toast('Display settings are unavailable.'); }
    finally { this.brightnessGate.end(); }
  };
  p.voiceConversationCurrent = function(prepared:{binding:import('../runtime/alpha-client').VoiceConversationBinding;context:import('../runtime/alpha-client').ContextEnvelope}){return !alphaClient.getState().context.sensitive&&connectionController.voiceConversationCurrent(prepared.binding)&&JSON.stringify(alphaClient.getState().context)===JSON.stringify(prepared.context);};
  p.voiceConversationContext = function(binding:import('../runtime/alpha-client').VoiceConversationBinding){const value=alphaClient.getState().context;if(!this.live||document.hidden||value.sensitive||!connectionController.voiceConversationCurrent(binding))throw Error('The voice conversation changed.');return value;};
  p.prepareVoiceConversation = async function(signal:AbortSignal){
    if(!connectionController.getSnapshot().session)throw Error(residentAlwaysPresent?(connectionController.getSnapshot().kind==='recovering'?RESIDENT_RECOVERING_NOTICE:RESIDENT_STARTING_NOTICE):NO_AGENT_VOICE);
    signal.throwIfAborted();context(this);if(alphaClient.getState().context.sensitive)throw Error('Return to Home or another app before starting voice.');const expected=JSON.stringify(alphaClient.getState().context);
    const binding=await connectionController.prepareVoiceConversation(signal);signal.throwIfAborted();
    await this.draftBindingTask;signal.throwIfAborted();context(this);
    if(!this.live||document.hidden||!connectionController.voiceConversationCurrent(binding)||JSON.stringify(alphaClient.getState().context)!==expected)throw Error('The voice conversation changed.');
    await this.connectAgent();signal.throwIfAborted();
    if(!this.live||document.hidden||!connectionController.voiceConversationCurrent(binding)||JSON.stringify(alphaClient.getState().context)!==expected)throw Error('The voice conversation changed.');
    return {binding,context:alphaClient.getState().context};
  };
  // An authenticated voice socket carries only navigation targets, never record parameters.
  // Reuse the same shell projection and post-React context fence as completed chat actions.
  p.applyRealtimeVoiceNavigation = async function(input:import("../runtime/development-cartesia-conversation").RealtimeVoiceNavigation & {binding:import('../runtime/alpha-client').VoiceConversationBinding;assertCurrent:()=>void;navigation:import('../runtime/alpha-client').VoiceNavigationContinuation}){
    input.assertCurrent();const target=alphaViewKey(input.viewId);
    if(input.subview||!target||input.viewPath&&!alphaViewPaths(input.viewId).includes(input.viewPath))throw Error('That voice screen is not available.');
    const current=()=>{input.assertCurrent();if(!this.live||document.hidden||!connectionController.voiceConversationCurrent(input.binding))throw Error('The voice conversation changed.');};
    let delivered=false;try{
      const prepared=Object.hasOwn(input,'navigationPrepared')||Object.hasOwn(input,'navigationBinding')||Object.hasOwn(input,'completedActionHandoffId');
      if(prepared){
        const capture=connectionController.captureViewNavigation(this.voiceConversationContext(input.binding));
        const result={actionName:'VIEWS_SHOW',success:true,values:{mode:'show',viewId:input.viewId,...(input.viewPath?{viewPath:input.viewPath}:{}),...(input.subview?{subview:input.subview}:{}),navigationPrepared:input.navigationPrepared,navigationBinding:input.navigationBinding,completedActionHandoffId:input.completedActionHandoffId}};
        delivered=await deliverChatNavigation(this,capture,[result],current,input.navigation);
        if(!delivered)throw Error('The voice screen change could not be confirmed.');
        return true;
      }
      delivered=await input.navigation.apply(target,current,(chat,onCommitted)=>new Promise<boolean>((resolve,reject)=>{try{current();if(!openInternalView(this,target,chat)){resolve(false);return;}this.setState({},()=>{try{current();context(this);const switched=(this.S().view||'home')===target&&!alphaClient.getState().context.sensitive;if(switched)onCommitted(alphaClient.getState().context);resolve(switched);}catch(error){reject(error);}});}catch(error){reject(error);}}));return delivered;}finally{input.navigation.finish(delivered);}
  };
  p.sendVoiceTurn = async function(input:{text:string;turnId:string;voiceTurnSignal:import('../runtime/alpha-client').VoiceTurnSignal;signal:AbortSignal;binding:import('../runtime/alpha-client').VoiceConversationBinding;context:import('../runtime/alpha-client').ContextEnvelope;assertCurrent:()=>void;onProgress?:(value:BatchProgressCue)=>void;onReplyStarted?:()=>void;navigation?:import('../runtime/alpha-client').VoiceNavigationContinuation}){
    const {text,turnId,signal,binding}=input;let acceptedContext=input.context;
    const belongs=()=>{try{signal.throwIfAborted();input.assertCurrent();return this.live&&!document.hidden&&connectionController.voiceConversationCurrent(binding)&&JSON.stringify(alphaClient.getState().context)===JSON.stringify(acceptedContext);}catch{return false;}};
    const current=()=>{signal.throwIfAborted();input.assertCurrent();context(this);if(!belongs())throw Error('The voice conversation changed.');};
    current();if(alphaClient.getState().pending||this.S().typing||this.draftSendPending)throw Error('Wait for the current conversation turn.');
    this.voiceSendTurnId=turnId;
    const navigation=connectionController.captureViewNavigation(input.context),userId=crypto.randomUUID(),streamId=crypto.randomUUID();let streamed=false;
    try{
      await new Promise<void>(resolve=>this.setState((previous:Shell)=>belongs()?{msgs:[...previous.msgs,{id:userId,from:'user',text}],typing:true}:null,resolve));
      current();
      const progress=(event:Event)=>{const value=(event as CustomEvent<BatchProgressCue>).detail;if(belongs()&&value.turnId===turnId&&value.conversationId===binding.conversationId&&value.ownerId===binding.session.ownerId)input.onProgress?.(value);};
      const replyStarted=(event:Event)=>{const value=(event as CustomEvent<BatchProgressCue>).detail;if(belongs()&&value.turnId===turnId&&value.conversationId===binding.conversationId&&value.ownerId===binding.session.ownerId)input.onReplyStarted?.();};
      batchVoiceProgressEvents.addEventListener('progress',progress);
      batchVoiceReplyEvents.addEventListener('reply',replyStarted);
      let reply;
      try{reply=await alphaClient.send(text,value=>{current();streamed=true;this.setState((previous:Shell)=>belongs()?{msgs:previous.msgs.some((m:Shell)=>m.id===streamId)?previous.msgs.map((m:Shell)=>m.id===streamId?{...m,text:value}:m):[...previous.msgs,{id:streamId,from:'agent',text:value,streaming:true}]}:null);},undefined,undefined,{channelType:'VOICE_DM',requestId:turnId,signal,expectedConversationId:binding.conversationId,voiceTurnSignal:input.voiceTurnSignal});}
      finally{batchVoiceProgressEvents.removeEventListener('progress',progress);batchVoiceReplyEvents.removeEventListener('reply',replyStarted);}
      input.onReplyStarted?.();
      current();const identity=reply.messageBinding;
      if(!reply.messageId||!reply.userMessageId||!identity||identity.conversationId!==binding.conversationId||JSON.stringify(identity.session)!==JSON.stringify(binding.session)||!reply.text.trim())throw Error('The voice reply could not be matched to this conversation. Check history before speaking again.');
      await new Promise<void>(resolve=>this.setState((previous:Shell)=>belongs()?(()=>{const delivered=(id?:string)=>!!id&&previous.msgs.some((m:Shell)=>m.id===id);const kept=previous.msgs.filter((m:Shell)=>m.id!==streamId&&!(m.id===userId&&delivered(reply.userMessageId))).map((m:Shell)=>m.id===userId?{...m,id:reply.userMessageId,messageBinding:identity}:m);return {msgs:delivered(reply.messageId)?kept.map((m:Shell)=>m.id===reply.messageId?enrichSettledAssistant(m,planActionCard(reply.planAction),identity):m):[...kept,{id:reply.messageId,from:'agent',text:reply.text,messageBinding:identity,streaming:false,card:planActionCard(reply.planAction)??null}]};})():null,resolve));current();
      const delivered=await deliverChatNavigation(this,navigation,reply.actionResults,current,input.navigation);
      const nextContext=input.navigation?.finish(delivered);if(nextContext)acceptedContext=nextContext;
      current();
      if(delivered&&reply.userMessageId){
        const results=await connectionController.continueRequestedCamera(reply.userMessageId,signal);
        for(const result of results)this.agentSay(result.summary,undefined,{id:`device-receipt:${result.proposalId}`,deviceReceipt:true});
      }
      const awaiting=reply.proposals?.filter(proposal=>proposal.readReply?.origin.requestId===turnId&&proposal.readReply.origin.conversationId===identity.conversationId&&proposal.readReply.origin.inReplyTo===reply.userMessageId);
      if(awaiting&&awaiting.length>1)throw Error('More than one Notes review was returned. Use action history.');
      for(const proposal of reply.proposals||[]){retainReadReply(this,proposal,identity,reply.userMessageId);this.agentSay(proposal.description,proposalCard(proposal),undefined,belongs);}
      for(const completed of reply.completedReads||[]){
        current();retainReadReply(this,completed.proposal,identity,reply.userMessageId);
        await completeReadReply(this,completed.receipt);current();
      }
      for(const receipt of reply.completedActions||[])if(!(reply.completedReads||[]).some(read=>read.receipt.proposalId===receipt.proposalId))this.agentSay(receipt.summary,undefined,{id:`device-receipt:${receipt.proposalId}`,deviceReceipt:true});
      const completedActions=reply.completedActions;
      if(completedActions?.length)this.setState({},()=>{if(this.live&&connectionController.voiceConversationCurrent(binding,false))for(const receipt of completedActions)publishCommittedDeviceChanges(receipt,alphaClient,binding.session);});
      return {requestId:turnId,conversationId:identity.conversationId,userMessageId:reply.userMessageId,assistantMessageId:reply.messageId,text:reply.text,complete:!reply.proposals?.length,...(reply.proposals?.length?{reviewRequired:true}:{}),...(awaiting?.length?{awaitingUserInput:{proposalId:awaiting[0].id,digest:awaiting[0].readReply!.digest}}:{})};
    }catch(error){
      input.navigation?.finish(false);
      if(streamed&&this.live)this.setState((previous:Shell)=>this.voiceSendTurnId===turnId&&connectionController.voiceConversationCurrent(binding,false)?{msgs:previous.msgs.map((m:Shell)=>m.id===streamId?{...m,streaming:false,interrupted:true}:m)}:null);
      throw error;
    }finally{if(this.voiceSendTurnId===turnId&&this.live)await new Promise<void>(resolve=>this.setState(()=>this.voiceSendTurnId===turnId&&connectionController.voiceConversationCurrent(binding,false)?{typing:false}:null,()=>{if(this.voiceSendTurnId===turnId)this.voiceSendTurnId=undefined;resolve();}));}
  };
  p.send = async function (argument?: string, expectedSession?: {sessionId:string;agentId:string;ownerId:string;origin:string}, focusAfterCommit?:()=>void) {
    const before=this.S(),reply=this.messageReplyTarget,edit=this.messageEditTarget;
    const sendBinding=()=>JSON.stringify([connectionController.getSnapshot().session,connectionController.getSnapshot().history?.conversationId,connectionController.getCloudEnvironment?.(),connectionController.getCloudClient()?.sessionId,connectionController.getCloudClient()?.credentialId]);
    if(this.stopVoiceConversation)context(this);const expectedContext=JSON.stringify(alphaClient.getState().context);
    const binding=this.stopVoiceConversation?sendBinding():undefined,draft=String(before.draft||''),view=before.view;
    const retiring=this.stopVoiceConversation?.();if(retiring){await retiring;context(this);const now=this.S();if(JSON.stringify(alphaClient.getState().context)!==expectedContext||!this.live||document.hidden||connectionController.getSnapshot().open||sendBinding()!==binding||now.view!==view||String(now.draft||'')!==draft||this.messageReplyTarget!==reply||this.messageEditTarget!==edit)return;}
    let s = this.S(); const text = String(argument ?? s.draft);
    if (!text.trim() || s.typing || this.draftSendPending || this.composerDraft?.holding) return;
    // A prompt sent from elsewhere (a suggestion, a Calendar decision, a reviewed email) is not the
    // composer's text: the composer keeps its draft, its saved copy, its reply target and source.
    const fromComposer=argument===undefined;
    const editTarget:ConversationMessageTarget|undefined=this.messageEditTarget,replyTarget:ConversationMessageTarget|undefined=fromComposer?this.messageReplyTarget:undefined,editView=s.view;
    if(editTarget){
      if(argument!==undefined||!connectionController.messageTargetCurrent(editTarget))return;
      this.draftSendPending=true;
      try {
        if(!await messageReviews.confirm('edit-message-'+editTarget.messageId,'Edit and resend message','This replaces the selected message and all later messages in this conversation. It does not undo actions that already ran.\n\nOriginal: '+editTarget.text+'\n\nReplacement: '+text,'Edit and resend'))return;
        if(!this.live||document.hidden||String(this.S().draft)!==text||!connectionController.messageTargetCurrent(editTarget))throw Error('The draft or conversation changed. Nothing was replaced.');
        await connectionController.truncateMessage(editTarget);this.messageEditTarget=undefined;s=this.S();
        if(!this.live||document.hidden||s.view!==editView||String(s.draft)!==text)throw Error('History was replaced. Your draft changed, so nothing was resent.');
      } catch(error){if(error&&typeof error==='object'&&'historyChanged' in error)this.messageEditTarget=undefined;this.toast(error instanceof Error?error.message:'Message replacement failed.');return;}
      finally{this.draftSendPending=false;}
    }
    const sourceDraft=fromComposer&&this.reviewedSourceDraft?.draft===text?sourceOf(this.reviewedSourceDraft.source):undefined;
    context(this);
    const revision=alphaClient.getState().context.revision,connection=connectionController.getSnapshot(),sessionId=connection.session?.sessionId,conversationId=connection.history?.conversationId;
    const current=()=>{const selected=connectionController.getSnapshot();return this.live&&!document.hidden&&!selected.busy&&!selected.open&&!document.querySelector('[data-alpha-chat-recorder],[data-alpha-pill-voice]')&&selected.session?.sessionId===sessionId&&selected.history?.conversationId===conversationId&&alphaClient.getState().context.revision===revision;};
    const heldText=String(s.draft||'');let heldKey:string|undefined;
    if(fromComposer){
      this.draftSendPending=true;
      // The durable draft keeps this text until the message is known to have been dispatched.
      try{await this.draftBindingTask;heldKey=this.composerDraft.binding;await this.composerDraft.hold(heldText,current);}catch(error){this.toast(error instanceof Error?error.message:'Draft could not be prepared. Nothing was sent.');return;}finally{this.draftSendPending=false;}
    }
    const reviewedSource=fromComposer?this.reviewedSourceDraft:null;if(fromComposer)this.reviewedSourceDraft=null;
    // Everything this send later shows belongs to the agent connection it was sent on.
    const sameChat=()=>connectionController.getSnapshot().session?.sessionId===sessionId;
    const attempt:SendAttempt=this.sendAttempt={transportCalled:false,preDispatch:false,streamed:false};
    const userId=crypto.randomUUID(),streamedId=crypto.randomUUID();let streamed=false;
    const replaceStream=(value:string,streaming=true)=>this.setState((previous:Shell)=>({msgs:previous.msgs.map((message:Shell)=>message.id===streamedId?{...message,text:value,streaming}:message)}));
    this.setState({ msgs: [...s.msgs, { id: userId, from: 'user', text }], ...(fromComposer?{draft:''}:{}), typing: true, chat: s.chat === 'full' ? 'full' : 'sheet', shade: false },focusAfterCommit);
    let navigation:ReturnType<typeof connectionController.captureViewNavigation>|undefined,readyNavigation:readonly unknown[]|undefined;
    const deliverNavigation=(results:readonly unknown[]|undefined)=>deliverChatNavigation(this,navigation,results);
    try {
      try{
        await this.connectAgent(); context(this);
        if (alphaClient.getState().context.revision !== revision) throw new NotDispatched(fromComposer?'The active screen changed. Your message is back in the composer.':'The active screen changed. Nothing was sent.');
        if(expectedSession&&(JSON.stringify(connectionController.getSnapshot().session)!==JSON.stringify(expectedSession)||document.hidden))throw new NotDispatched('Agent changed. Review this message again.');
      }catch(error){throw error instanceof NotDispatched?error:new NotDispatched(error instanceof Error?error.message:'The agent connection is unavailable. Nothing was sent.');}
      const sourceSession=connectionController.getSnapshot().session;
      navigation=connectionController.captureViewNavigation(alphaClient.getState().context);
      // The request becomes pending after the render above; render again so Stop is offered before any streamed text.
      queueMicrotask(()=>{if(this.live&&alphaClient.getState().pending)this.setState({});});
      // The planning label shows only until the first reply text; it is never kept as a message.
      const showStatus=(event:Event)=>{if(this.live&&!streamed&&this.sendAttempt===attempt)this.setState({turnStatus:(event as CustomEvent<string>).detail});};
      localTurnStatus.addEventListener('label',showStatus);
      let reply;
      try{reply = await alphaClient.send(text,value=>{
        attempt.streamed=true;
        if(!this.live)return;
        if(streamed)replaceStream(value);
        else{streamed=true;this.setState((previous:Shell)=>({turnStatus:'',msgs:[...previous.msgs,{id:streamedId,from:'agent',text:value,card:null,streaming:true}]}));}
      },replyTarget,results=>{readyNavigation=results;});}
      finally{localTurnStatus.removeEventListener('label',showStatus);}
      // Only the composer's own send holds its draft; a prompt from elsewhere never settles it.
      if(fromComposer)await this.composerDraft?.commit();
      if (!this.live||!sameChat()) return;
      const identity=reply.messageBinding;
      const planCard=planActionCard(reply.planAction);
      const settlementCurrent=()=>this.live&&sameChat()&&JSON.stringify(connectionController.getSnapshot().session)===JSON.stringify(sourceSession)&&(!identity||connectionController.getSelectedConversationId()===identity.conversationId);
      if(!settlementCurrent())return;
      // A conversation delivery can land the saved reply before this rename; keep its content and enrich only a missing plan control.
      if(streamed)this.setState((previous:Shell)=>settlementCurrent()?{msgs:reply.messageId&&previous.msgs.some((m:Shell)=>m.id===reply.messageId)?previous.msgs.filter((m:Shell)=>m.id!==streamedId).map((m:Shell)=>m.id===reply.messageId?enrichSettledAssistant(m,planCard,identity):m):previous.msgs.map((m:Shell)=>m.id===streamedId?{...m,id:reply.messageId||m.id,messageBinding:reply.messageId?identity:undefined,text:reply.text,streaming:false,...(planCard?{card:planCard}:{})}:m)}:null);else this.agentSay(reply.text,planCard,reply.messageId&&identity?{id:reply.messageId,messageBinding:identity}:undefined,settlementCurrent);
      if(reply.userMessageId&&identity)await new Promise<void>(resolve=>this.setState((previous:Shell)=>settlementCurrent()?{msgs:previous.msgs.map((m:Shell)=>m.id===userId?{...m,id:reply.userMessageId,messageBinding:identity}:m)}:null,resolve));
      if(this.messageReplyTarget===replyTarget)this.messageReplyTarget=undefined;
      let cameraOpened=false;
      if(sourceDraft&&sourceSession&&JSON.stringify(sourceSession)===JSON.stringify(connectionController.getSnapshot().session))this.agentSay('Review this answer before saving it with its source.',{type:'generic',icon:'note',title:'Review summary note',sub:sourceDraft.name,sourceSummary:{source:sourceDraft,text:reply.text,session:sourceSession}});
      for (const proposal of reply.proposals || []) {retainReadReply(this,proposal,identity,reply.userMessageId);this.agentSay(proposal.description,proposalCard(proposal));}
      for(const completed of reply.completedReads||[]){
        retainReadReply(this,completed.proposal,identity,reply.userMessageId);
        try{await completeReadReply(this,completed.receipt);}catch{if(this.live&&sameChat())this.agentSay('The note was shared, but its answer is unconfirmed. Check conversation history before trying again.');}
      }
      try{
        const delivered=await deliverNavigation(reply.actionResults);
        cameraOpened=delivered&&alphaClient.getState().context.view==='camera';
        if(delivered&&reply.userMessageId){
          const results=await connectionController.continueRequestedCamera(reply.userMessageId,new AbortController().signal);
          for(const result of results)if(this.live)this.agentSay(result.summary,undefined,{id:`device-receipt:${result.proposalId}`,deviceReceipt:true});
        }
      }catch(error){if(this.live)this.toast(error instanceof Error?error.message:'Could not confirm the screen change. Check your screen.');}
      for(const notice of replyNotices(reply)){
        if(cameraOpened&&alphaClient.getState().context.view==='camera'&&notice==='Take photo: '+CAMERA_CONTEXT_NOTICE)continue;
        this.agentSay(notice,{type:'generic',icon:'info',title:'Phone action not shown here',sub:notice,systemNotice:true,done:true});
      }
      for(const receipt of reply.completedActions||[])if(!(reply.completedReads||[]).some(read=>read.receipt.proposalId===receipt.proposalId))this.agentSay(receipt.summary,undefined,{id:`device-receipt:${receipt.proposalId}`,deviceReceipt:true});
      const completedActions=reply.completedActions;
      if(identity&&completedActions?.length)this.setState({},()=>{if(this.live&&sameChat())for(const receipt of completedActions)publishCommittedDeviceChanges(receipt,alphaClient,identity.session);});
    } catch (e) {
      let opened=false;
      if(this.live&&e instanceof AlphaClientError&&e.code==='transport-failed'&&readyNavigation){try{opened=await deliverNavigation(readyNavigation);}catch{}}
      const message=opened?'The screen opened, but the conversation response was interrupted. Check history before sending again.':e instanceof Error?e.message:'The agent could not complete this request.';
      await transportSettled(attempt);
      if(!dispatched(attempt,e)){
        // Nothing reached the agent: put the text back and drop the unsent bubble. Never resend.
        if(this.live){const inlineNotice=fromComposer&&privateLocalPreviewEnabled&&this.composerDraft?.holding===true;this.setState((previous:Shell)=>({msgs:previous.msgs.filter((item:Shell)=>item.id!==userId)}));if(fromComposer)releaseComposerSend(this,heldKey,heldText);if(reviewedSource&&!this.reviewedSourceDraft)this.reviewedSourceDraft=reviewedSource;if(!inlineNotice)this.toast(e instanceof NotDispatched?message:e instanceof AlphaClientError&&(['unconfigured','sensitive','busy'].includes(e.code)||(e as {refusedBeforeTurn?:unknown}).refusedBeforeTurn===true)?'Not sent. '+message:fromComposer?'Not sent. Your message is back in the composer.':'Not sent.');}
        else if(fromComposer)this.composerDraft?.release();
      }else{
        if(pageLeaving){if(fromComposer)this.composerDraft?.abandon();return;}
        if(fromComposer)await this.composerDraft?.commit();
        // The agent recorded the user turn before the reply failed: the sent bubble adopts its
        // message identity, as on success, so a later conversation re-read merges onto it.
        const recorded=e&&typeof e==='object'?e as {userMessageId?:unknown;messageBinding?:unknown}:{};
        if(this.live&&sameChat()&&typeof recorded.userMessageId==='string'&&recorded.messageBinding&&typeof recorded.messageBinding==='object')this.setState((previous:Shell)=>({msgs:previous.msgs.map((item:Shell)=>item.id===userId?{...item,id:recorded.userMessageId,messageBinding:recorded.messageBinding}:item)}));
        // After Stop the controller cancels, announces and reconciles once; its notice is the one shown.
        const reconciling=!!connectionController.getSnapshot().replyNotice&&e instanceof AlphaClientError&&e.code==='cancelled';
        // The owner changed mid-turn: say it was interrupted, but never show the previous agent's partial
        // reply or offer a history check that could only read a different agent.
        if(this.live&&!sameChat())this.setState((previous:Shell)=>({...(!opened?{chat:previous.chat==='full'?'full':'sheet'}:{}),msgs:[...(previous.msgs||[]),{id:crypto.randomUUID(),from:'agent',text:message+' Your message may have reached the previous agent connection. Check its saved conversations before sending it again.',card:null,interrupted:true}]}));
        else if(this.live&&e instanceof AlphaClientError&&typeof (e as {failureKind?:unknown}).failureKind==='string'){
          // The agent recorded the turn and reported why it failed: say so and offer the next step.
          // Nothing is resent, so no history check is offered.
          // A provider-less turn of the on-device agent (no plan, offline, signed out) carries the
          // honest in-conversation answer and its plan action (Redeem / Choose a plan, Sign in, Check again).
          const planCard=planActionCard((e as {planAction?:unknown}).planAction);
          if(streamed)this.setState((previous:Shell)=>({msgs:previous.msgs.map((item:Shell)=>item.id===streamedId?{...item,streaming:false,interrupted:true,text:`${item.text}\n\n${message}`,...(planCard?{card:planCard}:{})}:item)}));
          else this.setState((previous:Shell)=>({chat:previous.chat==='full'?'full':'sheet',msgs:[...(previous.msgs||[]),{id:crypto.randomUUID(),from:'agent',text:message,card:planCard??null,interrupted:true}]}));
          const limit=(e as {serviceLimit?:unknown}).serviceLimit;
          // A plan or billing refusal offers Cloud's plan page only; nothing is bought or upgraded here.
          // A billing refusal that already carries the subscription / membership code card says nothing more.
          if((limit==='billing-refused'&&!planCard||limit==='subscription-required'||limit==='allowance-exhausted')&&connectionController.getSnapshot().kind==='resident')this.agentSay(limit==='subscription-required'?`Your ${selectedCloudName()} plan needs attention before your agent can answer.`:`Your ${selectedCloudName()} billing needs attention before your agent can answer.`,{type:'generic',icon:'info',title:limit==='subscription-required'?`Manage plan in ${selectedCloudName()}`:`Manage billing in ${selectedCloudName()}`,sub:`Opens ${selectedCloudName()} billing in your browser. Nothing is sent or purchased.`,managePlan:true});
        }
        else if(this.live&&reconciling){if(streamed)this.setState((previous:Shell)=>({msgs:previous.msgs.map((item:Shell)=>item.id===streamedId?{...item,streaming:false,interrupted:true,text:`${item.text}\n\nStopped.`}:item)}));}
        else if (this.live) {
          // The agent may have received this message; say so plainly and never resend it.
          const recoveryText=message==='The agent request failed. Check connection and action history before sending another request.'?'Sorry, I couldn’t finish that reply.':message;
          if(streamed)this.setState((previous:Shell)=>({msgs:previous.msgs.map((item:Shell)=>item.id===streamedId?{...item,streaming:false,interrupted:true,text:`${item.text}\n\n${recoveryText}`}:item)}));
          else this.setState((previous:Shell)=>({...(!opened?{chat:previous.chat==='full'?'full':'sheet'}:{}),msgs:[...(previous.msgs||[]),{id:crypto.randomUUID(),from:'agent',text:recoveryText,card:null,interrupted:true}]}));
        }
      }
    }
    finally { if(this.sendAttempt===attempt)this.sendAttempt=null; if (this.live) this.setState({ typing: false, turnStatus: '' }); }
  };
  p.agentSay = function (text: string, card?: Shell, identity?:{id?:string;messageBinding?:{conversationId:string;session:unknown};deviceReceipt?:true},current?:()=>boolean) {
    this.setState((previous: Shell) => {
      if(current&&!current())return null;
      if(identity?.id){
        const delivered=(previous.msgs||[]).find((message:Shell)=>message.id===identity.id);
        if(delivered){const enriched=enrichSettledAssistant(delivered,card,identity.messageBinding);return enriched===delivered?null:{msgs:previous.msgs.map((message:Shell)=>message===delivered?enriched:message)};}
      }
      const chat = previous.chat === 'full' ? 'full' : 'sheet';
      // Recovery and a chat reply can publish the same pending action. Decide
      // inside the state update so either arrival order retains one approval.
      if (card?.proposalId && (previous.msgs || []).some((message: Shell) => message.card?.proposalId === card.proposalId)) return { chat };
      return { chat, msgs: [...(previous.msgs || []), { id: crypto.randomUUID(), ...identity, from: 'agent', text, card: card || null }] };
    });
  };
  p.reply = function () { return { text: agentPendingText() }; };
  p.declineCard = async function (message: Shell) {
    const card = message.card || {};
    if(!card.proposalId||card.done||this.pendingActionApproval||this.decliningProposal)return;
    if(card.recovered&&JSON.stringify(card.proposalSession)!==JSON.stringify(connectionController.getSnapshot().session)){this.agentSay('The agent changed. Review this action again.');return;}
    const sessionId=connectionController.getSnapshot().session?.sessionId;
    this.decliningProposal=card.proposalId;this.setState({});
    let result:{ok:boolean;message:string};
    try{result=await declineProposal(card.proposalId);}finally{this.decliningProposal=null;}
    if(!this.live)return;
    if(!result.ok||connectionController.getSnapshot().session?.sessionId!==sessionId){this.setState({});this.agentSay(result.ok?'The agent changed. Check phone action history.':result.message);return;}
    this.setState({ msgs: this.S().msgs.map((m: Shell) => m.id === message.id ? { ...m, card: { ...m.card, done: true, declined: true, title: 'Declined', sub: result.message } } : m) });
  };
  p.cardAct = async function (message: Shell) {
    const card = message.card || {};
    if(card.systemNotice)return;
    if(card.managePlan){void connectionController.residentManagePlan();return;}
    // The running agent has no Eliza Cloud AI: open the plan panel (Redeem code, Choose a plan),
    // sign in, or check Cloud again. Nothing is purchased or sent from here.
    if(card.planAction){
      if(card.planAction==='plan')connectionController.openPlan();
      else if(card.planAction==='funding')connectionController.openFunding();
      else if(card.planAction==='sign-in')void connectionController.residentCloudLogin();
      else connectionController.recheckPlanOnReturn();
      return;
    }
    if(card.checkReply&&!card.done){
      const session=connectionController.getSnapshot().session;
      if(!session||session.sessionId!==card.checkReply.sessionId){this.toast('The agent changed. Open its saved conversations in Settings instead. Nothing was sent.');return;}
      if(this.S().typing){this.toast('Wait for the current reply before checking. Nothing was sent.');return;}
      let id:unknown;
      try{id=JSON.parse(await connectionController.assistantDraftBinding(new AbortController().signal)).at(-1);}catch{id=null;}
      if(typeof id!=='string'||!id){this.toast('No saved conversation is available to check yet. Nothing was sent.');return;}
      // Restoring reads the agent's own history; it never posts the message again.
      await connectionController.restoreHistory(id);
      return;
    }
    if(card.sourceSummary&&!card.done){
      const review=card.sourceSummary,recording=recordingSourceOf(review.source);
      const recordingNote=recording&&this.vget('notes').list.find((n:Shell)=>n.id===recording.noteId);
      const expectedRecording=recordingNote&&JSON.stringify(recordingNote);
      const current=()=>this.live&&!document.hidden&&!connectionController.getSnapshot().open&&JSON.stringify(connectionController.getSnapshot().session)===JSON.stringify(review.session)&&this.S().msgs.some((m:Shell)=>m.id===message.id&&!m.card?.done)&&(!recording||JSON.stringify(this.vget('notes').list.find((n:Shell)=>n.id===recording.noteId))===expectedRecording);
      if(!current()){this.toast('Agent or conversation changed. Ask about the source again.');return;}
      if(recording&&(!recordingNote?.audio||await recordingRevision(recordingNote)!==recording.revision||!current())){this.toast('Recording changed or is unavailable. Ask about its current transcript again.');return;}
      this.closeSummaryReview?.();
      this.closeSummaryReview=reviewSummaryNote({text:review.text,source:review.source,current,save:async(fields)=>{
        if(!current()||this.notesStorageFailed||this.notesPending)return false;
        const update=(title:string,sub:string)=>{if(this.live)this.setState({msgs:this.S().msgs.map((m:Shell)=>m.id===message.id?{...m,card:{...m.card,done:true,title,sub}}:m)});};
        update('Saving summary note','Inspect Notes before retrying if this is interrupted.');
        try{
          const existing=this.vget('notes').list;
          const list=recording?existing.map((n:Shell)=>n.id===recording.noteId?{...n,summary:[fields.body],actions:fields.actions||[],onCal:false,when:'Now',modifiedAt:Date.now()}:n):[{id:crypto.randomUUID(),kind:'text',...fields,pinned:false,when:'Now',createdAt:Date.now(),modifiedAt:Date.now()},...existing];
          const saved=await this.vset('notes',{list})===true;update(saved?(recording?'Recording summary saved':'Summary note saved'):'Check Notes before retrying',saved?(recording?.name||fields.documentSource?.name||fields.webSource?.name||'Source'):'Save is unconfirmed.');return saved;
        }
        catch{update('Check Notes before retrying','Save is unconfirmed.');return false;}
      },complete:()=>{if(this.live)this.toast(recording?'Recording summary saved. No reminders scheduled.':'Summary note saved with its source.');}});
      return;
    }
    if (card.proposalId && !card.done) {
      if(card.reviewUnavailable||this.pendingActionApproval||this.decliningProposal)return;
      if(card.expiresAt<=Date.now()){
        this.setState((previous:Shell)=>({msgs:previous.msgs.map((m:Shell)=>m.id===message.id?{...m,card:{...m.card,reviewUnavailable:true,title:'Review expired',sub:'This review has expired. Request a new action if still needed.'}}:m)}));return;
      }
      try {
        context(this);
        const session=connectionController.getSnapshot().session;
        if(card.recovered&&JSON.stringify(card.proposalSession)!==JSON.stringify(session))throw Error('The agent changed. Review this action again.');
        if(card.reviewDestination==='home'){this.goHome('sheet');return;}
        if(card.reviewDestination==='calendar'){
          if(!this.live||document.hidden||!session||alphaClient.getState().context.sensitive||!['home','calendar'].includes(alphaClient.getState().context.view))throw Error('Open the unlocked app to choose the event.');
          if(!openInternalView(this,'calendar','sheet'))throw Error('Calendar is unavailable.');
          context(this);this.setState({});return;
        }
        if(card.reviewDestination==='notes'){
          // Navigation only: the existing SDK still requires a fresh exact selection
          // and a separate approval before any update, deletion or journaled operation.
          const expectedTarget=notesTarget(card.reviewNoteTarget);
          const store=this.notesStore,expectedContext=JSON.stringify(alphaClient.getState().context),expectedSession=JSON.stringify(session);
          const current=()=>{
            context(this);
            if(card.reviewUnavailable||card.expiresAt<=Date.now()||!store||!this.live||document.hidden||alphaClient.getState().context.sensitive||!['home','notes'].includes(this.S().view||'home')||connectionController.getSnapshot().open||JSON.stringify(connectionController.getSnapshot().session)!==expectedSession||JSON.stringify(alphaClient.getState().context)!==expectedContext||this.notesStore!==store||this.notesStorageFailed||this.notesPending||this.notesRaw!==store.raw||JSON.stringify(this.vget('notes').list)!==JSON.stringify(store.list))throw Error('Save your Notes changes and review this request again.');
          };
          current();const target=await store.target(expectedTarget.noteId);current();
          if(JSON.stringify(target)!==JSON.stringify(expectedTarget))throw Error('The note changed. Request a fresh review.');
          if(!openInternalView(this,'notes','sheet'))throw Error('Notes is unavailable.');
          originalSet.call(this,'notes',{open:target.noteId});context(this);this.setState({});
          return;
        }
        this.pendingActionRecoveryAbort?.abort();
        const approval=this.pendingActionApproval=new AbortController();
        this.pendingActionApprovalProposalId=card.proposalId;
        this.pendingActionApprovalContext=alphaClient.getState().context;this.pendingActionApprovalSession=session;this.setState({});
        const sessionId = session?.sessionId;
        const beforeView = this.S().view;
        let receipt;
        const readLease=this.readReplyLeases?.get(card.proposalId);
        try { receipt = card.recovered?await connectionController.approvePendingAction(card.proposalId,alphaClient.getState().context,approval.signal):await alphaClient.approve(card.proposalId); }
        catch (error) {
          // Navigation may cancel the context-bound chat wait after the effect.
          // Await only that already-started journaled action; never execute again.
          receipt = await connectionController.actionReceipt(card.proposalId, sessionId);
          if (!receipt) throw error;
        }
        if (!this.live || JSON.stringify(connectionController.getSnapshot().session)!==JSON.stringify(session)||readLease&&!connectionController.readReplyCurrent(readLease.binding)) return;
        this.setState((previous:Shell)=>this.live&&JSON.stringify(connectionController.getSnapshot().session)===JSON.stringify(session)&&(!readLease||connectionController.readReplyCurrent(readLease.binding))?{ msgs: previous.msgs.map((m: Shell) => m.id === message.id ? { ...m, card: { ...m.card, done: true, sub: receipt.summary, title: receipt.status === 'succeeded' ? 'Completed' : 'Not completed' } } : m) }:null);
        if(receipt.readReply&&this.readReplyLeases?.has(receipt.proposalId)){
          try{await completeReadReply(this,receipt);}
          catch{if(this.live&&readLease?.phase==='unconfirmed')this.setState((previous:Shell)=>this.live&&readLease.phase==='unconfirmed'&&connectionController.readReplyCurrent(readLease.binding)?{msgs:previous.msgs.map((m:Shell)=>m.id===message.id?{...m,card:{...m.card,sub:receipt.summary+' The answer is unconfirmed. Check conversation history before trying again.'}}:m)}:null);}
        }else {
          if(receipt.status!=='succeeded'){this.cancelReadReplyCompletions?.(receipt.proposalId);this.retireReadReplyVoice?.(receipt.proposalId);}
          if (this.S().view !== beforeView) this.toast(receipt.summary);
          else this.agentSay(receipt.summary,undefined,{id:`device-receipt:${receipt.proposalId}`,deviceReceipt:true});
        }
        if(session)this.setState({},()=>{if(this.live&&JSON.stringify(connectionController.getSnapshot().session)===JSON.stringify(session)){
          // The receipt has reached the UI; refreshing earlier would invalidate
          // the operation's context before its journal/server acknowledgement.
          if(!alphaClient.getState().pending)this.notesCommittedHandler?.();
          publishCommittedDeviceChanges(receipt,alphaClient,session);
        }});
      } catch (e) { const readLease=this.readReplyLeases?.get(card.proposalId);if(this.live&&(!readLease||readLease.phase!=='cancelled'&&connectionController.readReplyCurrent(readLease.binding))&&(!card.recovered||JSON.stringify(card.proposalSession)===JSON.stringify(connectionController.getSnapshot().session)))this.agentSay(e instanceof Error ? e.message : 'Action could not complete.'); }
      finally {this.pendingActionApproval=null;this.pendingActionApprovalProposalId=null;if(this.live){context(this);this.setState({});}}
    } else if (card.go) this.openView(card.go.view, card.go.patch);
  };
  p.startVoice = async function () {
    try {
      const result = await DailyApps.perform({ action: 'voice' });
      if (result.status === 'selected' && result.transcript) this.setState({ chat: 'sheet', draft: result.transcript });
      else this.toast(result.message || 'Speech recognition is unavailable on this device.');
    } catch { this.toast('Speech recognition is unavailable on this device.'); }
  };
  p.stopVoice = function () { this.pendingActionApproval?.abort();this.cancelReadReplyCompletions?.();alphaClient.cancel(); this.setState({ voice: 'off', typing: false }); };
  views.notes.render = function (state: Shell, api: Shell) {
    const out = notesRender({ ...state, record: false }, api);
    out.storageStatus=state.storageStatus;
    // Agent Notes: canonical-notes-ui.ts decorates this view. Recovery and recording below belong to Older notes.
    if(api.notesSourceMode==='canonical')return out;
    const failed=Boolean((activeShell?.notesStorageFailed&&document.documentElement.dataset.notesStorageState!=='opening')||activeShell?.notesStore?.needsRecovery);
    // A damaged collection, kept draft or full store exposes retention guidance. Development builds also offer fixture recovery tools.
    out.browserRecovery=isAndroid?Boolean(failed||activeShell?.notesDraftUnreadable||activeShell?.notesDraftDeferred||activeShell?.notesDraftConflict):Boolean(failed||state.audioDeletionRecoveryFailed||state.audioDeletionPending?.length);
    out.openBrowserRecovery=()=>{const shell=activeShell;if(!shell||shell.notesPending)return;notesRecovery?.abort();const controller=notesRecovery=new AbortController();if(isAndroid){openNativeNotesRecovery(shell,controller.signal);return;}openDomainRecovery({capture:async signal=>{const draft=JSON.stringify({...JSON.parse(shell.notesStore?.raw||'{}'),records:shell.vget('notes').list});const saved=await browserNotesRecovery.capture(signal);return {...saved,raw:JSON.stringify({saved:saved.raw,draft})};},reset:browserNotesRecovery.reset},'Notes','Browser Notes recovery','Download saved Notes and the current editor draft before resetting. Reset starts an empty collection; it does not delete audio files or resolve pending audio deletion. Close other Alpha tabs before continuing.',controller.signal);};
    out.openAudioRecovery=async()=>{const shell=activeShell;if(!shell)return;notesRecovery?.abort();const controller=notesRecovery=new AbortController();try{const recovery=await audioDeletionRecovery();if(controller.signal.aborted||activeShell!==shell||!shell.live||shell.S().view!=='notes')return;openDomainRecovery(recovery,'note audio deletion history','Note audio deletion recovery','Download unresolved note/audio deletion records before resetting. Reset forgets recovery records, but does not delete or restore Notes or audio. Check uncertain outcomes before repeating any deletion. Close other Alpha tabs before continuing.',controller.signal);}catch{if(!controller.signal.aborted)api.toast('Audio deletion recovery could not be opened.');}};
    const dictate = async () => {
      try {
        const r = await DailyApps.perform({ action: 'voice' });
        if (r.transcript) {
          const latest = api.get('notes');
          if (latest.open !== state.open) return;
          api.set({ list: latest.list.map((n: Shell) => n.id === state.open ? { ...n, body: [n.body, r.transcript].filter(Boolean).join('\n') } : n) });
        } else api.toast(r.message || 'Speech recognition is unavailable.');
      } catch { api.toast('Speech recognition is unavailable.'); }
    };
    out.record = () => window.dispatchEvent(new CustomEvent('alpha-record-note'));
    if (out.ed) out.ed.dictate = dictate;
    if (out.vo) { out.vo.play = () => api.toast('No audio is available for this note.'); out.vo.toCal = () => void DailyApps.perform({ action: 'calendar-create', title: out.vo.title }).catch(() => api.toast('Calendar is unavailable.')); }
    return out;
  };
}
