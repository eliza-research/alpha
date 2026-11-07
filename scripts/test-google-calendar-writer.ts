// Synthetic Cloud client only: no OAuth, provider traffic or network requests.
import assert from 'node:assert/strict';
import { CloudProtocolError, type GoogleCalendarEvent } from '../apps/app/src/runtime/cloud-protocol.ts';
import { classifyGoogleCalendarError, planGoogleCalendarWrite, sendGoogleCalendarWrite, type GoogleCalendarWriteClient, type GoogleCalendarWriteOperation } from '../apps/app/src/runtime/google-calendar-writer.ts';

const grant = '72475cd0-e135-4c42-a9e2-fb5fe0820ada', calendarId = 'owner@example.test';
const event: GoogleCalendarEvent = { externalId: 'occ_20261106T170000Z', calendarId, title: 'Standup', description: '', location: '', status: 'confirmed', startAt: '2026-11-06T17:00:00Z', endAt: '2026-11-06T17:15:00Z', isAllDay: false, timezone: 'America/Los_Angeles', htmlLink: null, conferenceLink: null, organizer: null,
  attendees: [{ email: 'owner@example.test', displayName: null, responseStatus: 'needsAction', self: true, organizer: false, optional: false }], metadata: { recurringEventId: 'series' } };
function client(answer: (call: { method: string; args: unknown[] }) => unknown = () => undefined) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const run = async (method: string, args: unknown[]) => { const call = { method, args: args.slice(0, -1) }; calls.push(call); const value = answer(call); if (value instanceof Error) throw value; return value; };
  const api: GoogleCalendarWriteClient = {
    googleCalendarCreateEvent: async (...args) => (await run('create', args) as GoogleCalendarEvent | undefined) ?? { ...event, externalId: 'new_1' },
    googleCalendarUpdateEvent: async (...args) => (await run('update', args) as GoogleCalendarEvent | undefined) ?? event,
    googleCalendarDeleteEvent: async (...args) => { await run('delete', args); },
  };
  return { api, calls };
}
const signal = () => new AbortController().signal;
const target = { connectionId: grant, calendarId };
const timed = { startAt: '2026-11-06T18:00:00Z', endAt: '2026-11-06T18:30:00Z', timeZone: 'America/Los_Angeles' };
let passed = 0;
async function check(name: string, run: () => Promise<void>) { await run(); console.log(`ok ${++passed} - ${name}`); }

await check('"this" changes the occurrence; "all" changes the series by its recurring id', async () => {
  const c = client();
  assert.equal((await sendGoogleCalendarWrite(c.api, { ...target, kind: 'update', eventId: event.externalId, recurringEventId: 'series', scope: 'this', allDay: false, fields: { title: 'Moved', ...timed } }, signal())).status, 'done');
  assert.deepEqual(c.calls.at(-1), { method: 'update', args: [grant, calendarId, event.externalId, { title: 'Moved', ...timed }] });
  assert.equal((await sendGoogleCalendarWrite(c.api, { ...target, kind: 'update', eventId: event.externalId, recurringEventId: 'series', scope: 'all', allDay: false, fields: { title: 'Renamed', location: 'Room 2' } }, signal())).status, 'done');
  assert.deepEqual(c.calls.at(-1), { method: 'update', args: [grant, calendarId, 'series', { title: 'Renamed', location: 'Room 2' }] });
  await sendGoogleCalendarWrite(c.api, { ...target, kind: 'delete', eventId: event.externalId, recurringEventId: 'series', scope: 'all' }, signal());
  assert.deepEqual(c.calls.at(-1), { method: 'delete', args: [grant, calendarId, 'series'] });
  await sendGoogleCalendarWrite(c.api, { ...target, kind: 'delete', eventId: 'single', recurringEventId: null, scope: 'all' }, signal());
  assert.deepEqual(c.calls.at(-1), { method: 'delete', args: [grant, calendarId, 'single'] }, 'a single event has no series');
});
await check('Cloud gaps are refused before any request: following, series times, all-day times and creates, unsendable ids', async () => {
  const c = client();
  const cases: Array<[GoogleCalendarWriteOperation, string]> = [
    [{ ...target, kind: 'update', eventId: 'e', recurringEventId: 'series', scope: 'following', allDay: false, fields: { title: 'x' } }, 'following'],
    [{ ...target, kind: 'delete', eventId: 'e', recurringEventId: 'series', scope: 'following' }, 'following'],
    [{ ...target, kind: 'update', eventId: 'e', recurringEventId: 'series', scope: 'all', allDay: false, fields: { startAt: timed.startAt } }, 'series-time'],
    [{ ...target, kind: 'update', eventId: 'e', recurringEventId: null, scope: 'this', allDay: true, fields: { ...timed } }, 'all-day'],
    [{ ...target, kind: 'create', allDay: true, fields: { title: 'Holiday', ...timed } }, 'all-day'],
    [{ ...target, kind: 'update', eventId: 'needs%2Fencoding', recurringEventId: null, scope: 'this', allDay: false, fields: { title: 'x' } }, 'event-id'],
    [{ ...target, kind: 'rsvp', eventId: 'e', response: 'yes' }, 'rsvp'],
  ];
  for (const [op, reason] of cases) assert.deepEqual(await sendGoogleCalendarWrite(c.api, op, signal()), { status: 'unsupported', reason }, reason);
  assert.equal(c.calls.length, 0);
  // Text fields of an all-day event can still change; its times are never sent.
  assert.equal((await sendGoogleCalendarWrite(c.api, { ...target, kind: 'update', eventId: 'e', recurringEventId: null, scope: 'this', allDay: true, fields: { title: 'Holiday', description: 'Off' } }, signal())).status, 'done');
  assert.deepEqual(c.calls.at(-1)?.args[3], { title: 'Holiday', description: 'Off' });
});
await check('guests go only on create; an update never carries them', async () => {
  const c = client();
  await sendGoogleCalendarWrite(c.api, { ...target, kind: 'create', fields: { title: 'Lunch', ...timed, attendees: ['guest@example.test'] } }, signal());
  assert.deepEqual(c.calls.at(-1)?.args[2], { title: 'Lunch', ...timed, attendees: [{ email: 'guest@example.test' }] });
  await sendGoogleCalendarWrite(c.api, { ...target, kind: 'update', eventId: 'e', recurringEventId: null, scope: 'this', allDay: false, fields: { title: 'x', attendees: ['other@example.test'] } }, signal());
  assert.deepEqual(c.calls.at(-1)?.args[3], { title: 'x' });
  assert.equal(planGoogleCalendarWrite({ ...target, kind: 'update', eventId: 'e', recurringEventId: null, scope: 'this', allDay: false, fields: { attendees: ['a@b.c'] } }).status, 'invalid', 'an update of guests alone has nothing to send');
  assert.equal(planGoogleCalendarWrite({ ...target, kind: 'create', fields: { title: 'x' } }).status, 'invalid');
});
await check('RSVP needs the capability flag and a reply Google recorded', async () => {
  const declined = { ...event, attendees: [{ ...event.attendees[0], responseStatus: 'declined' }] };
  const ok = client(call => call.method === 'update' ? declined : undefined);
  assert.equal((await sendGoogleCalendarWrite(ok.api, { ...target, kind: 'rsvp', eventId: 'e', response: 'no' }, signal(), { rsvp: true })).status, 'done');
  assert.deepEqual(ok.calls.at(-1)?.args[3], { responseStatus: 'declined' });
  const ignored = client(() => event);
  assert.deepEqual(await sendGoogleCalendarWrite(ignored.api, { ...target, kind: 'rsvp', eventId: 'e', response: 'maybe' }, signal(), { rsvp: true }), { status: 'unsupported', reason: 'rsvp' }, 'a silent no-op is not a reply');
});
await check('errors are classified for the outbox', async () => {
  const cases: Array<[unknown, object]> = [
    [new CloudProtocolError('http', 400), { status: 'invalid' }], [new TypeError('bad'), { status: 'invalid' }],
    [new CloudProtocolError('http', 401), { status: 'signed-out' }], [new CloudProtocolError('credentials-missing'), { status: 'signed-out' }], [new CloudProtocolError('expired'), { status: 'signed-out' }],
    // The account changed after the request completed: it may have reached Google.
    [new CloudProtocolError('account-changed'), { status: 'retryable', applied: 'unknown' }], [new CloudProtocolError('credential-consumed'), { status: 'retryable', applied: 'unknown' }],
    [new CloudProtocolError('http', 403), { status: 'needs-permission' }], [new CloudProtocolError('http', 409), { status: 'needs-permission' }],
    [new CloudProtocolError('http', 404), { status: 'gone' }], [new CloudProtocolError('http', 412), { status: 'conflict' }],
    [new CloudProtocolError('http', 429), { status: 'retryable', applied: 'no' }], [new CloudProtocolError('http', 502), { status: 'retryable', applied: 'unknown' }],
    [new CloudProtocolError('http', 500), { status: 'retryable', applied: 'unknown' }], [new Error('network'), { status: 'retryable', applied: 'unknown' }],
    [new CloudProtocolError('invalid-response'), { status: 'retryable', applied: 'unknown' }],
  ];
  for (const [error, expected] of cases) assert.deepEqual(classifyGoogleCalendarError(error), expected, String(error));
  const failing = client(() => new CloudProtocolError('http', 404));
  assert.deepEqual(await sendGoogleCalendarWrite(failing.api, { ...target, kind: 'delete', eventId: 'e', recurringEventId: null, scope: 'this' }, signal()), { status: 'gone' });
});
await check('an abort rejects instead of being classified', async () => {
  const controller = new AbortController();
  const c = client(() => { controller.abort(); return new Error('aborted'); });
  await assert.rejects(sendGoogleCalendarWrite(c.api, { ...target, kind: 'delete', eventId: 'e', recurringEventId: null, scope: 'this' }, controller.signal));
});
console.log(`${passed} synthetic Google Calendar writer checks passed; no live Cloud acceptance claimed.`);
