import { CloudProtocolError, GOOGLE_CALENDAR_EVENT_ID, type GoogleCalendarEvent, type GoogleCalendarEventInput, type GoogleCalendarEventPatch } from './cloud-protocol.ts';

/**
 * Turns one queued Google Calendar change into one Cloud request (cloud-protocol.ts) and classifies
 * the answer. Pure apart from the client call: no storage, timers or UI.
 *
 * What current Cloud cannot do, and what this module therefore refuses as `unsupported`:
 * - "This and following" for a repeating event (the PATCH body has no recurrence field).
 * - Times of a whole series (the series start is unknown and there is no route to read one event).
 * - All-day events: Cloud would turn them into timed events, so their times are never sent and
 *   all-day events are never created.
 * - RSVP, unless `capabilities.rsvp` is on; even then a reply Google did not record counts as
 *   unsupported (Cloud drops fields it does not know).
 * Guests are never sent on an update: Cloud's PATCH replaces the whole guest list without answers.
 */
export interface GoogleCalendarWriteClient {
  googleCalendarCreateEvent(grantId: string, calendarId: string, input: GoogleCalendarEventInput, signal: AbortSignal): Promise<GoogleCalendarEvent>;
  googleCalendarUpdateEvent(grantId: string, calendarId: string, eventId: string, patch: GoogleCalendarEventPatch, signal: AbortSignal): Promise<GoogleCalendarEvent>;
  googleCalendarDeleteEvent(grantId: string, calendarId: string, eventId: string, signal: AbortSignal): Promise<void>;
}
export type GoogleCalendarScope = 'this' | 'following' | 'all';
export type GoogleCalendarRsvp = 'yes' | 'no' | 'maybe';
/** What Cloud supports beyond the reviewed baseline. All off until a reviewed Cloud pin adds them. */
export interface GoogleCalendarWriteCapabilities { rsvp?: boolean }
export const GOOGLE_CALENDAR_WRITE_CAPABILITIES: Readonly<Required<GoogleCalendarWriteCapabilities>> = Object.freeze({ rsvp: false });
/** Changed fields. Instants are ISO strings with an offset, computed by the form (calendarOptionEvent). */
export interface GoogleCalendarWriteFields {
  title?: string; description?: string; location?: string; startAt?: string; endAt?: string; timeZone?: string;
  /** Guest emails; sent only when creating. */
  attendees?: string[];
}
interface Target { connectionId: string; calendarId: string }
export type GoogleCalendarWriteOperation =
  | Target & { kind: 'create'; fields: GoogleCalendarWriteFields; allDay?: boolean }
  | Target & { kind: 'update'; eventId: string; recurringEventId: string | null; scope: GoogleCalendarScope; allDay: boolean; fields: GoogleCalendarWriteFields }
  | Target & { kind: 'delete'; eventId: string; recurringEventId: string | null; scope: GoogleCalendarScope }
  | Target & { kind: 'rsvp'; eventId: string; response: GoogleCalendarRsvp };
export type GoogleCalendarUnsupported = 'following' | 'series-time' | 'all-day' | 'rsvp' | 'event-id';
export type GoogleCalendarWriteResult =
  | { status: 'done'; event?: GoogleCalendarEvent }
  | { status: 'unsupported'; reason: GoogleCalendarUnsupported }
  /** 400 or input Cloud would refuse. */
  | { status: 'invalid' }
  /** 401, or no saved (or unexpired) credentials before the request was sent. */
  | { status: 'signed-out' }
  /** 403/409: the grant lacks Calendar write or was withdrawn. */
  | { status: 'needs-permission' }
  /** 404: the event or calendar is gone. */
  | { status: 'gone' }
  /** 412 (future If-Match support): Google's copy changed first. */
  | { status: 'conflict' }
  /** 429, 5xx (502 also hides Google 404/410/412), network errors, and a Cloud account that changed
   * while the request was in flight. `applied` says whether the change may already have happened:
   * only a 429 proves it did not. */
  | { status: 'retryable'; applied: 'no' | 'unknown' };

const REPLY: Record<GoogleCalendarRsvp, 'accepted' | 'declined' | 'tentative'> = { yes: 'accepted', no: 'declined', maybe: 'tentative' };
const TIME_FIELDS = ['startAt', 'endAt', 'timeZone'] as const;
const hasTime = (fields: GoogleCalendarWriteFields) => TIME_FIELDS.some(key => fields[key] !== undefined);
const textFields = (fields: GoogleCalendarWriteFields): GoogleCalendarEventPatch => ({
  ...(fields.title !== undefined ? { title: fields.title } : {}),
  ...(fields.description !== undefined ? { description: fields.description } : {}),
  ...(fields.location !== undefined ? { location: fields.location } : {}),
});

type Plan =
  | { status: 'ready'; send: (client: GoogleCalendarWriteClient, signal: AbortSignal) => Promise<GoogleCalendarWriteResult> }
  | { status: 'unsupported'; reason: GoogleCalendarUnsupported }
  | { status: 'invalid' };

/** Decides what request a change needs, without sending it. */
export function planGoogleCalendarWrite(op: GoogleCalendarWriteOperation, capabilities: GoogleCalendarWriteCapabilities = GOOGLE_CALENDAR_WRITE_CAPABILITIES): Plan {
  const { connectionId: grant, calendarId } = op;
  if (op.kind === 'create') {
    if (op.allDay) return { status: 'unsupported', reason: 'all-day' };
    const f = op.fields;
    if (typeof f.title !== 'string' || typeof f.startAt !== 'string' || typeof f.endAt !== 'string' || typeof f.timeZone !== 'string') return { status: 'invalid' };
    const input: GoogleCalendarEventInput = { title: f.title, startAt: f.startAt, endAt: f.endAt, timeZone: f.timeZone,
      ...(f.description !== undefined ? { description: f.description } : {}), ...(f.location !== undefined ? { location: f.location } : {}),
      ...(f.attendees?.length ? { attendees: f.attendees.map(email => ({ email })) } : {}) };
    return { status: 'ready', send: async (client, signal) => ({ status: 'done', event: await client.googleCalendarCreateEvent(grant, calendarId, input, signal) }) };
  }
  if (op.kind === 'rsvp') {
    if (!capabilities.rsvp) return { status: 'unsupported', reason: 'rsvp' };
    if (!GOOGLE_CALENDAR_EVENT_ID.test(op.eventId)) return { status: 'unsupported', reason: 'event-id' };
    const wanted = REPLY[op.response];
    if (!wanted) return { status: 'invalid' };
    return { status: 'ready', send: async (client, signal) => {
      const event = await client.googleCalendarUpdateEvent(grant, calendarId, op.eventId, { responseStatus: wanted }, signal);
      // Cloud drops fields it does not know; a reply Google did not record is not a success.
      return event.attendees.find(guest => guest.self)?.responseStatus === wanted ? { status: 'done', event } : { status: 'unsupported', reason: 'rsvp' };
    } };
  }
  if (op.scope === 'following') return { status: 'unsupported', reason: 'following' };
  const series = op.scope === 'all' && !!op.recurringEventId;
  const target = series ? op.recurringEventId! : op.eventId;
  if (!GOOGLE_CALENDAR_EVENT_ID.test(target)) return { status: 'unsupported', reason: 'event-id' };
  if (op.kind === 'delete') return { status: 'ready', send: async (client, signal) => { await client.googleCalendarDeleteEvent(grant, calendarId, target, signal); return { status: 'done' }; } };
  if (hasTime(op.fields)) {
    if (op.allDay) return { status: 'unsupported', reason: 'all-day' };
    if (series) return { status: 'unsupported', reason: 'series-time' };
  }
  const patch: GoogleCalendarEventPatch = { ...textFields(op.fields), ...(op.fields.startAt !== undefined ? { startAt: op.fields.startAt } : {}),
    ...(op.fields.endAt !== undefined ? { endAt: op.fields.endAt } : {}), ...(op.fields.timeZone !== undefined ? { timeZone: op.fields.timeZone } : {}) };
  if (!Object.keys(patch).length) return { status: 'invalid' };
  return { status: 'ready', send: async (client, signal) => ({ status: 'done', event: await client.googleCalendarUpdateEvent(grant, calendarId, target, patch, signal) }) };
}

/** Classifies a failed Cloud request. Aborts are rethrown by sendGoogleCalendarWrite, not classified. */
export function classifyGoogleCalendarError(error: unknown): GoogleCalendarWriteResult {
  if (error instanceof TypeError) return { status: 'invalid' };
  if (error instanceof CloudProtocolError) {
    // Raised before the request is sent: nothing reached Google.
    if (error.code === 'credentials-missing' || error.code === 'expired') return { status: 'signed-out' };
    // Raised after the request completed (the account changed while it was in flight): the change
    // may have happened, so a create is matched against Google before it is ever sent again.
    if (error.code === 'account-changed' || error.code === 'credential-consumed') return { status: 'retryable', applied: 'unknown' };
    // A 2xx answer Cloud could not explain: the change may have happened.
    if (error.code === 'invalid-response') return { status: 'retryable', applied: 'unknown' };
    const status = error.status ?? 0;
    if (status === 400 || status === 422) return { status: 'invalid' };
    if (status === 401) return { status: 'signed-out' };
    if (status === 403 || status === 409) return { status: 'needs-permission' };
    if (status === 404 || status === 410) return { status: 'gone' };
    if (status === 412) return { status: 'conflict' };
    if (status === 429) return { status: 'retryable', applied: 'no' };
  }
  return { status: 'retryable', applied: 'unknown' };
}

/** Plans and sends one change. Rejects only when `signal` aborts. */
export async function sendGoogleCalendarWrite(client: GoogleCalendarWriteClient, op: GoogleCalendarWriteOperation, signal: AbortSignal, capabilities: GoogleCalendarWriteCapabilities = GOOGLE_CALENDAR_WRITE_CAPABILITIES): Promise<GoogleCalendarWriteResult> {
  signal.throwIfAborted();
  const plan = planGoogleCalendarWrite(op, capabilities);
  if (plan.status !== 'ready') return plan;
  try { return await plan.send(client, signal); }
  catch (error) { if (signal.aborted) throw signal.reason; return classifyGoogleCalendarError(error); }
}
