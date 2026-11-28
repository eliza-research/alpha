// spec/app/calendar/index.md, "The calendar holds its layout, today and the day it is anchored to, what each source last read and whether that read was cut short, the owner it reads for and the calendars hidden, the reminders it was told of, an open event and the phone's inspection of it, one overlay, the editor's form and the delete review over it, and whether it is in front, covered or a write is under way"; spec/app/calendar/writing.md, "A missing or repeated wall time is refused, and nothing is saved"
import { windowFirstMonth, windowLastMonth } from "../../gen/app__calendar__presentation.ts";
import type { WallTime } from "../../gen/app__calendar__writing.ts";

const dayMs = 86_400_000;
const ambiguityShifts = [-3_600_000, -1_800_000, 1_800_000, 3_600_000] as const;

/** A local wall-clock instant and whether that wall time exists once, is missing in a spring-forward gap, or occurs twice on fall-back. */
export interface ResolvedWallTime {
  readonly kind: WallTime;
  readonly ms: number;
}

/** UTC midnight of a civil date, for providers that store all-day events as UTC dates. @throws {never} */
export const utcStart = (civil: number) => civil * dayMs;

/** The phone's civil day of `ms`, counted in days from 1970-01-01, in the phone's own time zone. @throws {never} */
export function civilDay(ms: number): number {
  const at = new Date(ms);
  return Math.round(Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()) / dayMs);
}

/** The local date of a civil day, as a Date at its midnight. @throws {never} */
export function dateOf(civil: number): Date {
  const utc = new Date(utcStart(civil));
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

/** The instant a civil day starts on this phone. @throws {never} */
export function dayStart(civil: number): number {
  return dateOf(civil).getTime();
}

/** The UTC midnight ISO string of a civil day, for all-day wire dates. @throws {never} */
export function utcDate(civil: number): string {
  return new Date(utcStart(civil)).toISOString();
}

/** Whether `at` displays the exact local calendar components `(year, month, date, hour, minute)`. @throws {never} */
function matchesWall(at: Date, year: number, month: number, date: number, hour: number, minute: number): boolean {
  return at.getFullYear() === year && at.getMonth() === month && at.getDate() === date && at.getHours() === hour && at.getMinutes() === minute;
}

/** Resolve local wall-clock `(civil, hour, minute)` and classify missing or repeated DST wall times. @throws {never} */
export function localWallTime(civil: number, hour: number, minute: number): ResolvedWallTime {
  const base = dateOf(civil);
  const year = base.getFullYear();
  const month = base.getMonth();
  const date = base.getDate();
  const candidate = new Date(year, month, date, hour, minute, 0, 0);
  const ms = candidate.getTime();
  if (!matchesWall(candidate, year, month, date, hour, minute)) return { kind: "WallMissing", ms };
  for (const delta of ambiguityShifts) {
    if (matchesWall(new Date(ms + delta), year, month, date, hour, minute)) return { kind: "WallTwice", ms };
  }
  return { kind: "WallExists", ms };
}

/** Construct a local wall-clock instant on `civil` at `hour:minute` without adding fixed millisecond offsets. @throws {never} */
export function wallDateTime(civil: number, hour: number, minute: number): number {
  return localWallTime(civil, hour, minute).ms;
}

/** Move `ms` by `days` civil days while preserving its local wall-clock hour and minute across DST transitions. @throws {never} */
export function shiftDays(ms: number, days: number): ResolvedWallTime {
  const at = new Date(ms);
  return localWallTime(civilDay(ms) + days, at.getHours(), at.getMinutes());
}

/** The civil day of the first of the month `months` after the month of `civil`. @throws {never} */
export function monthStart(civil: number, months: number): number {
  const date = dateOf(civil);
  return civilDay(new Date(date.getFullYear(), date.getMonth() + months, 1).getTime());
}

// spec/app/calendar/presentation.md, "A read for a day covers the month before it through the month after next"
/** The instants a read for civil `day` covers: from the first of the month before to the end of the month after next. @throws {never} */
export function readWindow(day: number): { begin: number; end: number } {
  return { begin: dayStart(monthStart(day, windowFirstMonth(0))), end: dayStart(monthStart(day, windowLastMonth(0) + 1)) };
}

/** Whether a read for civil `day` holds an event that starts at `begin`: only then can such a read show the event gone. @throws {never} */
export function readHolds(begin: number, day: number): boolean {
  const window = readWindow(day);
  return begin >= window.begin && begin < window.end;
}

/** A read of the agent's calendar over the window around civil `day`, in the phone's own time zone. @throws {never} */
export function feedParams(day: number): { timeMin: string; timeMax: string; timeZone: string } {
  const range = readWindow(day);
  return { timeMin: new Date(range.begin).toISOString(), timeMax: new Date(range.end).toISOString(), timeZone: zone() };
}

/** The Monday that starts the week of a civil day. @throws {never} */
export function weekStart(civil: number): number {
  return civil - ((dateOf(civil).getDay() + 6) % 7);
}

/** An all-day date from a provider, `YYYY-MM-DD…` in UTC, as the same date's midnight on this phone. @throws {never} */
export function localDate(iso: string): number {
  const [year, month, date] = iso.slice(0, 10).split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1).getTime();
}

/** The phone's own time zone, which a read of the agent's Calendar names. @throws {never} */
export function zone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Whether `url` is a plain HTTPS address without credentials. @throws {never} */
export function plainHttps(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.username === "" && parsed.password === "";
  } catch {
    return false;
  }
}

/** Open `url` outside Alpha, where it is a plain HTTPS address without credentials; whether it was handed on. @throws {never} */
export function openLink(url: string): boolean {
  return plainHttps(url) && globalThis.open?.(new URL(url).href, "_blank", "noopener") !== undefined;
}

/** The local minutes since midnight of `ms`. @throws {never} */
export function minutesOf(ms: number): number {
  const at = new Date(ms);
  return at.getHours() * 60 + at.getMinutes();
}

// spec/app/calendar/writing.md, "An existing event whose timing cannot be shown as a wall-clock span keeps its original time"
/** The minutes between two instants as the phone's clock shows them, which a clock change can make zero or less. @throws {never} */
export function wallSpan(begin: number, end: number): number {
  const wall = (ms: number) => { const at = new Date(ms); return Date.UTC(at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes()); };
  return Math.round((wall(end) - wall(begin)) / 60_000);
}
