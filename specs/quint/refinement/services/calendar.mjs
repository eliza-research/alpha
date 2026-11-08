import assert from 'node:assert/strict';
import {GoogleCalendarOutbox} from '../../../../apps/app/src/runtime/google-calendar-outbox.ts';
import {googleCalendarRevision} from '../../../../apps/app/src/runtime/google-calendar.ts';
import {DELETE_UNDO_MS} from '../../../../apps/app/src/runtime/deletion-window.ts';
import {checkTraces, captureInputs} from '../check-traces.mjs';
import {action, casStore, deferred, until} from './support.mjs';

const grant = '72475cd0-e135-4c42-a9e2-fb5fe0820ada', calendar = 'owner@example.test', source = `google:${grant}:owner%40example.test`;
function fixture() {
  const disk = casStore();
  let elapsed = 1000, continuity = 'boot-A', ids = 0;
  const calls = [], reads = [];
  const event = {externalId: 'event1', calendarId: calendar, title: 'Meeting', description: '', location: '', status: 'confirmed', startAt: '2026-11-06T17:00:00.000Z', endAt: '2026-11-06T17:30:00.000Z', isAllDay: false, timezone: 'UTC', htmlLink: null, conferenceLink: null, organizer: {self: true}, attendees: [], metadata: {}};
  const row = () => ({id: `${source}:event1`, calendarId: source, connectionId: grant, providerCalendarId: calendar, providerEventId: 'event1', title: event.title, body: '', location: '', begin: Date.parse(event.startAt), end: Date.parse(event.endAt), allDay: false, timeZone: 'UTC', revision: googleCalendarRevision(event), source: 'google', writable: true, recurringEventId: null, htmlLink: null, conferenceLink: null, attendees: [], selfResponse: null, organizerSelf: true});
  const controls = {readGate: null, sendGate: null, unknown: false};
  const read = async () => { reads.push(true); if (controls.readGate) await controls.readGate.promise; return {status: 'ready', calendar: {}, events: controls.unknown ? [] : [row()], syncedAt: '2026-11-06', truncated: false}; };
  const client = {
    async googleCalendarUpdateEvent(_grant, _calendar, _id, patch) { calls.push('update'); if (controls.sendGate) await controls.sendGate.promise; Object.assign(event, patch); return event; },
    async googleCalendarDeleteEvent() { calls.push('delete'); },
    async googleCalendarCreateEvent(_grant, _calendar, input) { calls.push('create'); if (controls.unknown) throw Error('lost response'); return {...event, ...input}; },
  };
  const make = () => new GoogleCalendarOutbox({owner: 'owner-A', store: {read: disk.store.read, exchange: disk.store.compareExchange}, client, read,
    clock: () => ({continuity, elapsed, wall: 1800000000000 + elapsed}), now: () => 1800000000000 + elapsed, id: () => 'id' + (++ids)});
  return {disk, make, row, event, calls, reads, controls, advance: value => { elapsed += value; }, reboot: () => { continuity = 'boot-B'; elapsed = 1; }};
}
export async function calendarRefinement() {
  const sources = ['apps/app/src/runtime/google-calendar-outbox.ts', 'apps/app/src/runtime/google-calendar-writer.ts', 'apps/app/src/runtime/google-calendar.ts', 'apps/app/src/runtime/deletion-window.ts', 'specs/quint/refinement/services/calendar.mjs', 'specs/quint/refinement/services/support.mjs'];
  const driverHashes = captureInputs(sources);
  const traces = [];
  {
    const f = fixture(), outbox = f.make(), readGate = deferred(), sendGate = deferred();
    f.controls.readGate = readGate; f.controls.sendGate = sendGate;
    const trace = {name: 'durable claim serializes competing outbox instances', expect: {'s.phase': outbox.operations.length ? 'queued' : 'empty', 's.sends': f.calls.length}, steps: []};
    await outbox.enqueue({kind: 'update', row: f.row(), scope: 'this', fields: {title: 'Changed'}});
    trace.steps.push({label: 'enqueue commits durable update before any provider call', action: action('enqueue', 'update', false), expect: {'s.phase': outbox.operations[0].phase, 's.sends': f.calls.length}});
    const flush = outbox.flush(); await until(() => f.reads.length === 1, 'claimed preflight');
    trace.steps.push({label: 'preflight entered after durable claim', action: action('claim'), expect: {'s.sends': f.calls.length}});
    const second = f.make(); await second.load(); await second.flush();
    trace.steps.push({label: 'second instance cannot dispatch fresh foreign claim', action: null, expect: {'s.sends': f.calls.length}});
    readGate.resolve(); await until(() => f.calls.length === 1, 'provider dispatch');
    trace.steps.push({label: 'fresh revision dispatches exactly once', action: [action('checkRevision'), action('dispatch')], expect: {'s.phase': f.disk.read().ops[0].phase, 's.sends': f.calls.length}});
    sendGate.resolve(); await flush;
    trace.steps.push({label: 'provider reply settles durable operation', action: action('completed'), expect: {'s.phase': outbox.operations[0].phase, 's.applied': outbox.operations[0].phase === 'done', 's.sends': f.calls.length}});
    traces.push(trace);
  }
  for (const restart of [false, true]) {
    const f = fixture(); let outbox = f.make();
    const trace = {name: restart ? 'reboot pauses delete until explicit decision' : 'undo deletes no provider data', expect: {'s.phase': 'empty', 's.sends': f.calls.length}, steps: []};
    const queued = await outbox.enqueue({kind: 'delete', row: f.row(), scope: 'this'}); assert.equal(queued.status, 'queued');
    trace.steps.push({label: 'durable delete has open undo window', action: action('enqueue', 'delete', false), expect: {'s.phase': outbox.operations[0].phase, 's.undoOpen': outbox.nextWake() > 0, 's.sends': f.calls.length}});
    if (restart) {
      f.reboot(); outbox = f.make(); await outbox.load();
      trace.steps.push({label: 'new instance cannot trust previous boot clock', action: action('rebootClock'), expect: {'s.phase': outbox.operations[0].phase}});
      await outbox.flush(); assert.equal(f.calls.length, 0);
      await outbox.resolvePaused(queued.id, 'send'); await outbox.flush();
      trace.steps.push({label: 'explicit Send permits one delete', action: [action('resolvePaused', true), action('claim'), action('checkRevision'), action('dispatch'), action('completed')], expect: {'s.phase': outbox.operations[0].phase, 's.sends': f.calls.length}});
    } else {
      await outbox.flush(); assert.equal(f.calls.length, 0);
      await outbox.undo(queued.id);
      trace.steps.push({label: 'Undo removes operation without a request', action: action('undo'), expect: {'s.phase': outbox.operations.length ? outbox.operations[0].phase : 'empty', 's.sends': f.calls.length}});
    }
    traces.push(trace);
  }
  {
    const f = fixture(), outbox = f.make(); f.controls.unknown = true;
    const trace = {name: 'unknown create never redispatches on repeated flush', expect: {'s.sends': 0, 's.phase': 'empty'}, steps: []};
    await outbox.enqueue({kind: 'create', sourceId: source, connectionId: grant, calendarId: calendar, fields: {title: 'New', startAt: f.event.startAt, endAt: f.event.endAt, timeZone: 'UTC'}});
    await outbox.flush();
    trace.steps.push({label: 'lost create response retains uncertain operation', action: [action('enqueue', 'create', false), action('claim'), action('dispatch'), action('lostReply')], expect: {'s.phase': outbox.operations[0].phase, 's.sends': f.calls.length}});
    await outbox.flush(); await outbox.flush();
    trace.steps.push({label: 'recovery reads without replaying mutation', action: action('findCreated', false), expect: {'s.phase': outbox.operations[0].phase, 's.sends': f.calls.length}});
    traces.push(trace);
  }
  return checkTraces({model: 'CalendarSync', sources, driverHashes, traces, scope: 'bounded-component', assumptions: ['One durable operation, two outbox instances and controlled provider response points.', 'The model checking phase is the preflight part of the source durable dispatching phase.', 'Linked Calendar sync consent and native provider writes require separate adapters.']});
}
