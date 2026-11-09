import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';

/** Real BrowserClock with a held lock callback and synthetic audio. */
export async function withObservedReminderClock(BrowserClock, daily, run) {
 const navigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
 const interval = globalThis.setInterval;
 const locks = [], pending = [], sounds = [];
 let clock;
 Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {locks: {
  request(name, options, callback) {
   assert.equal(name, 'alpha.browser.alarm-owner');
   assert.equal(options.ifAvailable, true);
   return new Promise((resolve, reject) => { locks.push({callback, resolve, reject}); });
  },
 }}});
 // Poll and ring timers are driven explicitly here.
 globalThis.setInterval = () => 0;
 try {
  clock = new BrowserClock(daily, {list: async () => ({items: []})});
  clock.audio = {play: kind => sounds.push(kind), stop() {}};
  clock.open = () => {};
  const observed = {
   clock, sounds,
   queued: () => locks.length,
   poll: () => clock.poll(),
   grant() {
    const lock = locks.shift();
    assert.ok(lock, 'actual Clock requested the ringing owner lock');
    const held = Promise.resolve(lock.callback({}));
    held.then(lock.resolve, lock.reject);
    pending.push(held);
    return held;
   },
   async grantWithoutSound() {
    let timeout;
    try {
     await Promise.race([observed.grant(), new Promise((_resolve, reject) => {
      timeout = setTimeout(() => reject(Error('A suspended alarm must release the ringing lock')), 2000);
     })]);
    } finally { clearTimeout(timeout); }
    assert.deepEqual(sounds, []);
   },
   async waitForSound() {
    const deadline = Date.now() + 5000;
    for (let count = 0; sounds.length === 0 && count < 1000 && Date.now() < deadline; count++) await setImmediate();
    assert.deepEqual(sounds, ['alarm']);
   },
   retire: () => clock.retire(),
  };
  return await run(observed);
 } finally {
  clock?.retire();
  for (const lock of locks) lock.resolve();
  await Promise.allSettled(pending);
  if (navigator) Object.defineProperty(globalThis, 'navigator', navigator);
  else delete globalThis.navigator;
  globalThis.setInterval = interval;
 }
}
