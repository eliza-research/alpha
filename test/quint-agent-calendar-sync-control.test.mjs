import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {checkTraces, qmap} from '../specs/quint/refinement/check-traces.mjs';
import {boundInputs, call, captureSources, checkpoint, deferred, read, root, tick, trace} from '../specs/quint/refinement/application/support.mjs';

const implementation = 'apps/app/src/runtime/agent-calendar.ts';
const driver = fileURLToPath(import.meta.url);
const windowQuery = {timeZone: 'UTC'};
const noBinding = {owner: '', session: 0, scope: 0};
const noCandidate = {key: '', version: 0};
const noReview = {binding: noBinding, revision: 0, destination: '', paused: false, pending: false, candidates: [], visibleLocal: []};
const errors = new Map([
  ['Calendar owner changed', 'owner'], ['Calendar owner or agent changed', 'owner'],
  ['Calendar owner or agent changed; review sync again', 'owner'],
  ['Wait for the current Calendar source', 'busy'], ['Retain this sync operation key', 'key'],
  ['Keep or finish the current Calendar draft before changing sync', 'draft'],
  ['Calendar context changed; review sync again', 'context'],
  ['Saved app calendar changed; review preservation before continuing', 'preservation'],
  ['Choose a current authorized Google Calendar destination', 'source'],
  ['Calendar destination changed; review sync again', 'source-changed'],
  ['Calendar sync links could not be read', 'malformed'],
  ['Fixture linked Calendar transport failed', 'transport'],
]);

function source(key, overrides = {}) {
  return {provider: 'google', side: 'owner', connectorAccountId: 'connector-' + key, calendarId: 'calendar-' + key,
    grantId: 'grant-' + key, accessRole: key === 'primary' ? 'owner' : 'writer', selectionVersion: key === 'primary' ? 1 : 2,
    includeInFeed: true, ...overrides};
}

function destination(key) {
  const row = source(key);
  return {connectorAccountId: row.connectorAccountId, providerCalendarId: row.calendarId};
}

function sourcesFor(profile) {
  const eligible = ['primary', 'secondary'].filter(key => key === profile || profile === 'both').map(key => source(key));
  return {calendars: [...eligible, source('reader', {accessRole: 'reader'}),
    source('guest', {side: 'guest'}), source('built-in', {provider: 'eliza'})]};
}

function freshSources(profile, selected) {
  const variants = {
    exact: (row) => row,
    hidden: (row) => ({...row, includeInFeed: false}),
    'other-version': (row) => row.calendarId === selected.calendarId ? row : {...row, selectionVersion: row.selectionVersion + 1},
    version: (row) => ({...row, selectionVersion: row.selectionVersion + 1}),
    connector: (row) => ({...row, connectorAccountId: row.connectorAccountId + '-changed'}),
    reader: (row) => ({...row, accessRole: 'reader'}),
    guest: (row) => ({...row, side: 'guest'}),
    other: (row) => ({...row, provider: 'eliza'}),
  };
  return {calendars: profile === 'empty' ? [] : ['primary', 'secondary'].map(key => variants[profile](source(key)))};
}

function control(profile) {
  const revision = {unselected: 7, paused: 8, pending: 9, enabled: 10, removed: 11}[profile];
  const target = {paused: 'primary', pending: 'primary', enabled: 'secondary', removed: 'removed'}[profile];
  return {revision, paused: profile !== 'enabled', destination: target ? destination(target) : null,
    pendingDispatch: profile === 'pending' ? {linkId: 'held-link'} : null};
}

function legacy(profile = 'same') {
  return {fingerprint: profile === 'changed' ? 'changed' : 'initial', present: false,
    readable: profile !== 'unreadable', pending: profile === 'pending', records: []};
}

async function compile(extraSources) {
  const built = await build({absWorkingDir: root, entryPoints: [implementation], bundle: true,
    platform: 'node', format: 'cjs', write: false, metafile: true, plugins: [{name: 'linked-calendar-selected-source-observer',
      setup(builder) {
        builder.onLoad({filter: /\/runtime\/agent-calendar\.ts$/}, ({path}) => {
          const marker = "    const fresh=await api.getLifeOpsCalendars({side:'owner'});";
          const code = read(path);
          assert.equal(code.split(marker).length, 2, 'Exact selected Calendar source observer');
          return {loader: 'ts', contents: code.replace(marker, '    __selected(selected,signal);\n' + marker)};
        });
      }}]});
  const sources = [...Object.keys(built.metafile.inputs).filter(path => !path.startsWith('<')), driver, ...extraSources];
  captureSources(sources);
  return {code: built.outputFiles[0].text, sources};
}

async function fixture(compiled, initialStatus) {
  let portIdentity = {owner: 'A', session: 1, scope: 1}, usable = true, canChange = true, feedStatus = initialStatus;
  let review, issuing, lastId = 0;
  const attempts = new Map(), bySignal = new WeakMap(), sending = [], dispatches = [];
  const module = {exports: {}};
  new Function('module', 'exports', '__selected', compiled.code)(module, module.exports, (raw, signal) => {
    const attempt = bySignal.get(signal);
    assert.ok(attempt && ['select', 'resume'].includes(attempt.kind));
    attempt.selected = raw;
  });
  const {AgentCalendar, calendarSourceKey} = module.exports;
  const keys = new Map(['primary', 'secondary', 'removed'].map(key => [calendarSourceKey(source(key)), key]));
  const projectCandidate = row => row ? {key: keys.get(calendarSourceKey(row)), version: row.selectionVersion} : noCandidate;
  function projectDestination(row) {
    if (!row) return '';
    const result = ['primary', 'secondary', 'removed'].find(key => {
      const expected = destination(key);
      return row.connectorAccountId === expected.connectorAccountId && row.providerCalendarId === expected.providerCalendarId;
    });
    assert.ok(result, 'Readback destination carries both captured identity fields');
    return result;
  }
  function binding(raw) {
    if (!raw) return noBinding;
    const [owner, session, scope] = JSON.parse(raw);
    return {owner: JSON.parse(owner)[1].slice('owner-'.length),
      session: Number(session.slice('session-'.length)), scope: Number(scope.slice('scope-'.length))};
  }
  function projectReview(raw) {
    if (!raw) return noReview;
    return {binding: binding(raw.binding), revision: raw.control.revision, destination: projectDestination(raw.control.destination),
      paused: raw.control.paused, pending: !!raw.control.pendingDispatch, candidates: raw.sources.map(projectCandidate),
      visibleLocal: raw.visibleLocalEventIds};
  }
  function task(attempt, name) {
    assert.ok(attempt && !attempt.tasks.has(name), 'Transport dispatch belongs to one real attempt');
    const hold = deferred();
    attempt.tasks.set(name, hold);
    return hold.promise;
  }
  const port = () => {
    if (!portIdentity.owner) return null;
    const captured = portIdentity;
    return {identity: {origin: 'https://fixture.invalid', ownerId: 'owner-' + captured.owner, agentId: 'agent-' + captured.owner},
      sessionId: 'session-' + captured.session, scope: 'scope-' + captured.scope,
      current: () => usable && captured.owner === portIdentity.owner && captured.session === portIdentity.session && captured.scope === portIdentity.scope,
      async request(path, method, body, signal) {
        const url = new URL(path, 'https://fixture.invalid'), route = url.pathname.split('/').at(-1);
        if (route === 'links') {
          assert.equal(path, '/api/lifeops/calendar/links?view=events');
          assert.equal(method, 'GET'); assert.equal(body, undefined);
          assert.equal(issuing.kind, 'links'); assert.equal(signal, issuing.signal);
          issuing.phase = 'links';
          return task(issuing, 'links');
        }
        if (calendar.refreshing) {
          assert.equal(method, 'GET'); assert.equal(body, undefined);
          if (route === 'calendars') return sourcesFor('both');
          if (route === 'next-context') return {event: null, calendarFeedState: 'complete'};
          assert.equal(route, 'feed');
          return {state: feedStatus === 'ready' ? 'complete' : feedStatus, events: [
            {id: 'built-in', agentId: 'agent-' + captured.owner, provider: 'eliza', side: 'owner'},
            {id: 'google-row', agentId: 'agent-' + captured.owner, provider: 'google', side: 'owner'},
            {id: 'guest-row', agentId: 'agent-' + captured.owner, provider: 'eliza', side: 'guest'},
          ]};
        }
        const attempt = bySignal.get(signal);
        assert.ok(attempt, 'Actual Calendar request uses the preservation attempt signal');
        if (route === 'sync-control' && method === 'GET') {
          assert.equal(path, '/api/lifeops/calendar/sync-control');
          assert.equal(body, undefined); assert.equal(attempt.kind, 'review');
          attempt.phase = 'review';
          return task(attempt, 'control');
        }
        if (route === 'calendars') {
          assert.equal(path, '/api/lifeops/calendar/calendars?side=owner');
          assert.equal(method, 'GET'); assert.equal(body, undefined);
          if (attempt.kind === 'review') return task(attempt, 'sources');
          assert.ok(attempt.selected);
          attempt.phase = 'fresh';
          return task(attempt, 'fresh');
        }
        assert.equal(path, '/api/lifeops/calendar/sync-control');
        assert.equal(method, 'POST');
        const expected = {operation: attempt.kind, expectedRevision: attempt.captured.control.revision, idempotencyKey: 'op-' + attempt.id};
        if (attempt.kind === 'select') expected.destination = destination(keys.get(calendarSourceKey(attempt.selected)));
        assert.deepEqual(body, expected);
        assert.equal(sending.at(-1), attempt.id, 'Sending callback precedes the actual linked control POST');
        dispatches.push({id: attempt.id, binding: captured, operation: body.operation, revision: body.expectedRevision,
          destination: projectDestination(body.destination), key: Number(body.idempotencyKey.slice('op-'.length))});
        attempt.phase = 'write';
        return task(attempt, 'write');
      },
    };
  };
  const calendar = new AgentCalendar(port, {
    capture(signal) {
      if (!issuing) return Promise.resolve(legacy());
      assert.notEqual(issuing.kind, 'links');
      issuing.phase = 'preservation';
      issuing.signal = signal;
      bySignal.set(signal, issuing);
      return task(issuing, 'preservation');
    },
    retainedReadOnly() {throw Error('No fixture legacy Calendar');},
  });
  await calendar.refresh(windowQuery);

  function finish(attempt, outcome) {
    attempt.phase = 'done';
    attempt.outcome = outcome;
    attempt.aborted = attempt.signal?.aborted ?? false;
  }
  function response(id, name, input, body) {
    const attempt = attempts.get(id), held = attempt.tasks.get(name);
    assert.ok(held && held.response === undefined, 'Real held request can settle exactly once');
    held.response = input;
    if (input === 'failed' || input === 0) held.reject(Error('Fixture linked Calendar transport failed'));
    else held.resolve(body());
    return tick();
  }
  return {
    observe() {
      const active = calendar.state.mutating ? [...attempts.values()].find(attempt =>
        attempt.epoch === calendar.epoch && ['preservation', 'review', 'fresh', 'write'].includes(attempt.phase))?.id : 0;
      assert.notEqual(active, undefined);
      return {'s.port': portIdentity, 's.usable': usable, 's.bound': binding(calendar.binding), 's.epoch': calendar.epoch,
        's.status': calendar.state.status, 's.canChange': canChange, 's.active': active, 's.lastId': lastId,
        's.review': projectReview(review), 's.sending': sending, 's.dispatches': dispatches,
        's.attempts': qmap([...attempts].map(([id, attempt]) =>
          [id, {kind: attempt.kind, phase: attempt.phase, binding: attempt.binding,
            epoch: attempt.epoch, key: attempt.key, target: attempt.target, captured: projectReview(attempt.captured),
            selected: projectCandidate(attempt.selected), control: attempt.tasks.get('control')?.response ?? '',
            sources: attempt.tasks.get('sources')?.response ?? '', reviewStarted: attempt.tasks.has('control') && attempt.tasks.has('sources'),
            aborted: attempt.phase === 'done' ? attempt.aborted : !!attempt.signal?.aborted, outcome: attempt.outcome,
            returnedRevision: attempt.returnedRevision, links: attempt.links}]))};
    },
    setPort(owner, session, scope, enabled) {portIdentity = {owner, session, scope}; usable = enabled;},
    setDraft(allowed) {canChange = allowed;},
    async refresh(status) {feedStatus = status; await calendar.refresh(windowQuery);},
    retire() {calendar.retire();},
    async start(kind, target, key) {
      const id = ++lastId;
      const attempt = {id, kind, key, target, binding: portIdentity, epoch: calendar.epoch, tasks: new Map(),
        captured: ['review', 'links'].includes(kind) ? undefined : review, phase: '', outcome: 'pending', returnedRevision: 0, links: []};
      attempts.set(id, attempt);
      issuing = attempt;
      let operation;
      if (kind === 'review') operation = calendar.reviewSync();
      else if (kind === 'links') {
        attempt.abort = new AbortController();
        attempt.signal = attempt.abort.signal;
        operation = calendar.listLinkedEvents(attempt.signal);
      } else {
        const selectedKey = target ? calendarSourceKey(source(target)) : undefined;
        operation = calendar.changeSync(review, kind, key ? 'op-' + id : ' ', () => canChange,
          selectedKey, () => {sending.push(id);});
      }
      issuing = undefined;
      void operation.then(result => {
        if (kind === 'review') {review = result; finish(attempt, 'reviewed');}
        else if (kind === 'links') {attempt.links = result.map(link => link.id); finish(attempt, 'listed');}
        else {attempt.returnedRevision = result.revision; finish(attempt, 'changed');}
      }, error => {
        const outcome = error.name === 'AbortError' ? 'aborted' : errors.get(error.message);
        assert.ok(outcome, error.stack);
        finish(attempt, outcome);
      });
      await tick();
    },
    preserve(id, input) {return response(id, 'preservation', input, () => legacy(input));},
    controlReply(id, input) {return response(id, 'control', input, () => control(input));},
    sourceReply(id, input) {return response(id, 'sources', input, () => sourcesFor(input));},
    freshReply(id, input) {return response(id, 'fresh', input, () => freshSources(input, attempts.get(id).selected));},
    writeReply(id, revision) {return response(id, 'write', revision, () => ({...control('enabled'), revision}));},
    cancelLinks(id) {attempts.get(id).abort.abort();},
    linkReply(id, input) {return response(id, 'links', input, () => ({links: input === 'malformed' ? null :
      input === 'held' ? [{id: 'held-link', state: 'conflicted', event: null}] : []}));},
  };
}

const start = (kind, target = '', key = true) => ['start', kind, target, key];
const preserve = (id = 1, input = 'same') => ['preserve', id, input];
const controlRead = (input = 'paused', id = 1) => ['controlReply', id, input];
const sourcesRead = (input = 'both', id = 1) => ['sourceReply', id, input];
const fresh = (input = 'exact', id = 2) => ['freshReply', id, input];
const write = (revision = 12, id = 2) => ['writeReply', id, revision];
const links = (input = 'empty', id = 1) => ['linkReply', id, input];
const review = [start('review'), preserve(), controlRead(), sourcesRead()];
const select = [start('select', 'primary'), preserve(2)];
const resume = [start('resume'), preserve(2)];
const cases = [
  ['review-waits-for-both-and-filters-authorized-sources', 'ready', [start('review'), preserve(), sourcesRead(), controlRead()]],
  ['review-transport-rejection-settles-before-sibling', 'ready', [start('review'), preserve(), controlRead('failed'), sourcesRead()]],
  ['source-list-failure-refuses-review', 'ready', [start('review'), preserve(), sourcesRead('failed'), controlRead()]],
  ['initial-preservation-failure-refuses-review', 'ready', [start('review'), preserve(1, 'failed')]],
  ...['changed', 'pending', 'unreadable'].map(input =>
    ['mutation-preservation-' + input, 'ready', [...review, start('pause'), preserve(2, input)]]),
  ['partial-feed-selects-exact-destination-at-captured-revision', 'partial', [...review, start('select', 'secondary'), preserve(2), fresh(), write(13)]],
  ['hidden-current-source-can-still-be-a-sync-destination', 'ready', [...review, ...select, fresh('hidden'), write()]],
  ['another-source-version-does-not-invalidate-exact-selection', 'ready', [...review, ...select, fresh('other-version'), write()]],
  ['unavailable-feed-allows-reviewed-resume', 'unavailable', [...review, ...resume, fresh(), write()]],
  ['saved-destination-missing-from-review-refuses-resume', 'ready', [start('review'), preserve(), controlRead('removed'), sourcesRead(),
    start('resume'), preserve(2)]],
  ['select-target-outside-captured-sources-refuses-before-fresh-read', 'ready', [start('review'), preserve(), controlRead(), sourcesRead('primary'),
    start('select', 'secondary'), preserve(2)]],
  ...['version', 'connector', 'reader', 'guest', 'other', 'empty', 'failed'].map(input =>
    ['fresh-destination-refusal-' + input, 'ready', [...review, ...select, fresh(input)]]),
  ['draft-refusal-before-preservation-and-after-fresh-sources', 'ready', [...review, ['setDraft', false], start('pause'),
    ['setDraft', true], start('select', 'primary'), preserve(3), ['setDraft', false], fresh('exact', 3)]],
  ['pause-rechecks-draft-without-destination-read', 'ready', [...review, start('pause'), ['setDraft', false], preserve(2)]],
  ['blank-key-refuses-before-preservation', 'ready', [...review, start('select', 'primary', false)]],
  ['paused-recovery-preserves-exact-expected-revision', 'ready', [start('review'), preserve(), controlRead('pending'), sourcesRead(),
    start('recover'), preserve(2), write()]],
  ['remote-control-rejection-does-not-invent-revision', 'ready', [...review, start('pause'), preserve(2), write(0)]],
  ['same-owner-new-scope-cannot-use-old-review', 'ready', [...review, ['setPort', 'A', 1, 2, true], ['retire'],
    ['refresh', 'ready'], start('pause')]],
  ['session-replacement-refuses-fresh-read', 'ready', [...review, ...resume, ['setPort', 'A', 2, 1, true], fresh()]],
  ['retired-review-sibling-and-successor-remain-independent', 'ready', [start('review'), preserve(), sourcesRead(),
    ['setPort', 'B', 2, 2, true], ['retire'], ['refresh', 'ready'], start('review'), preserve(2),
    controlRead('enabled', 2), controlRead(), sourcesRead('secondary', 2)]],
  ['retired-post-result-cannot-clear-successor-preservation', 'ready', [...review, start('pause'), preserve(2),
    ['setPort', 'B', 2, 1, true], ['retire'], ['refresh', 'ready'], start('review'), write(), preserve(3),
    sourcesRead('empty', 3), controlRead('unselected', 3)]],
  ['link-read-with-active-control-and-independent-cancellation', 'ready', [...review, start('pause'), start('links'),
    ['cancelLinks', 3], links('held', 3), preserve(2), write()]],
  ['link-read-shows-exact-held-link', 'ready', [start('links'), links('held')]],
  ['link-read-rejects-malformed-and-failed-envelope', 'ready', [start('links'), links('malformed'),
    start('links'), links('failed', 2)]],
  ['link-read-rejects-session-retirement', 'ready', [start('links'), ['setPort', 'A', 2, 1, true], links('held')]],
  ['link-read-rejects-calendar-retirement-before-settlement', 'ready', [start('links'), ['retire'], links('held')]],
  ['link-read-keeps-same-live-binding-across-new-calendar-epoch', 'ready', [start('links'), ['retire'],
    ['refresh', 'partial'], links('held')]],
  ['link-read-refuses-unusable-bound-port-before-dispatch', 'ready', [['setPort', 'A', 1, 1, false], start('links')]],
];

async function checkAgentCalendarSyncControl(extraSources = []) {
  const compiled = await compile(extraSources), traces = [];
  for (const [name, status, steps] of cases) {
    const f = await fixture(compiled, status), t = trace(name, f.observe(), call('initWith', status));
    try {
      for (const [operation, ...args] of steps) {
        await f[operation](...args);
        checkpoint(t, [operation, ...args].join(' '), call(operation, ...args), f.observe());
      }
      traces.push(t);
    } finally {f.retire();}
  }
  return checkTraces(boundInputs({model: 'AgentCalendarSyncControl', sources: compiled.sources, traces,
    scope: 'bounded-orchestration', batchSize: 18, assumptions: [
      'Executes current AgentCalendar and its default shared Calendar client through held AppRecordPort replies. One read-only observer captures the selected source used by the actual revalidation code.',
      'Two owner, session and scope identities, two selected destinations, eight Calendar epochs and seven attempts. Inputs include exact provider revision, grant, connector, Calendar ID, role and selectionVersion classes.',
      'Draft admissibility is a controlled renderer callback. Visible approval dialog, Google grant onboarding, provider replay/effects and external transport settlement are separate.',
    ]}));
}

test('linked Calendar control retains exact current review and destination ownership through readback', {timeout: scaledTimeout(180000)}, async () => {
  const receipt = await checkAgentCalendarSyncControl([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 36);
  assert.equal(receipt.checkpoints, 267);
});
