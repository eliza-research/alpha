/** Replays VoiceOwnedNavigation model traces against the voice surface's `chatCurrent`,
 * `navigationContinuation` and its wrappers around the shell's `openView`, `goHome` and `back`,
 * evaluated from apps/app/src/prototype/voice-adapter.ts.
 *
 * These functions live in the adapter's closure. The replay supplies that closure's variables
 * (the chat destination, the prepared conversation, the generation) and its `cleanup`, which here
 * only closes the destination, drops the claim and advances the generation as the adapter's does.
 * The shell is a port: its screen, its context revision and its navigation methods.
 *
 * Not observed: `attempted` (private to one continuation; visible through what `finish` does). A
 * closed surface keeps no destination, so `chatView` and `preparedRevision` are compared only
 * while voice is open. */
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import {modelTraces, replayTraces, repositoryRoot} from '../assistant-model-traces.mjs';

export const model = {path: 'specs/quint/application/VoiceOwnedNavigation.qnt', module: 'VoiceOwnedNavigation'};
export const scenarios = ['agentNavigationKeepsVoiceTest', 'changedContextRetiresVoiceTest', 'undeliveredNavigationRetiresVoiceTest',
  'userNavigationRetiresVoiceTest', 'secondClaimIsRefusedTest', 'unswitchedScreenIsNeverPinnedTest'];
export const witnesses = ['RetainedOnDestinationWitness', 'UnconfirmedRetiresVoiceWitness', 'UserNavigationDropsClaimWitness', 'SecondClaimRefusedWitness'];

const flush = async () => { for (let turn = 0; turn < 3; turn++) await new Promise(resolve => setImmediate(resolve)); };
const NAMES = ['home', 'calendar', 'notes'];

export function compile() {
  const source = readFileSync(`${repositoryRoot}/apps/app/src/prototype/voice-adapter.ts`, 'utf8');
  const between = (start, end) => { const a = source.indexOf(start), b = source.indexOf(end, a); if (a < 0 || b <= a) throw Error(`missing source anchor ${start}`); return source.slice(a, b); };
  const current = between('  function chatCurrent(){', '  function cancelChat(');
  const wrappers = between("  for (const method of ['openView', 'goHome', 'back']) {", '  async function captureConversationAudio(');
  return transformSync(`let chatDestination,ownedNavigation,conversationPrepared,generation=0,retirement,conversationVoice;
    function cleanup(close,publish,cause){ports.retired(cause);ownedNavigation=undefined;conversationPrepared=undefined;chatDestination=undefined;++generation;}
    function cancelChat(){cleanup();}
    function dismissRetirement(){return false;}
    function noteRealtimeCancellation(){}
    ${current}
    ${wrappers}
    return {chatCurrent,cleanup,
      start(shell,prepared){chatDestination={shell,view:shell.S().view||null,chat:shell.S().chat,draft:'',reply:undefined,edit:undefined,binding:composerBinding()};conversationPrepared=prepared;},
      continuation(turnId){return navigationContinuation(chatDestination,generation,turnId);},
      state(){return {chat:chatDestination,owned:ownedNavigation,prepared:conversationPrepared};}};`, {loader: 'ts', format: 'cjs'}).code;
}

export function project(state) {
  const {attempted, ...observed} = state;
  return {...observed, chatView: state.voice ? state.chatView : null, preparedRevision: state.voice ? state.preparedRevision : null,
    claimView: state.claim === 'none' ? null : state.claimView, switched: state.claim === 'none' ? null : state.switched,
    pinnedRevision: state.claim === 'pinned' ? state.pinnedRevision : null};
}

export function createDriver(code) {
  let revision = 0, byUser = false;
  const counts = {retained: 0, pins: 0, retiredUnconfirmed: 0, retiredByUser: 0, refusedClaims: 0};
  let apply = {result: 'none'}, claim, continuation;
  class Shell {
    live = true; state = {view: null, chat: 'sheet', draft: ''}; voiceSendTurnId = 'turn';
    S() { return this.state; }
    openView(view) { this.state = {...this.state, view}; revision++; }
    goHome() { this.state = {...this.state, view: null}; revision++; }
    back() { this.state = {...this.state, view: null}; revision++; }
    voiceConversationCurrent(prepared) { return prepared.context.view === (this.state.view || 'home') && prepared.context.revision === revision; }
    voiceConversationContext() { return {view: this.state.view || 'home', revision, sensitive: false}; }
  }
  const ports = {retired(cause) { if (cause === 'owned-navigation-unconfirmed') counts.retiredUnconfirmed++; else if (byUser) counts.retiredByUser++; }};
  const adapter = new Function('Component', 'ports', 'document', 'connectionController', 'composerBinding', code)(Shell, ports, {hidden: false},
    {getSnapshot: () => ({open: false})}, () => 'composer');
  const shell = new Shell();
  const viewNumber = () => NAMES.indexOf(shell.S().view || 'home');
  const navigate = target => { if (target === 0) shell.goHome(); else shell.openView(NAMES[target]); };
  return {
    startVoice() { adapter.start(shell, {binding: {conversationId: 'room'}, context: shell.voiceConversationContext()}); apply = {result: 'none'}; claim = undefined; },
    async claimDestination(target, moved) {
      const next = adapter.continuation('turn'), held = {target, moved, settle: undefined, pin: undefined};
      let committed = false;
      const attempt = {result: 'none'};
      next.apply(NAMES[target], () => {}, (_detent, onCommitted) => {
        committed = true; held.pin = onCommitted;
        // The shell's own navigation happens inside the claim.
        if (moved && target !== viewNumber()) navigate(target);
        return new Promise(resolve => { held.settle = resolve; });
      }).then(value => { attempt.result = String(value); }, () => { attempt.result = 'refused'; });
      await flush();
      if (!committed) { counts.refusedClaims++; return; }
      claim = held; continuation = next; apply = attempt;
    },
    contextPinned() { try { claim.pin(shell.voiceConversationContext()); counts.pins++; } catch { /* Not the claimed destination. */ } },
    contextChanges() { revision++; },
    async applySettles() { claim.settle(claim.moved); await flush(); },
    userNavigates(target) { byUser = true; try { navigate(target); } finally { byUser = false; } },
    finish(delivered) { if (continuation.finish(delivered)) counts.retained++; },
    stopVoice() { adapter.cleanup(); },
    observe() {
      const {chat, owned, prepared} = adapter.state();
      return {voice: !!chat, view: viewNumber(), chatView: chat ? NAMES.indexOf(chat.view || 'home') : null, contextRevision: revision,
        preparedRevision: chat ? prepared.context.revision : null, claim: !owned ? 'none' : owned.context ? 'pinned' : 'committed',
        claimView: owned ? NAMES.indexOf(owned.view) : null, switched: owned ? claim.moved : null,
        pinnedRevision: owned?.context ? owned.context.revision : null, applyResult: apply.result === 'refused' ? 'none' : apply.result, ...counts};
    },
  };
}

export async function runVoiceOwnedNavigationReplay({random = 80, steps = 40} = {}) {
  const code = compile(), traces = modelTraces({...model, scenarios, witnesses, random, steps});
  return replayTraces(traces, () => createDriver(code), {project});
}
