// @vitest-environment happy-dom
import { NOT_DISPATCHED } from "@elizaos/agent";
import { CALENDAR_AVAILABILITY_CAPABILITY, CALENDAR_CAPABILITY, deviceTimeZone } from "@elizaos/plugin-calendar-client";
import { Effect, Schema } from "effect";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { Machine as Conversation } from "../gen/app__assistant.effect.vibe";
import { Machine as Composer } from "../gen/app__assistant__composer.effect.vibe";
import { type Calendar as CalendarView, Machine as View } from "../gen/app__calendar.effect.vibe";
import { Machine as Changes } from "../gen/app__calendar__agent.effect.vibe";
import { Machine as Toasts } from "../gen/app__notices__toasts.effect.vibe";
import { Machine as Editor } from "../gen/app__calendar__editor.effect.vibe";
import { Machine as Held } from "../gen/app__calendar__deletions.effect.vibe";
import { Machine as Shell } from "../gen/app__shell.effect.vibe";
import { Machine as Settings } from "../gen/app__settings.effect.vibe";
import { Machine as Link } from "../gen/app__calendar__link.effect.vibe";
import { Machine as Reminders } from "../gen/app__reminders.effect.vibe";
import { Machine as Alerts } from "../gen/app__reminders__alerts.effect.vibe";
import assistant from "../src/assistant/index.tsx";
import { executeMedia } from "../src/assistant/media-executors.ts";
import type { Mount } from "../src/areas.ts";
import { calendarCapabilities } from "../src/calendar/device-actions.vibe";
import calendar from "../src/calendar/index.tsx";
import { relistRequests } from "../src/calendar/agent.vibe";
import { mapsHandoffKey } from "../src/calendar/calendar.vibe";
import { agentFields } from "../src/calendar/editor.vibe";
import { complete, createRequestsStore, decodeRequest } from "../src/calendar/requests.ts";
import { subjectNow } from "../src/calendar/selection.ts";
import { createShownStore, shown } from "../src/calendar/shown.ts";
import { Requests } from "../src/calendar/stores.vibe";
import { civilDay, dateOf, dayStart, localWallTime, shiftDays, utcDate, wallDateTime } from "../src/calendar/time.ts";
import { createReminderItem } from "../src/reminders/reminders.vibe";
import { DEFAULT_LIST_ID, remindersStore } from "../src/reminders/store.ts";
import type { Alpha } from "../src/runtime/area.tsx";
import { asleep, button, closeAll, coverLifted, drawn, fill, hardware, later, only, open, press, seen, underAct, until } from "./alpha.tsx";
import { agentEvent, agentRequest } from "./fakes/calendar.ts";
import { account } from "./fakes/cloud.ts";
import { type Scene, scene } from "./fakes/scene.ts";

underAct();
afterEach(async () => {
  await closeAll();
  remindersStore.reset();
});

const hour = 3_600_000;
const narrowDay = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });

/** A world at nine in the morning of a Tuesday, whose agent keeps a stand-up, a lunch it was invited to and a dentist's appointment, and whose phone keeps the gym. */
function morning(phone: boolean): Scene & { at: (day: number, hours: number) => number; today: number } {
  const world = { ...scene(), phone };
  world.now = new Date(2026, 10, 24, 9).getTime();
  const today = civilDay(world.now);
  const at = (day: number, hours: number) => dayStart(today + day) + hours * hour;
  world.calendar.events.push(
    agentEvent("Standup", at(0, 10), at(0, 10.5), { conferenceLink: "https://meet.alpha.test/standup" }),
    agentEvent("Team lunch", at(0, 12), at(0, 13), {
      location: "Cafe", htmlLink: "https://calendar.google.com/event?eid=1", provider: "google", organizer: { email: "sam@alpha.test" },
      attendees: [
        { email: "sam@alpha.test", displayName: "Sam", responseStatus: "accepted", self: false, organizer: true, optional: false },
        { email: "owner@alpha.test", displayName: "You", responseStatus: "needsAction", self: true, organizer: false, optional: false },
      ],
    }),
    agentEvent("Dentist", at(2, 15), at(2, 16)),
  );
  world.calendar.phoneEvents.push({ id: "p1", calendarId: "local", title: "Gym", begin: at(0, 18), end: at(0, 19), allDay: false, recurring: false });
  return Object.assign(world, { at, today });
}

/** The timeline and list rows, separate from the invitation banner above them. */
const events = () => [...document.querySelectorAll("[data-alpha-subview=calendar-list] [role=region] button")];

/** The titles of the events the days show, in order: each event's button is named by its title and time. */
const titles = () => events().map((found) => (found.getAttribute("aria-label") ?? "").split(", "))
  .map((names) => ["Standup", "Team lunch", "Dentist", "Gym", "Coffee"].find((title) => names.includes(title)) ?? "").filter((title) => title !== "");

/** Tap the row or block with `text` as the event title. */
async function tap(text: string) {
  const found = events().find((candidate) => (candidate.getAttribute("aria-label") ?? "").split(", ").includes(text));
  if (!found) throw new Error(`no row ${text}`);
  await press(found.getAttribute("aria-label") ?? "");
}

const chooseDate = () => press(`Choose date: ${document.querySelector("[data-host-chrome] h1")?.textContent ?? ""}`);

/** The menu item whose accessible name is `name`, if one is shown. */
const menuItem = (name: string) => [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((found) => (found.getAttribute("aria-label") ?? found.textContent ?? "") === name);

/** Open the event actions Radix menu. */
async function openEventActions() {
  const trigger = button("Event actions");
  if (!trigger) throw new Error("no button Event actions");
  await drawn(() => {
    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false, isPrimary: true }));
    trigger.click();
  });
}

/** Choose an item from the open Radix event actions menu. */
async function chooseEventAction(name: string) {
  await openEventActions();
  const item = menuItem(name);
  if (!item) throw new Error(`no menuitem ${name}`);
  await drawn(() => item.click());
}

/** Open the month dialog under the title and choose `pill` there: a layout, or the Calendars sheet. */
async function fromMonth(pill: string) {
  await chooseDate();
  await press(pill);
}

/**
 * Make Calendar's canvas wide, as a tablet's is: only there it offers Search, the layouts and the Calendars sheet. A phone
 * world is already wide at the test window's 1024 points; a browser world draws the 412-point phone preview unless its
 * pointer is coarse, so the window is measured again with a touch pointer.
 */
async function widen(alpha: Alpha, runtime: ReturnType<typeof calendar.runtime>) {
  if ((await runtime.runPromise(Effect.flatMap(View, (view) => view.get()))).wide) return;
  const coarse = window.matchMedia("(pointer: coarse)");
  Object.defineProperty(coarse, "matches", { configurable: true, value: true });
  const original = window.matchMedia.bind(window);
  const media = vi.spyOn(window, "matchMedia").mockImplementation((query) => query === "(pointer: coarse)" ? coarse : original(query));
  onTestFinished(() => media.mockRestore());
  await drawn(() => window.dispatchEvent(new Event("resize")));
  await until(alpha, runtime, View, (state) => state.wide);
}

/** Bring Calendar forward, as Home, a notice or Ask Alpha does through the shell. */
const openCalendar = (alpha: Alpha) => alpha.runtime.runPromise(Effect.flatMap(Shell, (shell) => shell.send({ type: "openView", view: "Calendar" })));

/** The availability sheet alone over every view, as areas.ts mounts it. */
const availabilitySheet: Mount = { at: "overlay", load: () => import("../src/calendar/availability.tsx") };

/** The agent's availability check of today from `from` to `to` o'clock, in the phone's zone. */
const availabilityCheck = (world: ReturnType<typeof morning>, from: number, to: number) =>
  ({ type: "calendar_availability", start: new Date(world.at(0, from)).toISOString(), end: new Date(world.at(0, to)).toISOString(), timeZone: deviceTimeZone() }) as const;

const availabilityCall = (id: string) => ({ proposalId: id, operationId: id, attemptId: 1 });
const approved = { current: () => Promise.resolve(true) };
const tickBox = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("[role=checkbox]")].find((found) => found.getAttribute("aria-label") === name);
const availabilitySheetShows = (label: string) => vi.waitFor(() => expect(document.querySelector(`[role=dialog][aria-label="${label}"]`)).not.toBeNull());
const openView = (alpha: Alpha, view: "Notes") => drawn(() => alpha.runtime.runPromise(Effect.flatMap(Shell, (shell) => shell.send({ type: "openView", view }))));

/** Mount Calendar on `world`, bring it to front, and wait until `ready` holds on its view machine. */
async function mountCalendar(
  world: ReturnType<typeof morning>,
  areas: ReturnType<typeof only>,
  ready: (state: CalendarView) => boolean,
) {
  const { alpha, close } = await open(world, areas);
  const runtime = calendar.runtime(alpha);
  await openCalendar(alpha);
  await until(alpha, runtime, View, (state) => state.front && ready(state));
  return { alpha, close, runtime, world };
}

async function onCalendar(world: ReturnType<typeof morning>, ready: (state: CalendarView) => boolean = (state) => state.front) {
  return mountCalendar(world, only("view:Calendar"), ready);
}

async function onBrowserCalendar() {
  return onCalendar(morning(false), (s) => s.front && s.googleRows === 2);
}

/** Calendar on a phone once it shows Google's two rows, and a way to read the day again. */
async function onPhoneCalendar() {
  const running = await onCalendar(morning(true), (s) => s.googleRows === 2);
  const reread = () => running.runtime.runPromise(Effect.flatMap(View, (machine) => machine.send({ type: "refresh" })));
  return { ...running, reread };
}

/** Calendar standing alone: signed out, with no Google account. */
async function onDisconnected() {
  const world = { ...morning(false), signedIn: false };
  world.inbox.google = undefined;
  return onCalendar(world, (state) => state.front && state.owner === 0 && !state.connected);
}

/** Calendar on `world`, once it shows today and has read the reminders. */
async function onReminders(world: ReturnType<typeof morning>) {
  const running = await onCalendar(world, (state) => state.front && state.anchor === world.today);
  await until(running.alpha, running.alpha.runtime, Reminders, (state) => state.sync.status === "Loaded");
  return running;
}

/** Save `item` as a reminder and wait until the agent confirmed it. */
async function saveReminder(alpha: Alpha, item: Parameters<typeof createReminderItem>[0]) {
  const created = await alpha.runtime.runPromise(createReminderItem(item));
  await until(alpha, alpha.runtime, Reminders, (state) => state.write.outcome === "Confirmed");
  if (!created) throw new Error(`Expected the saved reminder ${item.title}`);
  return created;
}

/** Open today's only reminder, the one whose row `title` names. */
async function openReminder({ alpha, runtime }: Awaited<ReturnType<typeof onCalendar>>, title: RegExp) {
  await until(alpha, runtime, View, (state) => state.reminders === 1);
  await press(title);
  await until(alpha, runtime, View, (state) => state.reminder > 0);
}

/** What the open event or reminder's detail reads. */
const detail = () => document.querySelector('[data-alpha-subview="calendar-detail"]')?.textContent;

// spec/app/calendar/index.md, "Story: Let Calendar read my phone's calendar"; spec/app/calendar/index.md, "What Android answers replaces what Calendar believed; granted, the day is read, withdrawn, the phone's rows go"
it("Rechecks Calendar access on return from Android Settings", async () => {
  const world = morning(true);
  const { alpha, runtime } = await mountCalendar(world, only("view:Calendar", "view:Settings"), (state) => state.front && state.google.status === "Loaded" && state.googleRows === 2);
  expect(titles()).toEqual(["Standup", "Team lunch"]);

  await seen(false);
  world.calendar.granted = true;
  await seen(true);
  await vi.waitFor(() => expect(titles()).toEqual(["Standup", "Team lunch", "Gym"]));

  await tap("Gym");
  await until(alpha, runtime, View, (state) => state.local && state.open !== 0);
  await seen(false);
  world.calendar.granted = false;
  await seen(true);
  await until(alpha, runtime, View, (state) => state.open === 0 && state.phoneRows === 0);
  await vi.waitFor(() => expect(titles()).toEqual(["Standup", "Team lunch"]));

  await alpha.runtime.runPromise(Shell.use((shell) => shell.send({ type: "openView", view: "Settings" })));
  await until(alpha, runtime, View, (state) => !state.front);
  world.calendar.granted = true;
  await openCalendar(alpha);
  await vi.waitFor(() => expect(titles()).toEqual(["Standup", "Team lunch", "Gym"]));
  expect(world.calendar.asked).toBe(0);
});

it("Offers Search, the layouts and the Calendars sheet only on a wide screen (spec/app/calendar/index.md, \"Search and the Calendars sheet open over the days, never over an open event\")", async () => {
  const size = { width: Object.getOwnPropertyDescriptor(window, "innerWidth"), height: Object.getOwnPropertyDescriptor(window, "innerHeight") };
  onTestFinished(() => {
    if (size.width) Object.defineProperty(window, "innerWidth", size.width);
    if (size.height) Object.defineProperty(window, "innerHeight", size.height);
  });
  const resize = async (width: number, height: number) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
    await drawn(() => window.dispatchEvent(new Event("resize")));
  };
  // spec/app/calendar/index.md, "Several days side by side only on a wide screen": a phone measures its own window; 412 points is Alpha's portrait phone, 1024 a tablet's width.
  const { alpha, runtime } = await onCalendar(morning(true));
  await resize(412, 915);
  await until(alpha, runtime, View, (state) => state.front && !state.wide);
  expect(button("Search events")).toBeUndefined();
  expect(button("New event")).toBeDefined();
  await chooseDate();
  await until(alpha, runtime, View, (state) => state.overlay === "MonthDialog");
  expect(document.querySelector('[role="group"][aria-label="Calendar view"]')).toBeNull();
  expect(button("Schedule")).toBeUndefined();
  await hardware("back");
  await until(alpha, runtime, View, (state) => state.overlay === "NoOverlay");

  await resize(1024, 768);
  await until(alpha, runtime, View, (state) => state.wide);
  expect(button("Search events")).toBeDefined();
  await chooseDate();
  await until(alpha, runtime, View, (state) => state.overlay === "MonthDialog");
  expect(button("Schedule")).toBeDefined();
});

const calendarSettings = () => document.querySelector('[data-settings-page="Calendar"]');

const dayButton = (day: number) => `${narrowDay.format(dateOf(day))} ${dateOf(day).getDate()}`;

/** Open Team lunch, answer No, and confirm Decline in its review. */
async function answerNoToLunch(alpha: Alpha, runtime: ReturnType<typeof calendar.runtime>) {
  await tap("Team lunch");
  await until(alpha, runtime, View, (s) => s.open !== 0);
  await press("No");
  await until(alpha, runtime, Held, (d) => d.asked !== 0);
  await press("Decline");
}

/** Choose Delete for the open event and confirm its review, so the deletion waits with its Undo notice. */
async function deleteOpenEvent(alpha: Alpha, runtime: ReturnType<typeof calendar.runtime>, action = "Delete") {
  await chooseEventAction(action);
  await until(alpha, runtime, Held, (d) => d.asked !== 0);
  await press("Yes");
  await until(alpha, runtime, Held, (d) => d.waiting !== 0 && d.notice);
}

async function declineLunch(alpha: Alpha, runtime: ReturnType<typeof calendar.runtime>) {
  await answerNoToLunch(alpha, runtime);
  await until(alpha, runtime, Held, (d) => d.waiting !== 0);
  await hardware("home");
  await until(alpha, runtime, Editor, (e) => e.kind === "Remove" && e.write.outcome !== "Sent");
}

describe("Calendar without a connected account", () => {
  it('Shows Calendar settings on the empty standalone timeline (spec/app/calendar/presentation.md, "Story: Know what to do when Calendar cannot read")', async () => {
    const world = { ...morning(false), signedIn: false };
    world.inbox.google = undefined;
    const { alpha } = await open(world, only("view:Calendar", "view:Settings"));
    const runtime = calendar.runtime(alpha);
    await openCalendar(alpha);
    await until(alpha, runtime, View, (state) => state.front && state.owner === 0 && !state.connected);
    const timeline = document.querySelector('[aria-label="Calendar timeline"]');
    expect(timeline?.textContent).toContain("Not connected");
    expect(button("Open Calendar settings")).toBeDefined();
    await widen(alpha, runtime);
    await chooseDate();
    await until(alpha, runtime, View, (state) => state.overlay === "MonthDialog");
    expect(document.querySelector<HTMLSelectElement>('select[aria-label="Calendar year"]')?.options).toHaveLength(101);
    expect(button("Day")).toBeDefined();
    expect(button("Schedule")).toBeDefined();
    expect(button("Calendars")).toBeUndefined();
    await hardware("back");
    await until(alpha, runtime, View, (state) => state.overlay === "NoOverlay");
    await press("Open Calendar settings");
    await until(alpha, alpha.runtime, Settings, (state) => state.page === "CalendarApp");
    expect((await alpha.runtime.runPromise(Shell.use((shell) => shell.get()))).trail).toEqual(["Calendar", "Settings"]);
    await vi.waitFor(() => expect(calendarSettings()?.textContent).toContain("Google CalendarNot connected"));
    expect(calendarSettings()?.textContent).not.toContain("Permissions");
  });

  it(`Shows the granted local calendar while the account is signed out (spec/app/calendar/index.md, "Story: Let Calendar read my phone's calendar")`, async () => {
    const world = { ...morning(true), signedIn: false };
    world.calendar.granted = true;
    await mountCalendar(world, only("view:Calendar"), (state) => state.owner === 0 && !state.connected && state.phoneRows === 1);
    expect(titles()).toEqual(["Gym"]);
    expect(document.querySelector('[aria-label="Calendar timeline"]')?.textContent).not.toContain("Not connected");
    expect(button("Open Calendar settings")).toBeUndefined();
  });

  async function draftOfflineWeeklyPiano(checkInitialCalendar = false) {
    const world = morning(true);
    world.calendar.granted = true;
    world.calendar.down = true;
    const { alpha } = await open(world, only("view:Calendar", "view:Settings"));
    const runtime = calendar.runtime(alpha);
    await openCalendar(alpha);
    await until(alpha, runtime, View, (state) => state.front && state.owner > 0 && !state.connected && state.phoneRows === 1);
    await press("New event");
    await until(alpha, runtime, Editor, (state) => state.shown && state.form === "NewEvent" && state.receipts.status === "Loaded");
    await fill("Title", "Piano");
    if (checkInitialCalendar) expect([Boolean(button("Eliza Calendar")), button("This phone's calendar")?.getAttribute("aria-pressed")]).toEqual([false, "true"]);
    await press("Weekly");
    await until(alpha, runtime, Editor, (state) => state.titled && state.kept);
    await press("Back to calendar");
    await until(alpha, runtime, Editor, (state) => !state.shown && state.banner === "Available");
    return { world, alpha, runtime };
  }

  async function reconnectAndResumeDraft(world: ReturnType<typeof morning>, alpha: Awaited<ReturnType<typeof open>>["alpha"], runtime: ReturnType<typeof calendar.runtime>) {
    world.calendar.down = false;
    await alpha.runtime.runPromise(Effect.flatMap(Shell, (shell) => shell.send({ type: "openView", view: "Settings" })));
    await until(alpha, runtime, View, (state) => !state.front);
    await openCalendar(alpha);
    await until(alpha, runtime, View, (state) => state.front && state.connected);
    await press("Resume event draft");
    await until(alpha, runtime, Editor, (state) => state.shown && state.receipts.status === "Loaded");
  }

  it('Keeps a draft\'s repeat on this phone\'s calendar when Google connects before it is resumed (spec/app/calendar/writing.md, "The form offers with the agent\'s calendar only what it holds, and keeps the calendar chosen"; spec/app/calendar/editor.md, "Story: Keep my draft through a restart")', async () => {
    const { world, alpha, runtime } = await draftOfflineWeeklyPiano(true);

    // spec/app/calendar/editor.md, "Story: Keep my draft through a restart": Google connects while the draft waits; Calendar reads it when it comes forward again.
    await reconnectAndResumeDraft(world, alpha, runtime);
    const pressed = (name: string) => button(name)?.getAttribute("aria-pressed");
    expect([pressed("This phone's calendar"), pressed("Eliza Calendar"), pressed("Weekly")]).toEqual(["true", "false", "true"]);
    await press("Save event");
    await until(alpha, runtime, Editor, (state) => state.form === "NoForm" && state.write.outcome === "Confirmed");
    expect(world.calendar.phoneEvents.find(({ title }) => title === "Piano")).toMatchObject({ recurring: true });
    expect(world.calendar.events.some(({ title }) => title === "Piano")).toBe(false);
  });

  it('Shows only the way to clear a repeat a draft holds on the agent\'s calendar (spec/app/calendar/writing.md, "The form offers with the agent\'s calendar only what it holds, and keeps the calendar chosen")', async () => {
    const { world, alpha, runtime } = await draftOfflineWeeklyPiano();
    // spec/app/calendar/editor.md, "Story: Keep my draft through a restart": a draft kept before #1742 recorded no calendar, so once Google connects it opens on the agent's calendar still holding Weekly.
    await runtime.runPromise(Effect.gen(function* () {
      const { owner } = yield* Effect.flatMap(Editor, (editor) => editor.get());
      const store = yield* KeyValueStore.KeyValueStore;
      const key = `alpha.calendar.form.${owner}`;
      const { calendar: _calendar, ...draft } = JSON.parse((yield* store.get(key)) ?? "{}") as Record<string, unknown>;
      yield* store.set(key, JSON.stringify(draft));
    }));

    await reconnectAndResumeDraft(world, alpha, runtime);
    const drawnOptions = () => ["Once", "No repeat", "Daily", "Weekdays", "Weekly", "Video link", "None", "10 min"].filter((name) => button(name) !== undefined);
    // spec/app/calendar/writing.md, "The form offers with the agent's calendar only what it holds, and keeps the calendar chosen": v119 45f6bed30 prototype/agent-calendar-adapter.ts:328 kept only a No repeat chip that sets the repeat back.
    expect([button("Eliza Calendar")?.getAttribute("aria-pressed"), drawnOptions(), button("No repeat")?.getAttribute("aria-pressed")]).toEqual(["true", ["No repeat"], "false"]);
    await press("No repeat");
    await until(alpha, runtime, Editor, (state) => state.kept);
    expect(drawnOptions()).toEqual([]);
    await press("Save event");
    await until(alpha, runtime, Editor, (state) => state.form === "NoForm" && state.write.outcome === "Confirmed");
    expect(world.calendar.events.find(({ title }) => title === "Piano")).toBeDefined();
    expect(world.calendar.phoneEvents.some(({ title }) => title === "Piano")).toBe(false);
  });

  it('Shows the upcoming window and disconnection in standalone Schedule (spec/app/calendar/presentation.md, "Schedule shows upcoming events and reminders through the end of next month")', async () => {
    const { alpha, runtime } = await onDisconnected();
    await widen(alpha, runtime);
    await fromMonth("Schedule");
    await until(alpha, runtime, View, (state) => state.layout === "Agenda" && state.overlay === "NoOverlay");
    const schedule = document.querySelector('[aria-label="Schedule"][role="region"]');
    expect(schedule?.textContent).toContain("Through Dec 31, 2026");
    expect(schedule?.textContent).toContain("Not connected");
    expect(schedule?.textContent).not.toContain("No upcoming events");
  });

  it('Shows the covered window and disconnection while searching standalone Calendar (spec/app/calendar/index.md, "Search and the Calendars sheet open over the days, never over an open event")', async () => {
    const { alpha, runtime } = await onDisconnected();
    await widen(alpha, runtime);
    await press("Search events");
    await until(alpha, runtime, View, (state) => state.overlay === "Search");
    const results = document.querySelector('[aria-label="Search results"][role="region"]');
    expect(results?.textContent).toContain("Searching Oct 1, 2026 – Dec 31, 2026");
    expect(results?.textContent).toContain("Not connected");
    await fill("Search events", "Dentist");
    expect(results?.textContent).toContain("Not connected");
    expect(results?.textContent).not.toContain("No matching events");
  });

  it('Shows and completes the exact dated reminder in Calendar (spec/app/calendar/index.md, "Story: See reminders among my events")', async () => {
    const running = await onReminders({ ...morning(false), signedIn: false });
    const { alpha, runtime } = running;

    const inputs = { listId: DEFAULT_LIST_ID, title: "Bring the blue notebook", dueMinute: 570, alertMinutes: null };
    const first = await saveReminder(alpha, { ...inputs, notes: "The first draft is inside.", dueDate: "2026-11-24" });
    const tomorrow = await saveReminder(alpha, { ...inputs, notes: "A different notebook.", dueDate: "2026-11-25" });

    await openReminder(running, /^Bring the blue notebook,/);
    expect(detail()).toContain("The first draft is inside.");
    expect(detail()).not.toContain("A different notebook.");
    await press("Complete reminder occurrence");
    await vi.waitFor(() => expect(detail()).toContain("Completed · no further alarm scheduled"));
    expect(remindersStore.findItem(first.id)?.completed).toBe(true);
    expect(remindersStore.findItem(tomorrow.id)?.completed).toBe(false);

    await hardware("back");
    await until(alpha, runtime, View, (state) => state.reminder === 0);
    expect(detail()).toBeUndefined();
    expect(button(/^Bring the blue notebook,/)).toBeDefined();
  });

  it('Snoozes only the selected alerted revision and keeps its date in Calendar (spec/app/reminders/alerts.md, "Story: Alert on due reminders and act from the banner")', async () => {
    const world = morning(true);
    world.reminders.mirrorDatedItems = true;
    const running = await onReminders(world);
    const { alpha } = running;

    const inputs = { listId: DEFAULT_LIST_ID, title: "Bring the blue notebook", dueMinute: 570, alertMinutes: 0 };
    const first = await saveReminder(alpha, { ...inputs, dueDate: "2026-11-24" });
    const tomorrow = await saveReminder(alpha, { ...inputs, dueDate: "2026-11-25" });
    const revision = first.revision + 1;
    expect(remindersStore.findItem(first.id)).toMatchObject({ agentTaskId: `task-${first.id}`, revision });

    await openReminder(running, /^Bring the blue notebook,/);
    expect(detail()).toContain("Alert at start");
    await vi.waitFor(() => expect(world.reminders.scheduled.get(first.id)?.at).toBe(world.at(0, 9.5)));
    await press("Snooze reminder 10 minutes");
    const untilMs = world.now + 10 * 60_000;
    await vi.waitFor(() => expect(detail()).toContain("Snoozed until"));
    await vi.waitFor(() => expect(world.reminders.scheduled.get(first.id)).toMatchObject({ at: untilMs, dueAt: world.at(0, 9.5) }));
    expect(remindersStore.findItem(first.id)).toMatchObject({ dueDate: first.dueDate, dueMinute: first.dueMinute, snoozedUntilMs: untilMs });
    expect(world.reminders.items.find((item) => item.id === first.id)?.snoozedUntilMs).toBe(untilMs);
    expect(remindersStore.findItem(tomorrow.id)?.snoozedUntilMs).toBeNull();
    expect(world.reminders.items.find((item) => item.id === tomorrow.id)?.snoozedUntilMs).toBeNull();

    const selected = remindersStore.specIdForItem(first.id);
    world.reminders.items = world.reminders.items.map((item) => item.id === first.id ? { ...item, revision: item.revision + 1 } : item);
    await press("Snooze reminder 10 minutes");
    await until(alpha, alpha.runtime, Alerts, (state) => state.entries.some((entry) => entry.id === selected && entry.attempt.outcome === "Refused"));
    expect(remindersStore.findItem(first.id)).toMatchObject({ revision: revision + 1, snoozedUntilMs: untilMs });
  });

  it('Saves the Calendar Reminders form once without adding a calendar event (spec/app/calendar/editor.md, "Story: Write an event")', async () => {
    const world = { ...morning(false), signedIn: false };
    const eventCount = world.calendar.events.length;
    const { alpha, runtime } = await onReminders(world);

    await press("New event");
    await until(alpha, runtime, Editor, (state) => state.form === "NewEvent" && state.shown);
    await press("Reminders");
    await fill("Title", "Leave through the garden");
    await fill("Reminder time", "10:15");
    await press("Weekdays");
    await press("None");
    await fill("Notes", "Close the gate.");
    expect(document.querySelector('[aria-label="Location"]')).toBeNull();
    expect(remindersStore.snapshot().snapshot.items).toHaveLength(0);
    await press("Save event");
    await until(alpha, runtime, Editor, (state) => !state.shown && state.write.outcome === "Confirmed");
    await until(alpha, alpha.runtime, Reminders, (state) => state.write.outcome === "Confirmed");
    await until(alpha, runtime, View, (state) => state.reminders === 1);

    expect(world.calendar.events).toHaveLength(eventCount);
    expect(world.reminders.items).toHaveLength(1);
    expect(world.reminders.items[0]).toMatchObject({
      title: "Leave through the garden", notes: "Close the gate.", dueDate: "2026-11-24", dueMinute: 615, recurrence: "weekdays", alertMinutes: null,
    });
    await press(/^Leave through the garden,/);
    expect(detail()).toContain("Due 10:15 AM");
  });

  it('Reviews discarding a retained Calendar reminder draft (spec/app/calendar/editor.md, "Story: Keep my draft through a restart")', async () => {
    const world = { ...morning(false), signedIn: false };
    const { alpha, runtime } = await onCalendar(world);
    await until(alpha, runtime, View, (state) => state.front && state.anchor === world.today);
    await press("New event");
    await until(alpha, runtime, Editor, (state) => state.form === "NewEvent" && state.shown);
    await press("Reminders");
    await fill("Title", "Keep this until I confirm");
    await press("Discard calendar draft");
    await until(alpha, runtime, Editor, (state) => state.confirming === "ConfirmDiscard");
    await hardware("back");
    await until(alpha, runtime, Editor, (state) => state.confirming === "NoConfirm" && state.shown);
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Title"]')?.value).toBe("Keep this until I confirm");
    await press("Discard calendar draft");
    await until(alpha, runtime, Editor, (state) => state.confirming === "ConfirmDiscard");
    await press("Discard");
    await until(alpha, runtime, Editor, (state) => state.form === "NoForm");
    expect(remindersStore.snapshot().snapshot.items).toHaveLength(0);
    await press("New event");
    await until(alpha, runtime, Editor, (state) => state.form === "NewEvent" && state.shown);
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Title"]')?.value).toBe("");
  });

  it('Edits a dated reminder in Calendar without changing another reminder with the same title (spec/app/calendar/editor.md, "Story: Write an event")', async () => {
    const world = morning(false);
    const running = await onReminders(world);
    const { alpha, runtime } = running;
    const input = { listId: DEFAULT_LIST_ID, title: "Bring the blue notebook", dueMinute: 570, alertMinutes: null };
    const selected = await saveReminder(alpha, { ...input, notes: "The first draft is inside.", dueDate: "2026-11-24" });
    const other = await saveReminder(alpha, { ...input, notes: "A different notebook.", dueDate: "2026-11-25" });

    await openReminder(running, /^Bring the blue notebook,/);
    await chooseEventAction("Edit event");
    await until(alpha, runtime, Editor, (state) => state.form === "EditReminder" && state.shown);
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Title"]')?.value).toBe(selected.title);
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Reminder time"]')?.value).toBe("09:30");
    await fill("Notes", "Take the earlier draft.");
    await fill("Reminder time", "10:15");
    await press("Save event");
    await until(alpha, runtime, Editor, (state) => !state.shown && state.write.outcome === "Confirmed");
    expect(remindersStore.findItem(selected.id)).toMatchObject({ notes: "Take the earlier draft.", dueMinute: 615, revision: selected.revision + 1 });
    expect(world.reminders.items.find((item) => item.id === selected.id)).toMatchObject({ notes: "Take the earlier draft.", dueMinute: 615 });
    expect(remindersStore.findItem(other.id)).toMatchObject({ notes: "A different notebook.", dueMinute: 570, revision: other.revision });
  });

  it("Reviews reopening the exact completed reminder without an alert (spec/app/calendar/reminderReopen.md, \"Story: Review reopening the selected reminder without an alert\")", async () => {
    const world = morning(false);
    const running = await onReminders(world);
    const { alpha, runtime } = running;
    const inputs = { listId: DEFAULT_LIST_ID, title: "Bring the blue notebook", dueMinute: 570, alertMinutes: 0 };
    const selected = await saveReminder(alpha, { ...inputs, dueDate: "2026-11-24" });
    const other = await saveReminder(alpha, { ...inputs, dueDate: "2026-11-25" });

    await openReminder(running, /^Bring the blue notebook,/);
    await press("Complete reminder occurrence");
    await until(alpha, alpha.runtime, Reminders, (state) => state.write.outcome === "Confirmed");
    expect(detail()).toContain(`Completed ${new Date(world.now).toLocaleString()} · due ${new Date(world.at(0, 9.5)).toLocaleString()}`);
    await press("Reopen reminder");
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain("No alert"));
    await hardware("back");
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    expect(world.reminders.items.find((item) => item.id === selected.id)?.completed).toBe(true);
    expect(button("Reopen reminder")).toBeDefined();

    await press("Reopen reminder");
    await vi.waitFor(() => expect(button("Reopen")).toBeDefined());
    try {
      await seen(false);
      await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    } finally {
      await seen(true);
    }
    expect(world.reminders.items.find((item) => item.id === selected.id)?.completed).toBe(true);

    await until(alpha, runtime, View, (state) => state.front && state.reminders === 1);
    await press(/^Bring the blue notebook,/);
    await until(alpha, runtime, View, (state) => state.reminder > 0);
    await press("Reopen reminder");
    await vi.waitFor(() => expect(button("Reopen")).toBeDefined());
    await press("Reopen");
    // spec/app/reminders/index.md, "The reviewed reopen from Calendar restores the same reminder without an alert": the completion still holds its five-second Undo, and the reopen write waits for it to end
    expect(await alpha.runtime.runPromise(Reminders.use((reminders) => reminders.get()))).toMatchObject({ undo: { holding: "Held" } });
    await later(alpha, 5_100);
    await until(alpha, alpha.runtime, Reminders, (state) => state.undo.holding !== "Held" && state.write.outcome === "Confirmed");
    await vi.waitFor(() => expect(detail()).toContain("No alert · saved on this device"));
    expect(world.reminders.items.find((item) => item.id === selected.id)).toMatchObject({ completed: false, alertMinutes: null, dueMinute: 570 });
    expect(world.reminders.items.find((item) => item.id === other.id)).toMatchObject({ completed: false, alertMinutes: 0, revision: other.revision });
  });

  it(`Reviews a completed reminder's new time before rescheduling it (spec/app/calendar/editor.md, "Moving a completed reminder keeps its edited draft on screen until the owner approves rescheduling")`, async () => {
    const world = morning(false);
    const { alpha, runtime } = await onReminders(world);
    const request = { listId: DEFAULT_LIST_ID, title: "Bring the same notebook", dueMinute: 570, alertMinutes: 0 };
    const selected = await saveReminder(alpha, { ...request, dueDate: "2026-11-24" });
    const other = await saveReminder(alpha, { ...request, dueDate: "2026-11-25" });
    await until(alpha, runtime, View, (state) => state.front && state.reminders === 1);
    await press(/^Bring the same notebook,/);
    await press("Complete reminder occurrence");
    await until(alpha, alpha.runtime, Reminders, (state) => state.write.outcome === "Confirmed");
    await chooseEventAction("Edit event");
    await until(alpha, runtime, Editor, (state) => state.form === "EditReminder" && state.shown);
    await fill("Reminder time", "10:15");
    await press("Save event");
    await until(alpha, runtime, Editor, (state) => state.confirming === "ConfirmReschedule");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Reschedule?");
    await press("Cancel");
    await until(alpha, runtime, Editor, (state) => state.confirming === "NoConfirm" && state.shown);
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Reminder time"]')?.value).toBe("10:15");
    expect(world.reminders.items.find((item) => item.id === selected.id)).toMatchObject({ completed: true, dueMinute: 570 });
    await press("Save event");
    await until(alpha, runtime, Editor, (state) => state.confirming === "ConfirmReschedule");
    await press("Reschedule");
    await until(alpha, runtime, Editor, (state) => !state.shown && state.write.outcome === "Confirmed");
    expect(world.reminders.items.find((item) => item.id === selected.id)).toMatchObject({ completed: false, dueMinute: 615, alertMinutes: 0 });
    expect(world.reminders.items.find((item) => item.id === other.id)).toMatchObject({ completed: false, dueMinute: 570, revision: other.revision });
  });

  it('Shows the completed occurrence below the next daily reminder (spec/app/reminders/index.md, "Completing a reminder holds a five-second Undo snapshot and advances a repeating reminder to its next due day")', async () => {
    const world = morning(false);
    const { alpha, runtime } = await onReminders(world);
    const saved = await saveReminder(alpha, {
      listId: DEFAULT_LIST_ID, title: "Bring a notebook", dueDate: "2026-11-24", dueMinute: 570, alertMinutes: 0, recurrence: "daily",
    });
    await until(alpha, runtime, View, (state) => state.front && state.reminders === 1);
    await press(/^Bring a notebook,/);
    await press("Complete reminder occurrence");
    await until(alpha, alpha.runtime, Reminders, (state) => state.write.outcome === "Confirmed");
    expect(detail()).toContain("Wednesday, Nov 25");
    expect(detail()).toContain(`Completed ${new Date(world.now).toLocaleString()} · due ${new Date(world.at(0, 9.5)).toLocaleString()}`);
    expect(detail()).toContain("Next occurrence is scheduled after Done.");
    expect(button("Complete reminder occurrence")).toBeDefined();
    expect(world.reminders.items.find((item) => item.id === saved.id)).toMatchObject({ completed: false, dueDate: "2026-11-25", history: [
      { revision: saved.revision, dueAtMs: world.at(0, 9.5), completedAtMs: world.now },
    ] });
  });

  it('Shows the elapsed repeat date skipped by a late completion (spec/app/reminders/index.md, "Completing a reminder holds a five-second Undo snapshot and advances a repeating reminder to its next due day")', async () => {
    const world = morning(false);
    const { alpha, runtime } = await onReminders(world);
    const saved = await saveReminder(alpha, {
      listId: DEFAULT_LIST_ID, title: "Read the agenda", dueDate: "2026-11-23", dueMinute: 510, alertMinutes: 0, recurrence: "daily",
    });
    await press(dayButton(world.today - 1));
    await until(alpha, runtime, View, (state) => state.anchor === world.today - 1 && state.reminders === 1);
    await press(/^Read the agenda,/);
    await press("Complete reminder occurrence");
    await until(alpha, alpha.runtime, Reminders, (state) => state.write.outcome === "Confirmed");
    expect(detail()).toContain("Wednesday, Nov 25");
    expect(detail()).toContain("1 elapsed repeat dates skipped");
    expect(world.reminders.items.find((item) => item.id === saved.id)).toMatchObject({ dueDate: "2026-11-25", history: [
      { dueAtMs: world.at(-1, 8.5), completedAtMs: world.now, skippedDates: 1 },
    ] });
  });
});

it('Shows the newly verified Google grant when Calendar Settings reopens (spec/app/settings/index.md, "Each page links to what another area owns there")', async () => {
  const world = morning(false);
  world.inbox.google = { email: "owner@alpha.test", connection: "google-owner", capabilities: ["google.calendar.read"] };
  const { alpha } = await open(world, only("view:Settings"));
  await drawn(() => alpha.runtime.runPromise(Shell.use((shell) => shell.send({ type: "openView", view: "Settings" }))));
  await until(alpha, alpha.runtime, Settings, (state) => state.page === "Top");
  await press("Apps");
  await press("Calendar");
  await vi.waitFor(() => expect(calendarSettings()?.textContent).toContain("Google CalendarFinish setup"));

  await press("Back to Apps");
  await until(alpha, alpha.runtime, Settings, (state) => state.page === "Apps");
  world.inbox.google = { email: "owner@alpha.test", connection: "google-owner", capabilities: ["google.calendar.read", "google.calendar.write"] };
  await press("Calendar");
  await vi.waitFor(() => expect(calendarSettings()?.textContent).toContain("Google CalendarConnected"));
  expect(calendarSettings()?.textContent).not.toContain("Finish setup");
  expect(world.calendar.writes).toEqual([]);
});

describe.each([["a browser", false], ["a phone", true]])("in %s", (_where, phone) => {
  it("See my days (spec/app/calendar/index.md, \"Story: See my days\"; spec/app/calendar/index.md, \"Story: Move through the days\")", async () => {
    const world = morning(phone);
    world.calendar.granted = phone;
    // spec/app/calendar/index.md, "Connecting an account reads the day from Google; disconnecting takes its rows away at once"
    const { alpha, runtime } = await mountCalendar(world, only("view:Calendar"), (s) => s.connected && s.google.status === "Loaded" && s.googleRows === 2);

    // spec/app/calendar/index.md, "What Android answers replaces what Calendar believed; granted, the day is read, withdrawn, the phone's rows go": only a phone has a calendar of its own, read once Android grants it, and no notice asks for it.
    if (phone) await until(alpha, runtime, View, (s) => s.phoneRows === 1);
    expect([titles(), Boolean(button("Allow")), world.calendar.asked]).toEqual([phone ? ["Standup", "Team lunch", "Gym"] : ["Standup", "Team lunch"], false, 0]);

    // spec/app/calendar/index.md, "Picking a day in the week strip or the month dialog shows that day's timeline"
    const later = world.today + 2;
    await press(dayButton(later));
    await until(alpha, runtime, View, (s) => s.anchor === later && s.google.status === "Loaded");
    expect(titles()).toEqual(["Dentist"]);

    // spec/app/calendar/index.md, "Today comes back to today"
    await press("Today");
    await until(alpha, runtime, View, (s) => s.anchor === world.today && s.google.status === "Loaded");
    expect(titles()).toEqual(phone ? ["Standup", "Team lunch", "Gym"] : ["Standup", "Team lunch"]);

    // spec/app/calendar/index.md, "A day is empty only when every source it may read answered whole with nothing, no calendar is hidden, and there are no reminders": a browser, which may not read the phone, still calls tomorrow empty.
    await press(dayButton(world.today + 1));
    await until(alpha, runtime, View, (s) => s.anchor === world.today + 1 && s.google.status === "Loaded" && (!phone || s.phone.status === "Loaded"));
    expect([titles(), Boolean(document.body.textContent?.includes("Free all day"))]).toEqual([[], true]);
    await press("Today");
    await until(alpha, runtime, View, (s) => s.anchor === world.today && s.google.status === "Loaded");

    // spec/app/calendar/index.md, "Choosing a layout closes the menu, and the agenda goes back to today"; spec/app/calendar/presentation.md, "A read for a day covers the month before it through the month after next": the agenda lists what is coming, not only today.
    await widen(alpha, runtime);
    await chooseDate();
    await until(alpha, runtime, View, (s) => s.overlay === "MonthDialog");
    await press("Schedule");
    await until(alpha, runtime, View, (s) => s.layout === "Agenda" && s.overlay === "NoOverlay");
    expect(titles()).toEqual(phone ? ["Standup", "Team lunch", "Gym", "Dentist"] : ["Standup", "Team lunch", "Dentist"]);

    // spec/app/calendar/index.md, "An event opens from the rows shown, with what it offers"; spec/app/calendar/index.md, "Back closes one layer at a time: the form, the delete review, the event, then the overlay"; spec/app/calendar/index.md, "The video call is joined, and the event opened in Android Calendar, only from the event shown"; spec/app/calendar/presentation.md, "The people list says Organizer or Alpha's word for each reply, never the provider's value"
    await tap("Team lunch");
    await until(alpha, runtime, View, (s) => s.open !== 0 && s.place && !s.video && s.web && !s.local);
    expect([Boolean(button("Open Cafe in Maps")), Boolean(button("Join video call")), Boolean(button("Open in Google Calendar")), Boolean(button("Open in Android Calendar"))]).toEqual([true, false, true, false]);
    expect([Boolean(document.body.textContent?.includes("Organizer")), Boolean(document.querySelector("[aria-label='You']"))]).toEqual([true, false]);
    await hardware("back");
    await until(alpha, runtime, View, (s) => s.open === 0);
    expect((await alpha.runtime.runPromise(Shell.use((shell) => shell.get()))).trail).toEqual(["Calendar"]);
  });
});

describe("on a phone", () => {
  it("Look at an event (spec/app/calendar/index.md, \"Story: Look at an event\")", async () => {
    const world = morning(true);
    world.calendar.granted = true;
    world.calendar.summary = "Family";
    const { alpha, runtime } = await mountCalendar(world, only("view:Calendar"), (s) => s.googleRows === 2 && s.phoneRows === 1);

    // spec/app/calendar/index.md, "The event's place opens in Maps, and coming back from Maps or Android Calendar reads the event again"; spec/app/calendar/index.md, "An event comes back only if an exact read finds it as it was left; otherwise it closes"
    await tap("Team lunch");
    // spec/app/calendar/presentation.md, "The agent's calendar goes by the name the agent lists for it": v119 45f6bed30 prototype/agent-calendar-adapter.ts:273 named the event's calendar by its source's summary.
    await vi.waitFor(() => expect(document.querySelector("[data-alpha-subview=calendar-detail]")?.textContent).toContain("Family"));
    await press("Open Cafe in Maps");
    await until(alpha, runtime, View, (s) => s.detail === "InMaps");
    expect((await alpha.runtime.runPromise(Shell.use((shell) => shell.get()))).trail).toEqual(["Calendar", "Maps"]);
    expect(localStorage.getItem(mapsHandoffKey)).toContain("Cafe");
    await hardware("back");
    await until(alpha, runtime, View, (s) => s.detail === "Showing" && s.open !== 0 && s.event.status === "Loaded");

    // spec/app/calendar/index.md, "An event comes back only if an exact read finds it as it was left; otherwise it closes": the lunch was cancelled while the owner was in Maps.
    await press("Open Cafe in Maps");
    await until(alpha, runtime, View, (s) => s.detail === "InMaps");
    world.calendar.events = world.calendar.events.filter((event) => event.title !== "Team lunch");
    await hardware("back");
    await until(alpha, runtime, View, (s) => s.open === 0 && s.event.status === "Failed");
  });

  it("Write an event (spec/app/calendar/editor.md, \"Story: Write an event\"; spec/app/calendar/editor.md, \"Story: Never create an event twice\"; spec/app/calendar/editor.md, \"Story: Delete an event, or answer an invitation\")", async () => {
    const world = morning(true);
    world.calendar.granted = true;
    const { alpha, runtime } = await mountCalendar(world, only("view:Calendar", "notice"), (s) => s.phoneRows === 1);

    // spec/app/calendar/editor.md, "Saving sends the form once, as a new numbered write built on the revision its edits began from"; spec/app/calendar/writing.md, "Save is off while loading, while saving, for another account, for an event that changed, without a title, with no calendar to take a new event, and for the phone's calendar once Android said no, in that order"
    await press("New event");
    await until(alpha, runtime, Editor, (e) => e.shown && e.form === "NewEvent" && e.receipts.status === "Loaded");
    await fill("Location", "Corner");
    await until(alpha, runtime, Editor, (e) => e.draft.edits === 1);
    expect(button("Save event")?.getAttribute("aria-disabled")).toBe("true");
    await fill("Title", "Coffee");
    await until(alpha, runtime, Editor, (e) => e.draft.edits === 2 && e.kept && e.titled);
    await press("This phone's calendar");
    await press("Save event");
    await until(alpha, runtime, Editor, (e) => e.form === "NoForm" && e.write.outcome === "Confirmed");
    await until(alpha, runtime, View, (s) => s.phoneRows === 2);
    expect([world.calendar.phoneEvents.map((event) => event.title), titles()]).toEqual([["Gym", "Coffee"], ["Coffee", "Standup", "Team lunch", "Gym"]]);

    // spec/app/calendar/editor.md, "An event ends after it starts": an all-day event sends a positive, UTC-midnight-bounded span
    await press("New event");
    await until(alpha, runtime, Editor, (e) => e.shown && e.receipts.status === "Loaded");
    await fill("Title", "Away for the day");
    await press("All day");
    await until(alpha, runtime, Editor, (e) => e.titled && e.allDay && e.kept);
    await press("Save event");
    await until(alpha, runtime, Editor, (e) => e.form === "NoForm" && e.write.outcome === "Confirmed");
    expect(world.calendar.events.find(({ title }) => title === "Away for the day")).toMatchObject({
      isAllDay: true, startAt: "2026-11-24T00:00:00.000Z", endAt: "2026-11-25T00:00:00.000Z",
    });

    // spec/app/calendar/writing.md, "Guests, alerts and video rooms go to Android Calendar; zones, all-day and repeats use the direct save for a new event": Android keeps those options on the local row
    await press("New event");
    await until(alpha, runtime, Editor, (e) => e.shown && e.receipts.status === "Loaded");
    await fill("Title", "Office closure");
    await press("All day");
    // spec/app/calendar/writing.md, "The form offers with the agent's calendar only what it holds, and keeps the calendar chosen": v119 45f6bed30 prototype/template.html:1423-1497 shows Video link, Repeat and Alert on every new event of this phone's calendar, and the live adapter left them off the agent's calendar, not dimmed (45f6bed30 prototype/agent-calendar-adapter.ts:312, :328).
    const agentChosen = () => button("Eliza Calendar")?.getAttribute("aria-pressed") === "true";
    const options = ["Once", "Daily", "Weekdays", "Weekly", "Video link", "None", "At start", "10 min", "1 hour"];
    const drawnOptions = () => options.filter((name) => button(name) !== undefined);
    const offered = () => options.map((name) => button(name)?.disabled);
    await until(alpha, runtime, Editor, (e) => e.titled && e.allDay && e.kept);
    expect([agentChosen(), drawnOptions()]).toEqual([true, []]);
    expect([button("Save event")?.getAttribute("aria-disabled"), Boolean(button("Open in Android Calendar"))]).toEqual(["false", false]);
    // spec/app/calendar/writing.md, "The form offers with the agent's calendar only what it holds, and keeps the calendar chosen": on this phone's calendar every repeat, the video link and the alerts are offered; going back to the agent's sets them back and leaves them off.
    await press("This phone's calendar");
    expect(offered()).toEqual(options.map(() => false));
    await press("Weekdays");
    await press("Video link");
    await press("10 min");
    await until(alpha, runtime, Editor, (e) => e.extras);
    await press("Eliza Calendar");
    await until(alpha, runtime, Editor, (e) => !e.extras);
    expect([agentChosen(), drawnOptions()]).toEqual([true, []]);
    expect(button("Save event")?.getAttribute("aria-disabled")).toBe("false");
    await press("This phone's calendar");
    await press("Weekdays");
    expect(button("This phone's calendar")?.getAttribute("aria-pressed")).toBe("true");
    await press("Save event");
    await until(alpha, runtime, Editor, (e) => e.form === "NoForm" && e.write.outcome === "Confirmed");
    await until(alpha, runtime, View, (state) => state.phoneRows === 3);
    expect(world.calendar.phoneEvents.find(({ title }) => title === "Office closure")).toMatchObject({
      allDay: true, recurring: true, begin: Date.UTC(2026, 10, 24), end: Date.UTC(2026, 10, 25),
    });
    expect(button("Office closure, All day")).toBeDefined();

    // spec/app/calendar/editor.md, "Story: Hand Android Calendar what Alpha cannot write": the handoff carries the requested alert and writes nothing
    await press("New event");
    await fill("Title", "Briefing");
    await press("This phone's calendar");
    await press("Video link");
    await until(alpha, runtime, Editor, (e) => e.extras);
    await press("10 min");
    await press("Video link");
    await press("Open in Android Calendar");
    await until(alpha, runtime, Editor, (e) => e.form === "NoForm");
    await vi.waitFor(() => expect(world.calendar.handoffs).toMatchObject([{ title: "Briefing", alerts: [10] }]));
    expect(world.calendar.phoneEvents.map((event) => event.title)).toEqual(["Gym", "Coffee", "Office closure"]);
    expect(world.calendar.events.some((event) => event.title === "Briefing")).toBe(false);

    // spec/app/calendar/editor.md, "While a create is in doubt its form waits; checking the phone's receipts finds it or not": the phone made the event and could not say so.
    world.calendar.lost = true;
    await press("New event");
    await fill("Title", "Walk");
    await press("This phone's calendar");
    await press("Save event");
    await until(alpha, runtime, Editor, (e) => e.unknownCreate && e.draft.sync === "Saving" && e.write.outcome === "Unknown");
    expect(button("Save event")?.getAttribute("aria-disabled")).toBe("true");
    await press("Check if events were saved");
    await until(alpha, runtime, Editor, (e) => !e.unknownCreate && e.form === "NoForm");
    await until(alpha, runtime, View, (s) => s.form === "NoFormShown");
    expect(world.calendar.phoneEvents.filter((event) => event.title === "Walk").length).toBe(1);

    // spec/app/calendar/editor.md, "A delete names which occurrences, and only a repeating event offers more than this one"
    world.calendar.lost = false;
    await tap("Gym");
    await until(alpha, runtime, View, (s) => s.open !== 0);
    await openEventActions();
    expect(Boolean(menuItem("Delete the series"))).toBe(false);
    // spec/app/calendar/deletions.md, "Delete asks first, over the open event: what goes, from which calendar, when, which occurrences, and that no guest is told": a one-off event with no guests gets Yes or No; No keeps it.
    const deleteItem = menuItem("Delete");
    if (!deleteItem) throw new Error("no menuitem Delete");
    await drawn(() => deleteItem.click());
    await until(alpha, runtime, Held, (d) => d.asked !== 0);
    expect([Boolean(button("Yes")), Boolean(button("No")), document.body.textContent?.includes("Undo available for 10 seconds")]).toEqual([true, true, true]);
    await press("No");
    await until(alpha, runtime, Held, (d) => d.asked === 0 && d.waiting === 0);
    // spec/app/calendar/deletions.md, "Confirming the review holds the deletion; a deletion still waiting is sent first, so the only Undo shown is the newest"; spec/app/calendar/deletions.md, "Undo inside the window sends nothing, and shows the event again"
    await deleteOpenEvent(alpha, runtime);
    expect(titles()).not.toContain("Gym");
    await press("Undo");
    await until(alpha, runtime, Held, (d) => d.waiting === 0 && d.undo.holding === "Undone");
    await until(alpha, runtime, View, (s) => s.open === 0 && !s.review);
    expect([titles().includes("Gym"), world.calendar.phoneEvents.map((event) => event.title).includes("Gym")]).toEqual([true, true]);

    // spec/app/calendar/deletions.md, "The window ends only once its Undo notice is no longer shown"; spec/app/calendar/deletions.md, "A refused send shows the event again and says it was not deleted, and whether it changed; a sent deletion hides it until a read no longer has it unchanged"
    await tap("Gym");
    await until(alpha, runtime, View, (s) => s.open !== 0);
    vi.useFakeTimers({ toFake: ["performance"] });
    await chooseEventAction("Delete");
    await until(alpha, runtime, Held, (d) => d.asked !== 0);
    await press("Yes");
    await later(alpha, 6_000);
    await later(alpha, 10_000);
    await finishPhoneDelete(alpha, runtime);
    await until(alpha, runtime, Held, (d) => d.sending === 0 && d.undo.holding === "Released");
    expect(world.calendar.phoneEvents.map((event) => event.title)).not.toContain("Gym");
  });

  async function queueDeletion(alpha: Alpha, runtime: ReturnType<typeof calendar.runtime>, title: string, action = "Delete") {
    await tap(title);
    await until(alpha, runtime, View, (s) => s.open !== 0);
    await deleteOpenEvent(alpha, runtime, action);
  }

  /** Open Alpha again on `world` with Calendar in front, once `ready` holds on its view. */
  async function startAgain(world: ReturnType<typeof morning>, ready: (state: CalendarView) => boolean) {
    const started = await open(world, only("view:Calendar", "notice"));
    const runtime = calendar.runtime(started.alpha);
    await until(started.alpha, runtime, View, (s) => s.front && ready(s));
    return { ...started, runtime };
  }

  async function reopenCalendar(world: ReturnType<typeof morning>, pausedTitle?: string) {
    const reopened = await open(world, only("view:Calendar", "notice"));
    const runtime = calendar.runtime(reopened.alpha);
    await until(reopened.alpha, runtime, View, (s) => s.front && s.phone.status === "Loaded" && s.google.status === "Loaded");
    if (pausedTitle !== undefined) {
      await until(reopened.alpha, runtime, Held, (d) => d.paused);
      expect(document.body.textContent).toContain(`Alpha restarted before deleting ${pausedTitle}.`);
    }
    return { ...reopened, runtime };
  }

  async function openGrantedGymDeletion() {
    const world = morning(true);
    world.calendar.granted = true;
    const first = await mountCalendar(world, only("view:Calendar", "notice"), (s) => s.phoneRows === 1 && s.google.status === "Loaded");
    await queueDeletion(first.alpha, first.runtime, "Gym");
    return { world, first };
  }

  /** Let the phone's own window for a staged deletion pass, on the fake performance clock, then go back to real timers. */
  async function letStagedWindowPass(alpha: Alpha) {
    await drawn(() => {});
    vi.advanceTimersByTime(20_000);
    await later(alpha, 10_000);
    vi.useRealTimers();
  }

  async function finishPhoneDelete(alpha: Alpha, runtime: ReturnType<typeof calendar.runtime>) {
    await until(alpha, runtime, Editor, (e) => e.kind === "Remove" && e.write.outcome === "Sent");
    await letStagedWindowPass(alpha);
    await until(alpha, runtime, Editor, (e) => e.kind === "Remove" && e.write.outcome === "Confirmed");
  }

  function failNumbersRead(world: ReturnType<typeof morning>) {
    const getItem = localStorage.getItem.bind(localStorage);
    const spy = vi.spyOn(localStorage, "getItem").mockImplementation((key: string) => {
      if (key === "alpha.calendar.numbers") throw new Error("the store could not be read");
      return getItem(key);
    });
    asleep(world, 60_000);
    return spy;
  }

  function addExtraPhoneEvents(world: ReturnType<typeof morning>) {
    world.calendar.phoneEvents.unshift(
      { id: "p2", calendarId: "local", title: "Piano", begin: world.at(0, 16), end: world.at(0, 17), allDay: false, recurring: false },
      { id: "p3", calendarId: "local", title: "Walk", begin: world.at(0, 17), end: world.at(0, 18), allDay: false, recurring: false },
    );
  }

  it(`A deletion confirmed in front is sent, though the owner then leaves Alpha or locks the phone before it goes (spec/app/calendar/deletions.md, "Confirming the review holds the deletion; a deletion still waiting is sent first, so the only Undo shown is the newest")`, async () => {
    const world = morning(true);
    world.calendar.granted = true;
    addExtraPhoneEvents(world);
    const { alpha, runtime } = await mountCalendar(world, only("view:Calendar", "notice"), (s) => s.phoneRows === 3 && s.google.status === "Loaded");
    const written = () => runtime.runPromise(Effect.flatMap(Editor, (e) => e.get()));
    const sendAfterLeaving = async (title: string, meanwhile: () => void = () => {}) => {
      const before = (await written()).write.id;
      vi.useFakeTimers({ toFake: ["performance"] });
      await queueDeletion(alpha, runtime, title);
      await seen(false);
      meanwhile();
      await until(alpha, runtime, Editor, (e) => e.kind === "Remove" && e.write.id > before);
      await letStagedWindowPass(alpha);
      await until(alpha, runtime, Editor, (e) => e.kind === "Remove" && e.write.id > before && e.write.outcome !== "Sent");
      await seen(true);
      return (await written()).write.outcome;
    };
    expect([await sendAfterLeaving("Gym"), world.calendar.phoneEvents.map((event) => event.title)]).toEqual(["Confirmed", ["Piano", "Walk"]]);
    // spec/app/calendar/deletions.md, "A refused send shows the event again and says it was not deleted, and whether it changed; a sent deletion hides it until a read no longer has it unchanged": the phone still refuses what it reviewed once the event changed while Alpha was away.
    const piano = world.calendar.phoneEvents.find((event) => event.title === "Piano");
    expect([await sendAfterLeaving("Piano", () => { if (piano) piano.title = "Piano lesson"; }), world.calendar.phoneEvents.map((event) => event.title)]).toEqual([expect.not.stringMatching(/^Confirmed$/), ["Piano lesson", "Walk"]]);
  });

  it("A deletion a restart paused is for the event the owner confirmed, though the phone's calendar gained events before it (spec/app/calendar/deletions.md, \"A restart pauses a deletion still in its window; the owner sends it or keeps the event\")", async () => {
    const { world, first } = await openGrantedGymDeletion();
    await first.close();

    addExtraPhoneEvents(world);
    const second = await open(world, only("view:Calendar", "notice"));
    const { alpha } = second;
    const runtime = calendar.runtime(alpha);
    await until(alpha, runtime, View, (s) => s.front && s.phoneRows === 3 && s.google.status === "Loaded");
    await until(alpha, runtime, Held, (d) => d.paused);
    expect(document.body.textContent).toContain("Alpha restarted before deleting Gym.");
    vi.useFakeTimers({ toFake: ["performance"] });
    await press("Delete");
    await finishPhoneDelete(alpha, runtime);
    await until(alpha, runtime, Held, (d) => d.sending === 0 && d.waiting === 0 && d.undo.holding === "Released");
    expect(world.calendar.phoneEvents.map((event) => event.title)).toEqual(["Piano", "Walk"]);

    // spec/app/calendar/deletions.md, "A restart pauses a deletion still in its window; the owner sends it or keeps the event": a deletion kept by a build that kept no numbers names no event, so it is kept unsent and Piano stays.
    await queueDeletion(alpha, runtime, "Piano");
    const form = await runtime.runPromise(Editor.use((e) => e.get()));
    await second.close();
    const kept = "alpha/app/calendar/deletions@1";
    localStorage.setItem(kept, JSON.stringify({ ...JSON.parse(localStorage.getItem(kept) ?? "{}"), waiting: 1 }));
    localStorage.setItem("alpha/app/calendar/editor@1", JSON.stringify({ ...form, latched: [7] }));
    localStorage.removeItem("alpha.calendar.numbers");
    const upgraded = await open(world, only("view:Calendar", "notice"));
    const after = calendar.runtime(upgraded.alpha);
    await until(upgraded.alpha, after, View, (s) => s.front && s.phoneRows === 2 && s.google.status === "Loaded");
    await until(upgraded.alpha, after, Held, (d) => d.waiting === 0 && d.undo.holding === "Undone" && !d.paused);
    expect([document.body.textContent?.includes("Alpha restarted before deleting"), Boolean(button(/^Piano/)), world.calendar.phoneEvents.map((event) => event.title)]).toEqual([false, true, ["Piano", "Walk"]]);
    // spec/app/calendar/editor.md, "A read of the event releases the doubt; a form waiting on it then shows the event as it now is": a doubt kept under a number that names no event can never be read back, so it is let go.
    expect((await after.runPromise(Editor.use((e) => e.get()))).latched).toEqual([]);

    // spec/app/calendar/deletions.md, "A refused send shows the event again and says it was not deleted, and whether it changed; a sent deletion hides it until a read no longer has it unchanged": Walk changed on the phone after the owner confirmed its deletion, so it is not deleted.
    await queueDeletion(upgraded.alpha, after, "Walk");
    const walk = world.calendar.phoneEvents.find((event) => event.title === "Walk");
    if (walk) walk.title = "Walk the dog";
    await after.runPromise(View.use((view) => view.send({ type: "refresh" })));
    await until(upgraded.alpha, after, View, (s) => s.phone.status === "Loaded");
    vi.useFakeTimers({ toFake: ["performance"] });
    await later(upgraded.alpha, 6_000);
    await later(upgraded.alpha, 10_000);
    await drawn(() => {});
    vi.advanceTimersByTime(20_000);
    await later(upgraded.alpha, 10_000);
    vi.useRealTimers();
    await until(upgraded.alpha, after, Held, (d) => d.sending === 0 && d.failed !== 0 && d.changed);
    expect([Boolean(button(/^Walk the dog/)), world.calendar.phoneEvents.map((event) => event.title)]).toEqual([true, ["Piano", "Walk the dog"]]);

    // spec/app/calendar/deletions.md, "Deletions hold the owner they are for, the deletion under review, the one waiting with its Undo window and whether its notice shows, the one being sent, and the one sent that a read has yet to confirm": kept numbers the phone can no longer read are set aside, never written over, and Calendar reads on.
    await upgraded.close();
    localStorage.setItem("alpha.calendar.numbers", "{");
    const unread = await open(world, only("view:Calendar", "notice"));
    await until(unread.alpha, calendar.runtime(unread.alpha), View, (s) => s.front && s.phoneRows === 2);
    expect([localStorage.getItem("alpha.calendar.numbers.unreadable"), Boolean(button(/^Piano/))]).toEqual(["{", true]);

    // spec/app/calendar/deletions.md, "Deletions hold the owner they are for, the deletion under review, the one waiting with its Undo window and whether its notice shows, the one being sent, and the one sent that a read has yet to confirm": kept numbers the store failed to read are never written over.
    await unread.close();
    const numbers = localStorage.getItem("alpha.calendar.numbers");
    const failing = failNumbersRead(world);
    const failed = await open(world, only("view:Calendar", "notice"));
    await until(failed.alpha, calendar.runtime(failed.alpha), View, (s) => s.front && s.phoneRows === 2);
    failing.mockRestore();
    expect([localStorage.getItem("alpha.calendar.numbers"), Boolean(button(/^Piano/))]).toEqual([numbers, true]);
  });

  it(`Two starts that cannot read the kept numbers never give one number to two events (spec/app/calendar/editor.md, "Story: Keep my draft through a restart")`, async () => {
    const world = morning(true);
    world.calendar.granted = true;
    localStorage.setItem("alpha.calendar.numbers", "{");
    const first = await mountCalendar(world, only("view:Calendar", "notice"), (s) => s.phoneRows === 1 && s.google.status === "Loaded");
    await tap("Gym");
    await until(first.alpha, first.runtime, View, (s) => s.open !== 0);
    await chooseEventAction("Edit event");
    await until(first.alpha, first.runtime, Editor, (e) => e.shown && e.form === "EditEvent");
    await fill("Title", "Gym class");
    await until(first.alpha, first.runtime, Editor, (e) => e.draft.edits >= 1 && e.kept);
    await hardware("home");
    await later(first.alpha, 100);
    await until(first.alpha, first.runtime, Editor, (e) => !e.shown && e.banner === "Available");
    await first.close();

    localStorage.setItem("alpha.calendar.numbers", "{");
    asleep(world, 60_000);
    addExtraPhoneEvents(world);
    const second = await mountCalendar(world, only("view:Calendar", "notice"), (s) => s.phoneRows === 3 && s.google.status === "Loaded");
    await press("Resume event draft");
    await until(second.alpha, second.runtime, Editor, (e) => e.shown && e.form === "EditEvent");
    await press("Save event");
    await until(second.alpha, second.runtime, Editor, (e) => e.write.id !== 0 && e.write.outcome !== "Sent");
    expect(world.calendar.phoneEvents.map((event) => event.title)).toEqual(["Piano", "Walk", "Gym"]);
  });

  it(`A deletion and a doubt kept across a start that could not read the kept numbers are kept as they were (spec/app/calendar/deletions.md, "A restart pauses a deletion still in its window; the owner sends it or keeps the event"; spec/app/calendar/editor.md, "A read of the event releases the doubt; a form waiting on it then shows the event as it now is")`, async () => {
    const { world, first } = await openGrantedGymDeletion();
    const gym = (await first.runtime.runPromise(Held.use((d) => d.get()))).waiting;
    const standup = shown.all("Google").find((row) => row.title === "Standup")?.id ?? 0;
    const form = await first.runtime.runPromise(Editor.use((e) => e.get()));
    await first.close();
    localStorage.setItem("alpha/app/calendar/editor@1", JSON.stringify({ ...form, latched: [gym] }));
    const deletions = "alpha/app/calendar/deletions@1";
    localStorage.setItem(deletions, JSON.stringify({ ...JSON.parse(localStorage.getItem(deletions) ?? "{}"), hiding: standup }));
    const numbers = localStorage.getItem("alpha.calendar.numbers");

    const failing = failNumbersRead(world);
    const second = await startAgain(world, (s) => s.phoneRows === 1 && s.google.status === "Loaded");
    const unread = second.runtime;
    await later(second.alpha, 100);
    failing.mockRestore();
    const held = await unread.runPromise(Held.use((d) => d.get()));
    expect([held.waiting, held.paused, held.undo.holding, held.hiding, (await unread.runPromise(Editor.use((e) => e.get()))).latched, localStorage.getItem("alpha.calendar.numbers")]).toEqual([gym, true, "Held", standup, [gym], numbers]);
    await second.close();

    asleep(world, 60_000);
    const third = await startAgain(world, (s) => s.phoneRows === 1 && s.google.status === "Loaded");
    await until(third.alpha, third.runtime, Held, (d) => d.paused && d.waiting === gym);
    expect(document.body.textContent).toContain("Alpha restarted before deleting Gym.");
  });

  it(`Kept numbers JavaScript cannot hold exactly are set aside, and each event keeps a number of its own (spec/app/calendar/deletions.md, "Deletions hold the owner they are for, the deletion under review, the one waiting with its Undo window and whether its notice shows, the one being sent, and the one sent that a read has yet to confirm")`, async () => {
    const world = morning(true);
    world.calendar.granted = true;
    world.calendar.phoneEvents.push({ id: "p2", calendarId: "local", title: "Piano", begin: world.at(0, 16), end: world.at(0, 17), allDay: false, recurring: false });
    const unsafe = `{"last":${2 ** 60},"numbers":[["Phone:p1",${2 ** 60}]]}`;
    localStorage.setItem("alpha.calendar.numbers", unsafe);
    await mountCalendar(world, only("view:Calendar", "notice"), (s) => s.phoneRows === 2);
    const ids = shown.all("Phone").map((row) => row.id);
    expect([localStorage.getItem("alpha.calendar.numbers.unreadable"), new Set(ids).size, ids.every((id) => Number.isSafeInteger(id))]).toEqual([unsafe, 2, true]);
  });

  it(`Numbering long after 2109, or after a clock set far ahead, still gives each event a number of its own (spec/app/calendar/deletions.md, "Deletions hold the owner they are for, the deletion under review, the one waiting with its Undo window and whether its notice shows, the one being sent, and the one sent that a read has yet to confirm")`, async () => {
    const world = morning(true);
    world.calendar.granted = true;
    const ahead = 2 ** 43;
    world.now = ahead;
    world.calendar.phoneEvents = ["Gym", "Piano"].map((title, at) => ({ id: `p${at + 1}`, calendarId: "local", title, begin: ahead + (at + 1) * hour, end: ahead + (at + 2) * hour, allDay: false, recurring: false }));
    await mountCalendar(world, only("view:Calendar", "notice"), (s) => s.phone.status === "Loaded" && shown.all("Phone").length === 2);
    const ids = shown.all("Phone").map((row) => row.id);
    expect([new Set(ids).size, ids.every((id) => Number.isSafeInteger(id))]).toEqual([2, true]);
  });

  it(`Past 2109, a start that could not read the kept numbers never gives an event the number a kept deletion names (spec/app/calendar/deletions.md, "A restart pauses a deletion still in its window; the owner sends it or keeps the event")`, async () => {
    const world = morning(true);
    world.calendar.granted = true;
    const ahead = 2 ** 43;
    world.now = ahead;
    world.calendar.phoneEvents = [{ id: "p1", calendarId: "local", title: "Gym", begin: ahead + 2 * hour, end: ahead + 3 * hour, allDay: false, recurring: false }];
    const first = await mountCalendar(world, only("view:Calendar", "notice"), (s) => s.phone.status === "Loaded" && shown.all("Phone").length === 1);
    await first.close();

    world.calendar.phoneEvents = [{ id: "p2", calendarId: "local", title: "Walk", begin: ahead + hour, end: ahead + 2 * hour, allDay: false, recurring: false }, ...world.calendar.phoneEvents];
    const failing = failNumbersRead(world);
    const second = await startAgain(world, (s) => s.phone.status === "Loaded" && shown.all("Phone").length === 2);
    await queueDeletion(second.alpha, second.runtime, "Walk");
    await second.close();
    failing.mockRestore();

    asleep(world, 60_000);
    const third = await startAgain(world, (s) => s.phone.status === "Loaded" && shown.all("Phone").length === 2);
    await later(third.alpha, 100);
    const held = await third.runtime.runPromise(Held.use((d) => d.get()));
    expect([held.waiting, held.undo.holding, document.body.textContent?.includes("Alpha restarted before deleting"), world.calendar.phoneEvents.map((event) => event.title)]).toEqual([0, "Undone", false, ["Walk", "Gym"]]);
  });

  it(`A doubt and a hide are let go only by a whole read of the day their event was last seen on (spec/app/calendar/editor.md, "A read of the event releases the doubt; a form waiting on it then shows the event as it now is"; spec/app/calendar/deletions.md, "A refused send shows the event again and says it was not deleted, and whether it changed; a sent deletion hides it until a read no longer has it unchanged")`, async () => {
    const world = morning(true);
    world.calendar.granted = true;
    world.calendar.phoneEvents.push({ id: "p9", calendarId: "local", title: "Optician", begin: world.at(-24, 10), end: world.at(-24, 11), allDay: false, recurring: false });
    const first = await mountCalendar(world, only("view:Calendar", "notice"), (s) => s.phone.status === "Loaded" && s.google.status === "Loaded");
    const standup = shown.all("Google").find((row) => row.title === "Standup")?.id ?? 0;
    const optician = shown.all("Phone").find((row) => row.title === "Optician")?.id ?? 0;
    const form = await first.runtime.runPromise(Editor.use((e) => e.get()));
    await first.close();
    const deletions = "alpha/app/calendar/deletions@1";
    localStorage.setItem("alpha/app/calendar/editor@1", JSON.stringify({ ...form, latched: [standup, optician] }));
    localStorage.setItem(deletions, JSON.stringify({ ...JSON.parse(localStorage.getItem(deletions) ?? "{}"), hiding: standup }));

    // spec/app/calendar/index.md, "A read the phone cut short, or Google gave only in part, is shown as limited, never as complete": a part of Google's day without Standup is no sign it went.
    world.calendar.events = world.calendar.events.filter((event) => event.title !== "Standup");
    world.calendar.feedState = "partial";
    // spec/app/calendar/presentation.md, "A read for a day covers the month before it through the month after next": anchored on 1 December, the read begins on 1 November, and never sees the Optician on 31 October.
    asleep(world, 7 * 24 * hour);
    const second = await startAgain(world, (s) => s.phone.status === "Loaded" && s.google.status === "Loaded" && s.googleLimited);
    await later(second.alpha, 100);
    expect([(await second.runtime.runPromise(Editor.use((e) => e.get()))).latched, (await second.runtime.runPromise(Held.use((d) => d.get()))).hiding]).toEqual([[standup, optician], standup]);
  });

  it(`An earlier build reads the numbers this one keeps (spec/app/calendar/deletions.md, "Deletions hold the owner they are for, the deletion under review, the one waiting with its Undo window and whether its notice shows, the one being sent, and the one sent that a read has yet to confirm")`, async () => {
    const world = morning(true);
    world.calendar.granted = true;
    const { alpha } = await mountCalendar(world, only("view:Calendar", "notice"), (s) => s.phoneRows === 1 && s.google.status === "Loaded");
    await later(alpha, 100);
    const earlier = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ last: Schema.Number, numbers: Schema.Array(Schema.Tuple([Schema.String, Schema.Number])) })));
    const read = await Effect.runPromise(Effect.match(earlier(localStorage.getItem("alpha.calendar.numbers") ?? ""), { onFailure: () => undefined, onSuccess: (kept) => kept.numbers.map(([name]) => name) }));
    expect(read ?? []).toContain("Phone:p1");
  });

  it(`A doubt whose event went while Alpha was closed is let go by the first read that shows it gone (spec/app/calendar/editor.md, "A read of the event releases the doubt; a form waiting on it then shows the event as it now is")`, async () => {
    const world = morning(true);
    world.calendar.granted = true;
    const first = await mountCalendar(world, only("view:Calendar", "notice"), (s) => s.phoneRows === 1 && s.google.status === "Loaded");
    const gym = shown.all("Phone").find((row) => row.title === "Gym")?.id ?? 0;
    const form = await first.runtime.runPromise(Editor.use((e) => e.get()));
    await first.close();
    localStorage.setItem("alpha/app/calendar/editor@1", JSON.stringify({ ...form, latched: [gym] }));
    world.calendar.phoneEvents = world.calendar.phoneEvents.filter((event) => event.title !== "Gym");

    const second = await reopenCalendar(world);
    await later(second.alpha, 100);
    expect((await second.runtime.runPromise(Editor.use((e) => e.get()))).latched).toEqual([]);
  });

  it(`A repeating event that moved after the owner confirmed deleting one occurrence is not deleted (spec/app/calendar/deletions.md, "A refused send shows the event again and says it was not deleted, and whether it changed; a sent deletion hides it until a read no longer has it unchanged")`, async () => {
    const world = morning(true);
    world.calendar.granted = true;
    world.calendar.phoneEvents.push(...[-7, 0, 7].map((day) => ({ id: "p5", calendarId: "local", title: "Piano", begin: world.at(day, 16), end: world.at(day, 17), allDay: false, recurring: true })));
    const { alpha, runtime } = await mountCalendar(world, only("view:Calendar", "notice"), (s) => s.phoneRows === 2 && s.google.status === "Loaded");
    await queueDeletion(alpha, runtime, "Piano", "Delete this one");
    for (const event of world.calendar.phoneEvents) if (event.id === "p5") Object.assign(event, { begin: event.begin + hour, end: event.end + hour });
    await runtime.runPromise(View.use((view) => view.send({ type: "refresh" })));
    await until(alpha, runtime, View, (s) => s.phone.status === "Loaded");
    vi.useFakeTimers({ toFake: ["performance"] });
    await later(alpha, 6_000);
    await later(alpha, 10_000);
    await drawn(() => {});
    vi.advanceTimersByTime(20_000);
    await later(alpha, 10_000);
    vi.useRealTimers();
    await until(alpha, runtime, Held, (d) => d.sending === 0 && d.failed !== 0 && d.changed);
    expect(world.calendar.phoneEvents.filter((event) => event.id === "p5").map((event) => event.begin)).toEqual([world.at(-7, 17), world.at(0, 17), world.at(7, 17)]);
  });

  it("A deletion and an edit of the agent's events kept across a restart are for the event they were for (spec/app/calendar/deletions.md, \"A restart pauses a deletion still in its window; the owner sends it or keeps the event\"; spec/app/calendar/editor.md, \"Story: Keep my draft through a restart\")", async () => {
    const world = morning(true);
    world.calendar.granted = true;
    world.calendar.events.push(agentEvent("Review", world.at(0, 15), world.at(0, 16)));
    const first = await mountCalendar(world, only("view:Calendar", "notice"), (s) => s.phone.status === "Loaded" && s.google.status === "Loaded");
    await queueDeletion(first.alpha, first.runtime, "Standup");
    await first.close();

    const second = await reopenCalendar(world, "Standup");
    const { runtime } = second;
    await press("Delete");
    await until(second.alpha, runtime, Held, (d) => d.sending === 0 && d.waiting === 0 && d.undo.holding === "Released");
    await until(second.alpha, runtime, Editor, (e) => e.kind === "Remove" && e.write.outcome !== "Sent");
    expect([(await runtime.runPromise(Held.use((d) => d.get()))).failed, world.calendar.events.some((event) => event.title === "Standup")]).toEqual([0, false]);

    // spec/app/calendar/editor.md, "Story: Keep my draft through a restart": an edit of the agent's event set aside before a restart saves to that event, which did not change.
    await tap("Review");
    await until(second.alpha, runtime, View, (s) => s.open !== 0);
    await chooseEventAction("Edit event");
    await until(second.alpha, runtime, Editor, (e) => e.shown && e.form === "EditEvent");
    await fill("Title", "Review notes");
    await until(second.alpha, runtime, Editor, (e) => e.draft.edits >= 1 && e.kept);
    await hardware("home");
    await later(second.alpha, 100);
    await until(second.alpha, runtime, Editor, (e) => !e.shown && e.banner === "Available");
    await second.close();

    const third = await mountCalendar(world, only("view:Calendar", "notice"), (s) => s.phone.status === "Loaded" && s.google.status === "Loaded");
    await press("Resume event draft");
    await until(third.alpha, third.runtime, Editor, (e) => e.shown && e.form === "EditEvent");
    await press("Save event");
    await until(third.alpha, third.runtime, Editor, (e) => e.write.outcome !== "Sent" && e.write.id !== 0);
    expect([(await third.runtime.runPromise(Editor.use((e) => e.get()))).write.outcome, world.calendar.events.some((event) => event.title === "Review notes")]).toEqual(["Confirmed", true]);
  });

  it("Each occurrence of a repeating event on the phone is its own event: it opens as itself, and a restart never takes it for changed (spec/app/calendar/deletions.md, \"A restart pauses a deletion still in its window; the owner sends it or keeps the event\"; spec/app/calendar/index.md, \"Story: Look at an event\")", async () => {
    const world = morning(true);
    world.calendar.granted = true;
    world.calendar.phoneEvents.push(...[-7, 0, 7].map((day) => ({ id: "p5", calendarId: "local", title: "Piano", begin: world.at(day, 16), end: world.at(day, 17), allDay: false, recurring: true })));
    const first = await mountCalendar(world, only("view:Calendar", "notice"), (s) => s.phoneRows === 2 && s.google.status === "Loaded");
    // spec/app/calendar/index.md, "Story: Look at an event": today's occurrence opens, not the series' first.
    await tap("Piano");
    const opened = (await first.runtime.runPromise(View.use((v) => v.get()))).open;
    expect(shown.find(opened)?.begin).toBe(world.at(0, 16));
    await chooseEventAction("Delete this one");
    await until(first.alpha, first.runtime, Held, (d) => d.asked !== 0);
    await press("Yes");
    await until(first.alpha, first.runtime, Held, (d) => d.waiting !== 0 && d.notice);
    await first.close();

    const second = await reopenCalendar(world, "Piano");
    const { runtime } = second;
    vi.useFakeTimers({ toFake: ["performance"] });
    await press("Delete");
    await until(second.alpha, runtime, Editor, (e) => e.kind === "Remove" && e.write.id !== 0);
    await drawn(() => {});
    vi.advanceTimersByTime(20_000);
    await later(second.alpha, 10_000);
    vi.useRealTimers();
    await until(second.alpha, runtime, Editor, (e) => e.kind === "Remove" && e.write.outcome !== "Sent");
    const ended = await runtime.runPromise(Held.use((d) => d.get()));
    expect([ended.failed, ended.changed, (await runtime.runPromise(Editor.use((e) => e.get()))).write.outcome]).toEqual([0, false, "Confirmed"]);
    expect(world.calendar.phoneEvents.filter((event) => event.title === "Piano").map((event) => event.begin)).toEqual([world.at(-7, 16), world.at(7, 16)]);
  });

  it("Link a Google calendar I can write to, and be told it is synced only when it is (spec/app/calendar/link.md, \"Story: Link a Google calendar I can write to, and be told it is synced only when it is\"; spec/app/calendar/link.md, \"Story: Disconnect Google from Calendar without leaving sync running\")", async () => {
    const world = morning(true);
    world.calendar.granted = true;
    world.inbox.google = { email: "owner@alpha.test", connection: "google-owner", capabilities: ["google.basic_identity", "google.calendar.read"] };
    world.mailLease.held = false;
    const { alpha } = await open(world, only("view:Calendar"));
    const runtime = calendar.runtime(alpha);
    await openCalendar(alpha);
    await until(alpha, runtime, Link, (l) => l.owner > 0);
    await until(alpha, runtime, View, (s) => s.front && s.owner > 0);
    await fromMonth("Calendars");
    await until(alpha, runtime, View, (s) => s.overlay === "CalendarsSheet");

    // spec/app/platform/index.md, "A cloud request the phone holds back for want of a sign-in reads as the cloud's own 401": a phone signed in before mail leases existed cannot check Google yet.
    await until(alpha, runtime, Link, (l) => l.checked === "CheckFailed");
    expect([document.body.textContent?.includes("Couldn't check"), Boolean(button("Link Google Calendar"))]).toEqual([true, false]);

    // spec/app/platform/index.md, "The owner's tap on a mail sign-in control starts the phone's one more sign-in for mail where the phone wants it, then reads again once": once the phone holds the lease, signed in from Inbox, Calendar's next read checks Google again by itself.
    world.mailLease.held = true;
    await runtime.runPromise(View.use((view) => view.send({ type: "refresh" })));
    await until(alpha, runtime, Link, (l) => l.checked === "CheckedOk");

    // spec/app/calendar/link.md, "Setup starts only from a write grant, for the owner signed in; a read-only grant goes on to consent for more access, and a missing one sends nothing"
    await press("Link Google Calendar");
    await until(alpha, runtime, Link, (l) => l.ending === "NeedsGrant" && l.said === "ReadOnlyAccess");
    expect(world.calendar.writes).toEqual([]);

    // spec/app/calendar/link.md, "A write is sent only while the owner and the reviewed revision still hold, and its answer starts another review"; spec/app/calendar/link.md, "Synced needs a clean read back of the linked events; held or many conflicts are named"
    world.inbox.google = { email: "owner@alpha.test", connection: "google-owner", capabilities: ["google.basic_identity", "google.calendar.read", "google.calendar.write"] };
    await openCalendar(alpha);
    await until(alpha, runtime, View, (s) => s.front);
    if ((await runtime.runPromise(View.use((view) => view.get()))).overlay !== "CalendarsSheet") await fromMonth("Calendars");
    await press("Check again");
    await until(alpha, runtime, Link, (l) => l.phase === "Done" && l.ending === "Synced" && l.writes === 1 && l.linkReads === 1);
    expect(world.calendar.writes).toEqual(["sync select"]);
    expect(world.calendar.control.destination).toEqual({ connectorAccountId: "google-owner", providerCalendarId: "primary" });

    // spec/app/calendar/link.md, "A linked, unpaused destination is paused first at the revision just reviewed; the revoke never waits on it"; spec/app/calendar/link.md, "A pause is confirmed only when the control answered paused at a revision past the one reviewed"
    await press("Pause sync");
    await until(alpha, runtime, Link, (l) => l.pause === "PauseConfirmed");
    expect(world.calendar.control.paused).toBe(true);

    // spec/app/calendar/link.md, "Synced needs a clean read back of the linked events; held or many conflicts are named"
    world.calendar.control.links.push("conflicted", "conflicted");
    await press("Check again");
    await until(alpha, runtime, Link, (l) => l.phase === "Done" && l.said === "ConflictMany");
  });

  it("Approve what the agent changes (spec/app/calendar/agent.md, \"Story: Approve what the agent changes\"; spec/app/calendar/agent.md, \"Story: Know what the agent's change did\"; spec/app/calendar/agent.md, \"Story: Read where a Calendar request stands\")", async () => {
    const { world, alpha, runtime, reread } = await onPhoneCalendar();
    const lunch = { source: { calendarId: "eliza-calendar/primary" }, eventId: "ev-team-lunch", expectedVersion: "1" };

    // spec/app/calendar/agent.md, "A card that leaves out a field its change would set can be declined, never approved"; spec/app/calendar/agent.md, "The owner declines, or the agent withdraws, and nothing is sent"
    world.calendar.approvals.push(agentRequest("approval-1", { action: "respond_invitation", account: "owner", target: lunch, scope: "instance", response: "tentative", colour: "red" }));
    await reread();
    await until(alpha, runtime, Changes, (a) => a.stage === "Awaiting");
    expect([Boolean(button("Approve")), Boolean(button("Decline")), document.body.textContent?.includes("Approval unavailable")]).toEqual([false, true, true]);
    await press("Decline");
    await until(alpha, runtime, Changes, (a) => a.result === "Declined");
    expect(world.calendar.writes).toEqual(["reject approval-1"]);

    // spec/app/calendar/agent.md, "The agent proposes one change at a time, for the revision of the event it selected, and the card shows it"; spec/app/calendar/agent.md, "What is sent is exactly the change approved, for the revision the agent selected"; spec/app/calendar/agent.md, "The read back says whether the change is there as approved, and the agent is told"
    const start = new Date(world.at(1, 15)).toISOString();
    const end = new Date(world.at(1, 16)).toISOString();
    world.calendar.approvals.push(agentRequest("approval-2", {
      action: "schedule_event", account: "owner", source: { calendarId: "eliza-calendar/primary" }, recurrence: null,
      fields: { title: "Coffee with Ana", description: "", location: "Corner cafe", startAt: start, endAt: end, isAllDay: false, timeZone: "Europe/Lisbon" },
    }));
    await reread();
    await until(alpha, runtime, Changes, (a) => a.stage === "Awaiting" && a.change === "Create" && a.complete);
    expect(["Coffee with Ana", "Corner cafe", "Europe/Lisbon", "Waiting for you"].map((text) => document.body.textContent?.includes(text))).toEqual([true, true, true, true]);
    await press("Approve");
    await until(alpha, runtime, Changes, (a) => a.result === "Done");
    expect(world.calendar.writes).toEqual(["reject approval-1", "approve approval-2", "create ev-coffee-with-ana"]);
    expect(world.calendar.events.find((event) => event.title === "Coffee with Ana")?.startAt).toBe(start);

    // spec/app/calendar/agent.md, "When the event changes in Google, the card waiting for the owner no longer counts"; spec/app/calendar/agent.md, "A card voided by a change in Google is shown again at the event's new revision, marked updated"
    world.calendar.approvals.push(agentRequest("approval-3", { action: "respond_invitation", account: "owner", target: lunch, scope: "instance", response: "tentative" }));
    await reread();
    await until(alpha, runtime, Changes, (a) => a.stage === "Awaiting" && a.change === "Respond" && a.complete);
    const approval = world.calendar.approvals.find((one) => one.id === "approval-3");
    if (!approval) throw new Error("no request");
    approval.revision = "r2";
    await reread();
    await until(alpha, runtime, Changes, (a) => a.updated && a.complete);
    await press("Approve");
    await until(alpha, runtime, Changes, (a) => a.result === "Done");
    expect(world.calendar.writes.slice(3)).toEqual(["approve approval-3", "answer ev-team-lunch tentative"]);

    // spec/app/calendar/agent.md, "The request is read again at the tap; a newer revision is shown as updated, and nothing is sent": the agent revised its request after the card showed it.
    world.calendar.approvals.push(agentRequest("approval-4", {
      action: "schedule_event", account: "owner", source: { calendarId: "eliza-calendar/primary" }, recurrence: null,
      fields: { title: "Walk", description: "", location: "", startAt: start, endAt: end, isAllDay: false, timeZone: "Europe/Lisbon" },
    }));
    await reread();
    await until(alpha, runtime, Changes, (a) => a.stage === "Awaiting" && a.change === "Create" && !a.updated);
    const walk = world.calendar.approvals.find((one) => one.id === "approval-4");
    if (!walk) throw new Error("no request");
    walk.revision = "r2";
    await press("Approve");
    await until(alpha, runtime, Changes, (a) => a.stage === "Awaiting" && a.updated && a.write.outcome === "Refused");
    expect(world.calendar.writes.slice(5)).toEqual([]);
    await press("Approve");
    await until(alpha, runtime, Changes, (a) => a.result === "Done");
    expect(world.calendar.writes.slice(5)).toEqual(["approve approval-4", "create ev-walk"]);
  });

  it('Clears hidden deletions after a dual-source phone and Google refresh (spec/app/calendar/deletions.md, "A refused send shows the event again and says it was not deleted, and whether it changed; a sent deletion hides it until a read no longer has it unchanged")', async () => {
    const world = morning(true);
    world.calendar.granted = true;
    const mounted = await open(world, only("view:Calendar"));
    const runtime = calendar.runtime(mounted.alpha);
    await openCalendar(mounted.alpha);
    await until(mounted.alpha, runtime, View, (s) => s.phone.status === "Loaded" && s.google.status === "Loaded");
    await declineLunch(mounted.alpha, runtime);
    expect((await runtime.runPromise(Editor.use((e) => e.get()))).write.outcome).toBe("Confirmed");
    await openCalendar(mounted.alpha);
    await runtime.runPromise(View.use((v) => v.send({ type: "refresh" })));
    await until(mounted.alpha, runtime, View, (s) => s.phone.status === "Loaded" && s.google.status === "Loaded");
    await drawn(() => {});
    expect((await runtime.runPromise(Held.use((d) => d.get()))).hiding).toBe(0);
  });

  it('Approve in Ask Alpha what a reply asked for (spec/app/calendar/agent.md, "The card shows in Ask Alpha too, under the reply that filed its request, typed or spoken"; spec/app/calendar/agent.md, "Only the owner approves, and approving sends the change once, under a new number")', async () => {
    const world = morning(true);
    const { alpha } = await open(world, only("home", "assistant", "assistant/calendar"));
    const ask = assistant.runtime(alpha);
    await until(alpha, ask, Composer, (s) => s.slot === "Open");
    await until(alpha, ask, Conversation, (s) => s.ready);
    const card = () => document.querySelector("section[aria-label='Calendar change']")?.textContent ?? "";
    const queueApproval = (id: string, title: string, startAt: string, endAt: string, reply: string) => {
      world.ask.nextReplyChunks = [reply];
      world.ask.nextActions = () => {
        world.calendar.approvals.push(agentRequest(id, {
          action: "schedule_event", account: "owner", source: { calendarId: "eliza-calendar/primary" }, recurrence: null,
          fields: { title, description: "", location: "", startAt, endAt, isAllDay: false, timeZone: "UTC" },
        }));
        return [{ action: "CALENDAR", data: { subaction: "create_event", approvalRequestId: id } }];
      };
    };
    const send = async (text: string) => {
      const nextSend = (await ask.runPromise(Effect.flatMap(Conversation, (c) => c.get()))).turn.send.id + 1;
      const box = document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Message Alpha']");
      if (box?.hidden) await press("Type");
      await fill("Message Alpha", text);
      await press("Send");
      await until(alpha, ask, Conversation, (c) => c.turn.send.id === nextSend && c.turn.reply === "Complete");
    };
    queueApproval("approval-1", "camera setup", new Date(world.at(1, 9)).toISOString(), new Date(world.at(1, 9.5)).toISOString(), "I've proposed camera setup for 9:00 tomorrow. It's waiting for your approval.");
    await send("Put a 30 minute event called camera setup at 9 tomorrow.");
    await until(alpha, calendar.runtime(alpha), Changes, (a) => a.stage === "Awaiting");
    await vi.waitFor(() => expect(button("Approve")).toBeDefined());
    expect(["camera setup", "Waiting for you"].map((text) => card().includes(text))).toEqual([true, true]);
    expect(world.calendar.writes).toEqual([]);

    await press("Approve");
    await until(alpha, calendar.runtime(alpha), Changes, (a) => a.result === "Done");
    expect(world.calendar.writes).toEqual(["approve approval-1", "create ev-camera-setup"]);
    await vi.waitFor(() => expect(document.body.textContent).toContain("Done, and seen in your calendar."));

    world.ask.nextReplyChunks = ["You're welcome."];
    await send("Thanks.");
    expect([card(), document.body.textContent?.includes("Done, and seen in your calendar.")]).toEqual(["", false]);
  });

  /** Ask Alpha alone on `world`, with Calendar's card, and a way to send a reply that files `request` titled `title` at `hours` tomorrow. */
  async function askingCalendar(world: ReturnType<typeof morning>, ...more: Parameters<typeof only>) {
    const { alpha } = await open(world, only("home", "assistant", "assistant/calendar", ...more));
    const ask = assistant.runtime(alpha);
    const agent = calendar.runtime(alpha);
    await until(alpha, ask, Composer, (s) => s.slot === "Open");
    await until(alpha, ask, Conversation, (s) => s.ready);
    const send = async (text: string) => {
      const turn = (await ask.runPromise(Effect.flatMap(Conversation, (c) => c.get()))).turn.send.id + 1;
      const composer = document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Message Alpha']");
      if (composer?.hidden) await press("Type");
      await fill("Message Alpha", text);
      await press("Send");
      await until(alpha, ask, Conversation, (c) => c.turn.reply === "Complete" && c.turn.send.id === turn);
    };
    const request = (id: string, title: string, hours: number, calendarId = "eliza-calendar/primary") => agentRequest(id, {
      action: "schedule_event", account: "owner", source: { calendarId }, recurrence: null,
      fields: { title, description: "", location: "", startAt: new Date(world.at(1, hours)).toISOString(), endAt: new Date(world.at(1, hours + 0.5)).toISOString(), isAllDay: false, timeZone: "UTC" },
    });
    const file = async (id: string, title: string, hours: number, calendarId?: string) => {
      world.ask.nextReplyChunks = [`I've proposed ${title} for tomorrow. It's waiting for your approval.`];
      world.ask.nextActions = () => {
        world.calendar.approvals.push(request(id, title, hours, calendarId));
        return [{ action: "CALENDAR", data: { subaction: "create_event", approvalRequestId: id } }];
      };
      await send(`Put ${title} on my calendar tomorrow.`);
    };
    /** The owner declines in Calendar the request it holds; Calendar reads nothing again by hand. */
    const declineInCalendar = async () => {
      await agent.runPromise(Effect.flatMap(Changes, (machine) => Effect.flatMap(machine.get(), (a) => machine.send({ type: "decline", filing: a.filing }, "Owner"))));
      await until(alpha, agent, Changes, (a) => a.result === "Declined");
    };
    return { alpha, agent, file, request, declineInCalendar, send };
  }

  const askedCard = () => document.querySelector("section[aria-label='Calendar change']")?.textContent ?? "";

  async function fileTwoCalendarRequests() {
    const world = morning(true);
    const { alpha, agent, file } = await askingCalendar(world);
    await file("approval-earlier-reply", "camera setup", 9);
    await vi.waitFor(() => expect(askedCard()).toContain("camera setup"));
    await file("approval-newer-reply", "lens check", 11);
    return { world, alpha, agent };
  }

  // spec/app/calendar/agent.md, "The card shows in Ask Alpha too, under the reply that filed its request, typed or spoken"; spec/app/calendar/agent.md, "The agent proposes one change at a time, for the revision of the event it selected, and the card shows it"
  it("Two replies of one conversation file requests: the card shows the one Calendar holds, then the next once it ends (spec/app/calendar/agent.md, \"The card shows in Ask Alpha too, under the reply that filed its request, typed or spoken\"; spec/app/calendar/agent.md, \"The agent proposes one change at a time, for the revision of the event it selected, and the card shows it\")", async () => {
    const { world, alpha, agent } = await fileTwoCalendarRequests();
    await until(alpha, agent, Changes, (a) => a.stage === "Awaiting");
    await drawn(() => {});
    expect(["camera setup", "lens check"].map((text) => askedCard().includes(text))).toEqual([true, false]);
    expect(world.calendar.writes).toEqual([]);

    await press("Decline");
    await vi.waitFor(() => expect(askedCard()).toContain("lens check"));
    expect(askedCard()).not.toContain("camera setup");
    await press("Approve");
    await until(alpha, agent, Changes, (a) => a.result === "Done");
    expect(world.calendar.writes).toEqual(["reject approval-earlier-reply", "approve approval-newer-reply", "create ev-lens-check"]);
  });

  async function openPrimaryApproval(summary?: string) {
    const world = morning(true);
    if (summary !== undefined) world.calendar.summary = summary;
    const { alpha, agent, file } = await askingCalendar(world);
    await file("approval-primary", "camera setup", 9, "primary");
    await until(alpha, agent, Changes, (a) => a.stage === "Awaiting");
    await vi.waitFor(() => expect(askedCard()).toContain("camera setup"));
    return { world, alpha, agent, file };
  }

  it("The card names the agent's own calendar as the Sunday demo build did (spec/app/calendar/agent.md, \"The card shows in Ask Alpha too, under the reply that filed its request, typed or spoken\")", async () => {
    // spec/app/calendar/agent.md, "The card shows in Ask Alpha too, under the reply that filed its request, typed or spoken": eliza files the agent calendar's requests for calendar "primary", which v119 45f6bed30 named "Eliza Calendar" (prototype/calendar-approval-fields.ts:48, agent-calendar-adapter.ts:166).
    const { world } = await openPrimaryApproval();
    expect(["Eliza Calendar", "Your agent's calendar"].map((text) => askedCard().includes(text))).toEqual([true, false]);
    // spec/app/calendar/agent.md, "The agent proposes one change at a time, for the revision of the event it selected, and the card shows it": v119 headed a new event's card "Add event" (prototype/calendar-approval-fields.ts:46)
    expect(["Add event", "Create an event"].map((text) => askedCard().includes(text))).toEqual([true, false]);
    expect(button("Approve")).toBeDefined();
    expect(world.calendar.writes).toEqual([]);
  });

  it("The card names the calendar its request names by the summary the agent lists for it, as the Sunday demo build did (spec/app/calendar/presentation.md, \"The agent's calendar goes by the name the agent lists for it\")", async () => {
    // spec/app/calendar/presentation.md, "The agent's calendar goes by the name the agent lists for it": v119 45f6bed30 prototype/calendar-approval-fields.ts:17 and 48 printed the summary of the request's source, for "primary" and for the calendar the agent lists alike.
    const { world, alpha, agent, file } = await openPrimaryApproval("Family");
    expect(["Family", "Eliza Calendar", "Agent Calendar"].map((text) => askedCard().includes(text))).toEqual([true, false, false]);
    await press("Decline");
    await file("approval-listed", "lens check", 11, "eliza-calendar/primary");
    await until(alpha, agent, Changes, (a) => a.stage === "Awaiting");
    await vi.waitFor(() => expect(askedCard()).toContain("lens check"));
    expect(["Family", "Calendar eliza-calendar/primary"].map((text) => askedCard().includes(text))).toEqual([true, false]);
    expect(button("Approve")).toBeDefined();
    expect(world.calendar.writes).toEqual(["reject approval-primary"]);
  });

  it("A card filed from Ask Alpha on Home names the calendar the agent lists though Calendar was never opened (spec/app/calendar/presentation.md, \"The agent's calendar goes by the name the agent lists for it\")", async () => {
    // spec/app/calendar/presentation.md, "The agent's calendar goes by the name the agent lists for it": signed out, Calendar reads no calendar list for an owner, as where Calendar was never opened, so only the card's own read names it
    const world = { ...morning(true), signedIn: false };
    const { alpha, agent, file } = await askingCalendar(world);
    expect((await alpha.runtime.runPromise(Shell.use((shell) => shell.get()))).trail).not.toContain("Calendar");
    // spec/app/calendar/presentation.md, "The agent's calendar goes by the name the agent lists for it": v119 45f6bed30 prototype/calendar-approval-fields.ts:17 printed the summary of the source it read for the card; demo frame v100-077 shows Eliza Calendar.
    await file("approval-home", "camera setup", 9, "primary");
    await until(alpha, agent, Changes, (a) => a.stage === "Awaiting");
    await vi.waitFor(() => expect(askedCard()).toContain("camera setup"));
    expect([
      askedCard().includes("Eliza Calendar"),
      askedCard().includes("Agent Calendar"),
      Boolean(button("Approve")),
      world.calendar.writes,
    ]).toEqual([true, false, true, []]);
  });

  /** In `world`, the agent's resident calendar answers unavailable with no rows, as on a fresh agent with no Google, and a card filed from Home as `approval` shows its camera setup. */
  async function unavailableCard(world: ReturnType<typeof morning>, approval: string) {
    world.calendar.events = [];
    world.calendar.feedState = "unavailable";
    const { alpha, agent, file } = await askingCalendar(world, "view:Calendar");
    await file(approval, "camera setup", 9, "primary");
    await until(alpha, agent, Changes, (a) => a.stage === "Awaiting");
    await vi.waitFor(() => expect(askedCard()).toContain("camera setup"));
    return { world, alpha, agent };
  }

  it("An unavailable Google feed takes the agent's rows away but not the name it lists, on Home and after Calendar is opened (spec/app/calendar/presentation.md, \"The agent's calendar goes by the name the agent lists for it\")", async () => {
    // spec/app/calendar/presentation.md, "The agent's calendar goes by the name the agent lists for it": eliza 436741a67bdf answers its resident calendar's empty window with state "unavailable" (plugin-calendar routes.vibe:104) while it lists that calendar as Eliza Calendar (providers.vibe:237), as on a fresh agent with no Google
    const { world, alpha, agent } = await unavailableCard(morning(true), "approval-unavailable");
    const named = () => [askedCard().includes("Eliza Calendar"), askedCard().includes("Agent Calendar")];
    expect(named()).toEqual([true, false]);
    // spec/app/calendar/index.md, "Connecting an account reads the day from Google; disconnecting takes its rows away at once": opening Calendar reads the feed again, which still says unavailable
    const reads = world.calendar.feedReads ?? 0;
    await openCalendar(alpha);
    await until(alpha, agent, View, (s) => s.front && !s.connected && (world.calendar.feedReads ?? 0) > reads);
    await drawn(() => {});
    expect([...named(), Boolean(button("Approve")), world.calendar.writes]).toEqual([true, false, true, []]);
  });

  it("A card filed from Ask Alpha on Home before the owner signed in shows whole in Calendar, and is approved only so (spec/app/calendar/agent.md, \"The agent proposes one change at a time, for the revision of the event it selected, and the card shows it\"; spec/app/calendar/agent.md, \"The card shows in Ask Alpha too, under the reply that filed its request, typed or spoken\")", async () => {
    // spec/app/calendar/agent.md, "The agent proposes one change at a time, for the revision of the event it selected, and the card shows it": the demo gate's D17 on develop 680960bfb, a resident calendar whose feed is unavailable, as on a fresh agent with no Google
    const { world, alpha, agent } = await unavailableCard({ ...morning(true), signedIn: false }, "approval-home");
    // spec/app/calendar/agent.md, "The agent proposes one change at a time, for the revision of the event it selected, and the card shows it": v119 45f6bed30 prototype/model.js:5822-5830 kept a request's card open until it was answered or replaced; Back and leaving Calendar leave it waiting
    await openCalendar(alpha);
    await until(alpha, agent, View, (s) => s.front);
    await hardware("back");
    await until(alpha, agent, View, (s) => !s.front);
    await drawn(() => {});
    expect((await agent.runPromise(Effect.flatMap(Changes, (machine) => machine.get()))).card.showing).toBe(true);
    world.signedIn = true;
    await openCalendar(alpha);
    await until(alpha, agent, View, (s) => s.front && s.owner > 0);
    // spec/app/calendar/agent.md, "The agent proposes one change at a time, for the revision of the event it selected, and the card shows it": v119 45f6bed30 prototype/calendar-approval-fields.ts:46-48 always printed the card's heading, calendar and fields, and calendar-approval-review.ts:19-24 offered Approve only on a complete card
    await vi.waitFor(() => expect(["Add event", "Waiting for you", "camera setup", "Eliza Calendar", "Unavailable"].map((text) => askedCard().includes(text))).toEqual([true, true, true, true, false]));
    expect([Boolean(button("Approve")), world.calendar.writes]).toEqual([true, []]);
    await press("Approve");
    await until(alpha, agent, Changes, (a) => a.stage === "Idle" && a.write.outcome === "Confirmed");
    expect(world.calendar.writes).toEqual(["approve approval-home", "create ev-camera-setup"]);
  });

  /** Calendar reads "Family" for a signed-in owner, `change` alters the world and reopens Calendar, and a card filed from Home then tells which of Eliza Calendar, Family and Agent Calendar it names, whether its filing read the agent's list, and what was written. */
  async function namesAfterOwnerChange(approval: string, change: (world: ReturnType<typeof morning>, alpha: Alpha, agent: ReturnType<typeof calendar.runtime>, request: Awaited<ReturnType<typeof askingCalendar>>["request"]) => Promise<void>) {
    const world = morning(true);
    world.calendar.summary = "Family";
    const { alpha, agent, file, request } = await askingCalendar(world, "view:Calendar");
    const goHome = () => alpha.runtime.runPromise(Effect.flatMap(Shell, (shell) => shell.send({ type: "goHome" })));
    await openCalendar(alpha);
    await until(alpha, agent, View, (s) => s.front && s.connected && s.owner > 0);
    await goHome();
    await change(world, alpha, agent, request);
    await goHome();
    const answered = world.calendar.calendarsAnswered ?? 0;
    await file(approval, "camera setup", 9, "primary");
    await until(alpha, agent, Changes, (a) => a.stage === "Awaiting");
    await vi.waitFor(() => expect(askedCard()).toContain("camera setup"));
    const named = ["Eliza Calendar", "Family", "Agent Calendar"].map((text) => askedCard().includes(text));
    return { named, listed: (world.calendar.calendarsAnswered ?? 0) > answered, writes: world.calendar.writes };
  }

  /** The owner signs out and Calendar, opened again, has taken the owner away. */
  async function reopenSignedOut(world: ReturnType<typeof morning>, alpha: Alpha, agent: ReturnType<typeof calendar.runtime>) {
    world.signedIn = false;
    await openCalendar(alpha);
    await until(alpha, agent, View, (s) => s.front && s.owner === 0);
  }

  it(`Signing out forgets the name the agent listed for the owner before, so the next card reads the list again (spec/app/calendar/index.md, "A changed owner clears the agent's rows, closes the open event and the Calendars sheet, and takes that owner's hidden calendars"; spec/app/calendar/presentation.md, "The agent's calendar goes by the name the agent lists for it")`, async () => {
    const { named } = await namesAfterOwnerChange("approval-signed-out", async (world, alpha, agent) => {
      world.calendar.summary = undefined;
      await reopenSignedOut(world, alpha, agent);
    });
    expect(named).toEqual([true, false, false]);
  });

  it(`A card names the calendar the agent lists now, never one a Google account that went away listed before (spec/app/calendar/presentation.md, "The agent's calendar goes by the name the agent lists for it")`, async () => {
    const { named, listed } = await namesAfterOwnerChange("approval-account-gone", async (world, alpha, agent) => {
      world.calendar.summary = undefined;
      world.calendar.feedState = "unavailable";
      world.calendar.events = [];
      await openCalendar(alpha);
      await until(alpha, agent, View, (s) => s.front && !s.connected);
    });
    expect([...named, listed]).toEqual([true, false, false, true]);
  });

  /**
   * Owner A's request "lens check" waits in a read of the agent's list held at its read of `held` while A signs out and the agent
   * lists nothing for the next owner. Once the read answers, no card shows; then a card filed from Home tells what `namesAfterOwnerChange` does.
   */
  async function heldAcrossSignOut(held: "calendars" | "approvals") {
    return namesAfterOwnerChange("approval-after", async (world, alpha, agent, request) => {
      const hold = (on: boolean) => {
        if (held === "calendars") world.calendar.holdCalendars = on;
        else world.calendar.holdApprovals = on;
      };
      const releases = held === "calendars" ? world.calendar.heldCalendars : world.calendar.heldApprovals;
      const answered = () => (held === "calendars" ? world.calendar.calendarsAnswered : world.calendar.approvalsAnswered) ?? 0;
      world.calendar.approvals.push(request("approval-before", "lens check", 11));
      hold(true);
      await openCalendar(alpha);
      await vi.waitFor(() => expect(releases.length).toBeGreaterThan(0));
      await hardware("home");
      world.calendar.approvals.splice(0);
      world.calendar.summary = undefined;
      hold(false);
      await reopenSignedOut(world, alpha, agent);
      const expected = answered() + releases.length;
      await drawn(() => releases.splice(0).forEach((release) => release()));
      await vi.waitFor(() => expect(answered()).toBe(expected));
      await drawn(() => {});
      // spec/app/calendar/agent.md, "The agent proposes one change at a time, for the revision of the event it selected, and the card shows it": a changed owner drops the requests Calendar read, so the read begun before it shows no card, blank or with Approve
      const after = await agent.runPromise(Effect.flatMap(Changes, (machine) => machine.get()));
      expect([after.stage, Boolean(button("Approve")), askedCard()]).toEqual(["Idle", false, ""]);
    });
  }

  it(`A read of the agent's list begun before the owner signed out proposes nothing of that owner's request, and the next card shows whole (spec/app/calendar/agent.md, "The agent proposes one change at a time, for the revision of the event it selected, and the card shows it"; spec/app/calendar/index.md, "A changed owner clears the agent's rows, closes the open event and the Calendars sheet, and takes that owner's hidden calendars")`, async () => {
    const { named, writes } = await heldAcrossSignOut("calendars");
    expect([...named, askedCard().includes("lens check"), writes]).toEqual([true, false, false, false, []]);
  });

  it(`An answer of the agent's approvals list read for the owner before a sign-out is refused, so that owner's request never shows signed out (spec/app/calendar/agent.md, "The agent proposes one change at a time, for the revision of the event it selected, and the card shows it"; spec/app/calendar/index.md, "A changed owner clears the agent's rows, closes the open event and the Calendars sheet, and takes that owner's hidden calendars")`, async () => {
    const { named, writes } = await heldAcrossSignOut("approvals");
    expect([...named, askedCard().includes("lens check"), writes]).toEqual([true, false, false, false, []]);
  });

  /** Owner A's request to answer Maybe to `title`'s invitation, an event of the agent's calendar at `begin`. */
  const maybeTo = (title: string, begin: number) => agentRequest(`approval-${agentEvent(title, begin, begin).id}`, {
    action: "respond_invitation", account: "owner", scope: "instance", response: "tentative",
    target: { source: { calendarId: "eliza-calendar/primary" }, eventId: agentEvent(title, begin, begin).id, startAt: new Date(begin).toISOString(), expectedVersion: "1" },
  });

  /**
   * Owner A taps Approve on the card of `filed` in Calendar while the read named by `held` waits: the agent's approvals list read
   * again at the tap, or the day of the event, read where Calendar's own window does not hold it. A goes Home, owner B signs in,
   * and Calendar, opened again, takes B, whose reads of the list wait unanswered. Once the held read answers, tells whether B is
   * signed in in A's place, how the card ended, whether Approve shows, what was written, how many toasts B was shown and whether
   * B is shown that nothing changed.
   */
  async function approvedAcrossOwnerChange(held: "approvals" | "feed", filed: (world: ReturnType<typeof morning>) => ReturnType<typeof agentRequest>) {
    const { world, alpha, runtime, reread } = await onPhoneCalendar();
    world.calendar.approvals.push(filed(world));
    await reread();
    await until(alpha, runtime, Changes, (a) => a.stage === "Awaiting" && a.complete);
    const a = (await runtime.runPromise(Effect.flatMap(View, (machine) => machine.get()))).owner;
    const releases = held === "approvals" ? world.calendar.heldApprovals : world.calendar.heldFeed;
    const hold = (on: boolean) => {
      if (held === "approvals") world.calendar.holdApprovals = on;
      else world.calendar.holdFeed = on;
    };
    hold(true);
    await press("Approve");
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    hold(false);
    const tapped = releases.splice(0);
    world.calendar.holdApprovals = true;
    await hardware("home");
    const before = account.id;
    onTestFinished(() => void Object.assign(account, { id: before }));
    Object.assign(account, { id: "user-b" });
    await openCalendar(alpha);
    await until(alpha, runtime, View, (s) => s.front && s.owner > 0 && s.owner !== a);
    const issued = async () => (await alpha.runtime.runPromise(Effect.flatMap(Toasts, (machine) => machine.get()))).issued;
    const shown = await issued();
    await drawn(() => tapped.forEach((release) => release()));
    await until(alpha, runtime, Changes, (s) => s.stage === "Idle");
    await drawn(() => {});
    const b = (await runtime.runPromise(Effect.flatMap(View, (machine) => machine.get()))).owner;
    const card = await runtime.runPromise(Effect.flatMap(Changes, (machine) => machine.get()));
    return [b > 0 && b !== a, card.result, Boolean(button("Approve")), world.calendar.writes, await issued() - shown, document.body.textContent?.includes("Nothing changed")];
  }

  it("Approve tapped for one owner sends nothing once another owner signed in while the tap read the agent's list again (spec/app/calendar/agent.md, \"The request is read again at the tap; a newer revision is shown as updated, and nothing is sent\"; spec/app/calendar/agent.md, \"The agent proposes one change at a time, for the revision of the event it selected, and the card shows it\")", async () => {
    const ended = await approvedAcrossOwnerChange("approvals", (at) => maybeTo("Team lunch", at.at(0, 12)));
    // spec/app/calendar/agent.md, "The request is read again at the tap; a newer revision is shown as updated, and nothing is sent": approving is for the owner Calendar read at the tap, so A's approval is never sent once Calendar holds B, and B is told nothing of it
    expect(ended).toEqual([true, "Withdrawn", false, [], 0, false]);
  });

  it("Approve tapped for one owner sends nothing once another owner signed in while the tap read the day of an event outside Calendar's window (spec/app/calendar/agent.md, \"The request is read again at the tap; a newer revision is shown as updated, and nothing is sent\"; spec/app/calendar/agent.md, \"A card is complete only with known fields, a valid time and, for a change, a verified target\")", async () => {
    const ended = await approvedAcrossOwnerChange("feed", (at) => {
      const begin = at.at(200, 12);
      at.calendar.events.push(agentEvent("Offsite", begin, begin + hour, {
        attendees: [{ email: "owner@alpha.test", displayName: "You", responseStatus: "needsAction", self: true, organizer: false, optional: false }],
      }));
      return maybeTo("Offsite", begin);
    });
    // spec/app/calendar/agent.md, "The request is read again at the tap; a newer revision is shown as updated, and nothing is sent": the tap reads the event's own day after it read the list, and an owner who signed in meanwhile gets nothing of A's sent, and no words
    expect(ended).toEqual([true, "Withdrawn", false, [], 0, false]);
  });

  it(`Signed out, a card whose read of the agent's list fails names no calendar the owner before was shown (spec/app/calendar/index.md, "A changed owner clears the agent's rows, closes the open event and the Calendars sheet, and takes that owner's hidden calendars"; spec/app/calendar/presentation.md, "The agent's calendar goes by the name the agent lists for it")`, async () => {
    const { named, listed, writes } = await namesAfterOwnerChange("approval-signed-out-unlisted", async (world, alpha, agent) => {
      world.calendar.calendarsDown = true;
      await reopenSignedOut(world, alpha, agent);
    });
    expect([...named, listed, writes]).toEqual([false, false, true, true, []]);
  });

  it("With Google connected, a card for the agent's own calendar names it by its own summary, and one for Google's calendar by Google's (spec/app/calendar/presentation.md, \"The agent's calendar goes by the name the agent lists for it\")", async () => {
    // spec/app/calendar/presentation.md, "The agent's calendar goes by the name the agent lists for it": eliza lists its resident "primary" calendar first and then each Google calendar, Google's own marked primary too (plugin-calendar providers.vibe:237, plugin-calendar-client feed/broker.vibe:79); v119 45f6bed30 prototype/calendar-approval-fields.ts:12-17 named the card by the source its request matched
    const world = morning(true);
    world.calendar.listed = [
      { provider: "eliza", side: "owner", calendarId: "primary", summary: "Eliza Calendar", primary: true },
      { provider: "google", side: "owner", calendarId: "owner@alpha.test", summary: "Family", primary: true },
    ];
    const { alpha, agent, file } = await askingCalendar(world);
    await file("approval-resident", "camera setup", 9, "primary");
    await until(alpha, agent, Changes, (a) => a.stage === "Awaiting");
    await vi.waitFor(() => expect(askedCard()).toContain("camera setup"));
    expect(["Eliza Calendar", "Family", "Agent Calendar"].map((text) => askedCard().includes(text))).toEqual([true, false, false]);
    await press("Decline");
    await file("approval-google", "lens check", 11, "owner@alpha.test");
    await vi.waitFor(() => expect(askedCard()).toContain("lens check"));
    expect(["Family", "Eliza Calendar"].map((text) => askedCard().includes(text))).toEqual([true, false]);
    expect([Boolean(button("Approve")), world.calendar.writes]).toEqual([true, ["reject approval-resident"]]);
  });

  /** Calendar on a phone showing card A, an answer to the team lunch, with request B pending behind it, and a way to read the day again. */
  async function showingA(b: Record<string, unknown>) {
    const { world, alpha, runtime, reread } = await onPhoneCalendar();
    const lunch = { source: { calendarId: "eliza-calendar/primary" }, eventId: "ev-team-lunch", expectedVersion: "1" };
    world.calendar.approvals.push(
      agentRequest("approval-a", { action: "respond_invitation", account: "owner", target: lunch, scope: "instance", response: "tentative" }),
      agentRequest("approval-b", b),
    );
    await reread();
    await until(alpha, runtime, Changes, (a) => a.stage === "Awaiting" && a.change === "Respond" && a.complete);
    const first = (await runtime.runPromise(Effect.flatMap(Changes, (machine) => machine.get()))).filing;
    return { world, alpha, runtime, reread, first };
  }

  /**
   * Card A waits on a read of the agent's list while A changes, the owner declines A, and the read the decline starts shows
   * card B: that read's list answers first, and A's answers last.
   */
  async function lateListRead(changeA: (world: ReturnType<typeof morning>) => void, b: Record<string, unknown>) {
    const { world, alpha, runtime, reread, first } = await showingA(b);
    changeA(world);
    world.calendar.holdCalendars = true;
    await reread();
    await vi.waitFor(() => expect(world.calendar.heldCalendars).toHaveLength(1));
    await press("Decline");
    await vi.waitFor(() => expect(world.calendar.heldCalendars).toHaveLength(2));
    world.calendar.holdCalendars = false;
    const answered = world.calendar.calendarsAnswered ?? 0;
    await drawn(() => world.calendar.heldCalendars[1]?.());
    await until(alpha, runtime, Changes, (a) => a.stage === "Awaiting" && a.filing !== first);
    await drawn(() => world.calendar.heldCalendars[0]?.());
    await vi.waitFor(() => expect(world.calendar.calendarsAnswered).toBe(answered + 2));
    await reread();
    await vi.waitFor(() => expect(world.calendar.calendarsAnswered).toBe(answered + 3));
    await drawn(() => {});
    const card = await runtime.runPromise(Effect.flatMap(Changes, (machine) => machine.get()));
    return { world, card, first };
  }

  const standup = { source: { calendarId: "eliza-calendar/primary" }, eventId: "ev-standup", expectedVersion: "1" };

  it(`A read of the list that comes back after its card was declined never makes the next card approvable (spec/app/calendar/agent.md, "The agent proposes one change at a time, for the revision of the event it selected, and the card shows it"; spec/app/calendar/agent.md, "A card that leaves out a field its change would set can be declined, never approved")`, async () => {
    const { world, card, first } = await lateListRead((at) => {
      const a = at.calendar.approvals.find((one) => one.id === "approval-a");
      if (a) a.revision = "r2";
    }, { action: "respond_invitation", account: "owner", target: standup, scope: "instance", response: "tentative", colour: "red" });
    expect([card.filing !== first, card.complete, card.updated, Boolean(button("Approve")), Boolean(button("Decline")), document.body.textContent?.includes("Approval unavailable"), world.calendar.writes])
      .toEqual([true, false, false, false, true, true, ["reject approval-a"]]);
  });

  it(`A read of the list that comes back after its card was declined never voids the next card, when the first card's event moved in Google (spec/app/calendar/agent.md, "The agent proposes one change at a time, for the revision of the event it selected, and the card shows it"; spec/app/calendar/agent.md, "When the event changes in Google, the card waiting for the owner no longer counts")`, async () => {
    const { world, card, first } = await lateListRead((at) => {
      const lunch = at.calendar.events.find((one) => one.id === "ev-team-lunch");
      if (lunch) lunch.metadata = { ...lunch.metadata, etag: "2" };
    }, { action: "respond_invitation", account: "owner", target: standup, scope: "instance", response: "tentative" });
    expect([card.filing !== first, card.complete, card.updated, Boolean(button("Approve")), document.body.textContent?.includes("(updated)"), world.calendar.writes])
      .toEqual([true, true, false, true, false, ["reject approval-a"]]);
  });

  it("A slow read of the list that began with no card shown never shows again the card a faster read showed and the owner declined (spec/app/calendar/agent.md, \"The agent proposes one change at a time, for the revision of the event it selected, and the card shows it\")", async () => {
    const { world, alpha, runtime, reread, first } = await showingA({ action: "respond_invitation", account: "owner", target: standup, scope: "instance", response: "tentative" });
    world.calendar.holdCalendars = true;
    await press("Decline");
    await vi.waitFor(() => expect(world.calendar.heldCalendars).toHaveLength(1));
    await reread();
    await vi.waitFor(() => expect(world.calendar.heldCalendars).toHaveLength(2));
    world.calendar.holdCalendars = false;
    await drawn(() => world.calendar.heldCalendars[1]?.());
    await until(alpha, runtime, Changes, (a) => a.stage === "Awaiting" && a.filing !== first);
    const b = (await runtime.runPromise(Effect.flatMap(Changes, (machine) => machine.get()))).filing;
    await press("Decline");
    await until(alpha, runtime, Changes, (a) => a.stage === "Idle" && a.result === "Declined" && a.filing === b);
    await vi.waitFor(() => expect(world.calendar.writes).toEqual(["reject approval-a", "reject approval-b"]));
    const answered = world.calendar.calendarsAnswered ?? 0;
    // spec/app/calendar/agent.md, "The agent proposes one change at a time, for the revision of the event it selected, and the card shows it": the read that began before card B was shown still lists B as pending, and comes back only after the owner declined it.
    await drawn(() => world.calendar.heldCalendars[0]?.());
    await vi.waitFor(() => expect(world.calendar.calendarsAnswered).toBe(answered + 1));
    await later(alpha, 0);
    await drawn(() => {});
    const card = await runtime.runPromise(Effect.flatMap(Changes, (machine) => machine.get()));
    expect([card.stage, card.result, card.filing, Boolean(button("Approve")), Boolean(button("Decline")), world.calendar.writes])
      .toEqual(["Idle", "Declined", b, false, false, ["reject approval-a", "reject approval-b"]]);
  });

  // spec/app/calendar/agent.md, "The card shows in Ask Alpha too, under the reply that filed its request, typed or spoken"
  it("How the earlier reply's request ended draws under that reply, never under the newer reply that filed another (spec/app/calendar/agent.md, \"The card shows in Ask Alpha too, under the reply that filed its request, typed or spoken\")", async () => {
    const { world, alpha, agent } = await fileTwoCalendarRequests();
    const earlier = world.calendar.approvals.find((one) => one.id === "approval-earlier-reply")?.payload.change["fields"];
    if (typeof earlier !== "object" || earlier === null) throw new Error("no fields");
    Object.assign(earlier, { title: "camera setup, moved" });
    await press("Approve");
    await until(alpha, agent, Changes, (a) => a.result === "NotFound");
    await drawn(() => {});
    const rows = () => Array.from(document.querySelectorAll("[data-alpha-message-id]"), (row) => row.textContent ?? "");
    const at = (text: string) => rows().findIndex((row) => row.includes(text));
    const ended = "Sent, but Calendar could not find the change.";
    expect([at(ended) - at("I've proposed camera setup"), at("I've proposed lens check") > at(ended)]).toEqual([1, true]);
  });

  // spec/app/calendar/agent.md, "The card shows in Ask Alpha too, under the reply that filed its request, typed or spoken"
  it("How a request ended stays at the foot when the reply that filed it draws no row (spec/app/calendar/agent.md, \"The card shows in Ask Alpha too, under the reply that filed its request, typed or spoken\")", async () => {
    const world = morning(true);
    const { alpha, agent, request, send } = await askingCalendar(world);
    world.ask.nextReplyChunks = [""];
    world.ask.nextActions = () => {
      world.calendar.approvals.push(request("approval-blank", "camera setup", 9));
      return [{ action: "CALENDAR", data: { subaction: "create_event", approvalRequestId: "approval-blank" } }];
    };
    await send("Put camera setup on my calendar tomorrow.");
    await vi.waitFor(() => expect(askedCard()).toContain("camera setup"));
    const fields = world.calendar.approvals.find((one) => one.id === "approval-blank")?.payload.change["fields"];
    if (typeof fields !== "object" || fields === null) throw new Error("no fields");
    Object.assign(fields, { title: "camera setup, moved" });
    await press("Approve");
    await until(alpha, agent, Changes, (a) => a.result === "NotFound");
    await drawn(() => {});
    const rows = Array.from(document.querySelectorAll("[data-alpha-message-id]"), (row) => row.textContent ?? "");
    expect(rows.at(-1)).toContain("Sent, but Calendar could not find the change.");
  });

  // spec/app/calendar/agent.md, "The card shows in Ask Alpha too, under the reply that filed its request, typed or spoken"; spec/app/calendar/agent.md, "Only the owner approves, and approving sends the change once, under a new number"
  it("A request filed before a reply is never approved from that reply's card (spec/app/calendar/agent.md, \"The card shows in Ask Alpha too, under the reply that filed its request, typed or spoken\"; spec/app/calendar/agent.md, \"Only the owner approves, and approving sends the change once, under a new number\")", async () => {
    const world = morning(true);
    const { alpha, agent, file, request, declineInCalendar } = await askingCalendar(world);
    world.calendar.approvals.push(request("approval-filed-before", "old booking", 14));
    await agent.runPromise(relistRequests);
    await until(alpha, agent, Changes, (a) => a.stage === "Awaiting");

    await file("approval-this-reply", "studio call", 16);
    await drawn(() => {});
    expect([askedCard(), button("Approve")]).toEqual(["", undefined]);
    const held = await agent.runPromise(Effect.flatMap(Changes, (machine) => machine.get()));
    const other = held.filing + 1;
    const tried = await agent.runPromise(Effect.exit(Effect.flatMap(Changes, (machine) => machine.send({ type: "approve", filing: other }, "Owner"))));
    await drawn(() => {});
    expect([tried._tag, (await agent.runPromise(Effect.flatMap(Changes, (machine) => machine.get()))).stage, world.calendar.writes]).toEqual(["Failure", "Awaiting", []]);

    await declineInCalendar();
    await vi.waitFor(() => expect(askedCard()).toContain("studio call"));
    await press("Approve");
    await until(alpha, agent, Changes, (a) => a.result === "Done");
    expect(world.calendar.writes).toEqual(["reject approval-filed-before", "approve approval-this-reply", "create ev-studio-call"]);
  });
});

describe("in a browser", () => {
  it("Search my events and choose which calendars I see (spec/app/calendar/index.md, \"Story: Search my events and choose which calendars I see\")", async () => {
    const { alpha, runtime, world } = await onBrowserCalendar();
    await widen(alpha, runtime);

    // spec/app/calendar/index.md, "Search and the Calendars sheet open over the days, never over an open event"
    await press("Search events");
    await until(alpha, runtime, View, (s) => s.overlay === "Search");
    await fill("Search events", "dent");
    await tap("Dentist");
    await until(alpha, runtime, View, (s) => s.open !== 0 && s.overlay === "NoOverlay");
    expect(document.querySelector("[data-alpha-subview=calendar-detail] h1")?.textContent).toBe("Dentist");
    await press("Back to calendar");
    await until(alpha, runtime, View, (s) => s.open === 0);
    await press(dayButton(world.today + 2));
    await until(alpha, runtime, View, (s) => s.anchor === world.today + 2 && s.google.status === "Loaded");
    expect(titles()).toEqual(["Dentist"]);

    // spec/app/calendar/index.md, "A switch of the Calendars sheet hides or shows one calendar"; spec/app/calendar/presentation.md, "A hidden calendar's rows show neither in Calendar nor on Home"
    await fromMonth("Calendars");
    await until(alpha, runtime, View, (s) => s.overlay === "CalendarsSheet");
    // spec/app/calendar/presentation.md, "The agent's calendar goes by the name the agent lists for it": eliza lists its own calendar as Eliza Calendar, the name demo frame v100-077 shows.
    expect(document.querySelector("[role=dialog]")?.textContent).toContain("Eliza Calendar");
    const agent = [...document.querySelectorAll("[role=switch]")][0] as HTMLElement | undefined;
    if (!agent) throw new Error("no switch");
    agent.click();
    await until(alpha, runtime, View, (s) => s.hidden.includes(0));
    await hardware("back");
    await until(alpha, runtime, View, (s) => s.overlay === "NoOverlay");
    expect([titles(), Boolean(document.body.textContent?.includes("Free all day"))]).toEqual([[], false]);
  });

  it("Answer an invitation (spec/app/calendar/editor.md, \"Story: Delete an event, or answer an invitation\")", async () => {
    const { alpha, runtime, world } = await onBrowserCalendar();

    // spec/app/calendar/editor.md, "An invitation is answered Going or Maybe once, at the revision shown, and Decline is the deletion's decline"; spec/app/calendar/editor.md, "A confirmed answer holds its event until a read shows it"; spec/app/calendar/writing.md, "An applied create, change or answer is read back; only a read back that finds it as asked says saved"
    await tap("Team lunch");
    await until(alpha, runtime, View, (s) => s.open !== 0);
    expect([Boolean(button("Going")), Boolean(button("Maybe")), Boolean(button("No"))]).toEqual([true, true, true]);
    await press("Going");
    await until(alpha, runtime, Editor, (e) => e.kind === "Reply" && e.write.outcome === "Confirmed" && e.latched.length === 0);
    expect(world.calendar.writes).toEqual(["answer ev-team-lunch accepted"]);
  });

  async function openBrowserCalendar(extra: readonly ReturnType<typeof agentEvent>[] = []) {
    const world = morning(false);
    world.calendar.events.push(...extra);
    const { alpha } = await open(world, only("view:Calendar"));
    const runtime = calendar.runtime(alpha);
    await openCalendar(alpha);
    await until(alpha, runtime, View, (s) => s.googleRows === 2 + extra.filter((ev) => civilDay(Date.parse(ev.startAt)) === world.today).length);
    return { world, alpha, runtime };
  }

  async function openStandupEditor(alpha: Alpha, runtime: ReturnType<typeof calendar.runtime>) {
    await tap("Standup");
    await until(alpha, runtime, View, (s) => s.open !== 0);
    await press("Event actions");
    await press("Edit event");
    await until(alpha, runtime, Editor, (e) => e.shown && e.form === "EditEvent");
  }

  it('Opens a search match on the currently anchored day (spec/app/calendar/index.md, "Story: Search my events and choose which calendars I see")', async () => {
    const { alpha, runtime } = await openBrowserCalendar();
    await widen(alpha, runtime);
    await press("Search events");
    await until(alpha, runtime, View, (s) => s.overlay === "Search");
    await fill("Search events", "standup");
    const hit = [...document.querySelectorAll<HTMLButtonElement>("[aria-label='Search results'] button")]
      .find((row) => (row.getAttribute("aria-label") ?? "").includes("Standup"));
    if (!hit) throw new Error("no search match Standup");
    expect(hit.disabled).toBe(false);
    await drawn(() => hit.click());
    await until(alpha, runtime, View, (s) => s.overlay === "NoOverlay");
    expect(titles()).toContain("Standup");
  });

  it('Creates an all-day event spanning at least one whole day (spec/app/calendar/editor.md, "An event ends after it starts")', async () => {
    const { world, alpha, runtime } = await openBrowserCalendar();
    await press("New event");
    await until(alpha, runtime, Editor, (e) => e.shown && e.form === "NewEvent" && e.receipts.status === "Loaded");
    await fill("Title", "Holiday");
    const allDay = document.querySelector<HTMLElement>("[role=switch][aria-label='All day']");
    if (!allDay) throw new Error("no All day switch");
    await drawn(() => allDay.click());
    await until(alpha, runtime, Editor, (e) => e.allDay && e.titled && e.kept);
    await press("Save event");
    await until(alpha, runtime, Editor, (e) => e.form === "NoForm" && e.write.outcome === "Confirmed");
    const created = world.calendar.events.find((event) => event.title === "Holiday");
    if (!created) throw new Error("Holiday was not created");
    expect(created.isAllDay).toBe(true);
    expect(Date.parse(created.endAt)).toBeGreaterThan(Date.parse(created.startAt));
  });

  it('Clears hidden declined events after reread and keeps series reach while sending (spec/app/calendar/deletions.md, "A refused send shows the event again and says it was not deleted, and whether it changed; a sent deletion hides it until a read no longer has it unchanged")', async () => {
    const seed = morning(false);
    const { world, alpha, runtime } = await openBrowserCalendar([
      agentEvent("Weekly sync", seed.at(0, 14), seed.at(0, 15), { id: "ev-weekly-1", externalId: "ev-weekly-1", recurringEventId: "series-weekly" }),
      agentEvent("Weekly sync", seed.at(2, 14), seed.at(2, 15), { id: "ev-weekly-2", externalId: "ev-weekly-2", recurringEventId: "series-weekly" }),
    ]);

    await declineLunch(alpha, runtime);
    expect((await runtime.runPromise(Editor.use((e) => e.get()))).write.outcome).toBe("Confirmed");
    await openCalendar(alpha);
    await runtime.runPromise(View.use((v) => v.send({ type: "refresh" })));
    await until(alpha, runtime, View, (s) => s.google.status === "Loaded");
    expect((await runtime.runPromise(Held.use((d) => d.get()))).hiding).toBe(0);

    await widen(alpha, runtime);
    await fromMonth("Schedule");
    await until(alpha, runtime, View, (s) => s.layout === "Agenda" && s.overlay === "NoOverlay");
    const weeklyButton = events().find((el) => (el.getAttribute("aria-label") ?? "").includes("Weekly sync"));
    if (!weeklyButton) throw new Error("no Weekly sync row");
    await drawn(() => (weeklyButton as HTMLElement).click());
    await until(alpha, runtime, View, (s) => s.open !== 0);
    await chooseEventAction("Delete the series");
    await until(alpha, runtime, Held, (d) => d.asked !== 0);
    await press("Delete");
    await until(alpha, runtime, Held, (d) => d.waiting !== 0);
    world.calendar.stalled = true;
    await hardware("home");
    await until(alpha, runtime, Held, (d) => d.waiting === 0 && d.sending !== 0);
    await openCalendar(alpha);
    await drawn(() => {});
    const remainingWeekly = events().filter((el) => (el.getAttribute("aria-label") ?? "").includes("Weekly sync"));
    expect(remainingWeekly).toHaveLength(0);
  });

  it('Reloads saved fields when choosing Use the saved event on an edit conflict (spec/app/calendar/editor.md, "Story: Write an event")', async () => {
    const { world, alpha, runtime } = await openBrowserCalendar();
    await openStandupEditor(alpha, runtime);
    await fill("Title", "Standup draft");
    await until(alpha, runtime, Editor, (e) => e.draft.edits === 1 && e.kept);
    const serverStandup = world.calendar.events.find((event) => event.id === "ev-standup");
    if (!serverStandup) throw new Error("no Standup event");
    serverStandup.title = "Standup renamed";
    serverStandup.updatedAt = new Date(Date.parse(serverStandup.updatedAt) + 60_000).toISOString();
    serverStandup.metadata = { ...serverStandup.metadata, etag: "2" };
    await runtime.runPromise(View.use((v) => v.send({ type: "refresh" })));
    await until(alpha, runtime, Editor, (e) => e.draft.sync === "Conflicted");
    await press("Use the saved event");
    await until(alpha, runtime, Editor, (e) => e.draft.sync === "Kept");
    const titleInput = document.querySelector<HTMLInputElement>("input[aria-label='Title']");
    expect(titleInput?.value).toBe("Standup renamed");
  });

  it('Reads back an edited agent event at its new date when moved outside the old read window (spec/app/calendar/writing.md, "An applied create, change or answer is read back; only a read back that finds it as asked says saved")', async () => {
    const { world, alpha, runtime } = await openBrowserCalendar();
    await openStandupEditor(alpha, runtime);
    const futureDate = dateOf(world.today + 90);
    const isoDay = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, "0")}-${String(futureDate.getDate()).padStart(2, "0")}`;
    await fill("Calendar date", isoDay);
    await until(alpha, runtime, Editor, (e) => e.draft.edits >= 1 && e.kept);
    await press("Save event");
    await until(alpha, runtime, Editor, (e) => e.write.outcome !== "Sent");
    const after = await runtime.runPromise(Editor.use((e) => e.get()));
    expect([after.form, after.write.outcome, after.latched]).toEqual(["NoForm", "Confirmed", []]);
  });

  it('Disables series-wide edit scopes on a managed Google repeating event (spec/app/calendar/writing.md, "A managed Google event is never deleted here, and its other repeating changes reach one occurrence")', async () => {
    const seed = morning(false);
    const { alpha, runtime } = await openBrowserCalendar([
      agentEvent("Google recurring", seed.at(0, 16), seed.at(0, 17), {
        id: "ev-google-rec",
        externalId: "ev-google-rec",
        provider: "google",
        recurringEventId: "series-g1",
        metadata: { etag: "1", managed: true },
      }),
    ]);

    const row = events().find((el) => (el.getAttribute("aria-label") ?? "").includes("Google recurring"));
    if (!row) throw new Error("no Google recurring row");
    await drawn(() => (row as HTMLElement).click());
    await until(alpha, runtime, View, (s) => s.open !== 0);
    await press("Event actions");
    await press("Edit event");
    await until(alpha, runtime, Editor, (e) => e.shown && e.form === "EditEvent" && e.repeats);
    expect(button("This event")?.disabled).toBe(false);
    expect(button("This and following")?.disabled).toBe(true);
    expect(button("All events")?.disabled).toBe(true);
  });

  it("Decline an invitation from its card (spec/app/calendar/editor.md, \"Story: Delete an event, or answer an invitation\")", async () => {
    const world = morning(false);
    const { alpha } = await open(world, only("view:Calendar"));
    const runtime = calendar.runtime(alpha);
    await openCalendar(alpha);
    await until(alpha, runtime, View, (s) => s.front && s.googleRows === 2);

    // spec/app/calendar/writing.md, "An invitee answers Going or Maybe from the invitation; Decline stays the deletion's decline"; spec/app/calendar/deletions.md, "Delete asks first, over the open event: what goes, from which calendar, when, which occurrences, and that no guest is told"
    await press("Decline invite");
    await until(alpha, runtime, Held, (d) => d.asked !== 0 && d.waiting === 0);
    await until(alpha, runtime, View, (s) => s.open !== 0);
    const declineDialog = document.querySelector("[role=alertdialog]");
    const declineTitleId = declineDialog?.getAttribute("aria-labelledby");
    expect(declineTitleId ? document.getElementById(declineTitleId)?.textContent : declineDialog?.getAttribute("aria-label")).toBe("Decline invitation?");
    // spec/app/calendar/deletions.md, "Confirming the review holds the deletion; a deletion still waiting is sent first, so the only Undo shown is the newest"
    await press("Decline");
    await until(alpha, runtime, Held, (d) => d.asked === 0 && d.waiting !== 0);
    expect(titles()).not.toContain("Team lunch");
  });
});

describe("Calendar Wave 1 regressions", () => {
  it('Serializes description on agent payloads and exclusive next-day endAt for all-day events (spec/app/calendar/writing.md, "An agent update to an all-day event names whole UTC dates")', () => {
    const baseDay = civilDay(new Date(2026, 10, 24, 10, 0).getTime());
    const begin = wallDateTime(baseDay, 10, 0);
    const end = wallDateTime(baseDay, 11, 0);
    const timed = agentFields({ title: "Sync", place: "Room A", notes: "Bring notes", begin, end, allDay: false, people: "" });
    expect(timed.description).toBe("Bring notes");
    expect("notes" in timed).toBe(false);
    const sameDayAllDay = agentFields({ title: "Holiday", place: "", notes: "Out of office", begin, end, allDay: true, people: "" });
    expect(sameDayAllDay.startAt).toBe(utcDate(baseDay));
    expect(sameDayAllDay.endAt).toBe(utcDate(baseDay + 1));
    expect(Date.parse(sameDayAllDay.endAt)).toBeGreaterThan(Date.parse(sameDayAllDay.startAt));
    expect(sameDayAllDay.description).toBe("Out of office");
  });

  it('Preserves local wall-clock time across civil day shifts and classifies valid wall times (spec/app/calendar/writing.md, "A missing or repeated wall time is refused, and nothing is saved")', () => {
    const startDay = civilDay(new Date(2026, 2, 7, 10, 30).getTime());
    const original = wallDateTime(startDay, 10, 30);
    const shifted = shiftDays(original, 2);
    expect(shifted.kind).toBe("WallExists");
    const moved = new Date(shifted.ms);
    expect([moved.getHours(), moved.getMinutes(), civilDay(shifted.ms)]).toEqual([10, 30, startDay + 2]);
    expect(localWallTime(startDay, 14, 15).kind).toBe("WallExists");
  });

  it(`Scopes ShownStore per instance, clears metadata on drop, and merges single-event reads without clearing partial (spec/app/calendar/index.md, "A changed owner clears the agent's rows, closes the open event and the Calendars sheet, and takes that owner's hidden calendars")`, () => {
    const store = createShownStore();
    const day = civilDay(new Date(2026, 10, 24, 9, 0).getTime());
    const sample = {
      key: "ev-1", calendarId: "eliza-calendar/primary", title: "Private", place: "", notes: "",
      begin: wallDateTime(day, 10, 0), end: wallDateTime(day, 11, 0), allDay: false, recurring: false, repeat: "",
      link: "", video: "", people: [], answer: "NotInvited" as const, answerable: false, managed: false,
      series: "", editable: true, cancel: "OrganizerCancel" as const, version: "1",
    };
    const other = { ...sample, key: "ev-2", title: "Keep me", begin: wallDateTime(day, 12, 0), end: wallDateTime(day, 13, 0) };
    const keptRows = store.keep("Google", day, [sample, other], true);
    expect(store.partial("Google")).toBe(true);
    const id = keptRows[0]?.id ?? 0;
    store.mergeOne("Google", { ...sample, title: "Updated" });
    expect(store.partial("Google")).toBe(true);
    expect(store.all("Google").map((row) => row.title)).toEqual(["Updated", "Keep me"]);
    store.drop("Google");
    expect([store.all("Google").length, store.lastSeen(id), store.partial("Google"), store.revisions().length]).toEqual([0, undefined, false, 0]);
  });

  it('Verifies target startMatches and decodes persisted requests via Schema (spec/app/calendar/agent.md, "A card is complete only with known fields, a valid time and, for a change, a verified target")', () => {
    const store = createRequestsStore();
    const day = civilDay(new Date(2026, 10, 24, 9, 0).getTime());
    const begin = wallDateTime(day, 12, 0);
    const end = wallDateTime(day, 13, 0);
    const row = createShownStore().keep("Google", day, [{
      key: "ev-lunch", calendarId: "eliza-calendar/primary", title: "Lunch", place: "", notes: "",
      begin, end, allDay: false, recurring: false, repeat: "", link: "", video: "", people: [], answer: "AnswerAwaited",
      answerable: true, managed: false, series: "", editable: true, cancel: "DeclineInvitation", version: "v1",
    }])[0];
    if (!row) throw new Error("missing row");
    const matching = store.fromWire(agentRequest("req-1", {
      action: "respond_invitation", account: "owner", scope: "instance", response: "accepted",
      target: { source: { calendarId: "eliza-calendar/primary" }, eventId: "ev-lunch", startAt: new Date(begin).toISOString(), expectedVersion: "v1" },
    }), 0);
    const movedStart = store.fromWire(agentRequest("req-2", {
      action: "respond_invitation", account: "owner", scope: "instance", response: "accepted",
      target: { source: { calendarId: "eliza-calendar/primary" }, eventId: "ev-lunch", startAt: new Date(begin + hour).toISOString(), expectedVersion: "v1" },
    }), 1);
    if (!matching || !movedStart) throw new Error("missing requests");
    expect(complete(matching, [row])).toBe(true);
    expect(complete(movedStart, [row])).toBe(false);
    expect(decodeRequest(JSON.stringify(matching))?.id).toBe("req-1");
    expect(decodeRequest("not-json")).toBeUndefined();
    expect(decodeRequest(JSON.stringify({ filing: "bad" }))).toBeUndefined();
  });

  it("Keeps Ends on visible for all-day events, keeps new Phone repeats on direct save, and enforces inertness and deleted filtering (spec/app/calendar/writing.md, \"Guests, alerts and video rooms go to Android Calendar; zones, all-day and repeats use the direct save for a new event\")", async () => {
    const world = morning(true);
    world.calendar.granted = true;
    const { alpha, runtime } = await mountCalendar(world, only("view:Calendar", "notice"), (s) => s.phoneRows === 1 && s.googleRows === 2);

    // spec/app/calendar/index.md, "The layout menu and the month dialog open over the days, never over an open event, a form or a delete review"
    await chooseDate();
    await until(alpha, runtime, View, (s) => s.overlay === "MonthDialog");
    expect(document.querySelector("[data-alpha-subview=calendar-list]")?.hasAttribute("inert")).toBe(true);
    await hardware("back");
    await until(alpha, runtime, View, (s) => s.overlay === "NoOverlay");

    // spec/app/calendar/writing.md, "Guests, alerts and video rooms go to Android Calendar; zones, all-day and repeats use the direct save for a new event"
    await press("New event");
    await until(alpha, runtime, Editor, (e) => e.shown && e.receipts.status === "Loaded");
    await fill("Title", "Weekly run");
    await press("This phone's calendar");
    await press("Weekly");
    await until(alpha, runtime, Editor, (e) => e.repeats && !e.extras);
    expect(button("Open in Android Calendar")).toBeUndefined();
    await press("Eliza Calendar");
    await until(alpha, runtime, Editor, (e) => !e.repeats && !e.extras);
    await press("All day");
    expect(document.querySelector('input[aria-label="End date"]')).not.toBeNull();
    await hardware("back");
    await until(alpha, runtime, Editor, (e) => !e.shown);
    await press("Discard event draft");
    await press("Discard it");
    await until(alpha, runtime, Editor, (e) => e.form === "NoForm");

    // spec/app/calendar/deletions.md, "Confirming the review holds the deletion; a deletion still waiting is sent first, so the only Undo shown is the newest"
    await tap("Gym");
    await until(alpha, runtime, View, (s) => s.open !== 0);
    await chooseEventAction("Edit event");
    await until(alpha, runtime, Editor, (e) => e.shown && e.form === "EditEvent");
    expect(document.querySelector("[data-alpha-subview=calendar-detail]")?.hasAttribute("inert")).toBe(true);
    await hardware("back");
    await until(alpha, runtime, Editor, (e) => !e.shown);
    await deleteOpenEvent(alpha, runtime);
    await until(alpha, runtime, View, (s) => s.open === 0);
    await press("Search events");
    await until(alpha, runtime, View, (s) => s.overlay === "Search");
    await fill("Search events", "Gym");
    expect(titles()).not.toContain("Gym");
    await press("Undo");
    await until(alpha, runtime, Held, (d) => d.waiting === 0);
  });

  it("Preserves Google connected state on transient 503, marks Link unready on browser failure, and expires agent proposals (spec/app/calendar/link.md, \"Cloud overload is unavailable and retryable, never a changed account\"; spec/app/calendar/agent.md, \"The status follows the request's state and whether its owner was verified\")", async () => {
    const world = morning(false);
    const { alpha, runtime } = await mountCalendar(world, only("view:Calendar", "notice"), (s) => s.connected && s.google.status === "Loaded" && s.googleRows === 2);

    // spec/app/calendar/agent.md, "The status follows the request's state and whether its owner was verified"
    const start = new Date(world.at(1, 15)).toISOString();
    const end = new Date(world.at(1, 16)).toISOString();
    const expiring = agentRequest("approval-exp", {
      action: "schedule_event", account: "owner", source: { calendarId: "eliza-calendar/primary" }, recurrence: null,
      fields: { title: "Quick chat", description: "", location: "", startAt: start, endAt: end, isAllDay: false, timeZone: "UTC" },
    });
    expiring.expiresAt = new Date(world.now + 5_000).toISOString();
    world.calendar.approvals.push(expiring);
    await runtime.runPromise(View.use((machine) => machine.send({ type: "refresh" })));
    await until(alpha, runtime, Changes, (a) => a.stage === "Awaiting" && a.complete);
    expect(Boolean(button("Approve"))).toBe(true);
    await later(alpha, 6_000);
    await drawn(() => {});
    expect(document.body.textContent?.includes("Expired")).toBe(true);
    expect(Boolean(button("Approve"))).toBe(false);
    await press("Decline");
    await until(alpha, runtime, Changes, (a) => a.stage === "Idle" && a.result === "Declined");
    const reqStore = await runtime.runPromise(Effect.flatMap(Requests, (store) => Effect.succeed(store)));
    expect(reqStore.lastResult(1)).toBe("Declined");

    // spec/app/calendar/link.md, "Cloud overload is unavailable and retryable, never a changed account"
    world.calendar.down = true;
    await runtime.runPromise(View.use((machine) => machine.send({ type: "refresh" })));
    await until(alpha, runtime, View, (s) => s.google.status === "Failed");
    expect((await runtime.runPromise(View.use((machine) => machine.get()))).connected).toBe(true);
    await until(alpha, runtime, Link, (l) => !l.ready);
  });

  it('Unhides declined invitations via readShows once the calendar read shows the decline (spec/app/calendar/deletions.md, "A refused send shows the event again and says it was not deleted, and whether it changed; a sent deletion hides it until a read no longer has it unchanged")', async () => {
    const world = morning(false);
    const { alpha, runtime } = await mountCalendar(world, only("view:Calendar", "notice"), (s) => s.googleRows === 2);
    await answerNoToLunch(alpha, runtime);
    await until(alpha, runtime, Held, (d) => d.waiting !== 0 && d.notice);
    await later(alpha, 10_000);
    await later(alpha, 1_000);
    await until(alpha, runtime, Held, (d) => d.waiting === 0 && d.sending === 0 && d.hiding === 0);
    expect(titles()).toContain("Team lunch");
  });
});

describe("the agent on a phone", () => {
  /** Calendar on a phone that may read Android's calendar, once it shows Google's two rows and the phone's one. */
  async function onGrantedPhone() {
    const world = morning(true);
    world.calendar.granted = true;
    return mountCalendar(world, only("view:Calendar"), (s) => s.front && s.googleRows === 2 && s.phoneRows === 1);
  }

  it("Let the assistant act only on what I have open (spec/app/calendar/index.md, \"Story: Let the assistant act only on what I have open\")", async () => {
    const { world, alpha, runtime } = await onGrantedPhone();

    // spec/app/calendar/index.md, "The assistant is given the open event only while it shows, and the day shown only on a plain, current day"
    await vi.waitFor(() => expect(subjectNow()).toEqual({ day: world.today, event: undefined }));
    await tap("Standup");
    await until(alpha, runtime, View, (s) => s.open !== 0 && s.detail === "Showing");
    await vi.waitFor(() => expect(subjectNow()).toEqual({ day: 0, event: { kind: "canonical-calendar-event", id: "ev-standup", revision: "1" } }));
    await hardware("back");
    await until(alpha, runtime, View, (s) => s.open === 0);
    await vi.waitFor(() => expect(subjectNow()).toEqual({ day: world.today, event: undefined }));
  });

  it("Let the agent change my phone's calendar only through my reviews (spec/app/calendar/actions.md, \"Story: Let the agent change my phone's calendar only through my reviews\"; spec/app/calendar/sharing.md, \"Story: Let a reviewed step read my phone's calendars for the range I approved\"; spec/app/calendar/sharing.md, \"Story: Be told plainly what the agent was shown of an event I named\")", async () => {
    const { world, alpha } = await onGrantedPhone();
    const call = (id: string) => ({ proposalId: id, operationId: id, attemptId: 1 });
    const approved = { current: () => Promise.resolve(true) };
    const fields = { title: "Haircut", description: "", location: "", start: new Date(world.at(1, 9)).toISOString(), end: new Date(world.at(1, 10)).toISOString(), timeZone: "UTC" };

    // spec/app/calendar/actions.md, "Creating on the phone and reading next ask Android for access first; a refusal fails before the phone's review"; spec/app/calendar/actions.md, "The phone reads the open event again; a changed one is refused there, and a cancelled review changes nothing"
    expect(await executeMedia(alpha, { type: "calendar_create_local", fields }, call("create-1"), approved)).toEqual({
      kind: "applied", result: { version: 1, kind: "calendar_create_local", sourceId: "local", eventId: "p2", revision: "0".repeat(64) },
    });
    world.calendar.review = "cancelled";
    expect(await executeMedia(alpha, { type: "calendar_read_next" }, call("next-1"), approved)).toEqual({ kind: "refused", code: "cancelled" });
    expect(world.calendar.reviewed).toEqual(["calendar_create_local create-1", "calendar_read_next next-1"]);

    // spec/app/calendar/actions.md, "There is no direct path: the only way in is the owner's card on the bound screen": no event is open, so nothing reaches the phone's review.
    const target = { sourceId: "local", sourceRevision: "1".repeat(64), eventId: "p1", revision: "2".repeat(64) };
    expect(await executeMedia(alpha, { type: "calendar_delete", target }, call("delete-1"), approved)).toEqual({ kind: "refused", code: NOT_DISPATCHED });
    expect(world.calendar.reviewed).toHaveLength(2);

    // spec/app/calendar/sharing.md, "The phone's Share review is offered only for the event open on a Calendar screen that is not sensitive"; spec/app/calendar/sharing.md, "What Calendar tells the agent says shared exactly when the event was shared, and otherwise why not"
    expect(await executeMedia(alpha, { type: "calendar_named", action: "read", name: "Gym" }, call("named-1"), approved)).toEqual({
      kind: "refused", code: "not_shared", result: { summary: "Open the event in Calendar first. Nothing was shared." },
    });

    // spec/app/calendar/sharing.md, "A range is read only while Calendar can be seen and Android lets it read the calendar"; spec/app/calendar/sharing.md, "Only a whole read within the step's limit is shared, with titles and times alone"
    const range = { type: "read_calendar_range", calendarIds: ["local"], start: new Date(world.at(0, 0)).toISOString(), end: new Date(world.at(1, 0)).toISOString(), timeZone: "UTC", maximumEvents: 5 } as const;
    expect(await executeMedia(alpha, range, call("range-1"), approved)).toMatchObject({ kind: "applied", result: { kind: "calendar", events: [{ id: "p1", title: "Gym" }] } });
    expect(await executeMedia(alpha, { ...range, maximumEvents: 0 }, call("range-2"), approved)).toMatchObject({ kind: "refused" });
  });

  it("Choose the calendars and see the answer before it is shared (spec/app/calendar/sharing.md, \"Story: Choose the calendars and see the answer before it is shared\"; spec/app/calendar/sharing.md, \"Story: Offer the agent only the Calendar actions this phone runs\")", async () => {
    const world = morning(true);
    world.calendar.granted = true;
    world.calendar.calendars.push({ id: "work", name: "Work", account: "owner@alpha.test", writable: true, local: false });
    world.calendar.phoneEvents.push(
      { id: "p9", calendarId: "local", title: "Probe single", begin: world.at(0, 13), end: world.at(0, 13.5), allDay: false, recurring: false },
      { id: "p10", calendarId: "local", title: "Focus", begin: world.at(0, 13), end: world.at(0, 14), allDay: false, recurring: false },
    );
    world.calendar.marked.set("p10", "free");
    const { alpha } = await open(world, [...only("home"), availabilitySheet]);
    await coverLifted(alpha);
    const check = availabilityCheck(world, 13, 13.5);

    // spec/app/calendar/sharing.md, "A local event is always offered; the agenda read only in a browser; every other action only when the agent offers it"
    expect(calendarCapabilities([CALENDAR_CAPABILITY, CALENDAR_AVAILABILITY_CAPABILITY])).toContain(CALENDAR_AVAILABILITY_CAPABILITY);
    expect(calendarCapabilities([CALENDAR_CAPABILITY])).not.toContain(CALENDAR_AVAILABILITY_CAPABILITY);

    // spec/app/calendar/sharing.md, "The sheet offers the phone's calendars with none ticked, reads only the ticked ones, and shares only a free or busy answer it showed": from Home, Calendar does not start and only Home's own day card reads the phone, no event is read before Check, the busy row is shown busy and the free one ignored, and it is shared once read again.
    const booted = [...world.calendar.eventReads];
    expect(booted).toEqual(["list"]);
    const busy = executeMedia(alpha, check, availabilityCall("availability-1"), approved);
    await availabilitySheetShows("Calendars");
    expect([tickBox("Phone · On this phone")?.getAttribute("aria-checked"), tickBox("Work · owner@alpha.test")?.getAttribute("aria-checked")]).toEqual(["false", "false"]);
    expect([button("Check")?.disabled, world.calendar.eventReads]).toEqual([true, booted]);
    await drawn(() => tickBox("Phone · On this phone")?.click());
    await press("Check");
    await availabilitySheetShows("Share availability");
    expect(document.querySelector("[role=dialog][aria-label='Share availability'] h2")?.textContent).toBe("Busy");
    await press("Share with agent");
    expect(await busy).toEqual({
      kind: "applied",
      result: { version: 1, kind: "calendar_availability", window: { start: check.start, end: check.end, timeZone: check.timeZone }, calendarCount: 1, status: "busy", busy: [{ start: check.start, end: check.end, allDay: false, tentative: false }], transparentIgnored: 1 },
    });
    expect(world.calendar.eventReads).toEqual([...booted, "readAvailability local", "readAvailability local"]);

    // spec/app/calendar/sharing.md, "The phone can say the owner is free only when every calendar chosen lives on this phone": with Android's read access alone, the phone's own calendar still answers.
    world.calendar.granted = false;
    world.calendar.readOnly = true;
    const readOnly = executeMedia(alpha, check, availabilityCall("availability-2"), approved);
    await availabilitySheetShows("Calendars");
    await drawn(() => tickBox("Phone · On this phone")?.click());
    await press("Check");
    await availabilitySheetShows("Share availability");
    await press("Share with agent");
    expect(await readOnly).toMatchObject({ kind: "applied", result: { status: "busy" } });

    // spec/app/calendar/sharing.md, "The sheet offers the phone's calendars with none ticked, reads only the ticked ones, and shares only a free or busy answer it showed": leaving Home closes the sheet, and nothing is read or shared.
    const reads = world.calendar.eventReads.length;
    const left = executeMedia(alpha, check, availabilityCall("availability-3"), approved);
    await availabilitySheetShows("Calendars");
    await openView(alpha, "Notes");
    expect(await left).toEqual({ kind: "refused", code: "not_shared", result: { summary: "Availability check cancelled. No calendar was read. Nothing was shared." } });
    expect([document.querySelector("[role=dialog][aria-label='Calendars']"), world.calendar.eventReads.length]).toEqual([null, reads]);

    // spec/app/calendar/sharing.md, "A check is asked only on Home or Calendar, while Alpha can be seen, on a screen that is not sensitive": from another app nothing is asked and nothing is read.
    const asked = world.calendar.asked;
    expect(await executeMedia(alpha, check, availabilityCall("availability-4"), approved)).toEqual({ kind: "refused", code: NOT_DISPATCHED });
    expect([world.calendar.asked, world.calendar.eventReads.length]).toEqual([asked, reads]);
  });

  it("Choose the calendars on Calendar, and never be shown free when the phone cannot tell (spec/app/calendar/sharing.md, \"Story: Choose the calendars and see the answer before it is shared\")", async () => {
    const world = morning(true);
    world.calendar.granted = true;
    world.calendar.calendars.push({ id: "work", name: "Work", account: "owner@alpha.test", writable: true, local: false });
    const { alpha } = await mountCalendar(world, [...only("view:Calendar"), availabilitySheet], (s) => s.front && s.phoneRows >= 1);
    const check = availabilityCheck(world, 15, 15.5);
    const checks = () => world.calendar.eventReads.filter((read) => read !== "list");

    // spec/app/calendar/sharing.md, "The phone can say the owner is free only when every calendar chosen lives on this phone": a synced calendar is unknown, never free, no answer is shown and no event is read.
    const synced = executeMedia(alpha, check, availabilityCall("availability-1"), approved);
    await availabilitySheetShows("Calendars");
    await drawn(() => tickBox("Work · owner@alpha.test")?.click());
    await press("Check");
    expect(await synced).toEqual({ kind: "refused", code: "not_shared", result: { summary: "Calendar freshness could not be verified, so your availability is unknown. Nothing was shared." } });
    expect([document.querySelector("[role=dialog][aria-label='Share availability']"), checks()]).toEqual([null, []]);

    // spec/app/calendar/sharing.md, "The sheet offers the phone's calendars with none ticked, reads only the ticked ones, and shares only a free or busy answer it showed": Cancel reads nothing, a free answer that changed before Share is not shared, and nor is one whose approval no longer holds.
    const cancelled = executeMedia(alpha, check, availabilityCall("availability-2"), approved);
    await availabilitySheetShows("Calendars");
    await press("Cancel");
    expect(await cancelled).toEqual({ kind: "refused", code: "not_shared", result: { summary: "Availability check cancelled. No calendar was read. Nothing was shared." } });
    expect(checks()).toEqual([]);
    const changed = executeMedia(alpha, check, availabilityCall("availability-3"), approved);
    await availabilitySheetShows("Calendars");
    await drawn(() => tickBox("Phone · On this phone")?.click());
    await press("Check");
    await availabilitySheetShows("Share availability");
    expect(document.querySelector("[role=dialog][aria-label='Share availability'] h2")?.textContent).toBe("Free");
    world.calendar.phoneEvents.push({ id: "p11", calendarId: "local", title: "Call", begin: world.at(0, 15), end: world.at(0, 15.25), allDay: false, recurring: false });
    await press("Share with agent");
    expect(await changed).toEqual({ kind: "refused", code: "not_shared", result: { summary: "Your calendar changed during this review. Review the availability check again. Nothing was shared." } });
    const lapsed = executeMedia(alpha, check, availabilityCall("availability-4"), { current: () => Promise.resolve(false) });
    await availabilitySheetShows("Calendars");
    await drawn(() => tickBox("Phone · On this phone")?.click());
    await press("Check");
    await availabilitySheetShows("Share availability");
    await press("Share with agent");
    expect(await lapsed).toEqual({ kind: "refused", code: "not_shared", result: { summary: "The phone, calendars or connection changed before this availability check finished. Nothing was shared." } });

    // spec/app/calendar/sharing.md, "A check is asked only on Home or Calendar, while Alpha can be seen, on a screen that is not sensitive": a hidden page asks nothing and reads nothing, and refused access reads nothing.
    const [asked, reads] = [world.calendar.asked, checks().length];
    await seen(false);
    expect(await executeMedia(alpha, check, availabilityCall("availability-5"), approved)).toEqual({ kind: "refused", code: NOT_DISPATCHED });
    await seen(true);
    expect([world.calendar.asked, checks().length]).toEqual([asked, reads]);
    world.calendar.granted = false;
    expect(await executeMedia(alpha, check, availabilityCall("availability-6"), approved)).toEqual({ kind: "refused", code: "not_shared", result: { summary: "Calendar access was not allowed, so no calendar was read. Nothing was shared." } });
    expect(checks().length).toBe(reads);
  });
});
