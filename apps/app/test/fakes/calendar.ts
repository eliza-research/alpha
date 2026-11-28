// spec/app/calendar/index.md, "Story: See my days"; spec/app/calendar/index.md, "Story: See only my own account's calendar"
import { ANDROID_CALENDAR_METHODS, type AndroidCalendarEditorFields, type AndroidCalendarEvent, type AndroidCalendarHandoffEvent, type AndroidCalendarList, type AndroidCalendarPlugin, type AndroidCalendarRow } from "@elizaos/os-bridges";
import { type Faked, type Native, plugin, rejection } from "./phone.ts";
import type { Route } from "./routes.ts";

/** One attendee of an event, as eliza's `@elizaos/plugin-calendar` answers it. */
export interface FakeAttendee {
  email: string | null;
  displayName: string | null;
  responseStatus: string | null;
  self: boolean;
  organizer: boolean;
  optional: boolean;
}

/** One event of the agent's Calendar as eliza's calendar routes answer it (`.eliza/packages/plugin-calendar-client/src/model.vibe`, `CalendarEvent`). */
export interface FakeEvent {
  id: string;
  externalId: string;
  agentId: string;
  provider: "eliza" | "google";
  side: "owner";
  calendarId: string;
  title: string;
  description: string;
  location: string;
  status: string;
  startAt: string;
  endAt: string;
  isAllDay: boolean;
  timezone: string | null;
  htmlLink: string | null;
  conferenceLink: string | null;
  organizer: Record<string, unknown> | null;
  attendees: FakeAttendee[];
  metadata: Record<string, unknown>;
  recurringEventId: string | null;
  recurrence?: string[] | null;
  syncedAt: string;
  updatedAt: string;
}

/** What the fake agent and phone hold for Calendar, and how they behave; a journey changes it between steps. */
export interface CalendarScene {
  /** The agent's Calendar. */
  events: FakeEvent[];
  /** What `/api/lifeops/calendar/feed` reports as its `state` (defaults to `"complete"`). */
  feedState?: "complete" | "partial" | "unavailable";
  /** How many times `/api/lifeops/calendar/feed` was read. */
  feedReads?: number;
  /** While set, each read of `/api/lifeops/calendar/feed` answers the events as they were when read, once released; the releases are kept here in the order the reads came. */
  holdFeed?: boolean;
  readonly heldFeed: Array<() => void>;
  /** The summary `/api/lifeops/calendar/calendars` lists for the agent's calendar (defaults to eliza's own, "Eliza Calendar"). */
  summary?: string;
  /** What `/api/lifeops/calendar/calendars` lists in place of that one calendar: eliza's own resident "primary" first, then each Google calendar, as eliza lists them. */
  listed?: FakeCalendarSummary[];
  /** `/api/lifeops/calendar/calendars` alone answers 503, and how many times it answered at all. */
  calendarsDown?: boolean;
  calendarsAnswered?: number;
  /** While set, each read of `/api/lifeops/calendar/calendars` waits for its release, kept here in the order the reads came. */
  holdCalendars?: boolean;
  readonly heldCalendars: Array<() => void>;
  /** While set, each read of `/api/approvals` answers the list as it was when read, once released; the releases are kept here in the order the reads came, and how many answered. */
  holdApprovals?: boolean;
  readonly heldApprovals: Array<() => void>;
  approvalsAnswered?: number;
  /** Every write the agent took, as `<method> <id>`, and the idempotency keys it took them under. */
  readonly writes: string[];
  readonly keys: Map<string, FakeEvent>;
  /** A read answers 503, as an agent that is starting does. */
  down: boolean;
  /** A write is taken and never answered, as when the phone dies before the agent replies. */
  stalled: boolean;
  /** A change to a calendar Alpha does not write directly waits for approval. */
  queued: boolean;
  /** The phone's own calendars and their events, whether Android grants Calendar access, whether the owner denies its prompt, and how often it was asked. */
  readonly calendars: AndroidCalendarRow[];
  phoneEvents: AndroidCalendarEvent[];
  granted: boolean;
  denies: boolean;
  /** The phone's events, by id, that mark their time free or tentative rather than busy. */
  readonly marked: Map<string, "free" | "tentative">;
  /** Android granted reading the calendars alone, as a reviewed read asks it, and not writing them. */
  readOnly: boolean;
  /** Each read of the phone's events, by any call: `list`, or `readWorkflowRange` and `readAvailability` with the calendars they read. */
  readonly eventReads: string[];
  /** A read of the agent's calendar feed is taken and never answered, as by an agent still busy starting. */
  silent: boolean;
  asked: number;
  /** The phone's journal of creations, by creation identity; a create the phone cannot confirm; how often Android Calendar was handed a form. */
  readonly creations: Map<string, string>;
  lost: boolean;
  handedOff: number;
  readonly handoffs: AndroidCalendarHandoffEvent[];
  /** Each agent action the phone's own review was given, as `<type> <operationId>`, and what the owner answers there. */
  readonly reviewed: string[];
  review: "applied" | "cancelled" | "conflict" | "queued" | "unknown";
  /** The agent's approvals list: each Calendar request it filed (`.eliza/packages/agent-host/src/approvals/routes.vibe`), and how it was resolved. */
  readonly approvals: FakeApproval[];
  /** The agent's linked sync control: its revision, whether it is paused, the Google calendar it writes to, and the state of each linked event. */
  readonly control: { revision: number; paused: boolean; destination: { connectorAccountId: string; providerCalendarId: string } | null; links: string[] };
}

export function calendarScene(): CalendarScene {
  return {
    events: [], writes: [], keys: new Map(), down: false, stalled: false, queued: false,
    calendars: [{ id: "local", name: "Phone", writable: true, local: true }], phoneEvents: [], granted: false, denies: false, marked: new Map(), readOnly: false, eventReads: [], silent: false, asked: 0,
    creations: new Map(), lost: false, handedOff: 0, handoffs: [],
    reviewed: [], review: "applied",
    control: { revision: 0, paused: true, destination: null, links: [] }, approvals: [], heldCalendars: [], heldApprovals: [], heldFeed: [],
  };
}

/** One calendar the agent lists, as eliza's `GET /api/lifeops/calendar/calendars` answers it (`plugin-calendar` providers.vibe `sources`, `plugin-calendar-client` feed/broker.vibe). */
export interface FakeCalendarSummary {
  provider: "eliza" | "google";
  side: "owner";
  calendarId: string;
  summary: string;
  primary: boolean;
}

/** One request of the agent's approvals list, as `GET /api/approvals` answers it. */
export interface FakeApproval {
  id: string;
  state: string;
  action: string;
  payload: { change: Record<string, unknown>; digest: string };
  revision: string;
  expiresAt: string;
}

/** A Calendar change the agent filed for the owner's approval, as eliza's calendar plugin files one (`plugin/host.vibe`). */
export function agentRequest(id: string, change: Record<string, unknown>): FakeApproval {
  const action = change["action"] === "respond_invitation" ? (change["response"] === "declined" ? "cancel_event" : "modify_event") : String(change["action"]);
  return { id, state: "pending", action, payload: { change, digest: id }, revision: "r1", expiresAt: "2099-01-01T00:00:00.000Z" };
}

/** Make the change a request holds, as eliza's calendar executor does once the owner approves it. */
function execute(scene: CalendarScene, change: Record<string, unknown>): boolean {
  const fields = (change["fields"] ?? {}) as { title?: string; description?: string; location?: string; startAt?: string; endAt?: string; isAllDay?: boolean };
  const target = (change["target"] ?? {}) as { eventId?: string; expectedVersion?: string };
  if (change["action"] === "schedule_event") {
    const event = agentEvent(fields.title ?? "", Date.parse(fields.startAt ?? ""), Date.parse(fields.endAt ?? ""), { location: fields.location ?? "", isAllDay: fields.isAllDay ?? false });
    scene.writes.push(`create ${event.id}`);
    scene.events.push(event);
    return true;
  }
  const event = scene.events.find((one) => one.id === target.eventId);
  if (!event || etag(event) !== target.expectedVersion) return false;
  if (change["action"] === "cancel_event") {
    scene.writes.push(`delete ${event.id}`);
    scene.events = scene.events.filter((one) => one !== event);
  } else if (change["action"] === "respond_invitation") {
    scene.writes.push(`answer ${event.id} ${String(change["response"])}`);
    event.attendees = event.attendees.map((attendee) => (attendee.self ? { ...attendee, responseStatus: String(change["response"]) } : attendee));
    bump(event);
  } else {
    scene.writes.push(`update ${event.id}`);
    Object.assign(event, { title: fields.title ?? event.title, location: fields.location ?? event.location, startAt: fields.startAt ?? event.startAt, endAt: fields.endAt ?? event.endAt });
    bump(event);
  }
  return true;
}

/** An event of the agent's own calendar from `begin` to `end`, as eliza writes one. */
export function agentEvent(title: string, begin: number, end: number, more: Partial<FakeEvent> = {}): FakeEvent {
  const id = `ev-${title.toLowerCase().replace(/\W+/g, "-")}`;
  const stamp = new Date(begin).toISOString();
  return {
    id, externalId: id, agentId: "agent", provider: "eliza", side: "owner", calendarId: "eliza-calendar/primary", title, description: "", location: "",
    status: "confirmed", startAt: new Date(begin).toISOString(), endAt: new Date(end).toISOString(), isAllDay: false, timezone: null, htmlLink: null,
    conferenceLink: null, organizer: { self: true }, attendees: [], metadata: { etag: "1" }, recurringEventId: null, syncedAt: stamp, updatedAt: stamp, ...more,
  };
}

const etag = (event: FakeEvent) => typeof event.metadata["etag"] === "string" ? event.metadata["etag"] : "";
const bump = (event: FakeEvent) => { event.metadata = { ...event.metadata, etag: String(Number(etag(event)) + 1) }; };
const never = () => new Promise<Response>(() => {});
/** `answer` at once, or, while `holding`, once the release it keeps in `releases` is called. */
const heldWhile = (holding: boolean | undefined, releases: Array<() => void>, answer: () => Response) =>
  holding ? new Promise<void>((release) => releases.push(release)).then(answer) : answer();
const base = "/api/lifeops/calendar";

function changed(scene: CalendarScene, key: string, event: FakeEvent, reply: unknown): Response | Promise<Response> {
  scene.keys.set(key, event);
  return scene.stalled ? never() : Response.json(reply);
}

export function calendarRoutes(scene: CalendarScene): Route[] {
  const primary = { connectorAccountId: "google-owner", providerCalendarId: "primary" };
  const controlView = () => ({ revision: scene.control.revision, paused: scene.control.paused, destination: scene.control.destination, pendingDispatch: null, conflicts: 0 });
  return [
    (request, url) => {
      if (request.method !== "GET" || url.pathname !== "/api/approvals") return;
      const listed = { ownerEntityId: "owner", approvals: scene.approvals.filter((one) => one.state === (url.searchParams.get("state") ?? "pending")).toReversed() };
      const answer = () => {
        scene.approvalsAnswered = (scene.approvalsAnswered ?? 0) + 1;
        return Response.json(listed);
      };
      return heldWhile(scene.holdApprovals, scene.heldApprovals, answer);
    },
    (request, url) => {
      const found = /^\/api\/approvals\/([^/]+)\/resolve$/.exec(url.pathname);
      if (request.method !== "POST" || !found) return;
      const approval = scene.approvals.find((one) => one.id === decodeURIComponent(found[1] ?? ""));
      if (!approval || approval.state !== "pending") return Response.json({ error: "not_found" }, { status: 404 });
      return request.json().then((body: { decision: string; revision: string }) => {
        if (body.revision !== approval.revision) return Response.json({ error: "stale_revision" }, { status: 409 });
        scene.writes.push(`${body.decision} ${approval.id}`);
        if (body.decision === "reject") {
          approval.state = "rejected";
          return Response.json({ requestId: approval.id, decision: "reject", kind: "rejected", text: "Declined." });
        }
        const done = execute(scene, approval.payload.change);
        approval.state = done ? "done" : "rejected";
        return Response.json({ requestId: approval.id, decision: "approve", kind: done ? "succeeded" : "invalidated", text: "" });
      });
    },
    (request, url) => (request.method === "GET" && url.pathname === `${base}/sync-control` ? Response.json(controlView()) : undefined),
    (request, url) => {
      if (request.method !== "GET" || url.pathname !== `${base}/sync-control/destinations`) return;
      const choice = scene.control.destination === null ? "SelectPrimary" : "ResumeDestination";
      return Response.json({ revision: scene.control.revision, choice, destination: scene.control.destination ?? primary, candidates: [{ ...primary, side: "owner", accessRole: "owner", primary: true, accountEmail: "owner@alpha.test" }] });
    },
    (request, url) => {
      if (request.method !== "POST" || url.pathname !== `${base}/sync-control`) return;
      return request.json().then((body: { expectedRevision: number; operation: string; destination?: { connectorAccountId: string; providerCalendarId: string } | null }) => {
        if (body.expectedRevision !== scene.control.revision) return Response.json({ error: "stale_revision" }, { status: 409 });
        if (body.operation === "select") scene.control.destination = body.destination ?? null;
        scene.control.paused = body.operation === "pause";
        scene.control.revision += 1;
        scene.writes.push(`sync ${body.operation}`);
        return Response.json({ ...controlView(), receipt: { id: `r${scene.control.revision}`, operationKey: body.operation, committedAt: "", revision: scene.control.revision, replayed: false } });
      });
    },
    (request, url) => (request.method === "GET" && url.pathname === `${base}/links` ? Response.json({ links: scene.control.links.map((state, at) => ({ linkId: `l${at}`, localEventId: `e${at}`, destination: primary, providerEventId: null, handoffKey: "", localOnly: false, staged: false, state })) }) : undefined),
    (request, url) => {
      if (request.method !== "GET" || url.pathname !== `${base}/feed`) return;
      if (scene.silent) return never();
      if (scene.down) return Response.json({ error: "starting" }, { status: 503 });
      scene.feedReads = (scene.feedReads ?? 0) + 1;
      const [timeMin, timeMax] = [url.searchParams.get("timeMin") ?? "", url.searchParams.get("timeMax") ?? ""];
      const [from, to] = [Date.parse(timeMin), Date.parse(timeMax)];
      const events = scene.events.filter((event) => Date.parse(event.startAt) < to && Date.parse(event.endAt) > from);
      const answer = { calendarId: "all", events, source: "synced", state: scene.feedState ?? "complete", sources: [], timeMin, timeMax, syncedAt: timeMax };
      return heldWhile(scene.holdFeed, scene.heldFeed, () => Response.json(answer));
    },
    (request, url) => {
      if (request.method !== "GET" || url.pathname !== `${base}/calendars`) return;
      const answer = () => {
        scene.calendarsAnswered = (scene.calendarsAnswered ?? 0) + 1;
        if (scene.down || scene.calendarsDown) return Response.json({ error: "starting" }, { status: 503 });
        return Response.json({ calendars: scene.listed ?? [{ provider: "eliza", side: "owner", calendarId: "eliza-calendar/primary", summary: scene.summary ?? "Eliza Calendar", primary: true }] });
      };
      return heldWhile(scene.holdCalendars, scene.heldCalendars, answer);
    },
    (request, url) => {
      if (request.method !== "POST" || url.pathname !== `${base}/events`) return;
      return request.json().then((body: { title: string; description?: string; location?: string; startAt: string; endAt: string; isAllDay?: boolean; idempotencyKey: string }) => {
        const again = scene.keys.get(body.idempotencyKey);
        if (again) return Response.json({ event: again, receipt: {} });
        const draft = agentEvent(body.title, Date.parse(body.startAt), Date.parse(body.endAt), { description: body.description ?? "", location: body.location ?? "", isAllDay: body.isAllDay ?? false });
        let id = draft.id;
        let suffix = 2;
        while (scene.events.some((existing) => existing.id === id)) id = `${draft.id}-${suffix++}`;
        const event = { ...draft, id, externalId: id };
        if (scene.queued) {
          const approvalId = `approval-${scene.approvals.length + 1}`;
          scene.approvals.push(agentRequest(approvalId, { action: "schedule_event", account: "owner", source: { calendarId: "eliza-calendar/primary" }, fields: { title: body.title, description: body.description ?? "", location: body.location ?? "", startAt: body.startAt, endAt: body.endAt, isAllDay: body.isAllDay ?? false, timeZone: "UTC" }, recurrence: null }));
          return Response.json({ approvalRequestId: approvalId }, { status: 202 });
        }
        scene.writes.push(`create ${event.id}`);
        scene.events.push(event);
        return changed(scene, body.idempotencyKey, event, { event, receipt: {} });
      });
    },
    (request, url) => {
      const found = new RegExp(`^${base}/events/([^/]+)(/response)?$`).exec(url.pathname);
      if (!found || (request.method !== "PATCH" && request.method !== "DELETE" && request.method !== "POST")) return;
      if (request.method === "DELETE") {
        const key = url.searchParams.get("idempotencyKey") ?? "";
        const again = key === "" ? undefined : scene.keys.get(key);
        if (again) return Response.json({ deleted: true, event: again, receipt: {} });
        const event = scene.events.find((one) => one.id === decodeURIComponent(found[1] ?? ""));
        if (!event) return Response.json({ code: "CALENDAR_EVENT_NOT_FOUND" }, { status: 404 });
        if (url.searchParams.get("expectedProviderVersion") !== etag(event)) return Response.json({ code: "CALENDAR_TARGET_CHANGED" }, { status: 409 });
        scene.writes.push(`delete ${event.id}`);
        if (url.searchParams.get("cancellationMode") === "decline_invitation") {
          event.attendees = event.attendees.map((attendee) => (attendee.self ? { ...attendee, responseStatus: "declined" } : attendee));
          bump(event);
        } else scene.events = scene.events.filter((one) => one !== event);
        return changed(scene, key, event, { deleted: true, event, receipt: {} });
      }
      return request.json().then((body: { title?: string; description?: string; notes?: string; location?: string; startAt?: string; endAt?: string; responseStatus?: string; expectedProviderVersion: string; idempotencyKey: string }) => {
        const again = body.idempotencyKey ? scene.keys.get(body.idempotencyKey) : undefined;
        if (again) return Response.json({ event: again, receipt: {} });
        const event = scene.events.find((one) => one.id === decodeURIComponent(found[1] ?? ""));
        if (!event) return Response.json({ code: "CALENDAR_EVENT_NOT_FOUND" }, { status: 404 });
        if (body.expectedProviderVersion !== etag(event)) return Response.json({ code: "CALENDAR_TARGET_CHANGED" }, { status: 409 });
        if (found[2] !== undefined) {
          scene.writes.push(`answer ${event.id} ${body.responseStatus ?? ""}`);
          event.attendees = event.attendees.map((attendee) => (attendee.self ? { ...attendee, responseStatus: body.responseStatus ?? null } : attendee));
        } else {
          scene.writes.push(`update ${event.id}`);
          Object.assign(event, { title: body.title ?? event.title, description: body.description ?? body.notes ?? event.description, location: body.location ?? event.location, startAt: body.startAt ?? event.startAt, endAt: body.endAt ?? event.endAt });
        }
        bump(event);
        return changed(scene, body.idempotencyKey, event, { event, receipt: {} });
      });
    },
  ];
}

/** The calls of `CalendarPlugin.java` eliza's typed client does not name yet: a create under a creation identity, and its receipts. */
interface Creations {
  save(input: { id?: string; title: string; body?: string; location?: string; begin: number; end: number; calendarId: string; creationId?: string; separateCreation?: boolean; expected?: { revision: string } }): Promise<{ status: string; id?: string; calendarId?: string; creationId?: string }>;
  saveOptions(input: { event: AndroidCalendarHandoffEvent; calendarId: string; creationId: string; separateCreation: boolean }): ReturnType<Creations["save"]>;
  pendingCreations(): Promise<{ status: string; creations: { creationId: string; status: string }[] }>;
  executeAgent(input: { operation: unknown; operationId: string }): Promise<{ status: string; result?: unknown }>;
  cancelAgent(input: { operationId: string }): Promise<{ status: string }>;
  requestWorkflowReadAccess(): Promise<{ status: string }>;
  readWorkflowRange(input: { calendarIds: readonly string[]; start: string; end: string; timeZone: string; maximumEvents: number }): Promise<{ status: string; events?: unknown }>;
  availabilitySources(input: { timeZone: string }): Promise<{ status: string; timeZone?: string; calendars?: unknown }>;
  readAvailability(input: { calendars: ReadonlyArray<{ id: string; revision: string }>; start: string; end: string; timeZone: string }): Promise<{ status: string; freshness?: string; events?: unknown }>;
  prepareAgentSource(): Promise<{ status: string; sourceId?: string; sourceRevision?: string }>;
}

/** The phone's calls: what eliza's definition lists, which eliza checks against the compiled plugin, then the calls it does not name yet. */
type PhoneCalendar = Omit<AndroidCalendarPlugin, "save"> & Creations;
const CREATION_CALLS = Object.keys({
  saveOptions: true, pendingCreations: true, executeAgent: true, cancelAgent: true, requestWorkflowReadAccess: true, readWorkflowRange: true, availabilitySources: true, readAvailability: true, prepareAgentSource: true,
} satisfies Record<Exclude<keyof Creations, "save">, true>) as ReadonlyArray<Exclude<keyof Creations, "save">>;

/** A phone calendar's source revision as `CalendarSourceIdentity.java` names it: 64 hex digits that change with its name, account or kind. */
const sourceRevisionOf = (row: AndroidCalendarRow) => [...JSON.stringify([row.id, row.name, row.account, row.local])].map((one) => one.charCodeAt(0).toString(16)).join("").padEnd(64, "0").slice(-64);

/** The phone event `id` as the plugin compares it: its revision is what it says. */
const revisionOf = (event: AndroidCalendarEvent) => JSON.stringify([event.title, event.body, event.location, event.begin, event.end]);

/**
 * `CalendarPlugin.java`, the `ElizaCalendar` plugin: Android's one prompt for Calendar access, the phone's calendars
 * and events of a range, which it lists only once access is granted, a create journaled under its creation identity
 * (`lost` makes the next one's answer unknown, as a write the phone could not confirm), a change of the event as last inspected, and
 * a deletion the phone's own review confirmed. `AlphaCalendarPlugin.java` adds the free or busy reads: the calendars to choose
 * from, with no event, and the times of exactly those chosen, read only once every one is local and as reviewed.
 */
export function elizaCalendar(scene: CalendarScene): Faked {
  const find = (id: string) => scene.phoneEvents.find((event) => event.id === id);
  const reads = () => scene.granted || scene.readOnly;
  const inFront = () => document.visibilityState === "visible";
  let nextPhoneId = Math.max(0, ...scene.phoneEvents.map((event) => Number(event.id.replace(/^p/, "")) || 0));
  function create(input: AndroidCalendarEditorFields, creationId = "", allDay = false, recurring = false): ReturnType<Creations["save"]> {
    nextPhoneId = Math.max(nextPhoneId, ...scene.phoneEvents.map((event) => Number(event.id.replace(/^p/, "")) || 0)) + 1;
    const id = `p${nextPhoneId}`;
    scene.phoneEvents.push({ id, calendarId: "local", title: input.title, body: input.body ?? "", location: input.location ?? "", begin: input.begin, end: input.end, allDay, recurring, creationId });
    scene.creations.set(creationId, "saved");
    if (scene.lost) return Promise.reject(rejection("Calendar write could not be confirmed. Check creation receipts before retrying."));
    return Promise.resolve({ status: "saved", id, calendarId: "local", creationId });
  }
  const calls: Native<PhoneCalendar> = {
    checkPermissions: () => Promise.resolve({ calendar: scene.granted ? "granted" : "prompt" }),
    requestAccess() {
      scene.asked += 1;
      scene.granted = !scene.denies;
      return Promise.resolve({ status: scene.granted ? "granted" : "denied" });
    },
    list({ begin, end }): Promise<AndroidCalendarList> {
      scene.eventReads.push("list");
      if (!scene.granted) return Promise.resolve({ status: "permission-required" });
      return Promise.resolve({ status: "ready", calendars: scene.calendars, events: scene.phoneEvents.filter((event) => event.begin < end && event.end > begin), truncated: false });
    },
    open: () => Promise.resolve({ status: "opened" }),
    insertHandoff({ event }) {
      scene.handedOff += 1;
      scene.handoffs.push(event);
      return Promise.resolve({ status: "opened", alertsPrefilled: false });
    },
    inspect({ id }) {
      const event = find(id);
      return Promise.resolve(event ? { status: "ready", revision: revisionOf(event), sourceRevision: revisionOf(event) } : { status: "conflict" });
    },
    save(input) {
      if (input.id === undefined || input.id === "") return create(input, input.creationId);
      const event = find(input.id);
      if (!event || input.expected?.revision !== revisionOf(event)) return Promise.resolve({ status: "conflict" });
      Object.assign(event, { title: input.title, body: input.body ?? "", location: input.location ?? "", begin: input.begin, end: input.end });
      return Promise.resolve({ status: "saved", id: event.id, calendarId: event.calendarId });
    },
    saveOptions({ event, creationId }) {
      if (event.allDay && (event.timeZone !== "UTC" || event.end <= event.begin || event.begin % 86_400_000 !== 0 || event.end % 86_400_000 !== 0)) return Promise.reject(rejection("Invalid all-day event"));
      return create(event, creationId, event.allDay, Boolean(event.rrule));
    },
    pendingCreations: () => Promise.resolve({ status: "ready", creations: [...scene.creations].map(([creationId, status]) => ({ creationId, status })) }),
    inspectDeletion({ id, expected }) {
      if (document.visibilityState !== "visible") return Promise.resolve({ status: "unavailable" });
      const series = scene.phoneEvents.filter((event) => event.id === id);
      const event = series.find((one) => one.begin === expected.begin);
      if (!event) return Promise.resolve({ status: "conflict" });
      return Promise.resolve({
        status: "ready", recurrence: event.recurring ? "rule" : "one-off", writable: true, revision: revisionOf(event), sourceRevision: revisionOf(event),
        evidence: { selectedRow: "ParentRow", sync: "LocalUnsynced", sourceCurrent: true, bounded: true, otherExceptions: false, liveException: "NoLiveException", instances: 1, begin: event.begin, finish: event.end, exceptionOriginal: 0 },
      });
    },
    executeAgent({ operation, operationId }) {
      const op = operation as { type: string; target?: { sourceId: string; eventId: string; revision: string }; fields?: Record<string, unknown> };
      scene.reviewed.push(`${op.type} ${operationId}`);
      if (scene.review !== "applied") return Promise.resolve({ status: scene.review });
      if (op.type === "calendar_read_next") {
        return Promise.resolve({ status: "applied", result: { version: 1, kind: "calendar_read_next", window: { start: "2026-11-24T00:00:00.000Z", end: "2026-11-25T00:00:00.000Z", timeZone: "UTC" }, event: null } });
      }
      const target = op.target ?? { sourceId: "local", eventId: `p${scene.phoneEvents.length + 1}`, revision: "0".repeat(64) };
      return Promise.resolve({ status: "applied", result: { version: 1, kind: op.type, sourceId: target.sourceId, eventId: target.eventId, revision: target.revision } });
    },
    cancelAgent: () => Promise.resolve({ status: "cancelled" }),
    prepareAgentSource: () => Promise.resolve(scene.granted ? { status: "ready", sourceId: "local", sourceRevision: "0".repeat(64) } : { status: "permission-required" }),
    requestWorkflowReadAccess() {
      scene.asked += 1;
      return Promise.resolve({ status: reads() ? "granted" : "denied" });
    },
    readWorkflowRange({ calendarIds, start, end, maximumEvents }) {
      scene.eventReads.push(`readWorkflowRange ${calendarIds.join(",")}`);
      const [from, to] = [Date.parse(start), Date.parse(end)];
      const events = scene.phoneEvents.filter((event) => calendarIds.includes(event.calendarId) && event.begin < to && event.end > from).slice(0, maximumEvents + 1)
        .map((event) => ({ id: event.id, calendarId: event.calendarId, revision: "0".repeat(64), title: event.title ?? "", start: new Date(event.begin).toISOString(), end: new Date(event.end).toISOString(), allDay: event.allDay }));
      return Promise.resolve({ status: "ready", events });
    },
    availabilitySources({ timeZone }) {
      if (!reads()) return Promise.resolve({ status: "permission-required" });
      if (!inFront()) return Promise.resolve({ status: "unavailable" });
      return Promise.resolve({ status: "ready", timeZone, calendars: scene.calendars.map((row) => ({ id: row.id, name: row.name ?? "", account: row.account ?? "", sourceRevision: sourceRevisionOf(row) })) });
    },
    readAvailability({ calendars, start, end }) {
      if (!reads()) return Promise.resolve({ status: "permission-required" });
      if (!inFront()) return Promise.resolve({ status: "unavailable" });
      const chosen = calendars.map(({ id, revision }) => ({ revision, row: scene.calendars.find((row) => row.id === id) }));
      if (chosen.some(({ row, revision }) => row === undefined || sourceRevisionOf(row) !== revision)) return Promise.resolve({ status: "changed" });
      if (chosen.some(({ row }) => !row?.local)) return Promise.resolve({ status: "freshness-unknown" });
      const ids = calendars.map((calendar) => calendar.id);
      scene.eventReads.push(`readAvailability ${ids.join(",")}`);
      const [from, to] = [Date.parse(start), Date.parse(end)];
      const events = scene.phoneEvents.filter((event) => ids.includes(event.calendarId) && event.begin < to && event.end > from)
        .map((event) => ({ start: new Date(event.begin).toISOString(), end: new Date(event.end).toISOString(), allDay: event.allDay, availability: scene.marked.get(event.id) ?? "busy" }));
      return Promise.resolve(events.length > 200 ? { status: "too-many" } : { status: "ready", freshness: "local", events });
    },
    dispatchDeletion({ id, change, originalStart, revision }) {
      const occurrence = change === "ExcludeOccurrence";
      const event = scene.phoneEvents.find((one) => one.id === id && (!occurrence || one.begin === originalStart));
      if (!event || revisionOf(event) !== revision) return Promise.resolve({ status: "conflict" });
      scene.phoneEvents = scene.phoneEvents.filter((event) => event.id !== id || (occurrence && event.begin !== originalStart));
      return Promise.resolve({ status: "committed", readback: { parentAfter: occurrence ? "ParentLive" : "ParentGone", fieldsMatch: true, exclusionExact: true, cancelledAtStart: 0, instanceRemains: false } });
    },
  };
  return plugin<PhoneCalendar>(() => Object.fromEntries([...ANDROID_CALENDAR_METHODS, ...CREATION_CALLS].map((name) => [name, calls[name]])) as Native<PhoneCalendar>);
}

/** Someone on the reference week's events, as `PEOPLE` of develop's fixtures names them. */
const reference: Readonly<Record<string, string>> = {
  maya: "Maya Chen", jordan: "Jordan Park", priya: "Priya Nair", sam: "Sam Okafor", lena: "Lena Ruiz", dad: "Dad",
};

/** One event of the reference week: its day from today, start hour, length in hours, and who comes with their reply. */
interface Seed { id: string; off: number; t: number; d: number; title: string; work: boolean; where?: string; video?: string; who?: Record<string, string>; notes?: string; invite?: string; weekdays?: boolean }

const week: ReadonlyArray<Seed> = [
  { id: "c1", off: -14, t: 9.5, d: 0.5, title: "Standup", work: true, video: "meet.lumen.example/standup", who: { maya: "accepted", sam: "accepted" }, weekdays: true },
  { id: "c2", off: 0, t: 11, d: 1.5, title: "Deep work", work: true, notes: "Enclave copy, then the onboarding flow." },
  { id: "c3", off: 0, t: 13, d: 1, title: "Lunch · Priya", work: false, where: "Tartine, Guerrero St", who: { priya: "accepted" } },
  { id: "c4", off: 0, t: 15, d: 1, title: "Design review", work: true, video: "meet.lumen.example/design-review", who: { maya: "accepted", jordan: "tentative", sam: "accepted", lena: "accepted" }, notes: "Walk through the onboarding prototype. Decide on the enclave copy before Friday." },
  { id: "c5", off: 0, t: 16.5, d: 0.5, title: "Jordan · term sheet", work: true, where: "Phone", who: { jordan: "accepted" }, notes: "Revised term sheet is in your inbox." },
  { id: "c6", off: 0, t: 19.5, d: 1, title: "Gym", work: false, where: "Equinox SoMa" },
  { id: "c11", off: -1, t: 8.5, d: 0.5, title: "Coffee · Lena", work: false, where: "Sightglass, 7th St", who: { lena: "needsAction" } },
  { id: "c12", off: -1, t: 14, d: 1, title: "Roadmap review", work: true, video: "meet.lumen.example/roadmap", who: { maya: "needsAction", sam: "needsAction" } },
  { id: "c8", off: 1, t: 10, d: 0.5, title: "1:1 · Maya", work: true, video: "meet.lumen.example/maya", who: { maya: "needsAction" } },
  { id: "c9", off: 1, t: 14, d: 1, title: "Dentist", work: false, where: "Mission Dental, Valencia St" },
  { id: "c13", off: 2, t: 9, d: 2, title: "Board prep", work: true, where: "Lumen HQ, 3rd floor", who: { jordan: "needsAction", maya: "needsAction" } },
  { id: "c14", off: 2, t: 19, d: 1.5, title: "Dinner · Dad", work: false, where: "Zuni Café", who: { dad: "needsAction" } },
  { id: "c10", off: 3, t: 19, d: 2, title: "Northpoint partner dinner", work: true, where: "Nopa, Divisadero St", who: { jordan: "accepted", priya: "needsAction" }, invite: "jordan", notes: "Partners and founders, informal. Jordan would like you to say a few words about the enclave." },
  { id: "c15", off: 4, t: 13, d: 1, title: "Offsite planning", work: true, video: "meet.lumen.example/offsite", who: { maya: "needsAction", lena: "needsAction" } },
  { id: "c16", off: 5, t: 10, d: 2, title: "Farmers market", work: false, where: "Ferry Building", who: { priya: "needsAction" } },
];

/** One occurrence of `seed` on the day `off` days from `today`'s midnight. */
function occurrence(seed: Seed, today: Date, off: number, series: boolean): FakeEvent {
  const begin = new Date(today.getFullYear(), today.getMonth(), today.getDate() + off).getTime() + seed.t * 3_600_000;
  const attendees: FakeAttendee[] = Object.entries(seed.who ?? {}).map(([id, status]) => ({
    email: `${id}@lumen.example`, displayName: reference[id] ?? id, responseStatus: status, self: false, organizer: seed.invite === id, optional: false,
  }));
  if (seed.invite) attendees.push({ email: "owner@alpha.test", displayName: "You", responseStatus: "needsAction", self: true, organizer: false, optional: false });
  const id = series ? `${seed.id}-${off}` : seed.id;
  return agentEvent(seed.title, begin, begin + seed.d * 3_600_000, {
    id, externalId: id, calendarId: seed.work ? "eliza-calendar/primary" : "eliza-calendar/personal", description: seed.notes ?? "", location: seed.where ?? "",
    conferenceLink: seed.video ? `https://${seed.video}` : null, attendees, recurringEventId: series ? seed.id : null, provider: seed.invite ? "google" : "eliza",
    recurrence: series ? ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"] : null,
    organizer: seed.invite ? { self: false, displayName: reference[seed.invite] } : { self: true },
  });
}

// spec/app/calendar/index.md, "Story: See my days"
/** Develop's reference week (`CAL_SEED` of its fixtures) in the agent's Calendar, for the explore server only: a journey starts from an empty calendar. */
export function seedReferenceWeek(scene: CalendarScene, now: number): void {
  const today = new Date(now);
  scene.events = week.flatMap((seed) => {
    if (!seed.weekdays) return [occurrence(seed, today, seed.off, false)];
    return Array.from({ length: 150 }, (_, at) => seed.off + at).filter((off) => {
      const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + off).getDay();
      return day !== 0 && day !== 6;
    }).map((off) => occurrence(seed, today, off, true));
  });
}
