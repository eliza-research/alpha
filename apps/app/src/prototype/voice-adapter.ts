import { cloudServiceName } from '../runtime/cloud-protocol';
import {createBatchProgressAcknowledgment} from '../runtime/local-agent-stream';
import {developmentCloudVoiceEnabled,developmentCloudRealtimeVoiceEnabled} from '../runtime/development-cloud-voice';
import React from 'react';
import {alphaViewPath} from '../product/alpha-product';
import {VoiceActivity} from './voice-activity';
import {cloudRuntimeEnabled,testMocksEnabled} from '../build-flags';
import {developmentCartesiaConversation,developmentCartesiaVoiceEnabled} from '../runtime/development-cartesia-conversation';
import {BatchVoiceConversation,type BatchVoiceState} from '@elizaos/ui/voice/batch-conversation';
import {recordingRevision} from './summary-source';
import {noteOriginFor} from '../runtime/note-origin';
import {reviewContentQuestion} from '../browser/content-question';
import {recordingLevels} from '../browser/audio-levels';
import {browserDevProfile} from '../browser/dev-profile';
import {pendingAudioDeletions,withAudioDeletionLock,changeAudioDeletion,audioDeletionNoteState,audioDeletionJournal,type AudioDeletion} from '../runtime/note-audio-deletions';
import {createNotesRecordingEffects,type NotesRecordingEffects} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/notes-recording-effects.ts';
import {addNotesTrashEntry,editNotesTrash,isNotesTrashFull,notesTrashExpired,readNotesTrash,removeNotesTrashEntries,savedNotes,type NotesTrashEntry} from '../runtime/notes-trash';
import type {NotesTarget} from '../runtime/notes-contract';
import {sameDeletionRow,leasedDeletionRow,claimDeletion,releaseDeletionClaim,deletionClaimedElsewhere} from '../runtime/permanent-voice-deletion';
import { installLocalSpeechPlayback, stopLocalSpeechPlayback, currentNoteReading, stopSpeaking, speakNote, noteVoiceDraft } from './local-speech-playback';
import { registerPlugin } from '../platform-plugins';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { createOnDeviceVoice } from '../runtime/local-voice';
import { voiceFailure, transcriptProvenance, deniedSettingsChoice, DENIED_SETTINGS_LABEL, type VoiceFailure, type TranscriptProvenance } from '../runtime/voice-states';
import { createPairedVoice } from '../runtime/paired-voice';
import { createCloudVoice, cloudVoiceFailure, createCloudStreamingSpeech, nativeCloudStreamingAvailable } from '../runtime/cloud-voice';
import { speakCloudSpeechChunks } from '../../../../.eliza/client-features/packages/voice/src/cloud-speech-chunks.ts';
import { clefEndpointStage, selectVoiceRoute, voiceSendPolicy, type VoicePreference } from '../runtime/voice-selection';
import { beginVoiceTurn, markVoiceTiming, abandonVoiceTurn, finishVoiceTurn, sendVoiceEntry, recordLiveVoiceTiming, recordEndpointVoiceTiming, recordHeardVoiceTiming, activeVoiceTurn } from '../runtime/voice-timing';
import { residentEndpoint, createHeardReporter, createEndpointChain } from '../runtime/voice-turn-routes';
import { createNativeLiveDictation, nativeAssistantListener, nativeLiveVoiceReady, type NativeLiveDictation } from '../runtime/native-live-voice';
import { installNativeVoiceTurnMarks } from '../runtime/native-voice-turn';
import { VoiceAssistantSession, type AssistantState } from '../runtime/voice-assistant';
import { shouldRespondToVoiceTurn, buildVoiceTurnSignal } from '@elizaos/voice/turn';
import { toSpeakableText } from '@elizaos/ui/voice/voice-chat-playback';
import { connectionController } from '../runtime/connection-ui';
const voiceServiceName = () => cloudServiceName(connectionController.getCloudEnvironment() ?? connectionController.getSnapshot().cloudAccount?.environment ?? connectionController.getSnapshot().signIn?.environment ?? 'production');
type Bag = Record<string, any>;
type Clip = { recordingId: string; durationMs: number };
const voice = registerPlugin<{
  startRecording(input?: { maxDurationMs: 29000 | 59000 }): Promise<{ recordingId: string; maxDurationMs: number }>;
  stopRecording(): Promise<Clip>;
  transcribeRecording(options: { recordingId: string; requestId: string }): Promise<{ text: string; local: boolean }>;
  cancelRecording(): Promise<unknown>;
  cancel(options: { requestId: string }): Promise<unknown>;
  addListener(event: 'recordingStopped', callback: (clip: Clip) => void): Promise<PluginListenerHandle>;
}>('DevelopmentAgent');
const deviceVoice = registerPlugin<typeof voice & {getRecordingMetrics(input:{recordingId:string}):Promise<{recordingId:string;peak:number;rms?:number}>}>('AlphaVoiceCloud');
const appSettings = registerPlugin<{ openSettings(input: { page: 'privacy' }): Promise<unknown> }>('AlphaDevice');

type SavedAudio = { audioId: string; noteId: string; durationMs: number; transcript: string };
const cloudRecorder = registerPlugin<{ saveRecording(input: { recordingId: string; noteId: string; transcript: string }): Promise<SavedAudio> }>('AlphaVoiceCloud');
const localRecorder = registerPlugin<{ saveRecording(input: { recordingId: string; noteId: string; transcript: string }): Promise<SavedAudio> }>('DevelopmentAgent');
const noteAudio = registerPlugin<{
  play(input: { audioId: string }): Promise<void>; stop(): Promise<void>;
  state(): Promise<{ playing: boolean; audioId?: string; positionMs: number }>;
  describe(input:{audioId:string}):Promise<SavedAudio & {deletedAt?:number}>;
  remove(input: { audioId: string; noteId: string; operationId:string }): Promise<unknown>;
  deletionStatus(input:{audioId:string;noteId:string;operationId:string}):Promise<{audioId:string;noteId:string;operationId:string;status:string}>;
  restore(input: { audioId: string; noteId: string; operationId:string }): Promise<unknown>;
  purge(input: { audioId: string; noteId: string; operationId:string }): Promise<{audioId:string;noteId:string;operationId:string;status:string}>;
}>('AlphaNoteAudio');

/** The passage Read aloud speaks: title, then body or checklist items. */
function noteSpeechText(note: Bag | undefined): string {
  if (!note) return '';
  const body = note.kind === 'list' ? (note.items || []).map((item: Bag) => String(item?.t || '').trim()).filter(Boolean).join('. ') : String(note.body || '');
  return [String(note.title || '').trim(), body.trim()].filter(Boolean).join('. ').trim();
}
/** One owned recorder, shared by Notes dictation and the chat voice mode. */
export function installPrototypeVoiceAdapter(Component: any, views: Record<string, Bag>) {
  installLocalSpeechPlayback(Component);
  installNativeVoiceTurnMarks();
  const notes = views.notes, render = notes.render, back = notes.back, leave = notes.onLeave;
  let closeTranscriptQuestion:(()=>void)|undefined;
  const originalApi = Component.prototype.api;
  Component.prototype.api = function (key: string) {
    const value = originalApi.call(this, key);
    // The prototype setView callback discards vset's persistence receipt.
    if (key === 'notes') {
      value.voiceNoteActive=()=>this.live&&this.S().view==='notes';
      value.saveVoiceNote = async (patch: Bag, options?: {exact?: boolean}) => await this.vset('notes', patch, options) === true;
      value.reviewAudioDeletion=async(note:Bag)=>{
        if(!this.live||this.notesStorageFailed||this.notesPending||!this.notesStore)throw Error('Notes needs recovery');
        const target=await this.notesStore.target(note.id);
        if(JSON.stringify(this.notesStore.list.find((n:Bag)=>n.id===note.id))!==JSON.stringify(note))throw Error('Note changed');
        return target;
      };
      // Notes Trash hooks. Voice notes share one Trash with text notes; the recording follows its note.
      value.restoreTrashedVoice=(entry:NotesTrashEntry)=>restoreDeletion(trashRow(entry),value,entry.index);
      value.purgeTrashedVoice=(entry:NotesTrashEntry)=>recordingEffects().purgeTrashed(entry);
      value.trashVoiceNoteWithRecording=<T,>(note:Bag,target:NotesTarget,operationId:string,index:number,commit:()=>Promise<T>)=>trashVoiceNoteWithRecording(note,target,operationId,index,commit);
      // Offered only after a full Trash refused this exact voice note, and confirmed separately.
      value.deleteVoiceNoteForever=(noteId:string)=>{const note=refusedVoice;if(note&&note.id===noteId)void deleteVoiceNote(value,note,true);};
      // Startup, resume and timer backstop (run by Trash maintenance): settles interrupted deletions without opening Notes.
      // Nothing pending: no lock, no repaint.
      value.recoverVoiceDeletions=async()=>{if(Object.keys(await pendingAudioDeletions()).length)await refreshDeletionStatus(value);};
      value.commitAudioNoteDeletion=async(row:AudioDeletion,authorized:()=>void)=>{
        if(this.notesStorageFailed||this.notesPending)throw Error('Notes needs recovery');
        await this.notesStore.execute({type:'notes_delete',target:row.target},row.id,new AbortController().signal,authorized);
        window.dispatchEvent(new Event('alpha:notes-committed'));
      };
    }
    return value;
  };
  let deletionBusy=false,noteHandoffBusy=false;
  let deletionRefresh:Promise<void>|null=null;
  /**
   * Permanent deletions this process started. An effect of theirs that failed here may still
   * land, so they keep the review path. Only rows an earlier process left are settled outright.
   */
  const sessionDeletions=new Set<string>();
  /** The reviewed voice note a full Trash refused. Memory only; a restart simply asks again. */
  let refusedVoice:Bag|null=null;
  let api: Bag | undefined, stage = 'closed', generation = 0, busy = false;
  let clip: Clip | undefined, recordingId: string | undefined, started = 0;
  let error = '', draft = '', requestId: string | undefined, saveId = '';
  // Distinct failure kinds keep their own guidance.
  let failure: VoiceFailure | '' = '';
  let recognized: { text: string; provenance: TranscriptProvenance } | undefined;
  let savedStarting:Promise<void>|undefined;
  let savedPlaying: string | undefined, savedPosition = 0, savedEpoch = 0, savedTick: ReturnType<typeof setInterval> | undefined;
  const stopSaved = () => { const owned = savedPlaying !== undefined; ++savedEpoch; savedPlaying = undefined; savedPosition = 0; if (savedTick) clearInterval(savedTick); savedTick = undefined; if (owned) {const pending=savedStarting;stopping=stopping.then(async()=>{try{await pending;}catch{}await noteAudio.stop();}).catch(failure=>{mediaUnconfirmed=failure;throw failure;});void stopping.catch(()=>{});} };
  async function playSaved(note: Bag) {
    if (savedPlaying === note.audio.audioId) { stopSaved(); refresh(); return; }
    stopSaved(); const epoch = savedEpoch; savedPlaying = note.audio.audioId; refresh();
    try {
      await stopping;if(epoch!==savedEpoch)return;const pending=savedStarting=noteAudio.play({ audioId: note.audio.audioId });try{await pending;}finally{if(savedStarting===pending)savedStarting=undefined;}
      if (epoch !== savedEpoch) return;
      savedTick = setInterval(() => { void noteAudio.state().then(value => { if (epoch !== savedEpoch) return; if (!value.playing || value.audioId !== savedPlaying) { stopSaved(); refresh(); return; } savedPosition = value.positionMs; refresh(); }).catch(() => { if (epoch === savedEpoch) { stopSaved(); refresh(); } }); }, 250);
    } catch { if (epoch === savedEpoch) { stopSaved(); api?.toast('This saved recording could not be played. The transcript is still available.'); refresh(); } }
  }
  type DictationTarget = { id: string; body: string; revision: string; start: number; end: number };
  let destination: DictationTarget | undefined;
  let listener: PluginListenerHandle | undefined, tick: ReturnType<typeof setInterval> | undefined;
  let stopping = Promise.resolve();
  type Driver = typeof voice | ReturnType<typeof createCloudVoice> | NativeLiveDictation;
  let startingCapture:ReturnType<Driver['startRecording']>|undefined;
  let driver: Driver = voice, cloudMode = false, cloudConnectRequired = false, deviceOnly = false;
  let pairedVoice: ReturnType<typeof createPairedVoice> = null, pairedReady = false, pairedAsrReady = false;
  let selectedRoute: 'device' | 'agent' | 'manual' = 'device', preparingPaired = false;
  let onDeviceVoice: ReturnType<typeof createOnDeviceVoice> = null, onDeviceReady = false, preparingLocal = false;
  // Transcribe over the native live capture: Stop finalizes exactly the audio up to Stop.
  let liveDictation: NativeLiveDictation | undefined;
  let transcription: AbortController | undefined;
  let readiness: AbortController | undefined;
  let playback: AbortController | undefined, playing = false;
  type ChatDestination={mode?:'dictation';shell:any;view:string|null;chat:string;draft:string;reply:unknown;edit:unknown;binding:string;opener?:HTMLElement};
  let chatDestination:ChatDestination|undefined;
  let ownedNavigation:{chat:ChatDestination;view:string;detent:string;applying:boolean;turnId:string;context?:import('../runtime/alpha-client').ContextEnvelope}|undefined;
  let conversationVoice:Pick<BatchVoiceConversation<Clip>,'start'|'stop'|'recheck'|'resume'>|Awaited<ReturnType<typeof developmentCartesiaConversation>>|undefined;
  let conversationState:BatchVoiceState & {progressText?:string}={phase:'idle'};
  let conversationReviewRequired=false;
  let conversationSpeech:Promise<void>|undefined;
  let notesSpeech:Promise<void>|undefined;
  let conversationPrepared:{binding:import('../runtime/alpha-client').VoiceConversationBinding;context:import('../runtime/alpha-client').ContextEnvelope}|undefined;
  let conversationLevels:number[]=[];
  // Live voice (Android): app-process VAD frames to the agent's on-device streaming ASR. The
  // interim text is display only: never a draft, a message, storage or a log line.
  let conversationLive:VoiceAssistantSession|undefined;
  let conversationInterim='';
  let conversationInterimKnownMessages=new Set<string>();
  let assistantState:AssistantState={phase:'idle'};
  let conversationLastTranscript='',conversationLastReply='';
  /** Review policy only: the finished transcript held for an explicit Send or Discard. */
  let conversationReview:{text:string;settle:(text:string|null)=>void}|undefined;
  /** Message ids present before a conversation send; the first new agent text is the first token. */
  let conversationReplyWatch:Set<string>|undefined;
  // Voice latency (voice-timing.ts). A turn starts when its recording stops; the first turn on a
  // route in this page is cold. Marks are diagnostic only and never gate a voice turn.
  const warmRoutes=new Set<string>();let timedRecording:string|undefined;
  const timingRoute=()=>conversationLive?(cloudMode?'eliza-cloud':'local-agent'):cloudMode?'eliza-cloud':onDeviceReady?(Capacitor.isNativePlatform()?'on-device':'browser'):pairedAsrReady?'paired-agent':deviceOnly?'manual':'development-agent';
  const recordingEnded=(id:string|undefined,entry:'conversation'|'notes')=>{
    if(!id||timedRecording===id)return;timedRecording=id;
    const route=timingRoute(),cold=!warmRoutes.has(route);warmRoutes.add(route);
    beginVoiceTurn({route,cold,entry,...(entry==='conversation'?{policy:voiceSendPolicy()}:{})});
  };
  // A recorded-clip (batch) conversation turn: its path is recorded as live mode 'batch' with no
  // partials, so timing and the diagnostics export tell it from the live assistant ('stream').
  const batchRecordingEnded=(id:string|undefined)=>{if(!id||timedRecording===id)return;recordingEnded(id,'conversation');recordLiveVoiceTiming({mode:'batch',partials:0});};
  // Said once per page session: the half-duplex loop cannot hear the user while a reply plays.
  let halfDuplexDisclosed=false;
  let mediaUnconfirmed:unknown;
  let retirement:{shell:any;phase:'stopping'|'error';returnChat:string;view:string|null;binding:string;panelChat:string;promise:Promise<void>;approval?:AbortController;proposalId?:string}|undefined;
  const refresh = () => chatDestination ? chatDestination.shell.setState({}) : api?.setView('notes', { nativeVoiceRevision: Date.now() });
  const stopClock = () => { if (tick) clearInterval(tick); tick = undefined; };
  function cleanup(close = true,publish=true) {
    conversationState={...conversationState,progressText:''};
    ownedNavigation=undefined;
    // Discard, cancel, keyboard, navigation and account changes all end here: an unsent turn is abandoned.
    abandonVoiceTurn();conversationReview=undefined;conversationReplyWatch=undefined;
    const hadCapture=!!recordingId||!!startingCapture||!!clip;
    const previousChat=chatDestination;const chatShell=previousChat?.shell,previousConversation=conversationVoice,previousSpeech=conversationSpeech,previousNotesSpeech=notesSpeech;conversationVoice=undefined;conversationPrepared=undefined;
    conversationLive=undefined;conversationInterim='';assistantState={phase:'idle'};
    // Stopping the assistant cancels its capture, request and playback and releases its agent session.
    const conversationStopped=previousConversation?.stop();
    closeTranscriptQuestion?.();
    ++generation; readiness?.abort(); readiness = undefined; transcription?.abort(); transcription = undefined; pairedVoice = null; onDeviceVoice = null; onDeviceReady = false; liveDictation = undefined; preparingLocal = false; preparingPaired = false; pairedReady = false; pairedAsrReady = false; busy = false; stopClock(); stopSaved();
    if (requestId) void driver.cancel({ requestId }).catch(() => {});
    playback?.abort(); playback = undefined; playing = false;
    requestId = undefined;
    if (listener) void listener.remove(); listener = undefined;
    const previous = driver;
    const pendingStart=startingCapture;
    stopping = stopping.then(async () => { await conversationStopped;await previousSpeech?.catch(error=>{if(error?.code==='speech-cleanup-unconfirmed')throw error;});await previousNotesSpeech?.catch(error=>{if(error?.code==='speech-cleanup-unconfirmed')throw error;});if(pendingStart)try{await pendingStart;}catch{}try { await previous.cancelRecording(); } catch(error) {if(hadCapture||previousConversation)throw error;} });
    stopping=stopping.catch(failure=>{mediaUnconfirmed=failure;throw failure;});void stopping.catch(()=>{});
    if(chatShell&&(previousConversation||previousSpeech||hadCapture)){
      const held:NonNullable<typeof retirement>={shell:chatShell,phase:'stopping',returnChat:previousChat!.chat,view:previousChat!.view,binding:previousChat!.binding,panelChat:chatShell.S().chat,promise:stopping,approval:chatShell.pendingActionApproval,proposalId:chatShell.pendingActionApprovalProposalId};retirement=held;
      void stopping.then(()=>{if(retirement!==held)return;retirement=undefined;if(chatShell.live!==false)chatShell.setState((state:any)=>({...(composerBinding()===held.binding&&(state.view||null)===held.view&&state.chat===held.panelChat?{chat:held.returnChat}:{})}));},()=>{if(retirement!==held)return;held.phase='error';if(chatShell.live!==false)chatShell.setState({});});
    }
    clip = undefined; recordingId = undefined;
    if (close) { stage = 'closed'; draft = ''; destination = undefined; chatDestination = undefined; failure = ''; recognized = undefined; }
    if(publish){if(chatShell)chatShell.setState({});else refresh();}
  }
  function enter(target?: DictationTarget, preparedLocal?: ReturnType<typeof createOnDeviceVoice>, preference: VoicePreference = 'default', chat?:ChatDestination) {
    const directCartesia = !!chat && chat.mode !== 'dictation' && (connectionController.getSnapshot().residentInference==='direct'||developmentCartesiaVoiceEnabled && !developmentCloudVoiceEnabled);
    const selected = chat && chat.mode!=='dictation' && (testMocksEnabled || directCartesia && preference === 'default') ? 'cloud' : selectVoiceRoute(preference), route = selected === 'cloud' ? 'agent' : selected;
    const previousChat=chatDestination;
    stopLocalSpeechPlayback(); cleanup(true,!chat); chatDestination=chat;reprepare = false; destination = target; saveId = target?.id || crypto.randomUUID(); stage = 'ready'; error = ''; failure = ''; recognized = undefined; draft = ''; selectedRoute = route;
    if(previousChat&&!chat)previousChat.shell.setState({chat:previousChat.chat});
    cloudMode = selected === 'cloud';
    cloudConnectRequired = cloudMode && connectionController.getSnapshot().residentInference!=='direct' && !developmentCloudVoiceEnabled && !(chat&&(developmentCartesiaVoiceEnabled||developmentCloudRealtimeVoiceEnabled)) && (!connectionController.getCloudEnvironment() || !connectionController.getCloudClient()?.credentialId);
    deviceOnly = !cloudMode && (browserDevProfile || localStorage.getItem('alpha.connection.selection.v1') !== null || !Capacitor.isPluginAvailable('DevelopmentAgent'));
    driver = cloudMode && !cloudConnectRequired && !developmentCloudRealtimeVoiceEnabled && !directCartesia ? createCloudVoice() : deviceOnly ? deviceVoice : voice;
    if (cloudConnectRequired) error = `Sign in to ${voiceServiceName()} to use voice.`;
    onDeviceVoice = !cloudMode && (route === 'device' || browserDevProfile && route === 'agent') ? preparedLocal || createOnDeviceVoice() : null;
    if (route === 'manual') { cloudMode = false; deviceOnly = true; driver = deviceVoice; }
    if (route === 'device') { cloudMode = false; deviceOnly = true; driver = deviceVoice; if (!onDeviceVoice) error = 'On-device speech is unavailable. Retry local speech or use the keyboard.'; }
    if (preparedLocal) { onDeviceReady = true; cloudMode = false; deviceOnly = true; driver = deviceVoice; }
    else if (onDeviceVoice) {
      preparingLocal = true;
      const local = onDeviceVoice, token = generation, controller = new AbortController(); readiness = controller;
      void stopping.then(() => {
        if (token !== generation || controller.signal.aborted) return false;
        return local.ready(controller.signal);
      }).then(async ready => {
        if (token !== generation || controller.signal.aborted) return;
        // Chat Transcribe streams through the agent's live ASR when it is ready; otherwise it records a clip.
        const live = !!ready && chat?.mode === 'dictation' && await nativeLiveVoiceReady(controller.signal).catch(() => false);
        if (token !== generation || controller.signal.aborted) return;
        preparingLocal = false;
        if (!ready || stage !== 'ready') { if (!ready) error = Capacitor.isNativePlatform() ? 'On-device speech is unavailable. Retry local speech or use the keyboard.' : 'Local speech needs the local agent on this computer. Connect it, or use the keyboard.'; refresh(); return; }
        onDeviceReady = true; cloudMode = false; deviceOnly = true; driver = deviceVoice;
        if (live) { liveDictation = createNativeLiveDictation({ onLatency: recordLiveVoiceTiming }); driver = liveDictation; }
        pairedReady = false; pairedAsrReady = false; refresh();maybeStartDictation();
      }).catch(() => { if (token === generation) { preparingLocal = false; error = 'On-device speech is unavailable. Retry local speech or use the keyboard.'; refresh(); } });
    }
    if (route === 'agent' && !browserDevProfile && !cloudMode && deviceOnly) {
      pairedVoice = createPairedVoice();
      if (pairedVoice) {
        preparingPaired = true;
        const token = generation, controller = new AbortController(); readiness = controller;
        const selected = pairedVoice;
        void (async () => {
          await stopping;
          if (token !== generation || controller.signal.aborted) return;
          try { const ready = await selected.ready(controller.signal); if (token === generation && !controller.signal.aborted) { pairedReady = ready; refresh(); } } catch { /* TTS and ASR are separate capabilities. */ }
          if (token !== generation || controller.signal.aborted) return;
          try { const ready = await selected.transcriptionReady(controller.signal); if (token === generation && !controller.signal.aborted) { pairedAsrReady = ready; refresh(); } } catch { /* Manual recording remains available. */ }
          if (token === generation && !controller.signal.aborted) { preparingPaired = false; refresh(); }
        })();
      }
    }
    refresh();
  }
  /** Retire the current attempt and prepare the same route again, keeping its destination. */
  let reprepare = false;
  function reopen(message: string) {
    const target = destination, chat = chatDestination, route = selectedRoute;
    enter(target, undefined, route,chat); error = message; refresh();
  }
  async function act(task: (token: number) => Promise<void>) {
    if (busy) return;
    busy = true; error = ''; failure = ''; const token = generation; refresh();
    try { await task(token); }
    catch (reason) { if (token === generation) {
      const kind = voiceFailure(reason, { transcribing: stage === 'transcribing', browser: !Capacitor.isNativePlatform(), cloud: cloudMode, serviceName: voiceServiceName() });
      if (kind) { failure = kind.kind; error = kind.message; stage = stage === 'review' ? 'review' : clip ? 'recorded' : 'ready'; stopClock(); return; }
      error = (cloudMode && cloudVoiceFailure(reason,{recording:!!clip})) || (onDeviceReady ? 'On-device speech unavailable. Keep recordings under 30 seconds and use English text under 500 characters for playback. Your recording is retained.' : pairedAsrReady ? 'Agent Whisper transcription unavailable. Your recording is retained; check the selected agent and retry explicitly.' : deviceOnly ? 'Recording unavailable. Check microphone access and available device storage, then retry.' : cloudMode ? 'Cloud voice unavailable. Check microphone access, your Cloud account and the connection, then retry.' : 'Voice unavailable. Check microphone access and the local development service, then retry.'); stage = stage === 'review' ? 'review' : clip ? 'recorded' : 'ready'; stopClock(); } }
    finally { if (token === generation) { busy = false; refresh(); } }
  }
  async function start(token: number) {
    if (cloudConnectRequired) throw new Error(`Sign in to ${voiceServiceName()} to use voice.`);
    if (selectedRoute === 'device' && !onDeviceReady) throw new Error('On-device speech is not ready');
    if (!Capacitor.isPluginAvailable(cloudMode || deviceOnly ? 'AlphaVoiceCloud' : 'DevelopmentAgent')) throw new Error('Voice unavailable');
    stage = 'starting'; refresh(); await stopping;
    if (token !== generation) return;
    if (listener) await listener.remove(); listener = undefined;
    const handle = await driver.addListener('recordingStopped', value => {
      if (token !== generation || !['starting','recording'].includes(stage) || (recordingId && value.recordingId !== recordingId)) return;
      stopClock();
      if (!value.recordingId || !Number.isFinite(value.durationMs)) { clip = undefined; stage = 'ready'; error = 'Recording ended without usable audio.'; }
      else { clip = value; stage = 'recorded'; recordingEnded(value.recordingId, 'notes'); }
      refresh();if(chatDestination?.mode==='dictation'&&stage==='recorded'&&!busy)void primary();
    });
    if (token !== generation) { await handle.remove(); return; }
    listener = handle;
    const capture=liveDictation?liveDictation.startRecording():onDeviceReady?deviceVoice.startRecording({maxDurationMs:29000}):(driver as typeof voice).startRecording();
    startingCapture=capture;
    let result:Awaited<typeof capture>;
    try{result=await capture;}finally{if(startingCapture===capture)startingCapture=undefined;}
    if (token !== generation) return;
    recordingId = result.recordingId;
    if (stage === 'recorded') {if(chatDestination?.mode==='dictation')await transcribeClip(token);return;} // Automatic stop can race acquisition.
    started = Date.now(); stage = 'recording'; tick = setInterval(refresh, 250); refresh();
  }
  async function primary() {
    if(chatDestination&&!chatCurrent()){cleanup();return;}
    if (cloudConnectRequired) { cleanup(); connectionController.openCloudAccount(); return; }
    if (stage === 'transcribing') {if(chatDestination?.mode==='dictation'){cancelChat(true);return;} reopen('Transcription cancelled. Record again to continue.'); return; }
    if (stage === 'review') {
      if (!draft.trim()) return;
      if (chatDestination) {
        if(!chatCurrent()){cleanup();return;}
        const { shell, chat, draft:previousDraft } = chatDestination;
        const text=previousDraft?[previousDraft,draft].join('\n'):draft;
        cleanup();
        // If the dictated draft is sent exactly as placed, its turn is timed through the reply. The
        // reply is never spoken: only the voice conversation speaks replies.
        if(!previousDraft)noteVoiceDraft(text,shell.S().msgs||[]);
        shell.setState({chat:['input','sheet','full'].includes(chat)?chat:'input',draft:text,voice:'off'});
        return;
      }
      if(!api)return;
      if(api.storageReady?.()===false){error='Notes has a pending or unconfirmed save. Wait or reopen Notes to inspect before saving again.';refresh();return;}
      const current = api.get('notes').list || [];
      const target = destination && current.find((n: Bag) => n.id === destination!.id);
      if (destination && (!target || JSON.stringify(target) !== destination.revision)) { error = 'The original note changed. Cancel and reopen recording before applying this transcript.'; refresh(); return; }
      if (!clip || busy) return;
      if (destination && target) {
        const text = destination.body.slice(0, destination.start) + draft + destination.body.slice(destination.end);
        const id = target.id, caret = destination.start + draft.length;
        const next = current.map((n: Bag) => n.id === id ? { ...n, body: text, when: 'Now' } : n);
        const owner = api;
        await act(async token => {
          const saved = await owner.saveVoiceNote({ list: next, open: id });
          if (token !== generation) return;
          if (saved !== true) { error = 'The note save is unconfirmed. Your transcript is retained; inspect saved Notes before applying again.'; refresh(); return; }
          markVoiceTiming('send'); finishVoiceTurn(); cleanup();
          const completed = generation;
          window.requestAnimationFrame?.(() => {
            if (completed !== generation || api?.get('notes').open !== id) return;
            const editor = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Note"]');
            if (editor?.value === text) { editor.focus(); editor.setSelectionRange(caret, caret); }
          });
        });
        return;
      }
      await act(async token => {
        const id = target?.id || saveId;
        const text = [target?.body, draft].filter(Boolean).join('\n');
        const recording = clip!;
        const audio = await (cloudMode || deviceOnly ? cloudRecorder : localRecorder).saveRecording({ recordingId: recording.recordingId, noteId: id, transcript: text });
        if (token !== generation) return;
        if (audio.noteId !== id || audio.audioId !== recording.recordingId || !Number.isFinite(audio.durationMs)) throw new Error('Invalid saved recording');
        // Provenance describes how this recording's transcript was produced; edits stay the user's.
        const transcription = recognized ? { ...recognized.provenance, edited: draft.trim() !== recognized.text.trim() } : { route: 'manual' };
        const note = { ...(target || {}), id, kind: 'voice', title: target?.title || 'Voice note', body: text, audio, transcription, dur: audio.durationMs / 1000, summary: [], actions: [], lines: [{ s: 'me', at: 0, t: text }], pinned: target?.pinned || false, when: 'Now' };
        // Native retention can outlive unrelated editor commits. Merge into the latest collection.
        if(api!.storageReady?.()===false)throw new Error('Notes has an unconfirmed save. Reopen before applying this recording.');
        const latest = api!.get('notes').list || [];
        const latestTarget = latest.find((n: Bag) => n.id === id);
        if(target ? JSON.stringify(latestTarget)!==JSON.stringify(target) : !!latestTarget)throw new Error('The note changed while saving audio. Recording retained; reopen before applying.');
        const next = target ? latest.map((n: Bag) => n.id === id ? note : n) : [note, ...latest];
        const saved = await api!.saveVoiceNote({ list: next, open: id });
        if (token !== generation) return;
        if (saved !== true) { error = 'The note save is unconfirmed. The recording and transcript are retained; inspect saved Notes before saving again.'; refresh(); return; }
        markVoiceTiming('send'); finishVoiceTurn(); cleanup();
      });
      return;
    }
    await act(async token => {
      if (stage === 'ready') return start(token);
      if (stage === 'recording') {
        const value = await driver.stopRecording(); if (token !== generation) return;
        if (!value.recordingId || !Number.isFinite(value.durationMs)) throw new Error('Bad clip');
        clip = value; stage = 'recorded'; stopClock(); recordingEnded(value.recordingId, 'notes');if(chatDestination?.mode==='dictation')await transcribeClip(token);return;
      }
      // Manual review settles in this task (no extra await): an immediate Save is not lost to a busy act.
      if (stage === 'recorded' && clip) { if (deviceOnly && !pairedAsrReady && !onDeviceReady) { draft = ''; stage = 'review'; return; } await transcribeClip(token); }
    });
  }
  async function transcribeClip(token:number){
    if(!clip||token!==generation||chatDestination&&!chatCurrent())return;
    if(deviceOnly && !pairedAsrReady && !onDeviceReady) {draft = ''; stage = 'review'; return;}
    stage = 'transcribing'; requestId = crypto.randomUUID(); recognized = undefined; refresh();
    transcription = new AbortController();
    const result = liveDictation ? await liveDictation.transcribe(clip.recordingId, transcription.signal) : onDeviceReady && onDeviceVoice ? await onDeviceVoice.transcribe(clip.recordingId, transcription.signal) : pairedAsrReady && pairedVoice ? await pairedVoice.transcribe(clip.recordingId, transcription.signal) : await (driver as typeof voice).transcribeRecording({ recordingId: clip.recordingId, requestId });
    transcription = undefined;
    if (token !== generation || chatDestination&&!chatCurrent()) return;
    requestId = undefined;
    if (typeof result.text !== 'string' || !result.text.trim() || result.local !== !cloudMode) throw new Error('Invalid transcript');
    draft = result.text; stage = 'review'; markVoiceTiming('transcript-ready');
    recognized = { text: result.text, provenance: transcriptProvenance(result, { onDevice: onDeviceReady, native: Capacitor.isNativePlatform(), paired: pairedAsrReady, cloud: cloudMode }) };
  }
  async function listen() {
    if (playing) { playback?.abort(); return; }
    const speaker = onDeviceReady ? onDeviceVoice : cloudMode && 'speak' in driver ? driver : pairedReady ? pairedVoice : null;
    if (!speaker || !draft.trim()) return;
    const token = generation, controller = new AbortController();
    playback = controller; playing = true; error = ''; refresh();
    const pending=notesSpeech=onDeviceReady&&onDeviceVoice?onDeviceVoice.speak(draft,controller.signal,undefined,true):speaker.speak(draft, controller.signal);
    try { await pending; }
    catch (failure) { if((failure as {code?:string})?.code==='speech-cleanup-unconfirmed'){mediaUnconfirmed=failure;stopping=Promise.reject(failure);void stopping.catch(()=>{});}if (token === generation && !controller.signal.aborted) error = (cloudMode && cloudVoiceFailure(failure)) || 'Audio could not be played by the selected voice service. Your transcript is still available.'; }
    finally { if(notesSpeech===pending)notesSpeech=undefined;if (token === generation) { playback = undefined; playing = false; refresh(); } }
  }
  const composerBinding = () => JSON.stringify([
    connectionController.getSnapshot().session?.sessionId,
    connectionController.getCloudClient()?.sessionId,
    connectionController.getCloudClient()?.credentialId,
    connectionController.getCloudEnvironment(),
    document.documentElement.dataset.connectionMode,
  ]);
  function chatCurrent(){
    const chat=chatDestination;if(!chat)return false;const state=chat.shell.S(),view=state.view||'home',owned=ownedNavigation?.chat===chat?ownedNavigation:undefined;
    let contextCurrent=!conversationPrepared||chat.shell.voiceConversationCurrent(conversationPrepared);
    // Only the claimed destination may transition before its React callback pins the exact ACK context.
    if(!contextCurrent&&owned&&view===owned.view&&conversationPrepared){try{const actual=chat.shell.voiceConversationContext(conversationPrepared.binding);contextCurrent=actual.view===owned.view&&(owned.context?JSON.stringify(actual)===JSON.stringify(owned.context):owned.view!==(chat.view||'home'));}catch{contextCurrent=false;}}
    return chat.shell.live!==false&&!document.hidden&&!connectionController.getSnapshot().open
      &&(['sheet','full'].includes(state.chat)||chat.chat==='hidden'&&state.chat==='hidden')&&((state.view||null)===chat.view||!!owned&&view===owned.view)&&String(state.draft||'')===chat.draft
      &&chat.shell.messageReplyTarget===chat.reply&&chat.shell.messageEditTarget===chat.edit&&composerBinding()===chat.binding&&contextCurrent;
  }
  function navigationContinuation(chat:ChatDestination,token:number,turnId:string):import('../runtime/alpha-client').VoiceNavigationContinuation{
    let held:typeof ownedNavigation,attempted=false;
    return {
      async apply(view,check,commit){
        attempted=true;check();if(chat.shell.voiceSendTurnId!==turnId||token!==generation||chatDestination!==chat||!chatCurrent()||ownedNavigation)throw Error('Voice navigation changed.');
        held={chat,view,detent:chat.shell.S().chat,applying:true,turnId};ownedNavigation=held;
        let pending:Promise<boolean>;try{pending=commit(held.detent,value=>{if(chat.shell.voiceSendTurnId!==turnId||ownedNavigation!==held||token!==generation||chatDestination!==chat)throw Error('Voice navigation changed.');const actual=chat.shell.voiceConversationContext(conversationPrepared!.binding);if(value.view!==held!.view||JSON.stringify(actual)!==JSON.stringify(value))throw Error('Voice navigation changed.');held!.context=value;});}finally{held.applying=false;}
        const switched=await pending;
        if(!switched||ownedNavigation!==held||token!==generation||chatDestination!==chat||!chatCurrent())return false;
        return !!held.context;
      },
      finish(delivered){
        if(!attempted)return;
        attempted=false;
        if(!held||chat.shell.voiceSendTurnId!==turnId||ownedNavigation!==held||token!==generation||chatDestination!==chat)return;
        if(!delivered||!held.context||!chatCurrent()||(chat.shell.S().view||'home')!==held.view){cleanup();return;}
        try{const next=chat.shell.voiceConversationContext(conversationPrepared!.binding);if(next.view!==held.view||JSON.stringify(next)!==JSON.stringify(held.context))throw Error('Voice navigation changed.');chat.view=held.view==='home'?null:held.view;conversationPrepared={...conversationPrepared!,context:next};ownedNavigation=undefined;return next;}catch{cleanup();return;}
      },
    };
  }
  function cancelChat(keyboard=false,preserveChat=false){
    const chat=chatDestination;if(!chat){if(retirement)retirement.returnChat=keyboard?'input':retirement.returnChat;return;}if(preserveChat)chat.chat=chat.shell.S().chat;if(!keyboard){chat.shell.pendingActionApproval?.abort();chat.shell.cancelReadReplyCompletions?.();}cleanup();
    if(retirement&&retirement.shell===chat.shell){retirement.returnChat=keyboard?(chat.chat==='full'?'full':'input'):chat.chat;chat.shell.setState({chat:chat.shell.S().chat==='hidden'?'hidden':chat.shell.S().chat==='full'?'full':'sheet'});return;}
    chat.shell.setState({chat:keyboard?(chat.chat==='full'?'full':'input'):chat.chat},()=>{
      if(chat.shell.live===false||connectionController.getSnapshot().open||(chat.shell.S().view||null)!==chat.view)return;
      const opener=chat.opener?.isConnected?chat.opener:document.querySelector<HTMLElement>('[data-alpha-composer], [data-alpha-layer="pill"] button[aria-label="Talk"]');
      if(opener&&!opener.closest('[inert]'))opener.focus({preventScroll:true});
    });
  }
  // User navigation retires media; only the exact synchronous claimed projection retains it.
  for (const method of ['openView', 'goHome', 'back']) {
    const original = Component.prototype[method];
    if (typeof original === 'function') Component.prototype[method] = function (...args: any[]) {

      if(retirement?.shell===this&&method==='back'){this.toast('Voice media is still stopping.');return;}
      const owned=ownedNavigation;const ownEffect=owned?.applying&&owned.chat.shell===this&&(method==='goHome'?owned.view==='home':method==='openView'&&args[0]===owned.view);
      if(chatDestination?.shell===this&&!ownEffect){if(method==='back'){cancelChat();return;}cleanup();}
      return original.apply(this,args);
    };
  }
  async function captureConversationAudio(selected:Pick<ReturnType<typeof createCloudVoice>,'startRecording'|'stopRecording'|'getRecordingMetrics'|'cancelRecording'|'addListener'>,current:()=>void,input:{signal:AbortSignal;onActivity:(value:{peak:number;rms?:number})=>void;onEnd:(error?:unknown)=>void}){
    let active=true,recording=false,id:string|undefined,ended:Clip|undefined,problem:unknown,endId:string|undefined,handle:PluginListenerHandle|undefined,poll:ReturnType<typeof setTimeout>|undefined,cancelling:Promise<void>|undefined;
    const check=()=>{input.signal.throwIfAborted();current();};
    const detach=async()=>{if(poll)clearTimeout(poll);poll=undefined;if(handle){const previous=handle;handle=undefined;await previous.remove();}};
    const cancel=()=>{if(cancelling)return cancelling;active=false;recording=false;input.signal.removeEventListener('abort',aborted);cancelling=(async()=>{try{await detach();}finally{try{await selected.cancelRecording();}catch(failure){mediaUnconfirmed=failure;stopping=Promise.reject(failure);void stopping.catch(()=>{});throw failure;}}})();return cancelling;};
    const aborted=()=>{recording=false;if(poll)clearTimeout(poll);void selected.cancelRecording().catch(()=>{});};
    input.signal.addEventListener('abort',aborted,{once:true});if(input.signal.aborted)aborted();
    try{
      await stopping;check();
      handle=await selected.addListener('recordingStopped',value=>{
        if(!active||input.signal.aborted||id&&value.recordingId!==id)return;
        if(!value.recordingId)return;
        endId=value.recordingId;if(Number.isFinite(value.durationMs)){ended=value;if(id)batchRecordingEnded(id);}else problem=Error('Microphone capture was interrupted.');
        if(id){recording=false;if(poll)clearTimeout(poll);input.onEnd(problem);}
      });check();
      const pending=selected.startRecording();startingCapture=pending;
      let result:Awaited<typeof pending>;try{result=await pending;}finally{if(startingCapture===pending)startingCapture=undefined;}
      check();id=result.recordingId;recordingId=id;started=Date.now();recording=true;conversationLevels=[];
      if(endId&&endId!==id){ended=undefined;problem=undefined;}
      const sample=async()=>{
        if(!active||!recording||input.signal.aborted)return;
        try{check();const value=await selected.getRecordingMetrics(id!);check();if(!active||!recording)return;conversationLevels=[...conversationLevels.slice(-43),value.peak];input.onActivity(value);refresh();if(active&&recording&&!input.signal.aborted)poll=setTimeout(()=>{void sample();},50);}
        catch(error){if(!active||input.signal.aborted)return;recording=false;problem=error;input.onEnd(error);}
      };
      if(ended||problem){recording=false;input.onEnd(problem);}else void sample();
      return {
        stop:async()=>{check();recording=false;batchRecordingEnded(id);await detach();check();if(problem)throw problem;const value=ended??await selected.stopRecording();check();if(value.recordingId!==id||!Number.isFinite(value.durationMs))throw Error('Recording identity changed.');clip=value;return value;},
        cancel,
      };
    }catch(error){await cancel();throw error;}
  }
  /** Holds a finished transcript until the user sends (possibly edited) text or discards it. */
  function reviewConversationTurn(text:string,signal:AbortSignal,current:()=>void){
    return new Promise<string|null>((resolve,reject)=>{
      const done=()=>{signal.removeEventListener('abort',aborted);if(conversationReview===held){conversationReview=undefined;refresh();}};
      const aborted=()=>{done();reject(signal.reason??new DOMException('Voice review changed','AbortError'));};
      const held={text,settle:(value:string|null)=>{try{current();}catch(error){done();reject(error);return;}done();resolve(value);}};
      conversationReview=held;signal.addEventListener('abort',aborted,{once:true});if(signal.aborted)aborted();else refresh();
    });
  }
  async function beginConversation(){
    const chat=chatDestination;if(!chat||!chatCurrent())return;
    const provider=connectionController.getSnapshot();
    if(provider.residentInference==='direct'&&!provider.providerStatus?.voiceConfigured){conversationState={phase:'error'};error='Voice is off. Add an optional Cartesia key in AI provider settings.';refresh();return;}
    const token=generation;
    if(cloudConnectRequired&&!developmentCartesiaVoiceEnabled&&!developmentCloudRealtimeVoiceEnabled&&!developmentCloudVoiceEnabled){conversationState={phase:'error'};error=`Sign in to ${voiceServiceName()} to use voice.`;refresh();return;}
    const controller=new AbortController();readiness=controller;conversationReviewRequired=false;conversationState={phase:'starting'};error='';refresh();
    const current=()=>{controller.signal.throwIfAborted();if(token!==generation||chatDestination!==chat||!chatCurrent())throw new DOMException('Voice conversation changed','AbortError');};
    try{
      current();const prepared=await chat.shell.prepareVoiceConversation(controller.signal);current();conversationPrepared=prepared;current();
      const previous=conversationVoice;conversationVoice=undefined;await stopping;await previous?.stop();current();
      if(ownBrowserVoiceActive()||developmentCloudRealtimeVoiceEnabled||(cloudMode&&developmentCartesiaVoiceEnabled&&!developmentCloudVoiceEnabled)){
        const direct=await developmentCartesiaConversation({binding:prepared.binding,assertCurrent:current,getUiContext:()=>{current();const context=chat.shell.voiceConversationContext(prepared.binding);const metadata=connectionController.voiceRendererMetadata(context);if(metadata.viewDelivery!=='completed-action')throw Error('The voice renderer is not bound to completed-action navigation.');return {viewDelivery:metadata.viewDelivery,uiViewPath:alphaViewPath(context.view),uiBrowserSurface:'native' as const,uiTimeZone:Intl.DateTimeFormat().resolvedOptions().timeZone};},onNavigate:async event=>{current();chat.shell.voiceSendTurnId=event.traceId;try{await chat.shell.applyRealtimeVoiceNavigation({...event,binding:prepared.binding,assertCurrent:current,navigation:navigationContinuation(chat,token,event.traceId)});current();}finally{if(chat.shell.voiceSendTurnId===event.traceId)chat.shell.voiceSendTurnId=undefined;}},onState:(phase,progressText='')=>{if(token!==generation)return;if(phase==='idle'&&['starting','error'].includes(conversationState.phase))return;if(phase==='listening')conversationInterim='';conversationState={phase:['connecting','ready'].includes(phase)?'starting':['complete','interrupted'].includes(phase)?'listening':['listening','transcribing','thinking','speaking'].includes(phase)?phase as 'listening'|'transcribing'|'thinking'|'speaking':'idle',progressText};refresh();},onPlaybackUnlockChange:()=>{if(token===generation)refresh();},onActionResult:summary=>{if(token===generation)chat.shell.toast(summary);},onTranscript:text=>{if(token===generation){if(!conversationInterim)conversationInterimKnownMessages=new Set((chat.shell.S().msgs||[]).map((m:Bag)=>String(m.id)));conversationLastTranscript=text;conversationInterim=text;refresh();}},onError:failure=>{if(token===generation){error=failure.message;conversationState={phase:'error',error:failure};refresh();}}});
        current();conversationVoice=direct;await direct.start();current();return;
      }
      const networkSpeech = provider.residentInference==='direct'||cloudRuntimeEnabled || testMocksEnabled;
      const local = networkSpeech ? null : createOnDeviceVoice();
      if(!networkSpeech&&(!local||!await local.ready(controller.signal)))throw Error('On-device speech is unavailable. Retry local speech or use the keyboard.');
      current();
      const cloudDriver = networkSpeech ? createCloudVoice() : null;
      let streamingCloud=cloudDriver&&provider.residentInference!=='direct'&&nativeCloudStreamingAvailable()?createCloudStreamingSpeech({
        environment:connectionController.getCloudEnvironment()!,credentialId:connectionController.getCloudClient()!.credentialId!,assertCurrent:current,
        onInterim:text=>{if(token!==generation||chatDestination!==chat)return;conversationInterim=text;refresh();},
      }):null;
      const selected = cloudDriver ?? {
        startRecording:()=>deviceVoice.startRecording({maxDurationMs:29000}),
        stopRecording:()=>deviceVoice.stopRecording(),
        getRecordingMetrics:(recordingId:string)=>deviceVoice.getRecordingMetrics({recordingId}),
        cancelRecording:async()=>{await deviceVoice.cancelRecording();},
        addListener:(event:'recordingStopped',callback:(clip:Clip)=>void)=>deviceVoice.addListener(event,callback),
      };
      driver=cloudDriver??deviceVoice;cloudMode=!!cloudDriver;
      let batchCaptureRetired=false;
      const sendTurn=async(input:{turnId:string;text:string;voiceTurnSignal:any;signal:AbortSignal})=>{
        input.signal.throwIfAborted();current();
        // VOICE_SEND_POLICY: 'auto-send' sends this transcript now; 'review' waits for Send or Discard.
        const sent=await sendVoiceEntry({policy:voiceSendPolicy(),transcript:input.text,review:text=>reviewConversationTurn(text,input.signal,current),send:async text=>{
          current();const turn={...conversationPrepared!};conversationReplyWatch=new Set((chat.shell.S().msgs||[]).map((m:Bag)=>String(m.id)));
          const ack=cloudDriver&&!Capacitor.isNativePlatform()?createBatchProgressAcknowledgment({turnId:input.turnId,conversationId:turn.binding.conversationId,ownerId:turn.binding.session.ownerId,signal:input.signal,assertCurrent:current,captureRetired:()=>batchCaptureRetired,speak:async(cue,signal)=>{const pending=Promise.resolve().then(()=>cloudDriver.speak(cue,signal));const owned=pending.catch(failure=>{if((failure as {code?:string})?.code==='speech-cleanup-unconfirmed'){mediaUnconfirmed=failure;stopping=Promise.reject(failure);void stopping.catch(()=>{});}throw failure;});conversationSpeech=owned;try{await owned;}finally{if(conversationSpeech===owned)conversationSpeech=undefined;}}}):undefined;
          const retireAck=()=>{try{current();}catch{void ack?.stop().catch(()=>{});}};
          const unsubscribeAck=ack?connectionController.subscribe(retireAck):()=>{};
          if(ack)document.addEventListener('visibilitychange',retireAck);
          try{
            const reply=await chat.shell.sendVoiceTurn({...input,text,...turn,assertCurrent:current,onProgress:ack?.progress,onReplyStarted:ack?.replyStarted,navigation:navigationContinuation(chat,token,input.turnId)});
            await ack?.finish();return reply;
          }finally{unsubscribeAck();document.removeEventListener('visibilitychange',retireAck);try{await ack?.stop();}finally{conversationReplyWatch=undefined;}}
        }});
        if(!sent){if(token===generation&&chatDestination===chat)cancelChat();throw new DOMException('Voice message discarded','AbortError');}
        const result=sent.result;input.signal.throwIfAborted();current();
        if(result.complete){markVoiceTiming('first-token');markVoiceTiming('final-reply');}
        conversationLastTranscript=sent.text;conversationLastReply=result.text;conversationReviewRequired=result.reviewRequired===true&&!result.awaitingUserInput;return result;
      };
      const voiceStopped=(value:BatchVoiceState)=>cloudVoiceFailure(value.error)||((value.error as {reason?:unknown})?.reason==='call-active'?'Voice paused for a phone call. Start the voice conversation again after the call, or switch to the keyboard.':null)||((value.error as {code?:unknown})?.code==='no-speech'?(cloudDriver?`${voiceServiceName()} heard no speech, so nothing was sent. Start the voice conversation again, or switch to the keyboard.`:'No speech was heard, so nothing was sent. Start the voice conversation again, or switch to the keyboard.'):(value.error as {code?:unknown})?.code==='live-asr'?'On-device transcription stopped. Start the voice conversation again, or switch to the keyboard.':(value.error as {code?:unknown})?.code==='capture'?'The microphone stopped. Start the voice conversation again, or switch to the keyboard.':'Voice stopped. Check your connection and conversation history before trying again.');
      // Cloud uses a persistent speech-only socket, server Ink endpointing and native PCM
      // playback. Agent execution/actions remain on the resident; no batch audio upload or
      // extra spoken progress request sits in this path. Native profile retains local VAD/ASR.
      if(streamingCloud||!cloudDriver&&local&&await nativeLiveVoiceReady(controller.signal)){
        current();
        // The resident's end-of-turn and heard routes (voice-turn-routes.ts), fenced to this
        // conversation's binding: owner session, connection epoch and conversation.
        const binding=prepared.binding;
        const residentRequest=()=>{const resident=connectionController.getResidentLiveVoice();return resident&&connectionController.voiceConversationCurrent(binding,false)?resident.request:null;};
        // The end-of-turn chain: the resident's fused scorer, then Clef only when it is admitted
        // (clefEndpointStage, off: #663), then the session's long gap. Each answer names its path.
        const semanticEndpoint=streamingCloud?undefined:createEndpointChain({local:residentEndpoint(residentRequest),clef:clefEndpointStage()})!;
        const heardReporter=createHeardReporter({
          request:residentRequest,
          current:conversationId=>conversationId===binding.conversationId&&connectionController.voiceConversationCurrent(binding,false),
          isAssistantReply:(conversationId,messageId)=>conversationId===binding.conversationId&&(chat.shell.S().msgs||[]).some((m:Bag)=>m.id===messageId&&m.from==='agent'),
        });
        // Voice timing record of each submitted turn, for its later heard outcome (ids only).
        const timingTurns=new Map<string,string>();
        const assistant:VoiceAssistantSession=new VoiceAssistantSession({
          conversationId:prepared.binding.conversationId,
          assertCurrent:current,
          // Each utterance is sent with the screen context current when the user began speaking.
          beginUtterance:()=>{current();conversationPrepared={...conversationPrepared!,context:chat.shell.voiceConversationContext(prepared.binding)};current();},
          listen:streamingCloud?streamingCloud.listen:nativeAssistantListener({onLatency:recordLiveVoiceTiming,onInterim:text=>{if(token!==generation||chatDestination!==chat)return;conversationInterim=text;refresh();}}),
          // After the short gap: the chain. Unavailable, slow or failing: the long gap decides.
          ...(streamingCloud?{}:{endpoint:(text:string,signal:AbortSignal)=>{current();return semanticEndpoint!(text,signal);}}),
          shouldRespond:(text,context)=>shouldRespondToVoiceTurn(text,context),
          turnSignal:text=>buildVoiceTurnSignal(text),
          send:sendTurn,
          speakable:text=>toSpeakableText(text),
          speak:async input=>{input.signal.throwIfAborted();current();const started=()=>{current();input.onStarted();};const pending=streamingCloud?streamingCloud.speak(input.text,input.signal,started):local!.speak(input.text,input.signal,started,true);conversationSpeech=pending;try{await pending;input.signal.throwIfAborted();current();}catch(failure){if((failure as {code?:string})?.code==='speech-cleanup-unconfirmed'){mediaUnconfirmed=failure;stopping=Promise.reject(failure);void stopping.catch(()=>{});}throw failure;}finally{if(conversationSpeech===pending)conversationSpeech=undefined;}},
          // Only what was played stays in this conversation's reply; the rest is marked unheard, and
          // the agent is asked to keep only the played prefix (nothing when it was fully heard).
          onHeard:heard=>{
            if(token!==generation||chatDestination!==chat)return;
            if(!heard.interrupted)return;
            const timing=timingTurns.get(heard.turnId);timingTurns.delete(heard.turnId);
            // A playback failure is not a barge-in: before any sentence finished the agent keeps the
            // whole reply (the reporter sends nothing), and so does this view.
            const failed=heard.playbackFailed===true;
            void heardReporter.report({conversationId:binding.conversationId,replyId:heard.replyId,heard:heard.heard,unheard:heard.unheard,interrupted:true,...(failed?{playbackFailed:true}:{})}).then(outcome=>{recordHeardVoiceTiming(timing,outcome);});
            if(failed&&!heard.heard)return;
            conversationLastReply=heard.heard;
            const note=heard.heard?'(Interrupted. The rest of this reply was not played.)':'(Interrupted before this reply was played.)';
            chat.shell.setState((state:Bag)=>({msgs:(state.msgs||[]).map((m:Bag)=>m.id===heard.replyId&&m.from==='agent'?{...m,text:heard.heard?`${heard.heard}\n\n${note}`:note,interrupted:true,voiceHeard:heard.heard}:m)}));
          },
          onTurn:(event,turnId,detail)=>{if(token!==generation)return;if(event==='submitted'){recordingEnded(`live:${turnId}`,'conversation');markVoiceTiming('transcript-ready');if(detail)recordEndpointVoiceTiming(detail.endpoint);const timing=activeVoiceTurn();if(timing){timingTurns.set(turnId,timing);if(timingTurns.size>32)timingTurns.delete(timingTurns.keys().next().value!);}}else if(event==='first-audio')markVoiceTiming('first-audio');else if(event==='finished')finishVoiceTurn();else abandonVoiceTurn();},
          onLevel:peak=>{if(token!==generation)return;conversationLevels=[...conversationLevels.slice(-43),peak];},
          onState:value=>{
            if(token!==generation||chatDestination!==chat||conversationVoice!==assistant)return;
            assistantState=value;conversationState=value as BatchVoiceState;
            if(value.phase==='thinking'&&value.transcript){conversationLastTranscript=value.transcript;conversationLastReply='';}
            if(value.phase!=='listening')conversationInterim='';
            if(value.phase==='error')error=voiceStopped(value as BatchVoiceState);
            stopClock();if(value.phase==='listening'||value.phase==='speaking')tick=setInterval(refresh,250);refresh();
          },
        },streamingCloud?{timing:{shortGapMs:0,longGapMs:0}}:undefined);
        conversationLive=assistant;conversationVoice=assistant;conversationInterim='';conversationLevels=[];started=Date.now();
        try{await assistant.start();current();return;}
        catch(failure){
          // A server with no streaming route has not accepted microphone audio.
          // Keep the existing app usable during rollout; other failures never retry audio.
          if(!streamingCloud||(failure as {code?:string})?.code!=='cloud-http-404')throw failure;
          await assistant.stop();await streamingCloud.stop();current();
          streamingCloud=null;conversationLive=undefined;conversationVoice=undefined;conversationState={phase:'starting'};
        }
      }
      // The live assistant is not ready (or this is a Cloud route): the recorded-clip loop listens
      // only between replies, so say once that speaking will not interrupt a reply.
      if(!halfDuplexDisclosed){halfDuplexDisclosed=true;chat.shell.toast('Speaking will not interrupt Alpha’s reply in this voice mode. Close the voice conversation to stop a reply.');}
      const conversation:BatchVoiceConversation<Clip>=new BatchVoiceConversation<Clip>({
        conversationId:prepared.binding.conversationId,assertCurrent:current,
        capture:async input=>{current();batchCaptureRetired=false;conversationPrepared={...conversationPrepared!,context:chat.shell.voiceConversationContext(prepared.binding)};current();const capture=await captureConversationAudio(selected,current,input);return {stop:async()=>{const value=await capture.stop();current();batchCaptureRetired=true;return value;},cancel:async()=>{await capture.cancel();batchCaptureRetired=true;}};},
        transcribe:async(value,signal)=>{
          signal.throwIfAborted();current();
          const request=crypto.randomUUID();requestId=request;
          let interrupt!:(error:unknown)=>void;const cancelled=new Promise<never>((_,reject)=>interrupt=reject);
          const abort=()=>{void (cloudDriver??deviceVoice).cancel({requestId:request}).catch(()=>{});interrupt(signal.reason??new DOMException('Transcription cancelled','AbortError'));};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
          try{current();const result=await Promise.race([local?local.transcribe(value.recordingId,signal):cloudDriver!.transcribeRecording({recordingId:value.recordingId,requestId:request}),cancelled]);signal.throwIfAborted();current();markVoiceTiming('transcript-ready');conversationLastTranscript=result.text;return result.text;}
          finally{signal.removeEventListener('abort',abort);if(requestId===request)requestId=undefined;}
        },
        send:sendTurn,
        speak:async input=>{input.signal.throwIfAborted();current();const started=()=>{current();markVoiceTiming('first-audio');input.onStarted();};const pending=local?local.speak(input.text,input.signal,started,true):speakCloudSpeechChunks({text:input.text,signal:input.signal,assertCurrent:current,onStarted:started,speak:(text,signal,onStarted)=>cloudDriver!.speak(text,signal,onStarted)});conversationSpeech=pending;try{await pending;input.signal.throwIfAborted();current();}catch(failure){if((failure as {code?:string})?.code==='speech-cleanup-unconfirmed'){mediaUnconfirmed=failure;stopping=Promise.reject(failure);void stopping.catch(()=>{});}throw failure;}finally{if(conversationSpeech===pending)conversationSpeech=undefined;finishVoiceTurn();}},
        onState:value=>{if(token!==generation||chatDestination!==chat||conversationVoice!==conversation)return;conversationState=value;if(value.phase==='error')error=voiceStopped(value);if(value.phase==='listening'){stopClock();tick=setInterval(refresh,250);}else stopClock();refresh();},
      });
      conversationVoice=conversation;await conversation.start();current();
    }catch(failure){if(token!==generation||controller.signal.aborted)return;conversationState={phase:'error',error:failure};const classified=voiceFailure(failure,{transcribing:false,browser:!Capacitor.isNativePlatform()});error=cloudVoiceFailure(failure)||(classified&&(classified.kind==='denied'||classified.kind==='no-microphone')?classified.message:null)||'Voice could not start. Try again, or use the keyboard.';refresh();}
  }
  Component.prototype.stopVoiceConversation = function(){if(chatDestination?.shell===this){cancelChat(false,true);return stopping;}if(retirement&&retirement.shell===this)return retirement.promise;if(mediaUnconfirmed)return stopping;};
  Component.prototype.resumeReadReplyVoice=function(hint:import('../runtime/alpha-client').NativeNotesReadReplyHint,reply:import('../runtime/alpha-client').NativeNotesReadReply){
    if(chatDestination?.shell!==this||!chatCurrent()||document.querySelector('dialog[open]')||conversationState.phase!=='awaiting-user-input'||!conversationState.awaitingUserInput)return false;
    const pause=conversationState.awaitingUserInput;
    if(hint.proposalId!==pause.proposalId||hint.digest!==pause.digest||hint.requestId!==pause.requestId||hint.conversationId!==pause.conversationId||hint.inReplyTo!==pause.userMessageId||reply.requestId!==pause.requestId||reply.conversationId!==pause.conversationId||reply.inReplyTo!==pause.userMessageId)return false;
    return conversationVoice?.resume({pause,reply:{requestId:reply.requestId,conversationId:reply.conversationId,userMessageId:reply.inReplyTo,assistantMessageId:reply.messageId,text:reply.text,complete:true}})??false;
  };
  Component.prototype.prepareDeviceReadReview=async function(proposalId:string,digest:string|undefined,signal:AbortSignal){
    signal.throwIfAborted();if(stage!=='closed'&&!chatDestination)throw Error('Finish or discard the Notes recording before reviewing this request.');
    const binding=composerBinding(),pause=conversationState.awaitingUserInput;
    if(chatDestination?.shell===this&&!(conversationState.phase==='awaiting-user-input'&&pause?.proposalId===proposalId&&pause.digest===digest&&chatCurrent()))cleanup();
    const reading=stopLocalSpeechPlayback();stopSaved();await Promise.all([stopping,Promise.resolve(reading)]);signal.throwIfAborted();
    if(this.live===false||document.hidden||connectionController.getSnapshot().open||composerBinding()!==binding)throw Error('The Notes review changed.');
  };
  Component.prototype.retireReadReplyVoice=function(proposalId:string){if(chatDestination?.shell===this&&conversationState.awaitingUserInput?.proposalId===proposalId)cleanup();};
  function maybeStartDictation(){if(chatDestination?.mode==='dictation'&&chatCurrent()&&stage==='ready'&&onDeviceReady&&!busy)void primary();}
  Component.prototype.startTranscription = function(){
    if(this.live===false||document.hidden||connectionController.getSnapshot().open||chatDestination?.shell===this)return;
    if(this.pendingActionApproval||document.querySelector('dialog[open]')){this.toast('Finish or cancel the current review before transcribing.');return;}
    if(retirement||mediaUnconfirmed||stage!=='closed'){this.toast('Finish or discard the current recording before transcribing.');return;}
    const state=this.S(),chat:ChatDestination={mode:'dictation',shell:this,view:state.view||null,chat:state.chat,draft:String(state.draft||''),reply:this.messageReplyTarget,edit:this.messageEditTarget,binding:composerBinding(),...(document.activeElement instanceof HTMLElement?{opener:document.activeElement}:{})};
    const readingStopped=stopLocalSpeechPlayback();enter(undefined,undefined,'device',chat);
    stopping=Promise.all([stopping,Promise.resolve(readingStopped)]).then(()=>{}).catch(failure=>{mediaUnconfirmed=failure;throw failure;});void stopping.catch(()=>{});
    const token=generation;this.setState({chat:state.chat==='full'?'full':'sheet',voice:'off'},()=>{if(token!==generation||chatDestination!==chat)return;document.querySelector<HTMLElement>('[data-alpha-chat-recorder] button')?.focus({preventScroll:true});maybeStartDictation();});
  };
  Component.prototype.startVoice = async function () {
    if(this.live===false||document.hidden||connectionController.getSnapshot().open||chatDestination?.shell===this)return;
    if(this.pendingActionApproval||document.querySelector('dialog[open]')){this.toast('Finish or cancel the current review before starting voice.');return;}
    if(retirement||mediaUnconfirmed){this.toast('Voice media has not finished stopping. Close the app if this continues.');return;}
    if(stage!=='closed'){this.toast('Finish or discard the Notes recording before starting a voice conversation.');return;}
    connectionController.warmInference();
    const state=this.S();
    const chat:ChatDestination={shell:this,view:state.view||null,chat:state.chat,draft:String(state.draft||''),reply:this.messageReplyTarget,edit:this.messageEditTarget,binding:composerBinding(),...(typeof HTMLElement!=='undefined'&&document.activeElement instanceof HTMLElement?{opener:document.activeElement}:{})};
    const readingStopped=stopLocalSpeechPlayback();
    enter(undefined,undefined,'default',chat);stopping=Promise.all([stopping,Promise.resolve(readingStopped)]).then(()=>{}).catch(failure=>{mediaUnconfirmed=failure;throw failure;});void stopping.catch(()=>{});conversationLastTranscript='';conversationLastReply='';const token=generation;
    await new Promise<void>(resolve=>this.setState({chat:state.chat==='hidden'&&!cloudRuntimeEnabled?'hidden':state.chat==='full'?'full':'sheet',voice:'off'},()=>{document.querySelector<HTMLElement>(state.chat==='hidden'&&!cloudRuntimeEnabled?'[data-alpha-pill-voice] button':'[data-alpha-chat-recorder] button')?.focus({preventScroll:true});if(chatDestination===chat&&generation===token){void beginConversation().finally(resolve);}else resolve();}));
  };
  function conversationRecorderView(icons:Bag){
    const token=generation,chat=chatDestination,owned=()=>token===generation&&chatDestination===chat&&chatCurrent();
    const phase=conversationState.phase,live=phase==='listening',seconds=live?(Date.now()-started)/1000:(clip?.durationMs||0)/1000;
    const messages:Record<string,string>={idle:'Voice conversation stopped.',starting:'Connecting to voice…',listening:'Listening…',transcribing:'Transcribing…',thinking:'Thinking…','awaiting-user-input':'Microphone off. Review the Notes request in this conversation. Only the note you explicitly share can be used for the answer.','preparing-speech':'Thinking…',speaking:'Speaking…',error:error||'Voice stopped. Check history before starting again.'};
    const recover=()=>{if(!owned()||mediaUnconfirmed)return;if(cloudConnectRequired){cleanup();connectionController.openCloudAccount();}else if(!connectionController.getSnapshot().session){cleanup();connectionController.open();}else if((phase==='error'&&!conversationReviewRequired)||phase==='idle')void beginConversation();else cancelChat(false,true);};
    const unavailable=phase==='error'&&(conversationState.error as {code?:unknown})?.code==='voice-http-503';
    const visibleError=unavailable?'Voice is unavailable right now. Try again later or use the keyboard.':error;
    const awaiting=phase==='awaiting-user-input'||conversationReviewRequired;
    const progressText=!awaiting&&!error&&(phase==='thinking'||phase==='speaking')?(conversationState.progressText||''):'';
    const reviewing=conversationReview,reviewOwned=()=>owned()&&conversationReview===reviewing;
    if(reviewing&&!mediaUnconfirmed)return {regionLabel:'Voice conversation',closeLabel:'Close voice conversation',state:'review',flex:'1',clockSize:28,clock:'Review',live:false,levels:[],lines:[{t:(cloudMode?`Review what ${voiceServiceName()} heard`:'Review what was heard on this device')+' and edit it if needed. Nothing has been sent. Send adds it to this conversation; Discard closes voice without sending.'}],
      review:true,transcript:reviewing.text,transcriptDisabled:false,onTranscript:(event:Event)=>{if(!reviewOwned())return;reviewing.text=(event.target as HTMLTextAreaElement).value;refresh();},
      typeChoice:false,lastTranscript:'',lastReply:'',primaryLabel:'Send voice message',primaryIcon:icons.check,primaryDisabled:!reviewing.text.trim(),stop:()=>{if(reviewOwned()&&reviewing.text.trim())reviewing.settle(reviewing.text);},
      pauseLabel:'Discard voice message',pauseIcon:icons.x,toggle:()=>{if(reviewOwned())reviewing.settle(null);},discard:()=>{if(owned())cancelChat();},keyboard:()=>{if(owned())cancelChat(true);}};
    const direct=(ownBrowserVoiceActive()||developmentCartesiaVoiceEnabled||developmentCloudRealtimeVoiceEnabled)&&conversationVoice&&'setMicrophoneMuted' in conversationVoice?conversationVoice:undefined;
    // Voice assistant: the microphone stays on while Alpha speaks so speech interrupts it; Mute turns it off.
    const assistant=conversationLive&&conversationVoice===conversationLive?conversationLive:undefined;
    if(assistant)messages.speaking='Alpha is speaking.';
    if(assistant&&assistantState.muted)messages.listening='Microphone off.';
    const assistantControls=assistant&&phase!=='error'?{canMute:phase!=='awaiting-user-input',muted:assistant.muted?'true':'false',muteLabel:assistant.muted?'Unmute microphone':'Mute microphone',toggleMute:()=>{if(owned())void assistant.setMuted(!assistant.muted).finally(refresh);},canInterrupt:phase==='speaking',interrupt:()=>{if(owned()&&assistant.interruptSpeech())refresh();}}:{};
    const extra=assistant?assistantControls:direct?{canMute:true,muteAutomatically:direct.microphoneAutomaticallyMuted,muteLabel:direct.microphoneAutomaticallyMuted?'Microphone paused while Alpha speaks':direct.microphoneMuted?'Unmute microphone':'Mute microphone',muted:direct.microphoneMuted||direct.microphoneAutomaticallyMuted?'true':'false',toggleMute:()=>{if(owned()){direct.setMicrophoneMuted(!direct.microphoneMuted);refresh();}},needsPlaybackUnlock:direct.needsPlaybackUnlock,unlockPlayback:()=>{if(owned())void direct.unlockPlayback().then(refresh).catch(failure=>{error=failure instanceof Error?failure.message:'Playback could not unlock.';refresh();});}}:{};
    return {...extra,regionLabel:'Voice conversation',closeLabel:'Close voice conversation',state:phase,flex:awaiting?'0 0 auto':'1',clockSize:awaiting?28:48,clock:awaiting?'Review':`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`,live,levels:conversationLevels.map(peak=>({h:4+Math.round(44*peak)})),progressText,errorDetail:unavailable?'Voice service returned HTTP 503.':'',lines:[{t:conversationReviewRequired?'Microphone off. Review the phone action in this conversation. Switch to keyboard to continue; voice cannot resume this older request.':visibleError||messages[phase]},...(phase==='error'&&conversationLastTranscript?[{t:'Last transcript: '+conversationLastTranscript}]:[])],review:false,typeChoice:false,lastTranscript:awaiting?'':conversationLastTranscript,interimTranscript:awaiting||(!direct&&!['listening','transcribing'].includes(phase))?'':conversationInterim,lastReply:awaiting?'':conversationLastReply,primaryLabel:'Stop voice conversation',primaryIcon:icons.stop,primaryDisabled:false,stop:()=>{if(owned())cancelChat(false,true);},recoveryLabel:mediaUnconfirmed?'':cloudRuntimeEnabled&&phase==='idle'&&!cloudConnectRequired?'Start Cloud voice':cloudConnectRequired?`Connect ${voiceServiceName()}`:!connectionController.getSnapshot().session?'Connect agent':phase==='error'&&!conversationReviewRequired?'Try voice again':'',recover,discard:()=>{if(owned())cancelChat();},keyboard:()=>{if(owned())cancelChat(true);}};
  }
  /**
   * The recording side of voice-note deletion (receipts, erase, Trash purge, approved agent
   * deletion, the interrupted-deletion backstop, status passes and leases) is the shared
   * plugin-notes recording effects over AlphaNoteAudio. Callers hold the deletion-effects lock.
   */
  let sharedRecordingEffects:NotesRecordingEffects|undefined;
  // Created on first use, so installing the voice views needs no Notes storage.
  const recordingEffects=()=>sharedRecordingEffects??=createNotesRecordingEffects({recordings:noteAudio,journal:audioDeletionJournal,savedNotes,now:()=>Date.now()});
  const deletionReceipt=(row:AudioDeletion,status:'removed'|'restored')=>recordingEffects().confirmReceipt(row,status);
  const eraseForever=(row:AudioDeletion)=>recordingEffects().eraseForever(row);
  const trashRow=(entry:NotesTrashEntry):AudioDeletion=>{
    if(!entry.audio||!entry.target)throw Error('This Trash entry has no recording');
    return {id:entry.id,target:entry.target,note:entry.note,audioId:entry.audio.audioId};
  };
  /**
   * Approved agent deletion of a voice note. Same protocol as the editor delete: Trash row and
   * recovery row before the tombstone commit, then the recording moves to the audio trash under
   * the same operation id, so Trash restores or purges note and recording together.
   */
  function trashVoiceNoteWithRecording<T>(note:Bag,target:NotesTarget,operationId:string,index:number,commit:()=>Promise<T>):Promise<T>{
    return recordingEffects().trashWithRecording({note:note as AudioDeletion['note'],target,operationId,commit,
      addTrashEntry:async audio=>{await editNotesTrash(doc=>addNotesTrashEntry(doc,{id:operationId,note:note as NotesTrashEntry['note'],target,index,deletedAt:Date.now(),...(audio?{audio}:{})}));}});
  }
  async function dropTrashEntry(id:string){
    if((await readNotesTrash()).entries.some(entry=>entry.id===id))await editNotesTrash(doc=>removeNotesTrashEntries(doc,[id]));
    window.dispatchEvent(new Event('alpha:notes-trash-changed'));
  }
  async function restoreDeletion(row:AudioDeletion,current:Bag,index=0):Promise<boolean>{
    if(deletionBusy)return false;deletionBusy=true;let done=false;
    try{await withAudioDeletionLock(async()=>{
      if(!current.voiceNoteActive()||document.hidden)throw Error('Open Notes to restore');
      const trashEntry=(await readNotesTrash()).entries.find(entry=>entry.id===row.id);
      if(trashEntry&&notesTrashExpired(trashEntry,Date.now()))throw Error('Trash retention expired');
      const state=await audioDeletionNoteState(row);
      if(state==='changed')throw Error('A newer note must be preserved');
      if(current.storageReady?.()===false)throw Error('Reopen Notes first');
      // The shown row may predate a lease renewal; the stored row is the same deletion.
      const stored=(await pendingAudioDeletions())[row.id];if(stored&&sameDeletionRow(stored,row))row=stored;
      if(!stored)await changeAudioDeletion(row,true);
      const metadata=await noteAudio.describe({audioId:row.audioId});
      if(metadata.noteId!==row.note.id||metadata.audioId!==row.audioId)throw Error('Recording association changed');
      if(!current.voiceNoteActive()||document.hidden)throw Error('Open Notes to restore');
      await noteAudio.restore({audioId:row.audioId,noteId:row.note.id,operationId:row.id});
      await deletionReceipt(row,'restored');
      const restored=await noteAudio.describe({audioId:row.audioId});
      if(restored.deletedAt||restored.noteId!==row.note.id)throw Error('Restore unconfirmed');
      if(await audioDeletionNoteState(row)!==state)throw Error('Note changed while restoring');
      if(!current.voiceNoteActive()||document.hidden)throw Error('Open Notes to restore');
      if(state==='deleted'){
        const list=current.get('notes').list;
        // Reinstate the exact reviewed record (same id and revision) near its old position.
        if(list.some((n:Bag)=>n.id===row.note.id))throw Error('Restore unconfirmed');
        const next=list.slice();next.splice(Math.min(Math.max(0,index),next.length),0,structuredClone(row.note));
        if(await current.saveVoiceNote({list:next},{exact:true})!==true)throw Error('Restore unconfirmed');
      }
      if((await pendingAudioDeletions())[row.id])await changeAudioDeletion(row,false);
      await dropTrashEntry(row.id);
      done=true;current.toast('Voice note restored.');
    });}catch{current.toast('Restore is unconfirmed. Reopen Notes and check deletion status. No newer note was replaced.');}
    finally{deletionBusy=false;void refreshDeletionStatus(current);}
    return done;
  }
  /**
   * Editor deletion of a voice note. Normally the note and recording move to Trash. With
   * `permanent` (a full Trash refused the restorable copy and the person confirmed separately)
   * no Trash row is written: the recovery row is the only copy until the tombstone commit and
   * the erase of this exact recording are both confirmed, so an interruption at any point
   * leaves the deletion under review instead of losing or repeating an effect.
   */
  async function deleteVoiceNote(current:Bag,reviewed:Bag,permanent:boolean){
        if(deletionBusy)return;deletionBusy=true;stopSaved();
        if(permanent)current.set({trashBusy:true});
        let row:AudioDeletion|undefined,refusedFull=false;
        const active=()=>current.voiceNoteActive()&&current.isActive()&&!document.hidden&&!connectionController.getSnapshot().open&&current.get('notes').open===reviewed.id;
        try {await withAudioDeletionLock(async()=>{
          if(!active())return;
          const prior=Object.values(await pendingAudioDeletions()).find(x=>x.note.id===reviewed.id);
          if(prior){current.toast('Deletion remains unconfirmed. Check deletion status; it will not be repeated.');return;}
          const target=await current.reviewAudioDeletion(reviewed);
          if(!active())return;
          const metadata=await noteAudio.describe({audioId:reviewed.audio.audioId});
          if(metadata.noteId!==reviewed.id||metadata.audioId!==reviewed.audio.audioId||metadata.deletedAt)throw Error('Recording association changed');
          if(!active())return;
          // Leased: the Android native passes leave a row this renderer is working on alone (MVP-15).
          row=leasedDeletionRow({id:crypto.randomUUID(),target,note:reviewed as AudioDeletion['note'],audioId:reviewed.audio.audioId,...(permanent?{permanent:true as const}:{})},Date.now());
          // Write-ahead Trash copy: the note text and its recording stay restorable for three days.
          // Maintenance drops it again if the deletion below never commits.
          const index=Math.max(0,(current.get('notes').list||[]).findIndex((n:Bag)=>n.id===reviewed.id));
          if(!permanent)try{await editNotesTrash(doc=>addNotesTrashEntry(doc,{id:row!.id,note:reviewed as NotesTrashEntry['note'],target,index,deletedAt:Date.now(),audio:{audioId:reviewed.audio.audioId}}));}
          catch(error){
            // Definite refusal before any effect: note and recording are untouched.
            if(!isNotesTrashFull(error))throw error;
            row=undefined;refusedFull=true;refusedVoice=reviewed;
            if(active())current.set({trashFull:{id:reviewed.id,title:reviewed.title||'Voice note',voice:true},trashConfirm:null});
            return;
          }
          if(permanent){
            // The reviewed record must be the one in authoritative storage, not only in this view's copy:
            // if another view changed it or moved it to Trash, that Trash row is the only restorable copy.
            const saved=(await savedNotes()).find(n=>n.id===reviewed.id);
            if(!saved||JSON.stringify(saved)!==JSON.stringify(reviewed)){row=undefined;current.toast('This note changed. Nothing was deleted.');return;}
            // The note is saved and its recording is live, so any Trash row for it is stale (maintenance
            // would drop it). Left in place it would offer the permanently deleted note for restore again.
            const stale=(await readNotesTrash()).entries.filter(entry=>entry.note.id===reviewed.id).map(entry=>entry.id);
            if(stale.length)await editNotesTrash(doc=>removeNotesTrashEntries(doc,stale));
          }
          sessionDeletions.add(row.id);claimDeletion(row.id);
          await changeAudioDeletion(row,true);
          const authorized=()=>{if(!active())throw Error('Review changed');};
          try{await current.commitAudioNoteDeletion(row,authorized);}catch{
            current.toast('Deletion is unconfirmed. Check deletion status; it will not be repeated.');return;
          }
          if(await audioDeletionNoteState(row)!=='deleted')throw Error('Saved note changed');
          // The durable intent already exists before this second, separately observable effect.
          const retained=await noteAudio.describe({audioId:row.audioId});
          if(retained.noteId!==row.note.id||retained.audioId!==row.audioId)throw Error('Recording association changed');
          const dispatched=leasedDeletionRow({...row,audioRequested:true as const},Date.now());await changeAudioDeletion(row,false,dispatched);row=dispatched;
          if(await audioDeletionNoteState(row)!=='deleted')throw Error('Saved note changed before audio dispatch');
          if(!current.voiceNoteActive()||document.hidden)throw Error('Notes is no longer active');
          if(!retained.deletedAt)try{await noteAudio.remove({audioId:row.audioId,noteId:row.note.id,operationId:row.id});}catch{/* Readback only; never repeat a possibly completed trash operation. */}
          const result=await noteAudio.describe({audioId:row.audioId});
          if(result.noteId!==row.note.id||!result.deletedAt||await audioDeletionNoteState(row)!=='deleted')throw Error('Deletion unconfirmed');
          await deletionReceipt(row,'removed');
          if(permanent)await eraseForever(row);
          await changeAudioDeletion(row,false);releaseDeletionClaim(row.id);
          if(active())current.set({open:null});
          window.dispatchEvent(new Event('alpha:notes-trash-changed'));
          if(permanent)current.toast(`${reviewed.title||'Voice note'} and its recording deleted forever`);
          else current.toast('Voice note moved to Trash', {undo:()=>void restoreDeletion(row!,current,index)});
        });} catch {current.toast(refusedFull?'Could not show the Trash choices. Nothing was deleted.':'Deletion is unconfirmed. Check deletion status; no deletion will be repeated.');}
        finally{
          deletionBusy=false;
          if(permanent){refusedVoice=null;current.set({trashBusy:false,trashFull:null});}
          void refreshDeletionStatus(current);
        }
  }
  /**
   * One pass at a time; a caller that arrives during a pass waits for that pass. Every caller first
   * shows the rows as they are now, without the lock, so a pass queued behind another view's
   * deletion never hides the review rows from a view that opens meanwhile.
   */
  function refreshDeletionStatus(current:Bag):Promise<void>{
    const running=deletionRefresh;
    if(running){
      void pendingAudioDeletions().then(rows=>{current.setView('notes',{audioDeletionPending:Object.values(rows),audioDeletionChecked:true});}).catch(()=>{/* The running pass reports the failure. */});
      return running;
    }
    return deletionRefresh=(async()=>{
    try{
      current.setView('notes',{audioDeletionPending:Object.values(await pendingAudioDeletions()),audioDeletionChecked:true});
      await withAudioDeletionLock(async()=>{const rows=Object.values(await pendingAudioDeletions());
      for(const row of rows){try{
        // Rows an earlier process left are settled from readback (the interrupted-deletion plan), never
        // while another live view claims them: their effects may still be in flight. Rows this process
        // started only finish their erase or confirm their receipt.
        const startedHere=sessionDeletions.has(row.id);
        const retired=await recordingEffects().reconcile(row,{startedHere,claimedElsewhere:()=>deletionClaimedElsewhere(row.id),commitDeletion:settled=>current.commitAudioNoteDeletion(settled,()=>{})});
        if(retired&&row.permanent&&!startedHere)window.dispatchEvent(new Event('alpha:notes-trash-changed'));
      }catch{/* Readback only. Preserve unknown operations. */}}
      // Rows still shown under review stay leased, so the native passes never erase what Restore offers.
      await recordingEffects().renewLeases();
      current.setView('notes',{audioDeletionPending:Object.values(await pendingAudioDeletions()),audioDeletionChecked:true});
    });}catch{current.setView('notes',{audioDeletionRecoveryFailed:true,audioDeletionChecked:true});}finally{deletionRefresh=null;}
    })();
  }
  notes.render = (state: Bag, current: Bag) => {
    api = current;
    if(!state.audioDeletionChecked)void refreshDeletionStatus(current);
    const selected = (current.get('notes').list || []).find((n: Bag) => n.id === state.open);
    if (savedPlaying && selected?.audio?.audioId !== savedPlaying) stopSaved();
    const result = render({ ...state, record: false, rec: null, ...(selected?.audio ? { playing: false, pos: savedPosition / 1000 } : {}) }, current);
    result.audioDeletionPending=(state.audioDeletionPending||[]).map((row:AudioDeletion)=>({title:row.note.title||'Voice note',restore:()=>void restoreDeletion(row,current)}));
    result.audioDeletionUnknown=!!state.audioDeletionRecoveryFailed||result.audioDeletionPending.length>0;
    result.checkAudioDeletion=()=>void refreshDeletionStatus(current);
    for (const card of [...(result.colL || []), ...(result.colR || [])]) if ((current.get('notes').list || []).some((n: Bag) => n.id === card.id && n.audio)) card.bars = card.bars.map(() => 4);
    if (selected?.audio && result.vo) {
      const vo = result.vo;
      // A retained recording is not automatically summarized or scheduled.
      vo.ready=Array.isArray(selected.summary)&&selected.summary.length>0;vo.noSummary=false;
      vo.canReviewTranscript=!!String(selected.body||selected.audio.transcript||'').trim();
      vo.reviewTranscript=()=>{
        closeTranscriptQuestion?.();stopSaved();
        const snapshot=JSON.stringify(selected),active=()=>current.voiceNoteActive()&&current.isActive()&&!document.hidden&&!connectionController.getSnapshot().open&&current.get('notes').open===selected.id&&JSON.stringify(current.get('notes').list.find((n:Bag)=>n.id===selected.id))===snapshot;
        if(!active())return;
        closeTranscriptQuestion=reviewContentQuestion({name:selected.title||'Recording transcript',text:String(selected.body||selected.audio.transcript||''),question:'Summarize this meeting and list its action items. Do not change or schedule anything. Return JSON with exactly two fields: summary (a string) and actions (an array of short strings). Include only actions supported by this excerpt.',sourceLabel:'Offer to save the reviewed answer to this recording',sourceDescription:'You can then edit the summary and action items before saving them to this recording.',current:active,source:async()=>({kind:'recording',version:1,name:String(selected.title||'Recording transcript').slice(0,120),noteId:selected.id,revision:await recordingRevision(selected)}),compose:(text,source)=>current.composeContentQuestion(text,source),closed:()=>{closeTranscriptQuestion=undefined;}});
      };
      // Both hand-offs open a Calendar draft only. Nothing is written until the user saves there.
      // The draft carries a back-reference to this exact note (id, recording and reviewed revision).
      const draftFromNote=async(kind:'reminder'|'event')=>{
        if(noteHandoffBusy)return;
        const reviewed=()=>{const note=current.get('notes').list.find((n:Bag)=>n.id===selected.id);return current.isActive()&&!document.hidden&&current.get('notes').open===selected.id&&JSON.stringify(note)===JSON.stringify(selected)?note:null;};
        const note=reviewed();if(!note)return;
        const actionText=(note.actions||[]).filter((a:Bag)=>!a.done).map((a:Bag)=>String(a.t||'')).join('\n');
        if(!actionText.trim()){current.toast('No open action items. Review the transcript with Alpha first.');return;}
        if(actionText.length>4000){current.toast(kind==='event'?'Shorten the action items before creating an event. Nothing was added to your calendar.':'Shorten the action items before creating a reminder. Nothing scheduled.');return;}
        noteHandoffBusy=true;
        try{
          const origin=noteOriginFor(note,await recordingRevision(note));
          if(!reviewed())return;
          const shared={id:null,title:'',off:1,t:9,d:1,where:'',video:false,who:[],repeat:'none',notes:actionText,...(origin?{origin}:{})};
          current.open('calendar',{calendarAuthority:current.get('calendar').calendarAuthority,form:kind==='event'?{...shared,creationId:crypto.randomUUID(),separateCreation:false,cal:'native:local',alert:null}:{...shared,cal:'alpha-reminders',alert:0},open:null,month:null,day:1},'hidden');
          current.toast(kind==='event'?'Choose one action and review its time, then Save. Nothing is on your calendar yet.':'Choose one action and review its time, then Save. Nothing scheduled yet.');
        }finally{noteHandoffBusy=false;}
      };
      vo.toCal=()=>void draftFromNote('reminder');
      vo.calLabel='Review reminder draft';vo.calText='Review reminder';vo.calIcon=current.ic.cal;
      vo.toEvent=()=>void draftFromNote('event');
      vo.eventLabel='Review calendar event draft';vo.eventText='Review event';

      // A saved recording's reviewed transcript uses the same disclosed speech route as text notes.
      const voText = noteSpeechText(selected), voReading = currentNoteReading()?.noteId === selected.id;
      vo.readLabel = cloudRuntimeEnabled ? `Read with ${voiceServiceName()}` : 'Read aloud';
      vo.cloudSpeechDisclosure = cloudRuntimeEnabled ? `Read with ${voiceServiceName()} uploads this note’s text to your selected Cloud account for Cartesia speech and uses your plan allowance.` : '';
      vo.stopReading = voReading ? () => stopSpeaking() : undefined;
      vo.readAloud = voText && !voReading ? () => {
        stopSaved();
        void speakNote(voText, { noteId: selected.id }).then(outcome => {
          if (outcome === 'unavailable') current.toast(cloudRuntimeEnabled?`${voiceServiceName()} speech is unavailable. Check your account and connection. The note is unchanged.`:'On-device speech is unavailable. The note is unchanged.');
          else if (outcome === 'unsupported') current.toast('This note has text that cannot be read aloud. Nothing was read.');
          else if (outcome === 'failed') current.toast('Reading stopped before the end. The note is unchanged.');
        });
      } : undefined;
      vo.playLabel = savedPlaying ? 'Stop recording playback' : 'Play recording';
      vo.playIcon = savedPlaying ? current.ic.stop : current.ic.play;
      vo.play = () => { if (currentNoteReading()?.noteId === selected.id) stopSpeaking(); void playSaved(selected); };
      vo.lines = [{ ini: 'You', who: 'You', t: selected.body || selected.audio.transcript, at: '0:00', chip: 'background:var(--acc);color:#fff', css: '', seek: () => { void playSaved(selected); } }];
      vo.bars = vo.bars.map((bar: Bag) => ({ ...bar, h: 4 })); // No invented amplitude analysis.
      vo.share = () => current.toast('Audio stays in this app. Sharing recordings is not available yet.');
      const reviewed=structuredClone(selected);
      vo.del = () => { void deleteVoiceNote(current,reviewed,false); };

    }
    result.record = () => enter();
    if (result.ed) result.ed.dictate = () => {
      const n = (current.get('notes').list || []).find((item: Bag) => item.id === state.open);
      if (n?.kind === 'list') { current.toast('Convert this checklist to text before dictating.'); return; }
      if (!n) return;
      const body = n.body || '', editor = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Note"]');
      const start = editor && editor.value === body ? editor.selectionStart : body.length;
      const end = editor && editor.value === body ? editor.selectionEnd : body.length;
      enter({ id: n.id, body, revision: JSON.stringify(n), start, end });
    };
    // Read aloud follows the runtime profile. Closing, leaving or editing the note stops it.
    const readNote = (current.get('notes').list || []).find((item: Bag) => item.id === state.open);
    const readText = noteSpeechText(readNote), activeReading = currentNoteReading();
    // The read note was closed or changed. Stop after this render: stopping updates the view state.
    if (activeReading?.noteId && (!readNote || activeReading.noteId !== readNote.id || activeReading.text !== readText)) {
      const stale = activeReading;
      void Promise.resolve().then(() => { const now = currentNoteReading(); if (now && now.noteId === stale.noteId && now.text === stale.text) stopSpeaking(); });
    }
    if (result.ed) {
      const note = readNote, text = readText, mine = !!note && currentNoteReading()?.noteId === note.id;
      const ed = result.ed, onBody = ed.onBody, onTitle = ed.onTitle;
      const editing = (handler: unknown) => typeof handler === 'function' ? (...args: unknown[]) => { if (currentNoteReading()?.noteId === note?.id) stopSpeaking(); return (handler as (...a: unknown[]) => unknown)(...args); } : handler;
      ed.onBody = editing(onBody); ed.onTitle = editing(onTitle);
      const live = mine && currentNoteReading()?.noteId === note.id;
      ed.reading = live; ed.readAvailable = !!note && !!text;
      ed.readLabel = live ? 'Stop reading' : cloudRuntimeEnabled ? `Read with ${voiceServiceName()}` : 'Read aloud';
      ed.cloudSpeechDisclosure = cloudRuntimeEnabled ? `Read with ${voiceServiceName()} uploads this note’s text to your selected Cloud account for Cartesia speech and uses your plan allowance.` : '';
      ed.stopReading = live ? () => stopSpeaking() : undefined;
      ed.readAloud = ed.readAvailable && !live ? () => {
        if (!note || !text) return;
        if (currentNoteReading()?.noteId === note.id) { stopSpeaking(); return; }
        void speakNote(text, { noteId: note.id }).then(outcome => {
          if (outcome === 'unavailable') current.toast(cloudRuntimeEnabled?`${voiceServiceName()} speech is unavailable. Check your account and connection. The note is unchanged.`:'On-device speech is unavailable. The note is unchanged.');
          else if (outcome === 'unsupported') current.toast('This note has text that cannot be read aloud. Nothing was read.');
          else if (outcome === 'failed') current.toast('Reading stopped before the end. The note is unchanged.');
        });
      } : undefined;
    }
    if (stage === 'closed'||chatDestination) return result;
    result.recording=true;result.rec=recorderView(current.ic);return result;
  };
  function recorderView(icons:Bag){
    const token=generation,chat=chatDestination;
    const owned=()=>token===generation&&chatDestination===chat&&(!chat||chatCurrent());
    const seconds = stage === 'recording' ? (Date.now() - started) / 1000 : (clip?.durationMs || 0) / 1000;
    const labels: Bag = { ready: 'Start recording', starting: 'Starting microphone', recording: 'Stop recording', recorded: onDeviceReady ? 'Transcribe on this phone' : pairedAsrReady ? 'Transcribe with agent Whisper' : deviceOnly ? 'Review recording' : cloudMode ? `Transcribe with ${voiceServiceName()}` : 'Transcribe locally', transcribing: 'Cancel transcription', review: chatDestination ? 'Use in conversation' : destination ? 'Apply transcript' : 'Save note' };
    const messages: Bag = { ready: deviceOnly ? 'Record up to 59 seconds in this app. You can add a transcript manually and save without signing in. Nothing is uploaded.' : cloudMode ? `Record up to 59 seconds. Audio stays in this app until you choose Transcribe with ${voiceServiceName()}; uploads use your Cloud plan allowance.` : 'Development voice: record up to 59 seconds. Audio goes to this computer only after you choose Transcribe locally.', starting: 'Waiting for microphone access.', recording: 'Recording. Waveform levels are unavailable. Stop does not upload audio.', recorded: deviceOnly ? 'Microphone is off. Review the recording and enter a transcript manually. Cloud transcription is not connected; nothing is uploaded.' : cloudMode ? `Microphone is off. Choose Transcribe with ${voiceServiceName()} to upload this recording to your selected Cloud account.` : 'Microphone is off. Choose Transcribe locally to process this clip on the connected development computer.', transcribing: cloudMode ? `Transcribing with ${voiceServiceName()}. Nothing has been saved.` : 'Transcribing on the local computer. Nothing has been saved.', review: deviceOnly ? 'Enter a transcript manually, then save it with this recording in this app. Nothing is uploaded or sent to an agent.' : chatDestination ? 'Review the transcript, then use it in the conversation. Press Send there to send it to your agent.' : 'Review and edit the transcript, then save the recording and transcript in this app. Nothing is sent to the agent.' };
    if (pairedAsrReady) { messages.ready = 'Record up to 59 seconds. English transcription uses your selected agent. Audio stays in this app until you choose Transcribe with agent Whisper.'; messages.recorded = 'Microphone is off. Transcribe with agent Whisper uploads this recording to your selected agent for English speech recognition.'; messages.transcribing = 'Transcribing with your selected agent. Nothing has been saved.'; messages.review = chatDestination ? 'Review the agent transcript, then use it in the conversation. Press Send there to send the message.' : 'Review and edit the agent transcript, then save it with the recording in this app. Nothing is sent as a chat message.'; }
    if (onDeviceReady) {
      messages.ready = 'Record up to 29 seconds. English transcription runs on this phone. Nothing is uploaded.';
      messages.recorded = 'Microphone is off. Transcribe on this phone processes this recording without uploading audio.';
      messages.transcribing = 'Transcribing on this phone. Nothing has been saved or uploaded.';
      messages.review = chatDestination ? 'Review the transcript, then use it in the conversation. Press Send there to send it to your agent.' : 'Review and edit the transcript, then save it in this app. Nothing is uploaded.';
      if (stage === 'review') messages.review += ' Listen also runs on this phone. Unfamiliar English names are spelled; numbers are read digit by digit. Unsupported symbols require editing.';
    }
    if (destination) messages.review = 'Review the transcript, then insert it at your saved selection. This keeps your text note; the recording is discarded after applying. ' + (onDeviceReady ? 'Nothing was uploaded.' : cloudMode ? `${voiceServiceName()} processed the audio. No chat message was sent.` : pairedAsrReady ? 'Your selected agent processed the audio. No chat message was sent.' : 'No chat message was sent.');
    if (pairedReady && stage === 'review' && !destination) messages.review = playing ? 'Playing selected-agent audio. Tap Stop audio to stop. Your recording remains in this app.' : 'Save keeps this recording and transcript in this app. Listen to transcript sends only this text to your selected agent for audio playback.';
    if (cloudMode && stage === 'review') messages.review += playing ? ' Playing Cloud audio. Tap Stop audio to stop.' : ` Listen to transcript sends this text to ${voiceServiceName()} for audio playback.`;
    if (selectedRoute === 'device' && !onDeviceReady && !preparingLocal && stage === 'ready') labels.ready = 'On-device speech unavailable';
    if (preparingPaired && stage === 'ready') { labels.ready = 'Checking selected agent voice'; messages.ready = 'Checking transcription and playback on your selected agent. No audio is uploaded.'; }
    if (preparingLocal && stage === 'ready') { labels.ready = 'Preparing on-device speech'; messages.ready = 'Loading and checking speech models on this phone. Nothing is uploaded.'; }
    if(!Capacitor.isNativePlatform() && !cloudMode) {
      // The browser has no speech engine of its own: on-device speech here means the local
      // agent on this computer (libelizainference), worded in the block below.
      if (!onDeviceReady) {
        labels.recorded='Review transcript';
        messages.recording='Recording. Stop to review the audio.';
        messages.ready='Record audio in this app. You can add a transcript manually and save without signing in.';
        messages.recorded='Microphone is off. Enter the transcript to save with this recording.';
        messages.transcribing='Review the recording transcript.';
        if(!destination)messages.review='Edit the transcript, listen, or save the recording in this app.';
      }
    }
    if(browserDevProfile && selectedRoute==='agent' && !cloudMode&&!onDeviceReady){messages.ready='Browser transcription is unavailable. Record audio and enter a transcript, or explicitly select a development agent.';messages.recorded='Microphone is off. Enter a transcript for this recording.';labels.recorded='Review transcript';}
    if(onDeviceReady&&connectionController.getBrowserSpeechAgent()){
      labels.recorded='Transcribe on this computer';
      messages.ready='Record in this app. English transcription runs on the local agent on this computer when you choose Transcribe.';
      messages.recorded='Microphone is off. Transcribe on this computer sends this recording to your local development agent.';
      messages.transcribing='Transcribing on this computer. Nothing has been saved.';
      messages.review='Review the transcript, listen using the local agent on this computer, or save it with the recording. No chat message has been sent.';
    }
    if(chatDestination?.mode==='dictation'){labels.review='Use in draft';messages.recording='Recording on this device. Stop to transcribe into editable text. Nothing is sent to your agent.';messages.review='Edit the transcript, then add it to your draft. Only Send submits the message.';}
    if(liveDictation){messages.ready='Starting transcription on this device. No message is sent.';messages.recording='Your agent on this phone transcribes as you speak. Stop when you finish; speech after Stop is not used. No message is sent.';messages.transcribing='Finishing the transcript on this phone. No message is sent.';messages.review='Edit the transcript, then add it to your draft. Only Send submits the message.';}
    // The Cloud route offers no typing choice (P-39 keeps the conversation spoken; the keyboard stays a separate entry), so its failure wording names none.
    const canType = !cloudMode && stage === 'recorded' && !!clip && !busy && (failure === 'no-speech' || failure === 'local-agent' || failure === 'recognition');
    // A refused microphone uses the route slot for its recovery: Android's app settings for Alpha.
    const settingsChoice = deniedSettingsChoice({ failure, stage, busy, native: Capacitor.isNativePlatform() });
    const openSettings = () => { void appSettings.openSettings({ page: 'privacy' }).catch(() => api?.toast('Android app settings are unavailable. Allow the microphone for Alpha in Settings, then try again.')); };
    return {
      state: failure || stage,
      typeChoice: canType,
      typeInstead: () => { if (!owned()||stage !== 'recorded' || !clip || busy) return; draft = ''; recognized = undefined; error = ''; failure = ''; stage = 'review'; refresh(); },
      manualChoice: testMocksEnabled && !cloudMode && stage === 'ready' && !busy && !preparingLocal && selectedRoute !== 'manual',
      recordOnly: () => { if(!owned())return;const target = destination, chat = chatDestination; enter(target, undefined, 'manual',chat); refresh(); },
      routeChoice: settingsChoice || testMocksEnabled && (!cloudMode && stage === 'ready' && !busy && document.documentElement.dataset.connectionMode !== 'mock' && (!!connectionController.getPairedVoiceBinding() || connectionController.getCloudEnvironment() !== null)),
      routeLabel: settingsChoice ? DENIED_SETTINGS_LABEL : browserDevProfile ? (selectedRoute === 'device' ? 'Use development voice' : 'Use browser voice') : selectedRoute === 'device' ? (connectionController.getCloudEnvironment() !== null ? `Use ${voiceServiceName()} voice` : 'Use selected agent voice') : 'Use on-device voice',
      changeRoute: () => { if (!owned()||stage !== 'ready' || busy) return; if (settingsChoice) { openSettings(); return; } const target = destination, chat = chatDestination; enter(target, undefined, selectedRoute === 'device' ? 'agent' : 'device',chat); refresh(); },
      clock: `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`, clockCss: '', live: stage === 'recording', paused: stage !== 'recording', dotCss: `background:${stage === 'recording' ? '#E53935' : 'var(--mut)'}`,
      levels: !Capacitor.isNativePlatform()&&stage==='recording'?recordingLevels(recordingId):Array.from({ length: 44 }, () => ({ h: 4 })),
      lines: [{ ini: '', statusIcon:icons.info, t: error || messages[stage], chip: 'background:var(--s2);color:var(--fg)', css: '' }],
      review: stage === 'review', transcript: draft, transcriptDisabled: busy, onTranscript: (e: Event) => { if (!owned()||busy) return; draft = (e.target as HTMLTextAreaElement).value; refresh(); },
      primaryLabel: cloudConnectRequired ? `Connect ${voiceServiceName()}` : labels[stage], primaryIcon: cloudConnectRequired ? icons.user : stage === 'review' ? icons.check : stage === 'recording' || stage === 'transcribing' ? icons.stop : icons.mic,
      primaryDisabled: (selectedRoute === 'device' && !onDeviceReady) || preparingLocal || preparingPaired || stage === 'starting' || (busy && stage !== 'transcribing') || (stage === 'review' && !draft.trim()),
      pauseLabel: (onDeviceReady || cloudMode || pairedReady) && stage === 'review' ? playing ? 'Stop audio' : 'Listen to transcript' : ['recorded', 'review'].includes(stage) ? 'Record again' : 'Cancel recording', pauseIcon: (onDeviceReady || cloudMode || pairedReady) && stage === 'review' ? playing ? icons.stop : icons.play : ['recorded', 'review'].includes(stage) ? icons.mic : icons.x,
      stop: () => { if(owned())void primary(); }, discard: () => {if(owned())chatDestination?cancelChat():cleanup();}, keyboard:()=>{if(owned())cancelChat(true);}, toggle: () => { if(!owned())return;if ((onDeviceReady || cloudMode || pairedReady) && stage === 'review') { void listen(); } else if (['recorded', 'review'].includes(stage)) { const target = destination, chat = chatDestination; enter(target, undefined, selectedRoute,chat); } else if(chatDestination)cancelChat();else cleanup(); },
    };
  }
  const originalVals=Component.prototype.renderVals;
  Component.prototype.renderVals=function(){
    const out=originalVals.call(this),retiring=retirement?.shell===this,active=retiring||chatDestination?.shell===this&&stage!=='closed'&&chatCurrent();
    out.startTranscription=()=>this.startTranscription();
    const heldRetirement=retirement,hold=(cancelApproval=true)=>{if(!heldRetirement||retirement!==heldRetirement||heldRetirement.shell!==this)return;if(cancelApproval&&heldRetirement.approval&&this.pendingActionApproval===heldRetirement.approval){heldRetirement.approval.abort();if(heldRetirement.proposalId)this.cancelReadReplyCompletions?.(heldRetirement.proposalId);}this.toast('Voice media is still stopping. Close the app if it cannot finish.');};
    const awaiting=active&&!retiring&&chatDestination?.mode!=='dictation'&&(conversationState.phase==='awaiting-user-input'||conversationReviewRequired);
    out.chatRecorder=retiring?{regionLabel:'Voice conversation',closeLabel:'Close voice conversation',state:retirement!.phase,flex:'1',clockSize:48,clock:'Voice',live:false,levels:[],lines:[{t:retirement!.phase==='error'?'Could not confirm voice media stopped. Close the app before starting voice again.':'Stopping the microphone and audio…'}],review:false,typeChoice:false,primaryLabel:'Stop voice conversation',primaryIcon:out.ic?.stop,primaryDisabled:false,stop:()=>hold(),discard:()=>hold(),keyboard:()=>{if(retirement&&retirement.shell===this){retirement.returnChat='input';hold(false);}}}:active?(chatDestination?.mode==='dictation'?{...recorderView(out.ic||{}),regionLabel:'Voice transcription',closeLabel:'Discard transcription',flex:'1',clockSize:48}:{...conversationRecorderView(out.ic||{}),awaiting}):null;out.showChatHistory=true;out.chatHistoryInert=false;out.chatVoiceActive=active;out.chatHistoryStyle='';
    const recorder=out.chatRecorder;
    if(recorder){
      const conversation=retiring||chatDestination?.mode!=='dictation';
      recorder.closeControlLabel=conversation?'Stop voice conversation':recorder.closeLabel;
      recorder.closeControlIcon=conversation?out.ic?.stop:out.ic?.x;
      recorder.closeControl=conversation?(retiring?()=>hold():()=>cancelChat(false,true)):recorder.discard;
      if(conversation){
        // Stopping media and recovering a service connection are separate actions.
        // A missing capture must never look like an enabled microphone control.
        const controllable=!!recorder.canMute&&!retiring&&!recorder.review&&!awaiting&&['listening','transcribing','thinking','preparing-speech','speaking'].includes(recorder.state);
        recorder.muteDisabled=!controllable||!!recorder.muteAutomatically;
        if(!controllable){const capturing=!retiring&&recorder.state==='listening',unconfirmed=retiring||!!conversationVoice&&['error','starting','connecting','idle'].includes(recorder.state);recorder.canMute=true;recorder.muted=unconfirmed?'mixed':capturing?'false':'true';recorder.muteLabel=unconfirmed?'Microphone status unconfirmed':capturing?'Microphone control unavailable':'Microphone off';recorder.toggleMute=()=>{};}
      }
    }
    out.legacyChatRecorder=!!recorder&&(chatDestination?.mode==='dictation'||recorder.review);
    out.inlineChatRecorder=!!recorder&&!out.legacyChatRecorder;
    out.voiceInterim=recorder?.interimTranscript&&!out.msgs?.some((message:Bag)=>message.isUser&&message.text===recorder.interimTranscript&&(!(ownBrowserVoiceActive()||developmentCloudRealtimeVoiceEnabled||(developmentCartesiaVoiceEnabled&&!developmentCloudVoiceEnabled))||!conversationInterimKnownMessages.has(String(message.id))))?recorder.interimTranscript:'';
    if(recorder){recorder.connecting=['starting','connecting'].includes(recorder.state);// A voice planning label shares the transcript's shimmer line above the composer, as typed chat does.
      if(recorder.progressText)out.turnStatus=recorder.progressText;
      recorder.statusClass=recorder.connecting?'alpha-voice-connecting':'alpha-voice-status-hidden';const phase=recorder.muted==='true'&&!recorder.muteAutomatically?'paused':recorder.state==='starting'?'connecting':recorder.state==='preparing-speech'?'thinking':recorder.state==='awaiting-user-input'?'paused':recorder.state==='stopping'?'interrupting':recorder.state;recorder.problem=recorder.state==='error';recorder.activity=recorder.problem?null:React.createElement(VoiceActivity,{phase,theme:this.S().theme==='dark'?'dark':'light'});
      const directSpeech=chatDestination?.mode!=='dictation'&&(connectionController.getSnapshot().residentInference==='direct'||cloudMode&&developmentCartesiaVoiceEnabled&&!developmentCloudVoiceEnabled);
      recorder.cloudDisclosure=cloudRuntimeEnabled||directSpeech||developmentCloudRealtimeVoiceEnabled;
      recorder.cloudDisclosureText=directSpeech?'Voice sends recordings and reply text to Cartesia. Your agent runs on this device and uses your direct Cerebras provider.':developmentCloudRealtimeVoiceEnabled?`Voice sends recordings and reply text to ${voiceServiceName()} through the connected developer agent. Your agent runs on this computer.`:`Voice uploads recordings and reply text to your ${voiceServiceName()} account, uses your plan allowance, and plays replies with Cartesia.`;
      // Speech routing is disclosed in Settings > Voice; the live voice composer only opens details for an error.
      recorder.voiceDetails=!!recorder.errorDetail;
      recorder.muteAsset=recorder.muted==='true'?'/icons/lucide/mic-off.svg':'/icons/lucide/mic.svg';}
    const pillVoice=active&&this.S().chat==='hidden'&&(retiring?retirement?.panelChat==='hidden':chatDestination?.chat==='hidden')&&!out.legacyChatRecorder;
    out.pillVoiceInactive=!pillVoice;out.pillVoice=pillVoice?{...recorder,activity:recorder.problem?null:React.createElement(VoiceActivity,{phase:recorder.connecting?'connecting':recorder.muted==='true'&&!recorder.muteAutomatically?'paused':recorder.state,theme:this.S().theme==='dark'?'dark':'light',compact:true}),controlDown:(event:PointerEvent)=>event.stopPropagation(),stop:()=>retiring?hold():cancelChat()}:null;
    if(retiring&&!pillVoice){out.conversationHidden=false;out.panelOp=1;out.panelPE='auto';if(!out.panelH)out.panelH=560;}
    if(active){
      out.panelComposer=false;out.showSugg=false;out.showComposer=false;out.showPill=!!pillVoice;out.canStopReply=false;
      out.closeChat=()=>retiring?hold():cancelChat();
    }
    return out;
  };
  const updated=Component.prototype.componentDidUpdate;
  Component.prototype.componentDidUpdate=function(...args:any[]){
    updated?.apply(this,args);
    if(chatDestination?.shell===this){if(!chatCurrent())cleanup();else conversationVoice?.recheck();}
    // The first agent text of the turn being sent, as it streams into the conversation.
    const watch=conversationReplyWatch;
    if(watch&&chatDestination?.shell===this&&(this.S().msgs||[]).some((m:Bag)=>m.from==='agent'&&!watch.has(String(m.id))&&String(m.text||'').trim())){conversationReplyWatch=undefined;markVoiceTiming('first-token');}
  };
  const immersive = notes.immersive;
  notes.immersive = (state: Bag, current: Bag) => stage !== 'closed'&&!chatDestination ? { noPill: true } : immersive?.(state, current);
  notes.back = (state: Bag, current: Bag) => { if (stage !== 'closed'&&!chatDestination) { cleanup(); return true; } return back?.(state, current); };
  const noteReadingChanged=()=>{if(api)api.setView('notes',{noteReadingRevision:Date.now()});};
  window.addEventListener('alpha:note-reading',noteReadingChanged);
  notes.onLeave = (current: Bag) => { closeTranscriptQuestion?.();stopSpeaking();if(!ownedNavigation?.applying)cleanup(); leave?.(current); };
  const visibility = () => {
    // Speech preparation is foreground-only; returning prepares the same route again.
    if (!document.hidden) { if (reprepare && stage === 'ready' && !busy) { reprepare = false; reopen(error); } return; }
    stopSaved();
    if (playing) { playback?.abort(); playing = false; refresh(); }
    if(chatDestination){cleanup();return;}
    if (['recording', 'transcribing'].includes(stage)) { cleanup(false); stage = 'ready'; error = 'Voice stopped when the app left the foreground. Record again to continue.'; reprepare = true; refresh(); }
  };
  const pagehide = () => { if (stage !== 'closed') cleanup(); };
  const binding = composerBinding;
  let account = binding();
  const unsubscribe = connectionController.subscribe(() => {
    const next = binding();
    if (connectionController.getSnapshot().open) { closeTranscriptQuestion?.(); if (stage !== 'closed') cleanup(); }
    if (next !== account) { closeTranscriptQuestion?.(); account = next; stopSaved(); if (stage !== 'closed') cleanup(); }
  });
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', pagehide);
  const unmount = Component.prototype.componentWillUnmount;
  Component.prototype.componentWillUnmount = function () { window.removeEventListener('alpha:note-reading',noteReadingChanged);stopSpeaking();api = undefined; chatDestination=undefined;cleanup(); unsubscribe(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', pagehide); unmount?.call(this); };
}

function ownBrowserVoiceActive(){const state=connectionController.getSnapshot();return !Capacitor.isNativePlatform()&&state.residentInference==='direct'&&state.providerStatus?.voiceConfigured===true;}
