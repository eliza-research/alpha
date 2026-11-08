import {VoiceAssistantSession, splitSpokenSentences} from '../../../../apps/app/src/runtime/voice-assistant.ts';
import {usableNavigationFix} from '../../../../apps/app/src/maps/navigation-fix.ts';
import {atStep} from '../../../../apps/app/src/maps/guidance.ts';
import {qset} from '../check-traces.mjs';

const action = (name, ...args) => ({name, args});
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => {});
  return {promise, resolve, reject};
}

function voiceHarness(closeGate, endpoint) {
  let now = 0;
  let current = true;
  let handlers;
  let heard = '';
  const timers = new Map();
  let timerId = 0;
  const requests = [];
  const playbacks = [];
  const clock = {
    now: () => now,
    setTimer(callback, delay) { const id = ++timerId; timers.set(id, {callback, at: now + delay}); return id; },
    clearTimer(id) { timers.delete(id); },
    async advance(delta) {
      const end = now + delta;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]); now = next[1].at; next[1].callback(); await flush();
      }
      now = end; await flush();
    },
  };
  const session = new VoiceAssistantSession({
    conversationId: 'refinement',
    ...(endpoint ? {endpoint} : {}),
    assertCurrent() { if (!current) throw new DOMException('retired', 'AbortError'); },
    async listen(value) { handlers = value; return {fullDuplex: true, async close() { if (closeGate) await closeGate.promise; }, cancel() {}}; },
    send(input) {
      const pending = deferred(); requests.push({input, pending});
      input.signal.addEventListener('abort', () => pending.reject(input.signal.reason), {once: true});
      return pending.promise;
    },
    speak(input) {
      const pending = deferred(); playbacks.push({input, pending}); input.onStarted();
      input.signal.addEventListener('abort', () => pending.reject(input.signal.reason), {once: true});
      return pending.promise;
    },
    onHeard(value) { heard = value.heard; },
  }, {clock});
  const observe = () => ({
    's.phase': session.getSnapshot().phase === 'awaiting-user-input' ? 'awaiting-review' : session.getSnapshot().phase,
    's.capture': Boolean(session.capture),
    's.muted': session.muted,
    's.inputHeld': session.getSnapshot().inputHeld === true,
    's.closingInput': Boolean(session.hold && !session.hold.closed),
    's.pendingReview': Boolean(session.awaiting),
  });
  return {session, clock, requests, playbacks, observe,
    get handlers() { return handlers; },
    retire() { current = false; session.recheck(); },
    heard() { return session.response?.played ?? splitSpokenSentences(heard).length; },
    answer(index = 0, overrides = {}) {
      const {input, pending} = requests[index];
      pending.resolve({requestId: input.turnId, conversationId: 'refinement', userMessageId: 'user', assistantMessageId: 'reply',
        complete: true, text: 'This is the first complete sentence. This is the second complete sentence.', ...overrides});
    },
  };
}

export async function voiceTraces() {
  const traces = [];
  for (const mode of ['complete', 'stop-pending', 'retire-pending', 'mute-pending', 'stop-speaking']) {
    const host = voiceHarness();
    const trace = {name: `voice-${mode}`, expect: host.observe(), steps: []};
    const step = (descriptor, expect = host.observe()) => trace.steps.push({label: descriptor.name, action: descriptor, expect});
    await host.session.start(); step(action('start', false, true));
    host.handlers.onSpeechStart(0); step(action('speechStarts'));
    host.handlers.onSpeechEnd(0); host.handlers.onSegment('Please describe the weather.'); await flush();
    step(action('segment', 0, true), {...host.observe(), 's.text': Boolean(host.session.getSnapshot().pendingText)});
    await host.clock.advance(1200); step(action('submit', true), {...host.observe(), 's.sent': qset(host.requests.map((_, index) => index + 1))});
    if (mode === 'stop-pending' || mode === 'retire-pending') {
      if (mode === 'retire-pending') { host.retire(); await flush(); } else await host.session.stop();
      step(action('stop'));
      host.answer(); await flush(); step(action('reply', 0, 1, false));
    } else {
      if (mode === 'mute-pending') { await host.session.setMuted(true); step(action('mute')); }
      host.answer(); await flush(); step(action('reply', 0, 1, false));
      host.playbacks[0].pending.resolve(); await flush();
      step(action('sentenceFinished', 0, 1), {...host.observe(), 's.heard': host.heard()});
      if (mode === 'stop-speaking') {
        await host.session.stop(); step(action('stop'), {...host.observe(), 's.heard': host.heard()});
      } else {
        host.playbacks[1].pending.resolve(); await flush();
        trace.steps.push({label: 'last sentence and reply completion', action: [action('sentenceFinished', 0, 1), action('playbackFinished')],
          expect: {...host.observe(), 's.heard': host.heard()}});
        await host.session.stop(); step(action('stop'));
      }
    }
    traces.push(trace);
  }
  for (const decision of ['finished', 'continue']) {
    const result = deferred();
    const host = voiceHarness(undefined, () => result.promise);
    const trace = {name: `voice-semantic-${decision}`, expect: host.observe(), steps: []};
    const step = (name, ...args) => trace.steps.push({label: name, action: action(name, ...args), expect: host.observe()});
    await host.session.start(); step('start', false, true);
    host.handlers.onSpeechStart(0); step('speechStarts');
    host.handlers.onSpeechEnd(0); host.handlers.onSegment('Please describe the weather.'); await flush(); step('segment', 0, true);
    await host.clock.advance(300); step('shortGap');
    if (!host.session.endpointController || host.requests.length) throw new Error('Semantic probe was not pending');
    result.resolve({decision}); await flush();
    if (decision === 'finished') trace.steps.push({label:'semantic completion submits after capture close',action:[action('endpointResult',1,true),action('submit',false)],expect:host.observe()});
    else {
      step('endpointResult',1,false);
      if (host.requests.length) throw new Error('Continue response submitted early');
      await host.clock.advance(900); step('submit',true);
    }
    if (host.requests.length !== 1) throw new Error('Endpoint did not send exactly once');
    await host.session.stop(); step('stop');
    traces.push(trace);
  }
  for (const mode of ['review', 'interrupt']) {
    const host = voiceHarness();
    const trace = {name:`voice-${mode}`,expect:host.observe(),steps:[]};
    const step = (name,...args) => trace.steps.push({label:name,action:action(name,...args),expect:host.observe()});
    await host.session.start(); step('start',false,true);
    host.handlers.onSpeechStart(0); step('speechStarts');
    host.handlers.onSpeechEnd(0);host.handlers.onSegment('Please describe the weather.');await flush();step('segment',0,true);
    await host.clock.advance(1200);step('submit',true);
    if (mode === 'review') {
      host.answer(0,{complete:false,awaitingUserInput:{proposalId:'proposal',digest:'reviewed'}});await flush();step('reply',0,1,true);
      const pause=host.session.getSnapshot().awaitingUserInput;
      const reply={requestId:pause.requestId,conversationId:pause.conversationId,userMessageId:pause.userMessageId,assistantMessageId:'approved',complete:true,text:'Reviewed answer.'};
      if(host.session.resume({pause:{...pause,digest:'changed'},reply}))throw new Error('Changed review accepted');
      step('resumeReview',0,1,false);
      if(!host.session.resume({pause,reply}))throw new Error('Exact reviewed reply refused');
      await flush();step('resumeReview',0,1,true);
      if(host.requests.length!==1)throw new Error('Review repeated source dispatch');
    } else {
      host.answer();await flush();step('reply',0,1,false);
      if(!host.session.interruptSpeech())throw new Error('Speaking response did not interrupt');
      await flush();step('interruptSpeech');
    }
    await host.session.stop();step('stop');traces.push(trace);
  }
  for (const mode of ['release', 'reject', 'stop']) {
    const closeGate = deferred();
    const host = voiceHarness(closeGate);
    const trace = {name: `voice-close-${mode}`, expect: host.observe(), steps: []};
    const step = (name, ...args) => trace.steps.push({label: name, action: action(name, ...args), expect: {...host.observe(), 's.sent': qset(host.requests.map((_, index) => index + 1))}});
    await host.session.start(); step('start', false, true);
    host.handlers.onSpeechStart(0); step('speechStarts');
    host.handlers.onSpeechEnd(0); host.handlers.onSegment('Please describe the weather.'); await flush(); step('segment', 0, true);
    await host.clock.advance(1200); step('beginSubmission', true);
    if (host.requests.length !== 0) throw new Error('Source sent before capture close');
    if (mode === 'stop') {
      const stopping = host.session.stop(); await flush(); step('stop');
      closeGate.resolve(); await stopping; await flush();
      trace.steps.push({label: 'retired close completes', action: null, expect: {...host.observe(), 's.sent': qset([])}});
    } else if (mode === 'reject') {
      closeGate.reject(new Error('unconfirmed capture close')); await flush(); step('inputCloseFailed');
    } else {
      closeGate.resolve(); await flush(); step('inputClosed');
      await host.session.stop(); step('stop');
    }
    traces.push(trace);
  }
  return traces;
}

export function navigationTraces() {
  const traces = [];
  for (const accuracy of [0, 30, 31, 50, 51]) for (const age of [-5001, -5000, 0, 30000, 30001]) for (const precise of [false, true]) {
    const accepted = usableNavigationFix({coordinate: {latitude: 0, longitude: 0}, accuracyMeters: accuracy,
      timestamp: 100000 - age, precision: precise ? 'precise' : 'approximate'}, 100000);
    const steps = [{instruction: 'First'}, {instruction: 'Second'}, {instruction: 'Third'}];
    const projection = {alongMeters: 100, maneuverAlongMeters: [0, 100, 200], remainingMeters: 100,
      remainingSeconds: 100, next: {index: 2, step: steps[2], distanceMeters: 100}};
    const actual = atStep(projection, steps, 0);
    traces.push({name: `fix-${accuracy}-${age}-${precise}`, expect: {'s.fixReady': false}, steps: [
      {action: action('start', 1), expect: {'s.fixReady': false}},
      {action: action('measuredFix', 1, accuracy, precise, age, 100, 0, 100, 100, 100, 2),
        expect: {'s.fixReady': accepted, 's.displayedStep': actual.next.index}},
    ]});
  }
  return traces;
}
