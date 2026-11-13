import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, extname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {call, checkpoint, deferred, root, tick, trace} from './support.mjs';
import {inboxDriverArtifact, inboxDriverSources, rebuildInboxDriver} from '../services/inbox-coordinator-ports.mjs';
import {savedInboxTraces} from './saved-inbox-read.mjs';

const driver = fileURLToPath(import.meta.url);
const implementation = 'apps/app/src/runtime/agent-calendar.ts';
const cacheSource = 'apps/app/src/runtime/service-read-cache.ts';
const baseline = Date.parse('2027-01-15T12:00:00Z');
const windows = [
  {timeMin: '2027-01-01T00:00:00Z', timeMax: '2027-02-01T00:00:00Z', timeZone: 'UTC'},
  {timeMin: '2027-02-01T00:00:00Z', timeMax: '2027-03-01T00:00:00Z', timeZone: 'UTC'},
];

async function compile(driverHashes) {
  const built = await build({absWorkingDir: root, stdin: {resolveDir: root,
    contents: `export * from './${implementation}';export {ServiceReadCache} from './${cacheSource}';`},
    bundle: true, platform: 'node', format: 'cjs', write: false, metafile: true,
    plugins: [{name: 'capture-exact-saved-read-inputs', setup(builder) {
      builder.onLoad({filter: /\.(?:tsx?|js|json)$/}, ({path}) => {
        const bytes = readFileSync(path);
        // Bind the exact bytes returned to the compiler. The initial source graph
        // and final receipt check also reject changes during the replay.
        const captured = createHash('sha256').update(bytes).digest('hex');
        assert.equal(driverHashes[path] ?? captured, captured, 'An already captured source still matches');
        driverHashes[path] = captured;
        return {contents: bytes, loader: extname(path).slice(1), resolveDir: dirname(path)};
      });
    }}]});
  return built.outputFiles[0].text;
}

async function fixture(code) {
  let owner = 0, credential = 0, query = 0, now = 1;
  const module = {exports: {}}, jobs = [], digests = [];
  class ClockDate extends Date {static now() {return baseline + (now - 1) * 1000;}}
  const cryptoPort = {subtle: {digest(...args) {const pending = crypto.subtle.digest(...args);digests.push(pending);return pending;}}};
  new Function('module', 'exports', 'Date', 'crypto', code)(module, module.exports, ClockDate, cryptoPort);
  const flush = async () => {for (let n = 0; n < 4; n++) {await tick();await Promise.all(digests);}};
  const {AgentCalendar, ServiceReadCache, calendarSourceKey, calendarEventKey} = module.exports;
  const documents = [null, null];
  const stores = [0, 1].map(id => new ServiceReadCache('credential-' + id, {
    read: async () => structuredClone(documents[id]),
    compareExchange: async (before, value) => {
      if (JSON.stringify(documents[id]) !== JSON.stringify(before)) return 'conflict';
      documents[id] = structuredClone(value);return 'saved';
    },
  }));
  const preservation = {capture: async () => ({fingerprint: 'empty', present: false, readable: true, pending: false, records: []}),
    retainedReadOnly: async () => true};
  const source = {provider: 'google', side: 'owner', grantId: 'fixture-grant', connectorAccountId: 'fixture-account',
    accountEmail: null, calendarId: 'primary', summary: 'Fixture calendar', description: null, primary: true,
    accessRole: 'owner', backgroundColor: null, foregroundColor: null, timeZone: 'UTC', selected: true,
    includeInFeed: true, selectionVersion: 1};
  const eventFor = id => ({id: 'fixture-event', externalId: 'provider-event', agentId: 'agent-' + id,
    provider: 'google', side: 'owner', grantId: source.grantId, connectorAccountId: source.connectorAccountId,
    calendarId: source.calendarId, title: 'Synthetic saved event', description: '', location: '', status: 'confirmed',
    startAt: '2027-01-15T13:00:00Z', endAt: '2027-01-15T14:00:00Z', timezone: 'UTC', isAllDay: false,
    htmlLink: null, conferenceLink: null, organizer: {self: true}, attendees: [], metadata: {etag: 'fixture-version'}});
  const feedFor = (id, selectedQuery) => ({...windows[selectedQuery], calendarId: 'all', state: 'complete', source: 'synced',
    sources: [], syncedAt: new ClockDate(ClockDate.now()).toISOString(), events: [eventFor(id)]});
  const port = () => {
    const selectedOwner = owner, selectedCredential = credential;
    return {identity: {origin: 'https://fixture.invalid', ownerId: 'owner-' + owner, agentId: 'agent-' + owner},
      sessionId: 'session-' + owner + '-' + credential, scope: 'credential-' + credential,
      current: () => owner === selectedOwner && credential === selectedCredential};
  };
  // Produce the saved document by completing a real controller refresh. The
  // adapter never fabricates a serialized cache document or saved feed envelope.
  const writer = new AgentCalendar(port, preservation, () => ({
    getLifeOpsCalendarFeed: async () => feedFor(0, 0),
    getLifeOpsCalendars: async () => ({calendars: [source]}),
    getLifeOpsNextCalendarEventContext: async () => ({event: null, calendarFeedState: 'complete'}),
  }), async () => stores[0], () => 'credential-0');
  await writer.refresh(windows[0]);await tick();
  assert.ok(documents[0]?.entries.some(entry => entry.value?.feed?.events.length === 1), 'Actual live refresh seeds the cache');
  writer.retire();

  const calendar = new AgentCalendar(port, preservation, (selectedPort, signal) => {
    const job = {owner, credential, query, signal, local: deferred(), feed: deferred(), sources: deferred(), next: deferred()};
    assert.equal(selectedPort.identity.ownerId, 'owner-' + job.owner);
    jobs.push(job);
    return {getLifeOpsCalendarFeed: () => job.feed.promise, getLifeOpsCalendars: () => job.sources.promise,
      getLifeOpsNextCalendarEventContext: () => job.next.promise};
  }, async () => {
    const job = jobs.at(-1), store = stores[job.credential];
    return {get: async key => {const result = await store.get(key);await job.local.promise;return result;},
      put: (...args) => store.put(...args)};
  }, () => 'credential-' + credential);
  const latest = () => jobs.at(-1);
  return {
    observe() {
      const value = calendar.state;
      const shown = !value.feed ? 'none' : value.savedAt !== null ? 'saved' : 'fresh';
      const sourceSelection = calendar.sourceSelection(calendarSourceKey(source));
      const selection = calendar.selection(calendarEventKey(eventFor(owner)));
      assert.equal(!!selection, shown === 'fresh', 'Only the actual fresh event is selectable for reviewed mutations');
      assert.equal(!!sourceSelection, shown === 'fresh', 'Only a fresh source can be selected for reviewed mutations');
      return {'s.owner': owner, 's.credential': credential, 's.query': query, 's.shown': shown,
        's.reading': calendar.refreshing, canMutate: !!selection && !!sourceSelection};
    },
    async start() {
      const run = calendar.refresh(windows[query]);await tick();
      assert.ok(latest(), 'Actual provider read has started');latest().completion = run;
    },
    async restore() {
      latest().local.resolve();await flush();
      if (calendar.state.savedAt !== null) await assert.rejects(
        calendar.create(calendarSourceKey(source), {idempotencyKey: 'closed-cache-refusal', title: 'Must not be sent'}),
        /Wait for the current Calendar source/, 'Actual mutation admission refuses the restored cache');
    },
    async fresh() {
      const job = latest();
      job.feed.resolve(feedFor(job.owner, job.query));job.sources.resolve({calendars: [source]});
      job.next.resolve({event: null, calendarFeedState: 'complete'});
      await job.completion;await tick();
    },
    async refuse() {
      const job = latest();
      job.feed.reject(Object.assign(Error('Synthetic authorization refusal'), {status: 403}));
      job.sources.resolve({calendars: [source]});job.next.resolve({event: null, calendarFeedState: 'complete'});
      await job.completion;await tick();
    },
    otherOwner() {owner = 1 - owner;calendar.retire();},
    otherCredential() {credential = 1 - credential;calendar.retire();},
    otherQuery() {query = 1 - query;calendar.retire();},
    tick() {now++;},
    async close() {
      calendar.retire();
      for (const job of jobs) {
        job.local.resolve();job.feed.resolve(feedFor(job.owner, job.query));
        job.sources.resolve({calendars: [source]});job.next.resolve({event: null, calendarFeedState: 'complete'});
      }
      await Promise.all(jobs.map(job => job.completion));await tick();
    },
  };
}

const cases = [
  ['actual cached presentation stays read-only until live readback', ['start', 'restore', 'tick', 'fresh']],
  ['a delayed cache read never replaces completed live data', ['start', 'fresh', 'restore']],
  ['authorization refusal invalidates older windows even after returning', [
    'start', 'restore', 'refuse', 'otherQuery', 'otherQuery', 'start', 'restore',
  ]],
  ['another owner cannot see the prior saved event', ['otherOwner', 'start', 'restore']],
  ['another credential cannot read the prior credential cache', ['otherCredential', 'start', 'restore']],
  ['another window never receives the saved query', ['otherQuery', 'start', 'restore']],
  ['late local completion cannot republish after owner retirement', ['start', 'otherOwner', 'restore']],
  ['late local completion cannot republish after credential retirement', ['start', 'otherCredential', 'restore']],
];

export async function checkSavedServiceRead(extraSources = []) {
  const inboxSources = await inboxDriverSources();
  const sources = [driver, implementation, cacheSource, 'specs/quint/refinement/application/support.mjs',
    'specs/quint/refinement/application/index.mjs', 'test/quint-application-refinement.test.mjs',
    'specs/quint/refinement/application/saved-inbox-read.mjs',
    'specs/quint/refinement/services/inbox-coordinator-ports.mjs', 'bun.lock', ...inboxSources, ...extraSources];
  const driverHashes = captureInputs(sources);
  rebuildInboxDriver(inboxSources);
  const temporary = mkdtempSync(join(tmpdir(), 'alpha-saved-service-source-'));
  const input = join(temporary, 'saved-read.cjs');
  const inboxInput = join(temporary, 'inbox-read.iife.js');
  try {
    writeFileSync(input, await compile(driverHashes));
    writeFileSync(inboxInput, await inboxDriverArtifact());
    const generated = captureInputs([input, inboxInput]);
    for (const path of [input, inboxInput]) driverHashes[path] = generated[path];
    const code = readFileSync(input, 'utf8'), traces = [];
    for (const [name, steps] of cases) {
      const f = await fixture(code), t = trace(name, f.observe());
      try {
        for (const method of steps) {
          await f[method]();checkpoint(t, method, call(method), f.observe());
        }
        traces.push(t);
      } finally {await f.close();}
    }
    traces.push(...await savedInboxTraces());
    return await checkTraces({model: 'SavedServiceRead', sources: [...sources, ...Object.keys(driverHashes)], driverHashes,
      generatedSources: [input, inboxInput], traces, scope: 'bounded-orchestration', assumptions: [
        'Actual AgentCalendar controller, its source/selection policy and actual bounded ServiceReadCache execute. A completed live controller seeds the serialized document before a new controller performs controlled local/provider races.',
        'Two owners, credential namespaces and windows; one synthetic event and readable source. The concrete projection observes shown data, active read and actual mutation eligibility. Internal model epoch, settlement and saved-timestamp fields remain abstract and are not claimed as observed.',
        'The refusal trace executes HTTP 403 invalidation, persists the owner refusal marker and returns through another window. Owner, credential and window replacement call actual retirement before a new read; production caller retirement and account authentication remain separate obligations.',
        'Inbox mounts the actual adapter, shared draft/review controllers and service cache with closed storage and provider ports. The driver observes its registered render, Back and Refresh callbacks, action eligibility, and account/read/effect calls.',
        'Inbox starts with one exact locally saved grant and injects a definitive empty grant list or a transient transport failure. This covers the same-grant reopen after refused eviction in one process. Mounted HTML, background Home reads, physical persistence and live authorization remain outside these schedules.',
      ]});
  } finally {rmSync(temporary, {recursive: true, force: true});}
}
