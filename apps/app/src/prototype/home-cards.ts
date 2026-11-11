/**
 * Home daily overview presentation. The domain (states, freshness, agenda selection and copy) is
 * the shared upstream module `packages/ui/src/overview/daily-overview.ts`; this file only binds
 * Alpha's locale and hour-cycle preferences (`locale-time.ts`) and keeps the names Alpha's adapters
 * use. Nothing here reads a provider or runs a digest.
 */
import {
  overviewAgendaEmptyTitle,
  overviewAgendaHeader,
  overviewAttendeeInitials,
  overviewBriefOutcome,
  overviewCalendarName,
  overviewCalendarState,
  overviewOverdueDueLabel,
  overviewReadIsStale,
  overviewWhenLabel,
  presentOverviewAgendaCard,
  presentOverviewAgendaFeed,
  presentOverviewAgendaNext,
  presentOverviewAgendaSource,
  presentOverviewAttention,
  presentOverviewBrief,
  presentOverviewBriefCard,
  presentOverviewCalendar,
  presentOverviewInboxCard,
  presentOverviewInboxStatus,
  presentOverviewWorkflowFreshness,
  selectOverviewAgenda,
  type OverviewAgendaCardInput,
  type OverviewAgendaCardModel,
  type OverviewAgendaPresentation,
  type OverviewAttentionSummary,
  type OverviewBriefSummary,
  type OverviewCalendarState,
  type OverviewFormat,
  type OverviewInboxCardInput,
  type OverviewInboxCardModel,
} from '../../../../.eliza/client-features/packages/ui/src/overview/daily-overview.ts';
import {formatTime, formatShortDate} from './locale-time.ts';

/** Alpha's locale preferences, read at each call so a changed preference applies at once. */
const format: OverviewFormat = {time: date => formatTime(date), shortDate: date => formatShortDate(date)};

/** What needs attention, from the mail provider adapter (inboxAttention()). */
export type HomeAttentionSummary = OverviewAttentionSummary;
/** Latest retained scheduled brief (latestRetainedDigest()). */
export type HomeBriefSummary = OverviewBriefSummary;
export type CalendarCardState = OverviewCalendarState;
export type HomeAgenda = OverviewAgendaPresentation;
export {overviewReadIsStale as homeReadIsStale, selectOverviewAgenda as selectHomeAgenda};

/** "3:04 PM" today, otherwise "Wed, Oct 8 3:04 PM". */
export const whenLabel = (at: number, now: number) => overviewWhenLabel(at, now, format);
export const presentHomeAttention = (summary: HomeAttentionSummary | null | undefined, now: number) => presentOverviewAttention(summary, now, format);
/** How a retained digest result ended: a missed, overlapping or unavailable record is not a run. */
export const briefOutcome = overviewBriefOutcome;
export const presentHomeBrief = (brief: HomeBriefSummary | null | undefined, now: number) => presentOverviewBrief(brief, now, format);
/** The newest retained result for the current connection; shown only when one exists. */
export const presentHomeBriefCard = (brief: HomeBriefSummary | null | undefined, now: number) => presentOverviewBriefCard(brief, now, format);
export const presentHomeCalendarSource = (input: Parameters<typeof presentOverviewAgendaSource>[0]) => presentOverviewAgendaSource(input, format);
export const presentHomeNext = (input: Parameters<typeof presentOverviewAgendaNext>[0]) => presentOverviewAgendaNext(input, format);
/** The agenda card when its source is the agent's calendar feed (states, freshness and staleness). */
export const presentHomeAgendaFeed = (input: Parameters<typeof presentOverviewAgendaFeed>[0]) => presentOverviewAgendaFeed(input, format);
export const homeCalendarName = overviewCalendarName;
export const homeAgendaHeader = overviewAgendaHeader;
/** "Due 9:00 AM" today, otherwise "Due Mon, Oct 5 9:00 AM". */
export const overdueDueLabel = (at: number, now: number) => overviewOverdueDueLabel(at, now, format);
export const presentHomeWorkflowFreshness = (input: Parameters<typeof presentOverviewWorkflowFreshness>[0]) => presentOverviewWorkflowFreshness(input, format);
export const presentHomeInboxStatus = (input: Parameters<typeof presentOverviewInboxStatus>[0]) => presentOverviewInboxStatus(input, format);
/** The whole Home mail card from the page the user loaded in Inbox (metadata only). */
export const presentHomeInboxCard = (input: OverviewInboxCardInput): OverviewInboxCardModel => presentOverviewInboxCard(input, format);
export type HomeAgendaCardInput = OverviewAgendaCardInput;
/** The whole Home agenda card from the selected item and where it was read. */
export const presentHomeAgendaCard = (input: HomeAgendaCardInput): OverviewAgendaCardModel => presentOverviewAgendaCard(input, format);
/**
 * Next line of an agenda card led by an overdue reminder while the agenda source is the agent's
 * calendar: whichever comes first of Home's own next item, when it is an upcoming reminder saved on
 * this phone, and the agent's next event. An overdue reminder never hides the next item.
 */
export function overdueAgendaNext(input: HomeAgendaCardInput, ownIsReminder: boolean, agent: HomeAgendaCardInput['next']): HomeAgendaCardInput {
  const own = ownIsReminder ? input.next ?? null : null;
  if (agent && !(own && own.item.begin <= agent.item.begin)) return {...input, next: agent};
  return {...input, next: own};
}
/**
 * A reminder saved on this phone that leads Home's agenda while the agenda source is the agent's
 * calendar. When that calendar could not be read, or its last read is out of date, the card says so
 * above the reminder (agent events may be missing before it), as a failed or stale device-calendar
 * read does; otherwise the reminder keeps the reminder store's own source.
 */
export function agentReminderLead(local: HomeAgendaCardInput, feed: {state: string; read: string; description: string}): HomeAgendaCardInput {
  if (feed.state !== 'error' && feed.state !== 'stale') return local;
  return {...local, provenance: {origin: '', read: feed.read, description: feed.description}, stale: feed.state === 'stale'};
}
/** The Home template values of an agenda card (read by home-overview-cards.ts and the Home adapters). */
export function homeCalendarValues(card: OverviewAgendaCardModel) {
  return {
    homeCalendarHasEvent: card.hasItem, homeCalendarFooter: card.footer, homeCalendarLabel: card.label, homeCalendarTime: card.heading,
    homeCalendarTitle: card.title, homeCalendarHasMeta: card.hasMeta, homeCalendarSource: card.source, homeCalendarOrigin: card.origin,
    homeCalendarOverdue: card.overdue, homeCalendarStale: card.stale, homeCalendarDescription: card.description, homeCalendarItemDescription: card.itemDescription,
    homeCalendarNext: card.next?.text || '', homeCalendarNextSource: card.next?.source || '', homeCalendarHasNext: !!card.next,
    homeCalendarVideo: card.video, homeCalendarPeople: card.people.map(ini => ({ini})), homePeopleVisibility: card.people.length ? 'visible' : 'hidden',
  };
}
/** One candidate for the Home agenda card, as the shared selection takes it, with the host record also as `event`. */
export interface HomeAgendaItem { item: Record<string, any>; event: Record<string, any>; begin: number; end: number; allDay: boolean; overdue?: boolean }
/** Every candidate for the Home agenda card, whatever the time. Completed reminders are left out,
 * and so are app-calendar events while `calendarShown` is false (the calendar is not read, or is
 * hidden in Calendar's display settings). All-day events are placed at local midnight of their UTC
 * date. Overdue reminders (the reminder adapter's overdueReminders()) stay until handled. */
export function homeAgendaCandidates(events: readonly Record<string, any>[], overdue: readonly Record<string, any>[], calendarShown: boolean): HomeAgendaItem[] {
  return events
    .filter(event => event.reminderStatus !== 'completed')
    .filter(event => !event.alphaCalendarId || calendarShown)
    .map((event): HomeAgendaItem => {
      const allDay = !!event.nativeEvent?.allDay;
      const instant = (value: number) => { const date = new Date(value); return allDay ? new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()).getTime() : Number(value); };
      return {item: event, event, begin: instant(event.nativeEvent?.begin ?? event.reminderAt), end: instant(event.nativeEvent?.end ?? event.reminderAt), allDay};
    })
    .concat(overdue.map((row): HomeAgendaItem => { const event = {id: row.id, title: row.title, off: row.off, overdue: true}; return {item: event, event, begin: Number(row.at), end: Infinity, allDay: false, overdue: true}; }));
}
/** The Home agenda card's item and, under an overdue reminder, the next item that is not overdue,
 * chosen by selectHomeAgenda. The shell renders many times a second (clock, voice and call ticks):
 * the candidates are rebuilt only when the event list (by identity), the overdue reminders or
 * `calendarShown` change, and the choice is made again only then or when the clock reaches the
 * next candidate end (or goes back), the only times it can differ. */
export function createHomeAgenda() {
  let events: unknown, shown = false, overdueKey = '', candidates: HomeAgendaItem[] = [], at = NaN, until = -Infinity;
  let chosen: {agenda: HomeAgendaItem | undefined; following: HomeAgendaItem | undefined} = {agenda: undefined, following: undefined};
  return (input: {events: readonly Record<string, any>[]; overdue: readonly Record<string, any>[]; calendarShown: boolean; now: number}) => {
    const key = input.overdue.map(row => `${row.id}\u0000${row.at}\u0000${row.off}\u0000${row.title}`).join('\u0001');
    const changed = input.events !== events || input.calendarShown !== shown || key !== overdueKey;
    if (changed) {
      candidates = homeAgendaCandidates(input.events, input.overdue, input.calendarShown);
      events = input.events; shown = input.calendarShown; overdueKey = key;
    }
    if (changed || !(input.now >= at && input.now < until)) {
      const selection = selectOverviewAgenda(candidates, input.now);
      // The selection returns the candidates it was given, so each result is one of this function's own items.
      chosen = {agenda: (selection.agenda ?? undefined) as HomeAgendaItem | undefined, following: (selection.following ?? undefined) as HomeAgendaItem | undefined};
      at = input.now;
      until = candidates.reduce((next, candidate) => candidate.end >= input.now && candidate.end < next ? candidate.end : next, Infinity);
    }
    return chosen;
  };
}
/** Whether saving works in this browser. `probe` throws when it does not. The shell asks on every
 * render, and the answer changes only when the owner changes the browser's storage settings, so the
 * probe (a synchronous storage read) runs at most once per `ttl` milliseconds. */
export function createStorageAccessCheck(probe: () => void, ttl = 5000, clock: () => number = Date.now) {
  let at = -Infinity, available = true;
  return () => {
    const now = clock();
    if (now - at >= ttl || now < at) { at = now; try { probe(); available = true; } catch { available = false; } }
    return available;
  };
}
export const calendarCardState = overviewCalendarState;
export const homeCalendarEmptyTitle = overviewAgendaEmptyTitle;
export const presentHomeCalendar = (input: Parameters<typeof presentOverviewCalendar>[0]) => presentOverviewCalendar(input, format);
export const attendeeInitials = overviewAttendeeInitials;
