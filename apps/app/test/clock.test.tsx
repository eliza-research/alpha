// @vitest-environment happy-dom
import type { ClockSnapshot } from "@repo/launcher-records";
import { type Context, Effect, Layer, type Stream } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";
import { afterEach, describe, expect, it } from "vitest";
import * as ClockView from "../gen/app__clock.effect.vibe";
import * as Alarms from "../gen/app__clock__alarms.effect.vibe";
import * as Stopwatch from "../gen/app__clock__stopwatch.effect.vibe";
import * as Timers from "../gen/app__clock__timers.effect.vibe";
import * as World from "../gen/app__clock__world.effect.vibe";
import * as Toasts from "../gen/app__notices__toasts.effect.vibe";
import { Machine as Home } from "../gen/app__home.effect.vibe";
import * as Shell from "../gen/app__shell.effect.vibe";
import { at } from "../src/areas.ts";
import alertOverlayArea from "../src/clock/alertOverlay.tsx";
import clockCardsArea from "../src/clock/cards.tsx";
import { WORLD_CITIES } from "../src/clock/cities.ts";
import clockArea from "../src/clock/index.tsx";
import { createClockRecords } from "../src/clock/records.ts";
import { activeClockRecords, activeClockTicks } from "../src/clock/shelf.vibe";
import { syncClockNow } from "../src/clock/sync.vibe";
import { nextAlarmFireAt } from "../src/clock/time.ts";
import home from "../src/home/index.tsx";
import { agentAt } from "../src/platform/agent.vibe";
import { phoneClockAlerts } from "../src/platform/clock-alerts.vibe";
import { cloudAt } from "../src/platform/cloud.vibe";
import { pagePlatform } from "../src/platform/platform.vibe";
import { button, closeAll, drawn, fill, only, openOver, press, pressOnTop, seen, underAct, until } from "./alpha.tsx";
import { installClockScheduler } from "./fakes/clock.ts";
import { answering, fetched } from "./fakes/routes.ts";

underAct();

interface RemoteClock {
  snapshot: ClockSnapshot;
  puts: number;
  gets: number;
  offline: boolean;
  waitForPut: () => Promise<void>;
  notifyPut: () => void;
}

function emptyRemote(nowMs: number): RemoteClock {
  const waiters: (() => void)[] = [];
  return {
    snapshot: { version: 0, updatedAtMs: nowMs, alarms: [], timers: [], world: [], deletedAlarmIds: [], deletedTimerIds: [] },
    puts: 0,
    gets: 0,
    offline: false,
    waitForPut() {
      return new Promise((resolve) => {
        waiters.push(resolve);
      });
    },
    notifyPut() {
      for (const resolve of waiters.splice(0)) resolve();
    },
  };
}

function fakeHttp(answer: ReturnType<typeof answering>) {
  return Layer.succeed(HttpClient.HttpClient, HttpClient.make((request, url, signal) => Effect.tryPromise({
    try: () => fetched(answer, url, { method: request.method, headers: request.headers, body: request.body._tag === "Uint8Array" ? request.body.body : undefined, signal }),
    catch: (cause) => new HttpClientError.HttpClientError({ reason: new HttpClientError.TransportError({ request, cause }) }),
  }).pipe(Effect.map((response) => HttpClientResponse.fromWeb(request, response)))));
}

const withClock = [
  ...only("home", "notice"),
  at("view:Clock", () => Promise.resolve({ default: clockArea })),
  at("overlay", () => Promise.resolve({ default: alertOverlayArea })),
  at("home/cards", () => Promise.resolve({ default: clockCardsArea })),
];

function makePlatform(startMs: number, remote: RemoteClock) {
  const agentAnswer = answering([
    (request, url) => (request.method === "GET" && url.pathname === "/api/health" ? Response.json({ ready: true }) : undefined),
    (request, url) => {
      if (url.pathname !== "/api/alpha/clock") return undefined;
      if (remote.offline) return new Response("offline", { status: 503 });
      if (request.method === "GET") {
        remote.gets += 1;
        return Response.json(remote.snapshot);
      }
      if (request.method === "PUT") {
        remote.puts += 1;
        return request.json().then((body) => {
          remote.snapshot = body as ClockSnapshot;
          remote.notifyPut();
          return Response.json(remote.snapshot);
        });
      }
      return undefined;
    },
  ]);
  const cloudAnswer = answering([]);
  return Layer.provideMerge(
    pagePlatform(
      Layer.provide(agentAt("http://agent.test"), fakeHttp(agentAnswer)),
      Layer.provide(cloudAt("http://cloud.test"), fakeHttp(cloudAnswer)),
    ),
    Layer.provideMerge(Layer.effectDiscard(TestClock.setTime(startMs)), TestClock.layer()),
  );
}

let scheduler: ReturnType<typeof installClockScheduler> | undefined;
afterEach(async () => {
  await closeAll();
  scheduler?.unplug();
  scheduler = undefined;
  document.body.innerHTML = "";
});

async function mountClock(startMs: number, remote: RemoteClock, onDevice = false) {
  const page = makePlatform(startMs, remote);
  const platform = onDevice ? Layer.merge(page, phoneClockAlerts) : page;
  const { alpha, close } = await openOver(platform, withClock);
  const runtime = clockArea.runtime(alpha);
  const currentShell = await alpha.runtime.runPromise(Shell.Machine.use((m) => m.get()));
  if (!Shell.showing(currentShell, "Clock")) {
    await until(alpha, home.runtime(alpha), Home, (h) => h.tiles.load.status === "Loaded");
    await press("Clock");
  }
  await until(alpha, alpha.runtime, Shell.Machine, (s) => Shell.showing(s, "Clock"));
  await until(alpha, runtime, ClockView.Machine, () => true);

  const advance = async (ms: number) => {
    await drawn(() => alpha.runtime.runPromise(TestClock.adjust(ms)));
  };
  const waitFor = async <I, S>(key: Context.Key<I, { readonly changes: Stream.Stream<S> }>, ok: (state: S) => boolean) => {
    await until(alpha, runtime as never, key as never, ok);
  };
  return { alpha, runtime, advance, waitFor, close };
}

function clickTab(name: string) {
  return drawn(() => {
    const tab = [...document.querySelectorAll<HTMLElement>("[role=tab]")].find((el) => el.textContent === name);
    if (!tab) throw new Error(`no tab ${name}`);
    tab.focus();
    tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    tab.click();
  });
}

describe("Clock journeys", () => {
  it("Alarms create, edit, toggle, undoable delete with real Toasts, ring, snooze, dismiss, and missed recovery (spec/app/clock/alarms.md, \"Story: Manage my alarms\"; spec/app/clock/alarms.md, \"Story: Ring, snooze, dismiss, and recover alarms\")", async () => {
    const startMs = new Date(2026, 10, 24, 6, 58, 0, 0).getTime();
    const remote = emptyRemote(startMs);
    const { runtime, advance, waitFor } = await mountClock(startMs, remote);

    // spec/app/clock/index.md, "Back closes an open sheet before leaving Clock"
    expect(clockArea).toBeDefined();
    expect(alertOverlayArea).toBeDefined();
    expect(clockCardsArea).toBeDefined();
    await press("Add alarm");
    await waitFor(ClockView.Machine, (s) => s.sheet.tag === "NewAlarm");
    await drawn(() => runtime.runPromise(ClockView.Machine.use((m) => m.send({ type: "back" }))));
    await waitFor(ClockView.Machine, (s) => s.sheet.tag === "NoSheet");

    // spec/app/clock/alarms.md, "Creating an alarm assigns the next id and schedules it enabled when under the limit"
    await press("Add alarm");
    await fill("Alarm label", "Morning workout");
    await pressOnTop("Weekdays");
    await pressOnTop("Save");
    await waitFor(Alarms.Machine, (s) => s.items.length === 1);
    expect(document.body.textContent).toContain("Morning workout");
    expect(document.body.textContent).toContain("Weekdays");
    expect(document.body.textContent).toContain("7:00");
    // spec/app/clock/alarms.md, "A new alarm snoozes for ten minutes until the owner picks another length"
    await waitFor(Alarms.Machine, (s) => s.items[0]?.snoozeMinutes === 10);

    // spec/app/clock/alarms.md, "Toggling an alarm enables it for its next fire time or disables it cleanly to idle"
    const toggle = document.querySelector<HTMLElement>("[role=switch][aria-label^='Toggle alarm']");
    if (!toggle) throw new Error("missing alarm toggle");
    await drawn(() => toggle.click());
    await waitFor(Alarms.Machine, (s) => s.items[0]?.enabled === false);
    await drawn(() => toggle.click());
    await waitFor(Alarms.Machine, (s) => s.items[0]?.enabled === true);

    // spec/app/clock/alarms.md, "Deleting an alarm holds it for a five-second Undo window before committing removal"
    await press("Add alarm");
    await fill("Alarm label", "Backup alarm");
    await pressOnTop("Save");
    await waitFor(Alarms.Machine, (s) => s.items.length === 2);

    const deleteButtons = [...document.querySelectorAll<HTMLButtonElement>("button")].filter((b) => (b.getAttribute("aria-label") ?? "").startsWith("Delete alarm"));
    if (deleteButtons.length < 2) throw new Error("missing delete alarm buttons");
    await drawn(() => deleteButtons[0]?.click());
    await waitFor(Alarms.Machine, (s) => s.items.length === 1 && s.hasHidden);
    await waitFor(Toasts.Machine, (s) => s.showing && s.current.undo);

    await press("Undo");
    await waitFor(Alarms.Machine, (s) => s.items.length === 2 && !s.hasHidden);
    expect(document.body.textContent).toContain("Morning workout");

    const secondDelete = [...document.querySelectorAll<HTMLButtonElement>("button")].filter((b) => (b.getAttribute("aria-label") ?? "").startsWith("Delete alarm"))[1];
    await drawn(() => secondDelete?.click());
    await waitFor(Alarms.Machine, (s) => s.items.length === 1 && s.hasHidden);
    await advance(5_500);
    await waitFor(Alarms.Machine, (s) => s.items.length === 1 && !s.hasHidden);

    // spec/app/clock/alarms.md, "An enabled alarm rings only once its scheduled or snoozed time has come"
    await advance(120_000);
    await waitFor(Alarms.Machine, (s) => s.items[0]?.phase === "Ringing");
    await waitFor(ClockView.Machine, (s) => s.ringingAlarm === 1 && s.soundOn);
    const alertEl = document.querySelector<HTMLElement>("[role=alertdialog][aria-label='Ringing alarm']");
    expect(alertEl).not.toBeNull();
    expect(alertEl?.className).toContain("z-alert");
    expect(alertEl?.className).toContain("top-[var(--alpha-safe-top)]");
    expect(alertEl?.className).not.toContain("z-50");

    // spec/app/clock/index.md, "Muting silences alert audio while keeping the alert visible"
    await press("Mute alarm sound");
    await waitFor(ClockView.Machine, (s) => s.muted && !s.soundOn);

    // spec/app/clock/alarms.md, "Snoozing a ringing alarm schedules it for its snooze duration in the future"
    await press("Snooze 10m");
    await waitFor(Alarms.Machine, (s) => s.items[0]?.phase === "Snoozed");
    expect(document.querySelector("[role=alertdialog][aria-label='Ringing alarm']")).toBeNull();

    // spec/app/clock/alarms.md, "Dismissing disables a one-off alarm and advances a repeating alarm to its next occurrence"
    await advance(10 * 60_000);
    await waitFor(Alarms.Machine, (s) => s.items[0]?.phase === "Ringing");
    await press("Dismiss");
    await waitFor(Alarms.Machine, (s) => s.items[0]?.phase === "Idle" && s.items[0]?.enabled === true);

    // spec/app/clock/alarms.md, "A ringing alarm that goes unanswered for ten minutes auto-silences and is marked missed": the ten-minute snooze ends at 7:10, so this one-off alarm is set for 7:11, a minute ahead.
    await press("Add alarm");
    for (let step = 0; step < 11; step++) await pressOnTop("Increase minute");
    await fill("Alarm label", "One-off tea");
    await pressOnTop("Save");
    await waitFor(Alarms.Machine, (s) => s.items.length === 2);
    await advance(60_000);
    await waitFor(Alarms.Machine, (s) => s.items.some((a) => a.phase === "Ringing"));
    await advance(600_000);
    await waitFor(Alarms.Machine, (s) => s.items.some((a) => a.missed && !a.enabled));
    expect(document.body.textContent).toContain("Missed alarm:");
    await press("Dismiss");
    await waitFor(Alarms.Machine, (s) => s.items.every((a) => !a.missed));
  });

  it("Concurrent timers, +1:00 extension while ringing, and alarm ring priority over timer (spec/app/clock/timers.md, \"Story: Run multiple countdown timers\"; spec/app/clock/index.md, \"A ringing alarm takes priority over a ringing timer\")", async () => {
    const startMs = new Date(2026, 10, 24, 9, 0, 0, 0).getTime();
    const remote = emptyRemote(startMs);
    const host = installClockScheduler();
    scheduler = host;
    remote.offline = true;
    const { alpha, runtime, advance, waitFor } = await mountClock(startMs, remote, true);

    await clickTab("Timers");
    await waitFor(ClockView.Machine, (s) => s.tab === "Timers");

    // spec/app/clock/timers.md, "Creating a timer adds a ready or running countdown under the limit"
    await press("Start 1m timer");
    await press("Start 5m timer");
    await expect.poll(() => host.alerts().map(({ title, at }) => ({ title, at }))).toEqual([
      { title: "1m timer", at: startMs + 60_000 }, { title: "5m timer", at: startMs + 300_000 },
    ]);
    expect(host.projection().ready).toBe(false);
    remote.offline = false;
    await drawn(() => runtime.runPromise(syncClockNow()));
    await expect.poll(() => host.projection().ready).toBe(true);
    await press("Allow notifications");
    await expect.poll(() => button("Allow notifications")).toBeUndefined();
    await waitFor(Timers.Machine, (s) => s.items.length === 2 && s.items.every((t) => t.status === "Running"));

    // spec/app/clock/timers.md, "Starting, pausing, and resuming preserve remaining time accurately"
    await advance(10_000);
    await press("Pause 5m timer");
    await waitFor(Timers.Machine, (s) => s.items.some((t) => t.status === "Paused"));
    await expect.poll(() => host.alerts().map(({ id }) => id)).toEqual([1]);
    expect(host.projection().known).toHaveLength(2);
    expect(new Set(host.projection().known.map((entry) => entry.remoteId)).size).toBe(2);
    await press("Resume 5m timer");
    await expect.poll(() => host.alerts().at(-1)?.at).toBe(startMs + 300_000);
    await waitFor(Timers.Machine, (s) => s.items.every((t) => t.status === "Running"));

    // spec/app/clock/timers.md, "A running timer finishes only at or after its end time, and dismissing or resetting returns it to ready"
    await advance(50_000);
    await waitFor(Timers.Machine, (s) => s.items[0]?.status === "Ringing");
    await waitFor(ClockView.Machine, (s) => s.ringingTimer === 1);
    const timerAlert = document.querySelector<HTMLElement>("[role=alertdialog][aria-label='Ringing timer']");
    expect(timerAlert).not.toBeNull();
    expect(timerAlert?.className).toContain("z-alert");
    expect(timerAlert?.className).toContain("top-[var(--alpha-safe-top)]");

    // spec/app/clock/timers.md, "Adding time extends a running or paused timer and restarts a ringing timer"
    await press("+1:00");
    await waitFor(Timers.Machine, (s) => s.items[0]?.status === "Running");
    await advance(60_000);
    await waitFor(Timers.Machine, (s) => s.items[0]?.status === "Ringing");
    await press("Stop");
    await waitFor(Timers.Machine, (s) => s.items[0]?.status === "Ready");
    await expect.poll(() => host.alerts().map(({ id }) => id)).toEqual([2]);

    await press("Start 1m timer");
    await clickTab("Alarms");
    await press("Add alarm");
    for (let step = 0; step < 2; step++) await pressOnTop("Increase hour");
    for (let step = 0; step < 5; step++) await pressOnTop("Increase minute");
    await fill("Alarm label", "Breakfast");
    await pressOnTop("Save");
    await clickTab("World");
    await advance(180_000);
    await waitFor(ClockView.Machine, (s) => s.ringingAlarm === 1);
    await waitFor(Timers.Machine, (s) => s.items.filter((item) => item.status === "Ringing").length === 2);
    await drawn(() => alpha.runtime.runPromise(Shell.Machine.use((m) => m.send({ type: "goHome" }))));
    await until(alpha, alpha.runtime, Shell.Machine, (s) => !Shell.showing(s, "Clock"));
    host.installStandalone();
    await drawn(() => host.tap({ kind: "timer", id: 3, token: "third-countdown" }));
    await until(alpha, alpha.runtime, Shell.Machine, (s) => Shell.showing(s, "Clock"));
    expect(document.querySelector("[role=alertdialog]")?.textContent).toContain("Breakfast");
    expect(host.pending()?.id).toBe(3);
    await press("Dismiss");
    await waitFor(ClockView.Machine, (s) => s.tab === "Timers" && s.ringingTimer === 3);
    await expect.poll(() => host.pending()).toBeUndefined();
    expect(document.querySelector("[role=alertdialog]")?.textContent).toContain("1m timer");
    await press("Stop");
    await waitFor(ClockView.Machine, (s) => s.ringingTimer === 2);
    expect(document.querySelector("[role=alertdialog]")?.textContent).toContain("5m timer");
    await press("Stop");
    await drawn(() => alpha.runtime.runPromise(Shell.Machine.use((m) => m.send({ type: "goHome" }))));
    expect(host.foreground()).toBe("");
    await press("Clock");
    await expect.poll(() => host.foreground()).toBe("Clock");
    await until(alpha, alpha.runtime, Shell.Machine, (s) => !Shell.showing(s, "Clock"));
  });

  it("Stopwatch laps, fastest/slowest highlight, pause, resume, reset, and visibility ticker gating (spec/app/clock/stopwatch.md, \"Story: Time laps with the stopwatch\")", async () => {
    const startMs = new Date(2026, 10, 24, 10, 0, 0, 0).getTime();
    const remote = emptyRemote(startMs);
    const { runtime, advance, waitFor } = await mountClock(startMs, remote);

    await clickTab("Stopwatch");
    await waitFor(ClockView.Machine, (s) => s.tab === "Stopwatch");

    // spec/app/clock/stopwatch.md, "Start, pause, resume, lap, reset, and reopen keep elapsed time and laps consistent"
    await press("Start");
    await waitFor(Stopwatch.Machine, (s) => s.status === "Running");
    await advance(1500);
    await press("Lap");
    await advance(800);
    await press("Lap");
    await advance(2200);
    await press("Lap");
    await waitFor(Stopwatch.Machine, (s) => s.laps.length === 3);

    // spec/app/clock/stopwatch.md, "Best and worst lap indices are computed only when at least two laps exist"
    expect(document.body.textContent).toContain("Lap 2 · Fastest");
    expect(document.body.textContent).toContain("Lap 3 · Slowest");

    const ticks = await runtime.runPromise(activeClockTicks());
    await advance(150);
    const tickWhileVisible = ticks.stopwatchNow.snapshot();
    await seen(false);
    await advance(500);
    expect(ticks.stopwatchNow.snapshot()).toBe(tickWhileVisible);
    await seen(true);
    await advance(150);
    expect(ticks.stopwatchNow.snapshot()).toBeGreaterThan(tickWhileVisible);

    await press("Pause");
    await waitFor(Stopwatch.Machine, (s) => s.status === "Paused");
    await press("Reset");
    await waitFor(Stopwatch.Machine, (s) => s.status === "Reset" && s.laps.length === 0);
  });

  it("World Clock add, search, reorder, and remove cities (spec/app/clock/world.md, \"Story: Track times around the world\")", async () => {
    const startMs = new Date(2026, 10, 24, 12, 0, 0, 0).getTime();
    const remote = emptyRemote(startMs);
    const { waitFor } = await mountClock(startMs, remote);

    await clickTab("World");
    await waitFor(ClockView.Machine, (s) => s.tab === "World");

    // spec/app/clock/world.md, "Adding a city appends it once while under the limit"
    await press("Add city");
    await fill("Search cities", "Tokyo");
    const tokyoRow = [...document.querySelectorAll<HTMLElement>("[role=dialog] button")].find((b) => (b.textContent ?? "").includes("Tokyo"));
    if (!tokyoRow) throw new Error("missing Tokyo city row");
    await drawn(() => tokyoRow.click());
    await waitFor(World.Machine, (s) => s.cities.length === 1);

    await press("Add city");
    await fill("Search cities", "London");
    const londonRow = [...document.querySelectorAll<HTMLElement>("[role=dialog] button")].find((b) => (b.textContent ?? "").includes("London"));
    if (!londonRow) throw new Error("missing London city row");
    await drawn(() => londonRow.click());
    await waitFor(World.Machine, (s) => s.cities.length === 2);

    // spec/app/clock/world.md, "Moving a city places it immediately before or after another pinned city without changing the set of cities"
    await press("Move London up");
    await waitFor(World.Machine, (s) => s.cities.length === 2);
    const firstCityButton = button("Move London up");
    expect(firstCityButton?.disabled).toBe(true);

    // spec/app/clock/world.md, "Removing a city drops it from the list"
    await press("Remove Tokyo");
    await waitFor(World.Machine, (s) => s.cities.length === 1);
    expect(document.body.textContent).not.toContain("Tokyo");

    const hanoi = WORLD_CITIES.find((c) => c.city === "Hanoi");
    expect(hanoi?.timeZone).toBe("Asia/Ho_Chi_Minh");
  });

  it('Bidirectional agent sync, zero spurious PUTs on pull, deletedTimerIds tombstones, offline preservation, and restart persistence (spec/app/clock/alarms.md, "Syncing from the resident agent admits only valid, unique, bounded alarm lists"; spec/app/clock/timers.md, "Reopening after a restart finishes elapsed running timers and updates live remaining times")', async () => {
    const startMs = new Date(2026, 10, 24, 8, 0, 0, 0).getTime();
    const remote = emptyRemote(startMs);
    const first = await mountClock(startMs, remote);

    await first.waitFor(ClockView.Machine, (s) => s.tab === "Alarms");
    const pushed = remote.waitForPut();
    await press("Add alarm");
    await fill("Alarm label", "Local alarm");
    await pressOnTop("Save");
    await first.waitFor(Alarms.Machine, (s) => s.items.length === 1);
    await pushed;
    expect(remote.puts).toBeGreaterThanOrEqual(1);
    expect(remote.snapshot.alarms.some((a) => a.label === "Local alarm")).toBe(true);

    const putsBeforePull = remote.puts;
    remote.snapshot = {
      version: remote.snapshot.version + 1,
      updatedAtMs: startMs + 5_000,
      alarms: [
        ...remote.snapshot.alarms,
        {
          id: "alarm-9",
          hour: 14,
          minute: 30,
          daysMask: 62,
          label: "Agent standup",
          sound: "chime",
          vibrate: true,
          enabled: true,
          snoozeMinutes: 10,
          phase: "idle",
          fireAtMs: startMs + 3_600_000,
          snoozeUntilMs: null,
          missed: false,
          revision: 1,
          updatedAtMs: startMs + 5_000,
        },
      ],
      timers: [
        {
          id: "timer-5",
          label: "Agent pasta",
          durationMs: 120_000,
          remainingMs: 120_000,
          status: "running",
          startedAtMs: startMs,
          endAtMs: startMs + 120_000,
          ringStartedAtMs: null,
          revision: 1,
          updatedAtMs: startMs + 5_000,
        },
      ],
      world: [{ id: "city-40", city: "London", region: "United Kingdom", timeZone: "Europe/London", order: 0 }],
      deletedAlarmIds: [],
      deletedTimerIds: [],
    };

    await drawn(() => first.runtime.runPromise(syncClockNow()));
    await first.waitFor(Alarms.Machine, (s) => s.items.length === 2);
    await first.waitFor(Timers.Machine, (s) => s.items.length === 1);
    await first.waitFor(World.Machine, (s) => s.cities.length === 1);
    expect(document.body.textContent).toContain("Agent standup");
    expect(remote.puts).toBe(putsBeforePull);

    remote.offline = true;
    await clickTab("Timers");
    await first.waitFor(ClockView.Machine, (s) => s.tab === "Timers");
    await press("Delete Agent pasta");
    await first.waitFor(Timers.Machine, (s) => s.items.length === 0);

    await clickTab("Alarms");
    await first.waitFor(ClockView.Machine, (s) => s.tab === "Alarms");
    await press("Add alarm");
    await fill("Alarm label", "Offline alarm");
    await pressOnTop("Save");
    await first.waitFor(Alarms.Machine, (s) => s.items.length === 3);

    remote.offline = false;
    await drawn(() => first.runtime.runPromise(syncClockNow()));
    await first.waitFor(Alarms.Machine, (s) => s.items.length === 3);
    await first.waitFor(Timers.Machine, (s) => s.items.length === 0);
    expect(remote.snapshot.alarms.some((a) => a.label === "Offline alarm")).toBe(true);
    expect(remote.snapshot.timers.length).toBe(0);
    expect(remote.snapshot.deletedTimerIds).toContain("timer-5");

    remote.snapshot = {
      ...remote.snapshot,
      version: remote.snapshot.version + 1,
      timers: [
        {
          id: "timer-5",
          label: "Agent pasta",
          durationMs: 120_000,
          remainingMs: 120_000,
          status: "ready",
          startedAtMs: null,
          endAtMs: null,
          ringStartedAtMs: null,
          revision: 1,
          updatedAtMs: startMs + 5_000,
        },
        {
          id: "timer-7",
          label: "Bad timer",
          durationMs: 0,
          remainingMs: 0,
          status: "ready",
          startedAtMs: null,
          endAtMs: null,
          ringStartedAtMs: null,
          revision: 1,
          updatedAtMs: startMs + 6_000,
        },
        {
          id: "timer-8",
          label: "Restart pasta",
          durationMs: 120_000,
          remainingMs: 120_000,
          status: "running",
          startedAtMs: startMs,
          endAtMs: startMs + 120_000,
          ringStartedAtMs: null,
          revision: 1,
          updatedAtMs: startMs + 7_000,
        },
      ],
      deletedTimerIds: ["timer-5"],
    };
    await drawn(() => first.runtime.runPromise(syncClockNow()));
    await first.waitFor(Timers.Machine, (s) => s.items.length === 1);
    const recordsAfterSync = await first.runtime.runPromise(activeClockRecords());
    expect(recordsAfterSync.snapshot().timers.size).toBe(1);

    await first.close();
    const second = await mountClock(startMs + 150_000, remote);
    await second.waitFor(Timers.Machine, (s) => s.items.some((t) => t.status === "Ringing"));
    await second.waitFor(ClockView.Machine, (s) => s.ringingTimer > 0);
    expect(document.querySelector("[role=alertdialog][aria-label='Ringing timer']")).not.toBeNull();
  });

  async function mountWithDailyAlarm(startMs: number, label: string) {
    const remote = emptyRemote(startMs);
    const first = await mountClock(startMs, remote);
    await press("Add alarm");
    await fill("Alarm label", label);
    await pressOnTop("Every day");
    await pressOnTop("Save");
    await first.waitFor(Alarms.Machine, (s) => s.items.length === 1);
    return { remote, first };
  }

  it('Reopen settles timed-out repeating alarms into the future and missed Idle alarms without re-ringing (spec/app/clock/alarms.md, "Reopening after a restart clears pending Undo and settles timed-out rings and missed alarms without double-firing")', async () => {
    const startMs = new Date(2026, 10, 24, 6, 59, 0, 0).getTime();
    const { first } = await mountWithDailyAlarm(startMs, "Daily ring");

    await press("Add alarm");
    for (let step = 0; step < 5; step++) await pressOnTop("Increase minute");
    await fill("Alarm label", "One-off missed");
    await pressOnTop("Save");
    await first.waitFor(Alarms.Machine, (s) => s.items.length === 2);

    await first.advance(60_000);
    await first.waitFor(Alarms.Machine, (s) => s.items.some((a) => a.id === 1 && a.phase === "Ringing"));
    await first.close();

    const reopenMs = startMs + 2 * 3_600_000;
    const offlineRemote = emptyRemote(reopenMs);
    offlineRemote.offline = true;
    const second = await mountClock(reopenMs, offlineRemote);
    await second.waitFor(Alarms.Machine, (s) => {
      const repeating = s.items.find((a) => a.id === 1);
      const oneOff = s.items.find((a) => a.id === 2);
      return Boolean(
        repeating
        && repeating.phase === "Idle"
        && repeating.enabled
        && repeating.missed
        && repeating.fireAt > reopenMs
        && oneOff
        && oneOff.phase === "Idle"
        && !oneOff.enabled
        && oneOff.missed
        && oneOff.fireAt === 0,
      );
    });
    expect(document.querySelector("[role=alertdialog][aria-label='Ringing alarm']")).toBeNull();
  });

  it('Backward clock steps do not lock out Stopwatch or Timer pause, DST fire times stay strictly future, and Schema rejects corrupt metadata (spec/app/clock/stopwatch.md, "Start, pause, resume, lap, reset, and reopen keep elapsed time and laps consistent"; spec/app/clock/timers.md, "Starting, pausing, and resuming preserve remaining time accurately")', () => {
    const runningSw = Stopwatch.start(Stopwatch.initial, 5000);
    expect(Stopwatch.canLap(runningSw, 4000)).toBe(true);
    const lapped = Stopwatch.lap(runningSw, 4000);
    expect(lapped.laps[0]?.totalMs).toBe(0);
    expect(Stopwatch.canPause(lapped, 3000)).toBe(true);
    const pausedSw = Stopwatch.pause(lapped, 3000);
    expect(pausedSw.status).toBe("Paused");
    expect(pausedSw.accumulatedMs).toBe(0);

    const runningTimer = Timers.create(Timers.initial, 60_000, true, 5000);
    expect(Timers.canPause(runningTimer, 1, 4000)).toBe(true);
    const pausedTimer = Timers.pause(runningTimer, 1, 4000);
    expect(pausedTimer.items[0]?.status).toBe("Paused");
    expect(pausedTimer.items[0]?.remainingMs).toBe(60_000);

    const springMorning = new Date(2026, 2, 8, 1, 30, 0, 0).getTime();
    const springFire = nextAlarmFireAt(2, 30, 0b1111111, springMorning);
    expect(springFire).toBeGreaterThan(springMorning);
    const afterSpringFire = nextAlarmFireAt(2, 30, 0b1111111, springFire + 5000);
    expect(afterSpringFire).toBeGreaterThan(springFire + 12 * 3_600_000);

    const fallNight = new Date(2026, 10, 1, 0, 30, 0, 0).getTime();
    const fallFire = nextAlarmFireAt(1, 30, 0b1111111, fallNight);
    expect(fallFire).toBeGreaterThan(fallNight);
    const afterFallFire = nextAlarmFireAt(1, 30, 0b1111111, fallFire + 60_000);
    expect(afterFallFire).toBeGreaterThan(fallFire + 12 * 3_600_000);

    const store = createClockRecords();
    store.setAlarm(1, { label: "Valid", sound: "chime", remoteId: "alarm-1", updatedAtMs: 100 });
    store.restore("{not json");
    expect(store.alarm(1).label).toBe("Valid");
    store.restore(JSON.stringify({ alarms: [["bad", {}]], version: "oops" }));
    expect(store.alarm(1).label).toBe("Valid");
  });

  it('Settles timed-out repeating alarms across restart without double-firing and auto-silences after clock jumps (spec/app/clock/alarms.md, "Reopening after a restart clears pending Undo and settles timed-out rings and missed alarms without double-firing"; spec/app/clock/alarms.md, "A ringing alarm that goes unanswered for ten minutes auto-silences and is marked missed")', async () => {
    const startMs = new Date(2026, 10, 24, 6, 59, 0, 0).getTime();
    const { remote, first } = await mountWithDailyAlarm(startMs, "Daily standup");
    await first.advance(60_000);
    await first.waitFor(Alarms.Machine, (s) => s.items[0]?.phase === "Ringing");
    await first.close();

    const reopenMs = startMs + 60_000 + 15 * 60_000;
    const second = await mountClock(reopenMs, remote);
    await second.advance(1_000);
    const afterReopen = await second.runtime.runPromise(Alarms.Machine.use((m) => m.get()));
    expect(afterReopen.items[0]).toMatchObject({ enabled: true, phase: "Idle", missed: true });
    expect(afterReopen.items[0]?.fireAt).toBeGreaterThan(reopenMs);

    await drawn(() => second.alpha.runtime.runPromise(Shell.Machine.use((m) => m.send({ type: "goHome" }))));
    await until(second.alpha, second.alpha.runtime, Shell.Machine, (s) => !Shell.showing(s, "Clock"));

    const nextDue = afterReopen.items[0]?.fireAt ?? 0;
    await drawn(() => second.alpha.runtime.runPromise(TestClock.setTime(nextDue)));
    await second.advance(1_000);
    await second.waitFor(Alarms.Machine, (s) => s.items[0]?.phase === "Ringing");
    const jumpedTo = nextDue + 30 * 3_600_000;
    await drawn(() => second.alpha.runtime.runPromise(TestClock.setTime(jumpedTo)));
    await second.advance(1_000);
    await second.waitFor(Alarms.Machine, (s) => s.items[0]?.phase === "Idle" && s.items[0]?.missed === true);
    const afterJump = await second.runtime.runPromise(Alarms.Machine.use((m) => m.get()));
    expect(afterJump.items[0]?.fireAt).toBeGreaterThan(jumpedTo);
  });

  it('Preserves timer tombstones and never lets a stale empty remote overwrite newer local clock state (spec/app/clock/alarms.md, "Syncing from the resident agent admits only valid, unique, bounded alarm lists")', async () => {
    const startMs = new Date(2026, 10, 24, 9, 0, 0, 0).getTime();
    const remote = emptyRemote(startMs);
    const session = await mountClock(startMs, remote);

    const alarmPushed = remote.waitForPut();
    await press("Add alarm");
    await fill("Alarm label", "Keep me");
    await pressOnTop("Save");
    await session.waitFor(Alarms.Machine, (s) => s.items.length === 1);
    await alarmPushed;

    await clickTab("Timers");
    await session.waitFor(ClockView.Machine, (s) => s.tab === "Timers");
    const timerPushed = remote.waitForPut();
    await press("Start 1m timer");
    await session.waitFor(Timers.Machine, (s) => s.items.length === 1);
    await timerPushed;
    const remoteTimer = remote.snapshot.timers[0];
    if (!remoteTimer) throw new Error("expected synced remote timer");

    await press("Delete 1m timer");
    await session.waitFor(Timers.Machine, (s) => s.items.length === 0);

    remote.snapshot = {
      ...remote.snapshot,
      version: remote.snapshot.version + 1,
      timers: [remoteTimer],
      deletedTimerIds: [],
    };
    await drawn(() => session.runtime.runPromise(syncClockNow()));
    expect((await session.runtime.runPromise(Timers.Machine.use((m) => m.get()))).items).toHaveLength(0);

    remote.snapshot = {
      version: 0,
      updatedAtMs: startMs,
      alarms: [],
      timers: [],
      world: [],
      deletedAlarmIds: [],
      deletedTimerIds: [],
    };
    await drawn(() => session.runtime.runPromise(syncClockNow()));
    expect((await session.runtime.runPromise(Alarms.Machine.use((m) => m.get()))).items).toHaveLength(1);
  });

  it('Commits the previous pending alarm deletion when deleting a second alarm inside the Undo window (spec/app/clock/alarms.md, "Deleting an alarm holds it for a five-second Undo window before committing removal")', async () => {
    const startMs = new Date(2026, 10, 24, 8, 0, 0, 0).getTime();
    const remote = emptyRemote(startMs);
    const session = await mountClock(startMs, remote);

    await press("Add alarm");
    await fill("Alarm label", "First alarm");
    await pressOnTop("Save");
    await session.waitFor(Alarms.Machine, (s) => s.items.length === 1);

    await press("Add alarm");
    await fill("Alarm label", "Second alarm");
    await pressOnTop("Save");
    await session.waitFor(Alarms.Machine, (s) => s.items.length === 2);

    const deleteButtons = () => [...document.querySelectorAll<HTMLButtonElement>("button")]
      .filter((b) => (b.getAttribute("aria-label") ?? "").startsWith("Delete alarm"));
    await drawn(() => deleteButtons()[0]?.click());
    await session.waitFor(Alarms.Machine, (s) => s.items.length === 1 && s.hasHidden);

    await drawn(() => deleteButtons()[0]?.click());
    const afterSecond = await session.runtime.runPromise(Alarms.Machine.use((m) => m.get()));
    expect(afterSecond.items).toHaveLength(0);
    expect(afterSecond.hasHidden).toBe(true);
  });
});
