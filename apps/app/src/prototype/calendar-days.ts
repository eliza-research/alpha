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
export const firstCalendarDay = (day: number, count = calendarDayCount()): number => count >= 3 ? day - 1 : day;
export const visibleCalendarDays = (day: number, count = calendarDayCount()): number[] => Array.from({ length: count }, (_, index) => firstCalendarDay(day, count) + index);
/**
 * The selected day after an event closes. Closing returns to the event's day, but while that day is
 * already one of the visible columns the selection stays, so an event opened from another column
 * does not move the days on screen.
 */
export const calendarReturnDay = (day: number, eventDay: number, count = calendarDayCount()): number => { const first = firstCalendarDay(day, count); return eventDay >= first && eventDay < first + count ? day : eventDay; };

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

/** The week strip shows which of its days are on screen as columns. */
export function markVisibleWeek(week: Bag[], weekStart: number, day: number, count: number): Bag[] {
  if (count < 2) return week;
  const first = firstCalendarDay(day, count);
  return week.map((item, index) => { const off = weekStart + index; return off !== day && off >= first && off < first + count && off !== 0 ? { ...item, cs: `${item.cs || ''};background:var(--s2)` } : item; });
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
