// spec/app/calendar/agent.md, "The agent proposes one change at a time, for the revision of the event it selected, and the card shows it"; spec/app/calendar/agent.md, "A card is complete only with known fields, a valid time and, for a change, a verified target"
import { Option, Schema } from "effect";
import type { Change, Reply, RequestState, Result } from "../../gen/app__calendar__agent.ts";
import { cardComplete, targetVerified } from "../../gen/app__calendar__agent.ts";
import { createShelf } from "../runtime/store.ts";
import type { Row } from "./shown.ts";
import { localDate } from "./time.ts";

/** The fields a Calendar request of the agent sets, as eliza's `CalendarEventFields` of `@elizaos/plugin-calendar` names them. */
export interface RequestFields {
  readonly title: string;
  readonly description: string;
  readonly location: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly isAllDay: boolean;
  readonly timeZone: string;
  readonly attendees: ReadonlyArray<string>;
}

/** Which occurrences a request reaches: one, this and the following, or every one; none for a one-off event. */
export type Occurrences = "instance" | "this_and_following" | "series" | "";

/** One pending Calendar request of the agent's approvals list, as the card shows it and as its approval names it. */
export interface Request {
  /** The number the machine names it by. */
  readonly filing: number;
  /** The request as the agent's approvals list names it, and the revision of it the owner reviews. */
  readonly id: string;
  readonly revision: string;
  /** How often its revision changed since Calendar first read it. */
  readonly changes: number;
  readonly change: Change;
  readonly reply: Reply;
  readonly fields: RequestFields | undefined;
  readonly occurrences: Occurrences;
  /** The event a change names, the calendar it is on, its expected start time, and the version the agent selected; "" for a new event. */
  readonly eventId: string;
  readonly calendarId: string;
  readonly targetStartAt: string;
  readonly expectedVersion: string;
  readonly notify: boolean;
  /** Whether every key of the request is one Alpha knows how to show. */
  readonly known: boolean;
  readonly expiresAt: string;
  /** Where the request stands in the agent's approvals list, an expired one included, as the card's status reads it. */
  readonly state: RequestState;
}

const RequestFieldsSchema = Schema.Struct({
  title: Schema.String,
  description: Schema.String,
  location: Schema.String,
  startAt: Schema.String,
  endAt: Schema.String,
  isAllDay: Schema.Boolean,
  timeZone: Schema.String,
  attendees: Schema.Array(Schema.String),
});

/** Schema for a persisted Calendar approval request kept across restarts. */
export const RequestSchema = Schema.Struct({
  filing: Schema.Number,
  id: Schema.String,
  revision: Schema.String,
  changes: Schema.Number,
  change: Schema.Literals(["Create", "Update", "Delete", "Respond"]),
  reply: Schema.Literals(["NoReply", "Going", "Maybe", "NotGoing"]),
  fields: Schema.optionalKey(RequestFieldsSchema),
  occurrences: Schema.Literals(["instance", "this_and_following", "series", ""]),
  eventId: Schema.String,
  calendarId: Schema.String,
  targetStartAt: Schema.optionalKey(Schema.String),
  expectedVersion: Schema.String,
  notify: Schema.Boolean,
  known: Schema.Boolean,
  expiresAt: Schema.String,
  state: Schema.optionalKey(Schema.Literals(["RequestPending", "RequestExpired", "RequestRetryable", "RequestRejected", "RequestDone", "RequestFailed"])),
});

const decodeStored = Schema.decodeUnknownOption(Schema.fromJsonString(RequestSchema));

/** Decode a persisted Calendar request from JSON without unsafe type assertions. @throws {never} */
export function decodeRequest(raw: string): Request | undefined {
  const decoded = decodeStored(raw);
  if (Option.isNone(decoded)) return undefined;
  const value = decoded.value;
  return { ...value, fields: value.fields, targetStartAt: value.targetStartAt ?? "", state: value.state ?? "RequestPending" };
}

const states: Readonly<Record<string, RequestState>> = {
  pending: "RequestPending", expired: "RequestExpired", retryable: "RequestRetryable", rejected: "RequestRejected",
  approved: "RequestDone", done: "RequestDone", executed: "RequestDone", failed: "RequestFailed",
};

const kinds: Readonly<Record<string, Change>> = { schedule_event: "Create", modify_event: "Update", cancel_event: "Delete", respond_invitation: "Respond" };
const answers: Readonly<Record<string, Reply>> = { accepted: "Going", tentative: "Maybe", declined: "NotGoing" };
const fieldKeys = new Set(["title", "description", "location", "startAt", "endAt", "isAllDay", "timeZone", "attendees"]);
const changeKeys = new Set(["action", "account", "source", "target", "scope", "fields", "recurrence", "response", "notifyAttendees"]);

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The fields of a request, and whether each key is one Alpha shows; none where it names no fields. @throws {never} */
function fieldsOf(value: unknown): { fields: RequestFields | undefined; known: boolean } {
  const fields = record(value);
  if (fields === undefined) return { fields: undefined, known: value === undefined };
  const attendees = Array.isArray(fields.attendees) ? fields.attendees.filter((one): one is string => typeof one === "string") : [];
  return {
    fields: {
      title: text(fields.title), description: text(fields.description), location: text(fields.location), startAt: text(fields.startAt),
      endAt: text(fields.endAt), isAllDay: fields.isAllDay === true, timeZone: text(fields.timeZone), attendees,
    },
    known: Object.keys(fields).every((key) => fieldKeys.has(key)) && typeof fields.title === "string" && typeof fields.startAt === "string" && typeof fields.endAt === "string",
  };
}

/** Whether a request's times make a span: an end after its start, where it sets them. @throws {never} */
export function timeValid(request: Request): boolean {
  if (request.fields === undefined) return true;
  const start = Date.parse(request.fields.startAt);
  const end = Date.parse(request.fields.endAt);
  return Number.isFinite(start) && Number.isFinite(end) && end > start;
}

/** Whether `matched` starts at the instant or all-day date named by `expectedStartAt`. @throws {never} */
function matchesStart(matched: Row, expectedStartAt: string): boolean {
  if (expectedStartAt === "") return true;
  if (matched.allDay) {
    const parsed = localDate(expectedStartAt);
    return Number.isFinite(parsed) && matched.begin === parsed;
  }
  const parsed = Date.parse(expectedStartAt);
  return Number.isFinite(parsed) && matched.begin === parsed;
}

/** Whether exactly one event of one calendar, the one the request names, holds the start and version it was made against. @throws {never} */
export function verified(request: Request, rows: ReadonlyArray<Row>): boolean {
  const byId = rows.filter((row) => row.key === request.eventId);
  const matchingCalendar = request.calendarId === "" ? byId : byId.filter((row) => row.calendarId === request.calendarId);
  const calendars = new Set(byId.map((row) => row.calendarId));
  const matched = matchingCalendar.length === 1 ? matchingCalendar[0] : undefined;
  const startMatches = matched !== undefined && matchesStart(matched, request.targetStartAt);
  const versionMatches = matched !== undefined && matched.version === request.expectedVersion;
  return targetVerified(calendars.size, matchingCalendar.length, startMatches, versionMatches);
}

/** Whether the card may be approved: pending state, known fields, a valid time and, for a change, a verified target. @throws {never} */
export function complete(request: Request, rows: ReadonlyArray<Row>): boolean {
  return request.state === "RequestPending" && cardComplete(request.change, request.known, verified(request, rows), timeValid(request));
}

/** Scoped per-runtime store of agent Calendar requests, expiry flags, and reported outcomes. */
export interface RequestsStore {
  /** @throws {never} */
  readonly snapshot: () => number;
  /** @throws {never} */
  readonly subscribe: (listener: () => void) => () => void;
  /** Parse an untrusted wire approval row into a numbered `Request` within this runtime's store. @throws {never} */
  readonly fromWire: (row: unknown, floor: number, now?: number) => Request | undefined;
  /** @throws {never} */
  readonly keep: (request: Request) => void;
  /** @throws {never} */
  readonly find: (filing: number) => Request | undefined;
  /** Mark a pending request expired when its `expiresAt` passes. @throws {never} */
  readonly markExpired: (filing: number) => void;
  /** Whether a request has been marked expired. @throws {never} */
  readonly isExpired: (filing: number) => boolean;
  /** Record the final `Report` outcome for a filing. @throws {never} */
  readonly recordResult: (filing: number, result: Result) => void;
  /** The last reported outcome for `filing`, if any. @throws {never} */
  readonly lastResult: (filing: number) => Result | undefined;
  /** The owner Calendar last read, signed out counting as one, which the requests held are for: a read of the list or a tap begun under another is refused. @throws {never} */
  readonly owner: () => number;
  /** Drop all pending requests when the signed-in owner changes to `owner`. @throws {never} */
  readonly clear: (owner: number) => void;
  /** Reset all state when the runtime scope closes. @throws {never} */
  readonly reset: () => void;
}

/** Create a scoped Calendar requests store backed by a reactive shelf, with no module-level mutable state. @throws {never} */
export function createRequestsStore(): RequestsStore {
  const numbers = new Map<string, { filing: number; revision: string; changes: number }>();
  const held = new Map<number, Request>();
  const expired = new Set<number>();
  const reported = new Map<number, Result>();
  const version = createShelf(0);
  let next = 0;
  let current = 0;

  /** @throws {never} */
  function told(): void {
    version.update((n) => n + 1);
  }

  return {
    snapshot: version.snapshot,
    subscribe: version.subscribe,
    fromWire(row, floor, now) {
      const wire = record(row);
      const payload = record(wire?.payload);
      const change = record(payload?.change);
      if (wire === undefined || change === undefined) return undefined;
      const kind = kinds[text(change.action)];
      const id = text(wire.id);
      if (kind === undefined || id === "" || text(wire.state) !== "pending") return undefined;
      const revision = text(wire.revision);
      const before = numbers.get(id);
      next = Math.max(next, floor);
      const counted = before === undefined
        ? { filing: ++next, revision, changes: 0 }
        : before.revision === revision ? before : { ...before, revision, changes: before.changes + 1 };
      numbers.set(id, counted);
      const target = record(change.target);
      const source = record(target?.source ?? change.source);
      const { fields, known } = fieldsOf(change.fields);
      const scope = text(change.scope);
      const expiresAt = text(wire.expiresAt);
      const expiredAt = now !== undefined && Date.parse(expiresAt) <= now;
      return {
        filing: counted.filing, id, revision, changes: counted.changes, change: kind,
        reply: kind === "Respond" ? (answers[text(change.response)] ?? "NoReply") : "NoReply",
        fields, occurrences: scope === "instance" || scope === "this_and_following" || scope === "series" ? scope : "",
        eventId: text(target?.eventId), calendarId: text(source?.calendarId), targetStartAt: text(target?.startAt),
        expectedVersion: text(target?.expectedVersion),
        notify: change.notifyAttendees === true, known: known && Object.keys(change).every((key) => changeKeys.has(key)),
        expiresAt,
        state: expiredAt ? "RequestExpired" : (states[text(wire.state)] ?? "RequestFailed"),
      };
    },
    keep(request) {
      held.set(request.filing, request);
      told();
    },
    find: (filing) => held.get(filing),
    markExpired(filing) {
      if (expired.has(filing)) return;
      expired.add(filing);
      told();
    },
    isExpired: (filing) => expired.has(filing),
    recordResult(filing, result) {
      reported.set(filing, result);
      told();
    },
    lastResult: (filing) => reported.get(filing),
    owner: () => current,
    clear(owner) {
      current = owner;
      numbers.clear();
      held.clear();
      expired.clear();
      reported.clear();
      next = 0;
      told();
    },
    reset() {
      numbers.clear();
      held.clear();
      expired.clear();
      reported.clear();
      next = 0;
      current = 0;
      version.reset();
    },
  };
}
