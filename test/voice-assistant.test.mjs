import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Voice assistant controller (apps/app/src/runtime/voice-assistant.ts, #423): endpointing,
// generations, barge-in, heard-content accounting, account change, and the live segment stream
// it listens through (live-segment-stream.ts). Fake clock, capture, agent and speaker.
const {VoiceAssistantSession, splitSpokenSentences, ASSISTANT_TIMING_DEFAULTS} = await import('../apps/app/src/runtime/voice-assistant.ts');
const {createLiveSegmentStream} = await import('../apps/app/src/runtime/live-segment-stream.ts');

function fakeClock() {
  let now = 0, id = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimer: (callback, ms) => { const handle = ++id; timers.set(handle, {at: now + ms, callback}); return handle; },
    clearTimer: handle => { timers.delete(handle); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]); now = next[1].at; next[1].callback();
        await flush();
      }
      now = end; await flush();
    },
  };
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); promise.catch(() => {}); return {promise, resolve, reject}; }

function harness(options = {}) {
  const clock = fakeClock();
  const log = {sends: [], spoken: [], heard: [], states: [], turns: [], endpoints: [], captures: 0, cancelled: 0, closed: 0};
  let mic, current = true;
  const replies = [];
  const speeches = [];
  const ports = {
    conversationId: 'room-1',
    assertCurrent: () => { if (!current) throw new DOMException('binding changed', 'AbortError'); },
    listen: async handlers => {
      log.captures++; mic = handlers;
      if (options.holdOpen) await options.holdOpen.promise;
      return {fullDuplex: options.fullDuplex ?? true, close: async () => { log.closed++; }, cancel: () => { log.cancelled++; }};
    },
    shouldRespond: options.shouldRespond,
    endpoint: options.endpoint,
    send: input => {
      log.sends.push({turnId: input.turnId, text: input.text});
      const reply = deferred();
      replies.push({input, reply});
      input.signal.addEventListener('abort', () => reply.reject(new DOMException('cancelled', 'AbortError')), {once: true});
      return reply.promise;
    },
    speak: input => {
      const done = deferred();
      speeches.push({input, done});
      input.signal.addEventListener('abort', () => done.reject(new DOMException('stopped', 'AbortError')), {once: true});
      return done.promise;
    },
    onHeard: value => log.heard.push(value),
    onState: value => log.states.push(value),
    onTurn: (event, turnId, detail) => { log.turns.push([event, turnId]); if (detail) log.endpoints.push(detail.endpoint); },
  };
  const session = new VoiceAssistantSession(ports, {clock, ...(options.timing ? {timing: options.timing} : {})});
  const answer = (index, text, extra = {}) => {
    const {input, reply} = replies[index];
    reply.resolve({requestId: input.turnId, conversationId: 'room-1', userMessageId: `u-${index}`, assistantMessageId: `a-${index}`, text, complete: true, ...extra});
  };
  return {
    clock, log, session, replies, speeches, answer,
    get mic() { return mic; },
    setCurrent(value) { current = value; },
    async say(text, durationMs = 400) {
      mic.onSpeechStart(clock.now()); await flush();
      await clock.advance(durationMs);
      mic.onSpeechEnd(clock.now()); await flush();
      mic.onSegment(text); await flush();
    },
    phase: () => session.getSnapshot().phase,
  };
}

test('VAD fallback: an utterance is sent once after the long gap, and resumed speech before it continues the same turn', async () => {
  const h = harness();
  await h.session.start();
  assert.equal(h.phase(), 'listening');
  await h.say('remind me to call');
  await h.clock.advance(ASSISTANT_TIMING_DEFAULTS.longGapMs - 100);
  assert.equal(h.log.sends.length, 0, 'nothing is sent before the long gap');
  // Hesitation: the user continues; the pending submit is cancelled and the text is appended.
  await h.say('Sam at five');
  await h.clock.advance(ASSISTANT_TIMING_DEFAULTS.longGapMs - 1);
  assert.equal(h.log.sends.length, 0);
  await h.clock.advance(1);
  assert.deepEqual(h.log.sends.map(send => send.text), ['remind me to call Sam at five'], 'one committed turn, no duplicate');
  assert.equal(h.phase(), 'thinking');
});

test('semantic endpoint: finished submits at the short gap; a slow or failing detector never blocks the long gap; speech wins a racing decision', async () => {
  const finished = harness({endpoint: async () => 'finished'});
  await finished.session.start();
  await finished.say('what is the weather');
  await finished.clock.advance(ASSISTANT_TIMING_DEFAULTS.shortGapMs);
  assert.equal(finished.log.sends.length, 1);

  const never = harness({endpoint: () => new Promise(() => {})});
  await never.session.start();
  await never.say('what is the weather');
  await never.clock.advance(ASSISTANT_TIMING_DEFAULTS.shortGapMs + ASSISTANT_TIMING_DEFAULTS.endpointDeadlineMs);
  assert.equal(never.log.sends.length, 0, 'an expired decision is continue');
  await never.clock.advance(ASSISTANT_TIMING_DEFAULTS.longGapMs);
  assert.equal(never.log.sends.length, 1, 'the long gap submits regardless');

  const failing = harness({endpoint: async () => { throw Error('model unavailable'); }});
  await failing.session.start();
  await failing.say('hello there');
  await failing.clock.advance(ASSISTANT_TIMING_DEFAULTS.longGapMs);
  assert.equal(failing.log.sends.length, 1);

  const decision = deferred();
  const racing = harness({endpoint: () => decision.promise});
  await racing.session.start();
  await racing.say('turn on the');
  await racing.clock.advance(ASSISTANT_TIMING_DEFAULTS.shortGapMs);
  racing.mic.onSpeechStart(racing.clock.now()); await flush();
  decision.resolve('finished'); await flush();
  assert.equal(racing.log.sends.length, 0, 'resumed speech beats a late finished decision');
  await racing.clock.advance(300); racing.mic.onSpeechEnd(racing.clock.now()); racing.mic.onSegment('kitchen lights'); await flush();
  await racing.clock.advance(ASSISTANT_TIMING_DEFAULTS.longGapMs);
  assert.deepEqual(racing.log.sends.map(send => send.text), ['turn on the kitchen lights']);
});

test('semantic endpoint (#36546 route): complete submits early, incomplete and unavailable wait for the long gap, and each submission records its path', async () => {
  const {residentEndpoint} = await import('../apps/app/src/runtime/voice-turn-routes.ts');
  const {shortGapMs, longGapMs} = ASSISTANT_TIMING_DEFAULTS;
  const scorer = response => {
    const calls = [];
    const request = (path, body, signal) => { calls.push({path, body, aborted: () => signal.aborted}); return typeof response === 'function' ? response(calls.length) : Promise.resolve(response); };
    return {calls, endpoint: residentEndpoint(() => request)};
  };

  const complete = scorer({available: true, endOfTurnProbability: 0.92, complete: true, commitThreshold: 0.7, nextSpeaker: 'agent', source: 'eliza-1-drafter', model: 'eliza-1', latencyMs: 41});
  const a = harness({endpoint: complete.endpoint});
  await a.session.start();
  await a.say('what is the weather in Lisbon');
  await a.clock.advance(shortGapMs - 1);
  assert.equal(complete.calls.length, 0, 'not asked before the short gap');
  await a.clock.advance(1);
  assert.deepEqual(complete.calls.map(call => [call.path, call.body]), [['/api/asr/local-inference/end-of-turn', {transcript: 'what is the weather in Lisbon'}]]);
  assert.equal(a.log.sends.length, 1, 'complete submits at the short gap');
  assert.deepEqual(a.log.endpoints, [{by: 'semantic', semantic: 'complete', latencyMs: 41}]);
  assert.equal(JSON.stringify(a.log.endpoints).includes('Lisbon'), false, 'no transcript in diagnostics');

  const incomplete = scorer({available: true, endOfTurnProbability: 0.2, complete: false, commitThreshold: 0.7, nextSpeaker: 'user', source: 'heuristic', model: null, latencyMs: 12});
  const b = harness({endpoint: incomplete.endpoint});
  await b.session.start();
  await b.say('remind me to');
  await b.clock.advance(longGapMs - 1);
  assert.equal(b.log.sends.length, 0, 'scored as not complete: waits for the long gap');
  assert.equal(incomplete.calls.length, 1, 'one call per utterance');
  await b.clock.advance(1);
  assert.equal(b.log.sends.length, 1);
  assert.deepEqual(b.log.endpoints, [{by: 'gap', semantic: 'incomplete', latencyMs: 12}]);

  for (const reason of ['voice-not-started', 'ffi-context-unloaded', 'scorer-unsupported', 'ram-pressure', 'unscored', 'timeout']) {
    const unavailable = scorer({available: false, reason});
    const c = harness({endpoint: unavailable.endpoint});
    await c.session.start();
    await c.say('turn off the lights');
    await c.clock.advance(longGapMs - 1);
    assert.equal(c.log.sends.length, 0, `unavailable (${reason}) is never complete`);
    await c.clock.advance(1);
    assert.equal(c.log.sends.length, 1);
    assert.deepEqual(c.log.endpoints, [{by: 'gap', semantic: 'unavailable', reason}]);
  }

  // 502 scoring error: the request port rejects with the status.
  const failing = scorer(() => Promise.reject(Object.assign(Error('Local agent request failed (HTTP 502).'), {status: 502})));
  const d = harness({endpoint: failing.endpoint});
  await d.session.start();
  await d.say('call mom');
  await d.clock.advance(longGapMs - 1);
  assert.equal(d.log.sends.length, 0);
  await d.clock.advance(1);
  assert.deepEqual(d.log.endpoints, [{by: 'gap', semantic: 'error'}]);

  // A scorer slower than the deadline: timeout, the call is aborted, the long gap submits.
  const slow = scorer(() => new Promise(() => {}));
  const e = harness({endpoint: slow.endpoint});
  await e.session.start();
  await e.say('play some music');
  await e.clock.advance(shortGapMs + ASSISTANT_TIMING_DEFAULTS.endpointDeadlineMs);
  assert.equal(slow.calls[0].aborted(), true, 'an expired call is aborted');
  assert.equal(e.log.sends.length, 0);
  await e.clock.advance(longGapMs);
  assert.deepEqual(e.log.endpoints, [{by: 'gap', semantic: 'timeout'}]);

  // No endpoint port: the gap path, not asked.
  const f = harness();
  await f.session.start();
  await f.say('hello');
  await f.clock.advance(longGapMs);
  assert.deepEqual(f.log.endpoints, [{by: 'gap', semantic: 'not-asked'}]);

  // An over-long transcript is never sent to the route.
  const long = scorer({available: true, complete: true});
  const g = harness({endpoint: long.endpoint});
  await g.session.start();
  await g.say('x'.repeat(4097));
  await g.clock.advance(longGapMs);
  assert.equal(long.calls.length, 0);
  assert.deepEqual(g.log.endpoints, [{by: 'gap', semantic: 'unavailable', reason: 'too-long'}]);
});

test('semantic endpoint races: resumed speech aborts the call and drops a late complete; one call in flight per utterance; the next utterance is asked afresh', async () => {
  const {shortGapMs, longGapMs} = ASSISTANT_TIMING_DEFAULTS;
  const calls = [];
  const h = harness({endpoint: (text, signal) => { const d = deferred(); calls.push({text, signal, d}); return d.promise; }});
  await h.session.start();
  await h.say('set a timer for');
  await h.clock.advance(shortGapMs);
  assert.equal(calls.length, 1);
  h.mic.onSpeechStart(h.clock.now()); await flush();
  assert.equal(calls[0].signal.aborted, true, 'resumed speech aborts the pending call');
  calls[0].d.resolve({decision: 'finished', latencyMs: 5}); await flush();
  assert.equal(h.log.sends.length, 0, 'a late complete for the earlier text never submits');
  await h.clock.advance(400); h.mic.onSpeechEnd(h.clock.now()); h.mic.onSegment('ten minutes'); await flush();
  await h.clock.advance(shortGapMs);
  assert.deepEqual(calls.map(call => call.text), ['set a timer for', 'set a timer for ten minutes']);
  // Muting finalizes and re-schedules the same utterance: the earlier call is replaced, not doubled.
  await h.session.setMuted(true); await flush();
  await h.clock.advance(shortGapMs);
  assert.equal(calls.filter(call => !call.signal.aborted).length, 1, 'at most one call in flight');
  calls.at(-1).d.resolve({decision: 'continue'}); await flush();
  calls[1].d.resolve({decision: 'finished'}); await flush();
  assert.equal(h.log.sends.length, 0, 'a superseded call is ignored');
  await h.clock.advance(longGapMs);
  assert.deepEqual(h.log.sends.map(send => send.text), ['set a timer for ten minutes']);
  assert.deepEqual(h.log.endpoints, [{by: 'gap', semantic: 'incomplete', latencyMs: 300}], 'no reported latency: the client round trip');
});

test('barge-in during inference cancels the request, drops its late reply and sends the new speech as the next turn after the first settles', async () => {
  const h = harness();
  await h.session.start();
  await h.say('book a table');
  await h.clock.advance(ASSISTANT_TIMING_DEFAULTS.longGapMs);
  assert.equal(h.log.sends.length, 1);
  const first = h.replies[0];
  // A cough: the segment closes before the hold and its transcript is filler, so the request continues.
  h.mic.onSpeechStart(h.clock.now()); await flush();
  await h.clock.advance(560); h.mic.onSpeechEnd(h.clock.now()); h.mic.onSegment(''); await flush();
  assert.equal(first.input.signal.aborted, false, 'noise does not cancel the request');
  assert.equal(h.phase(), 'thinking');
  // Held speech confirms the interruption before its transcript arrives.
  h.mic.onSpeechStart(h.clock.now()); await flush();
  assert.equal(first.input.signal.aborted, false, 'speech start alone is tentative');
  await h.clock.advance(ASSISTANT_TIMING_DEFAULTS.bargeInConfirmMs);
  assert.equal(first.input.signal.aborted, true, 'the in-flight request is cancelled');
  assert.deepEqual(h.log.turns.map(([event]) => event), ['submitted', 'interrupted']);
  await h.clock.advance(300); h.mic.onSpeechEnd(h.clock.now()); h.mic.onSegment('for four people'); await flush();
  await h.clock.advance(ASSISTANT_TIMING_DEFAULTS.longGapMs);
  assert.deepEqual(h.log.sends.map(send => send.text), ['book a table', 'for four people'], 'the earlier turn is never resent');
  assert.notEqual(h.log.sends[1].turnId, h.log.sends[0].turnId);
  // A reply racing in for the cancelled turn is never spoken.
  h.answer(0, 'Which restaurant?'); await flush();
  assert.equal(h.speeches.length, 0);
  h.answer(1, 'Booked for four.'); await flush();
  assert.equal(h.speeches.length, 1);
  assert.equal(h.speeches[0].input.text, 'Booked for four.');
});

test('barge-in during playback stops it and keeps only the sentences that finished playing', async () => {
  const h = harness();
  await h.session.start();
  await h.say('tell me about my day');
  await h.clock.advance(ASSISTANT_TIMING_DEFAULTS.longGapMs);
  h.answer(0, 'You have three meetings today. The first starts at nine with Priya. Then lunch with Sam at noon.'); await flush();
  assert.equal(h.speeches.length, 1);
  h.speeches[0].input.onStarted(); await flush();
  assert.equal(h.phase(), 'speaking');
  h.speeches[0].done.resolve(); await flush();
  assert.equal(h.speeches.length, 2);
  h.speeches[1].input.onStarted(); await flush();
  // The user talks over the second sentence: during playback only the transcript confirms, however
  // long the VAD stays open (residual echo can last a whole sentence).
  h.mic.onSpeechStart(h.clock.now()); await flush();
  assert.equal(h.speeches[1].input.signal.aborted, false, 'tentative until confirmed');
  await h.clock.advance(ASSISTANT_TIMING_DEFAULTS.bargeInConfirmMs * 2); h.mic.onSpeechEnd(h.clock.now()); await flush();
  assert.equal(h.speeches[1].input.signal.aborted, false);
  h.mic.onSegment('wait'); await flush();
  assert.equal(h.speeches[1].input.signal.aborted, true, 'playback is aborted once the speech is accepted');
  assert.equal(h.speeches.length, 2, 'no further sentence starts');
  assert.deepEqual(h.log.heard, [{turnId: h.log.sends[0].turnId, replyId: 'a-0', heard: 'You have three meetings today.', unheard: 'The first starts at nine with Priya. Then lunch with Sam at noon.', interrupted: true}]);
  assert.equal(h.phase(), 'listening');
  // A late playback callback from the interrupted reply changes nothing.
  h.speeches[1].input.onStarted(); await flush();
  assert.equal(h.phase(), 'listening');
});

test('Stop speaking interrupts like barge-in; a reply that plays to the end is heard in full', async () => {
  const h = harness();
  await h.session.start();
  await h.say('what time is it');
  await h.clock.advance(ASSISTANT_TIMING_DEFAULTS.longGapMs);
  h.answer(0, 'It is nine thirty in the morning.'); await flush();
  assert.equal(h.session.interruptSpeech(), false, 'nothing to stop before playback starts');
  h.speeches[0].input.onStarted(); await flush();
  assert.equal(h.session.interruptSpeech(), true);
  assert.equal(h.log.heard.at(-1).heard, '', 'the interrupted first sentence is not claimed as heard');
  assert.equal(h.log.heard.at(-1).interrupted, true);

  await h.say('and tomorrow');
  await h.clock.advance(ASSISTANT_TIMING_DEFAULTS.longGapMs);
  h.answer(1, 'Tomorrow is Thursday.'); await flush();
  h.speeches[1].input.onStarted(); h.speeches[1].done.resolve(); await flush();
  assert.deepEqual(h.log.heard.at(-1), {turnId: h.log.sends[1].turnId, replyId: 'a-1', heard: 'Tomorrow is Thursday.', unheard: '', interrupted: false});
  assert.deepEqual(h.log.turns.map(([event]) => event), ['submitted', 'first-audio', 'interrupted', 'submitted', 'first-audio', 'finished']);
});

test('echo of the reply heard while it plays is not sent as a turn', async () => {
  const echo = (text, context) => !(context.agentSpeaking || context.replyAgeMs < 9000) || !context.recentAgentReply.toLowerCase().includes(text.toLowerCase());
  const h = harness({shouldRespond: echo});
  await h.session.start();
  await h.say('read my reminder');
  await h.clock.advance(ASSISTANT_TIMING_DEFAULTS.longGapMs);
  h.answer(0, 'Your reminder says to water the plants before you leave.'); await flush();
  h.speeches[0].input.onStarted(); await flush();
  // The speaker leaks into the microphone: the VAD opens, the transcript is the reply itself.
  await h.say('water the plants');
  assert.equal(h.speeches[0].input.signal.aborted, false, 'echo never interrupts the reply');
  assert.equal(h.phase(), 'speaking');
  h.speeches[0].done.resolve(); await flush();
  await h.clock.advance(ASSISTANT_TIMING_DEFAULTS.longGapMs * 2);
  assert.equal(h.log.sends.length, 1, 'the echo is not sent as a turn');
  assert.equal(h.log.heard.at(-1).interrupted, false);
  assert.equal(h.phase(), 'listening');
});

test('without an active echo canceller, speech during playback is ignored; Stop speaking still interrupts', async () => {
  const h = harness({fullDuplex: false});
  await h.session.start();
  await h.say('what is the forecast');
  await h.clock.advance(ASSISTANT_TIMING_DEFAULTS.longGapMs);
  h.answer(0, 'Sunny with a light breeze all afternoon.'); await flush();
  h.speeches[0].input.onStarted(); await flush();
  h.mic.onSpeechStart(h.clock.now()); await flush();
  await h.clock.advance(ASSISTANT_TIMING_DEFAULTS.bargeInConfirmMs * 2);
  h.mic.onSpeechEnd(h.clock.now()); h.mic.onSegment('sunny with a light breeze'); await flush();
  assert.equal(h.speeches[0].input.signal.aborted, false);
  assert.equal(h.session.interruptSpeech(), true);
  await h.clock.advance(ASSISTANT_TIMING_DEFAULTS.longGapMs * 2);
  assert.equal(h.log.sends.length, 1, 'nothing heard during playback is sent');
});

test('Mute while the microphone is still opening closes it as soon as it opens', async () => {
  const holdOpen = deferred();
  const h = harness({holdOpen});
  const starting = h.session.start();
  await flush();
  const muting = h.session.setMuted(true);
  holdOpen.resolve(); await starting; await muting;
  assert.equal(h.log.closed, 1, 'the late capture is closed, not left streaming');
  assert.equal(h.session.muted, true);
  await h.session.setMuted(false);
  assert.equal(h.log.captures, 2);
});

test('account or binding change stops the conversation: capture cancelled, nothing sent, late callbacks ignored', async () => {
  const h = harness();
  await h.session.start();
  await h.say('send a message to');
  h.setCurrent(false);
  h.session.recheck(); await flush();
  assert.equal(h.phase(), 'idle');
  assert.equal(h.log.cancelled, 1, 'the capture is discarded, not finalized');
  // Late events from the old owner's capture and timers do nothing.
  h.mic.onSegment('Alex'); h.mic.onSpeechStart(h.clock.now());
  await h.clock.advance(ASSISTANT_TIMING_DEFAULTS.longGapMs * 3);
  assert.equal(h.log.sends.length, 0);

  // Mid-reply: the request is aborted and its reply never reaches the speaker.
  const g = harness();
  await g.session.start();
  await g.say('what is on my calendar');
  await g.clock.advance(ASSISTANT_TIMING_DEFAULTS.longGapMs);
  g.setCurrent(false);
  g.session.recheck(); await flush();
  assert.equal(g.replies[0].input.signal.aborted, true);
  g.answer(0, 'You are free all day.'); await flush();
  assert.equal(g.speeches.length, 0);
});

test('Stop discards an unsent utterance; Mute finalizes speech up to the mute and Unmute reopens the microphone', async () => {
  const h = harness();
  await h.session.start();
  await h.say('cancel my');
  await h.session.stop();
  await h.clock.advance(ASSISTANT_TIMING_DEFAULTS.longGapMs * 2);
  assert.equal(h.log.sends.length, 0, 'Stop never sends what was not submitted');

  const m = harness();
  await m.session.start();
  m.mic.onSpeechStart(m.clock.now()); await flush();
  const muting = m.session.setMuted(true);
  // The capture stops at the mute: its open segment is closed and its final delivered before close resolves.
  m.mic.onSpeechEnd(m.clock.now()); m.mic.onSegment('turn off the alarm');
  await muting;
  assert.equal(m.log.closed, 1);
  assert.equal(m.session.muted, true);
  await m.clock.advance(ASSISTANT_TIMING_DEFAULTS.longGapMs);
  assert.deepEqual(m.log.sends.map(send => send.text), ['turn off the alarm']);
  m.mic.onSpeechStart(m.clock.now()); await flush();
  assert.equal(m.replies[0].input.signal.aborted, false, 'a muted microphone cannot barge in');
  await m.session.setMuted(false);
  assert.equal(m.log.captures, 2);
});

test('an automatic voice turn never approves: a reply with proposals ends voice without speaking it', async () => {
  const h = harness();
  await h.session.start();
  await h.say('delete my dentist appointment');
  await h.clock.advance(ASSISTANT_TIMING_DEFAULTS.longGapMs);
  h.answer(0, 'Review the deletion below.', {complete: false}); await flush();
  assert.equal(h.speeches.length, 0);
  assert.equal(h.phase(), 'error');
  assert.equal(h.log.cancelled, 1, 'the microphone is released');
});

test('a Notes read-reply pause turns the microphone off until the exact approved result is resumed', async () => {
  const h = harness();
  await h.session.start();
  await h.say('summarize my packing note');
  await h.clock.advance(ASSISTANT_TIMING_DEFAULTS.longGapMs);
  h.answer(0, 'Share the note?', {complete: false, awaitingUserInput: {proposalId: 'p-1', digest: 'd-1'}}); await flush();
  const state = h.session.getSnapshot();
  assert.equal(state.phase, 'awaiting-user-input');
  assert.equal(h.log.cancelled, 1, 'microphone off while the owner reviews');
  const pause = state.awaitingUserInput;
  assert.equal(h.session.resume({pause: {...pause, digest: 'other'}, reply: {requestId: pause.requestId, conversationId: 'room-1', userMessageId: pause.userMessageId, assistantMessageId: 'a-2', text: 'x', complete: true}}), false);
  assert.equal(h.session.resume({pause, reply: {requestId: pause.requestId, conversationId: 'room-1', userMessageId: pause.userMessageId, assistantMessageId: 'a-2', text: 'Passport, charger and boots.', complete: true}}), true);
  await flush();
  assert.equal(h.log.captures, 2, 'listening resumes');
  assert.equal(h.speeches[0].input.text, 'Passport, charger and boots.');
});

test('sentence splitting keeps the reply text and avoids tiny fragments', () => {
  assert.deepEqual(splitSpokenSentences('  Dr. Smith is in. The visit is at 9:30 on Tuesday. Bring your card!  '), ['Dr. Smith is in. The visit is at 9:30 on Tuesday.', 'Bring your card!']);
  assert.deepEqual(splitSpokenSentences(''), []);
  const text = 'One sentence that is long enough. Another one that is long enough? Last.';
  assert.equal(splitSpokenSentences(text).join(' '), text);
  assert.throws(() => new VoiceAssistantSession({conversationId: 'r', assertCurrent() {}, listen: async () => ({close: async () => {}, cancel() {}}), send: async () => ({}), speak: async () => {}}, {timing: {shortGapMs: 900, longGapMs: 300}}), RangeError);
});

test('Final-only fallback: consecutive failed segments each yield one null, even when the next speech starts before the 502', async () => {
  const pending = [];
  const transport = {post: body => body.vad?.some(edge => edge.type === 'speech-end') ? new Promise((_, reject) => pending.push(() => reject(Object.assign(Error('Live ASR error'), {status: 502, data: {code: 'ASR_FAILED'}})))) : Promise.resolve({ok: true})};
  const results = [];
  const stream = createLiveSegmentStream({transport, onSegment: text => results.push(text)});
  void stream.accept([frame(1)], [{type: 'speech-start', timestampMs: 1}]);
  void stream.accept([frame(2)], [{type: 'speech-end', timestampMs: 2}]);
  await flush();
  void stream.accept([frame(3)], [{type: 'speech-start', timestampMs: 3}]);
  pending.shift()(); await flush();
  void stream.accept([frame(4)], [{type: 'speech-end', timestampMs: 4}]);
  await flush(); pending.shift()(); await flush();
  assert.deepEqual(results, [null, null]);
});

test('Stop cancels a muted capture that is still finalizing', async () => {
  const h = harness();
  await h.session.start();
  let cancels = 0;const closing = deferred();
  const capture = {fullDuplex: true, close: () => closing.promise, cancel: () => { cancels++; closing.resolve(); }};
  h.session.capture = capture;
  void h.session.setMuted(true); await flush();
  await h.session.stop();
  assert.equal(cancels, 1);
});

test('a failed turn reported by both its error event and its 502 response counts once', async () => {
  let listener;const results = [];
  const transport = {
    post: async body => body.vad?.some(edge => edge.type === 'speech-end') ? Promise.reject(Object.assign(Error('Live ASR error'), {status: 502, data: {code: 'ASR_FAILED'}})) : {ok: true},
    subscribe: fn => { listener = fn; return () => {}; },
  };
  const stream = createLiveSegmentStream({transport, onSegment: text => results.push(text)});
  const sessionId = stream.sessionId;
  await stream.accept([frame(1)], [{type: 'speech-start', timestampMs: 1}]);
  listener({type: 'agent_event', stream: 'voice-transcript', payload: {type: 'voice-transcript', sessionId, turnId: 't1', phase: 'speech-start'}});
  // The agent reports the failure as an event while the request that closed the segment is in flight.
  const closing = stream.accept([frame(2)], [{type: 'speech-end', timestampMs: 2}]);
  listener({type: 'agent_event', stream: 'voice-transcript', payload: {type: 'voice-transcript', sessionId, turnId: 't1', phase: 'error'}});
  await closing;
  await stream.accept([frame(3)], [{type: 'speech-start', timestampMs: 3}]);
  assert.deepEqual(results, [null], 'one null for the one failed segment');
});

// --- Live segment stream --------------------------------------------------------------------

function stubTransport() {
  const posts = [];let reply = () => ({ok: true, mode: 'stream', framesReceived: 0});let turn = 0;
  return {
    posts,
    set reply(fn) { reply = fn; },
    transport: {post: async body => { posts.push(structuredClone(body)); return reply(body, () => `t${++turn}`); }},
  };
}
const frame = timestamp => ({pcm16: 'AAAA', sampleRate: 16000, channels: 1, samples: 2, timestamp});
const finalOn = (body, next) => body.vad?.some(edge => edge.type === 'speech-end') ? {ok: true, mode: 'stream', framesReceived: 1, final: {turnId: next(), text: `heard ${body.frames?.length ?? 0} frames`, mode: 'stream', asrFinalFromSpeechEndMs: 20}} : {ok: true, mode: 'stream', framesReceived: 1};

test('stop reconciliation: frames after the stop are never forwarded and the open segment ends at the stop', async () => {
  const agent = stubTransport();agent.reply = finalOn;
  const segments = [], ends = [];
  const stream = createLiveSegmentStream({transport: agent.transport, onSegment: text => segments.push(text), onSpeechEnd: at => ends.push(at)});
  await stream.accept([frame(100), frame(132)], [{type: 'speech-start', timestampMs: 100}]);
  assert.equal(stream.speaking(), true);
  stream.cutoff(150);
  // In flight from the native thread: one frame before the stop, one after, and a late VAD edge.
  await stream.accept([frame(140), frame(170)], [{type: 'speech-end', timestampMs: 180}]);
  await stream.close();
  assert.deepEqual(ends, [150], 'the open segment closes at the stop');
  const forwarded = agent.posts.flatMap(body => body.frames ?? []).map(f => f.timestamp);
  assert.deepEqual(forwarded, [100, 132, 140]);
  assert.equal(agent.posts.find(body => body.vad?.some(edge => edge.type === 'speech-end')).vad[0].timestampMs, 150, 'the closing edge carries the stop time');
  assert.equal(segments.length, 1, 'the final arrives before close resolves');
  assert.equal(agent.posts.at(-1).close, true, 'the agent session is released');
  assert.equal(agent.posts.filter(body => body.vad?.some(edge => edge.type === 'speech-end')).length, 1);
});

test('a 502 ASR_FAILED segment yields null and the stream continues; a bare 502 is a transport failure', async () => {
  const agent = stubTransport();let failNext = true;
  agent.reply = (body, next) => {
    if (!body.vad?.some(edge => edge.type === 'speech-end')) return {ok: true, mode: 'stream', framesReceived: 1};
    if (failNext) { failNext = false; return Promise.reject(Object.assign(Error('Live ASR error'), {status: 502, data: {code: 'ASR_FAILED'}})); }
    return finalOn(body, next);
  };
  const segments = [], fatal = [];
  const stream = createLiveSegmentStream({transport: agent.transport, onSegment: text => segments.push(text), onFatal: code => fatal.push(code)});
  await stream.accept([frame(1)], [{type: 'speech-start', timestampMs: 1}]);
  await stream.accept([frame(2)], [{type: 'speech-end', timestampMs: 2}]);
  await stream.accept([frame(3)], [{type: 'speech-start', timestampMs: 3}]);
  await stream.accept([frame(4)], [{type: 'speech-end', timestampMs: 4}]);
  assert.deepEqual(segments, [null, 'heard 1 frames']);
  assert.deepEqual(fatal, []);
  // A 502 without the route's code is a transport failure.
  agent.reply = body => body.vad?.some(edge => edge.type === 'speech-end') ? Promise.reject(Object.assign(Error('bad gateway'), {status: 502})) : {ok: true};
  await stream.accept([frame(5)], [{type: 'speech-start', timestampMs: 5}]);
  await stream.accept([frame(6)], [{type: 'speech-end', timestampMs: 6}]);
  assert.deepEqual(fatal, ['TRANSPORT']);
});

test('one result per closed segment: an unavailable route (503) is fatal after a null result, cancel discards', async () => {
  const agent = stubTransport();
  agent.reply = (body, next) => body.vad?.some(edge => edge.type === 'speech-end') ? Promise.reject(Object.assign(Error('down'), {status: 503})) : {ok: true, mode: 'stream', framesReceived: 1};
  const segments = [], fatal = [];
  const stream = createLiveSegmentStream({transport: agent.transport, onSegment: text => segments.push(text), onFatal: code => fatal.push(code)});
  await stream.accept([frame(1)], [{type: 'speech-start', timestampMs: 1}]);
  await stream.accept([frame(2)], [{type: 'speech-end', timestampMs: 2}]);
  assert.deepEqual(segments, [null]);
  assert.deepEqual(fatal, ['LIVE_ASR_UNAVAILABLE']);

  const quiet = stubTransport();quiet.reply = finalOn;
  const results = [];
  const discarded = createLiveSegmentStream({transport: quiet.transport, onSegment: text => results.push(text)});
  await discarded.accept([frame(1)], [{type: 'speech-start', timestampMs: 1}]);
  discarded.cancel();
  await discarded.accept([frame(2)], [{type: 'speech-end', timestampMs: 2}]);
  await flush();
  assert.deepEqual(results, [], 'nothing is delivered after cancel');
  assert.ok(quiet.posts.every(body => !(body.frames ?? []).some(f => f.timestamp === 2)), 'audio after cancel is never forwarded');
});

test('sources: no Web Speech, storage or logging in the assistant path; the adapter keeps dictation separate behind one chat voice launcher', () => {
  const files = ['apps/app/src/runtime/voice-assistant.ts', '.eliza/client-features/packages/voice/src/voice-assistant-session.ts', 'apps/app/src/runtime/live-segment-stream.ts', '.eliza/client-features/packages/voice/src/live-voice-session.ts', 'apps/app/src/runtime/voice-turn-routes.ts', '.eliza/client-features/packages/voice/src/voice-turn-routes.ts', 'apps/app/src/runtime/native-live-voice.ts'];
  for (const file of files) {
    const source = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    assert.doesNotMatch(source, /console\.|localStorage|sessionStorage|indexedDB|speechSynthesis|SpeechRecognition|onnx/i, file);
  }
  const adapter = fs.readFileSync(new URL('../apps/app/src/prototype/voice-adapter.ts', import.meta.url), 'utf8');
  // Dictation (Transcribe) uses the live capture without echo cancellation and only fills an editable draft.
  assert.match(adapter, /chat\?\.mode === 'dictation' && await nativeLiveVoiceReady/);
  assert.match(adapter, /liveDictation = createNativeLiveDictation\(/);
  // The assistant uses its own controller and the same send policy boundary as the recorded loop.
  assert.match(adapter, /new VoiceAssistantSession\(\{/);
  const native = fs.readFileSync(new URL('../apps/app/src/runtime/native-live-voice.ts', import.meta.url), 'utf8');
  assert.match(native, /nativeAssistantListener[\s\S]{0,300}return voice\.assistantListener\(options\)/);
  assert.match(native, /createNativeLiveDictation[\s\S]{0,300}return voice\.dictation\(options\)/);
  // The shared native transport hands its own opener to the shared listen and dictation adapters.
  const nativeShared = fs.readFileSync(new URL('../vendor/eliza/packages/voice/src/native-live-voice.ts', import.meta.url), 'utf8');
  assert.match(nativeShared, /return liveAssistantListener\(open, listen\)/);
  assert.match(nativeShared, /return createLiveDictation\(open, dictate\)/);
  // The shared adapters fix the echo-cancellation choice: the assistant cancels its own speaker, dictation does not.
  const shared = fs.readFileSync(new URL('../vendor/eliza/packages/voice/src/live-voice-session.ts', import.meta.url), 'utf8');
  assert.match(shared, /export function liveAssistantListener[\s\S]{0,500}echoCancel: true/);
  assert.match(shared, /export function createLiveDictation[\s\S]{0,2500}echoCancel: false/);
  const template = fs.readFileSync(new URL('../apps/app/src/prototype/template.html', import.meta.url), 'utf8');
  assert.doesNotMatch(template, /aria-label="Transcribe" title="Transcribe into draft"/);
  assert.match(template, /title="Voice assistant" aria-label="Talk" onPointerDown="\{\{chatControlPointer\}\}" onClick="\{\{startVoice\}\}"/);
  // Voice controls are Mute and Stop only; there is no Stop speaking button.
  assert.doesNotMatch(template, /canInterrupt|Stop speaking/);
  assert.match(template, /aria-pressed="\{\{chatRecorder\.muted\}\}"/);
});

test('the capture source policy picks the echo-cancelled source only for full duplex with a canceller (host JVM)', async () => {
  const {runJvm, upstreamVoiceFixture, upstreamVoiceSource} = await import('./fixtures/jvm-tools.mjs');
  assert.match(runJvm([upstreamVoiceSource('LiveCaptureSource.java'), upstreamVoiceFixture('LiveCaptureSourceTest.java')], 'ai.eliza.voice.LiveCaptureSourceTest'), /^PASS live capture source/);
  const capture = fs.readFileSync(upstreamVoiceSource('LiveVoiceCapture.java'), 'utf8');
  assert.match(capture, /LiveCaptureSource\.select\(echoCancel,AcousticEchoCanceler\.isAvailable\(\)/);
  assert.match(capture, /if\(frames\.length\(\)>0\|\|edges\.length\(\)>0\)sink\.frames/, 'the stop flushes the last frames read before it');
});
