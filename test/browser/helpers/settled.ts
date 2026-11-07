import type { Page } from '@playwright/test';

/**
 * Readiness marker for a screen whose geometry is about to be measured: fonts are loaded, the short
 * motion running when it is called has finished (screen entry, sheets, menus; spinners, countdowns
 * and other long or endless animations are ignored), and two frames have been laid out since. It
 * replaces fixed waits, which a loaded machine can outrun: entry motion runs on wall time, and a
 * 450ms wait does not cover a 460ms entry animation that started a frame late.
 */
export async function settled(page: Page, timeout = 15_000) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // Two frames first, so motion that the last action triggered has started.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  // The short motion running now (screen entry, a sheet, a menu) is awaited to its end. Motion that a
  // screen starts again and again (a scan line, a pulse) is content, not entry, and is not waited on.
  const done = await page.evaluate(limit => {
    const moving = document.getAnimations().filter(animation => {
      if (animation.playState !== 'running') return false;
      // Motion is short. Long or endless timelines (spinners, a toast's Undo countdown) are content.
      const end = Number(animation.effect?.getComputedTiming().endTime);
      return Number.isFinite(end) && end <= 2_000;
    });
    const finished = Promise.all(moving.map(animation => animation.finished.then(() => undefined, () => undefined)));
    return Promise.race([finished.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), limit))]);
  }, timeout);
  if (!done) throw new Error(`Screen motion did not finish within ${timeout}ms`);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/**
 * Waits for `count` rendered frames. Screen focus (`@elizaos/ui/accessibility/screen-focus`) judges
 * focus two frames after a change and then retries for up to 12 more, so 16 frames is the whole
 * window in which it may move focus, whatever the machine's frame rate. A fixed wait is not.
 */
export async function frames(page: Page, count = 16) {
  await page.evaluate(count => new Promise<void>(resolve => {
    let left = count;
    const next = () => (--left <= 0 ? resolve() : requestAnimationFrame(next));
    requestAnimationFrame(next);
  }), count);
}
