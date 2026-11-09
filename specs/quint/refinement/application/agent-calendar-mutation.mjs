import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkTraces, qmap} from '../check-traces.mjs';
import {boundInputs, call, checkpoint, deferred, tick, trace} from './support.mjs';
import {buildAgentCalendar} from './agent-calendar-refresh.mjs';

const driver = fileURLToPath(import.meta.url);
const windows = [null, {timeZone: 'UTC'}, {timeZone: 'Europe/London'}];
const source = {provider: 'google', side: 'owner', grantId: 'fixture-grant', connectorAccountId: 'fixture-account',
  calendarId: 'fixture-calendar', includeInFeed: true, accessRole: 'owner', selectionVersion: 1};
const emptyJob = {phase: '', epoch: 0, owner: '', session: 0, kind: '', issue: '', profile: '', aborted: false};
const expected = new Map([
  ['Choose an authorized Calendar source', 'source'],
  ['Retain this draft operation key', 'id'],
  ['Retain this deletion operation key', 'id'],
  ['Refresh this event before editing', 'event'],
  ['The provider version changed or is read only', 'version'],
  ['Choose occurrence or series scope before changing a repeating event', 'scope'],
  ['Moving events between sources requires a separate supported action', 'move'],
  ['Organizer disposition is unavailable; no cancellation was sent', 'disposition'],
  ['Wait for the current Calendar source', 'busy'],
  ['Calendar owner changed', 'owner'],
  ['Calendar owner or agent changed', 'owner'],
  ['Saved app calendar changed; review preservation before continuing', 'preservation'],
  ['Created event owner could not be verified', 'foreign'],
  ['Updated event source could not be verified', 'foreign'],
  ['Fixture transport refusal', 'transport'],
]);
const queryId = raw => raw ? windows.findIndex(window => JSON.stringify(window) === raw) : 0;
const ownerId = raw => raw ? JSON.parse(raw)[1].replace(/^owner-/, '') : '';
const feedState = status => status === 'ready' ? 'complete' : status;
const legacySnapshot = result => ({fingerprint: result === 'changed' ? 'changed' : 'initial',
  present: false, readable: result !== 'unreadable', pending: result === 'pending', records: []});

async function fixture(compiled, status, profile) {
  const module = {exports: {}}, outcomes = new Map(), jobs = new Map(), profiles = new WeakMap(), dispatched = [];
  let owner = 'A', session = 1, current = true, lastId = 0;
  let issuing, heldRead, readDone, holdReads = false;
  new Function('module', 'exports', '__clock', compiled.code)(module, module.exports, {now: () => 0});
  const {AgentCalendar, calendarSourceKey, calendarEventKey} = module.exports;
  const port = () => {
    if (!owner) return null;
    const chosen = owner, activeSession = session;
    return {identity: {origin: 'https://fixture.invalid', ownerId: 'owner-' + chosen, agentId: 'agent-' + chosen},
      sessionId: 'session-' + activeSession, scope: 'fixture-scope',
      current: () => current && owner === chosen && session === activeSession};
  };
  function event(profile, agent) {
    const row = {id: 'fixture-event', externalId: 'provider-event', agentId: 'agent-' + agent,
      provider: profile === 'readonly' ? 'ics' : source.provider, side: source.side, grantId: source.grantId,
      connectorAccountId: source.connectorAccountId, calendarId: source.calendarId,
      startAt: '2027-01-15T12:00:00Z', endAt: '2027-01-15T13:00:00Z', title: 'Fixture event',
      organizer: profile === 'email' ? {email: ' Owner@fixture.invalid '} :
        ['unknown', 'invitee'].includes(profile) ? null : {self: true},
      accountEmail: profile === 'email' ? 'owner@fixture.invalid' : null,
      attendees: profile === 'invitee' ? [{self: true, organizer: false}] : [],
      ...(profile === 'recurring' ? {recurringEventId: 'fixture-series'} : {}),
      metadata: profile === 'unversioned' ? {} : {etag: 'v1'},
    };
    profiles.set(row, profile);
    return row;
  }
  function dispatch(target, signal, kind, external, body) {
    const entry = [...jobs].find(([, job]) => job.phase === 'preservation' && job.signal === signal);
    assert.ok(entry, 'Real provider dispatch belongs to a held preservation check');
    const [id, job] = entry;
    assert.equal(job.kind, kind);
    assert.ok(body.idempotencyKey === '' || body.idempotencyKey === 'op-' + id);
    if (kind !== 'delete') assert.equal(body.title, 'Fixture change');
    job.phase = 'remote';
    job.remote = deferred();
    dispatched.push({id, owner: target.identity.ownerId.slice('owner-'.length),
      session: Number(target.sessionId.slice('session-'.length)), kind, side: body.side,
      grant: body.grantId, calendar: body.calendarId, external,
      version: body.expectedProviderVersion ?? '', scope: body.recurrenceScope ?? '',
      cancellation: body.cancellationMode ?? '', retainedKey: !!body.idempotencyKey});
    return job.remote.promise;
  }
  const preservation = {
    capture(signal) {
      if (issuing) {
        const {id, kind, issue} = issuing;
        const job = {...emptyJob, phase: 'preservation', epoch: calendar.epoch,
          owner, session, kind, issue, profile: visibleProfile(), signal, capture: deferred()};
        jobs.set(id, job);
        return job.capture.promise;
      }
      if (!holdReads) return Promise.resolve(legacySnapshot('same'));
      assert.equal(heldRead, undefined, 'Only one live refresh in this campaign');
      heldRead = deferred();
      return heldRead.promise;
    },
    retainedReadOnly() {throw Error('Fixture initial source has no legacy records');},
  };
  const calendar = new AgentCalendar(port, preservation, (target, signal) => ({
    getLifeOpsCalendarFeed: async () => ({state: feedState(status),
      events: profile === 'none' ? [] : [event(profile, target.identity.agentId.slice('agent-'.length))]}),
    getLifeOpsCalendars: async () => ({calendars: [{...source}]}),
    getLifeOpsNextCalendarEventContext: async () => ({event: null, calendarFeedState: 'complete'}),
    createLifeOpsCalendarEvent: body => dispatch(target, signal, 'create', '', body),
    updateLifeOpsCalendarEvent: (external, body) => dispatch(target, signal, 'update', external, body),
    deleteLifeOpsCalendarEvent: (external, body) => dispatch(target, signal, 'delete', external, body),
  }));
  const visibleProfile = () => profiles.get(calendar.state.feed?.events[0]) ?? 'none';
  const refresh = calendar.refresh.bind(calendar);
  calendar.refresh = async window => {
    const before = calendar.epoch, result = refresh(window);
    if (calendar.epoch !== before) readDone = result;
    await result;
  };
  await calendar.refresh(windows[1]);
  holdReads = true;

  const settleOutcome = (id, result) => {outcomes.set(id, result); jobs.delete(id);};
  return {
    observe() {
      const snapshot = calendar.state;
      const [, boundSession] = calendar.binding ? JSON.parse(calendar.binding) : [null, 'session-0'];
      const active = snapshot.mutating ? [...jobs].find(([, job]) => job.epoch === calendar.epoch)?.[0] : 0;
      assert.notEqual(active, undefined, 'Current native task can be identified from the actual mutation');
      return {'s.portOwner': owner, 's.portSession': session, 's.portCurrent': current,
        's.owner': ownerId(snapshot.ownerKey), 's.session': Number(boundSession.slice('session-'.length)),
        's.status': snapshot.status, 's.profile': visibleProfile(), 's.hasSource': snapshot.calendars.length > 0,
        's.nextFresh': snapshot.nextFresh, 's.query': queryId(calendar.nextQuery), 's.epoch': calendar.epoch,
        's.reading': calendar.refreshing, 's.active': active,
        's.deferred': calendar.deferredRefresh ? queryId(JSON.stringify(calendar.deferredRefresh)) : 0, 's.lastId': lastId,
        's.jobs': qmap(Array.from({length: 6}, (_, index) => {
          const id = index + 1, job = jobs.get(id);
          return [id, job ? {phase: job.phase, epoch: job.epoch, owner: job.owner, session: job.session, kind: job.kind,
            issue: job.issue, profile: job.profile, aborted: job.signal.aborted} : emptyJob];
        })),
        's.outcomes': qmap(Array.from({length: 6}, (_, index) => [index + 1, outcomes.get(index + 1) ?? ''])),
        's.dispatched': dispatched};
    },
    setPort(nextOwner, nextSession, available) {owner = nextOwner; session = nextSession; current = available;},
    async request(query) {void calendar.refresh(windows[query]); await tick();},
    async finishRead(nextStatus, nextProfile) {
      assert.ok(heldRead);
      status = nextStatus;
      profile = nextProfile;
      const waiting = heldRead;
      heldRead = undefined;
      waiting.resolve(legacySnapshot('same'));
      await readDone;
      await tick();
    },
    retire() {calendar.retire();},
    async start(kind, issue) {
      const id = ++lastId, key = issue === 'blank' ? '' : 'op-' + id;
      const row = calendar.state.feed?.events[0] ?? event('organizer', owner || 'A');
      const target = calendarEventKey(issue === 'missing' ? {...row, id: 'missing'} : row);
      const version = issue === 'stale' ? 'old' : 'v1';
      const scope = issue === 'instance' ? 'instance' : undefined;
      outcomes.set(id, 'pending');
      issuing = {id, kind, issue};
      let operation;
      try {
        if (kind === 'create') operation = calendar.create(issue === 'missing' ? 'missing' : calendarSourceKey(source),
          {idempotencyKey: key, title: 'Fixture change'});
        else if (kind === 'update') operation = calendar.update(target, version, {idempotencyKey: key, title: 'Fixture change',
          ...(issue === 'move' ? {calendarId: 'other'} : {}), ...(scope ? {recurrenceScope: scope} : {})});
        else operation = calendar.delete(target, version, key, scope);
      } catch (error) {operation = Promise.reject(error);}
      finally {issuing = undefined;}
      const done = Promise.resolve(operation).then(
        value => settleOutcome(id, kind === 'create' && value.outcome === 'accepted_without_readback' ? 'unknown' : 'saved'),
        error => {
          const label = error.name === 'AbortError' ? 'aborted' : expected.get(error.message);
          assert.notEqual(label, undefined, error.stack);
          settleOutcome(id, label);
        });
      const job = jobs.get(id);
      if (job) job.done = done;
      else await done;
      await tick();
    },
    async preservationReply(id, result) {
      const job = jobs.get(id);
      assert.equal(job.phase, 'preservation');
      if (result === 'transport') job.capture.reject(Error('Fixture transport refusal'));
      else job.capture.resolve(legacySnapshot(result));
      await tick();
    },
    async providerReply(id, result) {
      const job = jobs.get(id);
      assert.equal(job.phase, 'remote');
      if (result === 'transport') job.remote.reject(Error('Fixture transport refusal'));
      else if (result === 'unknown' && job.kind === 'create') job.remote.resolve({outcome: 'accepted_without_readback'});
      else {
        const returned = event('organizer', result === 'foreign-owner' ? 'other' : job.owner);
        if (result === 'foreign-source') returned.calendarId = 'foreign-calendar';
        job.remote.resolve({outcome: 'event', event: returned});
      }
      await job.done;
      await tick();
    },
  };
}

const start = (kind, issue = 'normal') => ['start', kind, issue];
const capture = (id, result = 'same') => ['preservationReply', id, result];
const provider = (id, result = 'success') => ['providerReply', id, result];
const request = query => ['request', query];
const read = (status = 'ready', profile = 'organizer') => ['finishRead', status, profile];
const cases = [
  ['create-dispatches-exact-source-and-retains-unknown-outcome', 'ready', 'organizer', [start('create'), capture(1), provider(1, 'unknown')]],
  ['missing-source-and-empty-creation-key-never-dispatch', 'ready', 'organizer', [start('create', 'missing'), start('create', 'blank')]],
  ['create-may-use-source-with-unavailable-feed', 'unavailable', 'none', [start('create'), capture(1), provider(1)]],
  ['create-rejects-foreign-agent-return', 'ready', 'organizer', [start('create'), capture(1), provider(1, 'foreign-owner')]],
  ['create-currently-checks-agent-on-provider-event-return', 'ready', 'organizer', [start('create'), capture(1), provider(1, 'foreign-source')]],
  ['update-version-and-destination-check-before-preservation', 'ready', 'organizer', [
    start('update', 'stale'), start('update', 'move'), start('update', 'missing'), start('update'), capture(4), provider(4)]],
  ['update-sends-blank-key-to-transport-validation', 'ready', 'organizer', [start('update', 'blank'), capture(1), provider(1, 'transport')]],
  ['update-rejects-unavailable-feed', 'unavailable', 'organizer', [start('update'), start('delete')]],
  ['update-rejects-foreign-destination-return', 'ready', 'organizer', [start('update'), capture(1), provider(1, 'foreign-source')]],
  ['readonly-event-and-missing-provider-version', 'ready', 'readonly', [start('update'), request(1), read('ready', 'unversioned'), start('delete')]],
  ['recurring-event-requires-an-explicit-scope', 'partial', 'recurring', [
    start('update'), start('delete'), start('update', 'instance'), capture(3), provider(3)]],
  ['organizer-and-invitee-delete-different-commands', 'ready', 'organizer', [
    start('delete', 'blank'), start('delete'), capture(2), provider(2), request(1), read('ready', 'invitee'),
    start('delete'), capture(3), provider(3)]],
  ['email-identity-can-establish-organizer-disposition', 'ready', 'email', [start('delete'), capture(1), provider(1)]],
  ['unknown-organizer-disposition-never-dispatches', 'ready', 'unknown', [start('delete')]],
  ['legacy-preservation-rejects-changed-pending-unreadable-and-transport', 'ready', 'organizer', [
    start('create'), capture(1, 'changed'), start('update'), capture(2, 'pending'),
    start('delete'), capture(3, 'unreadable'), start('create'), capture(4, 'transport')]],
  ['refresh-while-checking-and-writing-keeps-only-latest-window', 'ready', 'organizer', [
    start('create'), request(2), request(1), capture(1), request(2), start('create'),
    provider(1, 'unknown'), read('partial', 'invitee')]],
  ['preservation-refusal-still-runs-the-deferred-refresh', 'ready', 'organizer', [
    start('update'), request(2), capture(1, 'changed'), read()]],
  ['transport-refusal-still-runs-the-deferred-refresh', 'ready', 'organizer', [
    start('create'), capture(1), request(2), provider(1, 'transport'), read()]],
  ['mutations-cannot-overtake-a-same-window-read', 'ready', 'organizer', [
    request(1), start('create'), start('update'), start('delete'), read()]],
  ['different-and-invalid-owner-cannot-admit-a-write', 'ready', 'organizer', [
    ['setPort', 'B', 2, true], start('update'), ['setPort', 'A', 1, false], start('create')]],
  ['same-owner-new-session-refuses-preservation-admission', 'ready', 'organizer', [
    ['setPort', 'A', 2, true], start('update'), capture(1)]],
  ['session-change-after-dispatch-refuses-publication-and-refreshes-current-owner', 'ready', 'organizer', [
    start('create'), capture(1), request(2), ['setPort', 'A', 2, true], provider(1), read()]],
  ['retired-provider-reply-does-not-clear-new-owner-mutation', 'ready', 'organizer', [
    start('create'), capture(1), request(2), ['setPort', 'B', 2, true], ['retire'], request(1), read('ready', 'invitee'),
    start('delete'), capture(2), request(2), provider(1), provider(2), read()]],
  ['retired-preservation-reply-cannot-dispatch', 'ready', 'organizer', [
    start('create'), request(2), ['retire'], capture(1)]],
];

export async function checkAgentCalendarMutation(extraSources = []) {
  const compiled = await buildAgentCalendar([driver, ...extraSources]), traces = [];
  for (const [name, status, profile, steps] of cases) {
    const f = await fixture(compiled, status, profile), t = trace(name, f.observe(), call('initWith', status, profile));
    try {
      for (const [operation, ...args] of steps) {
        await f[operation](...args);
        checkpoint(t, [operation, ...args].join(' '), call(operation, ...args), f.observe());
      }
      traces.push(t);
    } finally {f.retire();}
  }
  return checkTraces(boundInputs({model: 'AgentCalendarMutation', sources: compiled.sources, traces, scope: 'bounded-orchestration', assumptions: [
    'The actual AgentCalendar controller and shared event-editor policy run against controlled preservation, AppRecordPort, refresh and provider promises. Dispatch checks read the actual transport body and exact captured owner/session.',
    'Two owner/session bindings, two windows, eight epochs, six attempts and one active mutation are bounded. The initial view is an actual settled read. The source and update/delete event policies are modeled before dispatch; acknowledgements observe the current client verification.',
    'Provider effects, idempotency/replay enforcement, linked control and Maps event readback remain outside this projection. Synthetic acknowledgements expose what this client accepts, including delegated blank update-key validation and create-agent-only result verification.',
  ]}));
}
