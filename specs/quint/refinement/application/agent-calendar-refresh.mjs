import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {checkTraces, qmap} from '../check-traces.mjs';
import {boundInputs, call, captureSources, checkpoint, deferred, root, tick, trace} from './support.mjs';

const driver = fileURLToPath(import.meta.url);
const implementation = 'apps/app/src/runtime/agent-calendar.ts';
const baseline = Date.parse('2027-01-15T12:00:00Z');
const windows = [null,
  {timeMin: '2027-01-01T00:00:00Z', timeMax: '2027-02-01T00:00:00Z', timeZone: 'UTC'},
  {timeMin: '2027-02-01T00:00:00Z', timeMax: '2027-03-01T00:00:00Z', timeZone: 'UTC'},
];
const calendarSource = {provider: 'google', side: 'owner', grantId: 'fixture-grant', connectorAccountId: 'fixture-connector',
  calendarId: 'fixture-calendar', includeInFeed: true, accessRole: 'owner', selectionVersion: 1};
const emptyJob = {phase: '', owner: '', session: 0, query: 0, revalidating: false, aborted: false, feed: '', sources: '', next: ''};
const errors = new Map([[null, ''], ['Calendar could not load. Try again.', 'load'],
  ['Calendar could not be refreshed. Saved next event is unverified.', 'feed'],
  ['Next event could not be refreshed. Saved event is unverified.', 'next']]);

async function compile(extraSources) {
  const built = await build({absWorkingDir: root, entryPoints: [implementation], bundle: true,
    platform: 'node', format: 'cjs', write: false, metafile: true, plugins: [{name: 'calendar-read-clock', setup(builder) {
      builder.onLoad({filter: /\/runtime\/agent-calendar\.ts$/}, ({path}) => {
        const source = readFileSync(path, 'utf8');
        assert.equal(source.split('Date.now()').length, 3, 'Current Agent Calendar clock reads');
        return {loader: 'ts', contents: source.replaceAll('Date.now()', '__clock.now()')};
      });
    }}]});
  const sources = [...Object.keys(built.metafile.inputs).filter(path => !path.startsWith('<')), driver, ...extraSources];
  captureSources(sources);
  return {code: built.outputFiles[0].text, sources};
}

function fixture(compiled) {
  let now = baseline, owner = 'A', session = 1, current = true;
  const module = {exports: {}}, jobs = new Map(), responseIds = new WeakMap();
  new Function('module', 'exports', '__clock', compiled.code)(module, module.exports, {now: () => now});
  const {AgentCalendar, calendarSourceKey} = module.exports;
  const queryId = raw => raw ? windows.findIndex(window => JSON.stringify(window) === raw) : 0;
  const ownerId = raw => raw ? JSON.parse(raw)[1].replace(/^owner-/, '') : '';
  const port = () => {
    if (!owner) return null;
    const chosen = owner, activeSession = session;
    return {identity: {origin: 'https://fixture.invalid', ownerId: 'owner-' + chosen, agentId: 'agent-' + chosen},
      sessionId: 'session-' + activeSession, scope: 'fixture-scope',
      current: () => current && owner === chosen && session === activeSession};
  };
  const binding = () => {
    if (!calendar.binding) return {owner: '', session: 0};
    const [bound, id] = JSON.parse(calendar.binding);
    return {owner: ownerId(bound), session: Number(id.slice('session-'.length))};
  };
  const preservation = {
    capture(signal) {
      const id = calendar.epoch, job = {...emptyJob, ...binding(), phase: 'legacy', query: queryId(calendar.nextQuery),
        revalidating: ['ready', 'partial'].includes(calendar.state.status), signal, capture: deferred()};
      assert.ok(!jobs.has(id));
      jobs.set(id, job);
      return job.capture.promise;
    },
    retainedReadOnly(owner, fingerprint, signal) {
      const job = jobs.get(calendar.epoch);
      assert.equal(job.signal, signal);
      assert.equal(job.owner, ownerId(owner));
      assert.equal(fingerprint, 'present');
      job.phase = 'retention';
      job.retention = deferred();
      return job.retention.promise;
    },
  };
  const calendar = new AgentCalendar(port, preservation, (target, signal) => {
    const job = jobs.get(calendar.epoch);
    assert.equal(signal, job.signal);
    assert.equal(target.identity.ownerId, 'owner-' + job.owner);
    job.phase = 'reading';
    job.feedTask = deferred();
    job.sourcesTask = deferred();
    job.nextTask = deferred();
    return {
      getLifeOpsCalendarFeed(window, options) {
        assert.equal(queryId(JSON.stringify(window)), job.query);
        assert.equal(options.signal, signal);
        return job.feedTask.promise;
      },
      getLifeOpsCalendars(_query, options) {
        assert.equal(options.signal, signal);
        return job.sourcesTask.promise;
      },
      getLifeOpsNextCalendarEventContext(query) {
        assert.equal(query.timeZone, windows[job.query].timeZone);
        return job.nextTask.promise;
      },
    };
  });
  const refresh = calendar.refresh.bind(calendar);
  calendar.refresh = async window => {
    const before = calendar.epoch;
    const result = refresh(window);
    const id = calendar.epoch, job = jobs.get(id);
    if (id !== before && job) job.completion = result.then(() => jobs.delete(id));
    await result;
  };
  const event = (job, expired = false, foreign = false) => ({
    id: 'event-fixture', externalId: 'provider-event', agentId: foreign ? 'foreign-agent' : 'agent-' + job.owner,
    provider: calendarSource.provider, side: calendarSource.side, grantId: calendarSource.grantId,
    connectorAccountId: calendarSource.connectorAccountId, calendarId: calendarSource.calendarId,
    startAt: new Date(baseline - 60000).toISOString(), endAt: new Date(baseline + (expired ? -1 : 3600000)).toISOString(),
    title: 'Fixture event', metadata: {etag: 'fixture-etag'},
  });
  const valueOf = {
    feed(job, result) {
      return {...windows[result === 'wrong-window' ? 3 - job.query : job.query],
        state: ['foreign', 'wrong-window'].includes(result) ? 'complete' : result,
        events: result === 'foreign' ? [event(job, false, true)] : []};
    },
    sources(_job, result) {
      return {calendars: result === 'none' ? [] : [{...calendarSource, includeInFeed: result !== 'hidden',
        accessRole: result === 'blocked' ? 'freeBusyReader' : 'owner'}]};
    },
    next(job, result) {
      return {event: result === 'empty' ? null : event(job, result === 'ended', result === 'foreign'),
        calendarFeedState: result === 'partial' ? 'partial' : 'complete'};
    },
  };
  async function reply(id, field, result) {
    const job = jobs.get(id);
    assert.equal(job.phase, 'reading');
    assert.equal(job[field], '');
    job[field] = result;
    const task = job[field + 'Task'];
    if (result === 'failed') task.reject(Error('Injected Calendar read failure'));
    else {
      const value = valueOf[field](job, result);
      responseIds.set(value, id);
      task.resolve(value);
    }
    if (job.feed && job.sources && job.next) await job.completion;
    await tick();
  }
  return {
    observe() {
      const s = calendar.state, bound = binding(), active = [...jobs].find(([, job]) => job.signal === calendar.reading?.signal)?.[0] ?? 0;
      assert.equal(calendar.refreshing, active !== 0);
      assert.equal(s.mutating, false, 'This campaign drives the refresh actor only');
      const err = errors.get(s.error);
      assert.notEqual(err, undefined);
      return {'s.portOwner': owner, 's.portSession': session, 's.portCurrent': current,
        's.boundOwner': bound.owner, 's.boundSession': bound.session, 's.query': queryId(calendar.nextQuery),
        's.epoch': calendar.epoch, 's.abortEpoch': calendar.abort ? calendar.epoch : 0,
        's.active': active, 's.trailing': calendar.deferredRefresh ? queryId(JSON.stringify(calendar.deferredRefresh)) : 0,
        's.jobs': qmap(Array.from({length: 8}, (_, index) => {
          const id = index + 1, job = jobs.get(id);
          return [id, job ? {phase: job.phase, owner: job.owner, session: job.session, query: job.query,
            revalidating: job.revalidating, aborted: job.signal.aborted, feed: job.feed, sources: job.sources, next: job.next} : emptyJob];
        })),
        's.status': s.status, 's.owner': ownerId(s.ownerKey), 's.legacy': s.legacy?.fingerprint ?? '',
        's.feed': s.feed?.state ?? '', 's.feedEpoch': s.feed ? responseIds.get(s.feed) : 0, 's.sources': s.calendars.length ? !s.calendars[0].includeInFeed ? 'hidden'
          : s.calendars[0].accessRole === 'freeBusyReader' ? 'blocked' : 'readable' : '',
        's.next': s.next ? s.next.event ? 'event' : 'empty' : '', 's.nextEpoch': s.next ? responseIds.get(s.next) : 0, 's.nextFresh': s.nextFresh,
        's.error': err, 's.hasHandle': !!calendar.sourceHandle(calendarSourceKey(calendarSource)), 's.clockAdvanced': now > baseline};
    },
    setPort(nextOwner, nextSession, nextCurrent) {owner = nextOwner; session = nextSession; current = nextCurrent;},
    async request(query) {void calendar.refresh(windows[query]); await tick();},
    retire() {calendar.retire();},
    invalidateNext() {calendar.invalidateNext();},
    advanceClock() {now = baseline + 7200000; calendar.invalidateNext();},
    async legacyReply(id, result) {
      const job = jobs.get(id);
      assert.equal(job.phase, 'legacy');
      if (result === 'failed') job.capture.reject(Error('Injected preservation read failure'));
      else job.capture.resolve({fingerprint: result, present: result === 'present', readable: result !== 'unreadable',
        pending: result === 'pending', records: []});
      await tick();
    },
    async retentionReply(id, kept) {
      const job = jobs.get(id);
      assert.equal(job.phase, 'retention');
      job.retention.resolve(kept);
      await tick();
    },
    feedReply(id, result) {return reply(id, 'feed', result);},
    sourcesReply(id, result) {return reply(id, 'sources', result);},
    nextReply(id, result) {return reply(id, 'next', result);},
  };
}

const req = query => ['request', query];
const legacy = (id, result = 'clean') => ['legacyReply', id, result];
const feed = (id, result = 'complete') => ['feedReply', id, result];
const sources = (id, result = 'readable') => ['sourcesReply', id, result];
const next = (id, result = 'event') => ['nextReply', id, result];
const ready = [req(1), legacy(1), feed(1), sources(1), next(1)];
const reread = [req(1), legacy(2)];
const cases = [
  ['independently-settled-reads-publish-only-after-all', [req(1), legacy(1), next(1), feed(1), sources(1)]],
  ['same-window-transport-failure-retains-old-feed', [...ready, ...reread, feed(2, 'failed'), next(2), sources(2)]],
  ['same-window-wrong-window-reply-retires-old-feed', [...ready, ...reread, feed(2, 'wrong-window'), sources(2), next(2)]],
  ['foreign-event-reply-retires-old-feed', [...ready, ...reread, next(2, 'foreign'), sources(2), feed(2)]],
  ['foreign-feed-row-retires-old-feed', [...ready, ...reread, feed(2, 'foreign'), sources(2), next(2)]],
  ['source-read-failure-retains-old-feed-only', [...ready, ...reread, sources(2, 'failed'), next(2), feed(2)]],
  ['next-read-failure-retains-only-current-readable-next', [...ready, ...reread, next(2, 'failed'), feed(2), sources(2)]],
  ['hidden-source-removes-unverified-retained-next', [...ready, ...reread, next(2, 'failed'), feed(2), sources(2, 'hidden')]],
  ['free-busy-source-removes-unverified-retained-next', [...ready, ...reread, next(2, 'failed'), feed(2), sources(2, 'blocked')]],
  ['source-rejects-next-even-if-feed-authorized', [...ready, ...reread, sources(2, 'hidden'), feed(2), next(2)]],
  ['initial-feed-failure-publishes-unverified-next', [req(1), legacy(1), feed(1, 'failed'), next(1), sources(1)]],
  ['partial-and-unavailable-feed-cannot-verify-next', [req(1), legacy(1), feed(1, 'partial'), sources(1), next(1, 'partial'),
    req(1), legacy(2), feed(2, 'unavailable'), next(2), sources(2)]],
  ['explicit-empty-next-and-absent-source-are-current', [req(1), legacy(1), feed(1), next(1, 'empty'), sources(1, 'none')]],
  ['past-next-is-dropped-and-clock-invalidates-cached-next', [req(1), legacy(1), next(1, 'ended'), feed(1), sources(1),
    ...reread, next(2), feed(2), sources(2), ['advanceClock']]],
  ['explicit-invalidation-keeps-future-next-unverified', [...ready, ['invalidateNext']]],
  ['same-window-repeats-coalesce-one-trailing-request', [req(1), req(1), req(1), legacy(1), feed(1), sources(1), next(1),
    legacy(2), next(2, 'empty'), sources(2), feed(2)]],
  ['changed-window-aborts-obsolete-reads-and-trailing', [req(1), legacy(1), req(1), req(2), legacy(2), feed(2), sources(2), next(2),
    next(1), feed(1), sources(1)]],
  ['replacement-owner-can-publish-before-old-replies', [req(1), legacy(1), ['setPort', 'B', 2, true], req(2),
    legacy(2), feed(2, 'partial'), next(2, 'empty'), sources(2, 'none'), feed(1), sources(1), next(1)]],
  ['same-owner-new-session-retires-old-retained-next', [...ready, ['setPort', 'A', 2, true], req(1),
    legacy(2), next(2, 'failed'), feed(2), sources(2)]],
  ['invalidated-owner-cannot-publish-pending-response', [req(1), legacy(1), ['setPort', 'A', 1, false], feed(1), sources(1), next(1)]],
  ['retire-cancels-old-legacy-read', [req(1), ['retire'], legacy(1)]],
  ['invalid-port-clears-visible-state-without-dispatch', [...ready, ['setPort', '', 1, false], req(2)]],
  ['old-legacy-gate-requires-explicit-retention', [req(1), legacy(1, 'present'), ['retentionReply', 1, false],
    req(1), legacy(2, 'present'), ['retentionReply', 2, true], feed(2), next(2), sources(2)]],
  ['unreadable-and-pending-legacy-require-recovery', [req(1), legacy(1, 'unreadable'), req(1), legacy(2, 'pending')]],
  ['legacy-read-transport-failure-keeps-current-old-feed', [...ready, req(1), legacy(2, 'failed')]],
];

export async function checkAgentCalendarRefresh(extraSources = []) {
  const compiled = await compile(extraSources), traces = [];
  for (const [name, steps] of cases) {
    const f = fixture(compiled), t = trace(name, f.observe());
    try {
      for (const [operation, ...args] of steps) {
        await f[operation](...args);
        checkpoint(t, [operation, ...args].join(' '), call(operation, ...args), f.observe());
      }
      traces.push(t);
    } finally {f.retire();}
  }
  return checkTraces(boundInputs({model: 'AgentCalendarRefresh', sources: compiled.sources, traces, scope: 'bounded-orchestration', assumptions: [
    'The actual AgentCalendar controller drives preservation, three independently held reads and exact abort/current checks using controlled AppRecordPort and clock inputs.',
    'Two owner identities, sessions and query windows and eight request epochs are bounded. The observations read actual request controller identity, deferred window, published source state, and the real source handle.',
    'Transport classifications and source records are synthetic. Calendar mutations, replay, Maps return, linked selection, live provider responses and native storage have separate scope.',
  ]}));
}
