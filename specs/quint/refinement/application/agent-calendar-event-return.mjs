import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkTraces, qmap} from '../check-traces.mjs';
import {boundInputs, bundledSource, call, captureSources, checkpoint, deferred, tick, trace} from './support.mjs';

const driver = fileURLToPath(import.meta.url);
const implementation = 'apps/app/src/runtime/agent-calendar.ts';
const originHelper = 'apps/app/src/runtime/maps-event-return.ts';
const startAt = '2027-01-15T12:00:00.000Z';
const begin = Date.parse(startAt);
const range = {timeMin: '2027-01-01T00:00:00.000Z', timeMax: '2027-02-01T00:00:00.000Z', timeZone: 'UTC'};
const source = {provider: 'google', side: 'owner', grantId: 'fixture-grant', connectorAccountId: 'primary',
  calendarId: 'fixture-calendar', includeInFeed: true, accessRole: 'owner', selectionVersion: 1};
const noRef = {key: '', version: '', source: ''};
const noAttempt = {reference: noRef, epoch: 0, owner: '', session: 0, scope: 0,
  cancelled: false, dispatched: false, feed: '', sources: '', outcome: ''};

function event(owner, connector = 'primary', etag = 'v1') {
  return {id: 'fixture-event', externalId: 'provider-event', agentId: 'agent-' + owner,
    provider: source.provider, side: source.side, grantId: source.grantId, calendarId: source.calendarId,
    connectorAccountId: connector, startAt, endAt: '2027-01-15T13:00:00.000Z', status: 'confirmed',
    title: 'Fixture event', location: 'Private location fixture', metadata: {etag}};
}

function sourceRows(profile) {
  const first = {...source, connectorAccountId: ['different-connector', 'loose-alt'].includes(profile) ? 'alternate' : 'primary',
    includeInFeed: profile !== 'hidden'};
  return profile === 'ambiguous-source' ? [first, {...first, includeInFeed: false}] : [first];
}

function publication(profile, owner, window, syncedAt) {
  const row = event(owner, ['loose', 'loose-alt'].includes(profile) ? null : 'primary');
  if (profile === 'updated') row.metadata.etag = 'v2';
  if (profile === 'padded') row.metadata.etag = ' v1 ';
  if (profile === 'no-etag') row.metadata = {};
  if (profile === 'no-grant') row.grantId = '';
  return {...window, calendarId: source.calendarId, source: 'synced', sources: [], syncedAt,
    state: 'complete', events: profile === 'none' ? [] : [row]};
}

function readError(error) {
  if (error.name === 'AbortError') return 'aborted';
  if (error.name === 'RangeError') return 'date';
  if (error.message === 'Calendar owner or agent changed') return 'owner';
  if (error.message === 'Fixture Calendar transport refused') return 'transport';
  throw error;
}

async function fixture(actual, initialProfile) {
  const {AgentCalendar, calendarEventKey, calendarSourceKey} = actual.calendar;
  const {canonicalMapsEventOriginFor, mapsEventOriginOf} = actual.origin;
  const keyOf = new Map([[calendarEventKey(event('A')), 'event'], [calendarEventKey(event('A', null)), 'loose']]);
  const digests = new Map();
  for (const connector of ['primary', 'alternate']) {
    const key = calendarSourceKey({...source, connectorAccountId: connector});
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    digests.set(Buffer.from(digest).toString('hex'), connector);
  }
  const projectRef = reference => reference ? {key: reference.eventKey ? keyOf.get(reference.eventKey) ?? 'other' : '',
    version: reference.revision || '', source: digests.get(reference.sourceRevision) ?? (reference.sourceRevision ? 'other' : '')} : noRef;
  const attempts = new Map(), feedProfiles = new Map(), refreshTasks = new Map();
  let owner = 'A', session = 1, scope = 1, current = true, profile = initialProfile;
  let origin, lastId = 0, launching, holdingRefresh = false, reread, mutation, mutationCapture, publications = 0, feedId = 0;

  const port = () => {
    if (!owner) return null;
    const capturedOwner = owner, capturedSession = session, capturedScope = scope;
    return {identity: {origin: 'https://fixture.invalid', ownerId: 'owner-' + capturedOwner, agentId: 'agent-' + capturedOwner},
      sessionId: 'session-' + capturedSession, scope: 'scope-' + capturedScope,
      current: () => current && owner === capturedOwner && session === capturedSession && scope === capturedScope,
      async request(path, method, body, signal) {
        assert.equal(method, 'GET', 'Calendar event verification never dispatches a write');
        assert.equal(body, undefined);
        const url = new URL(path, 'https://fixture.invalid'), kind = url.pathname.split('/').at(-1);
        assert.ok(['feed', 'calendars', 'next-context'].includes(kind), path);
        if (launching) {
          const {input, abort, tasks} = launching;
          assert.ok(!tasks.has(kind));
          assert.equal(signal.aborted, abort.signal.aborted);
          assert.ok(kind === 'feed' || kind === 'calendars');
          if (kind === 'feed') assert.deepEqual([...url.searchParams], [
            ['timeMin', new Date(input.begin - 1).toISOString()],
            ['timeMax', new Date(input.begin + 1).toISOString()], ['timeZone', 'UTC'],
          ]);
          else assert.equal(url.search, '', 'Return verification reads the current source list unfiltered');
          const task = {...deferred(), signal, capturedOwner, window: Object.fromEntries(url.searchParams)};
          tasks.set(kind, task);
          return task.promise;
        }
        if (kind === 'next-context') return {event: null, calendarFeedState: 'complete'};
        if (holdingRefresh) {
          assert.ok(!refreshTasks.has(kind));
          const task = {...deferred(), capturedOwner, window: Object.fromEntries(url.searchParams)};
          refreshTasks.set(kind, task);
          return task.promise;
        }
        if (kind === 'calendars') return {calendars: sourceRows(profile)};
        const feed = publication(profile, capturedOwner, Object.fromEntries(url.searchParams), new Date(begin + ++feedId).toISOString());
        feedProfiles.set(feed.syncedAt, profile);
        return feed;
      },
    };
  };
  const calendar = new AgentCalendar(port, {
    capture: () => mutationCapture?.promise ?? Promise.resolve({fingerprint: 'clean', present: false, readable: true, pending: false, records: []}),
    retainedReadOnly: () => {throw Error('Unexpected legacy retention');},
  });
  const unsubscribe = calendar.subscribe(() => {publications++;});
  await calendar.refresh(range);

  async function readOnly(action) {
    const before = calendar.state, beforePublish = publications;
    await action();
    await tick();
    assert.equal(calendar.state, before, 'Event-return actions never replace Calendar state');
    assert.equal(publications, beforePublish, 'Event-return actions never publish Calendar state');
  }

  function selected() {
    const row = calendar.state.feed?.events[0];
    if (!row) return {};
    const key = calendarEventKey(row), selection = calendar.selection(key);
    return {row, key, selection};
  }

  function feedReply(attempt, task, response) {
    const loose = keyOf.get(attempt.input.eventKey) === 'loose';
    const row = event(task.capturedOwner, loose ? null : 'primary', attempt.input.revision);
    if (response === 'moved') row.startAt = '2027-01-15T12:01:00.000Z';
    if (response === 'changed') row.metadata.etag = 'new-version';
    if (response === 'padded') row.metadata.etag = ' ' + row.metadata.etag + ' ';
    if (response === 'cancelled') row.status = 'cancelled';
    const events = response === 'missing' ? [] : response === 'ambiguous' ? [row, {...row}] :
      response === 'foreign' ? [row, {...row, agentId: 'foreign-agent', id: 'unrelated'}] : [row];
    return {...task.window, state: response === 'partial' ? 'partial' : 'complete', events,
      ...(response === 'wrong-window' ? {timeMax: range.timeMax} : {})};
  }

  function sourcesReply(response) {
    const row = {...source};
    if (response === 'missing') return {calendars: []};
    if (response === 'hidden') row.includeInFeed = false;
    if (response === 'blocked') row.accessRole = 'freeBusyReader';
    if (response === 'wrong-connector') row.connectorAccountId = 'alternate';
    if (response === 'writer' || response === 'reader') row.accessRole = response;
    return {calendars: response === 'ambiguous' ? [row, {...row}] :
      response === 'mixed' ? [row, {...row, includeInFeed: false}] : [row]};
  }

  function reply(id, kind, response) {
    return readOnly(() => {
      const attempt = attempts.get(id), task = attempt.tasks.get(kind);
      assert.ok(task && !task.response, 'Each transport request settles once');
      task.response = response;
      if (response === 'failed') task.reject(Error('Fixture Calendar transport refused'));
      else task.resolve(kind === 'feed' ? feedReply(attempt, task, response) : sourcesReply(response));
    });
  }

  return {
    observe() {
      const {key, selection} = selected();
      if (selection) {
        assert.equal(selection.kind, 'canonical-calendar-event');
        assert.equal(selection.id, 'fixture-event');
        assert.equal(selection.accountId, source.grantId);
      }
      const [boundOwner, boundSession, boundScope] = calendar.binding ? JSON.parse(calendar.binding) : ['', 'session-0', 'scope-0'];
      return {'s.portOwner': owner, 's.portSession': session, 's.portScope': scope, 's.portCurrent': current,
        's.owner': boundOwner ? JSON.parse(boundOwner)[1].slice('owner-'.length) : '',
        's.session': Number(boundSession.slice('session-'.length)), 's.scope': Number(boundScope.slice('scope-'.length)),
        's.epoch': calendar.epoch, 's.profile': feedProfiles.get(calendar.state.feed?.syncedAt) ?? 'absent',
        's.selection': projectRef(selection && {...selection, eventKey: key}), 's.origin': projectRef(origin),
        's.refreshing': calendar.refreshing, 's.mutating': calendar.state.mutating, 's.lastId': lastId,
        's.attempts': qmap(Array.from({length: 4}, (_, index) => {
          const id = index + 1, attempt = attempts.get(id);
          if (!attempt) return [id, noAttempt];
          const feed = attempt.tasks.get('feed'), sources = attempt.tasks.get('calendars');
          assert.equal(!!feed, !!sources, 'The actual API starts both reads together');
          return [id, {reference: projectRef(attempt.input), epoch: attempt.epoch, owner: attempt.owner,
            session: attempt.session, scope: attempt.scope, cancelled: attempt.abort.signal.aborted,
            dispatched: !!feed, feed: feed?.response ?? '', sources: sources?.response ?? '', outcome: attempt.outcome}];
        }))};
    },
    setPort(nextOwner, nextSession, nextScope, enabled) {owner = nextOwner; session = nextSession; scope = nextScope; current = enabled;},
    async refresh(nextProfile) {profile = nextProfile; await calendar.refresh(range);},
    async startReread() {
      const before = calendar.state.feed;
      holdingRefresh = true;
      reread = calendar.refresh(range);
      await tick();
      assert.equal(calendar.state.feed, before, 'Same-window read keeps the exact shown feed');
      assert.equal(refreshTasks.size, 2);
    },
    async finishReread(nextProfile) {
      const feedTask = refreshTasks.get('feed');
      const feed = publication(nextProfile, feedTask.capturedOwner, feedTask.window, new Date(begin + ++feedId).toISOString());
      feedProfiles.set(feed.syncedAt, nextProfile);
      feedTask.resolve(feed);
      refreshTasks.get('calendars').resolve({calendars: sourceRows(nextProfile)});
      await reread;
      holdingRefresh = false;
      refreshTasks.clear();
    },
    retire() {calendar.retire();},
    startMutation() {
      mutationCapture = deferred();
      const first = calendar.state.calendars[0];
      mutation = calendar.create(calendarSourceKey(first), {title: 'Unused fixture draft', idempotencyKey: 'fixture-op'});
      void mutation.catch(() => {});
      assert.equal(calendar.state.mutating, true);
    },
    async finishMutation() {
      mutationCapture.reject(Error('Stop fixture at preservation gate'));
      await assert.rejects(mutation, /Stop fixture at preservation gate/);
      mutationCapture = undefined;
    },
    capture() {
      return readOnly(() => {
        const {row, key, selection} = selected();
        origin = canonicalMapsEventOriginFor({canonicalEvent: row, canonicalEventKey: key,
          id: 'fixture-row', title: row?.title, off: 0}, 0, calendar.binding, selection);
        if (origin) {
          assert.deepEqual(mapsEventOriginOf(origin), origin);
          assert.deepEqual(Object.keys(origin).sort(), ['begin', 'binding', 'day', 'eventKey', 'id', 'revision',
            'rowId', 'sourceRevision', 'title', 'version']);
          assert.equal(origin.begin, begin);
          assert.equal(origin.binding, calendar.binding);
        }
      });
    },
    start(issue) {
      return readOnly(() => {
        const input = origin ? {...origin} : {eventKey: '', revision: '', sourceRevision: '', begin};
        if (issue === 'key') input.eventKey = 'other-event';
        if (issue === 'version') input.revision = 'other';
        if (issue === 'source') input.sourceRevision = 'f'.repeat(64);
        if (issue === 'unsafe') input.begin = 1.5;
        if (issue === 'overflow') input.begin = Number.MAX_SAFE_INTEGER;
        const abort = new AbortController();
        if (issue === 'pre-abort') abort.abort();
        const attempt = {input, abort, owner, session, scope, epoch: calendar.epoch, tasks: new Map(), outcome: 'pending'};
        attempts.set(++lastId, attempt);
        launching = attempt;
        void calendar.verifyEventReturn(input, abort.signal).then(
          result => {attempt.outcome = result;}, error => {attempt.outcome = readError(error);});
        launching = undefined;
      });
    },
    cancel(id) {
      return readOnly(() => {
        const attempt = attempts.get(id);
        attempt.abort.abort();
        for (const task of attempt.tasks.values()) assert.equal(task.signal.aborted, true);
      });
    },
    feedReply(id, response) {return reply(id, 'feed', response);},
    sourcesReply(id, response) {return reply(id, 'calendars', response);},
    dispose() {unsubscribe(); calendar.retire();},
  };
}

const capture = ['capture'];
const start = (issue = 'exact') => ['start', issue];
const feed = (response = 'exact', id = 1) => ['feedReply', id, response];
const sources = (response = 'owner', id = 1) => ['sourcesReply', id, response];
const attempt = [capture, start()];
const cases = [
  ['source-first-waits-for-exact-feed', 'normal', [...attempt, sources('reader'), feed()]],
  ['feed-first-waits-for-one-readable-source', 'normal', [...attempt, feed(), sources('mixed')]],
  ['optional-connector-matches-current-source', 'loose', [...attempt, sources('wrong-connector'), feed()]],
  ['current-hidden-selection-needs-fresh-readable-source', 'hidden', [...attempt, feed(), sources('writer')]],
  ...['none', 'no-etag', 'no-grant', 'ambiguous-source', 'different-connector'].map(profile =>
    ['selection-refuses-' + profile, profile, [capture, start()]]),
  ['stale-revision-or-source-never-dispatches', 'normal', [capture, start('version'), start('source'), start('key')]],
  ['unsafe-date-refuses-and-overflow-rejects-before-dispatch', 'normal', [capture, start('unsafe'), start('overflow'), start('pre-abort')]],
  ['retired-binding-cannot-start', 'normal', [capture, ['setPort', 'A', 2, 1, true], start(), ['setPort', '', 2, 1, false], start()]],
  ['trimmed-selection-requires-exact-provider-readback', 'padded', [...attempt, feed('padded'), sources()]],
  ...['missing', 'moved', 'changed', 'cancelled', 'partial', 'wrong-window', 'foreign', 'ambiguous'].map(response =>
    ['feed-readback-' + response, 'normal', [...attempt, feed(response), sources()]]),
  ...['hidden', 'blocked', 'missing', 'wrong-connector', 'ambiguous'].map(response =>
    ['source-readback-' + response, 'normal', [...attempt, sources(response), feed()]]),
  ['feed-rejection-settles-before-source', 'normal', [...attempt, feed('failed'), sources()]],
  ['source-rejection-settles-before-feed', 'normal', [...attempt, sources('failed'), feed()]],
  ['cancelled-request-refuses-first-delivered-reply', 'normal', [...attempt, ['cancel', 1], feed(), sources()]],
  ['transport-failure-precedes-cancellation-readback', 'normal', [...attempt, sources(), ['cancel', 1], feed('failed')]],
  ['replacement-owner-refuses-delivered-reply', 'normal', [...attempt, ['setPort', 'B', 2, 1, true], feed(), sources()]],
  ['replacement-scope-refuses-delivered-reply', 'normal', [...attempt, sources(), ['setPort', 'A', 1, 2, true], feed()]],
  ['calendar-retirement-rejects-after-both-reads', 'normal', [...attempt, ['retire'], feed(), sources()]],
  ['same-epoch-new-version-refuses-old-selection', 'normal', [capture, ['startReread'], start(), feed(), ['finishReread', 'updated'], sources()]],
  ['same-epoch-new-source-digest-refuses-old-selection', 'loose', [capture, ['startReread'], start(), sources(), ['finishReread', 'loose-alt'], feed()]],
  ['same-epoch-retained-selection-remains-eligible', 'normal', [capture, ['startReread'], start(), ['finishReread', 'normal'], feed(), sources()]],
  ['new-attempt-can-succeed-while-older-epoch-settles', 'normal', [...attempt, ['refresh', 'updated'],
    capture, start(), feed(), sources(), sources('owner', 2), feed('exact', 2)]],
  ['mutation-blocks-new-return-and-withholds-held-return', 'normal', [...attempt, feed(), ['startMutation'],
    start(), sources(), ['finishMutation'], start(), feed('exact', 3), sources('owner', 3)]],
];

export async function checkAgentCalendarEventReturn(extraSources = []) {
  const [calendar, origin] = await Promise.all([bundledSource(implementation), bundledSource(originHelper)]);
  const inputs = [...calendar.sources, ...origin.sources, driver, ...extraSources];
  captureSources(inputs);
  const actual = {calendar: calendar.exports, origin: origin.exports};
  const traces = [];
  for (const [name, profile, steps] of cases) {
    const f = await fixture(actual, profile);
    const t = trace(name, f.observe(), call('initWith', profile));
    try {
      for (const [operation, ...args] of steps) {
        await f[operation](...args);
        checkpoint(t, [operation, ...args].join(' '), call(operation, ...args), f.observe());
      }
      traces.push(t);
    } finally {f.dispose();}
  }
  return checkTraces(boundInputs({model: 'AgentCalendarEventReturn', sources: inputs, traces, scope: 'bounded-orchestration',
    assumptions: [
      'Executes AgentCalendar, its default client, the installed shared Calendar API and the canonical Maps origin helper. Controlled AppRecordPort replies hold feed and source independently.',
      'Finite profiles include absent or ambiguous visible selection, revision and source-digest changes, source access, date classes, two bindings, eight epochs and four return attempts.',
      'The port supplies synthetic provider response classes and an explicit current binding. The mounted Maps return and navigation, native Calendar origin, provider effects and linked control are separate.',
    ]}));
}
