/* Device-locale date and time presentation for the prototype views.
 * Every visible weekday, month and time goes through Intl.DateTimeFormat with the device
 * locale and, when the platform reports it, the device's 12/24-hour choice (Android's
 * "Use 24-hour format" is not visible to a WebView's Intl, so the host passes it in). */

export type HourCycle = 'h12' | 'h23';
let prefs: {locale: string | undefined; hourCycle: HourCycle | undefined} = {locale: undefined, hourCycle: undefined};
const cache = new Map<string, Intl.DateTimeFormat>();

/** Live, locale-ordered name tables (Sunday-first / January-first); refilled in place when the
 * preferences change so long-lived references stay current. */
export const WEEKDAYS: string[] = [];
export const MONTHS: string[] = [];

/** locale: BCP 47 tag, or undefined for the runtime default. */
export function setLocalePreferences(next: {locale?: unknown; hourCycle?: unknown} = {}) {
  let locale = typeof next.locale === 'string' && next.locale ? next.locale : undefined;
  if (locale) { try { locale = Intl.getCanonicalLocales(locale)[0]; } catch { locale = undefined; } }
  const hourCycle = next.hourCycle === 'h12' || next.hourCycle === 'h23' ? next.hourCycle : undefined;
  prefs = {locale, hourCycle};
  cache.clear();
  refreshNames();
}
export function localePreferences(): {locale: string; hourCycle: HourCycle} {
  const resolved = new Intl.DateTimeFormat(prefs.locale, {hour: 'numeric'}).resolvedOptions();
  return {locale: resolved.locale, hourCycle: prefs.hourCycle || (resolved.hourCycle === 'h11' || resolved.hourCycle === 'h12' ? 'h12' : 'h23')};
}
function format(options: Intl.DateTimeFormatOptions) {
  const key = JSON.stringify(options);
  let value = cache.get(key);
  if (!value) {
    const full: Intl.DateTimeFormatOptions = {...options};
    if (prefs.hourCycle && full.hour) full.hourCycle = prefs.hourCycle;
    value = new Intl.DateTimeFormat(prefs.locale, full);
    cache.set(key, value);
  }
  return value;
}
// ICU uses narrow/no-break spaces around day periods; keep plain spaces for wrapping and matching.
const clean = (text: string) => text.replace(/[  ]/g, ' ');
function at(hours: number) {
  const t = Number(hours) || 0; let h = Math.floor(t); let m = Math.round((t - h) * 60);
  if (m === 60) { h++; m = 0; }
  return new Date(2000, 0, 1, h, m);
}
/** "3:04 PM" / "15:04". */
export function formatTime(date: Date) { return clean(format({hour: 'numeric', minute: '2-digit'}).format(date)); }
/** Clock face without a day period: "3:04" / "15:04". */
export function formatClock(date: Date) {
  return clean(format({hour: 'numeric', minute: '2-digit'}).formatToParts(date)
    .filter(part => part.type !== 'dayPeriod').map(part => part.value).join('')).trim();
}
/** Decimal hours (14.5) as a time of day; `compact` omits minutes on the hour. */
export function formatHours(hours: number, options: {dayPeriod?: boolean; compact?: boolean} = {}) {
  const date = at(hours);
  if (options.compact && date.getMinutes() === 0) return formatHour(date.getHours());
  return options.dayPeriod === false ? formatClock(date) : formatTime(date);
}
/** Decimal-hour range: "3:00 – 4:00 PM", "11:00 AM – 1:00 PM", "15:00 – 16:00". The start's day
 * period is dropped only when it trails and both ends share it; 24-hour formats have none. */
export function formatHoursRange(start: number, end: number) {
  const a = formatHours(start), b = formatHours(end);
  const bareA = formatHours(start, {dayPeriod: false}), bareB = formatHours(end, {dayPeriod: false});
  const periodA = a.replace(bareA, '').trim(), periodB = b.replace(bareB, '').trim();
  return `${periodA && periodA === periodB && a.startsWith(bareA) ? bareA : a} – ${b}`;
}
/** Hour label: "9 AM" / "09". */
export function formatHour(hour: number) { return clean(format({hour: 'numeric'}).format(new Date(2000, 0, 1, hour))); }
export function weekdayName(date: Date, width: 'long' | 'short' | 'narrow' = 'long') { return format({weekday: width}).format(date); }
export function monthName(date: Date, width: 'long' | 'short' | 'narrow' = 'long') { return format({month: width}).format(date); }
/** "Wed, Oct 8". */
export function formatShortDate(date: Date) { return clean(format({weekday: 'short', month: 'short', day: 'numeric'}).format(date)); }
/** "Wednesday, Oct 8". */
export function formatLongDate(date: Date) { return clean(format({weekday: 'long', month: 'short', day: 'numeric'}).format(date)); }
/** Full date for Home. */
export function formatFullDate(date: Date) { return clean(format({weekday: 'long', month: 'long', day: 'numeric'}).format(date)); }
/** "Oct 8" or "Oct 8, 2025". */
export function formatMonthDay(date: Date, withYear = false) { return clean(format(withYear ? {month: 'short', day: 'numeric', year: 'numeric'} : {month: 'short', day: 'numeric'}).format(date)); }
/** A dated time without weekday or seconds: "Oct 7, 2026, 3:04 PM" / "7 Oct 2026, 15:04". */
export function formatDateTime(date: Date) { return clean(format({year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}).format(date)); }
/** Full message date, seconds and time zone, using the device hour cycle. */
export function formatFullDateTime(date: Date) {
  return clean(format({weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short'}).format(date));
}
/** "October" or "October 2027". */
export function formatMonthTitle(date: Date, withYear = false) { return clean(format(withYear ? {month: 'long', year: 'numeric'} : {month: 'long'}).format(date)); }
/** Weekday names Sunday-first, as Date#getDay indexes them (2000-01-02 was a Sunday). */
export function weekdayNames(width: 'long' | 'short' = 'long') { return Array.from({length: 7}, (_, i) => weekdayName(new Date(2000, 0, 2 + i), width)); }
export function monthNames(width: 'long' | 'short' = 'long') { return Array.from({length: 12}, (_, i) => monthName(new Date(2000, i, 1), width)); }
function refreshNames() {
  WEEKDAYS.splice(0, WEEKDAYS.length, ...weekdayNames());
  MONTHS.splice(0, MONTHS.length, ...monthNames());
}
refreshNames();
