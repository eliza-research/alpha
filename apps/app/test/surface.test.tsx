// @vitest-environment happy-dom
// spec/app/shell/index.md, "Story: Move between Home and the apps"; spec/app/settings/preferences.md, "Story: Keep my preferences through a restart"; spec/app/platform/index.md, "Story: Reach the phone's native capabilities"; spec/app/control/index.md, "The kill-switch immediately revokes any active lease, clears any in-flight operation, and signals the native bridge and overlay"
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { build } from "vite";
import { Effect, Layer, ManagedRuntime, Stream } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import { TestClock } from "effect/testing";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import * as Control from "../gen/app__control.effect.vibe";
import { mounts } from "../src/areas.ts";
import { ControlBanner } from "../src/control/ControlBanner.tsx";
import { ControlLeaseRequests, externalControl, syncControlSnapshot } from "../src/control/control.vibe";
import { agentAt } from "../src/platform/agent.vibe";
import {
  type AlphaIntentDetail,
  MAX_CONTEXT_SNAPSHOT_BYTES,
  publishForegroundContext,
  watchAppSurface,
  watchOverlaySurface,
} from "../src/platform/contextBridge.vibe";
import {
  SHARED_PREFERENCE_KEYS,
  type SharedPreferenceChange,
  isSharedPreferenceReadKey,
  isSharedPreferenceWriteKey,
  sharedStore,
  subscribeSharedPreferences,
} from "../src/platform/sharedStore.vibe";
import { install, timeOver, whole } from "../src/runtime/index.vibe";
import {
  SURFACE_VIEWS,
  lockNameFor,
  mountsFor,
  needsLocalOcr,
  parseSurface,
  parseView,
} from "../src/surface.ts";
import { closeAll, drawn, underAct } from "./alpha.tsx";
import { plugIn } from "./fakes/phone.ts";

underAct();
afterEach(closeAll);

describe("Multi-surface parser, mount filtering, OCR gating, and lock scoping", () => {
  it('opens the assigned view from a compiled standalone web bundle (spec/app/shell/index.md, "Story: Move between Home and the apps")', async () => {
    const artifact = await build({
      configFile: false,
      logLevel: "silent",
      define: {
        "import.meta.env.VITE_ALPHA_SURFACE": JSON.stringify("app"),
        "import.meta.env.VITE_ALPHA_VIEW": JSON.stringify("Clock"),
      },
      build: {
        write: false,
        lib: { entry: resolve("src/surface.ts"), formats: ["es"], fileName: "surface" },
      },
    });
    const result = Array.isArray(artifact) ? artifact[0] : artifact;
    if (!result || !("output" in result)) throw new Error("The surface build produced no output");
    const script = result.output.find((chunk) => chunk.type === "chunk" && chunk.isEntry);
    if (script?.type !== "chunk") throw new Error("The surface build produced no entry module");
    const module = "data:text/javascript;base64," + Buffer.from(script.code).toString("base64");
    const value = execFileSync(process.execPath, ["--input-type=module", "-e",
      "const {currentSurface} = await import(process.argv[1]); process.stdout.write(JSON.stringify(currentSurface()))", module], { encoding: "utf8" });
    expect(JSON.parse(value)).toEqual({ mode: "app", view: "Clock" });
  });
  // spec/app/shell/index.md, "Story: Move between Home and the apps"
  it('resolves monolith, overlay, and app surfaces with scoped locks and lean mount filtering (spec/app/shell/index.md, "Story: Move between Home and the apps")', () => {
    const monolith = parseSurface({});
    expect(monolith).toEqual({ mode: "monolith" });
    expect(lockNameFor(monolith)).toBe("alpha.page");
    expect(needsLocalOcr(monolith)).toBe(true);
    expect(mountsFor(monolith, mounts)).toBe(mounts);

    const overlay = parseSurface({ envSurface: "overlay" });
    expect(overlay).toEqual({ mode: "overlay" });
    expect(lockNameFor(overlay)).toBe("alpha.page:overlay");
    expect(needsLocalOcr(overlay)).toBe(false);
    const overlayPlaces = mountsFor(overlay, mounts).map((entry) => entry.at);
    expect(overlayPlaces.every((place) => place === "assistant" || place === "assistant/calendar" || place === "overlay" || place === "notice")).toBe(true);
    expect(overlayPlaces).toContain("assistant");
    expect(overlayPlaces).toContain("notice");
    expect(overlayPlaces).not.toContain("home");

    const notes = parseSurface({ envSurface: "app", envView: "notes" });
    expect(notes).toEqual({ mode: "app", view: "Notes" });
    expect(lockNameFor(notes)).toBe("alpha.page:app:Notes");
    expect(needsLocalOcr(notes)).toBe(false);
    const notesPlaces = mountsFor(notes, mounts).map((entry) => entry.at);
    expect(notesPlaces.every((place) => place === "view:Notes" || place === "overlay" || place === "notice")).toBe(true);
    expect(notesPlaces).toContain("view:Notes");
    expect(notesPlaces).toContain("overlay");
    expect(notesPlaces).toContain("notice");
    expect(notesPlaces).not.toContain("home");

    const phone = parseSurface({ search: "?surface=app&view=Phone" });
    expect(phone).toEqual({ mode: "app", view: "Phone" });
    expect(mountsFor(phone, mounts).map((entry) => entry.at)).toContain("phone/stage");
    expect(mountsFor(phone, mounts).map((entry) => entry.at)).toContain("view:Phone");
    expect(mountsFor(phone, mounts).map((entry) => entry.at)).not.toContain("view:Messages");

    const settings = parseSurface({ search: "?surface=app&view=Settings" });
    const settingsPlaces = mountsFor(settings, mounts).map((entry) => entry.at);
    expect(settingsPlaces).toContain("view:Settings");
    expect(settingsPlaces.some((place) => place.startsWith("settings/"))).toBe(true);

    expect(parseSurface({ search: "?surface=overlay" })).toEqual({ mode: "overlay" });
    expect(parseSurface({ envSurface: "overlay", search: "?surface=app&view=Notes" })).toEqual({ mode: "overlay" });
    expect(parseSurface({ search: "?surface=app&view=NotARealView" })).toEqual({ mode: "monolith" });
    expect(parseView("  calendar ")).toBe("Calendar");
    expect(parseView("unknown")).toBeUndefined();

    for (const view of SURFACE_VIEWS) {
      const expectedOcr = view === "Camera" || view === "Files";
      expect(needsLocalOcr({ mode: "app", view })).toBe(expectedOcr);
    }
  });
});

describe("Shared preference store split routing", () => {
  // spec/app/settings/preferences.md, "Story: Keep my preferences through a restart"
  it('routes allowlisted shared keys to AlphaPreferences while isolating app-private keys locally (spec/app/settings/preferences.md, "Story: Keep my preferences through a restart")', async () => {
    expect(SHARED_PREFERENCE_KEYS.every((key) => isSharedPreferenceReadKey(key) && isSharedPreferenceWriteKey(key))).toBe(true);
    expect(SHARED_PREFERENCE_KEYS).toContain("alpha.aiMode");
    expect(SHARED_PREFERENCE_KEYS).toContain("alpha.localModel");
    expect(isSharedPreferenceReadKey("alpha.appearance.v1")).toBe(true);
    expect(isSharedPreferenceWriteKey("alpha.appearance.v1")).toBe(false);
    expect(isSharedPreferenceReadKey("notes.draft.1")).toBe(false);

    const localOnly = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* KeyValueStore.KeyValueStore;
        yield* store.set("alpha.appearance", "dark");
        yield* store.set("notes.draft", "hello");
        return {
          appearance: yield* store.get("alpha.appearance"),
          draft: yield* store.get("notes.draft"),
        };
      }).pipe(Effect.provide(sharedStore(KeyValueStore.layerMemory))),
    );
    expect(localOnly).toEqual({ appearance: "dark", draft: "hello" });

    const remoteData = new Map<string, string>([["alpha.appearance.v1", "light"]]);
    const remoteCalls: string[] = [];
    let emitPrefChange: ((event: string, data: unknown) => void) | undefined;
    const unplug = plugIn({
      AlphaPreferences: (emit) => {
        emitPrefChange = emit;
        return {
          get: (options: { readonly key: string }) => {
            remoteCalls.push(`get:${options.key}`);
            const value = remoteData.get(options.key);
            return Promise.resolve(value === undefined ? { value: null } : { value });
          },
          set: (options: { readonly key: string; readonly value: string }) => {
            remoteCalls.push(`set:${options.key}`);
            remoteData.set(options.key, options.value);
            return Promise.resolve();
          },
          remove: (options: { readonly key: string }) => {
            remoteCalls.push(`remove:${options.key}`);
            remoteData.delete(options.key);
            return Promise.resolve();
          },
          snapshot: () => {
            remoteCalls.push("snapshot");
            return Promise.resolve({ values: Object.fromEntries(remoteData.entries()) });
          },
        };
      },
    });

    try {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const store = yield* KeyValueStore.KeyValueStore;
          yield* store.set("alpha.appearance", "dark");
          yield* store.set("alpha.textScale", "115");
          yield* store.set("alpha.aiMode", "local");
          yield* store.set("alpha.localModel", "gemma-4-e2b-it-q4");
          yield* store.set("app.private.draft", "secret-note");
          const migration = yield* store.get("alpha.appearance.v1");
          const scaleBytes = yield* store.getUint8Array("alpha.textScale");
          const aiMode = yield* store.get("alpha.aiMode");
          const localModel = yield* store.get("alpha.localModel");
          const keysBeforeClear = yield* store.keys;
          yield* store.clear;
          const afterClearPrivate = yield* store.get("app.private.draft");
          const afterClearShared = yield* store.get("alpha.appearance");
          yield* store.remove("alpha.textScale");
          const afterRemoveScale = yield* store.get("alpha.textScale");
          return {
            migration,
            scaleText: scaleBytes === undefined ? undefined : new TextDecoder().decode(scaleBytes),
            aiMode,
            localModel,
            keysBeforeClear: [...keysBeforeClear].sort(),
            afterClearPrivate,
            afterClearShared,
            afterRemoveScale,
          };
        }).pipe(Effect.provide(sharedStore(KeyValueStore.layerMemory))),
      );

      expect(result.migration).toBe("light");
      expect(result.scaleText).toBe("115");
      expect(result.aiMode).toBe("local");
      expect(result.localModel).toBe("gemma-4-e2b-it-q4");
      expect(result.keysBeforeClear).toEqual([
        "alpha.aiMode",
        "alpha.appearance",
        "alpha.appearance.v1",
        "alpha.localModel",
        "alpha.textScale",
        "app.private.draft",
      ]);
      expect(result.afterClearPrivate).toBeUndefined();
      expect(result.afterClearShared).toBe("dark");
      expect(result.afterRemoveScale).toBeUndefined();
      expect(remoteData.has("app.private.draft")).toBe(false);
      expect(remoteData.get("alpha.aiMode")).toBe("local");
      expect(remoteData.get("alpha.localModel")).toBe("gemma-4-e2b-it-q4");
      expect(remoteCalls).toContain("set:alpha.appearance");
      expect(remoteCalls).toContain("set:alpha.aiMode");
      expect(remoteCalls).toContain("set:alpha.localModel");
      expect(remoteCalls).toContain("remove:alpha.textScale");
      expect(remoteCalls.some((call) => call.includes("app.private.draft"))).toBe(false);

      const heard: SharedPreferenceChange[] = [];
      const stopSub = subscribeSharedPreferences((change) => { heard.push(change); });
      await Promise.resolve();
      emitPrefChange?.("changed", { key: "alpha.appearance", value: "light" });
      expect(heard).toEqual([{ key: "alpha.appearance", value: "light" }]);
      stopSub();
    } finally {
      unplug();
    }
  });
});

describe("Context bridge and system overlay touch passthrough", () => {
  // spec/app/platform/index.md, "Story: Reach the phone's native capabilities"
  it('publishes bounded app context, handles alpha-intent deep links, and reports overlay touch regions (spec/app/platform/index.md, "Story: Reach the phone\'s native capabilities")', async () => {
    const published: Array<Record<string, unknown>> = [];
    const cleared: Array<Record<string, unknown>> = [];
    const replies: Array<Record<string, unknown>> = [];
    const unplug = plugIn({
      AlphaContext: () => ({
        publish: (opts: Record<string, unknown>) => {
          published.push(opts);
          return Promise.resolve({ published: true });
        },
        clear: (opts: Record<string, unknown>) => {
          cleared.push(opts);
          return Promise.resolve({ cleared: true });
        },
        getActive: () => Promise.resolve({ active: null }),
        replyAction: (opts: Record<string, unknown>) => {
          replies.push(opts);
          return Promise.resolve({ delivered: true });
        },
      }),
    });

    try {
      const small = JSON.stringify({ view: "Notes", count: 2 });
      const smallOk = await Effect.runPromise(publishForegroundContext({
        view: "Notes",
        route: "/notes",
        snapshotJson: small,
        sensitive: false,
        leaseMs: 10_000,
      }));
      expect(smallOk).toBe(true);
      expect(published[0]?.snapshot).toBe(small);

      const oversized = JSON.stringify({ payload: "x".repeat(MAX_CONTEXT_SNAPSHOT_BYTES + 2_048) });
      const largeOk = await Effect.runPromise(publishForegroundContext({
        view: "Notes",
        route: "/notes",
        snapshotJson: oversized,
        sensitive: false,
        leaseMs: 10_000,
      }));
      expect(largeOk).toBe(true);
      const bounded = typeof published[1]?.snapshot === "string" ? published[1].snapshot : "";
      expect(new TextEncoder().encode(bounded).length).toBeLessThanOrEqual(MAX_CONTEXT_SNAPSHOT_BYTES);
      expect(JSON.parse(bounded)).toMatchObject({ truncated: true });

      const flushMicrotasks = async () => {
        for (let step = 0; step < 6; step += 1) await Promise.resolve();
      };
      const received: AlphaIntentDetail[] = [];
      const stopApp = watchAppSurface("Notes", (detail) => { received.push(detail); });
      await flushMicrotasks();
      expect(published.length).toBeGreaterThanOrEqual(3);
      expect(published[2]).toMatchObject({ view: "Notes", sensitive: false });

      window.dispatchEvent(new CustomEvent("alpha-intent", {
        detail: { uri: "alpha://notes/open?id=7", claimId: "claim-42", ticket: 9, nonce: "n-1", payloadJson: '{"id":"7"}' },
      }));
      window.dispatchEvent(new CustomEvent("alpha-intent", { detail: { uri: "" } }));
      await flushMicrotasks();

      expect(received).toEqual([
        { uri: "alpha://notes/open?id=7", claimId: "claim-42", ticket: 9, nonce: "n-1", payloadJson: '{"id":"7"}' },
      ]);
      expect(replies).toContainEqual({
        claimId: "claim-42",
        switched: true,
        result: JSON.stringify({ view: "Notes", uri: "alpha://notes/open?id=7" }),
        errorCode: "",
      });

      stopApp();
      await flushMicrotasks();
      expect(cleared).toContainEqual({ view: "Notes" });
    } finally {
      unplug();
    }

    const regionUpdates: Array<{ readonly rectsJson: string; readonly density: number }> = [];
    const focusUpdates: boolean[] = [];
    const host = globalThis as {
      AlphaOverlayNative?: {
        setTouchableRegions(rectsJson: string, density: number): void;
        setFocusable(focusable: boolean): void;
        dismiss(): void;
        openAppIntent(uri: string, claimId: string, payloadJson: string): boolean;
      };
    };
    const previousBridge = host.AlphaOverlayNative;
    host.AlphaOverlayNative = {
      setTouchableRegions: (rectsJson, density) => { regionUpdates.push({ rectsJson, density }); },
      setFocusable: (focusable) => { focusUpdates.push(focusable); },
      dismiss: () => undefined,
      openAppIntent: () => true,
    };

    const root = document.body.appendChild(document.createElement("main"));
    const bar = root.appendChild(document.createElement("div"));
    bar.dataset.alphaDetent = "bar";
    bar.getBoundingClientRect = () => new DOMRect(0, 700, 412, 88);

    try {
      const stopOverlay = watchOverlaySurface(root);
      expect(regionUpdates.length).toBe(1);
      expect(JSON.parse(regionUpdates[0]?.rectsJson ?? "[]")).toEqual([{ left: 0, top: 700, right: 412, bottom: 788 }]);
      expect(focusUpdates).toEqual([false]);

      bar.dataset.alphaTyping = "";
      window.dispatchEvent(new Event("resize"));
      expect(focusUpdates).toEqual([false, true]);

      delete bar.dataset.alphaTyping;
      window.dispatchEvent(new Event("resize"));
      expect(focusUpdates).toEqual([false, true, false]);

      bar.dataset.alphaDetent = "typing";
      window.dispatchEvent(new Event("resize"));
      expect(focusUpdates).toEqual([false, true, false, true]);
      stopOverlay();
    } finally {
      root.remove();
      if (previousBridge === undefined) delete host.AlphaOverlayNative;
      else host.AlphaOverlayNative = previousBridge;
    }
  });
});

describe("Overlay external control kill-switch banner", () => {
  // spec/app/control/index.md, "The kill-switch immediately revokes any active lease, clears any in-flight operation, and signals the native bridge and overlay"
  it('stays hidden when idle, displays active lease progress, and stops immediately on owner tap (spec/app/control/index.md, "The kill-switch immediately revokes any active lease, clears any in-flight operation, and signals the native bridge and overlay")', async () => {
    const stopReasons: string[] = [];
    let killed = false;
    let lease = {
      leaseId: 0,
      packageName: "",
      maxOps: 0,
      usedOps: 0,
      expiresAtMs: 0,
      status: "LeaseInactive" as "LeaseInactive" | "LeaseActive" | "LeaseRevoked",
    };
    const statePayload = () => ({
      tier: "TierAccessibility" as const,
      capabilities: ["ui.observe.v1", "ui.act.v1"],
      foreground: {
        snapId: 1,
        packageName: "org.mozilla.firefox",
        activityName: "org.mozilla.fenix.HomeActivity",
        webUri: "https://example.com",
        targetKind: "AllowedApp" as const,
        protection: "ScreenClear" as const,
        windowCount: 1,
        observedAtMs: 1_000,
      },
      lease,
      pending: null,
      lastResult: "done" as const,
      killed,
    });
    const http = Layer.succeed(HttpClient.HttpClient, HttpClient.make((request) => Effect.sync(() => {
      const pathname = new URL(request.url, "http://agent.test").pathname;
      const body = request.body._tag === "Uint8Array"
        ? JSON.parse(new TextDecoder().decode(request.body.body)) as Record<string, unknown>
        : {};
      const reply = (payload: unknown, status = 200) => HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } }),
      );
      if (pathname === "/api/health") return reply({ ready: true });
      if (pathname === "/api/alpha/control/state") return reply(statePayload());
      if (pathname === "/api/alpha/control/lease") {
        killed = false;
        lease = {
          leaseId: 1,
          packageName: typeof body.packageName === "string" ? body.packageName : "org.mozilla.firefox",
          maxOps: Number(body.maxOps ?? 3),
          usedOps: 0,
          expiresAtMs: 61_000,
          status: "LeaseActive",
        };
        return reply({ lease });
      }
      if (pathname === "/api/alpha/control/stop") {
        stopReasons.push(typeof body.reason === "string" ? body.reason : "kill_switch");
        killed = true;
        if (lease.status === "LeaseActive") lease = { ...lease, status: "LeaseRevoked" };
        return reply(statePayload());
      }
      return reply({ error: "not_found" }, 404);
    })));

    const clock = Layer.provideMerge(Layer.effectDiscard(TestClock.setTime(1_000)), TestClock.layer());
    const base = Layer.mergeAll(
      Layer.effectDiscard(Effect.promise(() => Promise.resolve())),
      KeyValueStore.layerMemory,
      Layer.provide(install, KeyValueStore.layerMemory),
      Layer.provide(timeOver(Stream.empty), Layer.merge(KeyValueStore.layerMemory, clock)),
      Layer.provide(agentAt("http://agent.test"), http),
      clock,
    );
    const runtime = ManagedRuntime.make(Layer.provide(whole(externalControl), base));
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);

    try {
      await drawn(async () => {
        root.render(<ControlBanner runtime={runtime} />);
        await runtime.runPromise(Effect.void);
      });
      expect(host.querySelector("[data-alpha-control-banner]")).toBeNull();

      await drawn(async () => {
        await runtime.runPromise(syncControlSnapshot({
          tier: "TierAccessibility",
          capabilities: ["ui.observe.v1", "ui.act.v1"],
          foreground: {
            snapId: 1,
            packageName: "org.mozilla.firefox",
            activityName: "org.mozilla.fenix.HomeActivity",
            webUri: "https://example.com",
            targetKind: "AllowedApp",
            protection: "ScreenClear",
            windowCount: 1,
            observedAtMs: 1_000,
          },
          lease: { leaseId: 0, packageName: "", maxOps: 0, usedOps: 0, expiresAtMs: 0, status: "LeaseInactive" },
          pending: null,
          lastResult: "done",
          killed: false,
        }, () => 1));
        await runtime.runPromise(Effect.flatMap(ControlLeaseRequests, (requests) => requests.set({
          packageName: "org.mozilla.firefox",
          requestedOp: "ui_click",
          requestedAt: 1_000,
        })));
      });

      const approvalBanner = host.querySelector("[data-alpha-control-lease-request]");
      expect(approvalBanner?.textContent).toContain("org.mozilla.firefox");
      const approveBtn = Array.from(approvalBanner?.querySelectorAll("button") ?? []).find((btn) => btn.textContent === "Approve");
      expect(approveBtn).toBeDefined();

      await drawn(async () => {
        approveBtn?.click();
        await runtime.runPromise(
          Effect.flatMap(Control.Machine, (machine) =>
            Stream.runHead(Stream.filter(machine.changes, (state) => state.lease.status === "LeaseActive")),
          ),
        );
      });

      const activeBanner = host.querySelector("[data-alpha-control-banner]");
      expect(activeBanner?.textContent).toContain("Alpha control active");
      expect(activeBanner?.textContent).toContain("0/6");

      await drawn(async () => {
        await runtime.runPromise(Effect.flatMap(Control.Machine, (machine) =>
          machine.send({ type: "dispatch", opId: 1, op: "OpClick", snapId: 1, appId: 1, now: 1_000 }, "Agent"),
        ));
      });
      expect(host.querySelector("[data-alpha-control-banner]")?.textContent).toContain("Alpha acting in app");
      expect(host.querySelector("[data-alpha-control-banner]")?.textContent).toContain("1/6");

      const stopButton = host.querySelector<HTMLButtonElement>("[data-alpha-control-banner] button");
      expect(stopButton?.textContent).toBe("Stop");

      await drawn(async () => {
        stopButton?.click();
        await runtime.runPromise(
          Effect.flatMap(Control.Machine, (machine) =>
            Stream.runHead(Stream.filter(machine.changes, (state) => state.killed && state.lease.status === "LeaseRevoked")),
          ),
        );
      });

      expect(host.querySelector("[data-alpha-control-banner]")).toBeNull();
      expect(stopReasons.length).toBeGreaterThanOrEqual(1);
      expect(stopReasons.every((reason) => reason === "kill_switch")).toBe(true);
    } finally {
      await drawn(() => root.unmount());
      host.remove();
      await runtime.dispose();
    }
  });
});
