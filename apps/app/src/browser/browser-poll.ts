/** Work the browser adapter's 100 ms poll may skip. Pure decisions and a small saver with injected
 * effects; nothing here touches the DOM or a native plugin directly. */

/** Off the Browser view with the native surface already hidden, there is no geometry to measure or send. */
export const surfacePollIdle = (view: unknown, lastGeometry: string, hiddenGeometry: string): boolean =>
  surfaceIdleForView(typeof view === 'string' ? view : '', lastGeometry, hiddenGeometry);
/** `surfacePollIdle` for a view name; any non-string view is passed as ''. Checked by LemmaScript. */
export function surfaceIdleForView(view: string, lastGeometry: string, hiddenGeometry: string): boolean {
  //@ verify
  //@ ensures \result <==> view !== 'browser' && lastGeometry === hiddenGeometry
  //@ ensures view === 'browser' ==> !\result
  return view !== 'browser' && lastGeometry === hiddenGeometry;
}

export const SAVE_RETRY_MIN_MS = 2000, SAVE_RETRY_MAX_MS = 60000;
/** Wait before repeating a save that failed `failures` times in a row: 2 s, doubling, at most 60 s. */
export function saveRetryDelay(failures: number): number {
  return retryDelayForCount(Math.floor(Number(failures) || 0));
}
/** `saveRetryDelay` for a whole number of failures. Checked by LemmaScript: always within 2 s and 60 s,
 * 2 s up to the first failure, 60 s from the sixth, and never shorter after more failures. */
export function retryDelayForCount(count: number): number {
  //@ verify
  //@ decreases count
  //@ ensures 2000 <= \result && \result <= 60000
  //@ ensures count <= 1 ==> \result === 2000
  //@ ensures count >= 6 ==> \result === 60000
  //@ ensures forall(k, k <= count ==> retryDelayForCount(k) <= \result)
  if (count <= 1) return 2000;
  if (count >= 6) return 60000;
  return Math.min(60000, 2 * retryDelayForCount(count - 1));
}

export type SessionSaver = {
  /** Called on every poll. Builds a snapshot only when an input changed or a failed save is due again. */
  save(): void;
  /** Treat the current snapshot as already stored (after a restore or a clear). */
  prime(): void;
};

/**
 * Saves the browsing snapshot when it changes.
 * - `inputs` are compared by identity, so an unchanged poll costs no snapshot and no serialisation.
 * - One write is in flight at a time; a changed snapshot is written as soon as it is seen.
 * - A rejected write is not repeated on the next poll: the same snapshot is retried only after
 *   `saveRetryDelay`, which grows with consecutive failures and resets on success.
 * - While `enabled` is false nothing is built or written, and the pending change is kept for later.
 */
export function createSessionSaver<T>(input: {
  inputs: () => readonly unknown[];
  snapshot: () => T | null;
  write: (snapshot: T) => Promise<unknown>;
  enabled: () => boolean;
  now?: () => number;
}): SessionSaver {
  const now = input.now || (() => Date.now());
  let seen: readonly unknown[] | undefined, lastSaved = '', failed = false, failures = 0, retryAt = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const changed = () => {
    const next = input.inputs();
    if (seen && seen.length === next.length && next.every((value, index) => value === seen![index])) return false;
    seen = next;
    return true;
  };
  return {
    save() {
      if (!input.enabled()) return;
      const due = failed && now() >= retryAt;
      if (!changed() && !due) return;
      const snapshot = input.snapshot();
      if (!snapshot) { seen = undefined; return; }
      const next = JSON.stringify(snapshot);
      if (next === lastSaved && !due) return;
      lastSaved = next; failed = false;
      queue = queue.then(() => input.enabled() ? input.write(snapshot) : undefined).then(
        () => { if (lastSaved === next) failures = 0; },
        () => { if (lastSaved !== next) return; failed = true; failures += 1; retryAt = now() + saveRetryDelay(failures); },
      );
    },
    prime() {
      seen = input.inputs();
      lastSaved = JSON.stringify(input.snapshot());
      failed = false; failures = 0;
    },
  };
}
