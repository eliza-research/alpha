import {developmentCartesiaVoiceEnabled} from '../runtime/development-cartesia-flag';
import {cloudRuntimeEnabled} from '../build-flags';
import {developmentCloudVoiceEnabled} from '../runtime/development-cloud-voice';
import { Capacitor } from '@capacitor/core';
import { speakLocalText } from '../local-speech-playback';
import { markVoiceTiming, abandonVoiceTurn, finishVoiceTurn } from '../runtime/voice-timing';
import { connectionController } from '../runtime/connection-ui';
import { planLocalSpeech } from '../runtime/local-speech-text';
import { createOnDeviceVoice } from '../runtime/local-voice';
import { createCloudVoice, cloudVoiceFailure } from '../runtime/cloud-voice';
import { selectVoiceRoute } from '../runtime/voice-selection';

let cancelCurrent: (() => Promise<void>|void) | undefined;
let cancelOwner: object | undefined;
let speechRetirement:Promise<void>|undefined;
function retainSpeechRetirement(pending:Promise<void>){
 const previous=speechRetirement;
 const drain=Promise.all([previous,pending.catch(error=>{if(error?.code==='speech-cleanup-unconfirmed')throw error;})]).then(()=>{});
 speechRetirement=drain;void drain.then(()=>{if(speechRetirement===drain)speechRetirement=undefined;},()=>{});return drain;
}
export function stopLocalSpeechPlayback() { stopSpeaking(); const pending=cancelCurrent?.(); cancelCurrent = undefined; cancelOwner = undefined;return pending?retainSpeechRetirement(Promise.resolve(pending)):speechRetirement; }
type Shell = any;
type Reading = { id: string; text: string; pending?:Promise<void>;current?:()=>boolean;controller?: AbortController; message: string };
const speechBinding = () => JSON.stringify([connectionController.getSnapshot().session?.sessionId, connectionController.getCloudClient()?.sessionId, document.documentElement.dataset.connectionMode]);
/**
 * The qualified local speech route (Android CPU engine, or this browser's local voice),
 * with an explicit start callback. Leaving the foreground, opening the connection chooser
 * or changing the selected agent or Cloud account cancels it.
 */
async function speakOnDevice(text: string, signal: AbortSignal, onStarted?: () => void) {
  const selected = speechBinding();
  const owned = new AbortController(), abort = () => owned.abort(signal.reason ?? new DOMException('Speech cancelled', 'AbortError'));
  const check = () => { if (document.hidden || connectionController.getSnapshot().open || speechBinding() !== selected) throw new DOMException('Speech cancelled', 'AbortError'); };
  const visibility = () => { if (document.hidden) owned.abort(new DOMException('Speech cancelled', 'AbortError')); };
  const unsubscribe = connectionController.subscribe(() => { try { check(); } catch (reason) { owned.abort(reason); } });
  signal.addEventListener('abort', abort, { once: true }); document.addEventListener('visibilitychange', visibility);
  try { if (signal.aborted) abort(); check(); await speakLocalText(text, owned.signal, onStarted, false, { execution: Capacitor.isNativePlatform() ? 'device' : 'browser', assertCurrent: check }); check(); }
  finally { unsubscribe(); signal.removeEventListener('abort', abort); document.removeEventListener('visibilitychange', visibility); }
}

/* ---- Note read-aloud ---- */
type NoteReading = { noteId?: string; text: string; controller: AbortController; pending?:Promise<void>; state: 'preparing' | 'reading' };
let noteReading: NoteReading | undefined;
const noteReadingChanged = () => { try { window.dispatchEvent(new Event('alpha:note-reading')); } catch { /* No renderer. */ } };
/** The note being read aloud, if any. Text is the exact passage being read. */
export function currentNoteReading() { return noteReading ? { noteId: noteReading.noteId, text: noteReading.text, state: noteReading.state } : null; }
/** Stop note read-aloud. Safe to call at any time. */
export function stopSpeaking() {
  const active = noteReading; if (!active) return;
  noteReading = undefined;if(active.pending)retainSpeechRetirement(active.pending); active.controller.abort(new DOMException('Speech cancelled', 'AbortError')); noteReadingChanged();
}
/**
 * Read note text aloud on the explicit runtime profile. The Cloud profile uploads text
 * to the selected account; its Notes control discloses that before a user starts it. Leaving the note or editing it cancels the reading
 * (the Notes adapter calls stopSpeaking). Resolves with the outcome; never throws.
 */
export function speakNote(text: string, owner: { noteId?: string } = {}) { return readNote(text, owner); }
async function readNote(text: string, owner: { noteId?: string }): Promise<'finished' | 'stopped' | 'unavailable' | 'unsupported' | 'failed'> {
  const retirement = stopLocalSpeechPlayback();
  const passage = typeof text === 'string' ? text.trim() : '';
  if (!passage || passage.length > (cloudRuntimeEnabled ? 5000 : 16000)) return 'unsupported';
  // The same preflight as message Listen, on every platform: text with credentials, card
  // numbers, links or unsupported characters is refused before any audio or local-agent
  // request. The browser still speaks the original passage; the native engine speaks its plan.
  try { planLocalSpeech(passage); } catch { return 'unsupported'; }
  const voice = (() => { try { return cloudRuntimeEnabled ? createCloudVoice() : createOnDeviceVoice(); } catch { return null; } })(); if (!voice) return 'unavailable';
  const reading: NoteReading = { noteId: owner.noteId, text: passage, controller: new AbortController(), state: 'preparing' };
  noteReading = reading; noteReadingChanged();
  const signal = reading.controller.signal;
  try {
    await retirement;
    if ('playbackReady' in voice && !await voice.playbackReady(signal)) { if (noteReading === reading) { noteReading = undefined; noteReadingChanged(); } return 'unavailable'; }
    if (noteReading !== reading || signal.aborted) return 'stopped';
    const started=() => { if (noteReading === reading) { reading.state = 'reading'; noteReadingChanged(); } };
    const pending=reading.pending=cloudRuntimeEnabled ? voice.speak(passage, signal, started) : speakOnDevice(passage, signal, started);await pending;
    return noteReading === reading && !signal.aborted ? 'finished' : 'stopped';
  } catch { return noteReading !== reading || signal.aborted ? 'stopped' : 'failed'; }
  finally { if (noteReading === reading) { noteReading = undefined; noteReadingChanged(); } }
}

/* ---- Timing for dictated turns ---- */
type VoiceTurn = { draft: string; known: Set<string>; binding: string; userId?: string; firstToken?: boolean };
let voiceTurn: VoiceTurn | undefined;
const conversationBinding = () => JSON.stringify([connectionController.getSnapshot().session?.sessionId, connectionController.getSnapshot().history?.conversationId, connectionController.getCloudClient()?.sessionId]);
/**
 * The reviewed transcript was placed in the composer. If the user sends exactly that text, the
 * turn's send, first token and final reply are timed. Its reply is never spoken: only the voice
 * conversation speaks replies, and there is no setting for this.
 */
export function noteVoiceDraft(text: string, messages: { id?: unknown }[] = []) {
  const draft = String(text || '').trim();
  voiceTurn = draft ? { draft, known: new Set(messages.map(m => String(m.id))), binding: conversationBinding() } : undefined;
}

/** Message actions use the existing speech route; playback always requires a user gesture. */
export function installLocalSpeechPlayback(Component: Shell) {
  const p = Component.prototype, original = p.renderVals, mount = p.componentDidMount, update = p.componentDidUpdate, unmount = p.componentWillUnmount;
  const states = new WeakMap<object, Reading>();
  const menus = new WeakMap<object, { id: string; text: string; trigger?: HTMLElement; notice: string; announcement?:string; copied?:boolean; focus: boolean; binding: string }>();
  const holds = new WeakMap<object, { timer?: ReturnType<typeof setTimeout>; x: number; y: number; opened?:boolean; selecting?:boolean; start?:{node:Node;offset:number} }>();
  const suppressedClicks = new WeakMap<object, string>();
  const listeners = new WeakMap<object, () => void>();
  const transcriptObservers=new WeakMap<object,{element:HTMLElement;observer?:ResizeObserver}>();
  function syncTranscriptFade(shell:Shell){
    const element=document.querySelector<HTMLElement>('[data-alpha-transcript]'),previous=transcriptObservers.get(shell);
    if(previous?.element!==element){previous?.observer?.disconnect();transcriptObservers.delete(shell);}
    if(!element)return;
    const sync=()=>{element.dataset.alphaScrollOverflow=String(element.scrollHeight>element.clientHeight+1);};
    if(!transcriptObservers.has(shell)){
      const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(sync);
      observer?.observe(element);transcriptObservers.set(shell,{element,observer});
    }
    sync();
  }

  const cancelHold = (shell: Shell) => { const hold = holds.get(shell); if (hold) clearTimeout(hold.timer); holds.delete(shell); };
  const caret=(x:number,y:number)=>{
    const point=document.caretPositionFromPoint?.(x,y),range=point?null:document.caretRangeFromPoint?.(x,y);
    const node=point?.offsetNode??range?.startContainer,offset=point?.offset??range?.startOffset;
    return node&&offset!==undefined&&(node instanceof Element?node:node.parentElement)?.closest('[data-alpha-message-text]')?{node,offset}:undefined;
  };
  const closeMenu = (shell: Shell, focus = false) => { const menu = menus.get(shell); if (!menu) return; menus.delete(shell); if (focus) menu.trigger?.focus({preventScroll:true}); refresh(shell); };
  function openMenu(shell: Shell, id: string, text: string, event: Event) {
    event.preventDefault(); event.stopPropagation();
    if(event.type!=='contextmenu'&&menus.get(shell)?.id===id){closeMenu(shell);return;}
    menus.set(shell, { id, text, trigger: event.currentTarget as HTMLElement, notice: '', focus: event.type==='keydown', binding: JSON.stringify(connectionController.getSnapshot().session) }); refresh(shell);
  }
  function menuKey(shell: Shell, event: KeyboardEvent) {
    if (event.key === 'Tab') { closeMenu(shell, true); return; }
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(shell, true); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (at + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + items.length) % items.length;
    items[next]?.focus();
  }
  const refresh = (shell: Shell) => { if (shell.live !== false) shell.setState({ localSpeechRevision: Date.now() }); };
  const stop = (shell: Shell) => { const old = states.get(shell); old?.controller?.abort(); if(old?.pending)retainSpeechRetirement(old.pending);states.delete(shell); if (cancelOwner === shell) { cancelCurrent = undefined; cancelOwner = undefined; } };
  async function listen(shell: Shell, id: string, text: string, spokenText = text) {
    const old = states.get(shell);
    if (old?.id === id && old.controller) { stop(shell); refresh(shell); return; }
    const selection=()=>JSON.stringify([connectionController.getSnapshot().session,connectionController.getSnapshot().history?.conversationId,connectionController.getCloudEnvironment(),connectionController.getCloudClient()?.sessionId,connectionController.getCloudClient()?.credentialId]);
    const binding=selection(),view=shell.S().view,entry=(shell.S().msgs||[]).find((row:Shell)=>row.id===id&&row.text===text),messageBinding=JSON.stringify(entry?.messageBinding);
    const knownUsers=new Set((shell.S().msgs||[]).filter((row:Shell)=>row.from==='user').map((row:Shell)=>row.id));
    const previousSpeech=stopLocalSpeechPlayback();stop(shell);
    const retiring=shell.stopVoiceConversation?.();
    const directReadAloud=developmentCartesiaVoiceEnabled;
    const cloud = selectVoiceRoute() === 'cloud'||directReadAloud;
    const controller = new AbortController(), state: Reading = { id, text, controller, message: 'Waiting for the previous audio to stop…' };
    const current=()=>!(shell.S().msgs||[]).some((row:Shell)=>row.from==='user'&&!knownUsers.has(row.id))&&states.get(shell)===state&&!controller.signal.aborted&&shell.live!==false&&!document.hidden&&!connectionController.getSnapshot().open&&selection()===binding&&shell.S().view===view&&['sheet','full'].includes(shell.S().chat)&&(shell.S().msgs||[]).some((row:Shell)=>row.id===id&&row.text===text&&JSON.stringify(row.messageBinding)===messageBinding);
    state.current=current;states.set(shell,state);cancelOwner=shell;cancelCurrent=()=>{stop(shell);refresh(shell);return state.pending;};refresh(shell);
    try {
      if(retiring){await retiring;if(!current())return;}
      if(previousSpeech){await previousSpeech;if(!current())return;}
      if(!current())return;
      if (cloud && !developmentCloudVoiceEnabled && !directReadAloud && (!connectionController.getCloudEnvironment() || !connectionController.getCloudClient()?.credentialId)) { stop(shell);connectionController.openCloudAccount();return; }
      const voice = cloud ? createCloudVoice(directReadAloud?'direct':'cloud') : createOnDeviceVoice(); if (!voice) {stop(shell);return;}
      state.message=cloud?'Preparing audio…':'Preparing audio on this phone…';refresh(shell);
      if ('playbackReady' in voice) {
        planLocalSpeech(text);
        if (!await voice.playbackReady(controller.signal)) throw new Error('On-device speech models are unavailable. The written message is still available.');
      }
      if (!current()) return;
      state.message = 'Reading aloud…'; refresh(shell);
      if(!current())return;
      const pending=state.pending=(cloud ? createCloudVoice(directReadAloud?'direct':'cloud').speak(spokenText, controller.signal) : speakOnDevice(spokenText, controller.signal));await pending;
      if (current()) { state.controller = undefined; state.message = 'Finished reading.'; refresh(shell); }
    } catch (error) {
      if((error as {code?:string})?.code==='speech-cleanup-unconfirmed'&&state.pending)retainSpeechRetirement(state.pending);
      if (!current()) return;
      state.controller = undefined;
      const recovery = cloud ? cloudVoiceFailure(error) : null;
      state.message = controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError') ? 'Reading stopped.' : recovery || (error instanceof Error ? error.message + ' The complete message may not have been read.' : 'Reading stopped before completion. The written message is still available.');
      refresh(shell);
    } finally {if(states.get(shell)===state&&!current()){stop(shell);refresh(shell);}}
  }
  /** Observe the conversation for the dictated turn: send, first token, final reply. */
  function followVoiceTurn(shell: Shell) {
    const turn = voiceTurn; if (!turn) return;
    const msgs: Shell[] = shell.S().msgs || [];
    if (turn.binding !== conversationBinding()) { voiceTurn = undefined; abandonVoiceTurn(); return; }
    if (!turn.userId) {
      const sent = msgs.filter(m => m.from === 'user' && !turn.known.has(String(m.id)));
      if (!sent.length) return;
      // Only an unchanged reviewed transcript is timed as the dictated turn.
      if (sent.length !== 1 || String(sent[0].text || '').trim() !== turn.draft || typeof sent[0].id !== 'string') { voiceTurn = undefined; abandonVoiceTurn(); return; }
      turn.userId = sent[0].id; markVoiceTiming('send');
    }
    const at = msgs.findIndex(m => m.id === turn.userId);
    if (at < 0) { voiceTurn = undefined; abandonVoiceTurn(); return; }
    const later = msgs.slice(at + 1);
    // A newer user message makes any reply to this turn stale.
    if (later.some(m => m.from === 'user')) { voiceTurn = undefined; abandonVoiceTurn(); return; }
    const reply = later.find(m => m.from === 'agent');
    if (!reply) return;
    if (!turn.firstToken) { turn.firstToken = true; markVoiceTiming('first-token'); }
    if (reply.streaming) return;
    voiceTurn = undefined;
    if (reply.interrupted || typeof reply.id !== 'string' || typeof reply.text !== 'string' || !reply.text.trim()) { abandonVoiceTurn(); return; }
    markVoiceTiming('final-reply'); finishVoiceTurn();
  }
  p.renderVals = function () {
    const out = original.call(this), source = this.S().msgs || [], state = states.get(this);
    const directReadAloud=developmentCartesiaVoiceEnabled;
    const cloud = selectVoiceRoute() === 'cloud'||directReadAloud;
    const available = cloud || createOnDeviceVoice() !== null;
    out.msgs = (out.msgs || []).map((message: Shell) => {
      const entry = source.find((entry: Shell) => entry.id === message.id);
      if (!entry || entry.streaming || entry.interrupted || !entry.text || entry.text !== message.text || typeof entry.id !== 'string') return message;
      const visibleText = typeof message.displayText === 'string' ? message.displayText : entry.text;
      const selected = state?.id === entry.id;
      const menu = menus.get(this), opened = menu?.id === entry.id;
      return { ...message, messageActionsOpen: opened, messageActionsRole: 'button', messageActionsTabIndex: 0, messageActionsLabel: 'Message actions: ' + visibleText, messageActionsPopup: 'menu',
        openMessageActions: (event: MouseEvent) => { if(suppressedClicks.get(this)===entry.id){suppressedClicks.delete(this);event.preventDefault();event.stopPropagation();return;}if (window.getSelection()?.isCollapsed!==false) openMenu(this, entry.id, entry.text, event); },
        messageActionsKey: (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') openMenu(this, entry.id, entry.text, event); },
        messageActionsContext: (event: MouseEvent) => {if(window.getSelection()?.isCollapsed===false)return;suppressedClicks.set(this,entry.id);openMenu(this, entry.id, entry.text, event);},
        messageActionsDown: (event: PointerEvent) => {
          suppressedClicks.delete(this);cancelHold(this);
          if(event.pointerType==='mouse'){holds.set(this,{x:event.clientX,y:event.clientY});return;}
          if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
          const target = event.currentTarget as HTMLElement, binding = JSON.stringify(connectionController.getSnapshot().session);
          holds.set(this, { x: event.clientX, y: event.clientY,start:caret(event.clientX,event.clientY), timer: setTimeout(() => {
            const hold=holds.get(this);if(!hold)return;hold.timer=undefined;
            if (this.live === false || window.getSelection()?.isCollapsed===false || binding !== JSON.stringify(connectionController.getSnapshot().session) || !['sheet', 'full'].includes(this.S().chat) || !this.S().msgs?.some((m: Shell) => m.id === entry.id && m.text === entry.text)) {cancelHold(this);return;}hold.opened=true;suppressedClicks.set(this,entry.id);menus.set(this, { id: entry.id, text: entry.text, trigger: target, notice: '', focus: false, binding: JSON.stringify(connectionController.getSnapshot().session) }); refresh(this);
          }, 500) });
        },
        messageActionsMove: (event: PointerEvent) => {
          const hold=holds.get(this);if(!hold||Math.hypot(event.clientX-hold.x,event.clientY-hold.y)<=8)return;
          if(hold.opened&&hold.start?.node.isConnected){const end=caret(event.clientX,event.clientY);if(end){hold.selecting=true;window.getSelection()?.setBaseAndExtent(hold.start.node,hold.start.offset,end.node,end.offset);closeMenu(this);}return;}
          cancelHold(this);suppressedClicks.set(this,entry.id);closeMenu(this);
        },
        messageActionsCancel: () => cancelHold(this),
        canReplyMessage: this.canReplyMessage?.(entry)===true, canEditMessage: this.canEditMessage?.(entry)===true,
        replyMessage: () => { closeMenu(this); this.replyToMessage?.(entry); }, editMessage: () => { closeMenu(this); this.editMessage?.(entry); },
        closeMessageActions: (event: MouseEvent) => closeMenu(this, event.detail===0), menuKey: (event: KeyboardEvent) => menuKey(this, event),
        copyMessage: async () => {
          if (!menu || menus.get(this) !== menu || menu.binding !== JSON.stringify(connectionController.getSnapshot().session)) return;
          try { await navigator.clipboard.writeText(visibleText); if (menus.get(this) === menu) { menu.notice = ''; menu.announcement = 'Copied.'; menu.copied=true; refresh(this);setTimeout(()=>{if(menus.get(this)===menu){menu.copied=false;refresh(this);}},1400); } }
          catch { if (menus.get(this) === menu) { menu.copied=false; menu.announcement = ''; menu.notice = 'Copy unavailable. Select the message text to copy it.'; refresh(this); } }
        },
        copyMessageLabel: opened&&menu?.copied?'Copied!':'Copy',
        copyMessageIcon: opened&&menu?.copied?out.ic.check:out.ic.copy,
        messageActionsNotice: opened && menu ? menu.notice : '',
        messageActionsAnnouncement: opened && menu ? menu.announcement || '' : '',
        localSpeechAvailable: available && entry.from === 'agent', localSpeechLabel: 'Read aloud', localSpeechControlLabel:selected&&state?.controller?'Stop reading':'Read aloud',localSpeechIcon:selected&&state?.controller?out.ic.stop:out.ic.wave,localSpeechActive:!!(selected&&state?.controller),
        localSpeechMessage: selected&&!state?.controller&&state?.message!=='Finished reading.' ? state?.message : '',
        localSpeech: () => { void listen(this, entry.id, entry.text, visibleText); }
      };
    });
    return out;
  };
  p.componentDidMount = function (...args: unknown[]) {
    const outside = (event: PointerEvent) => { if (!(event.target as Element)?.closest('[data-alpha-message-actions], [data-alpha-message-text]')) closeMenu(this); };
    const selection=()=>{if(window.getSelection()?.isCollapsed===false){if(!holds.get(this)?.selecting)cancelHold(this);closeMenu(this);}};
    const touchMove=(event:TouchEvent)=>{if(holds.get(this)?.opened)event.preventDefault();};
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('selectionchange',selection);
    document.addEventListener('touchmove',touchMove,{passive:false});
    listeners.set(this, () => {document.removeEventListener('pointerdown', outside, true);document.removeEventListener('selectionchange',selection);document.removeEventListener('touchmove',touchMove);});
    const result=mount?.apply(this, args);syncTranscriptFade(this);return result;
  };
  p.componentDidUpdate = function (...args: unknown[]) {
    const state = states.get(this), value = this.S(), menu = menus.get(this);
    if (!['sheet', 'full'].includes(value.chat)) cancelHold(this);
    if (menu && (menu.binding !== JSON.stringify(connectionController.getSnapshot().session) || !['sheet', 'full'].includes(value.chat) || !(value.msgs || []).some((m: Shell) => m.id === menu.id && m.text === menu.text))) { cancelHold(this); closeMenu(this); }
    else if (menu?.focus) { menu.focus = false; document.querySelector<HTMLElement>('[data-alpha-message-actions] [role="menuitem"]')?.focus(); }
    if (state && (state.current&&!state.current()||!['sheet', 'full'].includes(value.chat) || !(value.msgs || []).some((m: Shell) => m.id === state.id && m.text === state.text))) { stop(this); refresh(this); }
    followVoiceTurn(this);
    const result=update?.apply(this, args);syncTranscriptFade(this);return result;
  };
  p.componentWillUnmount = function (...args: unknown[]) { cancelHold(this); transcriptObservers.get(this)?.observer?.disconnect();transcriptObservers.delete(this); menus.delete(this); listeners.get(this)?.(); listeners.delete(this); stop(this);stopSpeaking();voiceTurn=undefined; return unmount?.apply(this, args); };
}
