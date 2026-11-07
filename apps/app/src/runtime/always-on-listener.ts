import { externalVoiceInvocationEnabled } from './voice-entry-policy';
import { Capacitor } from '@capacitor/core';
import {Sense,createSenseInvocationController} from '@elizaos/capacitor-system/sense';
import { parseAssistantInvocation, parseListenerStatus, type AssistantInvocation, type ListenerStatus } from './always-on-listener-status';

export type { AssistantInvocation, ListenerState, ListenerStatus } from './always-on-listener-status';

const listener = Sense;

const nativeListener = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('ElizaSense');
async function ask(method: 'status' | 'pause' | 'turnOff'): Promise<ListenerStatus> {
  if (!nativeListener()) return { available: false };
  try { return parseListenerStatus(await listener[method]()); } catch { return { available: false }; }
}

/** Status of the image's listener; `{available:false}` on the web build and on phones without it. */
export const listenerStatus = () => ask('status');
/** Pauses until the user resumes in the listener's own UI. */
export const pauseListener = () => ask('pause');
/** Turns listening off; consent is kept. Turning it back on happens only in the listener's UI. */
export const turnOffListener = () => ask('turnOff');

let wakeStopUnconfirmed = false;
/** A failed stop stays visible in voice settings; hiding an entry never proves capture stopped. */
export const wakeListeningStopUnconfirmed = () => wakeStopUnconfirmed;
/** Stop a previously enabled image listener through its canonical native port. Never enable capture. */
export async function stopWakeListenerForChatOnly(): Promise<boolean> {
  if (externalVoiceInvocationEnabled || !Capacitor.isNativePlatform()) return true;
  if (!nativeListener()) { wakeStopUnconfirmed = true; return false; }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reply = await Promise.race([
      listener.turnOff(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Wake listener stop timed out')), 5000); }),
    ]);
    const status = parseListenerStatus(reply);
    const stopped = status.available && status.state === 'OFF' && status.listening === false && status.microphoneOpen === false;
    wakeStopUnconfirmed = !stopped;
    return stopped;
  } catch {
    wakeStopUnconfirmed = true;
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Opens the listener's consent and settings screen. */
export async function openListenerSettings(): Promise<boolean> {
  if (!externalVoiceInvocationEnabled || !nativeListener()) return false;
  try { return (await listener.openSettings()).opened === true; } catch { return false; }
}

/** An explicit owner-bound read. Unbound legacy callers cannot authorize a voice turn. */
export async function assistantInvocation(sessionKey?: string, bindingId?: string, generation?: number): Promise<AssistantInvocation> {
  if(!nativeListener() || !Number.isInteger(generation) || !generation || !bindingId || !sessionKey || !/^[a-f0-9]{64}$/.test(sessionKey))return null;
  try {return parseAssistantInvocation(await Sense.takeInvocation({generation,bindingId,sessionKey}));}catch{return null;}
}

/** Any open modal surface: native dialogs and ARIA modal dialogs. */
export const MODAL = 'dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"]';
/** AlphaAssistActivity fires this when a new invocation reaches the surface already in front. */
export const INVOCATION_EVENT = 'alpha:assist-invocation';
/**
 * The listener's wake phrase, or a system assistant gesture such as press-and-hold power that
 * SystemUI launched with its identity shared, opened the assistant surface: start the voice
 * assistant (on-device VAD, streaming ASR and speech, #423) once the shell is ready. The native origin is consumed when
 * it is read, so it is read only when the shell can act on it, and one invocation starts at most
 * one conversation. Runs on the first render and whenever the surface returns to the foreground
 * (a new invocation of the single-task activity).
 */
export function installListenerInvocation(shell: () => { startVoice?: () => unknown; live?: boolean } | undefined, state: { authority: () => string | null; initialRestorePending?: () => boolean; powerAccountRef?: () => string | null; connectionOpen: () => boolean; connected: () => boolean; voiceActive: () => boolean; subscribe: (listener: () => void) => () => void }) {
  if(!externalVoiceInvocationEnabled || !nativeListener())return ()=>{};
  const ready=()=>!!shell()?.startVoice&&shell()?.live!==false&&!state.connectionOpen()&&state.connected();
  const owner=createSenseInvocationController(Sense,{authority:state.authority,initialRestorePending:state.initialRestorePending,powerAccountRef:state.powerAccountRef,ready,voiceActive:state.voiceActive,
    startVoice:()=>{const current=shell();if(ready())void current?.startVoice?.();},subscribe:state.subscribe,events:[INVOCATION_EVENT]});
  return ()=>owner.dispose();
}
