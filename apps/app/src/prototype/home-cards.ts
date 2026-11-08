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
/** The agent calendar controller's state that Home's agenda card reads (AgentCalendarState). */
export interface AgentAgendaFeedState {
  status: string;
  next?: {calendarFeedState?: string | null; timeReference?: {asOf?: string | null} | null} | null;
  /** The next event was read with every source complete in this binding and has not ended since. */
  nextFresh?: boolean;
  error?: string | null;
}
/**
 * The shared agenda-feed presentation of the agent calendar. A ready or partial read whose next
 * event is not verified (the next read failed, a source was incomplete, or the event ended before
 * it was read again) is shown as stale with the event, or as unverified without one: never as a
 * fresh event or an empty schedule.
 */
export function presentAgentAgendaFeed(state: AgentAgendaFeedState | null | undefined, hasItem: boolean, now: number, emptyLabel: string) {
  const status = state?.status ?? 'disconnected';
  const unverified = (status === 'ready' || status === 'partial') && state?.nextFresh !== true;
  const feedState = state?.next?.calendarFeedState;
  const feed = presentHomeAgendaFeed({status: (unverified ? 'partial' : status) as Parameters<typeof presentHomeAgendaFeed>[0]['status'], hasItem,
    feedState: feedState === 'complete' || feedState === 'partial' || feedState === 'unavailable' ? feedState : null,
    asOf: Date.parse(state?.next?.timeReference?.asOf ?? '') || null, error: state?.error ?? null, now, source: 'Agent Calendar', emptyLabel});
  if (!unverified) return feed;
  const reason = (state?.error ?? '').trim().replace(/[.\s]+$/, '') || 'Agent Calendar has not been verified';
  return {...feed, description: `${reason}. Open Calendar to retry.`};
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
export const calendarCardState = overviewCalendarState;
export const homeCalendarEmptyTitle = overviewAgendaEmptyTitle;
export const presentHomeCalendar = (input: Parameters<typeof presentOverviewCalendar>[0]) => presentOverviewCalendar(input, format);
export const attendeeInitials = overviewAttendeeInitials;
