/**
 * Calendar days side by side on a wide canvas (#411, responsive-surface matrix: "More visible
 * time/day columns if readable; keep agenda fallback at large text"). The number of days comes from
 * the measured canvas width and text size (runtime/canvas-geometry.ts). Each column is the same
 * per-day layout the single-day timeline uses, so event identity, the opened occurrence and its
 * time zone never change with the window; only the lanes are drawn as fractions of the column.
 * From three columns the day before the selected one leads, for context. At large text the
 * selected day is listed as an agenda instead (`calendarAgendaRows`).
 */
import { currentSurfaceLayout } from '../runtime/canvas-geometry';
type Bag = Record<string, any>;

/** The per-day layout lays lanes out across a 336px reference column starting at 60px. */
const REFERENCE_LEFT = 60, REFERENCE_WIDTH = 336;

export const calendarDayCount = (): number => currentSurfaceLayout().calendarDays;
/** Large text lists the selected day as an agenda instead of a timeline. */
export const calendarAgenda = (): boolean => currentSurfaceLayout().agenda;
/** The first visible column: the previous day leads once there are three or more columns. */
export function firstCalendarDayOf(day: number, count: number): number {
  //@ verify
  //@ ensures count >= 3 ==> \result === day - 1
  //@ ensures count < 3 ==> \result === day
  //@ ensures day - 1 <= \result && \result <= day
  return count >= 3 ? day - 1 : day;
}
export const firstCalendarDay = (day: number, count = calendarDayCount()): number => firstCalendarDayOf(day, count);
/** The visible columns: `count` consecutive days from the first one; the selected day is one of them. */
export function visibleCalendarDaysOf(day: number, count: number): number[] {
  //@ verify
  //@ requires count >= 1
  //@ ensures \result.length === count
  //@ ensures forall(k, 0 <= k && k < \result.length ==> \result[k] === firstCalendarDayOf(day, count) + k)
  //@ ensures forall(k, 0 <= k && k + 1 < \result.length ==> \result[k] < \result[k + 1])
  //@ ensures \result[day - firstCalendarDayOf(day, count)] === day
  const first = firstCalendarDayOf(day, count);
  const days: number[] = [];
  let index = 0;
  while (index < count) {
    //@ invariant 0 <= index && index <= count
    //@ invariant days.length === index
    //@ invariant forall(k, 0 <= k && k < index ==> days[k] === first + k)
    //@ decreases count - index
    days.push(first + index);
    index = index + 1;
  }
  return days;
}
export const visibleCalendarDays = (day: number, count = calendarDayCount()): number[] => visibleCalendarDaysOf(day, count);
/**
 * The selected day after an event closes. Closing returns to the event's day, but while that day is
 * already one of the visible columns the selection stays, so an event opened from another column
 * does not move the days on screen.
 */
export function calendarReturnDayOf(day: number, eventDay: number, count: number): number {
  //@ verify
  //@ requires count >= 1
  //@ ensures \result === day || \result === eventDay
  //@ ensures \result === day <==> (eventDay === day || (firstCalendarDayOf(day, count) <= eventDay && eventDay < firstCalendarDayOf(day, count) + count))
  //@ ensures firstCalendarDayOf(\result, count) <= eventDay && eventDay < firstCalendarDayOf(\result, count) + count
  //@ ensures calendarReturnDayOf(\result, eventDay, count) === \result
  const first = firstCalendarDayOf(day, count);
  return eventDay >= first && eventDay < first + count ? day : eventDay;
}
export const calendarReturnDay = (day: number, eventDay: number, count = calendarDayCount()): number => calendarReturnDayOf(day, eventDay, count);

/** Milliseconds until the next local midnight, when the day offsets of loaded rows stop being true. */
export function msToLocalMidnight(now: Date | number = Date.now()): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime() - date.getTime();
}

export function calendarDayLabel(now: Date | number, off: number): string {
  const date = new Date(now); date.setDate(date.getDate() + off);
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}

/** Template rows for each visible day; `showNow` marks today's column when now is on the timeline. */
export function calendarDayColumns(columns: Array<{ off: number; events: Bag[] }>, now: Date | number, nowTop: number, nowVisible: boolean, selected?: number) {
  return columns.map(({ off, events }) => ({
    label: calendarDayLabel(now, off), isToday: off === 0, showNow: off === 0 && nowVisible, nowTop,
    current: off === selected ? 'date' : 'false', headCss: off === selected ? 'color:var(--fg)' : '',
    events: events.map(event => ({ ...event, x: ((event.left - REFERENCE_LEFT) / REFERENCE_WIDTH * 100).toFixed(3), wp: ((event.w + 4) / REFERENCE_WIDTH * 100).toFixed(3) })),
  }));
}

/** Whether the week strip marks day `off`: a visible column that is neither the selected day nor today. */
export function weekDayMarked(off: number, day: number, first: number, count: number): boolean {
  //@ verify
  //@ ensures \result ==> off !== day && off !== 0
  //@ ensures \result ==> first <= off && off < first + count
  //@ ensures \result <==> (off !== day && off !== 0 && first <= off && off < first + count)
  //@ ensures count < 2 && first === firstCalendarDayOf(day, count) ==> !\result
  return off !== day && off >= first && off < first + count && off !== 0;
}
/** The week strip shows which of its days are on screen as columns. */
export function markVisibleWeek(week: Bag[], weekStart: number, day: number, count: number): Bag[] {
  if (count < 2) return week;
  const first = firstCalendarDay(day, count);
  return week.map((item, index) => weekDayMarked(weekStart + index, day, first, count) ? { ...item, cs: `${item.cs || ''};background:var(--s2)` } : item);
}

/**
 * The selected day as a list (large text): all-day items first, then timed items in start order.
 * Rows keep each item's own `open`, so the opened event and occurrence are the timeline's.
 */
export function calendarAgendaRows(allDay: Bag[], timed: Bag[], allDayLabel = 'All day'): Bag[] {
  return [
    ...allDay.map(item => ({ title: item.title, time: allDayLabel, open: item.open })),
    ...timed.slice().sort((a, b) => a.top - b.top).map(item => ({ title: item.title, time: item.agendaTime || item.time, open: item.open })),
  ];
}
