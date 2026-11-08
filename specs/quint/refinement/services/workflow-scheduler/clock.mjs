import assert from 'node:assert/strict';

/** Deterministic platform clock and callback delivery, without changing service logic. */
export function schedulerClock(initial = Date.parse('2026-11-08T00:00:00.000Z')) {
  let now = initial;
  let nextId = 0;
  const timers = new Map();
  const allTimers = [];
  class PlatformDate extends Date {
    constructor(...args) {
      if (args.length) super(...args);
      else super(now);
    }
    static now() { return now; }
  }
  return {
    Date: PlatformDate,
    initial,
    get now() { return now; },
    get timers() { return [...timers.values()]; },
    allTimers,
    setTimeout(callback, delay) {
      assert.ok(Number.isFinite(delay) && delay >= 0);
      const timer = {id: ++nextId, due: now + delay, callback, cancelled: false, unref() { return this; }};
      timers.set(timer.id, timer);
      allTimers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (!timer) return;
      timer.cancelled = true;
      timers.delete(timer.id);
    },
    advance(to) {
      assert.ok(to >= now, 'clock moves forward');
      now = to;
      const ready = [...timers.values()].filter(timer => timer.due <= now).sort((a, b) => a.due - b.due || a.id - b.id);
      for (const timer of ready) {
        if (!timers.delete(timer.id)) continue;
        timer.callback();
      }
    },
    deliverAlreadyQueued(timer) { timer.callback(); },
  };
}
