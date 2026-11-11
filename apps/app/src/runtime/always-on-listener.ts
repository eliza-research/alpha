import { Capacitor } from '@capacitor/core';
import {Sense,createSenseInvocationController,parseAssistantInvocation,parseInvocationUnlocked,parseListenerStatus,stopSenseListenerForChatOnly,type AssistantInvocation,type ListenerStatus} from '@elizaos/capacitor-system/sense';

export type { AssistantInvocation, ListenerState, ListenerStatus } from '@elizaos/capacitor-system/sense';

const listener = Sense;

const nativeListener = () => Capacitor.getPlatform() === 'android' && Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('ElizaSense');
let admittedImageSense = false;
/** The mounted Android image declares this capability before the renderer can use Sense. */
export function admitImageSense(capabilities: {aospImage?: unknown; sense?: unknown} | null) {
  admittedImageSense = capabilities?.aospImage === true && capabilities.sense === true;
}
export const imageSenseAvailable = () => admittedImageSense && nativeListener();
async function ask(method: 'status' | 'pause' | 'turnOff'): Promise<ListenerStatus> {
  if (!imageSenseAvailable()) return { available: false };
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
  if (imageSenseAvailable() || Capacitor.getPlatform() !== 'android' || !Capacitor.isNativePlatform()) return true;
  const stopped = await stopSenseListenerForChatOnly(nativeListener() ? listener : undefined);
  wakeStopUnconfirmed = !stopped;
  return stopped;
}

/** Opens the listener's consent and settings screen. */
export async function openListenerSettings(): Promise<boolean> {
  if (!imageSenseAvailable()) return false;
  try { return (await listener.openSettings()).opened === true; } catch { return false; }
}

/** An explicit owner-bound read. Unbound legacy callers cannot authorize a voice turn. */
export async function assistantInvocation(sessionKey?: string, bindingId?: string, generation?: number): Promise<AssistantInvocation> {
  if(!imageSenseAvailable() || !Number.isInteger(generation) || !generation || !bindingId || !sessionKey || !/^[a-f0-9]{64}$/.test(sessionKey))return null;
  try {
    const receipt=await Sense.takeInvocation({generation,bindingId,sessionKey});
    return parseInvocationUnlocked(receipt)?parseAssistantInvocation(receipt):null;
  }catch{return null;}
}

/** Any open modal surface: native dialogs and ARIA modal dialogs. */
export const MODAL = 'dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"]';
/** AlphaAssistActivity fires this when a new invocation reaches the surface already in front. */
export const INVOCATION_EVENT = 'alpha:assist-invocation';
/**
 * A native wake or protected Power receipt can start the voice assistant once the shell is ready.
 * The native origin is consumed when
 * it is read, so it is read only when the shell can act on it, and one invocation starts at most
 * one conversation. Runs on the first render and whenever the surface returns to the foreground
 * (a new invocation of the single-task activity).
 */
export function installListenerInvocation(shell: () => { startVoice?: () => unknown; live?: boolean } | undefined, state: { authority: () => string | null; initialRestorePending?: () => boolean; powerAccountRef?: () => string | null; connectionOpen: () => boolean; connected: () => boolean; voiceActive: () => boolean; subscribe: (listener: () => void) => () => void }) {
  if(!imageSenseAvailable())return ()=>{};
  const ready=()=>imageSenseAvailable()&&!!shell()?.startVoice&&shell()?.live===true&&!state.connectionOpen()&&state.connected();
  const owner=createSenseInvocationController(Sense,{authority:state.authority,initialRestorePending:state.initialRestorePending,powerAccountRef:state.powerAccountRef,ready,voiceActive:state.voiceActive,
    startVoice:()=>{const current=shell();if(ready())void current?.startVoice?.();},subscribe:state.subscribe,events:[INVOCATION_EVENT]});
  return ()=>owner.dispose();
}
