// spec/agent/index.md, "The page reaches exactly the routes its platform services call, and nothing else"
import type { ClockProjection, ClockTap } from "../../src/platform/clock-alerts.vibe";
import { plugIn } from "./phone.ts";
import { type Route, readJsonBody } from "./routes.ts";

/** The Android scheduler, independent of the Clock renderer which publishes deadlines and handles owner taps. */
export function installClockScheduler() {
  let projection: ClockProjection = { alerts: [], ready: false, known: [] };
  let standaloneInstalled = false;
  let foreground = "";
  let notificationsEnabled = false;
  let pending: ClockTap | undefined;
  let changed = () => {};
  const unplug = plugIn({
    AlphaDevice: () => ({
      launchSiblingApp({ targetPackage }: { targetPackage: string }) {
        if (standaloneInstalled) foreground = targetPackage;
        return { launched: standaloneInstalled };
      },
    }),
    AlphaClockAlerts: (emit) => {
      changed = () => emit("clockAlertOpen", {});
      return {
        reconcile(input: ClockProjection) {
          projection = input;
          return { notificationsEnabled, exact: true };
        },
        checkPermissions: () => ({ notifications: notificationsEnabled ? "granted" : "prompt" }),
        requestPermissions() { notificationsEnabled = true; return { notifications: "granted" }; },
        pendingTap: () => pending ?? {},
        consumeTap({ token }: { token: string }) { if (pending?.token === token) pending = undefined; },
      };
    },
  });
  return {
    unplug, alerts: () => projection.alerts, projection: () => projection,
    installStandalone() { standaloneInstalled = true; }, foreground: () => foreground, pending: () => pending,
    tap(next: ClockTap) { pending = next; changed(); },
  };
}

/** Alarm record shape exchanged on `/api/alpha/clock/*`. */
export interface FakeClockAlarm {
  id: string;
  hour: number;
  minute: number;
  daysMask: number;
  label: string;
  sound: "radar" | "chime" | "pulse" | "gentle" | "classic";
  vibrate: boolean;
  enabled: boolean;
  snoozeMinutes: number;
  phase: "idle" | "ringing" | "snoozed";
  fireAtMs: number | null;
  snoozeUntilMs: number | null;
  missed: boolean;
  revision: number;
  updatedAtMs: number;
}

/** Timer record shape exchanged on `/api/alpha/clock/*`. */
export interface FakeClockTimer {
  id: string;
  label: string;
  durationMs: number;
  remainingMs: number;
  status: "ready" | "running" | "paused" | "ringing";
  startedAtMs: number | null;
  endAtMs: number | null;
  ringStartedAtMs: number | null;
  revision: number;
  updatedAtMs: number;
}

/** World city record shape exchanged on `/api/alpha/clock/*`. */
export interface FakeWorldCity {
  id: string;
  city: string;
  region: string;
  timeZone: string;
  order: number;
}

/** Mutable Clock scene backing fake `/api/alpha/clock/*` HTTP routes in tests and dev mode. */
export interface ClockScene {
  version: number;
  updatedAtMs: number;
  alarms: FakeClockAlarm[];
  timers: FakeClockTimer[];
  world: FakeWorldCity[];
  deletedAlarmIds: string[];
  deletedTimerIds: string[];
  nextId: number;
  failStatus: number | undefined;
}

/** Fresh empty Clock scene. */
export function clockScene(): ClockScene {
  return {
    version: 0, updatedAtMs: 0, alarms: [], timers: [], world: [],
    deletedAlarmIds: [], deletedTimerIds: [], nextId: 1, failStatus: undefined,
  };
}

const snapshotOf = (scene: ClockScene) => ({
  version: scene.version,
  updatedAtMs: scene.updatedAtMs,
  alarms: scene.alarms,
  timers: scene.timers,
  world: scene.world,
  deletedAlarmIds: scene.deletedAlarmIds,
  deletedTimerIds: scene.deletedTimerIds,
});

/** Fake agent routes serving `/api/alpha/clock/*` over `scene`. */
export function clockRoutes(scene: ClockScene, now: () => number): Route[] {
  const failIfConfigured = () =>
    scene.failStatus === undefined ? undefined : Response.json({ error: "clock_unavailable" }, { status: scene.failStatus });
  const commitAlarm = (index: number, updated: FakeClockAlarm, ts: number) => {
    scene.alarms[index] = updated;
    scene.version += 1;
    scene.updatedAtMs = ts;
    return Response.json({ alarm: updated, snapshot: snapshotOf(scene) });
  };

  return [
    (request, url) => {
      if (url.pathname !== "/api/alpha/clock") return undefined;
      const err = failIfConfigured();
      if (err !== undefined) return err;
      if (request.method === "GET") return Response.json(snapshotOf(scene));
      if (request.method === "PUT") {
        return readJsonBody(request).then((body) => {
          const ts = now();
          if (Array.isArray(body.alarms)) scene.alarms = body.alarms as FakeClockAlarm[];
          if (Array.isArray(body.timers)) scene.timers = body.timers as FakeClockTimer[];
          if (Array.isArray(body.world)) scene.world = body.world as FakeWorldCity[];
          if (Array.isArray(body.deletedAlarmIds)) scene.deletedAlarmIds = body.deletedAlarmIds as string[];
          if (Array.isArray(body.deletedTimerIds)) scene.deletedTimerIds = body.deletedTimerIds as string[];
          scene.version += 1;
          scene.updatedAtMs = ts;
          return Response.json(snapshotOf(scene));
        });
      }
      return undefined;
    },
    (request, url) => {
      if (url.pathname !== "/api/alpha/clock/alarms" || request.method !== "POST") return undefined;
      const err = failIfConfigured();
      if (err !== undefined) return err;
      return readJsonBody(request).then((body) => {
        const ts = now();
        const alarm: FakeClockAlarm = {
          id: typeof body.id === "string" && body.id !== "" ? body.id : `alarm-${scene.nextId++}`,
          hour: typeof body.hour === "number" ? body.hour : 7,
          minute: typeof body.minute === "number" ? body.minute : 0,
          daysMask: typeof body.daysMask === "number" ? body.daysMask : 0,
          label: typeof body.label === "string" ? body.label : "",
          sound: (typeof body.sound === "string" ? body.sound : "radar") as FakeClockAlarm["sound"],
          vibrate: typeof body.vibrate === "boolean" ? body.vibrate : true,
          enabled: typeof body.enabled === "boolean" ? body.enabled : true,
          snoozeMinutes: typeof body.snoozeMinutes === "number" ? body.snoozeMinutes : 10,
          phase: "idle",
          fireAtMs: typeof body.fireAtMs === "number" ? body.fireAtMs : ts + 3_600_000,
          snoozeUntilMs: null,
          missed: false,
          revision: 1,
          updatedAtMs: ts,
        };
        scene.alarms = [...scene.alarms.filter((entry) => entry.id !== alarm.id), alarm];
        scene.version += 1;
        scene.updatedAtMs = ts;
        return Response.json({ alarm, snapshot: snapshotOf(scene) }, { status: 201 });
      });
    },
    (request, url) => {
      const match = /^\/api\/alpha\/clock\/alarms\/([^/]+)(?:\/(snooze|dismiss))?$/.exec(url.pathname);
      if (match === null) return undefined;
      const err = failIfConfigured();
      if (err !== undefined) return err;
      const id = decodeURIComponent(match[1] ?? "");
      const sub = match[2];
      const index = scene.alarms.findIndex((entry) => entry.id === id);
      if (index < 0) return Response.json({ error: "alarm_not_found" }, { status: 404 });
      const existing = scene.alarms[index];
      if (existing === undefined) return Response.json({ error: "alarm_not_found" }, { status: 404 });
      if (request.method === "DELETE" && sub === undefined) {
        scene.alarms = scene.alarms.filter((entry) => entry.id !== id);
        scene.deletedAlarmIds = [...scene.deletedAlarmIds.filter((entry) => entry !== id), id];
        scene.version += 1;
        scene.updatedAtMs = now();
        return Response.json({ alarm: existing, snapshot: snapshotOf(scene) });
      }
      if (request.method === "POST" && sub === "snooze") {
        return readJsonBody(request).then((body) => {
          const ts = now();
          const mins = typeof body.minutes === "number" ? body.minutes : existing.snoozeMinutes;
          const until = ts + mins * 60_000;
          return commitAlarm(index, { ...existing, enabled: true, phase: "snoozed", snoozeUntilMs: until, fireAtMs: until, missed: false, revision: existing.revision + 1, updatedAtMs: ts }, ts);
        });
      }
      if (request.method === "POST" && sub === "dismiss") {
        const ts = now();
        return commitAlarm(index, { ...existing, enabled: existing.daysMask !== 0 ? existing.enabled : false, phase: "idle", snoozeUntilMs: null, missed: false, revision: existing.revision + 1, updatedAtMs: ts }, ts);
      }
      if (request.method === "PATCH" && sub === undefined) {
        return readJsonBody(request).then((body) => {
          const ts = now();
          return commitAlarm(index, { ...existing, ...(body as Partial<FakeClockAlarm>), id: existing.id, revision: existing.revision + 1, updatedAtMs: ts }, ts);
        });
      }
      return undefined;
    },
    (request, url) => {
      if (url.pathname === "/api/alpha/clock/timers" && request.method === "POST") {
        const err = failIfConfigured();
        if (err !== undefined) return err;
        return readJsonBody(request).then((body) => {
          const ts = now();
          const durationMs = typeof body.durationMs === "number" ? body.durationMs : 60_000;
          const startNow = typeof body.startImmediately === "boolean" ? body.startImmediately : true;
          const timer: FakeClockTimer = {
            id: typeof body.id === "string" && body.id !== "" ? body.id : `timer-${scene.nextId++}`,
            label: typeof body.label === "string" ? body.label : "",
            durationMs,
            remainingMs: durationMs,
            status: startNow ? "running" : "ready",
            startedAtMs: startNow ? ts : null,
            endAtMs: startNow ? ts + durationMs : null,
            ringStartedAtMs: null,
            revision: 1,
            updatedAtMs: ts,
          };
          scene.timers = [...scene.timers.filter((entry) => entry.id !== timer.id), timer];
          scene.version += 1;
          scene.updatedAtMs = ts;
          return Response.json({ timer, snapshot: snapshotOf(scene) }, { status: 201 });
        });
      }
      const match = /^\/api\/alpha\/clock\/timers\/([^/]+)$/.exec(url.pathname);
      if (match === null) return undefined;
      const err = failIfConfigured();
      if (err !== undefined) return err;
      const id = decodeURIComponent(match[1] ?? "");
      const index = scene.timers.findIndex((entry) => entry.id === id);
      if (index < 0) return Response.json({ error: "timer_not_found" }, { status: 404 });
      const existing = scene.timers[index];
      if (existing === undefined) return Response.json({ error: "timer_not_found" }, { status: 404 });
      if (request.method === "DELETE") {
        scene.timers = scene.timers.filter((entry) => entry.id !== id);
        scene.deletedTimerIds = [...scene.deletedTimerIds.filter((entry) => entry !== id), id];
        scene.version += 1;
        scene.updatedAtMs = now();
        return Response.json({ timer: existing, snapshot: snapshotOf(scene) });
      }
      if (request.method === "PATCH") {
        return readJsonBody(request).then((body) => {
          const ts = now();
          const updated: FakeClockTimer = { ...existing, ...(body as Partial<FakeClockTimer>), id: existing.id, revision: existing.revision + 1, updatedAtMs: ts };
          scene.timers[index] = updated;
          scene.version += 1;
          scene.updatedAtMs = ts;
          return Response.json({ timer: updated, snapshot: snapshotOf(scene) });
        });
      }
      return undefined;
    },
    (request, url) => {
      if (url.pathname === "/api/alpha/clock/world" && request.method === "POST") {
        const err = failIfConfigured();
        if (err !== undefined) return err;
        return readJsonBody(request).then((body) => {
          const ts = now();
          const zone = typeof body.timeZone === "string" ? body.timeZone : "UTC";
          const city: FakeWorldCity = {
            id: typeof body.id === "string" && body.id !== "" ? body.id : zone.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            city: typeof body.city === "string" ? body.city : zone,
            region: typeof body.region === "string" ? body.region : "",
            timeZone: zone,
            order: scene.world.length,
          };
          scene.world = [...scene.world.filter((entry) => entry.timeZone !== city.timeZone), city].map((entry, idx) => ({ ...entry, order: idx }));
          scene.version += 1;
          scene.updatedAtMs = ts;
          return Response.json({ city, snapshot: snapshotOf(scene) }, { status: 201 });
        });
      }
      const match = /^\/api\/alpha\/clock\/world\/([^/]+)$/.exec(url.pathname);
      if (match === null || request.method !== "DELETE") return undefined;
      const err = failIfConfigured();
      if (err !== undefined) return err;
      const id = decodeURIComponent(match[1] ?? "");
      const existing = scene.world.find((entry) => entry.id === id);
      if (existing === undefined) return Response.json({ error: "world_city_not_found" }, { status: 404 });
      scene.world = scene.world.filter((entry) => entry.id !== id).map((entry, idx) => ({ ...entry, order: idx }));
      scene.version += 1;
      scene.updatedAtMs = now();
      return Response.json({ city: existing, snapshot: snapshotOf(scene) });
    },
  ];
}
