import assert from 'node:assert/strict';
import {checkTraces, captureInputs} from '../check-traces.mjs';
import {action, sourceModule} from './support.mjs';

const binding = {environment: 'production', userId: 'owner', organizationId: 'org', connectionId: 'google-grant', providerAccountId: 'google-owner', calendarId: 'primary', agentId: 'agent', localSourceId: 'local', localSourceRevision: 'source-1'};
const event = {title: 'Meeting', description: '', location: '', startAt: '2026-11-06T17:00:00.000Z', endAt: '2026-11-06T17:30:00.000Z', timeZone: 'UTC', isAllDay: false, attendees: [], recurrence: []};
const phase = record => ({dirty: 'queued', clean: 'done', quarantined: 'uncertain'})[record.state];

export async function calendarRefinement() {
  const sources = ['apps/app/src/runtime/calendar-linked-store.ts', '.eliza/client-features/packages/contracts/src/calendar-linked-sync.ts', 'specs/quint/refinement/services/calendar.mjs', 'specs/quint/refinement/services/support.mjs'];
  let driverHashes = captureInputs(sources);
  const capture = inputs => {
    sources.push(...inputs.filter(input => !sources.includes(input)));
    const next = captureInputs(sources);
    for (const [path, hash] of Object.entries(driverHashes)) assert.equal(next[path], hash, `Source changed before import: ${path}`);
    driverHashes = next;
  };
  const {CalendarLinkedStore} = await sourceModule('apps/app/src/runtime/calendar-linked-store.ts', {}, capture);
  const {LinkedCalendarReconciler} = await sourceModule('.eliza/client-features/packages/contracts/src/calendar-linked-sync.ts', {}, capture);
  function fixture(outcome) {
    const slots = new Map(), calls = [];
    let response = null, failure = outcome;
    const storage = {
      async read(key) { return structuredClone(slots.get(key) ?? null); },
      async compareExchange(key, before, next) {
        if (JSON.stringify(slots.get(key) ?? null) !== JSON.stringify(before)) return {status: 'conflict'};
        slots.set(key, structuredClone(next)); return {status: 'saved'};
      },
    };
    const provider = {
      async get() { return response; },
      async create(record, value) {
        calls.push(record.idempotencyKey);
        if (failure === 'unknown') throw Error('Provider response lost');
        if (failure === 'not-accepted') throw {outcome: 'not_accepted', code: 'FIXTURE_NOT_ACCEPTED', message: 'Provider refused before accepting'};
        response = {eventId: 'provider-1', etag: 'v1', event: structuredClone(value)};
        return response;
      },
      async update() { throw Error('Unexpected update'); },
      async delete() { throw Error('Unexpected delete'); },
    };
    const local = {async get() { return {eventId: 'local-1', revision: 'r1', event: structuredClone(event)}; }, async applyProviderEvent() { throw Error('Unexpected pull'); }, async delete() { throw Error('Unexpected local delete'); }};
    const open = () => CalendarLinkedStore.open(binding, () => true, storage);
    return {calls, open, engine: store => new LinkedCalendarReconciler(store, local, provider), fail: value => { failure = value; }, observe: value => { response = value; }};
  }
  const traces = [];
  for (const outcome of ['accepted', 'unknown', 'not-accepted']) {
    const f = fixture(outcome), store = await f.open();
    let record = await store.link('local-1', 'r1');
    const trace = {name: `linked Calendar create ${outcome}`, expect: {'s.sends': 0}, steps: [{label: 'current source persists one checkpoint and stable operation key', action: action('enqueue', 'create', false), expect: {'s.phase': phase(record)}}]};
    const engine = f.engine(store), result = await engine.reconcile(record);
    record = (await store.list())[0];
    trace.steps.push({label: 'provider result updates the same durable checkpoint', action: [action('claim'), action('dispatch'), action(outcome === 'accepted' ? 'completed' : outcome === 'unknown' ? 'lostReply' : 'providerFailure')], expect: {'s.sends': f.calls.length, ...(outcome !== 'not-accepted' ? {'s.phase': phase(record)} : {'s.retryAuthorized': record.lastErrorCode === 'FIXTURE_NOT_ACCEPTED'})}});
    if (outcome === 'unknown') {
      assert.equal(result, 'quarantined');
      const stableKey = record.idempotencyKey, reopened = await f.open();
      record = (await reopened.list())[0]; assert.equal(record.idempotencyKey, stableKey);
      const recovered = f.engine(reopened);
      await recovered.reconcile(record);
      trace.steps.push({label: 'restart does not replay an ambiguous create', action: action('restart'), expect: {'s.phase': phase(record), 's.sends': f.calls.length}});
      f.observe({eventId: 'provider-1', etag: 'v1', event: {...event, title: 'Other event'}});
      assert.equal(await recovered.recoverDispatch(record), false);
      trace.steps.push({label: 'existence without exact semantic readback does not settle uncertainty', action: action('findCreated', false), expect: {'s.phase': phase((await reopened.list())[0]), 's.sends': f.calls.length}});
      f.observe({eventId: 'provider-1', etag: 'v1', event: structuredClone(event)});
      assert.equal(await recovered.recoverDispatch(record), true);
      trace.steps.push({label: 'matching source-bound readback settles without another write', action: action('findCreated', true), expect: {'s.phase': phase((await reopened.list())[0]), 's.sends': f.calls.length}});
    }
    if (outcome === 'not-accepted') {
      assert.equal(result, 'dirty'); f.fail('accepted');
      await engine.reconcile(record);
      trace.steps.push({label: 'explicit reconciliation retries a known non-acceptance using the same key', action: [action('retryKnownFailure'), action('claim'), action('dispatch'), action('completed')], expect: {'s.phase': phase((await store.list())[0]), 's.sends': f.calls.length}});
      assert.equal(new Set(f.calls).size, 1);
    }
    traces.push(trace);
  }
  return checkTraces({model: 'CalendarSync', sources, driverHashes, traces, scope: 'bounded-component', assumptions: ['Actual current linked Calendar checkpoint storage and reconciler execute with controlled local and provider ports.', 'The trace maps dirty, clean and quarantined checkpoints to the model queued, done and uncertain phases. Provider callbacks are atomic macro steps here.', 'Canonical SQL mutation-ledger claims, linked-sync opt-in review and native deletion timers are separate subcontracts outside this adapter.']});
}
