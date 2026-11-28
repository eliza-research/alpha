// @vitest-environment happy-dom
import { Context, Deferred, Effect, Fiber, Layer, ManagedRuntime, Stream } from "effect";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import { TestClock } from "effect/testing";
import { act, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Sample from "../gen/app__sample.effect.vibe";
import * as Size from "../gen/app__sample__size.effect.vibe";
import { Attempts, Install, install } from "../src/runtime/attempts.vibe";
import { Contained } from "../src/runtime/contained.tsx";
import { type Job, answer, due, reacting, stamped, stream, tell, untimed, whole } from "../src/runtime/reactor.vibe";
import { type Shelf, createBoundedCache, createShelf, scopedShelf } from "../src/runtime/shelf.vibe";
import { single } from "../src/runtime/single.ts";
import { Time, timeOver } from "../src/runtime/time.vibe";

const react = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

class CounterShelf extends Context.Service<CounterShelf, Shelf<number>>()("test/CounterShelf") {}

/** Top-level React reader component exercising `Shelf` with `useSyncExternalStore`. */
function ShelfReader({ source }: { readonly source: Shelf<number> }) {
  const value = useSyncExternalStore(source.subscribe, source.snapshot);
  return <span>count:{value}</span>;
}

/** Top-level test component that throws when `broken` is true. */
function FlakyScreen({ broken }: { readonly broken: boolean }) {
  if (broken) throw new Error("boom");
  return <p>Recovered screen</p>;
}

/** Builds a minimal isolated runtime environment over an in-memory `KeyValueStore` and `TestClock`. */
function harness(store: KeyValueStore.KeyValueStore, startMs = 1_000_000, resumed: Stream.Stream<unknown> = Stream.never) {
  const clock = Layer.provideMerge(Layer.effectDiscard(TestClock.setTime(startMs)), TestClock.layer());
  const kv = Layer.succeed(KeyValueStore.KeyValueStore, store);
  const time = Layer.provide(timeOver(resumed), Layer.merge(kv, clock));
  const inst = Layer.provide(install, kv);
  return Layer.mergeAll(kv, clock, time, inst);
}

/** In-memory `KeyValueStore` with optional hooks for simulating transient failures and counting reads. */
function fakeStore(
  backing = new Map<string, string>(),
  hooks: {
    onGet?: (key: string) => Effect.Effect<string | undefined, KeyValueStore.KeyValueStoreError> | undefined;
    onSet?: (key: string, value: string) => Effect.Effect<void, KeyValueStore.KeyValueStoreError> | undefined;
    onRemove?: (key: string) => Effect.Effect<void, KeyValueStore.KeyValueStoreError> | undefined;
  } = {},
): KeyValueStore.KeyValueStore {
  return KeyValueStore.makeStringOnly({
    get: (key) => hooks.onGet?.(key) ?? Effect.sync(() => backing.get(key)),
    set: (key, value) => hooks.onSet?.(key, value) ?? Effect.sync(() => { backing.set(key, value); }),
    remove: (key) => hooks.onRemove?.(key) ?? Effect.sync(() => { backing.delete(key); }),
    clear: Effect.sync(() => { backing.clear(); }),
    size: Effect.sync(() => backing.size),
    keys: Effect.sync(() => [...backing.keys()]),
  });
}

type SampleState = typeof Sample.initial;

async function waitSampleStatus(
  runtime: ManagedRuntime.ManagedRuntime<Sample.Machine, unknown>,
  status: SampleState["list"]["status"],
): Promise<SampleState> {
  let latest: SampleState = Sample.initial;
  await vi.waitFor(async () => {
    latest = await runtime.runPromise(Sample.Machine.use((m) => m.get()));
    expect(latest.list.status).toBe(status);
  });
  return latest;
}

function keptSampleRuntime(
  store: KeyValueStore.KeyValueStore,
  carry: (fx: Sample.Effect) => Job<Sample.Event, Attempts, []>,
) {
  return ManagedRuntime.make(Layer.provideMerge(
    whole(reacting(Sample, { keep: 1, open: [{ type: "reopen" }], carry })),
    harness(store, 30_000),
  ));
}

function recordAttemptKeyCarry(keysSeen: string[]) {
  return (fx: Sample.Effect): Job<Sample.Event, Attempts, []> => fx.tag === "Fetch"
    ? answer("fetch", Effect.flatMap(Attempts, (a) => Effect.map(a.key(1), (idKey): Sample.Event => {
      keysSeen.push(idKey);
      return { type: "loaded", ticket: fx.ticket, titles: [] };
    })), { type: "failed", ticket: fx.ticket })
    : answer("other", Effect.never, { type: "failed", ticket: 0 });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("stamped() Contract C5 semantics", () => {
  // spec/kit/read.md, "Only the newest ticket's answer is taken, once"
  it("stamps now unconditionally and at only when untimed (spec/kit/read.md, \"Only the newest ticket's answer is taken, once\")", () => {
    const now = 1_764_000_000_000;
    expect(stamped({ type: "choose", percent: 130, at: untimed }, now)).toEqual({ type: "choose", percent: 130, at: now });
    expect(stamped({ type: "speak", at: 3 }, now)).toEqual({ type: "speak", at: 3 });
    expect(stamped({ type: "create", at: 1_764_000_099_000, now: untimed }, now)).toEqual({
      type: "create",
      at: 1_764_000_099_000,
      now,
    });
    expect(stamped({ type: "tick", now: 123 }, now)).toEqual({ type: "tick", now });
    const plain = { type: "plain", value: 42 };
    expect(stamped(plain, now)).toBe(plain);
  });
});

describe("reactor.vibe timers, jobs, permits, and kept() durability", () => {
  // spec/kit/undo.md, "A held change takes effect only once its time has come"
  it("re-arms timers when event payload changes at the same deadline and clears fired entries (spec/kit/undo.md, \"A held change takes effect only once its time has come\")", async () => {
    const store = fakeStore();
    const base = harness(store, 10_000);
    const deadline = 20_000;
    const layer = Layer.provideMerge(
      whole(reacting(Sample, {
        carry: (): Job<Sample.Event, never, []> => answer("fetch", Effect.never, { type: "failed", ticket: 0 }),
        timers: (state) => (
          state.list.status === "Loading"
            ? [due<Sample.Event, []>("fetch", deadline, { type: "loaded", ticket: state.list.ticket, titles: [`ticket-${state.list.ticket}`] })]
            : []
        ),
      })),
      base,
    );
    const runtime = ManagedRuntime.make(layer);
    try {
      await runtime.runPromise(Sample.Machine.use((m) => m.send({ type: "refresh" })));
      await runtime.runPromise(Sample.Machine.use((m) => m.send({ type: "show", showing: true })));
      const before = await runtime.runPromise(Sample.Machine.use((m) => m.get()));
      expect([before.list.status, before.list.ticket]).toEqual(["Loading", 2]);

      await runtime.runPromise(TestClock.adjust(10_000));
      const settled = await waitSampleStatus(runtime, "Loaded");
      expect(settled.titles).toEqual(["ticket-2"]);

      await runtime.runPromise(Sample.Machine.use((m) => m.send({ type: "refresh" })));
      const rearmed = await waitSampleStatus(runtime, "Loaded");
      expect(rearmed.titles).toEqual(["ticket-3"]);
    } finally {
      await runtime.dispose();
    }
  });

  // spec/kit/read.md, "Only the newest ticket's answer is taken, once"
  it("does not commit stale events for a fiber interrupted while waiting for turn (spec/kit/read.md, \"Only the newest ticket's answer is taken, once\")", async () => {
    const entered = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    const seen: Sample.Event[] = [];
    let holdFirst = true;
    const slowSpec: typeof Sample = {
      ...Sample,
      machine: (start) => Layer.effect(
        Sample.Machine,
        Effect.gen(function* () {
          const inner = yield* Sample.Machine;
          return {
            changes: inner.changes,
            get: () => inner.get(),
            receive: (input: unknown) => inner.receive(input),
            send: (event: Sample.Event) => Effect.gen(function* () {
              if (holdFirst) {
                holdFirst = false;
                yield* Deferred.succeed(entered, undefined);
                yield* Deferred.await(release);
              }
              seen.push(event);
              return yield* inner.send(event);
            }),
          };
        }),
      ).pipe(Layer.provide(Sample.machine(start))),
    };
    const layer = Layer.provideMerge(
      whole(reacting(slowSpec, {
        carry: (): Job<Sample.Event, never, []> => answer("fetch", Effect.never, { type: "failed", ticket: 0 }),
      })),
      harness(fakeStore(), 15_000),
    );
    const runtime = ManagedRuntime.make(layer);
    try {
      const first = runtime.runFork(Sample.Machine.use((m) => m.send({ type: "refresh" })));
      await runtime.runPromise(Deferred.await(entered));
      const queued = runtime.runFork(Sample.Machine.use((m) => m.send({ type: "show", showing: true })));
      await runtime.runPromise(Effect.yieldNow);
      await runtime.runPromise(Fiber.interrupt(queued));
      await runtime.runPromise(Deferred.succeed(release, undefined));
      await runtime.runPromise(Fiber.join(first));
      const finalState = await runtime.runPromise(Sample.Machine.use((m) => m.get()));
      expect([seen.map((e) => e.type), finalState.showing]).toEqual([["refresh"], false]);
    } finally {
      await runtime.dispose();
    }
  });

  // spec/kit/read.md, "Only the newest ticket's answer is taken, once"
  it("sends lost when an answer stream closes empty, allows tell without taken, and suppresses unticketed lost on stale ticket refusal (spec/kit/read.md, \"Only the newest ticket's answer is taken, once\")", async () => {
    const emptyStreamRuntime = ManagedRuntime.make(Layer.provideMerge(
      whole(reacting(Sample, {
        carry: (fx): Job<Sample.Event, never, []> => fx.tag === "Fetch"
          ? stream("fetch", Stream.empty, { type: "failed", ticket: fx.ticket })
          : answer("other", Effect.never, { type: "failed", ticket: 0 }),
      })),
      harness(fakeStore(), 20_000),
    ));
    try {
      await emptyStreamRuntime.runPromise(Sample.Machine.use((m) => m.send({ type: "refresh" })));
      await waitSampleStatus(emptyStreamRuntime, "Failed");
    } finally {
      await emptyStreamRuntime.dispose();
    }

    let refusedCount = 0;
    const silentTell = Layer.provideMerge(
      whole(Layer.mergeAll(
        reacting(Size, {
          open: [{ type: "start", was: 100 }, "Phone"],
          carry: (fx): Job<Size.Event, Sample.Machine, [by: Size.Sender]> => tell(
            "notify",
            Sample.Machine,
            [{ type: "refresh" }],
            { refused: { type: "applied", ticket: fx.ticket, kept: false } },
            "Phone",
          ),
        }),
        reacting(Sample, {
          carry: (fx): Job<Sample.Event, never, []> => fx.tag === "Fetch"
            ? answer("fetch", Effect.succeed<Sample.Event>({ type: "loaded", ticket: fx.ticket, titles: [] }), { type: "failed", ticket: fx.ticket })
            : answer("other", Effect.never, { type: "failed", ticket: 0 }),
        }),
      )),
      harness(fakeStore(), 20_000),
    );
    const tellRuntime = ManagedRuntime.make(silentTell);
    try {
      await tellRuntime.runPromise(Size.Machine.use((m) => m.send({ type: "choose", percent: 130, at: untimed }, "Owner")));
      await vi.waitFor(async () => {
        const sampleState = await tellRuntime.runPromise(Sample.Machine.use((m) => m.get()));
        expect(sampleState.list.status).toBe("Loaded");
      });
      const sizeState = await tellRuntime.runPromise(Size.Machine.use((m) => m.get()));
      if (sizeState.unkept) refusedCount += 1;
      expect([sizeState.setting.status, refusedCount]).toEqual(["Loading", 0]);
    } finally {
      await tellRuntime.dispose();
    }

    const staleGate = await Effect.runPromise(Deferred.make<void>());
    const staleLoaded: Sample.Event = { type: "loaded", ticket: 1, titles: ["stale"] };
    const unticketedRuntime = ManagedRuntime.make(Layer.provideMerge(
      whole(reacting(Sample, {
        carry: (fx): Job<Sample.Event, never, []> => fx.tag === "Fetch"
          ? answer<Sample.Event, never, []>(
            `fetch-${fx.ticket}`,
            fx.ticket === 1
              ? Effect.as(Deferred.await(staleGate), staleLoaded)
              : Effect.never,
            { type: "show", showing: false },
          )
          : answer<Sample.Event, never, []>("other", Effect.never, { type: "show", showing: false }),
      })),
      harness(fakeStore(), 20_000),
    ));
    try {
      await unticketedRuntime.runPromise(Sample.Machine.use((m) => m.send({ type: "refresh" })));
      await unticketedRuntime.runPromise(Sample.Machine.use((m) => m.send({ type: "show", showing: true })));
      await unticketedRuntime.runPromise(Deferred.succeed(staleGate, undefined));
      await unticketedRuntime.runPromise(Effect.yieldNow);
      await unticketedRuntime.runPromise(Effect.yieldNow);
      const state = await unticketedRuntime.runPromise(Sample.Machine.use((m) => m.get()));
      expect([state.list.ticket, state.showing]).toEqual([2, true]);
    } finally {
      await unticketedRuntime.dispose();
    }
  });

  // spec/app/platform/index.md, "A kept value that is no longer a state is set aside where nothing is held, and its machine starts afresh"
  it("preserves valid kept state on transient read errors and uses launch epoch on memory fallback (spec/app/platform/index.md, \"A kept value that is no longer a state is set aside where nothing is held, and its machine starts afresh\")", async () => {
    const key = "alpha/app/sample/index@1";
    const backing = new Map<string, string>();
    const validState = JSON.stringify(Sample.initial);
    backing.set(key, validState);
    backing.set(`${key}.epoch`, "persisted-epoch-1");
    let failFirstRead = true;
    const store = fakeStore(backing, {
      onGet: (k) => {
        if (k === key && failFirstRead) {
          failFirstRead = false;
          return Effect.fail(new KeyValueStore.KeyValueStoreError({
            message: "transient read failure",
            method: "get",
            key: k,
          }));
        }
        return undefined;
      },
    });
    const keysSeen: string[] = [];
    const runtime = keptSampleRuntime(store, recordAttemptKeyCarry(keysSeen));
    try {
      await runtime.runPromise(Sample.Machine.use((m) => m.send({ type: "refresh" })));
      await vi.waitFor(() => expect(keysSeen.length).toBe(1));
      expect(backing.get(key)).toBe(validState);
      expect(backing.has(`${key}.unreadable`)).toBe(false);
      const installValue = await runtime.runPromise(Install.use((one) => Effect.succeed(one)));
      expect(backing.get(`${key}.epoch`)).toBe("persisted-epoch-1");
      expect(installValue.launch.length).toBeGreaterThan(0);

      const secondBacking = new Map<string, string>([
        ["alpha.install", installValue.id],
        [key, validState],
        [`${key}.epoch`, "persisted-epoch-1"],
      ]);
      const secondRuntime = keptSampleRuntime(fakeStore(secondBacking), recordAttemptKeyCarry(keysSeen));
      try {
        await secondRuntime.runPromise(Sample.Machine.use((m) => m.send({ type: "refresh" })));
        await vi.waitFor(() => expect(keysSeen.length).toBe(2));
        expect(secondBacking.has(`${key}.unreadable`)).toBe(false);
        expect(keysSeen[0]).not.toBe(keysSeen[1]);
      } finally {
        await secondRuntime.dispose();
      }
    } finally {
      await runtime.dispose();
    }

    const corruptBacking = new Map<string, string>([
      [key, JSON.stringify({ broken: true })],
      [`${key}.epoch`, "persisted-epoch-2"],
    ]);
    const corruptStore = fakeStore(corruptBacking, {
      onRemove: (k) => (
        k === key
          ? Effect.fail(new KeyValueStore.KeyValueStoreError({
            message: "remove refused",
            method: "remove",
            key: k,
          }))
          : undefined
      ),
    });
    const corruptRuntime = keptSampleRuntime(
      corruptStore,
      (fx): Job<Sample.Event, never, []> => fx.tag === "Fetch"
        ? answer("fetch", Effect.succeed<Sample.Event>({ type: "loaded", ticket: fx.ticket, titles: ["ok"] }), { type: "failed", ticket: fx.ticket })
        : answer("other", Effect.never, { type: "failed", ticket: 0 }),
    );
    try {
      await corruptRuntime.runPromise(Sample.Machine.use((m) => m.send({ type: "refresh" })));
      await waitSampleStatus(corruptRuntime, "Loaded");
      expect(corruptBacking.get(`${key}.unreadable`)).toBe(JSON.stringify({ broken: true }));
      expect(corruptBacking.get(`${key}.epoch`)).toBe("persisted-epoch-2");
    } finally {
      await corruptRuntime.dispose();
    }
  });
});

describe("time.vibe monotonicity and ended resumed stream", () => {
  // spec/kit/undo.md, "A held change takes effect only once its time has come"
  it("does not spin when resumed stream ends and persists time across short restarts (spec/kit/undo.md, \"A held change takes effect only once its time has come\")", async () => {
    const backing = new Map<string, string>();
    const firstRuntime = ManagedRuntime.make(harness(fakeStore(backing), 50_000, Stream.empty));
    try {
      const done = await firstRuntime.runPromise(Deferred.make<boolean>());
      const waiter = firstRuntime.runFork(
        Effect.flatMap(Time, (time) => Effect.flatMap(time.until(52_000), () => Deferred.succeed(done, true))),
      );
      await firstRuntime.runPromise(TestClock.adjust(1_000));
      expect(await firstRuntime.runPromise(Deferred.isDone(done))).toBe(false);
      await firstRuntime.runPromise(TestClock.adjust(1_000));
      expect(await firstRuntime.runPromise(Deferred.await(done))).toBe(true);
      await firstRuntime.runPromise(Fiber.join(waiter));
      expect(backing.get("alpha.time")).toBe("52000");
    } finally {
      await firstRuntime.dispose();
    }

    const restartedRuntime = ManagedRuntime.make(harness(fakeStore(backing), 49_000, Stream.empty));
    try {
      const afterRestart = await restartedRuntime.runPromise(Effect.flatMap(Time, (time) => time.now()));
      expect(afterRestart).toBeGreaterThanOrEqual(52_000);
    } finally {
      await restartedRuntime.dispose();
    }
  });
});

describe("time.vibe and a kept time far ahead of the phone's clock", () => {
  const wall = Date.UTC(2026, 10, 27, 9);
  const day = 86_400_000;
  const nowOver = async (kept: number) => {
    const backing = new Map([["alpha.time", String(kept)]]);
    const runtime = ManagedRuntime.make(harness(fakeStore(backing), wall, Stream.empty));
    try {
      return [await runtime.runPromise(Effect.flatMap(Time, (time) => time.now())), Number(backing.get("alpha.time"))];
    } finally {
      await runtime.dispose();
    }
  };

  // spec/kit/undo.md, "A held change takes effect only once its time has come"
  it("lets go a kept time more than a year past a clock that reads a date this build runs on, and keeps one a day ahead (spec/kit/undo.md, \"A held change takes effect only once its time has come\")", async () => {
    expect(await nowOver(2 ** 43)).toEqual([wall, wall]);
    expect(await nowOver(wall + day)).toEqual([wall + day, wall + day]);
  });
});

describe("single.ts lock error handling", () => {
  // spec/app/platform/index.md, "A kept value that is no longer a state is set aside where nothing is held, and its machine starts afresh"
  it("resolves cleanly when navigator.locks.request rejects or denies (spec/app/platform/index.md, \"A kept value that is no longer a state is set aside where nothing is held, and its machine starts afresh\")", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "locks");
    try {
      Object.defineProperty(navigator, "locks", {
        configurable: true,
        value: { request: () => Promise.reject(new DOMException("opaque origin", "SecurityError")) },
      });
      expect(await single()).toBe(true);

      Object.defineProperty(navigator, "locks", {
        configurable: true,
        value: { request: (_name: string, _opts: unknown, cb: (lock: null) => unknown) => Promise.resolve(cb(null)) },
      });
      expect(await single()).toBe(false);
    } finally {
      if (descriptor) Object.defineProperty(navigator, "locks", descriptor);
      else delete (navigator as { locks?: unknown }).locks;
    }
  });
});

describe("Contained recovery boundary", () => {
  // spec/app/shell/index.md, "Story: Move between Home and the apps"
  it("recovers via Try again button and resetKey while keeping exact alert text (spec/app/shell/index.md, \"Story: Move between Home and the apps\")", () => {
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});
    const stopped = vi.fn();
    const onReset = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    const previous = react.IS_REACT_ACT_ENVIRONMENT;
    react.IS_REACT_ACT_ENVIRONMENT = true;
    try {
      act(() => {
        root.render(
          <Contained place="view:Files" told onStopped={stopped} onReset={onReset} resetKey={1}>
            <FlakyScreen broken />
          </Contained>,
        );
      });
      expect(host.querySelector("[role=alert]")?.textContent).toBe("This part of Alpha stopped. Go back, and open it again.");
      expect(stopped).toHaveBeenCalledTimes(1);

      act(() => {
        root.render(
          <Contained place="view:Files" told onStopped={stopped} onReset={onReset} resetKey={1}>
            <FlakyScreen broken={false} />
          </Contained>,
        );
      });
      const retry = [...host.querySelectorAll("button")].find((b) => b.textContent === "Try again");
      expect(Boolean(retry)).toBe(true);
      act(() => retry?.click());
      expect([host.textContent, onReset.mock.calls.length]).toEqual(["Recovered screen", 1]);

      act(() => {
        root.render(
          <Contained place="overlay" told={false} onStopped={stopped} resetKey={1}>
            <FlakyScreen broken />
          </Contained>,
        );
      });
      expect(host.textContent).toBe("");

      act(() => {
        root.render(
          <Contained place="overlay" told={false} onStopped={stopped} resetKey={2}>
            <FlakyScreen broken={false} />
          </Contained>,
        );
      });
      expect(host.textContent).toBe("Recovered screen");
    } finally {
      act(() => root.unmount());
      react.IS_REACT_ACT_ENVIRONMENT = previous;
      host.remove();
      reported.mockRestore();
    }
  });
});

describe("shelf.vibe Contract C4 scoped store and bounded LRU cache", () => {
  // spec/app/shell/index.md, "Story: Move between Home and the apps"
  it("supports createShelf with useSyncExternalStore, scopedShelf isolation, and createBoundedCache LRU eviction (spec/app/shell/index.md, \"Story: Move between Home and the apps\")", async () => {
    const shelf = createShelf(1, { reset: () => 1 });
    const listener = vi.fn();
    const unsub = shelf.subscribe(listener);
    shelf.set(1);
    expect(listener).toHaveBeenCalledTimes(0);
    shelf.set(2);
    expect([shelf.get(), shelf.snapshot(), listener.mock.calls.length]).toEqual([2, 2, 1]);
    expect(shelf.update((n) => n + 3)).toBe(5);
    expect(shelf.reset()).toBe(1);
    unsub();

    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    const previous = react.IS_REACT_ACT_ENVIRONMENT;
    react.IS_REACT_ACT_ENVIRONMENT = true;
    try {
      act(() => root.render(<ShelfReader source={shelf} />));
      expect(host.textContent).toBe("count:1");
      act(() => { shelf.set(7); });
      expect(host.textContent).toBe("count:7");
    } finally {
      act(() => root.unmount());
      react.IS_REACT_ACT_ENVIRONMENT = previous;
      host.remove();
    }

    const r1 = ManagedRuntime.make(scopedShelf(CounterShelf, () => 10));
    const r2 = ManagedRuntime.make(scopedShelf(CounterShelf, () => 10));
    let s1!: Shelf<number>;
    try {
      s1 = await r1.runPromise(CounterShelf.use((s) => Effect.succeed(s)));
      const s2 = await r2.runPromise(CounterShelf.use((s) => Effect.succeed(s)));
      s1.set(42);
      expect([s1.get(), s2.get()]).toEqual([42, 10]);
    } finally {
      await r1.dispose();
      await r2.dispose();
    }
    expect(s1.get()).toBe(10);

    const evicted: Array<[string, number]> = [];
    const cache = createBoundedCache<string, number>(2, { onEvict: (k, v) => { evicted.push([k, v]); } });
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);
    expect([cache.has("b"), cache.has("a"), cache.has("c"), cache.size()]).toEqual([false, true, true, 2]);
    expect(evicted).toEqual([["b", 2]]);
    expect(cache.entries()).toEqual([["a", 1], ["c", 3]]);
    expect(cache.delete("a")).toBe(true);
    cache.clear();
    expect([cache.size(), evicted]).toEqual([0, [["b", 2], ["c", 3]]]);
  });
});
