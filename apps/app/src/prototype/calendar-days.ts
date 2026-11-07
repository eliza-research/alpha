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

/** The views offered from the Calendar title menu (docs/flow-redesign-2026-11). */
export type CalendarView = 'schedule' | 'day' | 'week' | 'month';
export const CALENDAR_VIEWS: CalendarView[] = ['schedule', 'day', 'week', 'month'];
export const calendarView = (value: unknown): CalendarView => CALENDAR_VIEWS.includes(value as CalendarView) ? value as CalendarView : 'day';

/**
 * Day offsets drawn as columns. Week is Monday to Sunday of the selected day's week; every other
 * view keeps the measured column count around the selected day.
 */
export function calendarViewDays(view: string, day: number, now: Date | number, count = calendarDayCount()): number[] {
  if (view !== 'week') return visibleCalendarDays(day, count);
  const date = new Date(now); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() + day);
  const monday = day - (date.getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, index) => monday + index);
}

/**
 * The provider read window for the current Calendar state. By default it is the month before the
 * shown month through the month after it (Month view moves it with `month`; Schedule anchors it on
 * today). Search widens it to
 * 90 days back and a year ahead so results are not limited to the visible weeks.
 */
export function calendarLoadRange(state: Bag, now: Date | number = Date.now()): { begin: number; end: number; key: string } {
  const today = new Date(now);
  if (state.search != null) {
    const begin = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 90).getTime(), end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 366).getTime();
    return { begin: Math.max(0, begin), end, key: `${begin}:${end}` };
  }
  // Schedule always runs from today, whatever day was last selected.
  const anchor = calendarView(state.view) === 'schedule' ? 0 : Number(state.day || 0);
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + anchor); date.setDate(1);
  if (state.month != null) date.setMonth(date.getMonth() + Number(state.month || 0));
  const begin = new Date(date.getFullYear(), date.getMonth() - 1, 1).getTime(), end = new Date(date.getFullYear(), date.getMonth() + 2, 1).getTime();
  return { begin: Math.max(0, begin), end, key: `${begin}:${end}` };
}

export function calendarDayLabel(now: Date | number, off: number): string {
  const date = new Date(now); date.setDate(date.getDate() + off);
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}

/**
 * Template rows for each visible day; `showNow` marks today's column when now is on the timeline.
 * `compact` (Week view: seven narrow columns) drops the time and place lines from each block;
 * `pick` makes each column head open that day.
 */
export function calendarDayColumns(columns: Array<{ off: number; events: Bag[] }>, now: Date | number, nowTop: number, nowVisible: boolean, selected?: number, options: { compact?: boolean; pick?: (off: number) => void } = {}) {
  return columns.map(({ off, events }) => {
    const date = new Date(now); date.setDate(date.getDate() + off);
    return {
      off, label: calendarDayLabel(now, off), isToday: off === 0, showNow: off === 0 && nowVisible, nowTop,
      weekday: date.toLocaleDateString(undefined, { weekday: 'narrow' }), n: date.getDate(),
      dayLabel: date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
      current: off === selected ? 'date' : 'false', headCss: off === 0 ? 'color:var(--acct);font-weight:700' : off === selected ? 'color:var(--fg)' : '',
      pick: () => options.pick?.(off),
      events: events.map(event => ({ ...event, ...(options.compact ? { showTime: false, sub: '' } : {}), x: ((event.left - REFERENCE_LEFT) / REFERENCE_WIDTH * 100).toFixed(3), wp: ((event.w + 4) / REFERENCE_WIDTH * 100).toFixed(3) })),
    };
  });
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
