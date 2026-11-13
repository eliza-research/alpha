import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {transformSync} from 'esbuild';
import {checkTraces} from '../check-traces.mjs';
import {boundInputs, bundledSource, call, captureSources, checkpoint, deferred, read, tick, trace} from './support.mjs';

const model = 'ObservationTurnDispatch';
const modelPath = 'specs/quint/application/ObservationTurnDispatch.qnt';
const sendSource = 'apps/app/src/runtime/connection-ui.tsx';
const observationSource = 'apps/app/src/runtime/client-observation-support.ts';
const contextSource = 'apps/app/src/runtime/phone-context.ts';
const protocolSource = 'apps/app/src/runtime/local-agent.ts';
const projection = '.eliza/client-features/';
const authored = 'What is on my calendar?\nCheck the visible day.';
const room = 'closed-room';
const requestId = '33333333-3333-4333-8333-333333333333';
const serverInstanceId = '11111111-1111-4111-8111-111111111111';
const otherInstance = '22222222-2222-4222-8222-222222222222';
const ordinary = {view: 'calendar', revision: 7, sensitive: false, timeZone: 'UTC',
  selectedObject: {kind: 'canonical-calendar-source', id: 'closed-source', revision: '1',
    accountId: 'closed-account', sourceRevision: 'a'.repeat(64)}};
const day = {date: '2026-11-09', timeZone: 'UTC'};
const statusPayload = {
  current: {serverInstanceId, clientTurnObservationSupport: {version: 1, optionalFields: ['calendarDay']}},
  different: {serverInstanceId: otherInstance, clientTurnObservationSupport: {version: 1, optionalFields: ['calendarDay']}},
  legacy: {serverInstanceId},
  unlisted: {serverInstanceId, clientTurnObservationSupport: {version: 1, optionalFields: []}},
  invalid: {serverInstanceId, clientTurnObservationSupport: {version: 2, optionalFields: ['calendarDay']}},
};

function compiledSend() {
  const source = read(sendSource);
  const start = source.indexOf('  async send(text:');
  const end = source.indexOf('\n  },\n};', start);
  assert.ok(start >= 0 && end > start, 'production connection controller send method exists');
  const conversationKey = source.match(/^function conversationKey\(.*$/m)[0];
  const stopNotices = source.match(/^export const STOPPED_(?:REPLY|CANCELLED|UNCHECKED)_NOTICE = .*$/gm)
    .map(line => line.replace(/^export /, '')).join('\n');
  return transformSync(`${conversationKey}\n${stopNotices}\nconst controller = {${source.slice(start, end + 5)}};\nglobalThis.send = controller.send.bind(controller);`,
    {loader: 'ts'}).code;
}

function observeWire(input) {
  if (!input) return {wireDay: 0, ordinaryIntact: false, wireText: 'none', wireFormat: 'none'};
  const {raw, owner, path, stream} = input;
  assert.equal(owner, 'closed-owner');
  assert.equal(path, '/api/conversations/' + room + '/messages' + (stream ? '/stream' : ''));
  const body = JSON.parse(raw);
  const wireDay = [...raw.matchAll(/"calendarDay"/g)].length;
  const {calendarDay, ...fields} = body.metadata.clientDevice.context;
  assert.deepEqual(fields, ordinary);
  assert.equal(wireDay, calendarDay === undefined ? 0 : 1);
  if (calendarDay !== undefined) assert.deepEqual(calendarDay, day);
  const canonical = body.metadata.userTextFormat === 'plain-v1';
  const context = wireDay ? {...ordinary, calendarDay: day} : ordinary;
  assert.deepEqual(body.metadata, {uiTimeZone: ordinary.timeZone, clientDevice: {context},
    ...(canonical ? {userTextFormat: 'plain-v1'} : {alphaPhone: {context: ordinary}})});
  assert.deepEqual(body, {text: body.text, channelType: 'DM', clientMessageId: requestId, metadata: body.metadata,
    ...(stream ? {streamProtocol: 'delta-v2'} : {})});
  if (body.text !== authored) {
    const lines = body.text.split('\n');
    assert.equal(lines[0], '[CURRENT-TURN CLIENT OBSERVATION]');
    const envelope = lines.find(line => line.startsWith('{"source":'));
    assert.deepEqual(JSON.parse(envelope), {source: 'Alpha Phone client', ...ordinary});
    assert.equal(lines.slice(lines.indexOf('[USER MESSAGE]') + 1).join('\n'), authored);
  }
  return {wireDay, ordinaryIntact: true, wireText: body.text === authored ? 'authored' : 'envelope',
    wireFormat: canonical ? 'plain-v1' : 'legacy'};
}

async function fixture({ClientObservationSupportSession, phoneContextMessage, LocalAgentProtocol}, send,
  {format, hasPeer, offered, stream = false}) {
  let statusReads = 0;
  let pendingStatus;
  let viewEntered = false;
  let started = false;
  let background = 'none';
  let output;
  let failure;
  const view = deferred();
  const caller = new AbortController();
  const handshake = new AbortController();
  const wires = [];
  const body = value => ({status: 200, body: JSON.stringify(value)});
  const response = {text: 'Closed turn finished.', agentName: 'Closed fixture'};
  const capture = (input, signal, streaming) => {
    signal.throwIfAborted();
    wires.push({path: input.path, owner: input.ownerId, raw: input.body, stream: streaming});
  };
  const local = new LocalAgentProtocol({
    async start() {return {};},
    async request(input, signal) {
      if (input.path === '/api/auth/me') return body({identity: {kind: 'owner', id: 'closed-owner'},
        access: {role: 'OWNER', mode: 'local'}});
      if (input.path === '/api/agents') return body({agents: [{id: 'closed-agent', status: 'running'}]});
      if (input.path === '/api/status') {
        assert.equal(input.method, 'GET');
        assert.equal(input.body, undefined);
        assert.equal(input.ownerId, 'closed-owner');
        assert.equal(pendingStatus, undefined, 'the preceding status port settled');
        statusReads++;
        pendingStatus = deferred();
        return pendingStatus.promise;
      }
      assert.equal(input.method, 'POST');
      capture(input, signal, false);
      return body(response);
    },
    ...(stream ? {async stream(input, signal) {capture(input, signal, true); return response;}} : {}),
  });
  const {session} = await local.connect(new AbortController().signal);
  const selected = {kind: 'resident', userTextFormatVersion: format === 'plain' ? 1 : undefined, remote: local};
  const current = () => sandbox.epoch === 1 && sandbox.active === selected && sandbox.state.session === session;
  const peer = hasPeer ? new ClientObservationSupportSession({...session, connectionEpoch: 1}, current,
    signal => local.request('/api/status', undefined, signal)) : undefined;
  const sandbox = vm.createContext({
    AbortController, DOMException, Date, console, navigator: {onLine: true}, window: new EventTarget(),
    state: {session, open: false, busy: false}, active: selected, epoch: 1, clientObservationSession: peer,
    operation: null, sending: null, requestedCameraContinuation: undefined,
    residentAlwaysPresent: true, isAndroid: false, testMocksEnabled: format === 'legacy-mock', ownProviderSelected: () => false,
    phoneContextMessage, boundNavigation: () => ({
      currentAttempt: () => undefined,
      observeCommittedView: () => {viewEntered = true; return view.promise;},
      metadata: () => ({}),
    }),
    conversationMemory: new Map([[JSON.stringify([session.origin, session.ownerId, session.agentId]), room]]),
    ensureSelectedConversation: async (_selected, _session, _signal, assertCurrent) => {assertCurrent(); return room;},
    readDevicePreferences: async () => ({askBeforeAgentActions: true}),
    withResidentMapsNavigation: (_request, _id, _signal, post) => post(),
    cancelStoppedReply() {}, checkResidentAlive() {}, runQueuedResidentRebind() {}, setTimeout,
    appRecordInvalidations: () => [], automationsCommitted: () => false,
    update(patch) {Object.assign(sandbox.state, patch);},
    expired: () => false, failureKindOf: () => undefined, AlphaClientError: class extends Error {},
  });
  vm.runInContext(send, sandbox);
  const finishStatus = value => {
    const pending = pendingStatus;
    assert.ok(pending, 'a real local status request entered the closed port');
    pendingStatus = undefined;
    pending.resolve(value === 'unavailable' ? {status: 503, body: '{}'} : body(statusPayload[value]));
  };
  return {
    beginHandshake() {
      assert.ok(peer);
      background = 'pending';
      void peer.handshake(handshake.signal).then(() => {background = 'resolved';}, error => {
        background = error.name === 'AbortError' ? 'aborted' : 'unexpected';
      });
    },
    beginTurn() {
      started = true;
      void sandbox.send(authored, offered ? {...ordinary, calendarDay: day} : {...ordinary},
        requestId, caller.signal).then(result => {output = result;}, error => {failure = error;});
    },
    finishStatus,
    ignoreLateStatus() {finishStatus('current');},
    replaceConnection() {
      peer?.clear();
      sandbox.clientObservationSession = undefined;
      handshake.abort(new DOMException('The connection changed.', 'AbortError'));
      sandbox.epoch++;
      sandbox.sending?.abort(new DOMException('The connection changed.', 'AbortError'));
      sandbox.sending = null;
      sandbox.active = null;
      sandbox.state.session = null;
    },
    cancelTurn() {caller.abort(new DOMException('Closed turn stopped', 'AbortError'));},
    releaseView() {assert.ok(viewEntered, 'the last view await was entered'); view.resolve(true);},
    observe() {
      if (failure) {
        assert.equal(failure.notDispatched, true, failure.stack);
        assert.ok(failure.name === 'AbortError', failure.stack);
      }
      if (output) assert.equal(output.text, response.text);
      if (wires[0]) assert.equal(wires[0].stream, stream);
      const phase = failure ? 'aborted' : wires.length ? 'posted' : viewEntered ? 'waiting'
        : !started ? 'idle' : statusReads === 1 ? 'learning' : 'comparing';
      const wire = observeWire(wires[0]);
      return {'s.format': format, 's.hasPeer': Boolean(peer), 's.offered': offered, 's.currentConnection': current(),
        's.cancelled': caller.signal.aborted, 's.phase': phase, backgroundObservation: background,
        's.statusReads': statusReads, 's.posts': wires.length,
        's.wireDay': wire.wireDay, 's.ordinaryIntact': wire.ordinaryIntact, 's.wireText': wire.wireText,
        's.wireFormat': wire.wireFormat, 's.beforeDispatch': failure?.notDispatched === true};
    },
    complete() {assert.ok(failure || output, 'the exact connection controller completed');},
  };
}

export async function checkObservationTurnDispatch(extraSources = []) {
  const sources = [modelPath, sendSource, observationSource, contextSource, protocolSource,
    projection + '.source.json', 'bun.lock', fileURLToPath(import.meta.url), ...extraSources];
  captureSources(sources);
  const prepared = JSON.parse(read(projection + '.source.json'));
  assert.equal(prepared.baseCommit, JSON.parse(read('upstream.lock.json')).commit);
  const bundles = await Promise.all([observationSource, contextSource, protocolSource]
    .map(path => bundledSource(path, {'import.meta.env': '{}'})));
  const dependencies = bundles.flatMap(bundle => bundle.sources);
  sources.push(...dependencies);
  const {driverHashes} = boundInputs({sources});
  for (const path of dependencies.filter(path => path.startsWith(projection))) {
    const hash = driverHashes[fileURLToPath(new URL('../../../../' + path, import.meta.url))];
    assert.equal(hash, prepared.files[path.slice(projection.length)], path + ' reviewed projected bytes');
  }
  const modules = Object.assign({}, ...bundles.map(bundle => bundle.exports));
  const send = compiledSend();
  const traces = [];
  async function run(name, overrides, steps, setupSteps = []) {
    const setup = {format: 'plain', hasPeer: true, offered: true, ...overrides};
    const source = await fixture(modules, send, setup);
    const result = trace(name, source.observe(), call('setup', setup.format, setup.hasPeer, setup.offered));
    for (const [action, value] of [...setupSteps, ['beginTurn'], ...steps]) {
      if (action === 'finishLearn' || action === 'finishComparison') source.finishStatus(value);
      else source[action]();
      await tick();
      checkpoint(result, action, value === undefined ? call(action) : call(action, value), source.observe());
    }
    source.complete();
    traces.push(result);
  }

  const learn = ['finishLearn', 'current'];
  const compare = ['finishComparison', 'current'];
  const release = ['releaseView'];
  const handshake = ['beginHandshake'];
  const late = ['ignoreLateStatus'];
  await run('exact matching status includes the field once in actual JSON dispatch', {}, [learn, compare, release]);
  await run('exact matching status includes the field once in actual streaming dispatch', {stream: true}, [learn, compare, release]);
  await run('turn joins a pending activation handshake before comparing again', {}, [learn, compare, release], [handshake]);
  await run('completed activation handshake saves one read while still requiring fresh comparison', {}, [compare, release], [handshake, learn]);
  await run('replacement process keeps authored prose and ordinary observation', {}, [learn, ['finishComparison', 'different'], release]);
  await run('unavailable status preserves ordinary request', {}, [['finishLearn', 'unavailable'], release]);
  await run('older status leaves the canonical wire format intact', {}, [['finishLearn', 'legacy'], release]);
  await run('unlisted optional field preserves ordinary request', {}, [learn, ['finishComparison', 'unlisted'], release]);
  await run('unsupported peer version leaves the optional field absent', {}, [learn, ['finishComparison', 'invalid'], release]);
  await run('plain prose alone cannot admit the optional field', {hasPeer: false}, [release]);
  await run('no optional observation does not read peer status', {offered: false}, [release]);
  await run('legacy product format sends authored prose without day or status', {format: 'legacy-product'}, [release]);
  await run('legacy development envelope remains day-free', {format: 'legacy-mock'}, [release]);
  await run('caller stops during the held first status', {}, [['cancelTurn'], late]);
  await run('caller stops during the held comparison', {}, [learn, ['cancelTurn'], late]);
  await run('connection replacement fences a held comparison', {}, [learn, ['replaceConnection'], late]);
  await run('caller stops without cancelling the shared activation handshake', {}, [['cancelTurn'], learn], [handshake]);
  await run('connection replacement cancels the shared activation handshake', {}, [['replaceConnection'], late], [handshake]);
  await run('caller stops after admission during the last renderer await', {}, [learn, compare, ['cancelTurn'], release]);
  await run('connection replacement after admission during the last renderer await', {}, [learn, compare, ['replaceConnection'], release]);

  return checkTraces(boundInputs({model, modelPath, sources, traces, scope: 'bounded-orchestration',
    assumptions: ['The exact connection send method, optional observation session, phone sanitizer and local protocol run through an inert synthetic bridge. Captures are actual JSON and stream bodies before transport.',
      'The fixture starts a background handshake through the same session entry point used on activation, holds the final committed-view await, and supplies a fixed room and device preference. Maps relay, reply effects, action approval and actual authentication are outside this scope.',
      'Replacement is observed through the renderer connection epoch and cancellation. This scope does not claim atomic API-process identity across the local native boundary after status comparison.']}));
}
