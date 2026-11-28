// spec/app/calendar/index.md, "Rows shown are for the day the calendar is anchored to, from a source it may read"; spec/app/calendar/presentation.md, "A read for a day covers the month before it through the month after next"
import type { AndroidCalendarDeletionScope, CalendarPick } from "@elizaos/os-bridges";
import type { Source } from "../../gen/app__calendar.ts";
import type { Reach } from "../../gen/app__calendar__deletions.ts";
import type { Scope } from "../../gen/app__calendar__editor.ts";
import { rowShown } from "../../gen/app__calendar__presentation.ts";
import type { Cancellation, OwnAnswer } from "../../gen/app__calendar__writing.ts";
import { createShelf } from "../runtime/store.ts";
import { civilDay, utcStart } from "./time.ts";

/** One of an event's people: the organizer, or a guest with the reply the calendar gave. */
export interface Person {
  readonly name: string;
  readonly email?: string;
  readonly organizer: boolean;
  readonly status: string;
}

/** One event as the screen shows it; the spec counts these and names the open one by `id`. */
export interface Row {
  readonly id: number;
  readonly source: Source;
  readonly key: string;
  readonly calendarId: string;
  readonly creationId?: string;
  /** The calendar's number as Calendar and Home hide it: 0 is the agent's, any other one of the phone's. */
  readonly calendar: number;
  readonly title: string;
  readonly place: string;
  readonly notes: string;
  readonly begin: number;
  readonly end: number;
  readonly allDay: boolean;
  readonly recurring: boolean;
  /** How it repeats, such as "Repeats every weekday", or "" for an event that does not. */
  readonly repeat: string;
  /** The event's own page, where the presentation rules offer it, or "". */
  readonly link: string;
  readonly video: string;
  readonly people: ReadonlyArray<Person>;
  /** The owner's own answer to the invitation, and whether Going and Maybe may be offered for it. */
  readonly answer: OwnAnswer;
  readonly answerable: boolean;
  /** Whether the event is on the calendar the agent manages for the owner, whose deletions and series changes are made in Google Calendar. */
  readonly managed: boolean;
  /** The series a repeating event belongs to, or "". */
  readonly series: string;
  /** Whether Alpha may change the event here: a versioned event of a calendar Alpha writes. */
  readonly editable: boolean;
  /** What deleting the event is: the organizer's cancel, the invitee's decline, or nothing where the organizer is unknown. */
  readonly cancel: Cancellation;
  /** The provider's version of the event, which a write names, or "" where the calendar keeps none. */
  readonly version: string;
  /** The revision the form builds on: the provider's change time where it has one, otherwise one more each time a read shows it different; the occurrences of a repeating event on the phone share one, which their times leave out. */
  readonly revision: number;
}

/** What a source answered, before it has a number. */
export type Read = Omit<Row, "id" | "source" | "revision" | "calendar"> & { readonly changedAt?: number };

const weekdays: Readonly<Record<string, string>> = { MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun" };
const units: Readonly<Record<string, readonly [string, string]>> = { DAILY: ["daily", "days"], WEEKLY: ["weekly", "weeks"], MONTHLY: ["monthly", "months"], YEARLY: ["yearly", "years"] };

/** One plain line for a repeating event from its RRULE lines; a rule this cannot read still says that the event repeats. @throws {never} */
export function repeatText(recurrence: ReadonlyArray<string>, recurring: boolean): string {
  const rules = recurrence.filter((rule) => rule.startsWith("RRULE:"));
  if (rules.length !== 1) return recurring || recurrence.length > 0 ? "Repeats" : "";
  const parts = new Map((rules[0] ?? "").slice(6).split(";").map((part) => part.split("=") as [string, string]));
  const unit = units[parts.get("FREQ") ?? ""];
  const interval = Number(parts.get("INTERVAL") ?? 1);
  if (!unit || !Number.isInteger(interval) || interval < 1) return "Repeats";
  const days = parts.get("BYDAY")?.split(",") ?? [];
  if (parts.get("FREQ") === "WEEKLY" && days.length > 0 && days.every((day) => day in weekdays)) {
    if (interval === 1 && days.join(",") === "MO,TU,WE,TH,FR") return "Repeats every weekday";
    return `${interval === 1 ? "Repeats weekly" : `Repeats every ${interval} weeks`} on ${days.map((day) => weekdays[day]).join(", ")}`;
  }
  return interval === 1 ? `Repeats ${unit[0]}` : `Repeats every ${interval} ${unit[1]}`;
}

/** Whether `row` falls on civil `day`: an all-day event by its dates, a timed one by its instants. @throws {never} */
export function onDay(row: Pick<Row, "begin" | "end">, day: number): boolean {
  const first = civilDay(row.begin);
  const last = civilDay(Math.max(row.begin, row.end - 1));
  return first <= day && day <= last;
}

// spec/app/calendar/index.md, "Search and the Calendars sheet open over the days, never over an open event"
/** The words of a search as Calendar matches them: case-folded, split at spaces. @throws {never} */
export function searchWords(query: string): ReadonlyArray<string> {
  return query.toLocaleLowerCase().split(/\s+/).filter((word) => word !== "");
}

/** Whether `row`'s title, place or notes hold every word of a search, case-folded. @throws {never} */
export function matchesSearch(row: Pick<Row, "title" | "place" | "notes">, words: ReadonlyArray<string>): boolean {
  const text = `${row.title} ${row.place} ${row.notes}`.toLocaleLowerCase();
  return words.every((word) => text.includes(word));
}

/** An event of the phone as eliza's calendar review picks it. @throws {never} */
export function pickOf(row: Row): CalendarPick {
  return {
    event: { id: row.key, calendarId: row.calendarId, title: row.title, body: row.notes, location: row.place, ...androidWindowOf(row), allDay: row.allDay, recurring: row.recurring },
    calendar: { id: row.calendarId, writable: true, local: true },
  };
}

/** Which occurrences a deletion of `reach` names to the editor. @throws {never} */
export function scopeOf(reach: Reach): Scope {
  return reach === "WholeSeries" ? "WholeSeries" : reach === "FromThisOn" ? "ThisAndFollowing" : "ThisOne";
}

/** Which occurrences eliza's deletion review takes; it has no "this and following". @throws {never} */
export function deletionScope(scope: Scope, recurring: boolean): AndroidCalendarDeletionScope | undefined {
  return scope === "ThisOne" ? (recurring ? "occurrence" : "event") : scope === "WholeSeries" ? "series" : undefined;
}

/** Android stores an all-day event's civil dates at UTC midnight. @throws {never} */
export function androidWindowOf({ begin, end, allDay }: Pick<Row, "begin" | "end" | "allDay">): { begin: number; end: number } {
  return allDay ? { begin: utcStart(civilDay(begin)), end: utcStart(civilDay(end)) } : { begin, end };
}

/** Scoped per-runtime cache of calendar events read from each source, backed by a reactive shelf. */
export interface ShownStore {
  /** @throws {never} */
  readonly snapshot: () => number;
  /** @throws {never} */
  readonly subscribe: (listener: () => void) => () => void;
  /** Keep what `source` answered for the window around `day`, numbered; the rows that fall on `day`. @throws {never} */
  readonly keep: (source: Source, day: number, read: ReadonlyArray<Read>, partial?: boolean) => ReadonlyArray<Row>;
  /** Refresh a single event in place without replacing the cached window or altering `partial`. @throws {never} */
  readonly mergeOne: (source: Source, read: Read) => Row;
  /** Convert a read row to a numbered `Row` without mutating the cached window. @throws {never} */
  readonly toRow: (source: Source, read: Read) => Row;
  /** The rows of `source` that fall on `day`, or none. @throws {never} */
  readonly of: (source: Source, day: number) => ReadonlyArray<Row>;
  /** Every row the last read of `source` found, in time order. @throws {never} */
  readonly all: (source: Source) => ReadonlyArray<Row>;
  /** The rows of both sources the owner has not hidden, in time order. @throws {never} */
  readonly visible: (hidden: ReadonlyArray<number>, phone: boolean, google: boolean) => ReadonlyArray<Row>;
  /** Whether the last read of `source` said it gave only part of its window. @throws {never} */
  readonly partial: (source: Source) => boolean;
  /** Forget what `source` read, including seen titles and revisions, but not the numbers its events were given or the names the agent listed: an account changed, a permission went, or the feed came back unavailable. @throws {never} */
  readonly drop: (source: Source) => void;
  /** Whether this phone has calendars of its own: a browser has none, and is never asked for access. @throws {never} */
  readonly present: () => boolean;
  /** @throws {never} */
  readonly phone: (has: boolean) => void;
  /** The revisions counted for events whose calendar keeps no version, to keep on the phone across restarts. @throws {never} */
  readonly revisions: () => ReadonlyArray<readonly [string, string, number]>;
  /** Take back the revisions kept before a restart, so a draft or a change in doubt meets the event at the revision it began from. @throws {never} */
  readonly restore: (kept: ReadonlyArray<readonly [string, string, number]>) => void;
  /** The number an event of `source` keyed `key` has, or is given now. @throws {never} */
  readonly number: (source: Source, key: string) => number;
  /** Whether `id` is a number this store gave an event, or took back from before a restart, and still holds. @throws {never} */
  readonly known: (id: number) => boolean;
  /** Whether `id` names no event: this store read the numbers kept before it, or found none, and holds no `id` among them. @throws {never} */
  readonly forgets: (id: number) => boolean;
  /** Where the event numbered `id` was last seen, kept with its number across a restart, though no read since has shown it. @throws {never} */
  readonly seenAt: (id: number) => { readonly source: Source; readonly begin: number } | undefined;
  /** The event numbered `id` as it was last read, even where the window read since no longer holds it. @throws {never} */
  readonly lastSeen: (id: number) => Row | undefined;
  /** The event numbered `id`, wherever it was last read. @throws {never} */
  readonly find: (id: number) => Row | undefined;
  /** Keep the summaries the agent lists for its calendars, and its own calendar's for a new event: the one it lists as "primary", else the first it marks primary, else the first. @throws {never} */
  readonly listed: (calendars: ReadonlyArray<{ readonly calendarId: string; readonly summary?: string; readonly primary?: boolean }>) => void;
  /** The summary the agent listed for `calendarId`, or else its own calendar's, or "" where it listed none. @throws {never} */
  readonly listedName: (calendarId: string) => string;
  /** The summary the agent listed for `calendarId` itself, or "" where it listed none for it. @throws {never} */
  readonly listedSummary: (calendarId: string) => string;
  /** Clear every cached row, revision, and id mapping when the runtime scope closes. @throws {never} */
  readonly reset: () => void;
}

/**
 * The numbers events were given, kept on the phone so that an event keeps its number across a restart and no other
 * event is given it: the last number given, each event's `source:key` with its number, and in `seen`, which a build that
 * reads only numbers leaves alone, the start each was last seen at. A third place in a number, which one build wrote,
 * is read as that start too.
 */
export interface KeptNumbers {
  readonly last: number;
  readonly numbers: ReadonlyArray<readonly [name: string, id: number, begin?: number]>;
  readonly seen?: ReadonlyArray<readonly [name: string, begin: number]>;
}

/** How far numbering moves on at each start past the last number kept, so a number given after the last one kept is never given again. */
const startGap = 2 ** 20;

/** The highest number a start may begin from, leaving room for every number one run can give below the largest whole number a JavaScript number holds exactly. */
const ceiling = Number.MAX_SAFE_INTEGER - 2 ** 40;

/** Where numbering starts once the numbers have reached the `ceiling`: past any number a build that kept none gave in one run. */
const restartFloor = 2 ** 32;

/**
 * The least number a start at `now`, Alpha's time, begins from: past any number an earlier build gave, and a thousand and
 * twenty-four numbers past an earlier start for each millisecond between them, so two starts collide only where the
 * first gave more numbers than that before the second; past 2109, when that would pass the `ceiling`, only the floor.
 * @throws {never}
 */
function timeFloor(now: number): number {
  const at = 2 ** 52 + Math.floor(now) * 2 ** 10;
  return Number.isSafeInteger(at) && at <= ceiling ? at : restartFloor;
}

/** Whether `read` holds only whole numbers a JavaScript number holds exactly, none past its `last`, so that numbering on from it gives no number twice. @throws {never} */
export function exactNumbers(read: KeptNumbers): KeptNumbers | undefined {
  const exact = Number.isSafeInteger(read.last) && read.last > 0
    && read.numbers.every(([, id, begin]) => Number.isSafeInteger(id) && id > 0 && id <= read.last && (begin === undefined || Number.isFinite(begin)))
    && (read.seen ?? []).every(([, begin]) => Number.isFinite(begin));
  return exact ? read : undefined;
}

/**
 * What a start at `now` that could not read the kept numbers numbers from, keeping none: `timeFloor`, and past 2109,
 * where every start that can read them goes afresh from the floor, a place of its own above the floor's, a thousand and
 * twenty-four numbers past an earlier such start for each millisecond between them, so that no event it numbers is given
 * a number a record made before or after it names.
 * @throws {never}
 */
export function unreadAt(now: number): KeptNumbers {
  const at = timeFloor(now);
  return { last: at === restartFloor ? ceiling + (Math.floor(now) % 2 ** 29) * 2 ** 10 : at, numbers: [] };
}

/**
 * What numbering starts from at `now`, given the numbers `read` kept before, if any: on from them and from `timeFloor`;
 * where that would pass the `ceiling`, afresh from the floor, holding none of them, whose numbers then name no event.
 * @throws {never}
 */
export function startAt(read: KeptNumbers | undefined, now: number): KeptNumbers {
  const from = Math.max(read?.last ?? 0, timeFloor(now));
  return from + startGap <= ceiling ? { last: from, numbers: read?.numbers ?? [], seen: read?.seen ?? [] } : { last: restartFloor, numbers: [] };
}

/** How many events' numbers are kept: those seen least lately go first, and a deletion or form that named one then names no event. */
const keptNumbers = 10_000;

/**
 * What names an event of `source` among the others: its key, and for an occurrence of a repeating event on the phone, whose
 * occurrences all share their event's key, its key and its start.
 */
export function occurrenceOf(source: Source, read: Pick<Read, "key" | "recurring" | "begin">): string {
  return source === "Phone" && read.recurring ? `${read.key}@${read.begin}` : read.key;
}

/** The calendar eliza lists as its own, its resident calendar, where it writes a new event (plugin-calendar providers.vibe `residentCalendarId`, host.vibe `writeTarget`). */
const ownCalendarId = "primary";

let activeStore: ShownStore | undefined;
let fallbackStore: ShownStore | undefined;

function makeShownStore(onReset?: () => void, kept?: KeptNumbers, keepNumbers?: (numbers: KeptNumbers) => void): ShownStore {
  const numbers = new Map<string, number>((kept?.numbers ?? []).map(([name, id]) => [name, id] as const));
  const begins = new Map<string, number>([
    ...(kept?.numbers ?? []).flatMap(([name, , begin]) => (begin === undefined ? [] : [[name, begin] as const])),
    ...(kept?.seen ?? []),
  ]);
  const named = new Map<number, string>([...numbers].map(([name, id]) => [id, name] as const));
  const given = new Set(numbers.values());
  const trusted = keepNumbers !== undefined;
  const calendars = new Map<string, number>();
  const seen = new Map<string, { readonly content: string; readonly revision: number }>();
  const windows = new Map<Source, ReadonlyArray<Row>>();
  const last = new Map<number, Row>();
  const cut = new Set<Source>();
  const names = new Map<string, string>();
  let ownName = "";
  const version = createShelf(0);
  let nextNumber = kept === undefined ? 0 : kept.last + startGap;
  let present = false;
  let unkept = keepNumbers !== undefined;
  let open = true;

  /** @throws {never} */
  function keepGiven(): void {
    if (!unkept || !open) return;
    unkept = false;
    for (const [name, id] of numbers) {
      if (numbers.size <= keptNumbers) break;
      numbers.delete(name);
      begins.delete(name);
      named.delete(id);
      given.delete(id);
    }
    keepNumbers?.({
      last: nextNumber,
      numbers: [...numbers],
      seen: [...numbers.keys()].flatMap((name) => {
        const begin = begins.get(name);
        return begin === undefined ? [] : [[name, begin] as const];
      }),
    });
  }

  /** @throws {never} */
  function numbered(source: Source, key: string, begin?: number): number {
    const name = `${source}:${key}`;
    const known = numbers.get(name);
    numbers.delete(name);
    if (begin !== undefined && begins.get(name) !== begin) {
      begins.set(name, begin);
      unkept = trusted;
    }
    if (known !== undefined) {
      numbers.set(name, known);
      return known;
    }
    const made = ++nextNumber;
    numbers.set(name, made);
    named.set(made, name);
    given.add(made);
    unkept = trusted;
    return made;
  }

  /** @throws {never} */
  function calendarNumber(source: Source, calendarId: string): number {
    if (source === "Google") return 0;
    const own = Number(calendarId);
    if (Number.isInteger(own) && own > 0) return own;
    const known = calendars.get(calendarId);
    if (known !== undefined) return known;
    const made = 1_000_000 + calendars.size;
    calendars.set(calendarId, made);
    return made;
  }

  /** @throws {never} */
  function revised(source: Source, row: Read): number {
    if (row.changedAt !== undefined && Number.isFinite(row.changedAt)) return Math.floor(row.changedAt / 1000);
    const name = `${source}:${row.key}`;
    const series = source === "Phone" && row.recurring;
    const content = JSON.stringify(series ? [row.title, row.place, row.notes, row.allDay] : [row.title, row.place, row.notes, row.begin, row.end, row.allDay]);
    const before = seen.get(name);
    const revision = before === undefined ? 0 : before.content === content ? before.revision : before.revision + 1;
    seen.set(name, { content, revision });
    return revision;
  }

  /** @throws {never} */
  function toRow(source: Source, read: Read): Row {
    const { changedAt, ...rest } = read;
    return {
      ...rest,
      source,
      id: numbered(source, occurrenceOf(source, read), read.begin),
      calendar: calendarNumber(source, read.calendarId),
      revision: revised(source, { ...rest, changedAt }),
    };
  }

  /** @throws {never} */
  function told(): void {
    version.update((n) => n + 1);
  }

  const store: ShownStore = {
    snapshot: version.snapshot,
    subscribe: version.subscribe,
    keep(source, day, read, partial = false) {
      if (partial) cut.add(source);
      else cut.delete(source);
      const rows = read.map((one) => toRow(source, one));
      windows.set(source, [...rows].sort((a, b) => a.begin - b.begin));
      for (const row of rows) last.set(row.id, row);
      keepGiven();
      told();
      return rows.filter((row) => onDay(row, day));
    },
    mergeOne(source, read) {
      const row = toRow(source, read);
      const existing = windows.get(source) ?? [];
      const idx = existing.findIndex((candidate) => candidate.id === row.id);
      const next = idx >= 0
        ? existing.map((candidate, at) => (at === idx ? row : candidate))
        : [...existing, row];
      windows.set(source, [...next].sort((a, b) => a.begin - b.begin));
      last.set(row.id, row);
      keepGiven();
      told();
      return row;
    },
    toRow(source, read) {
      const row = toRow(source, read);
      keepGiven();
      return row;
    },
    of(source, day) {
      return (windows.get(source) ?? []).filter((row) => onDay(row, day));
    },
    all(source) {
      return windows.get(source) ?? [];
    },
    visible(hidden, phone, google) {
      const both = [...(phone ? store.all("Phone") : []), ...(google ? store.all("Google") : [])];
      return both.filter((row) => rowShown(row.calendar, [...hidden])).sort((a, b) => a.begin - b.begin);
    },
    partial: (source) => cut.has(source),
    drop(source) {
      windows.delete(source);
      cut.delete(source);
      const prefix = `${source}:`;
      for (const [id, row] of [...last]) if (row.source === source) last.delete(id);
      for (const key of [...seen.keys()]) if (key.startsWith(prefix)) seen.delete(key);
      if (source === "Phone") calendars.clear();
      told();
    },
    present: () => present,
    phone(has) {
      present = has;
      told();
    },
    revisions() {
      return [...seen].map(([name, { content, revision }]) => [name, content, revision] as const);
    },
    restore(kept) {
      for (const [name, content, revision] of kept) if (!seen.has(name)) seen.set(name, { content, revision });
    },
    number(source, key) {
      const id = numbered(source, key);
      keepGiven();
      return id;
    },
    known: (id) => given.has(id),
    forgets: (id) => trusted && !given.has(id),
    seenAt(id) {
      const name = named.get(id);
      const begin = name === undefined ? undefined : begins.get(name);
      return name === undefined || begin === undefined ? undefined : { source: name.startsWith("Phone:") ? "Phone" : "Google", begin };
    },
    lastSeen: (id) => last.get(id),
    find(id) {
      for (const rows of windows.values()) {
        const row = rows.find((candidate) => candidate.id === id);
        if (row !== undefined) return row;
      }
      return undefined;
    },
    // spec/app/calendar/presentation.md, "The agent's calendar goes by the name the agent lists for it"
    listed(list) {
      names.clear();
      const named = list.map((one) => ({ ...one, summary: one.summary?.trim() ?? "" })).filter((one) => one.summary !== "");
      for (const one of named) names.set(one.calendarId, one.summary);
      ownName = (named.find((one) => one.calendarId === ownCalendarId) ?? named.find((one) => one.primary === true) ?? named[0])?.summary ?? "";
      told();
    },
    listedName: (calendarId) => names.get(calendarId) ?? ownName,
    listedSummary: (calendarId) => names.get(calendarId) ?? "",
    reset() {
      open = false;
      names.clear();
      ownName = "";
      numbers.clear();
      begins.clear();
      named.clear();
      given.clear();
      calendars.clear();
      seen.clear();
      windows.clear();
      last.clear();
      cut.clear();
      nextNumber = 0;
      present = false;
      version.reset();
      onReset?.();
    },
  };
  keepGiven();
  return store;
}

function currentStore(): ShownStore {
  if (activeStore !== undefined) return activeStore;
  fallbackStore ??= makeShownStore();
  return fallbackStore;
}

/**
 * Create a scoped Calendar row store backed by a reactive shelf, registered for sibling readers while active. It numbers
 * events on from `kept`, what an earlier run kept, and, given `keepNumbers`, hands it each change to keep. @throws {never}
 */
export function createShownStore(kept?: KeptNumbers, keepNumbers?: (numbers: KeptNumbers) => void): ShownStore {
  const store = makeShownStore(() => {
    if (activeStore === store) activeStore = undefined;
  }, kept, keepNumbers);
  activeStore = store;
  return store;
}

/** Live view of the active scoped Calendar row store, for sibling modules outside the `Shown` service layer. */
export const shown: ShownStore = {
  snapshot: () => currentStore().snapshot(),
  subscribe: (listener) => currentStore().subscribe(listener),
  keep: (source, day, read, partial) => currentStore().keep(source, day, read, partial),
  mergeOne: (source, read) => currentStore().mergeOne(source, read),
  toRow: (source, read) => currentStore().toRow(source, read),
  of: (source, day) => currentStore().of(source, day),
  all: (source) => currentStore().all(source),
  visible: (hidden, phone, google) => currentStore().visible(hidden, phone, google),
  partial: (source) => currentStore().partial(source),
  drop: (source) => currentStore().drop(source),
  present: () => currentStore().present(),
  phone: (has) => currentStore().phone(has),
  revisions: () => currentStore().revisions(),
  restore: (kept) => currentStore().restore(kept),
  number: (source, key) => currentStore().number(source, key),
  known: (id) => currentStore().known(id),
  forgets: (id) => currentStore().forgets(id),
  seenAt: (id) => currentStore().seenAt(id),
  lastSeen: (id) => currentStore().lastSeen(id),
  find: (id) => currentStore().find(id),
  listed: (calendars) => currentStore().listed(calendars),
  listedName: (calendarId) => currentStore().listedName(calendarId),
  listedSummary: (calendarId) => currentStore().listedSummary(calendarId),
  reset: () => currentStore().reset(),
};
