/**
 * Month, Schedule and Search for Calendar (docs/flow-redesign-2026-11, specs/quint/legacy/Calendar.qnt). Pure:
 * each builder takes the day offsets it covers and an `eventsOn(off)` lookup, so the renderer
 * (local events) and the provider adapter (Android and Google rows, clipped per day) share them.
 * Offsets count civil days from today, like every other Calendar offset.
 */
type Bag = Record<string, any>;

/** One event as a view shows it. `t` is the start hour on that day; all-day items sort first. */
export interface CalendarItem extends Bag { title: string; color: string; pending?: boolean; allDay?: boolean; t?: number }

const VIEW_DAY = 86400000;
const viewCivil = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
const viewDayAt = (now: Date | number, off: number) => { const date = new Date(now); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() + off); return date; };
/** All-day first, then by start hour; equal items keep their order. */
export const calendarItemOrder = (a: CalendarItem, b: CalendarItem) => (a.allDay ? 0 : 1) - (b.allDay ? 0 : 1) || (a.allDay ? 0 : Number(a.t || 0) - Number(b.t || 0));
const viewSorted = (items: CalendarItem[]) => items.map((item, index) => ({ item, index })).sort((a, b) => calendarItemOrder(a.item, b.item) || a.index - b.index).map(row => row.item);

/**
 * The Month grid for the month containing `base`: whole weeks from Monday, 35 cells (or 42 when
 * the month needs six rows). Each cell lists up to `max` chips and a "+N" for the rest.
 */
export function calendarMonthCells(base: Date | number, now: Date | number, eventsOn: (off: number) => CalendarItem[], options: { selected?: number; max?: number } = {}) {
  const max = options.max ?? 3, first = new Date(base); first.setHours(12, 0, 0, 0); first.setDate(1);
  const lead = (first.getDay() + 6) % 7, length = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const count = lead + length > 35 ? 42 : 35, today = viewCivil(new Date(now));
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(first); date.setDate(1 - lead + index);
    const off = Math.round((viewCivil(date) - today) / VIEW_DAY), items = viewSorted(eventsOn(off));
    const label = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    return {
      off, n: date.getDate(), inMonth: date.getMonth() === first.getMonth(), isToday: off === 0, selected: off === options.selected,
      chips: items.slice(0, max).map(item => ({ title: item.title, color: item.color, pending: !!item.pending })),
      more: items.length > max ? `+${items.length - max}` : '',
      label: items.length ? `${label}, ${items.length} ${items.length === 1 ? 'event' : 'events'}` : label,
    };
  });
}

/** Schedule: the days from `fromOff` through `toOff` that have something on them, in order. */
export function calendarScheduleRows(fromOff: number, toOff: number, eventsOn: (off: number) => CalendarItem[], now: Date | number) {
  const rows: Bag[] = [];let month = -1;
  for (let off = fromOff; off <= toOff; off++) {
    const items = viewSorted(eventsOn(off));if (!items.length) continue;
    const date = viewDayAt(now, off), key = date.getFullYear() * 12 + date.getMonth();
    rows.push({ off, isToday: off === 0, weekday: date.toLocaleDateString(undefined, { weekday: 'short' }), n: date.getDate(),
      monthHead: key !== month ? date.toLocaleDateString(undefined, { month: 'long', ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) }) : '',
      label: date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }), items });
    month = key;
  }
  return rows;
}

/**
 * Search: a case-insensitive match on title, place and notes, at most `limit`. Today and later come
 * first (soonest first), then earlier days (most recent first), so a long repeating series cannot
 * fill the list with old occurrences.
 */
export function calendarSearchRows<T extends { title?: string; where?: string; notes?: string; start: number }>(query: string, events: T[], limit = 100, now: Date | number = Date.now()): T[] {
  const needle = String(query || '').trim().toLocaleLowerCase();
  if (!needle) return [];
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const from = midnight.getTime(), found = events.filter(event => [event.title, event.where, event.notes].some(text => String(text || '').toLocaleLowerCase().includes(needle)));
  const upcoming = found.filter(event => event.start >= from).sort((a, b) => a.start - b.start), past = found.filter(event => !(event.start >= from)).sort((a, b) => b.start - a.start);
  return [...upcoming, ...past].slice(0, limit);
}
