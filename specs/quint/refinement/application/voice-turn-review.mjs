/** Replays VoiceTurnReview model traces against the installed voice adapter
 * (apps/app/src/prototype/voice-adapter.ts) in the voice view fixture: the real adapter, the real
 * shared clip conversation, the real `sendVoiceEntry`, and a shell that runs `componentDidUpdate`
 * once after the state updates of a task, as React does. The conversation is started with `startVoice`, a turn is
 * spoken through the recording port (a level above the speech threshold, then silence), and the
 * review is driven through the controls `renderVals` hands to the chat recorder panel.
 *
 * Controlled ports: the Cloud recording and speech driver and the fake clock of the fixture, the
 * reply of `sendVoiceTurn` (held, then resolved or rejected), the connection chooser's open flag
 * (the chat's currency) and the voice send policy, which is the build constant's `review` value.
 *
 * Correspondence notes.
 *  - Losing currency is the connection chooser opening without the shell having been told yet;
 *    the panel is read with the chooser momentarily reported closed.
 *  - A failed reply is a rejected `sendVoiceTurn`; a review requirement is the reply the shell
 *    returns for one (`complete: false, reviewRequired: true`), an owner-input pause the reply with
 *    `awaitingUserInput`.
 *  - After a spoken reply the clock runs until the conversation listens again.
 *  - `text` is compared while a review is held, `reviewRequired` while voice is open.
 *  - `turnAborted` has no cause in the fixture that leaves voice open, so a trace is replayed up to
 *    its first `turnAborted`. */
import assert from 'node:assert/strict';
import {modelTraces, replayTraces, repositoryRoot} from '../assistant-model-traces.mjs';

export const model = {path: 'specs/quint/application/VoiceTurnReview.qnt', module: 'VoiceTurnReview'};
export const scenarios = ['reviewedTurnIsSentAsEditedTest', 'emptyReviewCannotBeSentTest', 'discardEndsConversationTest', 'closingDropsHeldReviewTest',
  'reviewRequiredDoesNotResumeTest', 'staleReplyClosesVoiceTest', 'failedReplyStartsOverTest', 'ownerInputPauseIsNotAReviewRequirementTest'];
export const witnesses = ['EditedTextSentWitness', 'DiscardedWitness', 'ReviewRequiredClosesWitness', 'AbortedReviewWitness'];

const {cloudVoiceViewFixture} = await import(`${repositoryRoot}/test/fixtures/cloud-voice-view.mjs`);
const {voiceFakeClock} = await import(`${repositoryRoot}/test/fixtures/shared-batch-voice.mjs`);
const REVIEW_LINE = 'Mic off · use keyboard';

export function project(state) {
  return {...state, text: state.review === 'held' ? state.text : '', reviewRequired: state.voice && state.reviewRequired};
}

export function createDriver() {
  const clock = voiceFakeClock();
  const f = cloudVoiceViewFixture({cloudProfile: true, native: true, platform: 'android', clock, peak: 0, transcript: 'spoken'});
  f.box.React = {createElement: () => null}; f.box.VoiceActivity = () => null;
  f.box.voiceSendPolicy = () => 'review';
  const shell = f.shell, replies = [];
  let prepares = 0, tap = {outcome: 'none', sentText: '', settles: 0};
  const setState = shell.setState.bind(shell);
  // State updates made in one task are committed together, then componentDidUpdate runs once.
  let committing = false;
  shell.setState = (patch, callback) => { setState(patch, callback); if (committing) return; committing = true; queueMicrotask(() => { committing = false; if (shell.live !== false) shell.componentDidUpdate(); }); };
  const prepare = shell.prepareVoiceConversation.bind(shell);
  shell.prepareVoiceConversation = (...args) => { prepares++; tap = {outcome: 'none', sentText: '', settles: 0}; return prepare(...args); };
  shell.sendVoiceTurn = async function (input) {
    this.voiceSendTurnId = input.turnId; input.signal.throwIfAborted(); input.assertCurrent();
    const reply = await new Promise((resolve, reject) => replies.push({input, resolve, reject}));
    input.signal.throwIfAborted(); input.assertCurrent(); return reply;
  };
  // The review's own promise is observed as it settles; nothing about it is changed.
  const sendVoiceEntry = f.box.sendVoiceEntry;
  f.box.sendVoiceEntry = input => sendVoiceEntry({...input, review: text => {
    const held = tap = {outcome: 'none', sentText: '', settles: 0};
    return input.review(text).then(value => { held.settles++; held.outcome = value === null ? 'discarded' : 'sent'; held.sentText = value ?? ''; return value; },
      reason => { held.settles++; held.outcome = 'aborted'; throw reason; });
  }});
  const panel = () => { const open = f.open; f.open = false; try { return f.renderChat(); } finally { f.open = open; } };
  const settle = async () => { await clock.flush(); await clock.advance(0); };
  return {
    async start() { await shell.startVoice(); await settle(); },
    async transcriptReady() { f.peak = 0.5; await clock.advance(700); f.peak = 0; await clock.advance(1200); },
    async edit(text) { panel().onTranscript({target: {value: text}}); await settle(); },
    async sendReviewed() { panel().stop(); await settle(); },
    async discard() { panel().toggle(); await settle(); },
    currencyLost() { f.open = true; }, currencyBack() { f.open = false; },
    async replyArrives(reviewRequired, awaitingInput, failed) {
      const {input, resolve, reject} = replies.at(-1);
      if (failed) reject(Error('The agent did not answer.'));
      else resolve({requestId: input.turnId, conversationId: f.conversation, userMessageId: 'user-message', assistantMessageId: 'agent-message', text: 'Synthetic reply.',
        complete: !reviewRequired && !awaitingInput, ...(reviewRequired ? {reviewRequired: true} : {}), ...(awaitingInput ? {awaitingUserInput: {proposalId: 'proposal', digest: 'digest'}} : {})});
      await settle();
      for (let waited = 0; waited < 6000 && ['preparing-speech', 'speaking', 'starting'].includes(panel()?.state); waited += 100) await clock.advance(100);
    },
    async recover() { panel().recover(); await settle(); },
    async close() { await Promise.resolve(shell.stopVoiceConversation?.()).catch(() => {}); if (f.open) shell.setState({}); await settle(); },
    observe() {
      const view = panel(), voice = !!view;
      if (voice) assert.ok(['review', 'listening', 'thinking', 'error', 'awaiting-user-input'].includes(view.state), `settled panel state ${view.state}`);
      const sent = replies.map(reply => reply.input.text);
      if (tap.outcome === 'sent') assert.equal(sent.at(-1), tap.sentText, 'the reviewed text is the text handed to the agent');
      return {voice, current: !f.open, review: view?.review ? 'held' : 'none', text: view?.review ? view.transcript : '', ...tap, sends: replies.length,
        reviewRequired: voice && !view.review && String(view.lines[0].t).startsWith(REVIEW_LINE), phase: voice ? view.state : 'idle', restarts: prepares};
    },
    async dispose() { f.open = false; try { f.close(); } catch {} for (const reply of replies) reply.reject(Error('closed')); await clock.flush(); },
  };
}

/** A trace up to its first `turnAborted`. */
export const replayable = trace => { const end = trace.steps.findIndex(step => step.action === 'turnAborted'); return end < 0 ? trace : {...trace, steps: trace.steps.slice(0, end)}; };

export async function runVoiceTurnReviewReplay({random = 80, steps = 40} = {}) {
  const traces = modelTraces({...model, scenarios, witnesses, random, steps}).map(replayable);
  const drivers = [];
  try { return await replayTraces(traces, () => { const driver = createDriver(); drivers.push(driver); return driver; }, {project}); }
  finally { for (const driver of drivers) await driver.dispose(); }
}
