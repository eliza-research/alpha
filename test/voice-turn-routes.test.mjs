import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The resident's end-of-turn (elizaOS #36546) and heard (#36547) routes as the voice assistant
// uses them (apps/app/src/runtime/voice-turn-routes.ts, #423). Fake request ports only: this is
// decision and accounting evidence, not scorer, model or device evidence.
const store = new Map();
globalThis.localStorage = {getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k)};
const routes = await import('../apps/app/src/runtime/voice-turn-routes.ts');
const {VoiceAssistantSession} = await import('../apps/app/src/runtime/voice-assistant.ts');
const timing = await import('../apps/app/src/runtime/voice-timing.ts');
const {buildDiagnostics} = await import('../apps/app/src/runtime/diagnostics-export.ts');

const conversationId = 'room-1';
const replyId = '11111111-1111-4111-8111-111111111111';
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const failure = status => Object.assign(Error(`Local agent request failed (HTTP ${status}).`), {status, data: {error: 'x'}});

test('end-of-turn responses: only available+complete finishes; every unavailable or malformed shape is unavailable', () => {
  const {readEndOfTurn} = routes;
  assert.deepEqual(readEndOfTurn({available: true, endOfTurnProbability: 0.9, complete: true, commitThreshold: 0.7, nextSpeaker: 'agent', source: 'eliza-1-drafter', model: 'm', latencyMs: 33.4}), {decision: 'finished', latencyMs: 33});
  assert.deepEqual(readEndOfTurn({available: true, endOfTurnProbability: 0.1, complete: false, commitThreshold: 0.7, nextSpeaker: 'user', source: 'heuristic', model: null, latencyMs: 8}), {decision: 'continue', latencyMs: 8});
  assert.deepEqual(readEndOfTurn({available: false, reason: 'ram-pressure'}), {decision: 'unavailable', reason: 'ram-pressure'});
  assert.deepEqual(readEndOfTurn({available: false, reason: 'something new'}), {decision: 'unavailable', reason: 'unknown'});
  for (const value of [null, [], 'complete', {complete: true}, {available: true}, {available: true, complete: 'yes'}, {available: 'true', complete: true}])
    assert.equal(readEndOfTurn(value).decision, 'unavailable', JSON.stringify(value));
});

test('the endpoint port posts the trimmed transcript to the pinned path, refuses over-long text and rejects on a scoring error', async () => {
  const calls = [];
  const port = routes.residentEndpoint(() => (path, body) => { calls.push([path, body]); return Promise.resolve({available: true, complete: true, latencyMs: 2}); });
  assert.deepEqual(await port('  what  time is it ', new AbortController().signal), {decision: 'finished', latencyMs: 2});
  assert.deepEqual(calls, [['/api/asr/local-inference/end-of-turn', {transcript: 'what time is it'}]]);
  assert.deepEqual(await port('a'.repeat(4097), new AbortController().signal), {decision: 'unavailable', reason: 'too-long'});
  assert.equal(calls.length, 1);
  assert.deepEqual(await routes.residentEndpoint(() => null)('hello', new AbortController().signal), {decision: 'unavailable', reason: 'unknown'});
  await assert.rejects(routes.residentEndpoint(() => () => Promise.reject(failure(502)))('hello', new AbortController().signal), /502/);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(port('hello', aborted.signal));
});

function reporter(responses, options = {}) {
  const calls = [], timers = [];
  let current = true;
  const ports = {
    request: () => (path, body) => { calls.push({path, body}); const next = responses.shift(); return typeof next === 'number' ? Promise.reject(failure(next)) : Promise.resolve(next ?? {ok: true, messageId: replyId, text: body.heardText, truncated: true, changed: true}); },
    current: id => current && id === conversationId,
    isAssistantReply: (id, message) => id === conversationId && (options.assistant ?? [replyId]).includes(message),
    onOutcome: (outcome, detail) => outcomes.push([outcome, detail]),
    setTimer: (callback, ms) => { timers.push(ms); callback(); },
    retryDelayMs: 1500,
  };
  const outcomes = [];
  return {calls, timers, outcomes, setCurrent: value => { current = value; }, heard: routes.createHeardReporter(ports)};
}
const interrupted = (extra = {}) => ({conversationId, replyId, heard: 'You have two meetings today.', unheard: 'The first one starts at nine.', interrupted: true, ...extra});

test('heard reporting: the exact played prefix goes to the reply of this conversation once', async () => {
  const r = reporter([]);
  assert.equal(await r.heard.report(interrupted()), 'recorded');
  assert.deepEqual(r.calls, [{path: `/api/conversations/room-1/messages/${replyId}/heard`, body: {heardText: 'You have two meetings today.'}}]);
  assert.deepEqual(r.outcomes, [['recorded', {attempts: 1, status: 200}]]);
  assert.equal(await r.heard.report(interrupted()), 'unchanged', 'a second report for the same reply is not sent');
  assert.equal(r.calls.length, 1);
  const idempotent = reporter([{ok: true, messageId: replyId, text: 'x', truncated: true, changed: false}]);
  assert.equal(await idempotent.heard.report(interrupted()), 'unchanged');
});

test('heard reporting: nothing is sent when the reply was fully heard, not interrupted or unheard text is empty', async () => {
  const r = reporter([]);
  assert.equal(await r.heard.report(interrupted({interrupted: false, unheard: ''})), 'not-needed');
  assert.equal(await r.heard.report(interrupted({unheard: '  '})), 'not-needed');
  assert.deepEqual(r.calls, []);
});

test('heard reporting: a reply interrupted before any of it played is recorded as nothing heard', async () => {
  const r = reporter([{ok: true, messageId: replyId, text: '', truncated: true, changed: true}]);
  assert.equal(await r.heard.report(interrupted({heard: '', unheard: 'All of it.'})), 'recorded');
  assert.deepEqual(r.calls, [{path: `/api/conversations/room-1/messages/${replyId}/heard`, body: {nothingHeard: true}}]);
  assert.deepEqual(r.outcomes, [['recorded', {attempts: 1, status: 200}]]);
  // An agent that predates the explicit report refuses it; the view stays marked.
  const older = reporter([400]);
  assert.equal(await older.heard.report(interrupted({heard: '', unheard: 'All of it.'})), 'rejected');
});

test('heard reporting: a playback failure before any sentence finished never empties the reply', async () => {
  const r = reporter([]);
  assert.equal(await r.heard.report(interrupted({heard: '', unheard: 'All of it.', playbackFailed: true})), 'nothing-heard');
  assert.deepEqual(r.calls, [], 'a speech failure is not a barge-in: nothing is sent');
  assert.deepEqual(r.outcomes, [['nothing-heard', {attempts: 0}]]);
  const adapter = fs.readFileSync(new URL('../apps/app/src/prototype/voice-adapter.ts', import.meta.url), 'utf8');
  assert.match(adapter, /interrupted:true,\.\.\.\(failed\?\{playbackFailed:true\}:\{\}\)\}\)/);
  assert.match(adapter, /if\(failed&&!heard\.heard\)return;/, 'the view keeps the reply text too');
});

test('heard reporting: only assistant replies of the current conversation, and nothing after the binding changed', async () => {
  const r = reporter([]);
  assert.equal(await r.heard.report(interrupted({conversationId: 'room-2'})), 'invalid');
  assert.equal(await r.heard.report(interrupted({replyId: '22222222-2222-4222-8222-222222222222'})), 'invalid', 'not an assistant reply in this view');
  assert.equal(await r.heard.report(interrupted({replyId: 'not-a-uuid'})), 'invalid');
  r.setCurrent(false);
  assert.equal(await r.heard.report(interrupted()), 'stale');
  assert.deepEqual(r.calls, []);
});

test('heard reporting: 409 is a conflict without retry; 404 and 503 retry once later; 400 is rejected', async () => {
  const conflict = reporter([409]);
  assert.equal(await conflict.heard.report(interrupted()), 'conflict');
  assert.equal(conflict.calls.length, 1);
  assert.deepEqual(conflict.timers, []);

  const missing = reporter([404, 404]);
  assert.equal(await missing.heard.report(interrupted()), 'not-found');
  assert.equal(missing.calls.length, 2, 'retried exactly once');
  assert.deepEqual(missing.timers, [1500]);
  assert.deepEqual(missing.outcomes, [['not-found', {attempts: 2, status: 404}]]);

  const restarting = reporter([503]);
  assert.equal(await restarting.heard.report(interrupted()), 'recorded', 'the retry lands');
  assert.equal(restarting.calls.length, 2);

  const down = reporter([503, 503]);
  assert.equal(await down.heard.report(interrupted()), 'unavailable');

  const bad = reporter([400]);
  assert.equal(await bad.heard.report(interrupted()), 'rejected');
  assert.equal(bad.calls.length, 1);

  // The binding changed before the retry: dropped.
  const late = reporter([404]);
  late.heard = routes.createHeardReporter({request: () => () => Promise.reject(failure(404)), current: () => !late.dropped, isAssistantReply: () => true, setTimer: callback => { late.dropped = true; callback(); }});
  assert.equal(await late.heard.report(interrupted()), 'stale');
});

test('heard reporting does not block the next turn after explicit Stop speaking and settled playback drain', async () => {
  let now = 0;
  const timers = new Map(); let id = 0;
  const clock = {now: () => now, setTimer: (callback, ms) => { timers.set(++id, {at: now + ms, callback}); return id; }, clearTimer: handle => timers.delete(handle)};
  const advance = async ms => { const end = now + ms; for (;;) { const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; timers.delete(next[0]); now = next[1].at; next[1].callback(); await flush(); } now = end; await flush(); };
  const requests = [];
  let release, heardSettled = false;
  const heardRoute = new Promise(resolve => { release = value => { heardSettled = true; resolve(value); }; });
  const heard = routes.createHeardReporter({
    request: () => (path, body) => { requests.push({path, body}); return heardRoute; },
    current: () => true, isAssistantReply: (c, m) => c === conversationId && m === replyId,
  });
  const sends = [], sentIds = [], speeches = [], captures = [], heardEvents = [];
  let mic, activeCaptures = 0;
  const session = new VoiceAssistantSession({
    conversationId, assertCurrent() {},
    listen: async handlers => {
      mic = handlers; const capture = {active: true}; captures.push(capture); activeCaptures++;
      const retire = () => { if (capture.active) { capture.active = false; activeCaptures--; } };
      return {fullDuplex: true, close: async () => retire(), cancel: retire};
    },
    send: input => {
      sends.push(input.text); sentIds.push(input.turnId);
      return sends.length === 1
        ? Promise.resolve({requestId: input.turnId, conversationId, userMessageId: 'u-1', assistantMessageId: replyId, text: 'You have two meetings today. The first one starts at nine.', complete: true})
        : new Promise((resolve, reject) => input.signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), {once: true}));
    },
    // Abort requests stopping immediately; only this explicit resolver proves playback drained.
    speak: input => new Promise(resolve => { speeches.push({input, resolve}); input.onStarted(); }),
    onHeard: value => { heardEvents.push(value); void heard.report({conversationId, ...value}); },
  }, {clock});
  await session.start();
  const say = async text => { mic.onSpeechStart(now); await advance(400); mic.onSpeechEnd(now); mic.onSegment(text); await flush(); };
  await say('what is on my calendar');
  const retired = mic;
  await advance(1200);
  speeches[0].resolve(); await flush();
  assert.equal(speeches.length, 2, 'the second sentence is playing');
  assert.equal(activeCaptures, 0);
  assert.equal(session.interruptSpeech(), true);
  assert.equal(speeches[1].input.signal.aborted, true);
  assert.deepEqual(requests, [{path: `/api/conversations/room-1/messages/${replyId}/heard`, body: {heardText: 'You have two meetings today.'}}]);
  assert.deepEqual(heardEvents, [{turnId: sentIds[0], replyId, heard: 'You have two meetings today.', unheard: 'The first one starts at nine.', interrupted: true}]);
  retired.onSpeechStart(now); retired.onSpeechEnd(now); retired.onSegment('ignored while playback drains');
  await advance(1200);
  assert.equal(sends.length, 1, 'a retired handle cannot queue a next turn during drain');
  assert.equal(captures.length, 1);
  assert.equal(activeCaptures, 0);
  assert.equal(session.getSnapshot().inputHeld, true);
  speeches[1].resolve(); await flush();
  assert.equal(captures.length, 2);
  assert.equal(activeCaptures, 1);
  assert.equal(requests.length, 1, 'late playback settlement does not duplicate heard reporting');
  await say('and tomorrow');
  await advance(1200);
  assert.deepEqual(sends, ['what is on my calendar', 'and tomorrow'], 'the next turn is sent while the heard request is still pending');
  assert.notEqual(sentIds[1], sentIds[0]);
  assert.equal(heardSettled, false, 'report I/O is not the microphone or request drain gate');
  release({ok: true, messageId: replyId, text: 'You have two meetings today.', truncated: true, changed: true});
  await session.stop();
  assert.equal(activeCaptures, 0);
});

test('voice timing and diagnostics keep the endpoint path and heard outcome as enums only', () => {
  timing.clearVoiceTiming();
  const id = timing.beginVoiceTurn({route: 'local-agent', cold: false, entry: 'conversation'});
  assert.equal(timing.recordEndpointVoiceTiming({by: 'semantic', semantic: 'complete', latencyMs: 41}), true);
  assert.equal(timing.recordEndpointVoiceTiming({by: 'gap', semantic: 'timeout'}), false, 'first record wins');
  timing.finishVoiceTurn();
  assert.equal(timing.recordHeardVoiceTiming(id, 'conflict'), true, 'a finished turn still takes its heard outcome');
  assert.equal(timing.recordHeardVoiceTiming(id, 'recorded'), false);
  assert.equal(timing.recordHeardVoiceTiming(id, 'You have two meetings'), false, 'text is never an outcome');
  const second = timing.beginVoiceTurn({route: 'local-agent', cold: false, entry: 'conversation'});
  assert.equal(timing.recordEndpointVoiceTiming({by: 'semantic', semantic: 'incomplete'}), false, 'only complete submits by the semantic path');
  assert.equal(timing.recordEndpointVoiceTiming({by: 'gap', semantic: 'unavailable', reason: 'call mom'}), false, 'reasons are an allowlist');
  assert.equal(timing.recordEndpointVoiceTiming({by: 'gap', semantic: 'unavailable', reason: 'voice-not-started'}), true);
  const rows = timing.voiceTimingRecords();
  assert.deepEqual(rows.find(row => row.id === id).endpoint, {by: 'semantic', semantic: 'complete', latencyMs: 41});
  assert.equal(rows.find(row => row.id === id).heard, 'conflict');
  assert.deepEqual(rows.find(row => row.id === second).endpoint, {by: 'gap', semantic: 'unavailable', reason: 'voice-not-started'});
  const report = buildDiagnostics({voiceTiming: JSON.parse(timing.exportVoiceTiming())});
  const exported = report.voiceTiming.records.find(row => row.id === id);
  assert.deepEqual(exported.endpoint, {by: 'semantic', semantic: 'complete', latencyMs: 41});
  assert.equal(exported.heard, 'conflict');
});

test('the end-of-turn chain keeps Clef off: the local scorer decides, and its path is kept as an enum', async () => {
  const {stripTypeScriptTypes} = await import('node:module'), vm = await import('node:vm');
  const source = fs.readFileSync(new URL('../apps/app/src/runtime/voice-selection.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replaceAll('export function', 'function').replaceAll('export type', 'type');
  const box = {cloudRuntimeEnabled: false, testMocksEnabled: true, browserDevProfile: false, connectionController: {}};
  vm.runInNewContext('{' + stripTypeScriptTypes(source, {mode: 'transform'}) + '\nglobalThis.selection={clefEndpointStage};}', box);
  const selection = box.selection;
  assert.deepEqual(JSON.parse(JSON.stringify(selection.clefEndpointStage())), {enabled: false, client: null});
  assert.equal(routes.clefEndpointStageEnabled(selection.clefEndpointStage()), false);
  const asked = [];
  const chain = routes.createEndpointChain({local: routes.residentEndpoint(() => (path, body) => { asked.push(path); return Promise.resolve({available: false, reason: 'ram-pressure'}); }), clef: selection.clefEndpointStage()});
  assert.deepEqual(await chain('turn off the lights', new AbortController().signal), {decision: 'unavailable', reason: 'ram-pressure', path: 'local'});
  assert.deepEqual(asked, ['/api/asr/local-inference/end-of-turn'], 'only the resident is asked; no text goes to Cloud');
  timing.clearVoiceTiming();
  const id = timing.beginVoiceTurn({route: 'local-agent', cold: false, entry: 'conversation'});
  assert.equal(timing.recordEndpointVoiceTiming({by: 'semantic', semantic: 'complete', latencyMs: 30, path: 'clef'}), true);
  const later = timing.beginVoiceTurn({route: 'local-agent', cold: false, entry: 'conversation'});
  assert.equal(timing.recordEndpointVoiceTiming({by: 'gap', semantic: 'unavailable', reason: 'clef-timeout', path: 'clef'}), true);
  const report = buildDiagnostics({voiceTiming: JSON.parse(timing.exportVoiceTiming())});
  assert.deepEqual(report.voiceTiming.records.find(row => row.id === id).endpoint, {by: 'semantic', semantic: 'complete', latencyMs: 30, path: 'clef'});
  assert.deepEqual(report.voiceTiming.records.find(row => row.id === later).endpoint, {by: 'gap', semantic: 'unavailable', reason: 'clef-timeout', path: 'clef'});
  // Diagnostics copies only allowlisted enums.
  const forged = buildDiagnostics({voiceTiming: {format: 'alpha-voice-timing-v1', records: [{version: 1, id, recordedAt: 1, route: 'local-agent', cold: false, entry: 'conversation', marks: {}, endpoint: {by: 'gap', semantic: 'timeout', path: 'cloud-text', reason: 'clef-says-yes'}}]}});
  assert.deepEqual(forged.voiceTiming.records[0].endpoint, {by: 'gap', semantic: 'timeout'});
});

test('sources: the adapter wires the endpoint and heard routes through the resident binding; Android allows exactly these routes', () => {
  const adapter = fs.readFileSync(new URL('../apps/app/src/prototype/voice-adapter.ts', import.meta.url), 'utf8');
  assert.match(adapter, /\.\.\.\(streamingCloud\?\{\}:\{endpoint:\(text:string,signal:AbortSignal\)=>\{current\(\);return semanticEndpoint!\(text,signal\);\}\}\)/);
  // The chain: the resident's fused scorer, then Clef only through the #663 switch.
  assert.match(adapter, /const semanticEndpoint=streamingCloud\?undefined:createEndpointChain\(\{local:residentEndpoint\(residentRequest\),clef:clefEndpointStage\(\)\}\)!;/);
  assert.match(adapter, /connectionController\.voiceConversationCurrent\(binding,false\)/);
  assert.match(adapter, /heardReporter\.report\(/);
  const plugin = fs.readFileSync(new URL('../android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java', import.meta.url), 'utf8');
  const line = plugin.split('\n').find(row => row.includes('Unsupported local agent request') === false && row.includes('path.matches("^/api/(auth/me'));
  const pattern = new RegExp(/path\.matches\("(.*?)"\)/.exec(line)[1].replace(/\\\\/g, '\\'));
  assert.equal(pattern.test('/api/asr/local-inference/end-of-turn'), true);
  assert.equal(pattern.test(`/api/conversations/room-1/messages/${replyId}/heard`), true);
  assert.equal(pattern.test('/api/conversations/room-1/messages/not-a-uuid/heard'), false);
  assert.equal(pattern.test('/api/asr/local-inference/end-of-turn/x'), false);
  assert.match(line, /path\.endsWith\("\/heard"\)\)&&\(!method\.equals\("POST"\)\|\|expectedOwner==null/);
  assert.match(line, /path\.equals\("\/api\/asr\/local-inference\/end-of-turn"\)&&!method\.equals\("POST"\)/);
});
