import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {observeVoiceFixture, voiceFixtureFailureMetadata, attachVoiceFailureMetadata} from './browser/voice-fixture-failure-metadata.ts';

test('voice diagnostics preserve native receiver, all arguments, result identity and original rejection', async () => {
  const receiver = {}, input = {path: '/api/asr/local-inference/live', body: 'private transcript'}, extra = Symbol('extra');
  const result = Promise.resolve({status: 200, body: 'private reply'}), calls = [];
  const root = {live: {}, Capacitor: {nativePromise: function (...args) {calls.push({receiver: this, args}); return result;}}};
  observeVoiceFixture(root);
  const wrapped = root.Capacitor.nativePromise;
  assert.equal(wrapped.call(receiver, 'Agent', 'request', input, extra), result);
  await result;
  assert.equal(calls[0].receiver, receiver);
  assert.deepEqual(calls[0].args, ['Agent', 'request', input, extra]);
  assert.deepEqual(root.live.failureNativeMetadata, [{operation: 'native-request', outcome: 'returned'}]);
  observeVoiceFixture(root);
  assert.equal(root.Capacitor.nativePromise, wrapped, 'installing twice does not wrap twice');

  const rejection = new Error('Bearer private-token transcript');
  const rejected = Promise.reject(rejection);
  const failure = {live: {}, Capacitor: {nativePromise: () => rejected}};
  observeVoiceFixture(failure);
  const returned = failure.Capacitor.nativePromise('AlphaVoiceCloud', 'startLiveCapture', input);
  assert.equal(returned, rejected);
  await assert.rejects(returned, error => error === rejection);
  assert.deepEqual(failure.live.failureNativeMetadata, [{operation: 'startLiveCapture', outcome: 'returned'}], 'a returned Promise is not observed or claimed successful');

  const sync = {live: {}, Capacitor: {nativePromise() {throw rejection;}}};
  observeVoiceFixture(sync);
  assert.throws(() => sync.Capacitor.nativePromise('Agent', 'requestStream', input), error => error === rejection);
  assert.equal(sync.live.failureNativeMetadata[0].outcome, 'threw');

  let thenReads = 0;
  const promise = Promise.resolve();
  Object.defineProperty(promise, 'then', {get() {thenReads++; throw Error('must not observe');}});
  const untouched = {live: {}, Capacitor: {nativePromise: () => promise}};
  observeVoiceFixture(untouched);
  assert.equal(untouched.Capacitor.nativePromise('Agent', 'requestStream', input), promise);
  assert.equal(thenReads, 0, 'diagnostics install no Promise handlers');
});

test('voice probes are bounded and leave untracked calls and hostile diagnostic properties alone', () => {
  const answer = {}, calls = [], root = {live: {}, Capacitor: {nativePromise(...args) {calls.push(args); return answer;}}};
  observeVoiceFixture(root);
  assert.equal(root.Capacitor.nativePromise('Credentials', 'read', {key: 'private'}), answer);
  assert.equal(root.live.failureNativeMetadata.length, 0);
  const hostile = {get path() {throw Error('private getter');}};
  assert.equal(root.Capacitor.nativePromise('Agent', 'request', hostile), answer);
  for (let i = 0; i < 100; i++) assert.equal(root.Capacitor.nativePromise('Agent', 'requestStream', {body: 'private'}), answer);
  assert.equal(calls.length, 102, 'diagnostic cap never drops native calls');
  assert.equal(root.live.failureNativeMetadata.length, 64);
  const absent = {Capacitor: {nativePromise: () => answer}}, prior = absent.Capacitor.nativePromise;
  observeVoiceFixture(absent);
  assert.equal(absent.Capacitor.nativePromise, prior);
});

test('failure metadata permits only bounded enums, booleans and counts, excluding arbitrary fixture content', () => {
  const secret = 'PRIVATE_TRANSCRIPT_KEY_AUDIO_IDENTIFIER';
  const root = {live: {captures: [secret], stops: [secret], active: secret, routes: [{frames: [secret], close: true, body: secret}], spoken: [secret], plays: [secret], stopped: Infinity, forbidden: [secret], sharedVoiceSession: {getSnapshot: () => ({phase: secret, hearing: true, muted: false, inputHeld: true, pendingText: secret, transcript: secret, error: {message: secret, name: secret}, replyId: secret})}, failureNativeMetadata: Array.from({length: 100}, () => ({operation: 'native-request', outcome: secret, status: secret, body: secret, error: secret}))}, flagOff: {posts: [secret], unexpected: [secret], headers: secret}};
  const metadata = voiceFixtureFailureMetadata(root);
  assert.equal(metadata.snapshot.phase, 'unknown');
  assert.equal(metadata.snapshot.hasPendingText, true);
  assert.equal(metadata.snapshot.hasError, true);
  assert.equal(metadata.counts.routeFrames, 1);
  assert.equal(metadata.counts.playbackStops, 0);
  assert.equal(metadata.renderedPhase, 'absent');
  assert.equal(metadata.nativeRequests.length, 64);
  assert.deepEqual(metadata.nativeRequests[0], {operation: 'native-request', outcome: 'unknown'});
  assert.doesNotMatch(JSON.stringify(metadata), new RegExp(secret));
  assert.ok(JSON.stringify(metadata).length < 10_000);
  root.live.failureNativeMetadata = [{operation: secret, outcome: 'returned'}, {operation: 'play', outcome: 'returned', status: -1}];
  assert.deepEqual(voiceFixtureFailureMetadata(root).nativeRequests, [{operation: 'play', outcome: 'returned'}]);
  root.live.captures = Array(1_000_001);
  assert.equal(voiceFixtureFailureMetadata(root).counts.captures, 1_000_000);
  root.document = {querySelector: () => ({getAttribute: () => secret})};
  assert.equal(voiceFixtureFailureMetadata(root).renderedPhase, 'unknown');
  root.document.querySelector = () => ({getAttribute: () => 'speaking'});
  assert.equal(voiceFixtureFailureMetadata(root).renderedPhase, 'speaking', 'the production bundle needs no private session access');
  assert.equal(voiceFixtureFailureMetadata({}), null);
});

test('probe and collector serialize into the browser without module closures', () => {
  const context = vm.createContext({live: {captures: [], routes: []}, Capacitor: {nativePromise: () => ({status: 204})}});
  vm.runInContext(`(${observeVoiceFixture.toString()})(); Capacitor.nativePromise('Agent','request',{path:'/api/asr/local-inference/live/status'});`, context);
  const metadata = vm.runInContext(`(${voiceFixtureFailureMetadata.toString()})()`, context);
  assert.equal(metadata.nativeRequests[0].operation, 'native-request');
  assert.equal(metadata.nativeRequests[0].outcome, 'returned');
});

test('only unexpected failing live fixtures attach metadata, and capture failures disclose no exception', async () => {
  const attached = [], root = {live: {captures: []}}, page = {evaluate: collect => Promise.resolve(collect(root))};
  const info = {status: 'passed', expectedStatus: 'passed', attach: (...args) => attached.push(args)};
  for (const [status, expectedStatus] of [['passed', 'passed'], ['failed', 'failed'], ['skipped', 'passed']]) await attachVoiceFailureMetadata(page, {...info, status, expectedStatus});
  assert.equal(attached.length, 0);
  await attachVoiceFailureMetadata(page, {...info, status: 'failed'});
  assert.equal(attached.length, 1);
  assert.equal(attached[0][0], 'voice-fixture-failure-metadata');
  assert.equal(JSON.parse(attached[0][1].body).scope, 'synthetic-voice-fixture-failure-only');
  await attachVoiceFailureMetadata({evaluate: () => Promise.resolve(null)}, {...info, status: 'failed'});
  assert.equal(attached.length, 1, 'unrelated fixtures do not attach');
  await attachVoiceFailureMetadata({evaluate: () => {throw Error('PRIVATE_CAPTURE_ERROR');}}, {...info, status: 'timedOut'});
  assert.deepEqual(JSON.parse(attached[1][1].body), {version: 1, diagnosticCaptureFailed: true});
  await assert.doesNotReject(() => attachVoiceFailureMetadata(page, {...info, status: 'failed', attach: async () => {throw Error('attachment unavailable');}}));
  const circular = {}; circular.self = circular;
  await assert.doesNotReject(() => attachVoiceFailureMetadata({evaluate: () => Promise.resolve(circular)}, {...info, status: 'failed'}));
});
