import { CloudProtocolError, type CloudEnvironment, type GmailAccount, type GoogleCalendarEvent, type GoogleCalendarFeed, type GoogleCalendarRange, type GoogleCalendarSummary } from './cloud-protocol.ts';
import type { CalendarRecord } from '../browser/calendar-records.ts';

/** Identifiers only. Credentials stay in CloudProtocol's secure credential store. */
export interface GoogleCalendarBinding {
  environment: CloudEnvironment;
  userId: string;
  organizationId: string;
  credentialId: string;
  sessionId: string;
  connectionId: string;
}
export interface GoogleCalendarClient {
  gmailAccounts(signal: AbortSignal): Promise<GmailAccount[]>;
  googleCalendars(grantId: string, signal: AbortSignal): Promise<GoogleCalendarSummary[]>;
  googleCalendarFeed(grantId: string, calendarId: string, range: GoogleCalendarRange, signal: AbortSignal): Promise<GoogleCalendarFeed>;
}
export interface GoogleCalendarSource {
  id: string;
  name: string;
  account: string;
  connectionId: string;
  providerCalendarId: string;
  timeZone: string | null;
  primary: boolean;
  source: 'google';
  /** Google's access role: reader, writer or owner (free/busy-only calendars are not listed). */
  accessRole: string;
  /** Google's calendar colour (#rrggbb) and its text colour; null when Google gives none. */
  color: string | null;
  textColor: string | null;
  /** Whether Google itself shows this calendar in the owner's list. */
  selected: boolean;
  /** The role allows changes and the account granted google.calendar.write. */
  writable: boolean;
}
export interface GoogleCalendarAttendee {
  email: string | null; displayName: string | null; responseStatus: string | null; self: boolean; organizer: boolean; optional: boolean;
}
export type GoogleCalendarResponse = 'accepted' | 'declined' | 'tentative' | 'needsAction';
export interface GoogleCalendarRecord extends CalendarRecord {
  source: 'google';
  /** Copied from the calendar; false means show only. */
  writable: boolean;
  providerEventId: string;
  connectionId: string;
  providerCalendarId: string;
  /** The series an occurrence belongs to; null for a single event. */
  recurringEventId: string | null;
  htmlLink: string | null;
  conferenceLink: string | null;
  attendees: GoogleCalendarAttendee[];
  /** The owner's own answer when they are a guest; null when they are not on the guest list. */
  selfResponse: GoogleCalendarResponse | null;
  organizerSelf: boolean;
}
type Failure = { status: 'not-connected' | 'permission-required' | 'unavailable'; message: string };
export type GoogleCalendarSources = Failure | { status: 'ready'; calendars: GoogleCalendarSource[] };
/** One calendar's events, or why that calendar could not be read. */
export type GoogleCalendarRead = Failure | {
  status: 'ready'; calendar: GoogleCalendarSource; events: GoogleCalendarRecord[]; syncedAt: string; truncated: false;
};
/** An account-level failure, or one result per requested calendar (a failing calendar never blanks the others). */
export type GoogleCalendarReadMany = Failure | {
  status: 'ready'; calendars: GoogleCalendarSource[]; results: Array<{ sourceId: string; result: GoogleCalendarRead }>;
};
const bindingKey = (binding: GoogleCalendarBinding) => JSON.stringify([
  binding.environment, binding.userId, binding.organizationId, binding.credentialId, binding.sessionId, binding.connectionId,
]);
const sourceId = (binding: GoogleCalendarBinding, calendarId: string) => `google:${encodeURIComponent(binding.connectionId)}:${encodeURIComponent(calendarId)}`;
const abortChanged = () => new DOMException('Google Calendar account or connection changed.', 'AbortError');
const disconnected = (): Failure => ({ status: 'not-connected', message: 'Connect Google Calendar.' });
const permissionRequired = (): Failure => ({ status: 'permission-required', message: 'Reconnect Google to show Calendar.' });
const readable = (calendar: GoogleCalendarSummary) => ['reader', 'writer', 'owner'].includes(calendar.accessRole);
const hex = (value: string | null) => value && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
const https = (value: string | null) => { try { return value && new URL(value).protocol === 'https:' ? value : null; } catch { return null; } };
const RESPONSES: readonly string[] = ['accepted', 'declined', 'tentative', 'needsAction'];
/** Feeds read at once; more calendars wait their turn. */
const READ_CONCURRENCY = 3;
/** The owner's own answer on an event, when they are on its guest list. */
export function googleCalendarSelfResponse(event: Pick<GoogleCalendarEvent, 'attendees'>): GoogleCalendarResponse | null {
  const own = event.attendees.find(guest => guest.self)?.responseStatus ?? null;
  return own !== null && RESPONSES.includes(own) ? own as GoogleCalendarResponse : null;
}
/** Change marker of one event as the Calendar view shows it; the outbox compares it before sending. */
export function googleCalendarRevision(event: GoogleCalendarEvent): string {
  return JSON.stringify([event.externalId, event.startAt, event.endAt, event.status, event.title, event.description, event.location, googleCalendarSelfResponse(event)]);
}
function source(binding: GoogleCalendarBinding, account: GmailAccount, calendar: GoogleCalendarSummary): GoogleCalendarSource {
  return { id: sourceId(binding, calendar.calendarId), name: calendar.summary || 'Google Calendar', account: account.label,
    connectionId: binding.connectionId, providerCalendarId: calendar.calendarId, timeZone: calendar.timeZone,
    primary: calendar.primary, source: 'google', accessRole: calendar.accessRole,
    color: hex(calendar.backgroundColor), textColor: hex(calendar.foregroundColor), selected: calendar.selected,
    writable: ['writer', 'owner'].includes(calendar.accessRole) && account.grantedCapabilities.includes('google.calendar.write') };
}
function failure(error: unknown): Failure {
  if (error instanceof CloudProtocolError) {
    if (error.code === 'credentials-missing' || error.code === 'expired' || error.status === 401) return disconnected();
    if ([403, 404, 409].includes(error.status || 0)) return permissionRequired();
  }
  return { status: 'unavailable', message: 'Couldn’t load Google Calendar. Try again.' };
}
function record(event: GoogleCalendarEvent, calendar: GoogleCalendarSource): GoogleCalendarRecord {
  let begin = Date.parse(event.startAt), end = Date.parse(event.endAt);
  // Google allows zero-length events; they show as short blocks.
  if (!Number.isFinite(begin) || !Number.isFinite(end) || end < begin) throw new CloudProtocolError('invalid-response');
  const timeZone = event.timezone || calendar.timeZone;
  // Cloud normalizes Google's all-day dates to midnight instants in the calendar zone.
  // Alpha stores their civil dates at UTC midnight, including the exclusive end date.
  // Convert each boundary independently: a DST transition can make the provider span
  // 23 or 25 hours without changing the number of calendar days it occupies.
  try {
    if (event.isAllDay) {
      if (!timeZone) throw new CloudProtocolError('invalid-response');
      const format = new Intl.DateTimeFormat('en-US', { timeZone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit' });
      const civil = (instant: number) => {
        const parts = Object.fromEntries(format.formatToParts(instant).map(part => [part.type, part.value]));
        return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
      };
      begin = civil(begin); end = civil(end);
      if (Number.isFinite(begin) && end === begin) end = begin + 86400000;
      if (!Number.isFinite(begin) || !Number.isFinite(end) || end <= begin) throw new CloudProtocolError('invalid-response');
    } else if (timeZone) new Intl.DateTimeFormat('en-US', { timeZone });
  } catch { throw new CloudProtocolError('invalid-response'); }
  const attendees = event.attendees.map(guest => ({ ...guest }));
  const selfResponse = googleCalendarSelfResponse(event);
  const recurring = event.metadata?.recurringEventId;
  return { id: `${calendar.id}:${encodeURIComponent(event.externalId)}`, calendarId: calendar.id,
    providerEventId: event.externalId, title: event.title || 'Untitled event', body: event.description, location: event.location,
    begin, end, allDay: event.isAllDay, timeZone: event.isAllDay ? 'UTC' : event.timezone || calendar.timeZone || 'UTC',
    // Google rows never go to the local Calendar writer or recurrence engine; changes go through the outbox.
    revision: googleCalendarRevision(event),
    source: 'google', writable: calendar.writable, connectionId: calendar.connectionId, providerCalendarId: calendar.providerCalendarId,
    recurringEventId: typeof recurring === 'string' && recurring.trim() ? recurring : null,
    htmlLink: https(event.htmlLink), conferenceLink: https(event.conferenceLink), attendees, selfResponse,
    organizerSelf: event.organizer?.self === true };
}

/** Cloud reader for every calendar of one Google connection. It never writes local Calendar
 * storage or grants agent access. UI owners call invalidate on disconnect/unmount; getBinding is
 * checked after every await so an account switch rejects late data. */
export class GoogleCalendarReader {
  private epoch = 0;
  constructor(private readonly client: GoogleCalendarClient, private readonly getBinding: () => GoogleCalendarBinding | null) {}

  invalidate(): void { ++this.epoch; }
  private ticket(signal: AbortSignal) {
    signal.throwIfAborted();
    const binding = this.getBinding();
    if (!binding || Object.values(binding).some(value => !value)) return null;
    const key = bindingKey(binding), epoch = this.epoch;
    const current = () => {
      signal.throwIfAborted();
      const active = this.getBinding();
      if (this.epoch !== epoch || !active || bindingKey(active) !== key) throw abortChanged();
    };
    return { binding: { ...binding }, key, current };
  }
  private async account(binding: GoogleCalendarBinding, signal: AbortSignal, current: () => void): Promise<GmailAccount | Failure> {
    const accounts = await this.client.gmailAccounts(signal); current();
    const account = accounts.find(item => item.connectionId === binding.connectionId);
    if (!account?.connected) return disconnected();
    if (!account.grantedCapabilities.includes('google.calendar.read')) return permissionRequired();
    return account;
  }
  /** Every readable calendar of the connection, with colour, Google's own shown flag and whether it can be changed. */
  async listSources(signal: AbortSignal): Promise<GoogleCalendarSources> {
    const ticket = this.ticket(signal);
    if (!ticket) { this.invalidate(); return disconnected(); }
    const { binding, current } = ticket;
    try {
      const account = await this.account(binding, signal, current);
      if ('status' in account) { this.invalidate(); return account; }
      const calendars = (await this.client.googleCalendars(binding.connectionId, signal)).filter(readable); current();
      return { status: 'ready', calendars: calendars.map(calendar => source(binding, account, calendar)) };
    } catch (error) { current(); if (error instanceof CloudProtocolError && error.code === 'account-changed') throw abortChanged(); return failure(error); }
  }
  /** Reads several calendars of this connection over one range: one account check and one
   * calendar list, then one feed per calendar, at most three at a time. Each calendar gets its
   * own result; a calendar that is no longer listed reports permission-required. */
  async readMany(sourceIds: readonly string[], range: GoogleCalendarRange, signal: AbortSignal): Promise<GoogleCalendarReadMany> {
    const ticket = this.ticket(signal);
    if (!ticket) { this.invalidate(); return disconnected(); }
    const { binding, current } = ticket;
    const start = Date.parse(range.timeMin), end = Date.parse(range.timeMax);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new TypeError('Choose a valid Calendar range.');
    new Intl.DateTimeFormat('en', { timeZone: range.timeZone });
    const wanted = [...new Set(sourceIds)];
    if (wanted.length > 100) throw new TypeError('Too many calendars.');
    const window = { ...range };
    try {
      const account = await this.account(binding, signal, current);
      if ('status' in account) { this.invalidate(); return account; }
      const listed = (await this.client.googleCalendars(binding.connectionId, signal)).filter(readable); current();
      const calendars = listed.map(calendar => source(binding, account, calendar));
      const byId = new Map(calendars.map(calendar => [calendar.id, calendar]));
      const results: Array<{ sourceId: string; result: GoogleCalendarRead }> = wanted.map(id => ({ sourceId: id, result: permissionRequired() }));
      let next = 0;
      const worker = async () => {
        while (next < wanted.length) {
          const index = next++, calendar = byId.get(wanted[index]);
          if (!calendar) continue;
          results[index].result = await this.readOne(binding, calendar, window, start, end, signal, current);
        }
      };
      await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, wanted.length) }, worker));
      current();
      return { status: 'ready', calendars, results };
    } catch (error) { current(); if (error instanceof CloudProtocolError && error.code === 'account-changed') throw abortChanged(); return failure(error); }
  }
  private async readOne(binding: GoogleCalendarBinding, calendar: GoogleCalendarSource, window: GoogleCalendarRange, start: number, end: number, signal: AbortSignal, current: () => void): Promise<GoogleCalendarRead> {
    try {
      const feed = await this.client.googleCalendarFeed(binding.connectionId, calendar.providerCalendarId, window, signal); current();
      if (feed.calendarId !== calendar.providerCalendarId || !Number.isFinite(Date.parse(feed.syncedAt))) throw new CloudProtocolError('invalid-response');
      const seen = new Set<string>();
      const events = feed.events.filter(event => event.status !== 'cancelled').map(event => {
        if (event.calendarId !== calendar.providerCalendarId || seen.has(event.externalId)) throw new CloudProtocolError('invalid-response');
        seen.add(event.externalId);
        // One unreadable event is skipped; it never hides the rest of the calendar.
        try { return record(event, calendar); } catch { return null; }
      }).filter((event): event is GoogleCalendarRecord => event !== null).filter(event => event.begin < end && event.end > start).sort((a, b) => a.begin - b.begin || a.id.localeCompare(b.id));
      return { status: 'ready', calendar, events, syncedAt: feed.syncedAt, truncated: false };
    } catch (error) {
      current();
      if (error instanceof CloudProtocolError && error.code === 'account-changed') throw error;
      if (error instanceof CloudProtocolError && (error.code === 'credentials-missing' || error.code === 'expired')) throw error;
      return failure(error);
    }
  }
}
