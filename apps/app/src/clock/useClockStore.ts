// spec/app/clock/alarms.md, "Story: Manage my alarms"; spec/app/clock/timers.md, "Story: Run multiple countdown timers"; spec/app/clock/stopwatch.md, "Story: Time laps with the stopwatch"
import { Effect, type ManagedRuntime } from "effect";
import { useSyncExternalStore } from "react";
import { type ClockMetaState, clockRecords } from "./records.ts";
import { type ClockDelivery, activeClockRecords, activeClockTicks, fallbackClockNow, fallbackDelivery, fallbackStopwatchNow } from "./shelf.vibe";

interface Subscribable<T> {
  readonly snapshot: () => T;
  readonly subscribe: (listener: () => void) => () => void;
}

interface BoundStore<T> {
  readonly get: () => T;
  readonly subscribe: (listener: () => void) => () => void;
}

const metaStores = new WeakMap<object, BoundStore<ClockMetaState>>();
const deliveryStores = new WeakMap<object, BoundStore<ClockDelivery>>();
const clockNowStores = new WeakMap<object, BoundStore<number>>();
const stopwatchNowStores = new WeakMap<object, BoundStore<number>>();

function bindRuntimeShelf<R, E, T>(
  cache: WeakMap<object, BoundStore<T>>,
  runtime: ManagedRuntime.ManagedRuntime<R, E>,
  resolve: Effect.Effect<Subscribable<T>>,
  fallback: Subscribable<T>,
): BoundStore<T> {
  const known = cache.get(runtime);
  if (known) return known;
  let current: T = fallback.snapshot();
  let resolved: Subscribable<T> | undefined;
  let active: object | undefined;
  let stopSub: (() => void) | undefined;
  let stopFiber: (() => void) | undefined;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  const attach = (target: Subscribable<T>, token: object) => {
    if (active !== token) return;
    resolved = target;
    const next = target.snapshot();
    const changed = !Object.is(current, next);
    current = next;
    stopSub?.();
    stopSub = target.subscribe(() => {
      if (active !== token) return;
      const updated = target.snapshot();
      if (Object.is(current, updated)) return;
      current = updated;
      notify();
    });
    if (changed) notify();
  };

  const store: BoundStore<T> = {
    get: () => (resolved ? resolved.snapshot() : current),
    subscribe: (listener) => {
      listeners.add(listener);
      if (!active) {
        const token = {};
        active = token;
        if (resolved) {
          attach(resolved, token);
        } else {
          const fiber = runtime.runFork(
            Effect.map(resolve, (target) => {
              attach(target, token);
            }),
          );
          stopFiber = () => fiber.interruptUnsafe();
        }
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          active = undefined;
          stopSub?.();
          stopSub = undefined;
          stopFiber?.();
          stopFiber = undefined;
        }
      };
    },
  };
  cache.set(runtime, store);
  return store;
}

/** Subscribe a React component to the runtime's scoped Clock metadata shelf. */
export function useClockMeta<R, E>(runtime: ManagedRuntime.ManagedRuntime<R, E>): ClockMetaState {
  const store = bindRuntimeShelf(metaStores, runtime, activeClockRecords(), clockRecords);
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** Subscribe a React component to the runtime's scoped one-second Clock timestamp shelf. */
export function useClockNow<R, E>(runtime: ManagedRuntime.ManagedRuntime<R, E>): number {
  const store = bindRuntimeShelf(
    clockNowStores,
    runtime,
    Effect.map(activeClockTicks(), (ticks) => ticks.clockNow),
    fallbackClockNow,
  );
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** Subscribe a React component to the runtime's scoped 50ms Stopwatch timestamp shelf. */
export function useStopwatchNow<R, E>(runtime: ManagedRuntime.ManagedRuntime<R, E>): number {
  const store = bindRuntimeShelf(
    stopwatchNowStores,
    runtime,
    Effect.map(activeClockTicks(), (ticks) => ticks.stopwatchNow),
    fallbackStopwatchNow,
  );
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** Android's current capability to deliver the owner's scheduled Clock alerts. */
export function useClockDelivery<R, E>(runtime: ManagedRuntime.ManagedRuntime<R, E>): ClockDelivery {
  const store = bindRuntimeShelf(deliveryStores, runtime, Effect.map(activeClockTicks(), (ticks) => ticks.delivery), fallbackDelivery);
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
