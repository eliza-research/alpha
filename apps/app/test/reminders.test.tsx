// @vitest-environment happy-dom
// spec/app/reminders/index.md, "Story: Organize reminders across smart views and custom lists"; spec/app/reminders/index.md, "Story: Create, update, flag, move, complete and delete reminders with Undo"; spec/app/reminders/alerts.md, "Story: Alert on due reminders and act from the banner"; spec/app/reminders/recurrence.md, "Story: Repeat reminders cleanly across months and leap years"
import type { AndroidReminderCancelInput, AndroidReminderTarget } from "@elizaos/os-bridges";
import type { ReminderItemRecord, ReminderListRecord, RemindersSnapshot } from "@repo/launcher-records";
import { HttpClient, HttpClientResponse } from "effect/http";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { Machine as Home } from "../gen/app__home.effect.vibe";
import * as RemindersMachine from "../gen/app__reminders.effect.vibe";
import { Machine as Shell } from "../gen/app__shell.effect.vibe";
import * as AlertsMachine from "../gen/app__reminders__alerts.effect.vibe";
import * as EditorMachine from "../gen/app__reminders__editor.effect.vibe";
import { Machine as Editor } from "../gen/app__reminders__editor.effect.vibe";
import { Machine as Listing } from "../gen/app__workflows__list.effect.vibe";
import { at } from "../src/areas.ts";
import home from "../src/home/index.tsx";
import { agentAt } from "../src/platform/agent.vibe";
import { cloudAt } from "../src/platform/cloud.vibe";
import { pagePlatform } from "../src/platform/platform.vibe";
import { PhoneReminders, RemindersUnread } from "../src/platform/reminders.vibe";
import { syncAlertsWithSnapshot } from "../src/reminders/alerts.vibe";
import alertOverlayArea from "../src/reminders/alertOverlay.tsx";
import { beginEditReminder, updateEditorDraft } from "../src/reminders/editor.vibe";
import remindersArea from "../src/reminders/index.tsx";
import { advanceDueDate, civilDateAt, dueInstantMs, formatCivilDate, formatRelativeDue } from "../src/reminders/recurrence.ts";
import {
  clearCompletedReminders,
  createReminderItem,
  createReminderList,
  deleteReminderItem,
  deleteReminderList,
  saveReminderDraft,
  syncRemindersNow,
  toggleReminderComplete,
  toggleReminderFlag,
  updateReminderList,
} from "../src/reminders/reminders.vibe";
import { RemindersShelf } from "../src/reminders/shelf.vibe";
import {
  computeSmartCounts,
  DEFAULT_LIST_ID,
  defaultSnapshot,
} from "../src/reminders/store.ts";
import workflows from "../src/workflows/index.tsx";
import { button, closeAll, drawn, fill, hardware, later, only, openOver, press, pressOnTop, underAct, until } from "./alpha.tsx";
import { memoryIndexedDB } from "./fakes/indexeddb.ts";
import { scene } from "./fakes/scene.ts";

underAct();

interface AgentRecorder {
  snapshot: RemindersSnapshot;
  readonly calls: { readonly method: string; readonly path: string; readonly query: string; readonly key: string | undefined; readonly body: Record<string, unknown> }[];
}

function makeFakeAgentReminders(initialNowMs: number, held: readonly ReminderItemRecord[] = []): { readonly recorder: AgentRecorder; readonly layer: Layer.Layer<HttpClient.HttpClient> } {
  const recorder: AgentRecorder = {
    snapshot: { ...defaultSnapshot(initialNowMs), items: [...held] },
    calls: [],
  };
  const layer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) => Effect.sync(() => {
      const path = url.pathname;
      const method = request.method;
      const rawBody = request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
      const parsed = rawBody ? JSON.parse(rawBody) as Record<string, unknown> : {};
      recorder.calls.push({ method, path, query: url.search, key: request.headers["idempotency-key"], body: parsed });

      if (path === "/api/health") {
        return HttpClientResponse.fromWeb(request, new Response(JSON.stringify({ ready: true }), { status: 200, headers: { "content-type": "application/json" } }));
      }
      if (path === "/api/auth/me" && method === "GET") {
        return HttpClientResponse.fromWeb(request, Response.json({ identity: { id: "local-agent", kind: "owner" }, access: { role: "OWNER", mode: "local" } }));
      }
      if (path === "/api/alpha/reminders" && method === "GET") {
        return HttpClientResponse.fromWeb(request, new Response(JSON.stringify(recorder.snapshot), { status: 200, headers: { "content-type": "application/json" } }));
      }
      if (path === "/api/alpha/reminders/lists" && method === "POST") {
        const list = parsed as unknown as ReminderListRecord;
        recorder.snapshot = { ...recorder.snapshot, version: recorder.snapshot.version + 1, lists: [...recorder.snapshot.lists, list] };
        return HttpClientResponse.fromWeb(request, new Response(JSON.stringify(list), { status: 200, headers: { "content-type": "application/json" } }));
      }
      if (path.startsWith("/api/alpha/reminders/lists/") && method === "PATCH") {
        const id = decodeURIComponent(path.slice("/api/alpha/reminders/lists/".length));
        const list = parsed as unknown as ReminderListRecord;
        recorder.snapshot = { ...recorder.snapshot, version: recorder.snapshot.version + 1, lists: recorder.snapshot.lists.map((l) => (l.id === id ? list : l)) };
        return HttpClientResponse.fromWeb(request, new Response(JSON.stringify(list), { status: 200, headers: { "content-type": "application/json" } }));
      }
      if (path.startsWith("/api/alpha/reminders/lists/") && method === "DELETE") {
        const id = decodeURIComponent(path.slice("/api/alpha/reminders/lists/".length));
        const mode = url.searchParams.get("mode");
        recorder.snapshot = {
          ...recorder.snapshot,
          version: recorder.snapshot.version + 1,
          lists: recorder.snapshot.lists.filter((l) => l.id !== id),
          items: mode === "cascade"
            ? recorder.snapshot.items.filter((i) => i.listId !== id)
            : recorder.snapshot.items.map((i) => (i.listId === id ? { ...i, listId: DEFAULT_LIST_ID } : i)),
        };
        return HttpClientResponse.fromWeb(request, new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
      }
      if (path === "/api/alpha/reminders/items" && method === "POST") {
        const item = parsed as unknown as ReminderItemRecord;
        recorder.snapshot = { ...recorder.snapshot, version: recorder.snapshot.version + 1, items: [...recorder.snapshot.items, item] };
        return HttpClientResponse.fromWeb(request, new Response(JSON.stringify(item), { status: 200, headers: { "content-type": "application/json" } }));
      }
      if (path.startsWith("/api/alpha/reminders/items/") && method === "PATCH") {
        const id = decodeURIComponent(path.slice("/api/alpha/reminders/items/".length));
        recorder.snapshot = {
          ...recorder.snapshot,
          version: recorder.snapshot.version + 1,
          items: recorder.snapshot.items.map((i) => (i.id === id ? { ...i, ...parsed } : i)),
        };
        return HttpClientResponse.fromWeb(request, new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
      }
      if (path.startsWith("/api/alpha/reminders/items/") && method === "DELETE") {
        const id = decodeURIComponent(path.slice("/api/alpha/reminders/items/".length));
        recorder.snapshot = { ...recorder.snapshot, version: recorder.snapshot.version + 1, items: recorder.snapshot.items.filter((i) => i.id !== id) };
        return HttpClientResponse.fromWeb(request, new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
      }
      if (path.startsWith("/api/alpha/reminders/items/") && method === "POST") {
        const suffix = path.slice("/api/alpha/reminders/items/".length);
        const [rawId, action] = suffix.split("/");
        const id = decodeURIComponent(rawId ?? "");
        if (action === "complete") {
          const item = (parsed.item as ReminderItemRecord | undefined);
          recorder.snapshot = {
            ...recorder.snapshot,
            version: recorder.snapshot.version + 1,
            items: recorder.snapshot.items.map((i) => (i.id === id ? (item ?? { ...i, completed: true }) : i)),
          };
        } else if (action === "reopen") {
          recorder.snapshot = {
            ...recorder.snapshot,
            version: recorder.snapshot.version + 1,
            items: recorder.snapshot.items.map((i) => (i.id === id ? { ...i, completed: false, completedAtMs: null } : i)),
          };
        } else if (action === "restore") {
          const item = parsed.item as ReminderItemRecord | undefined;
          if (item) {
            recorder.snapshot = {
              ...recorder.snapshot,
              version: recorder.snapshot.version + 1,
              items: recorder.snapshot.items.map((i) => (i.id === id ? item : i)),
            };
          }
        } else if (action === "snooze") {
          const untilMs = Number(parsed.untilMs ?? parsed.snoozedUntilMs ?? 0);
          recorder.snapshot = {
            ...recorder.snapshot,
            version: recorder.snapshot.version + 1,
            items: recorder.snapshot.items.map((i) => (i.id === id ? { ...i, snoozedUntilMs: untilMs } : i)),
          };
        }
        return HttpClientResponse.fromWeb(request, new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
      }
      return HttpClientResponse.fromWeb(request, new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } }));
    })),
  );
  return { recorder, layer };
}

const withReminders = [
  ...only("home", "notice", "view:Workflows"),
  at("view:Reminders", () => Promise.resolve({ default: remindersArea })),
  at("overlay", () => Promise.resolve({ default: alertOverlayArea })),
];

interface ArmedCall {
  readonly id: string;
  readonly at: number;
}

function makePlatform(nowMs: number, agentHttp: Layer.Layer<HttpClient.HttpClient>, armed?: ArmedCall[]) {
  const clock = Layer.provideMerge(Layer.effectDiscard(TestClock.setTime(nowMs)), TestClock.layer());
  const base = pagePlatform(
    Layer.provide(agentAt("http://agent.test"), agentHttp),
    Layer.provide(cloudAt("http://cloud.test"), agentHttp),
  );
  const withClock = Layer.provideMerge(base, clock);
  if (!armed) return withClock;
  const fakePhoneReminders = Layer.succeed(PhoneReminders, {
    present: true,
    schedule: (input) => Effect.sync(() => {
      armed.push({ id: input.id, at: input.at });
      return { id: input.id, status: "scheduled", at: input.at, mode: "inexact", message: "" };
    }),
    cancel: (input) => Effect.succeed({ id: input.id, status: "cancelled", mode: "inexact", message: "" }),
    list: () => Effect.succeed({ reminders: [], notificationsEnabled: true }),
    operate: () => Effect.succeed({ status: "unknown" as const }),
    pendingTap: () => Effect.succeed({}),
    consumeTap: () => Effect.void,
  });
  return Layer.provideMerge(fakePhoneReminders, withClock);
}

afterEach(async () => {
  await closeAll();
});

describe("Reminders recurrence laws", () => {
  // spec/app/reminders/recurrence.md, "Story: Repeat reminders cleanly across months and leap years"
  it("advances daily, weekday, weekly, monthly (clamped) and yearly (leap-clamped) dates strictly later", () => {
    expect(advanceDueDate("2026-05-01", "daily")).toBe("2026-05-02");
    expect(advanceDueDate("2026-05-01", "weekdays")).toBe("2026-05-04");
    expect(advanceDueDate("2026-05-01", "weekly")).toBe("2026-05-08");
    expect(advanceDueDate("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(advanceDueDate("2024-01-31", "monthly")).toBe("2024-02-29");
    expect(advanceDueDate("2024-02-29", "yearly")).toBe("2025-02-28");
    expect(advanceDueDate("2027-02-28", "yearly")).toBe("2028-02-28");
    expect(formatRelativeDue("2026-05-01", 540, dueInstantMs("2026-05-01", 480)!, false)).toContain("Today");
  });
});

describe("Reminders full journeys", () => {
  const baseNow = Date.UTC(2026, 4, 15, 13, 0, 0);

  async function launchReminders(
    nowMs: number,
    optionsOrHeld?:
      | readonly ReminderItemRecord[]
      | ((recorder: AgentRecorder) => void)
      | { readonly armed?: ArmedCall[]; readonly seed?: (snap: RemindersSnapshot) => RemindersSnapshot },
  ) {
    const held: readonly ReminderItemRecord[] = Array.isArray(optionsOrHeld) ? optionsOrHeld : [];
    const options = typeof optionsOrHeld === "object" && !Array.isArray(optionsOrHeld)
      ? optionsOrHeld as { readonly armed?: ArmedCall[]; readonly seed?: (snap: RemindersSnapshot) => RemindersSnapshot }
      : undefined;
    const world = { ...scene(), now: nowMs };
    const { recorder, layer: agentHttp } = makeFakeAgentReminders(world.now, held);
    if (typeof optionsOrHeld === "function") optionsOrHeld(recorder);
    if (options?.seed) recorder.snapshot = options.seed(recorder.snapshot);
    const platform = makePlatform(world.now, agentHttp, options?.armed);
    const opened = await openOver(platform, withReminders);
    const runtime = remindersArea.runtime(opened.alpha);
    const currentShell = await opened.alpha.runtime.runPromise(Effect.flatMap(Shell, (m) => m.get()));
    if (currentShell.trail.at(-1) !== "Reminders") {
      await until(opened.alpha, home.runtime(opened.alpha), Home, (s) => s.tiles.load.status === "Loaded");
      await press("Reminders");
    }
    await until(opened.alpha, opened.alpha.runtime, Shell, (s) => s.trail.at(-1) === "Reminders");
    await until(opened.alpha, runtime, RemindersMachine.Machine, (s) => s.sync.status === "Loaded");
    const storeView = () => runtime.runSync(Effect.map(RemindersShelf, (service) => service.store.snapshot()));
    const writeId = () => runtime.runPromise(RemindersMachine.Machine.use((m) => Effect.map(m.get(), (s) => s.write.id)));
    const waitConfirmedAfter = async (prevId: number) => {
      await until(opened.alpha, runtime, RemindersMachine.Machine, (s) => s.write.id > prevId && s.write.outcome === "Confirmed");
    };
    return { world, recorder, platform, ...opened, runtime, storeView, writeId, waitConfirmedAfter };
  }

  // spec/app/reminders/index.md, "Story: Organize reminders across smart views and custom lists": Workflows' More options also opens a phone reminder
  it("opens a phone reminder from Workflows' More options", async () => {
    const world = { ...scene(), now: baseNow };
    const { layer: agentHttp } = makeFakeAgentReminders(world.now);
    const platform = makePlatform(world.now, agentHttp);
    const { alpha } = await openOver(platform, withReminders);
    const runtime = remindersArea.runtime(alpha);
    await until(alpha, home.runtime(alpha), Home, (s) => s.tiles.load.status === "Loaded");
    await press("Workflows");
    await until(alpha, workflows.runtime(alpha), Listing, (s) => s.owner > 0);
    await press("Add to Workflows");
    expect(button(/^Phone reminder/)).toBeUndefined();
    await press("More options");
    await press(/^Phone reminder/);
    await until(alpha, runtime, RemindersMachine.Machine, (s) => s.sync.status === "Loaded");
    await until(alpha, runtime, Editor, (s) => s.open);
    await pressOnTop("Cancel");
  });

  it("organizes smart lists, custom lists (rename + reassign/cascade delete), search and editor creation", async () => {
    const { alpha, world, recorder, runtime, storeView, writeId, waitConfirmedAfter } = await launchReminders(baseNow);
    expect(document.body.textContent).toContain("Today");
    expect(document.body.textContent).toContain("Scheduled");
    expect(document.body.textContent).toContain("Reminders");

    // spec/app/reminders/index.md, "Back from an open list returns to the overview before leaving Reminders, and leaving the app resets the overview"
    await press(/Today$/);
    expect(button("All lists")).toBeDefined();
    await press("Back");
    expect(button("All lists")).toBeUndefined();
    expect(document.querySelector('section[aria-label="Smart lists"]')).toBeTruthy();

    const today = formatCivilDate(civilDateAt(world.now));
    let prev = await writeId();
    const work = await runtime.runPromise(createReminderList("Work", "green", "work"));
    expect(work?.name).toBe("Work");
    await waitConfirmedAfter(prev);

    prev = await writeId();
    const errands = await runtime.runPromise(createReminderList("Errands", "amber", "shopping"));
    await waitConfirmedAfter(prev);

    prev = await writeId();
    await runtime.runPromise(updateReminderList(work!.id, "Deep Work", "violet", "bolt"));
    await waitConfirmedAfter(prev);

    await press(/^Deep Work/);
    expect(button("All lists")).toBeDefined();
    await drawn(() => alpha.back());
    expect(document.querySelector('section[aria-label="Smart lists"]')).toBeTruthy();

    prev = await writeId();
    const dueItem = await runtime.runPromise(createReminderItem({
      listId: work!.id,
      title: "Ship Alpha Reminders",
      notes: "Verify proofs and UI polish",
      dueDate: today,
      dueMinute: 23 * 60,
      recurrence: "daily",
      priority: "high",
      flagged: true,
      subtasks: [{ id: "s1", title: "Run Dafny", done: true }, { id: "s2", title: "Test banner", done: false }],
    }));
    await waitConfirmedAfter(prev);

    prev = await writeId();
    await runtime.runPromise(createReminderItem({
      listId: errands!.id,
      title: "Buy coffee beans",
      dueDate: formatCivilDate(civilDateAt(world.now - 2 * 86_400_000)),
      priority: "low",
    }));
    await waitConfirmedAfter(prev);

    // spec/app/reminders/index.md, "Smart-list counts stay mathematically consistent across Overdue, Today, Scheduled, Flagged, All and Completed"
    const counts = computeSmartCounts(storeView().snapshot.items, storeView().hiddenIds, world.now);
    expect(counts.OverdueView).toBe(1);
    expect(counts.TodayView).toBe(2);
    expect(counts.ScheduledView).toBe(2);
    expect(counts.FlaggedView).toBe(1);
    expect(counts.AllView).toBe(2);
    expect(counts.CompletedView).toBe(0);

    // spec/app/reminders/index.md, "Switching smart views, custom lists, sort, filter, search and item selection keeps every reference valid": live search across notes and subtasks
    await fill("Search reminders", "Dafny");
    expect(document.body.textContent).toContain("Ship Alpha Reminders");
    await fill("Search reminders", "");

    // spec/app/reminders/index.md, "Creating, renaming and deleting custom lists protects the default Reminders list and keeps every item in a valid list"
    prev = await writeId();
    await runtime.runPromise(deleteReminderList(work!.id, "ReassignToDefault"));
    await waitConfirmedAfter(prev);
    expect(storeView().snapshot.items.find((i) => i.id === dueItem!.id)?.listId).toBe(DEFAULT_LIST_ID);

    prev = await writeId();
    await runtime.runPromise(deleteReminderList(errands!.id, "CascadeItems"));
    await waitConfirmedAfter(prev);
    expect(storeView().snapshot.items.some((i) => i.title === "Buy coffee beans")).toBe(false);
    expect(recorder.calls.some((c) => c.method === "DELETE" && c.path.includes("/lists/"))).toBe(true);
  });

  // spec/app/reminders/index.md, "Completing a reminder holds a five-second Undo snapshot and advances a repeating reminder to its next due day"
  // spec/app/reminders/index.md, "Deleting a reminder hides it immediately and holds it for five seconds before committing the deletion"
  it("advances recurring completion with 5s Undo and holds delete for 5s before committing to agent", async () => {
    const { world, recorder, alpha, runtime, storeView, writeId, waitConfirmedAfter } = await launchReminders(baseNow);

    const today = formatCivilDate(civilDateAt(world.now));
    const expectedNext = advanceDueDate(today, "daily");
    let prev = await writeId();
    const recurring = await runtime.runPromise(createReminderItem({
      listId: DEFAULT_LIST_ID,
      title: "Take vitamins",
      dueDate: today,
      recurrence: "daily",
    }));
    await waitConfirmedAfter(prev);

    // spec/app/reminders/index.md, "Completing a reminder holds a five-second Undo snapshot and advances a repeating reminder to its next due day"
    prev = await writeId();
    await drawn(() => runtime.runPromise(toggleReminderComplete(recurring!.id)));
    await waitConfirmedAfter(prev);
    const afterComplete = storeView().snapshot.items.find((i) => i.id === recurring!.id)!;
    expect(afterComplete.completed).toBe(false);
    expect(afterComplete.dueDate).toBe(expectedNext);
    expect(Boolean(button("Undo"))).toBe(true);

    prev = await writeId();
    await later(alpha, 2_000);
    await press("Undo");
    await until(alpha, runtime, RemindersMachine.Machine, (s) => s.undo.holding === "Undone" && s.write.id > prev && s.write.outcome === "Confirmed");
    expect(storeView().snapshot.items.find((i) => i.id === recurring!.id)?.dueDate).toBe(today);

    // spec/app/reminders/index.md, "Creating, updating, flagging and moving a reminder validates its list, due time and recurrence and sends one write at a time"
    prev = await writeId();
    await drawn(() => runtime.runPromise(toggleReminderFlag(recurring!.id)));
    await waitConfirmedAfter(prev);
    expect(storeView().snapshot.items.find((i) => i.id === recurring!.id)?.flagged).toBe(true);

    // spec/app/reminders/index.md, "Undo within five seconds restores a hidden deletion or reverts the completed reminder's exact prior state"
    await drawn(() => runtime.runPromise(deleteReminderItem(recurring!.id)));
    expect(storeView().hiddenIds.has(recurring!.id)).toBe(true);
    await later(alpha, 3_000);
    await press("Undo");
    await until(alpha, runtime, RemindersMachine.Machine, (s) => s.undo.holding === "Undone");
    expect(storeView().hiddenIds.size).toBe(0);
    expect(recorder.calls.some((c) => c.method === "DELETE" && c.path.includes("/items/"))).toBe(false);

    // spec/app/reminders/index.md, "Once the five-second window expires, a held deletion is committed and a held completion settles"
    prev = await writeId();
    await drawn(() => runtime.runPromise(deleteReminderItem(recurring!.id)));
    await later(alpha, 5_100);
    await until(alpha, runtime, RemindersMachine.Machine, (s) => s.undo.holding === "Released" && s.write.id > prev && s.write.outcome === "Confirmed");
    expect(storeView().snapshot.items.length).toBe(0);
    expect(recorder.calls.some((c) => c.method === "DELETE" && c.path.includes(`/items/${recurring!.id}`))).toBe(true);
  });

  // spec/app/reminders/index.md, "A reminder the agent holds is one the owner can complete, delete and undo, wherever it was made"; spec/app/reminders/index.md, "Once the five-second window expires, a held deletion is committed and a held completion settles"
  it("completes and deletes a reminder made in chat, and its Undo goes when the five seconds do", async () => {
    const today = formatCivilDate(civilDateAt(baseNow));
    const plumber: ReminderItemRecord = {
      id: "rem-task-plumber", listId: DEFAULT_LIST_ID, title: "Call the plumber", notes: "", dueDate: today, dueMinute: 18 * 60, alertMinutes: 0,
      recurrence: "none", priority: "none", flagged: false, subtasks: [], completed: false, completedAtMs: null, snoozedUntilMs: null,
      notifiedAtMs: null, agentTaskId: "plumber-task", revision: 1, createdAtMs: baseNow, updatedAtMs: baseNow,
    };
    const { recorder, alpha, runtime, close, platform, storeView } = await launchReminders(baseNow, [plumber]);

    await drawn(() => runtime.runPromise(toggleReminderComplete(plumber.id)));
    await until(alpha, runtime, RemindersMachine.Machine, (s) => s.undo.holding === "Held" && s.write.outcome === "Confirmed");
    expect(recorder.calls.some((c) => c.method === "POST" && c.path === `/api/alpha/reminders/items/${plumber.id}/complete`)).toBe(true);
    expect(Boolean(button("Undo"))).toBe(true);
    await later(alpha, 5_100);
    await until(alpha, runtime, RemindersMachine.Machine, (s) => s.undo.holding === "Released");
    expect(Boolean(button("Undo"))).toBe(false);

    await drawn(() => runtime.runPromise(toggleReminderComplete(plumber.id)));
    await until(alpha, runtime, RemindersMachine.Machine, (s) => s.write.outcome === "Confirmed");
    await drawn(() => runtime.runPromise(deleteReminderItem(plumber.id)));
    expect(storeView().hiddenIds.has(plumber.id)).toBe(true);
    await later(alpha, 5_100);
    await until(alpha, runtime, RemindersMachine.Machine, (s) => s.undo.holding === "Released" && s.write.outcome === "Confirmed");
    const deleted = recorder.calls.find((c) => c.method === "DELETE" && c.path === `/api/alpha/reminders/items/${plumber.id}`);
    expect({ query: deleted?.query, keyed: (deleted?.key ?? "") !== "" }).toEqual({ query: "", keyed: true });
    expect(recorder.snapshot.items.some((item) => item.id === plumber.id)).toBe(false);
    expect(Boolean(button("Undo"))).toBe(false);

    // spec/app/reminders/index.md, "A reminder the agent holds is one the owner can complete, delete and undo, wherever it was made": two quick deletes both happen
    const first = await runtime.runPromise(createReminderItem({ listId: DEFAULT_LIST_ID, title: "Water plants" }));
    await until(alpha, runtime, RemindersMachine.Machine, (s) => s.write.outcome === "Confirmed");
    const second = await runtime.runPromise(createReminderItem({ listId: DEFAULT_LIST_ID, title: "Take out trash" }));
    await until(alpha, runtime, RemindersMachine.Machine, (s) => s.write.outcome === "Confirmed");
    await drawn(() => runtime.runPromise(deleteReminderItem(first!.id)));
    await drawn(() => runtime.runPromise(deleteReminderItem(second!.id)));
    expect(recorder.snapshot.items.some((item) => item.id === first!.id)).toBe(false);
    expect({ hidden: [...storeView().hiddenIds], undo: Boolean(button("Undo")) }).toEqual({ hidden: [second!.id], undo: true });
    await later(alpha, 5_100);
    await until(alpha, runtime, RemindersMachine.Machine, (s) => s.undo.holding === "Released" && s.write.outcome === "Confirmed");
    expect(recorder.snapshot.items.filter((item) => item.id === first!.id || item.id === second!.id)).toEqual([]);

    // spec/app/reminders/index.md, "A reminder the agent holds is one the owner can complete, delete and undo, wherever it was made": three fast changes run in turn, each with its own write
    const gone = await runtime.runPromise(createReminderItem({ listId: DEFAULT_LIST_ID, title: "Old list" }));
    await until(alpha, runtime, RemindersMachine.Machine, (s) => s.write.outcome === "Confirmed");
    await drawn(() => runtime.runPromise(deleteReminderItem(gone!.id)));
    await drawn(() => Promise.all([runtime.runPromise(createReminderItem({ listId: DEFAULT_LIST_ID, title: "Buy stamps" })), runtime.runPromise(createReminderItem({ listId: DEFAULT_LIST_ID, title: "Call mom" }))]));
    await until(alpha, runtime, RemindersMachine.Machine, (s) => s.write.outcome === "Confirmed" && s.undo.holding !== "Held");
    expect(recorder.snapshot.items.map((item) => item.title).filter((title) => ["Old list", "Buy stamps", "Call mom"].includes(title)).toSorted()).toEqual(["Buy stamps", "Call mom"]);

    // spec/app/reminders/index.md, "A reminder the agent holds is one the owner can complete, delete and undo, wherever it was made": a held delete resumed after a restart commits the reminder it held
    const kept = storeView().snapshot.items.find((item) => item.title === "Call mom")!;
    await drawn(() => runtime.runPromise(deleteReminderItem(kept.id)));
    await close();
    const again = await openOver(platform, withReminders);
    const againRuntime = remindersArea.runtime(again.alpha);
    await later(again.alpha, 60_000);
    await until(again.alpha, againRuntime, RemindersMachine.Machine, (s) => s.undo.holding !== "Held" && s.write.outcome !== "Sent");
    expect(recorder.snapshot.items.some((item) => item.id === kept.id)).toBe(false);
    expect(recorder.snapshot.items.some((item) => item.title === "Buy stamps")).toBe(true);
  });

  // spec/app/reminders/index.md, "Creating, updating, flagging and moving a reminder validates its list, due time and recurrence and sends one write at a time"
  it("a full Reminders refuses another add and says so, instead of showing one that vanishes", async () => {
    const held: ReminderItemRecord[] = Array.from({ length: 200 }, (_, n) => ({
      id: `rem-full-${n}`, listId: DEFAULT_LIST_ID, title: `Reminder ${n}`, notes: "", dueDate: null, dueMinute: null, alertMinutes: null,
      recurrence: "none", priority: "none", flagged: false, subtasks: [], completed: false, completedAtMs: null, snoozedUntilMs: null,
      notifiedAtMs: null, agentTaskId: null, revision: 1, createdAtMs: baseNow, updatedAtMs: baseNow,
    }));
    const { recorder, runtime, storeView } = await launchReminders(baseNow, held);
    let extra: ReminderItemRecord | undefined = held[0];
    await drawn(async () => { extra = await runtime.runPromise(createReminderItem({ listId: DEFAULT_LIST_ID, title: "One more" })); });
    expect({
      made: extra,
      kept: storeView().snapshot.items.some((item) => item.title === "One more"),
      sent: recorder.calls.some((call) => call.method === "POST" && call.path === "/api/alpha/reminders/items"),
      said: document.body.textContent?.includes("Reminders holds 200 reminders. Delete one to add another."),
    }).toEqual({ made: undefined, kept: false, sent: false, said: true });
  });

  // spec/app/reminders/alerts.md, "Story: Alert on due reminders and act from the banner"
  it("fires due reminder alert on time (never early), snoozes 10m and completes from banner, and syncs chat updates across restarts", async () => {
    const armed: ArmedCall[] = [];
    // spec/app/notices/browserAlerts.md, "Story: Choose whether Alpha shows browser alerts": the browser keeps web Alerts on, so a due reminder shows its banner
    vi.stubGlobal("indexedDB", memoryIndexedDB());
    onTestFinished(() => { vi.unstubAllGlobals(); });

    const first = await launchReminders(baseNow, { armed });
    const { world, recorder, platform, alpha, runtime, storeView, writeId, waitConfirmedAfter } = first;

    const fireAt = world.now + 10 * 60_000;
    const fireDate = formatCivilDate(civilDateAt(fireAt));
    const d = new Date(fireAt);
    const dueMinute = d.getHours() * 60 + d.getMinutes();

    let prev = await writeId();
    const item = await runtime.runPromise(createReminderItem({
      listId: DEFAULT_LIST_ID,
      title: "Join standup",
      dueDate: fireDate,
      dueMinute,
      alertMinutes: 0,
    }));
    await waitConfirmedAfter(prev);
    await until(alpha, runtime, AlertsMachine.Machine, (s) => s.entries.some((entry) => entry.phase === "Scheduled"));
    await drawn(() => Promise.resolve());
    expect(armed.some((a) => a.id === item!.id)).toBe(true);

    // spec/app/reminders/alerts.md, "An alert rings only once its due time has arrived and never for a completed reminder"
    await later(alpha, 5 * 60_000);
    expect(document.querySelector("[role=alertdialog]")).toBeNull();

    await later(alpha, 6 * 60_000);
    await until(alpha, runtime, AlertsMachine.Machine, (s) => s.bannerId > 0);
    expect(document.querySelector("[role=alertdialog]")?.textContent).toContain("Join standup");

    // spec/app/reminders/alerts.md, "Snoozing from the banner moves the exact ringing revision strictly into the future, clears the banner, re-arms it and syncs once"
    await press("10m");
    await until(alpha, runtime, AlertsMachine.Machine, (s) => s.bannerId === 0);
    expect(document.querySelector("[role=alertdialog]")).toBeNull();

    // spec/app/reminders/alerts.md, "Completing from the banner marks the exact ringing revision completed, clears the banner and syncs once"
    await later(alpha, 10 * 60_000 + 1_000);
    await until(alpha, runtime, AlertsMachine.Machine, (s) => s.bannerId > 0);
    await press("Complete");
    await until(alpha, runtime, AlertsMachine.Machine, (s) => s.bannerId === 0);
    expect(storeView().snapshot.items.find((i) => i.id === item!.id)?.completed).toBe(true);
    expect(recorder.calls.some((c) => c.method === "POST" && c.path.endsWith("/complete") && c.body.item !== undefined)).toBe(true);

    // spec/app/reminders/index.md, "Refreshing fetches under the next ticket, only the newest answer settles, and a change from chat refreshes once free"
    const chatItem: ReminderItemRecord = {
      id: "rem_chat_1",
      listId: DEFAULT_LIST_ID,
      title: "Call dentist from chat",
      notes: "Created by Alpha",
      dueDate: fireDate,
      dueMinute: null,
      alertMinutes: null,
      recurrence: "none",
      priority: "medium",
      flagged: false,
      subtasks: [],
      completed: false,
      completedAtMs: null,
      snoozedUntilMs: null,
      notifiedAtMs: null,
      agentTaskId: "task_99",
      revision: 1,
      createdAtMs: world.now,
      updatedAtMs: world.now,
    };
    recorder.snapshot = { ...recorder.snapshot, version: recorder.snapshot.version + 1, items: [...recorder.snapshot.items, chatItem] };
    await drawn(() => runtime.runPromise(syncRemindersNow()));
    await until(alpha, runtime, RemindersMachine.Machine, (s) => s.sync.status === "Loaded" && !s.again && s.items.length >= 2);
    expect(storeView().snapshot.items.some((i) => i.id === "rem_chat_1")).toBe(true);

    // spec/app/reminders/editor.md, "Story: Create and edit a reminder safely"
    prev = await writeId();
    await press("New reminder");
    await fill("Title", "Pack passport");
    await pressOnTop("Save");
    await waitConfirmedAfter(prev);
    expect(storeView().snapshot.items.some((i) => i.title === "Pack passport")).toBe(true);

    // spec/app/reminders/index.md, "Story: Sync with the resident agent and recover across restarts"
    await first.close();
    const second = await openOver(platform, withReminders);
    const secondRuntime = remindersArea.runtime(second.alpha);
    await until(second.alpha, secondRuntime, RemindersMachine.Machine, (s) => s.sync.status === "Loaded");
    const secondView = secondRuntime.runSync(Effect.map(RemindersShelf, (service) => service.store.snapshot()));
    expect(secondView.snapshot.items.some((i) => i.title === "Pack passport")).toBe(true);
  });

  it("hydrates synced custom lists/items into Reminders.Machine, rings overdue alerts, handles Hardware Back, and clears completed via machine", async () => {
    const overdueAt = baseNow - 5 * 60_000;
    const overdueDate = formatCivilDate(civilDateAt(overdueAt));
    const overdueD = new Date(overdueAt);
    const overdueMinute = overdueD.getHours() * 60 + overdueD.getMinutes();

    const { alpha, runtime, recorder, storeView, writeId, waitConfirmedAfter } = await launchReminders(baseNow, {
      seed: (snap) => ({
        ...snap,
        version: 3,
        lists: [
          ...snap.lists,
          { id: "list_synced", name: "Groceries", color: "accent", icon: "shopping", isDefault: false, order: 1, createdAtMs: baseNow - 10_000, updatedAtMs: baseNow - 10_000 },
        ],
        items: [
          {
            id: "rem_synced_1",
            listId: "list_synced",
            title: "Buy oat milk",
            notes: "",
            dueDate: overdueDate,
            dueMinute: overdueMinute,
            alertMinutes: 0,
            recurrence: "none",
            priority: "high",
            flagged: false,
            subtasks: [],
            completed: false,
            completedAtMs: null,
            snoozedUntilMs: null,
            notifiedAtMs: null,
            agentTaskId: null,
            revision: 1,
            createdAtMs: baseNow - 10_000,
            updatedAtMs: baseNow - 10_000,
          },
          {
            id: "rem_done_1",
            listId: DEFAULT_LIST_ID,
            title: "Already done",
            notes: "",
            dueDate: null,
            dueMinute: null,
            alertMinutes: null,
            recurrence: "none",
            priority: "none",
            flagged: false,
            subtasks: [],
            completed: true,
            completedAtMs: baseNow - 20_000,
            snoozedUntilMs: null,
            notifiedAtMs: null,
            agentTaskId: null,
            revision: 1,
            createdAtMs: baseNow - 30_000,
            updatedAtMs: baseNow - 20_000,
          },
        ],
      }),
    });

    // spec/app/reminders/alerts.md, "Scheduling arms a reminder for its due time (including already-due overdue reminders) and replaces any earlier schedule for that reminder"
    await until(alpha, runtime, AlertsMachine.Machine, (s) => s.bannerId > 0);
    expect(document.querySelector("[role=alertdialog]")?.textContent).toContain("Buy oat milk");
    await press("Dismiss reminder alert");
    await until(alpha, runtime, AlertsMachine.Machine, (s) => s.bannerId === 0);

    // spec/app/reminders/index.md, "Switching smart views, custom lists, sort, filter, search and item selection keeps every reference valid"
    await press(/^Groceries/);
    await until(alpha, runtime, RemindersMachine.Machine, (s) => s.view.tag === "CustomList");
    expect(document.body.textContent).toContain("Buy oat milk");
    await hardware("back");
    await until(alpha, runtime, RemindersMachine.Machine, (s) => s.view.tag === "Overview");
    expect((await alpha.runtime.runPromise(Shell.use((m) => m.get()))).trail).toEqual(["Reminders"]);

    // spec/app/reminders/index.md, "Creating, updating, flagging and moving a reminder validates its list, due time and recurrence and sends one write at a time"
    let prev = await writeId();
    await drawn(() => runtime.runPromise(toggleReminderFlag("rem_synced_1")));
    await waitConfirmedAfter(prev);
    expect(storeView().snapshot.items.find((i) => i.id === "rem_synced_1")?.flagged).toBe(true);
    expect(recorder.calls.some((c) => c.method === "PATCH" && c.path.includes("/items/rem_synced_1"))).toBe(true);

    // spec/app/reminders/index.md, "Story: Create, update, flag, move, complete and delete reminders with Undo"
    prev = await writeId();
    await drawn(() => runtime.runPromise(clearCompletedReminders()));
    await waitConfirmedAfter(prev);
    expect(storeView().snapshot.items.some((i) => i.id === "rem_done_1")).toBe(false);
    expect(recorder.calls.some((c) => c.method === "DELETE" && c.path.includes("/items/rem_done_1"))).toBe(true);
  });

  // spec/app/reminders/index.md, "Story: Sync with the resident agent and recover across restarts"
  it("syncs agent lists and items into RemindersMachine so synced reminders support Undo delete and completion", async () => {
    const today = formatCivilDate(civilDateAt(baseNow));
    const { recorder, alpha, runtime, storeView } = await launchReminders(baseNow, (rec) => {
      const list: ReminderListRecord = {
        id: "list_chat",
        name: "Groceries",
        color: "accent",
        icon: "shopping",
        isDefault: false,
        order: 1,
        createdAtMs: baseNow,
        updatedAtMs: baseNow,
      };
      const item: ReminderItemRecord = {
        id: "rem_chat_2",
        listId: list.id,
        title: "Buy milk",
        notes: "",
        dueDate: today,
        dueMinute: null,
        alertMinutes: null,
        recurrence: "none",
        priority: "medium",
        flagged: false,
        subtasks: [],
        completed: false,
        completedAtMs: null,
        snoozedUntilMs: null,
        notifiedAtMs: null,
        agentTaskId: "task_chat",
        revision: 1,
        createdAtMs: baseNow,
        updatedAtMs: baseNow,
      };
      rec.snapshot = { ...rec.snapshot, version: 2, lists: [...rec.snapshot.lists, list], items: [item] };
    });

    await drawn(() => runtime.runPromise(deleteReminderItem("rem_chat_2")));
    expect(storeView().hiddenIds.has("rem_chat_2")).toBe(true);
    expect((await runtime.runPromise(RemindersMachine.Machine.use((m) => m.get()))).undo.holding).toBe("Held");
    await later(alpha, 5_100);
    await until(alpha, runtime, RemindersMachine.Machine, (s) => s.undo.holding === "Released" && s.write.outcome === "Confirmed");
    expect(storeView().snapshot.items.some((i) => i.id === "rem_chat_2")).toBe(false);
    expect(recorder.calls.some((c) => c.method === "DELETE" && c.path.includes("/items/rem_chat_2"))).toBe(true);
  });

  // spec/app/reminders/editor.md, "Story: Create and edit a reminder safely"
  it("marks the editor draft edited when switching between recurrence rules and releases Saving on vanished item", async () => {
    const today = formatCivilDate(civilDateAt(baseNow));
    const { alpha, runtime } = await launchReminders(baseNow);
    const created = await runtime.runPromise(createReminderItem({
      listId: DEFAULT_LIST_ID,
      title: "Stretch",
      dueDate: today,
      recurrence: "daily",
    }));
    await until(alpha, runtime, RemindersMachine.Machine, (s) => s.write.outcome === "Confirmed");
    if (!created) throw new Error("expected created reminder");

    await drawn(() => runtime.runPromise(beginEditReminder(created)));
    await until(alpha, runtime, EditorMachine.Machine, (e) => e.open && e.draft.sync === "Kept");
    await drawn(() => runtime.runPromise(updateEditorDraft({ recurrence: "weekly" })));
    const afterRecurrence = await runtime.runPromise(EditorMachine.Machine.use((m) => m.get()));
    expect(afterRecurrence.draft.sync).toBe("Edited");

    const shelf = runtime.runSync(RemindersShelf);
    const curSnap = shelf.store.snapshot().snapshot;
    shelf.store.replace({ ...curSnap, items: [] });
    await drawn(() => runtime.runPromise(saveReminderDraft()));
    const afterFailedSave = await runtime.runPromise(EditorMachine.Machine.use((m) => m.get()));
    expect(afterFailedSave.draft.sync).not.toBe("Saving");
    expect(EditorMachine.canClose(afterFailedSave)).toBe(true);
  });

  // spec/app/reminders/alerts.md, "Story: Alert on due reminders and act from the banner"
  it("snoozes from a long-open banner using click time and persists plus reschedules recurring banner completion", async () => {
    const { world, recorder, alpha, runtime } = await launchReminders(baseNow);
    const scheduledAt = new Date(world.now + 10 * 60_000);
    const fireDate = formatCivilDate(civilDateAt(scheduledAt.getTime()));
    const item = await runtime.runPromise(createReminderItem({
      listId: DEFAULT_LIST_ID,
      title: "Daily pill",
      dueDate: fireDate,
      dueMinute: scheduledAt.getHours() * 60 + scheduledAt.getMinutes(),
      alertMinutes: 0,
      recurrence: "daily",
    }));
    await until(alpha, runtime, RemindersMachine.Machine, (s) => s.write.outcome === "Confirmed");
    await until(alpha, runtime, AlertsMachine.Machine, (s) => s.entries.some((entry) => entry.phase === "Scheduled"));

    await later(alpha, 11 * 60_000);
    await until(alpha, runtime, AlertsMachine.Machine, (s) => s.bannerId > 0);
    await later(alpha, 12 * 60_000);
    await press("10m");
    expect((await runtime.runPromise(AlertsMachine.Machine.use((m) => m.get()))).bannerId).toBe(0);

    await later(alpha, 601_000);
    await until(alpha, runtime, AlertsMachine.Machine, (s) => s.bannerId > 0);
    await press("Complete");
    await until(alpha, runtime, AlertsMachine.Machine, (s) => s.bannerId === 0 && s.entries.some((entry) => entry.phase === "Scheduled"));
    const expectedNext = advanceDueDate(fireDate, "daily");
    expect(recorder.snapshot.items.find((one) => one.id === item!.id)).toMatchObject({ dueDate: expectedNext, completed: false });
    const persistedRaw = localStorage.getItem("alpha.reminders.snapshot@1");
    expect(persistedRaw).not.toBeNull();
    expect((JSON.parse(persistedRaw!) as RemindersSnapshot).items.find((one) => one.id === item!.id)?.dueDate).toBe(expectedNext);
  });

  // spec/app/reminders/alerts.md, "Story: Alert on due reminders and act from the banner"
  it("cancels native reminder alarms using the live alarm target from phone.list() and SHA-256 bindingHash", async () => {
    const today = formatCivilDate(civilDateAt(baseNow));
    const cancelled: AndroidReminderCancelInput[] = [];
    const liveTarget: AndroidReminderTarget = {
      sourceId: "reminders-store",
      sourceRevision: "7",
      reminderId: "rem-native-cancel",
      occurrenceId: "rem-native-cancel:occ-42",
      revision: "3",
    };
    const item: ReminderItemRecord = {
      id: "rem-native-cancel",
      listId: DEFAULT_LIST_ID,
      title: "Take medicine",
      notes: "With water",
      dueDate: today,
      dueMinute: 18 * 60,
      alertMinutes: 0,
      recurrence: "none",
      priority: "none",
      flagged: false,
      subtasks: [],
      completed: true,
      completedAtMs: baseNow,
      snoozedUntilMs: null,
      notifiedAtMs: null,
      agentTaskId: null,
      revision: 4,
      createdAtMs: baseNow - 60_000,
      updatedAtMs: baseNow,
    };
    const { runtime } = await launchReminders(baseNow, [item]);
    const unused = () => Effect.fail(new RemindersUnread({ cause: "unused" }));
    const fakePhone = {
      present: true,
      schedule: unused,
      cancel: (input: AndroidReminderCancelInput) => Effect.sync(() => {
        cancelled.push(input);
        return { id: input.id, status: "cancelled" as const, mode: "inexact" as const, message: "Cancelled" };
      }),
      list: () => Effect.succeed({
        notificationsEnabled: true,
        reminders: [{
          id: item.id,
          title: item.title,
          body: item.notes,
          occurrenceId: liveTarget.occurrenceId,
          target: liveTarget,
          createdAt: baseNow - 60_000,
          at: baseNow + 60_000,
          dueAt: baseNow + 60_000,
          alertMinutes: 0,
          status: "scheduled" as const,
          mode: "inexact" as const,
          history: [],
        }],
      }),
      operate: unused,
      pendingTap: unused,
      consumeTap: unused,
    };
    const snapshot: RemindersSnapshot = { ...defaultSnapshot(baseNow), items: [item] };
    await runtime.runPromise(Effect.provideService(syncAlertsWithSnapshot(snapshot, baseNow), PhoneReminders, fakePhone));

    const expectedOp = { type: "reminder_cancel", target: liveTarget };
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(expectedOp)));
    const expectedHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");

    expect(cancelled).toEqual([{
      id: item.id,
      target: liveTarget,
      operationId: `cancel-${item.id}-${item.revision}`,
      bindingHash: expectedHash,
    }]);

    cancelled.length = 0;
    await runtime.runPromise(Effect.provideService(
      syncAlertsWithSnapshot(snapshot, baseNow),
      PhoneReminders,
      { ...fakePhone, list: () => Effect.succeed({ notificationsEnabled: true, reminders: [] }) },
    ));
    expect(cancelled).toEqual([]);
  });
});
