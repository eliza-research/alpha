// spec/agent/index.md, "Story: Run Alpha's agent on the phone"
import type { ClockSnapshot, ReminderItemRecord, RemindersSnapshot } from "@repo/launcher-records";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineRoutes } from "@elizaos/agent";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { pageQueries } from "../gen/agent.ts";
import {
  AlphaAppsStore, AlphaControlCoordinator, CONTROL_ACTION_NAME, MAX_LEASE_OPS, alphaAppsModule, alphaAppsPluginName,
  createAlphaAppsPlugin, isBlockedTarget, notesTranscriptionRoutes, parseControlOp,
} from "../src/plugins/index.ts";
import { advanceDueDate, civilToEpochMs } from "../src/plugins/store.ts";
import type { AgentAction, AgentRoute, AgentRuntimeLike } from "../src/plugins/types.ts";

const emptyMessage = (text: string, metadata?: Record<string, unknown>) =>
  ({ content: { text }, metadata }) as unknown as Parameters<AgentAction["handler"]>[1];

const emptyState = {} as unknown as NonNullable<Parameters<AgentAction["handler"]>[2]>;

function actionOf(plugin: ReturnType<typeof createAlphaAppsPlugin>["plugin"], name: string): AgentAction {
  const found = plugin.actions?.find((action) => action.name === name);
  if (found === undefined) throw new Error(`Missing action ${name}`);
  return found;
}

function makeFakeRuntime(initialTasks: readonly {
  readonly taskId: string;
  readonly kind: string;
  readonly ownerVisible: boolean;
  readonly promptInstructions: string;
  readonly status: string;
  readonly trigger: { readonly kind: string; readonly atIso?: string };
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly nextAt?: string | null;
}[] = []) {
  const tasks = initialTasks.map((task) => ({ ...task, nextAt: task.nextAt === undefined ? task.trigger.atIso ?? null : task.nextAt }));
  const notifications: unknown[] = [];
  const refusing = new Set<string>();
  const open = (status: string) => status === "Scheduled" || status === "Fired" || status === "Acknowledged";
  const answers: Record<string, (task: (typeof tasks)[number], request: { kind: string; verb?: { tag: string }; edit?: { trigger?: { kind: string; atIso?: string } } }) => (typeof tasks)[number] | undefined> = {
    Dismiss: (task) => task.status === "Dismissed" ? undefined : { ...task, status: "Dismissed" },
    Complete: (task) => open(task.status) ? { ...task, status: "Completed", nextAt: null } : undefined,
    Reopen: (task) => task.status === "Completed" ? { ...task, status: "Scheduled" } : undefined,
    edit: (task, request) => task.status === "Dismissed" || request.edit?.trigger === undefined ? undefined : { ...task, trigger: request.edit.trigger, nextAt: request.edit.trigger.atIso ?? null },
  };
  const runtime = {
    getService: (name: string) => {
      if (name === "scheduled-tasks") {
        return {
          list: () => Promise.resolve([...tasks]),
          get: (taskId: string) => Promise.resolve(tasks.find((task) => task.taskId === taskId)),
          applyVerb: (taskId: string, request: { kind: string; verb?: { tag: string }; edit?: { trigger?: { kind: string; atIso?: string } } }) => {
            const at = tasks.findIndex((task) => task.taskId === taskId);
            if (at < 0) return Promise.resolve({ kind: "notFound" });
            const verb = request.kind === "edit" ? "edit" : request.verb?.tag ?? "";
            const next = refusing.has(verb) ? undefined : answers[verb]?.(tasks[at], request);
            if (next === undefined) return Promise.resolve({ kind: "refused", reason: { tag: "NotApplicable" } });
            tasks[at] = next;
            return Promise.resolve({ kind: "applied", task: next });
          },
          create: (task: { kind: string; ownerVisible: boolean; promptInstructions: string; trigger: { kind: string; atIso?: string }; metadata: Record<string, unknown> }) => {
            const created = { taskId: `task-${tasks.length + 1}`, ...task, status: "Scheduled", nextAt: task.trigger.atIso ?? null };
            tasks.push(created);
            return Promise.resolve({ kind: "created", task: created });
          },
        };
      }
      if (name === "notification") {
        return {
          notify: (input: unknown) => {
            notifications.push(input);
            return Promise.resolve({ id: `notif-${notifications.length}` });
          },
        };
      }
      return null;
    },
  } as unknown as AgentRuntimeLike;
  return { runtime, tasks, notifications, refusing };
}

async function callRoute(
  routes: readonly AgentRoute[],
  method: string,
  routePath: string,
  options: { params?: Record<string, string>; query?: Record<string, string>; body?: unknown } = {},
) {
  const route = routes.find((r) => r.method === method && r.path === routePath);
  if (route === undefined) throw new Error(`Missing route ${method} ${routePath}`);
  const result = await route.handler({
    parameters: new Map(Object.entries(options.params ?? {})),
    query: new Map(Object.entries(options.query ?? {})),
    headers: new Map(),
    body: options.body,
    signal: new AbortController().signal,
  });
  return result as { status: number; body: Record<string, unknown> };
}

describe("Alpha product plugin: what the model may pass and what the owner sees", () => {
  it("declares each action's parameters, so a call with the model's arguments runs, and echoes no result text to the owner", async () => {
    const store = new AlphaAppsStore({ now: () => Date.UTC(2026, 10, 24, 18, 0) });
    const { plugin } = createAlphaAppsPlugin({ store, timeZone: "UTC", runtime: makeFakeRuntime().runtime });
    const declared = Object.fromEntries((plugin.actions ?? []).map((action) => [action.name, (action.parameters ?? []).map((parameter) => parameter.name)]));
    expect(declared.CLOCK_TIMER).toEqual(expect.arrayContaining(["action", "durationSeconds", "label", "id"]));
    expect(declared.CLOCK_ALARM).toEqual(expect.arrayContaining(["action", "hour", "minute", "days", "label", "enabled", "id"]));
    expect(declared.CLOCK_WORLD).toEqual(expect.arrayContaining(["action", "city", "timeZone"]));
    expect(declared.REMINDERS_MANAGE).toEqual(expect.arrayContaining(["op", "title", "dueDate", "dueMinute", "id"]));
    const said: string[] = [];
    const callback = (content: { text?: string }) => { said.push(content.text ?? ""); return Promise.resolve([]); };
    const timer = plugin.actions!.find((action) => action.name === "CLOCK_TIMER")!;
    const started = await timer.handler(makeFakeRuntime().runtime, emptyMessage("Set a timer for 5 minutes"), emptyState, { parameters: { action: "start", durationSeconds: 300 } }, callback);
    expect(started?.success).toBe(true);
    expect(store.getClock().timers[0]?.durationMs).toBe(300_000);
    const reminders = plugin.actions!.find((action) => action.name === "REMINDERS_MANAGE")!;
    const added = await reminders.handler(makeFakeRuntime().runtime, emptyMessage("remind me to call the plumber at 6pm"), emptyState, { parameters: { op: "create", title: "Call the plumber", dueDate: "2026-11-24", dueMinute: 1080 } }, callback);
    expect(added?.success).toBe(true);
    expect(store.getReminders().items.map(({ title, dueDate, dueMinute }) => ({ title, dueDate, dueMinute }))).toEqual([{ title: "Call the plumber", dueDate: "2026-11-24", dueMinute: 1080 }]);
    expect(said).toEqual([]);
  });
});

describe("Alpha product plugin: Clock reads the model's arguments, never the owner's words", () => {
  it("names a timer or alarm only when the model does, and repeats an alarm only on the days the model gives", async () => {
    const store = new AlphaAppsStore({ now: () => Date.UTC(2026, 10, 24, 18, 0) });
    const { plugin } = createAlphaAppsPlugin({ store, timeZone: "UTC" });
    const timer = plugin.actions!.find((action) => action.name === "CLOCK_TIMER")!;
    const alarm = plugin.actions!.find((action) => action.name === "CLOCK_ALARM")!;
    await timer.handler(makeFakeRuntime().runtime, emptyMessage("Set a timer for 5 minutes"), emptyState, { parameters: { action: "start", durationSeconds: 300 } });
    await alarm.handler(makeFakeRuntime().runtime, emptyMessage("Wake me at 7 on Monday"), emptyState, { parameters: { action: "set", hour: 7, minute: 0 } });
    expect(store.getClock().timers.map(({ label }) => label)).toEqual([""]);
    expect(store.getClock().alarms.map(({ label, daysMask }) => ({ label, daysMask }))).toEqual([{ label: "", daysMask: 0 }]);
  });

  it("acts on an alarm only when the model names which one, once there are several", async () => {
    const store = new AlphaAppsStore({ now: () => Date.UTC(2026, 10, 24, 18, 0) });
    const { plugin } = createAlphaAppsPlugin({ store, timeZone: "UTC" });
    const alarm = plugin.actions!.find((action) => action.name === "CLOCK_ALARM")!;
    const run = (parameters: Record<string, string | number>) => alarm.handler(makeFakeRuntime().runtime, emptyMessage(""), emptyState, { parameters });
    await run({ action: "set", hour: 6, minute: 0 });
    await run({ action: "set", hour: 7, minute: 0 });
    const guessed = await run({ action: "delete" });
    const named = await run({ action: "delete", hour: 7, minute: 0 });
    expect([guessed?.success, named?.success, store.getClock().alarms.map(({ hour }) => hour)]).toEqual([false, true, [6]]);
    const context = await plugin.providers!.find((provider) => provider.name === "CLOCK_CONTEXT")!.get(makeFakeRuntime().runtime, emptyMessage(""), emptyState);
    expect(context.text).toContain(`[${store.getClock().alarms[0]?.id}] 6:00 AM`);
  });
});

describe("Alpha product plugin: Clock acts only on what the model named", () => {
  const clockOf = () => {
    let nowMs = Date.UTC(2026, 10, 24, 5, 59);
    const store = new AlphaAppsStore({ now: () => nowMs });
    const { plugin } = createAlphaAppsPlugin({ store, timeZone: "UTC" });
    const run = (name: string, parameters: Record<string, string | number | boolean | readonly string[]>) =>
      plugin.actions!.find((action) => action.name === name)!.handler(makeFakeRuntime().runtime, emptyMessage(""), emptyState, { parameters: parameters as never });
    return { store, run, at: (ms: number) => { nowMs = ms; } };
  };

  it("reads repeat days in any case or short form, and refuses a day it cannot read without setting or changing anything", async () => {
    const { store, run } = clockOf();
    const capital = await run("CLOCK_ALARM", { action: "set", hour: 6, minute: 0, days: ["Monday", "wed"] });
    const unknown = await run("CLOCK_ALARM", { action: "set", hour: 7, minute: 0, days: ["weekdays"] });
    const id = store.getClock().alarms[0]?.id ?? "";
    const badUpdate = await run("CLOCK_ALARM", { action: "update", id, days: ["someday"] });
    expect([capital?.success, unknown?.success, badUpdate?.success]).toEqual([true, false, false]);
    expect(store.getClock().alarms.map(({ hour, daysMask }) => ({ hour, daysMask }))).toEqual([{ hour: 6, daysMask: 10 }]);
    await run("CLOCK_ALARM", { action: "delete", id });
  });

  it("acts on the alarm the model named even while another rings, and on a timer only when it is named or the only one", async () => {
    const { store, run, at } = clockOf();
    await run("CLOCK_ALARM", { action: "set", hour: 6, minute: 0 });
    await run("CLOCK_ALARM", { action: "set", hour: 7, minute: 0 });
    at(Date.UTC(2026, 10, 24, 6, 0, 30));
    const six = store.getClock().alarms.find(({ hour }) => hour === 6);
    store.updateAlarm(six?.id ?? "", { phase: "ringing", timeZone: "UTC" });
    expect(store.getClock().alarms.map(({ hour, phase }) => ({ hour, phase }))).toEqual([{ hour: 6, phase: "ringing" }, { hour: 7, phase: "idle" }]);
    await run("CLOCK_ALARM", { action: "delete", hour: 7, minute: 0 });
    expect(store.getClock().alarms.map(({ hour }) => hour)).toEqual([6]);
    await run("CLOCK_ALARM", { action: "delete", hour: 6, minute: 0 });
    await run("CLOCK_TIMER", { action: "start", durationSeconds: 300, label: "pasta" });
    await run("CLOCK_TIMER", { action: "start", durationSeconds: 600, label: "tea" });
    const unnamed = await run("CLOCK_TIMER", { action: "cancel" });
    const noLength = await run("CLOCK_TIMER", { action: "start", label: "pasta" });
    const named = await run("CLOCK_TIMER", { action: "cancel", label: "tea" });
    expect([unnamed?.success, noLength?.success, named?.success, store.getClock().timers.map(({ label }) => label)]).toEqual([false, false, true, ["pasta"]]);
    await run("CLOCK_TIMER", { action: "cancel", label: "pasta" });
    expect([store.getClock().alarms, store.getClock().timers]).toEqual([[], []]);
  });

  it("snoozes or dismisses only an alarm that rings, matches a label among live timers only, and never reports a timer it could not keep", async () => {
    const { store, run } = clockOf();
    await run("CLOCK_ALARM", { action: "set", hour: 7, minute: 0, enabled: false });
    const snoozedQuiet = await run("CLOCK_ALARM", { action: "snooze" });
    const dismissedQuiet = await run("CLOCK_ALARM", { action: "dismiss" });
    expect([snoozedQuiet?.success, dismissedQuiet?.success, store.getClock().alarms.map(({ enabled, phase }) => ({ enabled, phase }))]).toEqual([false, false, [{ enabled: false, phase: "idle" }]]);
    const seven = store.getClock().alarms[0]?.id ?? "";
    store.updateAlarm(seven, { phase: "ringing", enabled: true, timeZone: "UTC" });
    const snoozed = await run("CLOCK_ALARM", { action: "snooze", id: seven });
    expect([snoozed?.success, store.getClock().alarms[0]?.phase]).toEqual([true, "snoozed"]);
    await run("CLOCK_ALARM", { action: "delete", id: seven });

    await run("CLOCK_TIMER", { action: "start", durationSeconds: 60, label: "pasta" });
    await run("CLOCK_TIMER", { action: "reset", label: "pasta" });
    await run("CLOCK_TIMER", { action: "start", durationSeconds: 600, label: "pasta" });
    const paused = await run("CLOCK_TIMER", { action: "pause", label: "pasta" });
    expect([paused?.success, store.getClock().timers.map(({ status }) => status)]).toEqual([true, ["ready", "paused"]]);

    for (let at = 0; at < 14; at++) await run("CLOCK_TIMER", { action: "start", durationSeconds: 60 + at });
    const seventeenth = await run("CLOCK_TIMER", { action: "start", durationSeconds: 999, label: "one more" });
    expect([seventeenth?.success, store.getClock().timers.length, store.getClock().timers.some(({ label }) => label === "one more")]).toEqual([true, 16, true]);
    const overflow = await run("CLOCK_TIMER", { action: "start", durationSeconds: 30, label: "too many" });
    expect([overflow?.success, store.getClock().timers.length, store.getClock().timers.some(({ label }) => label === "too many")]).toEqual([false, 16, false]);
    for (const timer of store.getClock().timers) await run("CLOCK_TIMER", { action: "cancel", id: timer.id });
    expect([store.getClock().alarms, store.getClock().timers]).toEqual([[], []]);
  });

  it("finds the one live timer past a finished one, and the alarm's time past a label that names none", async () => {
    const { store, run } = clockOf();
    await run("CLOCK_TIMER", { action: "start", durationSeconds: 60, label: "eggs" });
    await run("CLOCK_TIMER", { action: "reset", label: "eggs" });
    await run("CLOCK_TIMER", { action: "start", durationSeconds: 300, label: "pasta" });
    const paused = await run("CLOCK_TIMER", { action: "pause" });
    await run("CLOCK_ALARM", { action: "set", hour: 6, minute: 0, label: "Gym" });
    await run("CLOCK_ALARM", { action: "set", hour: 7, minute: 0 });
    const toggled = await run("CLOCK_ALARM", { action: "toggle", label: "gym day", hour: 7, minute: 0, enabled: false });
    const unmatched = await run("CLOCK_ALARM", { action: "delete", label: "work" });
    expect([paused?.success, store.getClock().timers.map(({ label, status }) => ({ label, status }))]).toEqual([true, [{ label: "eggs", status: "ready" }, { label: "pasta", status: "paused" }]]);
    expect([toggled?.success, unmatched?.success, store.getClock().alarms.map(({ hour, enabled }) => ({ hour, enabled }))]).toEqual([true, false, [{ hour: 6, enabled: true }, { hour: 7, enabled: false }]]);
    for (const timer of store.getClock().timers) await run("CLOCK_TIMER", { action: "cancel", id: timer.id });
    for (const alarm of store.getClock().alarms) await run("CLOCK_ALARM", { action: "delete", id: alarm.id });
    expect([store.getClock().alarms, store.getClock().timers]).toEqual([[], []]);
  });
});

describe("Alpha product plugin: Clock actions, provider, and routes", () => {
  // spec/agent/index.md, "The agent may run the actions the old phone's agent ran plus Alpha's Clock, Reminders and Device Control actions, and every other action the bundle registers is listed as refused with its reason"
  it("runs CLOCK_ALARM, CLOCK_TIMER, CLOCK_WORLD actions and injects CLOCK_CONTEXT", async () => {
    let nowMs = Date.UTC(2026, 10, 24, 14, 0, 0);
    const store = new AlphaAppsStore({ now: () => nowMs });
    const { runtime } = makeFakeRuntime();
    const { plugin } = createAlphaAppsPlugin({ store, timeZone: "UTC", runtime });
    expect(plugin.name).toBe(alphaAppsPluginName);
    // spec/agent/index.md, "The launch names Home and every Alpha app but Notes and Browser as a view the agent may show, by the id the phone opens it by": the product plugin loads after eliza's views module, so Clock and Reminders are the launch's views, not the plugin's.
    expect(plugin.views).toBeUndefined();

    const alarmAction = actionOf(plugin, "CLOCK_ALARM");
    const timerAction = actionOf(plugin, "CLOCK_TIMER");
    const worldAction = actionOf(plugin, "CLOCK_WORLD");
    const provider = plugin.providers!.find((p) => p.name === "CLOCK_CONTEXT")!;

    const setRes = await alarmAction.handler(runtime, emptyMessage("Set an alarm for 7:30 am weekdays labeled Standup"), emptyState, {
      parameters: { action: "set", hour: 7, minute: 30, days: ["monday", "tuesday", "wednesday", "thursday", "friday"], label: "Standup" },
    });
    expect(setRes?.success).toBe(true);
    const alarmId = ((setRes?.data as { alarm: { id: string } }).alarm).id;
    expect(store.getClock().alarms[0]?.daysMask).toBe(62);
    // spec/app/clock/alarms.md, "A new alarm snoozes for ten minutes until the owner picks another length"
    expect(store.getClock().alarms[0]?.snoozeMinutes).toBe(10);

    const toggleRes = await alarmAction.handler(runtime, emptyMessage("Turn off alarm"), emptyState, { parameters: { action: "toggle", id: alarmId, enabled: false } });
    expect(toggleRes?.success).toBe(true);
    expect(store.getClock().alarms[0]?.enabled).toBe(false);

    await alarmAction.handler(runtime, emptyMessage("Update alarm"), emptyState, { parameters: { action: "update", id: alarmId, hour: 8, minute: 15, enabled: true } });
    expect(store.getClock().alarms[0]?.hour).toBe(8);

    store.updateAlarm(alarmId, { phase: "ringing", timeZone: "UTC" });
    const snoozeRes = await alarmAction.handler(runtime, emptyMessage("Snooze"), emptyState, { parameters: { action: "snooze", id: alarmId, snoozeMinutes: 10 } });
    expect(snoozeRes?.success).toBe(true);
    expect(store.getClock().alarms[0]?.phase).toBe("snoozed");

    const dismissRes = await alarmAction.handler(runtime, emptyMessage("Dismiss"), emptyState, { parameters: { action: "dismiss", id: alarmId } });
    expect(dismissRes?.success).toBe(true);
    expect(store.getClock().alarms[0]?.phase).toBe("idle");
    expect(store.getClock().alarms[0]?.enabled).toBe(true);

    const timerStart = await timerAction.handler(runtime, emptyMessage("Start a 5 minute timer for pasta"), emptyState, { parameters: { action: "start", durationSeconds: 300, label: "pasta" } });
    expect(timerStart?.success).toBe(true);
    const timerId = ((timerStart?.data as { timer: { id: string } }).timer).id;

    nowMs += 60_000;
    await timerAction.handler(runtime, emptyMessage("Pause timer"), emptyState, { parameters: { action: "pause", id: timerId } });
    expect(store.getClock().timers[0]?.status).toBe("paused");
    expect(store.getClock().timers[0]?.remainingMs).toBe(240_000);

    await timerAction.handler(runtime, emptyMessage("Resume timer"), emptyState, { parameters: { action: "resume", id: timerId } });
    await timerAction.handler(runtime, emptyMessage("Add 1 minute"), emptyState, { parameters: { action: "add_time", id: timerId, durationSeconds: 60 } });
    expect(store.getClock().timers[0]?.remainingMs).toBe(300_000);

    const worldAdd = await worldAction.handler(runtime, emptyMessage("Add Tokyo"), emptyState, { parameters: { action: "add_city", city: "Tokyo" } });
    expect(worldAdd?.success).toBe(true);
    const timeIn = await worldAction.handler(runtime, emptyMessage("What time is it in London?"), emptyState, { parameters: { action: "time_in", city: "London" } });
    expect(timeIn?.success).toBe(true);
    expect(timeIn?.text).toContain("London");

    nowMs += 300_000;
    const context = await provider.get(runtime, emptyMessage("stop it"), emptyState);
    expect(context.text).toContain("Ringing right now");
    expect(context.text).toContain("Tokyo");

    await timerAction.handler(runtime, emptyMessage("Dismiss timer"), emptyState, { parameters: { action: "dismiss", id: timerId } });
    expect(store.getClock().timers[0]?.status).toBe("ready");
    await timerAction.handler(runtime, emptyMessage("Cancel timer"), emptyState, { parameters: { action: "cancel", id: timerId } });
    expect(store.getClock().timers).toHaveLength(0);
    await worldAction.handler(runtime, emptyMessage("Remove Tokyo"), emptyState, { parameters: { action: "remove_city", city: "Tokyo" } });
    expect(store.getClock().world).toHaveLength(0);
    await alarmAction.handler(runtime, emptyMessage("Delete alarm"), emptyState, { parameters: { action: "delete", id: alarmId } });
    expect(store.getClock().alarms).toHaveLength(0);
  });

  // spec/agent/index.md, "The page reaches exactly the routes its platform services call, and nothing else"
  it("serves all /api/alpha/clock/* routes with LWW sync and specific 404 error codes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-apps-clock-"));
    try {
      const store = new AlphaAppsStore({ stateDirectory: dir });
      const { plugin } = createAlphaAppsPlugin({ store, timeZone: "UTC" });
      const routes = plugin.routes!;

      const created = await callRoute(routes, "POST", "/api/alpha/clock/alarms", { body: { hour: 6, minute: 45, label: "Run" } });
      expect(created.status).toBe(201);
      const alarmId = (created.body.alarm as { id: string }).id;

      const patched = await callRoute(routes, "PATCH", "/api/alpha/clock/alarms/{id}", { params: { id: alarmId }, body: { label: "Morning Run" } });
      expect(patched.status).toBe(200);
      expect((patched.body.alarm as { label: string }).label).toBe("Morning Run");

      const snoozed = await callRoute(routes, "POST", "/api/alpha/clock/alarms/{id}/snooze", { params: { id: alarmId }, body: { minutes: 5 } });
      expect(snoozed.status).toBe(200);

      const dismissed = await callRoute(routes, "POST", "/api/alpha/clock/alarms/{id}/dismiss", { params: { id: alarmId } });
      expect(dismissed.status).toBe(200);

      const missingAlarm = await callRoute(routes, "DELETE", "/api/alpha/clock/alarms/{id}", { params: { id: "missing" } });
      expect(missingAlarm).toEqual({ status: 404, body: { error: "alarm_not_found" } });

      const timer = await callRoute(routes, "POST", "/api/alpha/clock/timers", { body: { durationMs: 120_000, label: "Tea" } });
      expect(timer.status).toBe(201);
      const timerId = (timer.body.timer as { id: string }).id;
      const timerPatched = await callRoute(routes, "PATCH", "/api/alpha/clock/timers/{id}", { params: { id: timerId }, body: { action: "pause" } });
      expect(timerPatched.status).toBe(200);

      const city = await callRoute(routes, "POST", "/api/alpha/clock/world", { body: { city: "Paris" } });
      expect(city.status).toBe(201);
      const cityId = (city.body.city as { id: string }).id;

      const synced = await callRoute(routes, "PUT", "/api/alpha/clock", {
        body: { alarms: [{ ...(dismissed.body.alarm as Record<string, unknown>), label: "Synced Run", revision: 99 }] },
      });
      expect(synced.status).toBe(200);
      expect((synced.body as unknown as ClockSnapshot).alarms[0]?.label).toBe("Synced Run");

      const reloaded = new AlphaAppsStore({ stateDirectory: dir });
      expect(reloaded.getClock().alarms[0]?.label).toBe("Synced Run");
      expect(reloaded.getClock().timers[0]?.label).toBe("Tea");
      expect(reloaded.getClock().world[0]?.city).toBe("Paris");

      expect((await callRoute(routes, "DELETE", "/api/alpha/clock/world/{id}", { params: { id: cityId } })).status).toBe(200);
      expect((await callRoute(routes, "DELETE", "/api/alpha/clock/timers/{id}", { params: { id: timerId } })).status).toBe(200);
      expect((await callRoute(routes, "DELETE", "/api/alpha/clock/alarms/{id}", { params: { id: alarmId } })).status).toBe(200);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Alpha product plugin: Reminders actions, provider, recurrence, and routes", () => {
  // spec/agent/index.md, "The agent may run the actions the old phone's agent ran plus Alpha's Clock, Reminders and Device Control actions, and every other action the bundle registers is listed as refused with its reason"
  it("handles recurrence edge cases accurately", () => {
    expect(advanceDueDate("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(advanceDueDate("2024-01-31", "monthly")).toBe("2024-02-29");
    expect(advanceDueDate("2024-02-29", "yearly")).toBe("2025-02-28");
    expect(advanceDueDate("2026-11-27", "weekdays")).toBe("2026-11-30");
    expect(advanceDueDate("2026-11-24", "daily")).toBe("2026-11-25");
    expect(advanceDueDate("2026-11-24", "weekly")).toBe("2026-12-01");
  });

  // spec/agent/index.md, "The page reaches exactly the routes its platform services call, and nothing else"
  it("runs REMINDERS_MANAGE, reconciles OWNER_REMINDERS tasks, injects ALPHA_REMINDERS_SUMMARY, and persists routes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-apps-rem-"));
    try {
      const nowMs = Date.UTC(2026, 10, 24, 15, 0, 0);
      const store = new AlphaAppsStore({ stateDirectory: dir, now: () => nowMs });
      const { runtime, tasks, notifications } = makeFakeRuntime([{
        taskId: "owner-task-1",
        kind: "personal-assistant.reminder",
        ownerVisible: true,
        promptInstructions: "Call dentist",
        status: "Scheduled",
        trigger: { kind: "once", atIso: "2026-11-24T13:00:00.000Z" },
        metadata: { title: "Call dentist", body: "Confirm appointment" },
      }]);
      const { plugin } = createAlphaAppsPlugin({ store, timeZone: "UTC", runtime });
      const action = plugin.actions!.find((a) => a.name === "REMINDERS_MANAGE")!;
      const provider = plugin.providers!.find((p) => p.name === "ALPHA_REMINDERS_SUMMARY")!;
      const routes = plugin.routes!;

      const listCreated = await action.handler(runtime, emptyMessage("Create Work list"), emptyState, {
        parameters: { op: "create_list", name: "Work", color: "blue", icon: "work" },
      });
      expect(listCreated?.success).toBe(true);
      const workListId = ((listCreated?.data as { list: { id: string } }).list).id;

      const created = await action.handler(runtime, emptyMessage("Add weekly report"), emptyState, {
        parameters: { op: "create", title: "Weekly report", listId: workListId, dueDate: "2026-11-24", dueMinute: 960, recurrence: "weekly", priority: "high", flagged: true, subtasks: ["Collect metrics"] },
      });
      expect(created?.success).toBe(true);
      const item = (created?.data as { item: ReminderItemRecord }).item;
      expect(item.agentTaskId).toBe("task-2");
      expect(tasks).toHaveLength(2);

      await action.handler(runtime, emptyMessage("Add subtask"), emptyState, { parameters: { op: "add_subtask", id: item.id, subtaskTitle: "Send summary" } });
      await action.handler(runtime, emptyMessage("Toggle subtask"), emptyState, { parameters: { op: "toggle_subtask", id: item.id, subtaskTitle: "Collect metrics" } });
      expect(store.getReminders().items.find((i) => i.id === item.id)?.subtasks.map((s) => s.done)).toEqual([true, false]);

      await action.handler(runtime, emptyMessage("Snooze"), emptyState, { parameters: { op: "snooze", id: item.id, minutes: 30 } });
      expect(notifications).toHaveLength(1);

      const summary = await provider.get(runtime, emptyMessage("What's overdue?"), emptyState);
      expect(summary.text).toContain("Call dentist");
      expect(summary.text).toContain("Weekly report");
      expect(summary.text).toContain("Work");

      const completed = await action.handler(runtime, emptyMessage("Complete report"), emptyState, { parameters: { op: "complete", id: item.id } });
      expect(completed?.success).toBe(true);
      const nextItem = (completed?.data as { nextItem: ReminderItemRecord | null }).nextItem;
      expect(nextItem?.dueDate).toBe("2026-12-01");
      expect(nextItem?.subtasks.every((s) => !s.done)).toBe(true);
      expect(nextItem?.agentTaskId).not.toBe(item.agentTaskId);
      expect(tasks.some((task) => task.trigger.atIso?.startsWith("2026-12-01"))).toBe(true);

      const deleted = await callRoute(routes, "DELETE", "/api/alpha/reminders/items/{id}", { params: { id: nextItem!.id } });
      expect(deleted.status).toBe(200);
      const restored = await callRoute(routes, "POST", "/api/alpha/reminders/items/{id}/restore", { params: { id: nextItem!.id } });
      expect(restored.status).toBe(200);

      const badRestore = await callRoute(routes, "POST", "/api/alpha/reminders/items/{id}/restore", { params: { id: "missing-id" }, body: { item: {} } });
      expect(badRestore.status).toBe(404);
      expect(store.getReminders().items.every((entry) => typeof entry.id === "string" && Number.isFinite(entry.revision))).toBe(true);

      const listDeleted = await callRoute(routes, "DELETE", "/api/alpha/reminders/lists/{id}", { params: { id: workListId }, query: { mode: "reassign" } });
      expect(listDeleted.status).toBe(200);
      const getAll = await callRoute(routes, "GET", "/api/alpha/reminders");
      const snapshot = getAll.body as unknown as RemindersSnapshot;
      expect(snapshot.items.every((entry) => entry.listId === "default")).toBe(true);

      const missing = await callRoute(routes, "DELETE", "/api/alpha/reminders/items/{id}", { params: { id: "missing" } });
      expect(missing).toEqual({ status: 404, body: { error: "reminder_not_found" } });

      const reloaded = new AlphaAppsStore({ stateDirectory: dir });
      expect(reloaded.getReminders().items.some((entry) => entry.title === "Weekly report")).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("converges DST offsets, validates HTTP payloads, rejects unknown ops and overflow, and loads alphaAppsModule", async () => {
    const springAlarm = civilToEpochMs("2026-03-08", 7 * 60, "America/Los_Angeles");
    expect(springAlarm).toBe(Date.UTC(2026, 2, 8, 14, 0, 0));
    const fallAlarm = civilToEpochMs("2026-11-01", 7 * 60, "America/Los_Angeles");
    expect(fallAlarm).toBe(Date.UTC(2026, 10, 1, 15, 0, 0));

    const store = new AlphaAppsStore({ now: () => Date.UTC(2026, 10, 24, 15, 0, 0) });
    const { runtime } = makeFakeRuntime();

    const hosted = await Effect.runPromise(alphaAppsModule({ timeZone: "UTC", runtime, launch: {} } as Parameters<typeof alphaAppsModule>[0]));
    expect(hosted.name).toBe(alphaAppsPluginName);
    expect(hosted.plugin.name).toBe(alphaAppsPluginName);

    const { plugin } = createAlphaAppsPlugin({ store, timeZone: "UTC", runtime });
    const routes = plugin.routes!;
    const alarmAction = actionOf(plugin, "CLOCK_ALARM");
    const timerAction = actionOf(plugin, "CLOCK_TIMER");
    const worldAction = actionOf(plugin, "CLOCK_WORLD");
    const remAction = actionOf(plugin, "REMINDERS_MANAGE");

    expect((await alarmAction.handler(runtime, emptyMessage(""), emptyState, { parameters: { action: "bogus" } }))?.success).toBe(false);
    expect((await timerAction.handler(runtime, emptyMessage(""), emptyState, { parameters: { action: "bogus" } }))?.success).toBe(false);
    expect((await worldAction.handler(runtime, emptyMessage(""), emptyState, { parameters: { action: "bogus" } }))?.success).toBe(false);
    expect((await remAction.handler(runtime, emptyMessage(""), emptyState, { parameters: { op: "bogus" } }))?.success).toBe(false);

    const badClock = await callRoute(routes, "PUT", "/api/alpha/clock", { body: { alarms: [{ id: "bad", hour: "nope" }] } });
    expect(badClock.status).toBe(400);
    const badRestore = await callRoute(routes, "POST", "/api/alpha/reminders/items/{id}/restore", { params: { id: "r1" }, body: { item: { id: "other", title: "X" } } });
    expect(badRestore.status).toBe(400);

    for (let i = 0; i < 16; i += 1) store.createTimer({ durationMs: 60_000, label: `T${i}` });
    const overflow = await callRoute(routes, "POST", "/api/alpha/clock/timers", { body: { durationMs: 60_000, label: "Overflow" } });
    expect(overflow.status).toBe(409);
  });

  it("registers the Clock context for activity labels, marks read-only ops, and gives accurate parameter guidance", async () => {
    const store = new AlphaAppsStore({ now: () => Date.UTC(2026, 10, 24, 14, 0, 0) });
    const registeredContexts: unknown[] = [];
    const { runtime } = makeFakeRuntime();
    const { plugin } = createAlphaAppsPlugin({ store, timeZone: "UTC", runtime });
    await plugin.init?.({}, { ...runtime, contexts: { tryRegister: (ctx: unknown) => { registeredContexts.push(ctx); } } } as never);
    expect(registeredContexts).toContainEqual(expect.objectContaining({ id: "clock", label: "Clock" }));

    const alarm = actionOf(plugin, "CLOCK_ALARM");
    const timer = actionOf(plugin, "CLOCK_TIMER");
    const world = actionOf(plugin, "CLOCK_WORLD");
    const reminders = actionOf(plugin, "REMINDERS_MANAGE");

    expect((await alarm.handler(runtime, emptyMessage("list alarms"), emptyState, { parameters: { action: "list" } }))?.data).toMatchObject({ readOnlyOperation: true });
    expect((await timer.handler(runtime, emptyMessage("list timers"), emptyState, { parameters: { action: "list" } }))?.data).toMatchObject({ readOnlyOperation: true });
    expect((await world.handler(runtime, emptyMessage("list cities"), emptyState, { parameters: { action: "list" } }))?.data).toMatchObject({ readOnlyOperation: true });
    expect((await world.handler(runtime, emptyMessage("time in Tokyo"), emptyState, { parameters: { action: "time_in", city: "Tokyo" } }))?.data).toMatchObject({ readOnlyOperation: true });
    expect((await reminders.handler(runtime, emptyMessage("list reminders"), emptyState, { parameters: { op: "list" } }))?.data).toMatchObject({ readOnlyOperation: true });

    for (const act of [alarm, timer, world, reminders]) {
      const idParam = act.parameters?.find((p) => p.name === "id");
      expect(idParam?.description).not.toContain("context lists it");
    }
  });

function createRemindersTestHarness(nowMs: number, initialTasks: Parameters<typeof makeFakeRuntime>[0]) {
  const store = new AlphaAppsStore({ now: () => nowMs });
  const fake = makeFakeRuntime(initialTasks);
  const { plugin } = createAlphaAppsPlugin({ store, timeZone: "UTC", runtime: fake.runtime });
  return { store, plugin, ...fake, action: plugin.actions!.find((a) => a.name === "REMINDERS_MANAGE")!, routes: plugin.routes! };
}

  // spec/agent/index.md, "A reminder with a due time keeps one scheduled task, and the task follows what the owner does to the reminder"; spec/agent/index.md, "The page names the query values each gated route can receive"
  it("keeps each reminder's scheduled task following it, so a delete, completion or new time made in the app or in chat holds, and says so only when it does", async () => {
    const nowMs = Date.UTC(2026, 10, 24, 15, 0, 0);
    const { runtime, tasks, refusing, action, routes } = createRemindersTestHarness(nowMs, [
      { taskId: "plumber-task", kind: "personal-assistant.reminder", ownerVisible: true, promptInstructions: "Call the plumber", status: "Scheduled", trigger: { kind: "once", atIso: "2026-11-24T18:00:00.000Z" }, metadata: { title: "Call the plumber" } },
      { taskId: "dentist-task", kind: "personal-assistant.reminder", ownerVisible: true, promptInstructions: "Call the dentist", status: "Scheduled", trigger: { kind: "once", atIso: "2026-11-24T19:00:00.000Z" }, metadata: { title: "Call the dentist" } },
    ]);
    const read = async () => (await callRoute(routes, "GET", "/api/alpha/reminders")).body as unknown as RemindersSnapshot;
    const named = async (title: string) => (await read()).items.find((item) => item.title === title);
    const statusOf = (taskId: string) => tasks.find((task) => task.taskId === taskId)?.status;

    const walk = await action.handler(runtime, emptyMessage("remind me to walk the dog at 8pm"), emptyState, { parameters: { op: "create", title: "Walk the dog", dueDate: "2026-11-24", dueMinute: 1200 } });
    const listed = await action.handler(runtime, emptyMessage("what reminders do I have"), emptyState, { parameters: { op: "list" } });
    expect({ receipt: walk?.effectReceipts?.[0]?.outcome, listed: listed?.text?.includes("Walk the dog due 2026-11-24 8:00 PM (UTC; pending)"), listReceipts: listed?.effectReceipts }).toEqual({ receipt: "applied", listed: true, listReceipts: undefined });
    const walkGone = await action.handler(runtime, emptyMessage("delete it"), emptyState, { parameters: { op: "delete", title: "Walk the dog" } });
    expect({ success: walkGone?.success, receipt: walkGone?.effectReceipts?.[0]?.operation, left: await named("Walk the dog") }).toEqual({ success: true, receipt: "alpha.reminder.delete", left: undefined });

    const untitled = await action.handler(runtime, emptyMessage("remind me to water the plants"), emptyState, { parameters: { op: "create", dueDate: "2026-11-24" } });
    expect({ success: untitled?.success, made: (await read()).items.length }).toEqual({ success: false, made: 2 });

    const plumber = (await named("Call the plumber"))!;
    refusing.add("Dismiss");
    const refused = await action.handler(runtime, emptyMessage("delete my plumber reminder"), emptyState, { parameters: { op: "delete", title: "Call the plumber" } });
    expect({ success: refused?.success, task: statusOf("plumber-task"), kept: (await named("Call the plumber"))?.id }).toEqual({ success: false, task: "Scheduled", kept: plumber.id });
    refusing.delete("Dismiss");
    const deleted = await action.handler(runtime, emptyMessage("delete my plumber reminder"), emptyState, { parameters: { op: "delete", title: "Call the plumber" } });
    expect({ success: deleted?.success, task: statusOf("plumber-task"), kept: await named("Call the plumber") }).toEqual({ success: true, task: "Dismissed", kept: undefined });

    const dentist = (await named("Call the dentist"))!;
    expect((await callRoute(routes, "POST", "/api/alpha/reminders/items/{id}/complete", { params: { id: dentist.id } })).status).toBe(200);
    expect({ completed: (await named("Call the dentist"))?.completed, task: statusOf("dentist-task") }).toEqual({ completed: true, task: "Completed" });
    expect((await callRoute(routes, "POST", "/api/alpha/reminders/items/{id}/reopen", { params: { id: dentist.id } })).status).toBe(200);
    expect({ completed: (await named("Call the dentist"))?.completed, task: statusOf("dentist-task"), fires: tasks.find((task) => task.taskId === "dentist-task")?.nextAt })
      .toEqual({ completed: false, task: "Scheduled", fires: "2026-11-24T19:00:00.000Z" });
    expect((await callRoute(routes, "DELETE", "/api/alpha/reminders/items/{id}", { params: { id: dentist.id } })).status).toBe(200);
    expect({ kept: await named("Call the dentist"), task: statusOf("dentist-task") }).toEqual({ kept: undefined, task: "Dismissed" });

    const made = await callRoute(routes, "POST", "/api/alpha/reminders/items", { body: { title: "Pick up keys", dueDate: "2026-11-24", dueMinute: 20 * 60 } });
    const keys = made.body.item as ReminderItemRecord;
    const moved = await callRoute(routes, "PATCH", "/api/alpha/reminders/items/{id}", { params: { id: keys.id }, body: { dueDate: "2026-11-25", dueMinute: 9 * 60 } });
    expect(moved.status).toBe(200);
    const live = tasks.filter((task) => task.metadata.alphaReminderId === keys.id && task.status !== "Dismissed");
    expect(live.map((task) => task.trigger.atIso)).toEqual(["2026-11-25T09:00:00.000Z"]);
    await action.handler(runtime, emptyMessage("rename it"), emptyState, { parameters: { op: "update", title: "keys", notes: "From the front desk" } });
    expect((await named("Pick up keys"))?.notes).toBe("From the front desk");
    const keysTask = tasks.findIndex((task) => task.metadata.alphaReminderId === keys.id && task.status !== "Dismissed");
    tasks[keysTask] = { ...tasks[keysTask], status: "Dismissed" };
    expect(await named("Pick up keys")).toBeUndefined();

    const gate = defineRoutes(routes.map(({ method, path, query }) => (query === undefined ? { method, path } : { method, path, query })));
    const admitted = (method: string, target: string) => gate.admit({ method, target, streamed: false, body: undefined }).tag;
    expect([
      admitted("DELETE", "/api/alpha/reminders/items/rem-1"),
      admitted("DELETE", "/api/alpha/reminders/lists/list-1?mode=cascade"),
      admitted("DELETE", "/api/alpha/reminders/items/rem-1?idempotencyKey=k"),
    ]).toEqual(["Admitted", "Admitted", "RouteRefused"]);
  });

  it("reopens the reviewed Calendar reminder without firing its old task (spec/agent/index.md, \"A reminder with a due time keeps one scheduled task, and the task follows what the owner does to the reminder\")", async () => {
    const store = new AlphaAppsStore({ now: () => Date.UTC(2026, 10, 24, 15) });
    const { runtime, tasks, refusing } = makeFakeRuntime([]);
    const routes = createAlphaAppsPlugin({ store, timeZone: "UTC", runtime }).plugin.routes!;
    const creation = await callRoute(routes, "POST", "/api/alpha/reminders/items", { body: { title: "Pick up keys", dueDate: "2026-11-24", dueMinute: 18 * 60, alertMinutes: 0 } });
    const id = (creation.body.item as ReminderItemRecord).id;
    const completed = await callRoute(routes, "POST", "/api/alpha/reminders/items/{id}/complete", { params: { id } });
    const record = completed.body.item as ReminderItemRecord;
    const body = { dueDate: "2026-11-24", dueMinute: 18 * 60, expectedRevision: record.revision };
    const noAlert = (expectedRevision: number) => callRoute(routes, "POST", "/api/alpha/reminders/items/{id}/reopen", { params: { id }, body: { ...body, expectedRevision } });

    expect((await noAlert(record.revision + 1)).status).toBe(409);
    const withoutTasks = createAlphaAppsPlugin({ store, timeZone: "UTC" }).plugin.routes!;
    expect((await callRoute(withoutTasks, "POST", "/api/alpha/reminders/items/{id}/reopen", { params: { id }, body })).status).toBe(409);
    refusing.add("Dismiss");
    expect((await noAlert(record.revision)).status).toBe(409);
    expect(store.getReminders().items.find((item) => item.id === id)?.completed).toBe(true);
    expect(tasks.find((task) => task.taskId === record.agentTaskId)?.status).toBe("Completed");

    refusing.delete("Dismiss");
    const revision = store.getReminders().items.find((item) => item.id === id)!.revision;
    const reopened = await noAlert(revision);
    expect(reopened.status).toBe(200);
    expect(reopened.body.item).toMatchObject({ id, completed: false, dueDate: body.dueDate, dueMinute: body.dueMinute, alertMinutes: null, agentTaskId: null });
    expect(tasks.find((task) => task.taskId === record.agentTaskId)?.status).toBe("Dismissed");
    expect(tasks.filter((task) => task.metadata.alphaReminderId === id && task.status === "Scheduled")).toHaveLength(0);
  });

  it("applies an approved Calendar reschedule to the exact completed reminder and task", async () => {
    const store = new AlphaAppsStore({ now: () => Date.UTC(2026, 10, 24, 15) });
    const { runtime, tasks } = makeFakeRuntime();
    const routes = createAlphaAppsPlugin({ store, timeZone: "UTC", runtime }).plugin.routes!;
    const due = { title: "Pick up keys", dueDate: "2026-11-24", dueMinute: 18 * 60, alertMinutes: 0, recurrence: "none" };
    const create = () => callRoute(routes, "POST", "/api/alpha/reminders/items", { body: due });
    const selected = (await create()).body.item as ReminderItemRecord;
    const other = (await create()).body.item as ReminderItemRecord;
    const record = (await callRoute(routes, "POST", "/api/alpha/reminders/items/{id}/complete", { params: { id: selected.id } })).body.item as ReminderItemRecord;
    const fields = { ...due, dueMinute: 19 * 60, expectedRevision: record.revision };
    const edit = (body: unknown) => callRoute(routes, "PATCH", "/api/alpha/reminders/items/{id}", { params: { id: record.id }, body });
    expect((await edit(fields)).status).toBe(409);
    expect((await edit({ ...fields, expectedRevision: record.revision - 1, rescheduleCompleted: true })).status).toBe(409);
    expect(store.getReminders().items.find((item) => item.id === record.id)?.completed).toBe(true);
    const saved = await edit({ ...fields, rescheduleCompleted: true });
    expect(saved.status).toBe(200);
    expect(saved.body.item).toMatchObject({ id: record.id, completed: false, completedAtMs: null, dueMinute: 19 * 60, alertMinutes: 0 });
    expect(tasks.find((task) => task.taskId === record.agentTaskId)).toMatchObject({ status: "Scheduled", trigger: { atIso: "2026-11-24T19:00:00.000Z" } });
    expect(store.getReminders().items.find((item) => item.id === other.id)).toEqual(other);
  });

  it("retains the real previous occurrence when a daily reminder advances", async () => {
    const now = Date.UTC(2026, 10, 24, 8);
    const store = new AlphaAppsStore({ now: () => now });
    const routes = createAlphaAppsPlugin({ store, timeZone: "UTC" }).plugin.routes!;
    const input = { title: "Bring a notebook", dueDate: "2026-11-24", dueMinute: 570, alertMinutes: 0, recurrence: "daily" };
    const created = await callRoute(routes, "POST", "/api/alpha/reminders/items", { body: input });
    const selected = created.body.item as ReminderItemRecord;
    const params = { id: selected.id };
    const completed = await callRoute(routes, "POST", "/api/alpha/reminders/items/{id}/complete", { params });
    const expected = [{ revision: selected.revision, dueAtMs: Date.UTC(2026, 10, 24, 9, 30), completedAtMs: now }];
    expect(completed.body.item).toMatchObject({ id: selected.id, completed: false, dueDate: "2026-11-25", history: expected });
    const readback = await callRoute(routes, "GET", "/api/alpha/reminders");
    expect(readback.body.items).toEqual([expect.objectContaining({ id: selected.id, history: expected })]);
    const undo = await callRoute(routes, "POST", "/api/alpha/reminders/items/{id}/restore", { params });
    expect(undo.body.item).toMatchObject({ id: selected.id, dueDate: input.dueDate });
    expect((undo.body.item as ReminderItemRecord).history).toBeUndefined();
  });

  it("skips elapsed repeat dates while keeping the completed Saturday occurrence", async () => {
    const now = Date.UTC(2027, 2, 15, 10, 30);
    const store = new AlphaAppsStore({ now: () => now });
    const routes = createAlphaAppsPlugin({ store, timeZone: "UTC" }).plugin.routes!;
    const input = { title: "Bring a notebook", dueDate: "2027-03-13", dueMinute: 570, alertMinutes: 0, recurrence: "daily" };
    const created = await callRoute(routes, "POST", "/api/alpha/reminders/items", { body: input });
    const selected = created.body.item as ReminderItemRecord;
    const completed = await callRoute(routes, "POST", "/api/alpha/reminders/items/{id}/complete", { params: { id: selected.id } });
    expect(completed.body.item).toMatchObject({ id: selected.id, completed: false, dueDate: "2027-03-16", history: [
      { revision: selected.revision, dueAtMs: Date.UTC(2027, 2, 13, 9, 30), completedAtMs: now, skippedDates: 2 },
    ] });
  });

  // spec/agent/index.md, "The page reaches exactly the routes its platform services call, and nothing else"
  // spec/agent/index.md, "The page names the query values each gated route can receive"
  it("admits every page route and query parameter the phone app calls on the resident agent", () => {
    const rawLines = fs.readFileSync(path.join(import.meta.dirname, "../host/routes.jsonl"), "utf8").split("\n").filter((line) => line.trim() !== "");
    const spelled = { GET: "Get", POST: "Post", PUT: "Put", PATCH: "Patch", DELETE: "Delete" } as const;
    const routes = rawLines.map((line) => {
      const route = JSON.parse(line) as { method: keyof typeof spelled; path: string; stream?: boolean };
      const query = pageQueries
        .filter(({ method, path: routePath }) => method === spelled[route.method] && routePath === route.path)
        .map(({ key, kind, value }) => ({
          key,
          accepts: kind === "AnyQuery" ? { kind: "any" as const }
            : kind === "PatternQuery" ? { kind: "pattern" as const, pattern: value } : { kind: "pinned" as const, value },
        }));
      return query.length === 0 ? route : { ...route, query };
    });
    const gate = defineRoutes(routes);
    const required = [
      { method: "DELETE" as const, target: "/api/alpha/reminders/items/rem-1" },
      { method: "DELETE" as const, target: "/api/alpha/reminders/lists/list-1?mode=cascade" },
      { method: "DELETE" as const, target: "/api/lifeops/calendar/events/ev-1?expectedProviderVersion=v1&idempotencyKey=key-1&cancellationMode=organizer_cancel&notifyAttendees=false&recurrenceScope=instance" },
      { method: "POST" as const, target: "/api/views/interact-claim" },
      { method: "POST" as const, target: "/api/views/interact-result" },
      { method: "POST" as const, target: "/api/messages/reply-draft" },
      { method: "POST" as const, target: "/api/client-devices/revoke" },
      { method: "POST" as const, target: "/api/cloud/warm" },
      { method: "GET" as const, target: "/api/lifeops/calendar/sync-control" },
      { method: "POST" as const, target: "/api/lifeops/calendar/sync-control" },
      { method: "GET" as const, target: "/api/lifeops/calendar/sync-control/destinations" },
      { method: "GET" as const, target: "/api/lifeops/calendar/links" },
    ];
    for (const check of required) {
      const admission = gate.admit({ method: check.method, target: check.target, streamed: false, body: undefined });
      expect({ ...check, tag: admission.tag }).toEqual({ ...check, tag: "Admitted" });
    }
  });

  // spec/agent/index.md, "Story: Run Alpha's agent on the phone"
  it("resolves DST civil times accurately and guards list mutations, task reconciliation, and malformed clock sync", async () => {
    const formatLocal = (ms: number, timeZone: string) =>
      new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
    const springLa = civilToEpochMs("2026-03-08", 7 * 60, "America/Los_Angeles");
    expect(springLa).not.toBeNull();
    expect(formatLocal(springLa!, "America/Los_Angeles")).toBe("03/08/2026, 07:00");
    const fallNy = civilToEpochMs("2026-11-01", 3 * 60, "America/New_York");
    expect(fallNy).not.toBeNull();
    expect(formatLocal(fallNy!, "America/New_York")).toBe("11/01/2026, 03:00");

    const { store, plugin, runtime, action, routes } = createRemindersTestHarness(Date.UTC(2026, 10, 24, 15, 0, 0), [
      { taskId: "owner-task-1", kind: "personal-assistant.reminder", ownerVisible: true, promptInstructions: "First", status: "Scheduled", trigger: { kind: "once", atIso: "2026-11-24T16:00:00.000Z" }, metadata: { title: "First", priority: "medium" } },
      { taskId: "owner-task-2", kind: "personal-assistant.reminder", ownerVisible: true, promptInstructions: "Second", status: "Scheduled", trigger: { kind: "once", atIso: "2026-11-24T17:00:00.000Z" }, metadata: { title: "Second", priority: "low" } },
    ]);

    const listed = await action.handler(runtime, emptyMessage("List"), emptyState, { parameters: { op: "list" } });
    expect(listed?.success).toBe(true);
    const reconciled = store.getReminders().items;
    expect(new Set(reconciled.map((i) => i.id)).size).toBe(2);
    expect(reconciled.map((i) => i.priority).sort()).toEqual(["low", "medium"]);

    const renameMissing = await action.handler(runtime, emptyMessage("Rename"), emptyState, { parameters: { op: "rename_list", listName: "NoSuchList", name: "Hijacked" } });
    expect(renameMissing?.success).toBe(false);
    expect(store.getReminders().lists.find((l) => l.id === "default")?.name).toBe("Reminders");

    const moveMissing = await action.handler(runtime, emptyMessage("Move"), emptyState, { parameters: { op: "move", id: reconciled[0].id, listName: "NoSuchList" } });
    expect(moveMissing?.success).toBe(false);

    const filterMissing = await action.handler(runtime, emptyMessage("Query"), emptyState, { parameters: { op: "list", listName: "NoSuchList" } });
    expect((filterMissing?.data as { items: unknown[] }).items).toEqual([]);

    const missingSub = await action.handler(runtime, emptyMessage("Toggle"), emptyState, { parameters: { op: "toggle_subtask", id: reconciled[0].id, subtaskTitle: "Does not exist" } });
    expect(missingSub?.success).toBe(false);

    const createdAlarm = await callRoute(routes, "POST", "/api/alpha/clock/alarms", { body: { hour: 7, minute: 0, sound: "chime" } });
    const alarmId = (createdAlarm.body.alarm as { id: string }).id;
    const patchedBadSound = await callRoute(routes, "PATCH", "/api/alpha/clock/alarms/{id}", { params: { id: alarmId }, body: { sound: "invalid_sound" } });
    expect((patchedBadSound.body.alarm as { sound: string }).sound).toBe("chime");

    const clockAction = plugin.actions!.find((a) => a.name === "CLOCK_ALARM")!;
    const badDaysOptions = { parameters: { action: "create", hour: 7, minute: 0, days: [undefined] } } as unknown as Parameters<typeof clockAction.handler>[3];
    const badDays = await clockAction.handler(runtime, emptyMessage("Bad days"), emptyState, badDaysOptions);
    expect(badDays?.success).toBe(false);

    const partialRestore = await callRoute(routes, "POST", "/api/alpha/reminders/items/{id}/restore", { params: { id: "partial-rem" }, body: { item: { title: "Partial", revision: 1 } } });
    expect(partialRestore.status).toBe(200);
    const queriedPartial = await action.handler(runtime, emptyMessage("Search partial"), emptyState, { parameters: { op: "list", query: "Partial" } });
    expect(queriedPartial?.success).toBe(true);
    const completedPartial = await action.handler(runtime, emptyMessage("Complete partial"), emptyState, { parameters: { op: "complete", id: "partial-rem" } });
    expect(completedPartial?.success).toBe(true);

    const malformedSync = await callRoute(routes, "PUT", "/api/alpha/clock", {
      body: {
        alarms: [null, {}, { id: "partial-alarm", hour: 6, minute: 30, revision: 1, updatedAtMs: 1000 }],
        timers: [null, { id: "partial-timer", durationMs: 60_000, revision: 1, updatedAtMs: 1000 }],
        world: [null],
      },
    });
    expect(malformedSync.status).toBe(200);
    const syncedSnapshot = malformedSync.body as unknown as ClockSnapshot;
    const syncedAlarm = syncedSnapshot.alarms.find((entry) => entry.id === "partial-alarm");
    const syncedTimer = syncedSnapshot.timers.find((entry) => entry.id === "partial-timer");
    expect({ sound: syncedAlarm?.sound, label: syncedAlarm?.label, status: syncedTimer?.status, remainingMs: syncedTimer?.remainingMs })
      .toEqual({ sound: "radar", label: "", status: "ready", remainingMs: 60_000 });
  });
});

describe("Notes transcription for the local browser", () => {
  const transcriptionContext = (environment?: Record<string, string>) => ({
    launch: { account: { userId: "owner-1", organizationId: "org-1" }, ...(environment === undefined ? {} : { environment }) },
    runtime: { getModelRegistrations: () => [], useModel: () => Promise.reject(new Error("no local model")) },
  }) as unknown as Parameters<typeof notesTranscriptionRoutes>[0];

  // spec/agent/index.md, "The local browser can request a private transcription of a reviewed note"
  it("offers the route without a local engine, and says no local model is ready to transcribe", async () => {
    const routes = notesTranscriptionRoutes(transcriptionContext(), "local-inference", () => Promise.resolve(false));
    expect(routes.map(({ method, path }) => `${method} ${path}`)).toEqual(["GET /api/alpha/notes/transcription", "POST /api/alpha/notes/transcription"]);
    const signal = new AbortController().signal;
    expect(await routes[0].handler({ signal } as never)).toEqual({ status: 200, body: { local: false } });
    const pcm = Buffer.from(new Uint8Array(3_200)).toString("base64");
    expect(await routes[1].handler({ body: { pcm }, signal } as never)).toEqual({ status: 503, body: { error: "LOCAL_TRANSCRIPTION_UNAVAILABLE" } });
  });

  // spec/agent/index.md, "The local browser can request a private transcription of a reviewed note"
  it("is not offered while the agent runs Alpha's native speech engine", () => {
    expect(notesTranscriptionRoutes(transcriptionContext({ ALPHA_LOCAL_SPEECH_SOCKET: "/run/alpha/speech.sock" }), "local-inference", () => Promise.resolve(true))).toEqual([]);
  });
});

describe("Bounded external app control in the Alpha product plugin", () => {
  // spec/app/control/index.md, "Story: Control a third-party app within an owner-approved lease"
  // spec/app/control/index.md, "Story: Enforce formal safety guarantees over external app control"
  // spec/agent/index.md, "Only Android's native control executor can post UI observations, poll queued operations, submit receipts, or fire native interrupts"
  it("validates all twelve closed control operations and rejects unsafe inputs", () => {
    const validOps = [
      { type: "app_launch_package", packageName: "org.mozilla.firefox" },
      { type: "app_open_url", url: "https://example.org/docs", packageName: "org.mozilla.firefox" },
      { type: "ui_read_tree", includeNonInteractive: false, maxNodes: 80 },
      { type: "ui_capture_screen", maxWidth: 720, quality: 70 },
      { type: "ui_click", snapshotId: 1, expectedPackage: "org.mozilla.firefox", nodeId: "n1" },
      { type: "ui_click", snapshotId: 1, expectedPackage: "org.mozilla.firefox", x: 120, y: 240, longClick: true },
      { type: "ui_set_text", snapshotId: 1, expectedPackage: "org.mozilla.firefox", nodeId: "url_bar", text: "alpha phone", submit: true },
      { type: "ui_scroll", snapshotId: 1, expectedPackage: "org.mozilla.firefox", direction: "down", distanceRatio: 0.6 },
      { type: "ui_key_event", snapshotId: 1, expectedPackage: "org.mozilla.firefox", keyCode: "ENTER" },
      { type: "ui_gesture", snapshotId: 1, expectedPackage: "org.mozilla.firefox", kind: "swipe", startX: 200, startY: 800, endX: 200, endY: 300, durationMs: 250 },
      { type: "ui_global_action", snapshotId: 1, expectedPackage: "org.mozilla.firefox", action: "back" },
      { type: "app_functions_discover", packageName: "org.mozilla.firefox" },
      { type: "app_function_execute", snapshotId: 1, expectedPackage: "org.mozilla.firefox", functionId: "browser.openTab", parameters: { url: "https://example.org", pinned: true } },
    ];
    for (const op of validOps) {
      expect(parseControlOp(op)).toBeDefined();
    }
    expect(parseControlOp({ type: "app_open_url", url: "http://insecure.example.org" })).toBeUndefined();
    expect(parseControlOp({ type: "ui_click", snapshotId: 1, expectedPackage: "org.mozilla.firefox" })).toBeUndefined();
    expect(parseControlOp({ type: "ui_key_event", snapshotId: 1, expectedPackage: "org.mozilla.firefox", keyCode: "POWER" })).toBeUndefined();
    expect(parseControlOp({ type: "ui_gesture", snapshotId: 1, expectedPackage: "org.mozilla.firefox", kind: "swipe", startX: 10, startY: 10, durationMs: 200 })).toBeUndefined();
    expect(parseControlOp({ type: "unknown_op" })).toBeUndefined();
  });

  // spec/app/control/index.md, "No operation is ever active over a blocked package, and snapshot-bound operations only run over an allowed foreground app"
  it("hard-blocks permission dialogs, settings, password managers, billing sheets, and Alpha approval surfaces", () => {
    expect(isBlockedTarget("com.android.permissioncontroller")).toBe(true);
    expect(isBlockedTarget("com.google.android.packageinstaller")).toBe(true);
    expect(isBlockedTarget("com.android.settings")).toBe(true);
    expect(isBlockedTarget("proton.android.pass")).toBe(true);
    expect(isBlockedTarget("ai.alphacompute.alphaphone")).toBe(true);
    expect(isBlockedTarget("ai.alphacompute.wallet")).toBe(true);
    expect(isBlockedTarget("com.android.vending", "com.google.android.finsky.billing.PurchaseActivity")).toBe(true);
    expect(isBlockedTarget("com.android.vending", "com.google.android.finsky.activities.MainActivity")).toBe(false);
    expect(isBlockedTarget("org.mozilla.firefox", "org.mozilla.fenix.HomeActivity")).toBe(false);
  });

  // spec/app/control/index.md, "The agent dispatches one operation at a time only under an active lease on a clear unblocked screen, binding the exact live snapshot for every UI operation"
  // spec/app/control/index.md, "The kill-switch immediately revokes any active lease, clears any in-flight operation, and signals the native bridge and overlay"
  it("drives a Firefox control lease end-to-end and enforces stale-snapshot, protected-screen, budget, and kill-switch rules", async () => {
    const clock = 10_000;
    const coordinator = new AlphaControlCoordinator();
    const { plugin } = createAlphaAppsPlugin({ control: coordinator, controlWaitTimeoutMs: 0 });
    const routes = plugin.routes!;
    const action = actionOf(plugin, CONTROL_ACTION_NAME);
    const provider = plugin.providers!.find((entry) => entry.name === "alpha_device_control")!;
    const { runtime } = makeFakeRuntime();

    const beforeTier = await callRoute(routes, "POST", "/api/alpha/control/lease", {
      body: { packageName: "org.mozilla.firefox", maxOps: 3, durationMs: 60_000 },
    });
    expect(beforeTier.status).toBe(409);

    const tierReady = await callRoute(routes, "POST", "/api/alpha-control/observe", {
      body: {
        tier: "TierPrivileged",
        capabilities: ["ui.observe.v1", "ui.act.v1", "ui.screenshot.v1", "ui.inject.v1"],
        packageName: "com.android.launcher3",
        activityName: "com.android.launcher3.Launcher",
        protection: "ScreenClear",
        windowCount: 1,
        nodes: [],
      },
    });
    expect(tierReady.status).toBe(200);

    const blockedLease = await callRoute(routes, "POST", "/api/alpha/control/lease", {
      body: { packageName: "com.android.settings", maxOps: 2, durationMs: 60_000 },
    });
    expect(blockedLease.status).toBe(403);

    const granted = await callRoute(routes, "POST", "/api/alpha/control/lease", {
      body: { packageName: "org.mozilla.firefox", maxOps: 3, durationMs: 60_000 },
    });
    expect(granted.status).toBe(200);

    const openFirefox = await action.handler(runtime, emptyMessage("Open example.org in Firefox"), emptyState, {
      parameters: { op: { type: "app_open_url", url: "https://example.org" } },
    });
    expect(openFirefox?.success).toBe(true);
    const next1 = await callRoute(routes, "GET", "/api/alpha-control/next");
    const op1 = next1.body.op as { opId: number; boundSnapId: number; expectedPackage: string; op: { type: string; packageName?: string } };
    expect(op1.boundSnapId).toBe(0);
    expect(op1.expectedPackage).toBe("org.mozilla.firefox");
    expect(op1.op.packageName).toBe("org.mozilla.firefox");
    const receipt1 = await callRoute(routes, "POST", "/api/alpha-control/receipt", { body: { opId: op1.opId, outcome: "done" } });
    expect(receipt1.status).toBe(200);

    const openUnleasedBrowser = await action.handler(runtime, emptyMessage("Open in Chrome"), emptyState, {
      parameters: { op: { type: "app_open_url", url: "https://example.org", packageName: "com.android.chrome" } },
    });
    expect(openUnleasedBrowser?.success).toBe(false);
    expect((openUnleasedBrowser?.data as { code: string; leaseRequest?: { packageName: string; requestedOp: string } }).code).toBe("LEASE_REQUIRED");
    expect((openUnleasedBrowser?.data as { leaseRequest?: { packageName: string; requestedOp: string } }).leaseRequest).toMatchObject({
      packageName: "com.android.chrome",
      requestedOp: "app_open_url",
    });
    const pendingPromptState = await callRoute(routes, "GET", "/api/alpha/control/state");
    expect(pendingPromptState.body.leaseRequest).toMatchObject({
      packageName: "com.android.chrome",
      requestedOp: "app_open_url",
    });

    const firefoxObs = await callRoute(routes, "POST", "/api/alpha-control/observe", {
      body: {
        tier: "TierPrivileged",
        capabilities: ["ui.observe.v1", "ui.act.v1", "ui.screenshot.v1", "ui.inject.v1"],
        packageName: "org.mozilla.firefox",
        activityName: "org.mozilla.fenix.HomeActivity",
        webUri: "https://example.org",
        protection: "ScreenClear",
        windowCount: 1,
        nodes: [
          { nodeId: "n_link", role: "Link", text: "More information", bounds: { left: 10, top: 200, right: 300, bottom: 260 }, clickable: true, editable: false, scrollable: false, sensitive: false },
          { nodeId: "n_pass", role: "EditText", text: "secret-password", bounds: { left: 10, top: 300, right: 300, bottom: 360 }, clickable: true, editable: true, scrollable: false, sensitive: true },
        ],
      },
    });
    const snapId = firefoxObs.body.snapshotId as number;
    expect(snapId).toBeGreaterThan(1);

    const context = await provider.get(runtime, emptyMessage("context"), emptyState);
    expect(context.text).toContain("https://example.org");
    expect(context.text).toContain("n_link");
    expect(context.text).not.toContain("secret-password");

    const staleClick = await action.handler(runtime, emptyMessage("Stale click"), emptyState, {
      parameters: { op: { type: "ui_click", snapshotId: snapId - 1, expectedPackage: "org.mozilla.firefox", nodeId: "n_link" } },
    });
    expect(staleClick?.success).toBe(false);
    expect((staleClick?.data as { code: string }).code).toBe("STALE_SNAPSHOT");

    const sensitiveClick = await action.handler(runtime, emptyMessage("Password click"), emptyState, {
      parameters: { op: { type: "ui_click", snapshotId: snapId, expectedPackage: "org.mozilla.firefox", nodeId: "n_pass" } },
    });
    expect(sensitiveClick?.success).toBe(false);
    expect((sensitiveClick?.data as { code: string }).code).toBe("SENSITIVE_VIEW");

    const liveClick = await action.handler(runtime, emptyMessage("Click link"), emptyState, {
      parameters: { op: { type: "ui_click", snapshotId: snapId, expectedPackage: "org.mozilla.firefox", nodeId: "n_link" } },
    });
    expect(liveClick?.success).toBe(true);
    const next2 = await callRoute(routes, "GET", "/api/alpha-control/next");
    const op2 = next2.body.op as { opId: number };
    const receipt2 = await callRoute(routes, "POST", "/api/alpha-control/receipt", {
      body: { opId: op2.opId, outcome: "done", postSnapshotId: snapId + 1 },
    });
    expect(receipt2.status).toBe(200);
    expect((receipt2.body.receipt as { postSnapshotId?: number }).postSnapshotId).toBe(snapId + 1);

    const privateObs = await callRoute(routes, "POST", "/api/alpha-control/observe", {
      body: {
        tier: "TierPrivileged",
        capabilities: ["ui.observe.v1", "ui.act.v1"],
        packageName: "org.mozilla.firefox",
        activityName: "org.mozilla.fenix.HomeActivity",
        webUri: "https://private.example.org",
        protection: "PrivateTab",
        windowCount: 1,
        nodes: [{ nodeId: "priv", role: "Text", text: "private", bounds: { left: 0, top: 0, right: 10, bottom: 10 }, clickable: true, editable: false, scrollable: false, sensitive: false }],
      },
    });
    const privSnap = privateObs.body.snapshotId as number;
    const afterPrivateState = await callRoute(routes, "GET", "/api/alpha/control/state");
    expect(afterPrivateState.body.leaseRequest).toBeNull();
    const privateClick = await action.handler(runtime, emptyMessage("Private click"), emptyState, {
      parameters: { op: { type: "ui_click", snapshotId: privSnap, expectedPackage: "org.mozilla.firefox", nodeId: "priv" } },
    });
    expect(privateClick?.success).toBe(false);
    expect((privateClick?.data as { code: string }).code).toBe("PROTECTED_SCREEN");

    const clearAgain = await callRoute(routes, "POST", "/api/alpha-control/observe", {
      body: {
        tier: "TierPrivileged",
        capabilities: ["ui.observe.v1", "ui.act.v1", "ui.inject.v1"],
        packageName: "org.mozilla.firefox",
        activityName: "org.mozilla.fenix.HomeActivity",
        protection: "ScreenClear",
        windowCount: 1,
        nodes: [],
      },
    });
    const clearSnap = clearAgain.body.snapshotId as number;
    const keyEvent = await action.handler(runtime, emptyMessage("Press Enter"), emptyState, {
      parameters: { op: { type: "ui_key_event", snapshotId: clearSnap, expectedPackage: "org.mozilla.firefox", keyCode: "ENTER" } },
    });
    expect(keyEvent?.success).toBe(true);

    const stopped = await callRoute(routes, "POST", "/api/alpha/control/stop", { body: { reason: "owner_stop" } });
    expect(stopped.status).toBe(200);
    expect(stopped.body.killed).toBe(true);
    expect(stopped.body.pending).toBeNull();
    expect((stopped.body.lease as { status: string }).status).toBe("LeaseRevoked");

    const afterStop = await action.handler(runtime, emptyMessage("Click after stop"), emptyState, {
      parameters: { op: { type: "ui_scroll", snapshotId: clearSnap, expectedPackage: "org.mozilla.firefox", direction: "down" } },
    });
    expect(afterStop?.success).toBe(false);
    expect((afterStop?.data as { code: string }).code).toBe("KILL_SWITCH_ACTIVE");

    const overBudget = coordinator.grantLease({ packageName: "org.mozilla.firefox", maxOps: MAX_LEASE_OPS + 1, durationMs: 30_000 }, clock);
    expect(overBudget.ok).toBe(false);
    const expiredCheck = coordinator.snapshot(clock + 1_000);
    expect(expiredCheck.killed).toBe(true);
    const stateRoute = await callRoute(routes, "GET", "/api/alpha/control/state");
    expect(stateRoute.status).toBe(200);
  });
});
