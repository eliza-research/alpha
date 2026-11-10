import {createCloudStreamingSpeech as createSharedCloudStreamingSpeech, type CloudStreamPort} from '../../../../.eliza/client-features/packages/voice/src/native-cloud-speech.ts';
import {browserCloudResidentEnabled} from './browser-cloud-resident';
import {developmentCartesiaVoiceEnabled} from './development-cartesia-flag';
import {developmentCloudVoiceEnabled} from './development-cloud-voice';
import {markTtsPlaybackStarted,markTtsPlaybackEnded} from '../../../../.eliza/client-features/packages/ui/src/voice/tts-playback-activity.ts';
import { playOwnedSpeech, confirmSpeechRetirement } from '../local-speech-playback';
import { registerPlugin } from '../platform-plugins';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { connectionController } from './connection-ui';
import { cloudVoiceLimitOf } from './cloud-voice-limit';
import { readServiceLimit, retryDuration, type ServiceLimit } from './subscription-entitlement';
import { cloudServiceName } from './cloud-protocol';

/**
 * A Cloud speech 429 as the shared ServiceLimit (`@elizaos/cloud-sdk` readServiceLimit), from the
 * retry facts only: its limit code, wait and reset. Cloud speech is requested only while the
 * run-time route is Cloud (voice-selection.ts: a signed-in account with no limit in force) and by
 * development browser-resident builds; a stored limit moves the next turns to on-device speech.
 */
export function cloudVoiceServiceLimit(error: unknown, now: number = Date.now()): ServiceLimit | null {
  const facts = cloudVoiceLimitOf(error);
  if (!facts) return null;
  return readServiceLimit({ status: 429, ...(facts.limitCode ? { code: facts.limitCode } : {}), ...(facts.retryAfterSeconds !== undefined ? { retryAfterSeconds: facts.retryAfterSeconds } : {}), ...(facts.resetAt !== undefined ? { resetAt: facts.resetAt } : {}) }, now);
}
function voiceLimitMessage(limit: ServiceLimit, now: number, recording: boolean): string {
  const name = serviceNameNow(), kept = recording ? ' Your recording is kept.' : '';
  const resets = limit.resetsAt != null && limit.resetsAt > now ? new Date(limit.resetsAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null;
  if (limit.kind === 'allowance-exhausted') return `Your ${name} plan's voice allowance is used up.${resets ? ` It resets ${resets}.` : limit.retryAfterMs != null ? ` It resets in ${retryDuration(limit.retryAfterMs)}.` : ''}${kept}`;
  if (limit.kind === 'subscription-required') return `${name} voice needs an active ${name} plan. Manage your plan in Settings.${kept}`;
  if (limit.kind === 'billing-refused') return billingRefused(name, kept);
  const wait = limit.retryAfterMs != null ? `Try again in ${retryDuration(limit.retryAfterMs)}.` : resets ? `Try again after ${resets}.` : 'Wait a moment, then try again.';
  return `${name} voice reached your plan's request limit. ${wait}${kept}`;
}
function serviceNameNow(): string {
  try { const environment = connectionController.getCloudEnvironment(); return environment ? cloudServiceName(environment) : 'Cloud'; } catch { return 'Cloud'; }
}
function billingRefused(name: string, kept: string): string { return `${name} declined voice for billing. Check your account in Settings.${kept}`; }

/** Native status codes retain recovery meaning without exposing a provider response body.
 * `recording`: the caller keeps the recorded clip for an explicit retry (Notes, Transcribe).
 * `conversation`: a chat voice turn, whose spoken message is gone when it was not sent. */
export function cloudVoiceFailure(error: unknown, context: { recording?: boolean; conversation?: boolean } = {}): string | null {
  const direct=connectionController.getSnapshot().residentInference==='direct';
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if(direct&&typeof code==='string'&&/^voice-http-[45][0-9]{2}$/.test(code))return code.startsWith('voice-http-4')?'Cartesia refused voice. Check your key and Cartesia plan.':'Cartesia isn’t responding. Try again later.';
  if(developmentCloudVoiceEnabled&&!browserCloudResidentEnabled&&(code==='voice-http-401'||code==='voice-http-403'))return 'The developer agent’s Cloud speech authorization was refused. Check its server-side Cloud configuration, then retry.';
  const name = serviceNameNow(), kept = context.recording === true ? ' Your recording is kept.' : '', after = kept || (context.conversation === true ? ' Your message was not sent. Say it again.' : '');
  if (code === 'voice-http-401') return `${name} sign-in expired. Sign in again in Settings, then retry voice.`;
  if (code === 'voice-http-403') return `${name} refused voice for this account. Check your account in Settings.`;
  if (code === 'voice-http-402') return billingRefused(name, kept);
  if (code === 'voice-http-429') { const now = Date.now(), limit = cloudVoiceServiceLimit(error, now); if (limit) return voiceLimitMessage(limit, now, context.recording === true); }
  if (typeof code === 'string' && /^voice-http-[45][0-9]{2}$/.test(code)) return `${name} voice couldn’t complete this request. Try again later.`;
  if (code === 'voice-stt-decode') return 'This recording could not be prepared for transcription. Choose Record again.';
  if (code === 'voice-stt-connect') return `${name} voice could not use your saved account. Sign in again in Settings.${after}`;
  if (code === 'voice-tts-connect') return `${name} voice could not use your saved account. Sign in again in Settings.`;
  if (code === 'voice-stt-upload') return `The recording upload could not be confirmed. Check your connection.${after}`;
  if (code === 'voice-stt-response') return `${name} voice returned no usable transcript.${after || ' Try again later.'}`;
  return null;
}

/** Product registration only; shared transport owns speech lifecycle and cancellation. */
const streamingNative = registerPlugin<CloudStreamPort & {cloudStreamTiming(): Promise<unknown>}>('AlphaCloudSpeechStream');
export function nativeCloudStreamingAvailable() { return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('AlphaCloudSpeechStream'); }

/** Read the content-free Cloud startup stages already held by the native bridge. */
export async function readNativeCloudStreamTiming(timeoutMs = 2_000): Promise<unknown> {
  if (!nativeCloudStreamingAvailable()) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      streamingNative.cloudStreamTiming(),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
  } catch {
    // Older bridge builds may register the plugin without this method.
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
export function createCloudStreamingSpeech(input: Parameters<typeof createSharedCloudStreamingSpeech>[0]) { return createSharedCloudStreamingSpeech(input, streamingNative); }

export type VoiceClip = { recordingId: string; durationMs: number };
export type VoiceRecordingStopped = { recordingId: string; durationMs?: number; interrupted?: 'call-active' };
export type SpeechRecordingInput = {recordingId:string;requestId:string;savedNoteId?:string;savedDurationMs?:number;offsetMs?:number};
const native = registerPlugin<{
  transcribeOwnRecording(input:SpeechRecordingInput & {providerRevision:string}):Promise<{text:string;local:false}>;
  synthesizeOwn(input:{text:string;requestId:string;providerRevision:string;replace?:boolean}):Promise<{playbackId:string}>;
  transcribeDevelopmentCloudRecording(input:SpeechRecordingInput & {route?:'cloud'|'direct'}):Promise<{text:string;local:false}>;
  synthesizeDevelopmentCloud(input:{text:string;requestId:string;replace?:boolean;route?:'cloud'|'direct'}):Promise<{playbackId:string}>;
  startRecording(): Promise<{ recordingId: string; maxDurationMs: number }>;
  stopRecording(): Promise<VoiceClip>;
  getRecordingMetrics(input:{recordingId:string}):Promise<{recordingId:string;peak:number;rms?:number}>;
  cancelRecording(): Promise<void>;
  transcribeRecording(input: SpeechRecordingInput & {environment:string;credentialId:string}): Promise<{ text: string; local: false }>;
  synthesize(input: { text: string; requestId: string; environment: string; credentialId: string; replace?:boolean }): Promise<{ playbackId: string }>;
  play(input: { playbackId: string;replace?:boolean }): Promise<void>;
  stopPlayback(input?: { requestId: string }): Promise<void>;
  cancel(input: { requestId: string }): Promise<void>;
  addListener(event: 'recordingStopped', callback: (clip: VoiceRecordingStopped) => void): Promise<PluginListenerHandle>;
  addListener(event: 'playbackEnded' | 'playbackFailed' | 'playbackStopped', callback: (event: { playbackId?: string }) => void): Promise<PluginListenerHandle>;
}>('AlphaVoiceCloud');

/** Binds all audio to the explicitly selected account. Native code owns the
 * private recording, bearer credential, upload and decoded playback file. */
export function createCloudVoice(readAloudRoute:'cloud'|'direct'='cloud') {
  const selected=connectionController.getSnapshot(),own=selected.residentInference==='direct',nativeOwn=own&&Capacitor.isNativePlatform();
  const ownSession=selected.session,revision=selected.providerStatus?.revision;
  if(own&&(!selected.providerStatus?.voiceConfigured||!ownSession||nativeOwn&&!revision))throw Error('Voice is off. Add a Cartesia key in AI provider settings.');
  const directReadAloud=(readAloudRoute==='direct'||own)&&(developmentCartesiaVoiceEnabled||own);
  if(readAloudRoute==='direct'&&!directReadAloud)throw Error('Developer direct speech is disabled.');
  const developerSpeech=!nativeOwn&&(developmentCloudVoiceEnabled||directReadAloud);
  const environment = connectionController.getCloudEnvironment();
  const binding = connectionController.getCloudClient();
  const sessionId = binding?.sessionId, credentialId = binding?.credentialId;
  const agent=developerSpeech?connectionController.getBrowserSpeechAgent():null,agentSession=agent?.session;
  if(developerSpeech&&!agentSession)throw Error('Connect the developer agent first.');
  if (!own&&!developerSpeech&&(!environment || !sessionId || !credentialId)) throw new Error('Sign in to Cloud to use Cloud voice.');
  const check = () => {
    if(own){const now=connectionController.getSnapshot();if(now.residentInference!=='direct'||now.session!==ownSession||now.providerStatus?.revision!==revision||!now.providerStatus?.voiceConfigured)throw new DOMException('Own provider changed','AbortError');}
    if(nativeOwn)return;
    if(developerSpeech){if(agent!==connectionController.getBrowserSpeechAgent()||agent?.session!==agentSession)throw new DOMException('Voice agent changed','AbortError');return;}
    if (environment !== connectionController.getCloudEnvironment() || sessionId !== connectionController.getCloudClient()?.sessionId || credentialId !== connectionController.getCloudClient()?.credentialId) throw new DOMException('Voice account changed', 'AbortError');
  };
  // A Cloud speech 429 for this account becomes the account panel's latest limit (lastLimit, the
  // shared useCloudSubscriptionSummary). Developer speech is not the signed-in account's plan.
  const noteLimit = (error: unknown) => { if (!own&&!developerSpeech) { try { connectionController.noteCloudServiceLimit(cloudVoiceServiceLimit(error), sessionId); } catch { /* Advisory only. */ } } throw error; };
  return {
    cloud: true as const,
    async startRecording() { check(); const result = await native.startRecording(); check(); return result; },
    async getRecordingMetrics(recordingId:string){check();const value=await native.getRecordingMetrics({recordingId});check();if(value.recordingId!==recordingId||!Number.isFinite(value.peak)||value.peak<0||value.peak>1||(value.rms!==undefined&&(!Number.isFinite(value.rms)||value.rms<0||value.rms>1)))throw Error('Recording metrics were not verified.');return value;},
    async stopRecording() { check(); const result = await native.stopRecording(); check(); return result; },
    async transcribeRecording(input: SpeechRecordingInput) {
      check(); const result = await (nativeOwn?native.transcribeOwnRecording({...input,providerRevision:revision!}):developerSpeech?native.transcribeDevelopmentCloudRecording({...input,...(own?{route:'direct' as const}:{})}):native.transcribeRecording({ ...input, environment:environment!, credentialId:credentialId! })).catch(noteLimit); check();
      if (typeof result.text !== 'string' || result.local !== false) throw new Error(`${own?'Cartesia':'Cloud'} returned no usable transcript.`);
      // An empty transcript is silence, not a microphone, account or connection failure.
      if (!result.text.trim() && input.savedNoteId === undefined) throw Object.assign(new Error(`${own?'Cartesia':'Cloud'} heard no speech in this recording.`), { code: 'no-speech' });
      return result;
    },
    cancel: (input: { requestId: string }) => native.cancel(input),
    async cancelRecording() { await native.cancelRecording(); },
    addListener: (event: 'recordingStopped', callback: (clip: VoiceRecordingStopped) => void) => native.addListener(event, value => {
      try { check(); callback(value); } catch { /* Stale account events never update the new account. */ }
    }),
    async speak(text: string, signal: AbortSignal,onStarted?:()=>void,queue=false,assertCurrent?:()=>void) {
      check();signal.throwIfAborted();const owned=new AbortController(),cancel=()=>owned.abort(signal.reason),current=()=>{check();assertCurrent?.();if(document.hidden||connectionController.getSnapshot().open)throw new DOMException('Voice review changed','AbortError');};
      const changed=()=>{try{current();}catch(error){owned.abort(error);}};
      const unsubscribe=connectionController.subscribe(changed);document.addEventListener('visibilitychange',changed);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
      let marked=false;
      try{await playOwnedSpeech(native,owned.signal,requestId=>nativeOwn?native.synthesizeOwn({text,requestId,providerRevision:revision!,...(queue?{replace:false}:{})}):developerSpeech?native.synthesizeDevelopmentCloud({text,requestId,...(directReadAloud?{route:'direct' as const}:{}),...(queue?{replace:false}:{})}):native.synthesize({text,requestId,environment:environment!,credentialId:credentialId!,...(queue?{replace:false}:{})}).catch(noteLimit),current,()=>{current();if(onStarted)onStarted();else{marked=true;markTtsPlaybackStarted();}},true,queue);}
      finally{if(marked)markTtsPlaybackEnded();unsubscribe();document.removeEventListener('visibilitychange',changed);signal.removeEventListener('abort',cancel);}
    },
  };
}

// Maps steps and workflow speech share the same speaker. A replacement waits for
// the preceding owned cleanup; an unconfirmed cleanup must be confirmed by a native stop.
let appSpeechRetirement:Promise<void>=Promise.resolve();
export async function speakCloudText(text:string,signal:AbortSignal,onStarted?:()=>void,queue=false,assertCurrent?:()=>void){
  if(developmentCloudVoiceEnabled){const previous=appSpeechRetirement;const pending=(async()=>{await confirmSpeechRetirement(previous);signal.throwIfAborted();assertCurrent?.();await createCloudVoice().speak(text,signal,onStarted,queue,assertCurrent);})();appSpeechRetirement=pending.catch(error=>{if(error?.code==='speech-cleanup-unconfirmed')throw error;});void appSpeechRetirement.catch(()=>{});await pending;return;}

  const ownSnapshot=connectionController.getSnapshot(),own=ownSnapshot.residentInference==='direct';
  const environment=connectionController.getCloudEnvironment(),binding=connectionController.getCloudClient(),sessionId=binding?.sessionId,credentialId=binding?.credentialId;
  const owned=new AbortController(),cancel=()=>owned.abort(signal.reason),retire=()=>owned.abort(new DOMException('Voice review changed','AbortError'));
  if(signal.aborted)cancel();
  const current=()=>{owned.signal.throwIfAborted();assertCurrent?.();if(environment!==connectionController.getCloudEnvironment()||sessionId!==connectionController.getCloudClient()?.sessionId||credentialId!==connectionController.getCloudClient()?.credentialId||document.hidden||document.documentElement.dataset.devBackground==='true'||connectionController.getSnapshot().open||Array.from(document.querySelectorAll('[aria-label="Unlock with fingerprint"], [aria-label="Wake"]')).some(element=>element.getClientRects().length))throw new DOMException('Voice review changed','AbortError');};
  current();
  if(!own&&(!environment||!sessionId||!credentialId)){connectionController.openCloudAccount();throw Error('Sign in to Cloud to use Cloud voice.');}
  const voice=createCloudVoice(),previous=appSpeechRetirement;
  let admitted=false;
  const interrupted=new Promise<never>((_,reject)=>{owned.signal.addEventListener('abort',()=>{if(!admitted)reject(owned.signal.reason);},{once:true});});void interrupted.catch(()=>{});
  const changed=()=>{try{current();}catch(error){owned.abort(error);}},unsubscribe=connectionController.subscribe(changed);
  document.addEventListener('visibilitychange',changed);signal.addEventListener('abort',cancel,{once:true});window.addEventListener('alpha:device-state',retire);window.addEventListener('pagehide',retire);if(signal.aborted)cancel();changed();
  const pending=(async()=>{await confirmSpeechRetirement(previous);current();admitted=true;let marked=false;try{await voice.speak(text,owned.signal,()=>{current();marked=true;markTtsPlaybackStarted();onStarted?.();},queue,current);current();}catch(error){const recovery=cloudVoiceFailure(error);if(recovery)throw Object.assign(new Error(recovery,{cause:error}),{code:(error as {code?:string}).code});throw error;}finally{if(marked)markTtsPlaybackEnded();}})();
  appSpeechRetirement=pending.catch(error=>{if(error?.code==='speech-cleanup-unconfirmed')throw error;});void appSpeechRetirement.catch(()=>{});
  try{await Promise.race([pending,interrupted]);}finally{unsubscribe();document.removeEventListener('visibilitychange',changed);signal.removeEventListener('abort',cancel);window.removeEventListener('alpha:device-state',retire);window.removeEventListener('pagehide',retire);}
}
