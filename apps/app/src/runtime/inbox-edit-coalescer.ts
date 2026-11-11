/** Timer port, replaceable in tests. */
export interface EditCoalescerTimers { set(run: () => void, ms: number): unknown; clear(handle: unknown): void; now(): number }
const systemTimers: EditCoalescerTimers = { set: (run, ms) => setTimeout(run, ms), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>), now: () => Date.now() };
export interface EditCoalescer<T> {
  /** Replaces the waiting value. The write happens `delay` after the last push, and no later than
   * `maximumWait` after the first push of a burst. */
  push(value: T): void;
  /** Writes the waiting value now, held or not. Returns whether there was one. */
  flush(): boolean;
  /** While held, a due write waits: nothing is written until release() or flush(). */
  hold(): void;
  release(): void;
  /** The value waiting to be written, or undefined. */
  peek(): T | undefined;
  readonly pending: boolean;
  /** Drops the waiting value without writing it. */
  discard(): void;
}
/** How long to wait from `now` for a burst whose first push was at `first`: `delay`, cut short so the
 * write is never later than `maximumWait` after the first push, and never negative. */
export function coalesceDelay(delay: number, maximumWait: number, first: number, now: number): number {
  //@ verify
  //@ requires 0 <= delay && delay <= maximumWait
  //@ ensures 0 <= \result && \result <= delay
  //@ ensures now <= first + maximumWait ==> now + \result <= first + maximumWait
  //@ ensures now >= first + maximumWait ==> \result === 0
  //@ ensures now + delay <= first + maximumWait ==> \result === delay
  return Math.max(0, Math.min(delay, first + maximumWait - now));
}
/**
 * Coalesces a burst of edits into one write of the latest value, so the cost of a write (encoding a
 * draft with its attachments, one store exchange) is paid per pause in typing and not per keystroke.
 * At most one value waits: an earlier one that was not written yet is replaced, never queued. A
 * writer that is still busy holds the coalescer, so writes cannot pile up behind a slow store.
 */
export function editCoalescer<T>(write: (value: T) => void, options: { delay?: number; maximumWait?: number; timers?: EditCoalescerTimers } = {}): EditCoalescer<T> {
  const delay = options.delay ?? 300, maximumWait = Math.max(delay, options.maximumWait ?? 1500), timers = options.timers ?? systemTimers;
  let waiting: { value: T } | null = null, timer: unknown = null, first = 0, held = 0;
  const cancel = () => { if (timer !== null) { timers.clear(timer); timer = null; } };
  const flush = () => { cancel(); if (!waiting) return false; const { value } = waiting; waiting = null; write(value); return true; };
  const due = () => { timer = null; if (!held) flush(); };
  return {
    push(value) {
      if (!waiting) first = timers.now();
      waiting = { value }; cancel();
      timer = timers.set(due, coalesceDelay(delay, maximumWait, first, timers.now()));
    },
    flush,
    hold() { held++; },
    release() { if (held > 0) held--; if (!held && waiting && timer === null) flush(); },
    peek() { return waiting?.value; },
    get pending() { return !!waiting; },
    discard() { cancel(); waiting = null; },
  };
}
