import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Live voice client contract (apps/app/src/runtime/live-voice.ts) against a stub agent that speaks
// the upstream wire format of POST /api/asr/local-inference/live and the ephemeral
// voice-transcript agent_event stream (elizaOS #36213, #36214).
const live = await import('../apps/app/src/runtime/live-voice.ts');
const store = new Map();
globalThis.localStorage = {getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k)};
const timing = await import('../apps/app/src/runtime/voice-timing.ts');
const {buildDiagnostics} = await import('../apps/app/src/runtime/diagnostics-export.ts');

function stubAgent() {
  const posts = [];let listener;let reply = () => ({ok: true, mode: 'stream', framesReceived: 0});
  return {
    posts,
    set reply(fn) { reply = fn; },
    transport: {
      post: async body => { posts.push(structuredClone(body)); return reply(body); },
      subscribe: fn => { listener = fn; return () => { listener = undefined; }; },
    },
    emit: payload => listener?.({type: 'agent_event', version: 1, ephemeral: true, eventId: 'eph-1', stream: 'voice-transcript', ts: 1, runId: 'r', seq: 1, payload: {type: 'voice-transcript', ...payload}}),
    get subscribed() { return listener !== undefined; },
  };
}
const frame = (timestamp = 1) => live.encodeLiveFrame(new Float32Array(512).fill(0.1), timestamp);

test('frames and VAD edges reach the live route in order, with the upstream frame wire format', async () => {
  const agent = stubAgent();
  const session = live.createLiveVoiceSession({transport: agent.transport, roomId: 'room-1'});
  assert.match(session.sessionId, /^live-/);assert.ok(session.sessionId.length <= 128);
  await session.push([frame(1), frame(2)], [{type: 'speech-start', timestampMs: 1}]);
  await session.push([frame(3)], [{type: 'speech-end', timestampMs: 3}]);
  assert.equal(agent.posts.length, 2);
  assert.deepEqual(agent.posts.map(body => body.vad?.[0]?.type), ['speech-start', 'speech-end']);
  for (const body of agent.posts) { assert.equal(body.sessionId, session.sessionId); assert.equal(body.roomId, 'room-1'); }
  const [first] = agent.posts[0].frames;
  assert.deepEqual([first.sampleRate, first.channels, first.samples], [16000, 1, 512]);
  assert.equal(Buffer.from(first.pcm16, 'base64').length, 1024, 'LE s16, 2 bytes per sample');
  assert.equal(Buffer.from(first.pcm16, 'base64').readInt16LE(0), Math.round(0.1 * 32767));
  session.dispose();
  assert.equal(agent.subscribed, false, 'dispose unsubscribes from the event stream');
});

test('partials replace the interim text, stale turns and other sessions are dropped, the final is delivered once', async () => {
  const agent = stubAgent();let now = 1000;
  const interim = [], finals = [];
  const session = live.createLiveVoiceSession({transport: agent.transport, now: () => now, onInterim: text => interim.push(text), onFinal: (final, latency) => finals.push({final, latency})});
  const sessionId = session.sessionId;
  await session.push([frame()], [{type: 'speech-start', timestampMs: 1}]);
  agent.emit({sessionId, turnId: 't1', phase: 'speech-start'});
  now = 1180;agent.emit({sessionId, turnId: 't1', phase: 'partial', text: 'remind me', seq: 1});
  agent.emit({sessionId, turnId: 't1', phase: 'partial', text: 'remind me to', seq: 2});
  agent.emit({sessionId, turnId: 't1', phase: 'partial', text: 'stale seq', seq: 2});
  agent.emit({sessionId, turnId: 't0', phase: 'partial', text: 'old turn', seq: 9});
  agent.emit({sessionId: 'someone-else', turnId: 't1', phase: 'partial', text: 'not ours', seq: 3});
  assert.deepEqual(interim, ['remind me', 'remind me to'], 'full running text, never a delta or a stale turn');
  assert.equal(session.interim(), 'remind me to');
  now = 2000;
  agent.reply = () => ({ok: true, mode: 'stream', framesReceived: 3, final: {turnId: 't1', text: ' remind me to call Sam ', mode: 'stream', asrFinalFromSpeechEndMs: 140}});
  await session.push([frame()], [{type: 'speech-end', timestampMs: 2}]);
  now = 2170;
  agent.emit({sessionId, turnId: 't1', phase: 'final', text: 'remind me to call Sam', mode: 'stream', asrFinalFromSpeechEndMs: 140});
  agent.emit({sessionId, turnId: 't1', phase: 'partial', text: 'late partial', seq: 5});
  assert.equal(finals.length, 1, 'HTTP and event finals for one turn are delivered once');
  assert.equal(finals[0].final.text, 'remind me to call Sam');
  assert.deepEqual(finals[0].latency, {mode: 'stream', partials: 2, firstPartialMs: 180, finalFromSpeechEndMs: 0, asrFinalFromSpeechEndMs: 140});
  assert.equal(interim.at(-1), '', 'the interim text clears when the final lands');
  assert.equal(session.interim(), '');
  // The next turn starts clean.
  agent.emit({sessionId, turnId: 't2', phase: 'speech-start'});
  agent.emit({sessionId, turnId: 't2', phase: 'partial', text: 'and', seq: 1});
  assert.equal(session.interim(), 'and');
  agent.emit({sessionId, turnId: 't2', phase: 'error', code: 'ASR_FAILED'});
  assert.equal(session.interim(), '');
  session.dispose();
});

test('a transport without an event stream: the final comes from the HTTP response alone', async () => {
  const posts = [];
  const session = live.createLiveVoiceSession({transport: {post: async body => { posts.push(body); return body.vad?.[0]?.type === 'speech-end' ? {ok: true, mode: 'batch', framesReceived: 2, final: {turnId: 'turn-a', text: 'hello', mode: 'batch', asrFinalFromSpeechEndMs: 300}} : {ok: true, mode: 'batch', framesReceived: 1}; }}});
  const next = session.nextFinal();
  await session.push([frame()], [{type: 'speech-start', timestampMs: 1}]);
  await session.push([frame()], [{type: 'speech-end', timestampMs: 2}]);
  assert.deepEqual(await next, {turnId: 'turn-a', text: 'hello', mode: 'batch', asrFinalFromSpeechEndMs: 300});
  await session.close();
  assert.equal(posts.at(-1).close, true, 'close finalizes and releases the agent session');
  assert.equal(await session.nextFinal(), null, 'a closed session answers nothing');
});

test('an unavailable live route and transport failures settle the waiting turn without text', async () => {
  const errors = [];
  const session = live.createLiveVoiceSession({transport: {post: async () => { throw Object.assign(Error('HTTP 503'), {status: 503}); }}, onError: code => errors.push(code)});
  const next = session.nextFinal();
  await session.push([frame()], [{type: 'speech-start', timestampMs: 1}]);
  assert.equal(await next, null);
  assert.deepEqual(errors, ['LIVE_ASR_UNAVAILABLE']);
  session.dispose();
});

test('malformed envelopes and finals are ignored', () => {
  const id = 'live-x';
  assert.equal(live.parseVoiceTranscriptEnvelope({type: 'agent_event', stream: 'voice-control', payload: {}}, id), undefined);
  assert.equal(live.parseVoiceTranscriptEnvelope({type: 'agent_event', stream: 'voice-transcript', payload: {type: 'voice-transcript', sessionId: id, turnId: 't', phase: 'partial', text: 'x', seq: 0}}, id), undefined);
  assert.equal(live.parseVoiceTranscriptEnvelope({type: 'agent_event', stream: 'voice-transcript', payload: {type: 'voice-transcript', sessionId: id, turnId: 't', phase: 'partial', text: 'x'.repeat(16001), seq: 1}}, id), undefined);
  assert.equal(live.parseLiveFinal({turnId: '', text: 'x'}), undefined);
  assert.deepEqual(live.parseLiveFinal({turnId: 't', text: 'x', mode: 'weird', asrFinalFromSpeechEndMs: -1}), {turnId: 't', text: 'x', mode: 'unknown', asrFinalFromSpeechEndMs: null});
});

test('live latency is numbers only, kept on the active turn and copied into diagnostics without text', () => {
  timing.clearVoiceTiming();
  timing.beginVoiceTurn({route: 'local-agent', cold: false, entry: 'conversation', policy: 'auto-send'});
  assert.equal(timing.recordLiveVoiceTiming({mode: 'stream', partials: 3, firstPartialMs: 210, finalFromSpeechEndMs: 160, asrFinalFromSpeechEndMs: 120, text: 'secret words'}), true);
  assert.equal(timing.recordLiveVoiceTiming({mode: 'stream', partials: 1}), false, 'one live record per turn');
  const [row] = timing.voiceTimingRecords();
  assert.deepEqual(row.live, {mode: 'stream', partials: 3, firstPartialMs: 210, finalFromSpeechEndMs: 160, asrFinalFromSpeechEndMs: 120});
  const report = buildDiagnostics({voiceTiming: JSON.parse(timing.exportVoiceTiming())});
  assert.deepEqual(report.voiceTiming.records[0].live, row.live);
  assert.doesNotMatch(JSON.stringify(report), /secret words/);
  assert.equal(timing.recordLiveVoiceTiming({mode: 'stream', partials: -1}), false);
});

test('the live client and adapter never store, log or send interim text and keep the send policy constant', () => {
  const sources = ['apps/app/src/runtime/live-voice.ts', '.eliza/client-features/packages/voice/src/live-voice-session.ts', 'apps/app/src/runtime/native-live-voice.ts'].map(file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'));
  for (const source of sources) assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''), /console\.|localStorage|sessionStorage|indexedDB/);
  const adapter = fs.readFileSync(new URL('../apps/app/src/prototype/voice-adapter.ts', import.meta.url), 'utf8');
  for (const line of adapter.split('\n').filter(line => /conversationInterim/.test(line)))
    assert.doesNotMatch(line, /draft|setItem|sendVoiceTurn|sendVoiceEntry|console\./, 'interim text is display only');
  assert.match(fs.readFileSync(new URL('../apps/app/src/runtime/voice-selection.ts', import.meta.url), 'utf8'), /const VOICE_SEND_POLICY: VoiceSendPolicy = 'auto-send';/);
  // Every final goes through the existing voice policy boundary: the assistant and the recorded loop share one send.
  assert.match(adapter, /const sendTurn=async\([\s\S]{0,400}sendVoiceEntry\(\{policy:voiceSendPolicy\(\)/);
  assert.equal((adapter.match(/send:sendTurn/g) || []).length, 2);
});

test('Android: Silero VAD runs in the app process and only the live ASR and end-of-turn routes are added to the agent bridge', () => {
  const plugin = fs.readFileSync(new URL('../android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java', import.meta.url), 'utf8');
  // The end-of-turn route (#423, elizaOS #36546) carries text only; the heard route is covered in voice-turn-routes.test.mjs.
  assert.match(plugin, /\|asr\/local-inference\/\(live\(\/status\)\?\|end-of-turn\)\)\$"/);
  // Capture and VAD are the shared ai.eliza.voice pipeline on the process-wide inference session.
  const capture = fs.readFileSync(new URL('../vendor/eliza/plugins/plugin-local-inference/native/android/src/main/java/ai/eliza/voice/LiveVoiceCapture.java', import.meta.url), 'utf8');
  assert.match(capture, /InferenceSession\.Vad vad=inference\.openVad\(\);/);
  assert.match(capture, /float\[\] probability=vad\.process\(pcm\);/);
  // The bridge is the shared LocalSpeechBridgePlugin that AlphaVoiceCloudPlugin subclasses.
  const voicePlugin = fs.readFileSync(new URL('../vendor/eliza/plugins/plugin-local-inference/native/android/speech-bridge/src/main/java/ai/eliza/voice/LocalSpeechBridgePlugin.java', import.meta.url), 'utf8');
  assert.match(voicePlugin, /new LiveVoiceCapture\(getContext\(\),VoiceAssets\.sharedInference\(getContext\(\)\),id,sink,echoCancel\)/);
  assert.match(voicePlugin, /private final LiveCaptureController live=new LiveCaptureController\(/);
  assert.match(capture, /AudioFormat\.ENCODING_PCM_16BIT/);
  assert.doesNotMatch(capture, /FileOutputStream|openFileOutput|Log\./, 'no audio file and no log of audio or text');
});

test('the app-process VAD gate opens and closes segments on Silero probabilities (host JVM)', async () => {
  const {runJvm, upstreamVoiceFixture, upstreamVoiceSource} = await import('./fixtures/jvm-tools.mjs');
  assert.match(runJvm([upstreamVoiceSource('LiveVadGate.java'), upstreamVoiceFixture('LiveVadGateTest.java')], 'ai.eliza.voice.LiveVadGateTest'), /^PASS live vad gate/);
});

test('the native speech bridge and live transport are shared upstream; Alpha keeps only bindings', () => {
  const strip = source => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  const alpha = strip(fs.readFileSync(new URL('../android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaVoiceCloudPlugin.java', import.meta.url), 'utf8'));
  assert.match(alpha, /@CapacitorPlugin\(name="AlphaVoiceCloud", permissions=\{@Permission\(alias="microphone"/);
  assert.match(alpha, /public final class AlphaVoiceCloudPlugin extends LocalSpeechBridgePlugin \{/);
  assert.match(alpha, /super\("alpha-cloud-voice-","alpha-cloud-tts-"\)/, 'installed cache prefixes are kept');
  assert.match(alpha, /protected LiveCaptureController\.Route residentRoute\(String owner\)\{return \(\)->AlphaLocalAgentPlugin\.openNativeVoiceTransport\(owner\);\}/);
  // The generic bridge (recording, local recognition/synthesis, playback, focus, live capture, timing) is gone from Alpha.
  for (const moved of [/class AlphaCloudVoiceCapture/, /new MediaRecorder|MediaRecorder\(/, /new MediaPlayer/, /new LiveCaptureController/, /new LocalSpeechEngine/, /StreamingSpeechPlayback/, /SpeechAudioFocus/, /VoiceLatencyProbe|VoiceLatencyTrials/, /ThreadPoolExecutor|ExecutorService/,
    /public void (?:startRecording|stopRecording|cancelRecording|getRecordingMetrics|transcribeLocalRecording|synthesizeLocal|play|stopPlayback|cancel|liveCaptureStatus|startLiveCapture|stopLiveCapture|localSpeechStatus|releaseLocalSpeech|nativeVoiceTiming|markVoiceTurn|clearNativeVoiceTiming)\(PluginCall call\)/])
    assert.doesNotMatch(alpha, moved, String(moved));
  assert.equal(fs.existsSync(new URL('../android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaVoicePcm.java', import.meta.url)), false);
  // The renderer transport is the shared @elizaos/voice/native-live; Alpha binds its bridge and resident.
  const binding = strip(fs.readFileSync(new URL('../apps/app/src/runtime/native-live-voice.ts', import.meta.url), 'utf8'));
  assert.match(binding, /createNativeLiveVoice\(\{ port: plugin, available, resident \}\)/);
  for (const moved of [/addListener/, /parseLiveFinal|parseVoiceTranscriptEnvelope/, /createLiveSegmentStream/, /startLiveCapture|stopLiveCapture/, /crypto\.randomUUID/])
    assert.doesNotMatch(binding, moved, String(moved));
  assert.equal(fs.existsSync(new URL('../apps/app/src/runtime/native-resident-capture.ts', import.meta.url)), false);
  const turn = strip(fs.readFileSync(new URL('../apps/app/src/runtime/native-voice-turn.ts', import.meta.url), 'utf8'));
  assert.match(turn, /setNativeVoiceStageSink\(nativeVoiceStageSink\(plugin\(\)\)\)/);
  assert.doesNotMatch(turn, /markVoiceTurn\(|Promise\.race/);
  for (const file of ['local-voice.ts', 'paired-voice.ts']) {
    const source = strip(fs.readFileSync(new URL('../apps/app/src/runtime/' + file, import.meta.url), 'utf8'));
    assert.match(source, /const operation = createNativeSpeechRequests\(\{/, file);
    assert.doesNotMatch(source, /new AbortController\(\)|crypto\.randomUUID/, file);
  }
});
