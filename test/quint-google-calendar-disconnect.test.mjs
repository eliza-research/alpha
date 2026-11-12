import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {boundInputs, call, captureSources, checkpoint, deferred, read, root, tick, trace} from '../specs/quint/refinement/application/support.mjs';

const driver = fileURLToPath(import.meta.url);
const implementation = 'apps/app/src/runtime/google-accounts.ts';
const connection = '11111111-1111-4111-8111-111111111111';
const otherConnection = '22222222-2222-4222-8222-222222222222';
const connector = 'alpha-google:' + 'a'.repeat(64);
const pauseKey = ' exact-fixture-pause ';
const noResult = {privacy: '', calendarPause: '', callbackRetirement: '', providerDrain: '', pauseRevision: -1};
const lease = {origin: 'https://fixture.invalid', ownerId: 'fixture-owner', agentId: 'fixture-agent',
  sessionId: 'fixture-session', credentialBinding: 'fixture-credential', sourceGeneration: 'fixture-generation'};
const leaseFields = {origin: 'origin', owner: 'ownerId', agent: 'agentId', session: 'sessionId',
  credential: 'credentialBinding', generation: 'sourceGeneration'};

function inputReview(profile) {
  const destination = {connectorAccountId: connector, providerCalendarId: 'fixture-calendar'};
  const base = {provider: 'google', side: 'owner', grantId: connector, connectorAccountId: connector,
    calendarId: 'fixture-calendar', selectionVersion: 2, managedGoogleConnectionId: connection};
  const rows = [base];
  if (profile === 'duplicate') rows.push({...base});
  if (profile === 'unmapped') delete base.managedGoogleConnectionId;
  if (profile === 'wrong-connection') base.managedGoogleConnectionId = otherConnection;
  if (profile === 'invalid-version') base.selectionVersion = -1;
  if (profile === 'wrong-side') base.side = 'guest';
  if (profile === 'wrong-provider') base.provider = 'eliza';
  if (profile === 'wrong-grant') base.grantId = 'alpha-google:' + 'b'.repeat(64);
  const control = profile === 'no-control' ? null : {revision: profile === 'invalid-revision' ? -1 : 7,
    paused: profile === 'already-paused', destination: profile === 'no-destination' ? null : destination,
    pendingDispatch: {linkId: 'held-link'}};
  return {lease: {...lease}, control, sources: rows};
}

function liveReview(profile, live) {
  if (live === 'none') return null;
  const result = inputReview(profile);
  if (Object.hasOwn(leaseFields, live)) result.lease[leaseFields[live]] += '-replacement';
  if (live === 'incomplete') result.lease.ownerId = '';
  if (live === 'version') result.sources[0].selectionVersion++;
  if (live === 'revision' && result.control) result.control.revision++;
  if (live === 'destination' && result.control?.destination) result.control.destination.providerCalendarId = 'different-calendar';
  if (live === 'mapping') result.sources[0].managedGoogleConnectionId = otherConnection;
  return result;
}

function budgets(profile) {
  const values = {valid: [27, 19], 'pause-low': [0, 19], 'pause-high': [3001, 19],
    'retirement-low': [27, 0], 'retirement-high': [27, 1001], fraction: [27, 1.5]};
  const [pauseObservationMs, retirementObservationMs] = values[profile];
  return {pauseObservationMs, retirementObservationMs};
}

const errors = new Map([
  ['Choose a verified Google connection UUID.', 'uuid'],
  ['Cleanup observation budgets exceed the reviewed bounds.', 'budget'],
  ['Fixture privacy retired', 'privacy'],
  ['The Google disconnect owner or source changed.', 'privacy'],
  ['Fixture abort', 'aborted'],
  ['Fixture privacy revoke failed', 'revoke'],
]);

async function compile(extraSources) {
  const built = await build({absWorkingDir: root, entryPoints: [implementation], bundle: true, platform: 'node',
    format: 'cjs', write: false, metafile: true, define: {'import.meta.env': '{}'},
    plugins: [{name: 'google-calendar-disconnect-observer', setup(builder) {
      builder.onLoad({filter: /\/runtime\/google-accounts\.ts$/}, ({path}) => {
        const source = read(path), marker = '    // Never await local cleanup before starting ordinary privacy revocation.';
        assert.equal(source.split(marker).length, 2, 'Exact cleanup promise observation point');
        return {loader: 'ts', contents: source.replace(marker, '    __observeCleanup(pause,retirement,pauseRequest);\n' + marker)};
      });
    }}]});
  const sources = [...Object.keys(built.metafile.inputs).filter(path => !path.startsWith('<')), driver, ...extraSources];
  captureSources(sources);
  return {code: built.outputFiles[0].text, sources};
}

function fixture(compiled, profile, independent, pausePort, retirementPort) {
  const module = {exports: {}}, aborter = new AbortController(), timers = new Map();
  const privacyResponse = {outcome: 'disconnected', accounts: []};
  const calls = [];
  const rawReview = inputReview(profile), heldPause = deferred(), heldRetirement = deferred(), heldRevoke = deferred();
  let live = 'exact', privacyCurrent = true, originalEdited = false, uuid = true, budget = '', key = '';
  let phase = 'idle', outcome = '', result, request, pauseSignal, pause = '', retirement = '', revoke = '';
  let pauseDelivered = false, retirementDelivered = false, timerKind, nextTimer = 0;

  function schedule(callback, milliseconds) {
    assert.ok(timerKind === 'pause' || timerKind === 'retire', 'The real cleanup observer schedules the timer');
    const limits = budgets(budget);
    assert.equal(milliseconds, timerKind === 'pause' ? limits.pauseObservationMs : limits.retirementObservationMs);
    const id = ++nextTimer;
    timers.set(id, {kind: timerKind, callback});
    timerKind = undefined;
    return id;
  }
  function observeCleanup(pauseResult, retirementResult, pauseRequest) {
    request = pauseRequest;
    void pauseResult.then(value => {pause = value;});
    void retirementResult.then(value => {retirement = value;});
  }
  new Function('module', 'exports', 'setTimeout', 'clearTimeout', '__observeCleanup', compiled.code)(
    module, module.exports, schedule, id => timers.delete(id), observeCleanup,
  );
  const {disconnectGoogleWithCalendar} = module.exports;
  const ports = {
    current: () => liveReview(profile, live),
    revoke(id, signal) {
      assert.equal(id, connection);
      assert.equal(signal, aborter.signal);
      calls.push('revoke');
      phase = 'revoking';
      revoke = 'pending';
      return heldRevoke.promise;
    },
  };
  if (independent) ports.privacyCurrent = () => {
    if (!privacyCurrent) throw new DOMException('Fixture privacy retired', 'AbortError');
  };
  if (pausePort !== 'absent') ports.pause = (body, signal) => {
    assert.deepEqual(body, {operation: 'pause', expectedRevision: 7, idempotencyKey: pauseKey});
    assert.notEqual(signal, aborter.signal);
    assert.equal(signal.aborted, false);
    calls.push('pause');
    pauseSignal = signal;
    if (pausePort === 'throw') throw Error('Fixture pause threw synchronously');
    timerKind = 'pause';
    return heldPause.promise;
  };
  if (retirementPort !== 'absent') ports.retireCallbacks = id => {
    assert.equal(id, connection);
    calls.push('retire');
    if (retirementPort === 'throw') throw Error('Fixture retirement threw synchronously');
    timerKind = 'retire';
    return heldRetirement.promise;
  };
  const timer = kind => [...timers.values()].find(entry => entry.kind === kind);
  const timeout = kind => {
    const entry = timer(kind);
    assert.ok(entry, 'Real cleanup timeout remains armed');
    entry.callback();
    assert.equal(timer(kind), undefined, 'Completing cleanup releases the timer');
    return tick();
  };

  return {
    observe() {
      if (result) assert.equal(result.privacy, privacyResponse, 'The exact ordinary revoke response is returned');
      return {'s.review': profile, 's.independent': independent, 's.pausePort': pausePort, 's.retirementPort': retirementPort,
        's.live': live, 's.privacyCurrent': privacyCurrent, 's.aborted': aborter.signal.aborted, 's.originalEdited': originalEdited,
        's.phase': phase, 's.uuid': uuid, 's.budget': budget, 's.key': key, 's.calls': calls,
        's.pauseRevision': request?.expectedRevision ?? -1, 's.pauseSignal': !pauseSignal ? '' : !pauseSignal.aborted ? 'live' :
          pauseSignal.reason.name === 'TimeoutError' ? 'timeout' : 'aborted',
        's.pause': pause || (timer('pause') ? 'pending' : ''),
        's.retirement': retirement || (timer('retire') ? 'pending' : ''), 's.revoke': revoke,
        's.pauseDelivered': pauseDelivered, 's.retirementDelivered': retirementDelivered, 's.outcome': outcome,
        's.result': result ? {privacy: 'revoked', calendarPause: result.calendarPause,
          callbackRetirement: result.callbackRetirement, providerDrain: result.providerDrain,
          pauseRevision: result.pauseRequest?.expectedRevision ?? -1} : noResult};
    },
    setCalendar(next) {live = next;},
    setPrivacy(next) {privacyCurrent = next;},
    editOriginal() {
      originalEdited = true;
      rawReview.lease.ownerId = 'replaced-input-owner';
      if (rawReview.control) rawReview.control.revision = 23;
      if (rawReview.control?.destination) rawReview.control.destination.providerCalendarId = 'different-input-calendar';
      if (rawReview.control?.pendingDispatch) rawReview.control.pendingDispatch.linkId = 'different-input-link';
      rawReview.sources[0].selectionVersion = 44;
    },
    abort() {aborter.abort(new DOMException('Fixture abort', 'AbortError')); return tick();},
    start(validUuid, budgetProfile, keyProfile) {
      uuid = validUuid;
      budget = budgetProfile;
      key = keyProfile;
      const rawKey = {valid: pauseKey, blank: '  ', long: 'a'.repeat(513)}[keyProfile];
      const resultPromise = disconnectGoogleWithCalendar({review: rawReview, connectionId: validUuid ? connection : 'not-a-uuid',
        pauseKey: rawKey, signal: aborter.signal, ports, ...budgets(budgetProfile)});
      void resultPromise.then(value => {
        result = value;
        phase = 'done';
        outcome = 'returned';
        assert.deepEqual(result.pauseRequest, request);
        if (request) assert.equal(request.idempotencyKey, pauseKey);
      }, error => {
        phase = 'done';
        outcome = errors.get(error.message);
        assert.ok(outcome, error.stack);
      });
      return tick();
    },
    revokeReply(ok) {
      revoke = ok ? 'confirmed' : 'failed';
      if (ok) {phase = 'cleanup'; heldRevoke.resolve(privacyResponse);}
      else heldRevoke.reject(Error('Fixture privacy revoke failed'));
      return tick();
    },
    pauseReply(response) {
      assert.equal(pauseDelivered, false);
      pauseDelivered = true;
      if (response === 'failed') heldPause.reject(Error('Fixture pause failed'));
      else {
        const base = inputReview(profile).control;
        const result = {...base, revision: base.revision + 1, paused: true};
        if (response === 'revision') result.revision--;
        if (response === 'destination') result.destination.providerCalendarId = 'replacement-calendar';
        if (response === 'pending') result.pendingDispatch = null;
        if (response === 'running') result.paused = false;
        if (response === 'malformed') result.revision = 8.5;
        if (response === 'reordered') result.destination = {
          providerCalendarId: result.destination.providerCalendarId, connectorAccountId: result.destination.connectorAccountId,
        };
        heldPause.resolve(result);
      }
      return tick();
    },
    retirementReply(ok) {
      assert.equal(retirementDelivered, false);
      retirementDelivered = true;
      if (ok) heldRetirement.resolve(undefined);
      else heldRetirement.reject(Error('Fixture callback retirement failed'));
      return tick();
    },
    pauseTimeout() {return timeout('pause');},
    retirementTimeout() {return timeout('retire');},
  };
}

const config = (review = 'matching', independent = true, pausePort = 'held', retirementPort = 'held') =>
  [review, independent, pausePort, retirementPort];
const start = (uuid = true, budget = 'valid', key = 'valid') => ['start', uuid, budget, key];
const revoke = (ok = true) => ['revokeReply', ok];
const pause = (response = 'exact') => ['pauseReply', response];
const retire = (ok = true) => ['retirementReply', ok];
const cases = [
  ['privacy-dispatches-while-both-cleanups-are-held', config(), [start(), revoke(), pause(), retire()]],
  ['both-cleanups-can-complete-before-revoke-readback', config(), [start(), retire(), pause(), revoke()]],
  ['immutable-review-survives-original-object-edit', config(), [start(), ['editOriginal'], pause(), revoke(), retire()]],
  ['already-paused-readback-still-requires-new-confirmed-revision', config('already-paused'), [start(), pause('revision'), revoke(), retire()]],
  ...['no-destination', 'no-control', 'duplicate', 'unmapped', 'wrong-connection', 'invalid-version',
    'wrong-side', 'wrong-provider', 'wrong-grant', 'invalid-revision'].map(profile =>
    ['optional-pause-refuses-' + profile, config(profile), [start(), revoke(), retire()]]),
  ...['none', 'origin', 'owner', 'agent', 'session', 'credential', 'generation', 'incomplete'].map(live =>
    ['independent-revoke-with-calendar-lease-' + live, config(), [['setCalendar', live], start(), retire(), revoke()]]),
  ...['version', 'revision', 'destination', 'mapping'].map(live =>
    ['fresh-source-fence-refuses-' + live, config(), [['setCalendar', live], start(), retire(), revoke()]]),
  ['shared-privacy-fence-refuses-stale-calendar-lease', config('matching', false), [['setCalendar', 'session'], start()]],
  ['independent-privacy-fence-refuses-before-cleanup', config(), [['setPrivacy', false], start()]],
  ['shared-privacy-ignores-unused-independent-port', config('matching', false), [['setPrivacy', false], start(), revoke(), pause(), retire()]],
  ['retired-calendar-downgrades-previous-confirmation', config(), [start(), pause(), ['setCalendar', 'generation'], retire(), revoke()]],
  ['retired-calendar-refuses-late-confirmation', config(), [start(), ['setCalendar', 'owner'], revoke(), pause(), retire()]],
  ['same-lease-new-source-version-keeps-already-admitted-readback', config(), [start(), ['setCalendar', 'version'], pause(), retire(), revoke()]],
  ['shared-privacy-lease-loss-suppresses-final-result', config('matching', false), [start(), revoke(), ['setCalendar', 'owner'], pause(), retire()]],
  ['cloud-privacy-loss-suppresses-final-result', config(), [start(), revoke(), ['setPrivacy', false], pause(), retire()]],
  ['timed-out-cleanups-ignore-both-late-replies', config(), [start(), revoke(), ['pauseTimeout'], ['retirementTimeout'], pause(), retire()]],
  ['retirement-timeout-does-not-abort-pause', config(), [start(), ['retirementTimeout'], pause(), revoke(), retire(false)]],
  ['caller-abort-cancels-pause-and-suppresses-return', config(), [start(), ['abort'], revoke(), pause(), retire()]],
  ['caller-abort-keeps-its-reason-after-pause-timeout', config(), [start(), ['abort'], ['pauseTimeout'], ['retirementTimeout'], revoke(), pause(), retire()]],
  ['failed-revoke-releases-parent-abort-listener-while-cleanup-observers-own-timers', config(),
    [start(), revoke(false), ['abort'], ['pauseTimeout'], ['retirementTimeout'], pause(), retire()]],
  ['failed-revoke-keeps-no-result-after-cleanups-complete', config(), [start(), retire(), pause(), revoke(false)]],
  ...['revision', 'destination', 'pending', 'running', 'malformed', 'reordered', 'failed'].map(response =>
    ['pause-readback-refuses-' + response, config(), [start(), revoke(), pause(response), retire()]]),
  ['retirement-rejection-is-unconfirmed-cleanup-only', config(), [start(), revoke(), retire(false), pause()]],
  ['missing-pause-and-retirement-ports-keep-privacy', config('matching', true, 'absent', 'absent'), [start(), revoke()]],
  ['synchronous-cleanup-throws-do-not-block-revoke', config('matching', true, 'throw', 'throw'), [start(), revoke()]],
  ...['blank', 'long'].map(key => ['optional-pause-refuses-key-' + key, config(), [start(true, 'valid', key), retire(), revoke()]]),
  ...['pause-low', 'pause-high', 'retirement-low', 'retirement-high', 'fraction'].map(budget =>
    ['invalid-cleanup-budget-' + budget, config(), [start(true, budget)]]),
  ['invalid-connection-uuid-refuses-before-cleanup', config(), [start(false)]],
  ['already-aborted-signal-refuses-before-all-ports', config(), [['abort'], start()]],
];

async function checkGoogleCalendarDisconnect(extraSources = []) {
  const compiled = await compile(extraSources), traces = [];
  for (const [name, args, steps] of cases) {
    const f = fixture(compiled, ...args), t = trace(name, f.observe(), call('initWith', ...args));
    for (const [operation, ...inputs] of steps) {
      await f[operation](...inputs);
      checkpoint(t, [operation, ...inputs].join(' '), call(operation, ...inputs), f.observe());
    }
    traces.push(t);
  }
  return checkTraces(boundInputs({model: 'GoogleCalendarDisconnect', sources: compiled.sources, traces,
    scope: 'bounded-orchestration', batchSize: 22, assumptions: [
      'Executes actual disconnectGoogleWithCalendar over controlled Calendar, Cloud revoke and callback-retirement ports. Read-only observation of the cleanup promises and a controlled timer scheduler expose independent settlements.',
      'One verified connection and source with exact lease, selected connector, grant, version, revision and operation key checks. Two finite timeouts, one revoke, and one attempt per cleanup port bound the campaign.',
      'Optional local cleanup and Cloud privacy authorization are separate. Returned callback retirement is no provider drain. Native access publication, installed transport and real provider effects are separate.',
    ]}));
}

test('Calendar cleanup and callback retirement settle independently of Google revoke', {timeout: scaledTimeout(120000)}, async () => {
  const receipt = await checkGoogleCalendarDisconnect([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 59);
  assert.equal(receipt.checkpoints, 272);
});
