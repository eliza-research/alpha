import { test, expect, type Page } from '@playwright/test';
import { frames } from './helpers/settled';

// runtime/view-focus.ts on its own, over seeded markup: when a screen change or HOME drops focus,
// it lands on the new screen's name; focus that is somewhere real is never moved. "Stays" checks wait
// out the module's whole frame window (helpers/settled.ts `frames`), not a fixed time.
const phone = `<div class="os"><div data-screen="1">
  <div data-alpha-layer="home" role="region" aria-label="Home"><button>Settings</button><button>Files</button></div>
  <div data-alpha-layer="app" role="region" aria-label="Settings" inert aria-hidden="true" hidden>
    <header><button aria-label="Back to apps">‹</button><h1 data-alpha-app-title>Settings</h1></header><button>Display</button>
  </div>
  <div data-alpha-layer="composer" role="group" aria-label="Assistant controls"><textarea aria-label="Ask Alpha"></textarea></div>
</div></div>`;

async function load(page: Page) {
  // A same-origin page that does not boot the app, so only the module under test runs.
  await page.route('**/view-focus-fixture', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><title>View focus</title></head><body>${phone}</body></html>` }));
  await page.goto('/view-focus-fixture');
  await page.evaluate(() => { document.documentElement.dataset.activeView = 'home'; });
  await page.evaluate(async () => { (window as any).viewFocus = await import('/src/runtime/view-focus.ts' as string); (window as any).viewFocus.installViewFocus(); });
}
/** Moves the seeded phone to a screen as the shell does: the old layer goes inert, the new one shows. */
const show = (page: Page, view: 'home' | 'settings') => page.evaluate(next => {
  const home = document.querySelector<HTMLElement>('[data-alpha-layer="home"]')!, app = document.querySelector<HTMLElement>('[data-alpha-layer="app"]')!;
  const retire = (el: HTMLElement, on: boolean) => { el.inert = on; el.hidden = on; if (on) el.setAttribute('aria-hidden', 'true'); else el.removeAttribute('aria-hidden'); };
  retire(home, next !== 'home'); retire(app, next === 'home');
  document.documentElement.dataset.activeView = next;
}, view);
const focused = (page: Page) => page.evaluate(() => { const el = document.activeElement as HTMLElement; return el === document.body ? 'body' : el.getAttribute('aria-label') || el.textContent!.trim(); });

test('a screen change that drops focus moves it to the screen title, then to the Home region on HOME', async ({ page }) => {
  await load(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).focus();
  await show(page, 'settings');
  await expect.poll(() => focused(page)).toBe('Settings');
  const title = page.getByRole('heading', { name: 'Settings', exact: true });
  await expect(title).toBeFocused();
  // A name, not a stop: the title takes focus only from the script.
  await expect(title).toHaveAttribute('tabindex', '-1');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Display', exact: true })).toBeFocused();
  // HOME: the app retires with focus inside it.
  await show(page, 'home');
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await expect.poll(() => focused(page)).toBe('Home');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
});

test('focus that is somewhere real stays: the composer, an open dialog, or the first screen of a load', async ({ page }) => {
  await load(page);
  // The first screen of a load is not a change: nothing is focused for it.
  await frames(page);
  expect(await focused(page)).toBe('body');
  // Typing in the composer across a screen change.
  await page.getByRole('textbox', { name: 'Ask Alpha', exact: true }).focus();
  await show(page, 'settings');
  await frames(page);
  expect(await focused(page)).toBe('Ask Alpha');
  // A dialog owns focus while it is open.
  await show(page, 'home');
  await page.evaluate(() => { const dialog = document.createElement('dialog'); dialog.innerHTML = '<p>Review</p>'; document.body.append(dialog); dialog.showModal(); (document.activeElement as HTMLElement)?.blur(); });
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await frames(page);
  expect(await focused(page)).toBe('body');
});

test('rotation that rebuilds the focused layer gives focus back to the screen name; a page without focus gets none', async ({ page }) => {
  await load(page);
  await page.setViewportSize({ width: 915, height: 412 });
  await frames(page);
  expect(await focused(page)).toBe('body');
  await show(page, 'settings');
  await page.getByRole('button', { name: 'Display', exact: true }).focus();
  // The landscape layout replaces the row that held focus.
  await page.evaluate(() => { document.querySelector('[data-alpha-layer="app"] button:not([aria-label])')!.replaceWith(Object.assign(document.createElement('button'), { textContent: 'Display' })); });
  await page.setViewportSize({ width: 412, height: 915 });
  await expect.poll(() => focused(page)).toBe('Settings');
  // An app without a title row is named by its region.
  await page.evaluate(() => document.querySelector('[data-alpha-app-title]')!.remove());
  await page.getByRole('button', { name: 'Display', exact: true }).focus();
  await show(page, 'home'); await show(page, 'settings');
  await expect.poll(() => focused(page)).toBe('Settings');
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-alpha-layer'))).toBe('app');
});

test('an inline modal surface opening over dropped focus takes it, and HOME gives it back to Home', async ({ page }) => {
  await load(page);
  // Opening Apps retires Home's tiles behind its own inline modal surface (no native <dialog>).
  await page.getByRole('button', { name: 'Settings', exact: true }).focus();
  await page.evaluate(() => {
    const home = document.querySelector<HTMLElement>('[data-alpha-layer="home"]')!;
    home.inert = true; home.setAttribute('aria-hidden', 'true');
    const drawer = Object.assign(document.createElement('div'), { innerHTML: '<input type="search" aria-label="Search apps"><button>Open Clock</button>' });
    drawer.setAttribute('data-alpha-layer', 'drawer'); drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-modal', 'true'); drawer.setAttribute('aria-label', 'Apps');
    document.querySelector('[data-screen]')!.append(drawer);
  });
  await expect.poll(() => focused(page)).toBe('Apps');
  // Named by its label, never by typing into it: the search field (and the keyboard) stay closed.
  await expect(page.getByRole('searchbox', { name: 'Search apps', exact: true })).not.toBeFocused();
  // HOME closes it with focus inside.
  await page.getByRole('button', { name: 'Open Clock', exact: true }).focus();
  await page.evaluate(() => {
    document.querySelector('[data-alpha-layer="drawer"]')!.remove();
    const home = document.querySelector<HTMLElement>('[data-alpha-layer="home"]')!;
    home.inert = false; home.removeAttribute('aria-hidden');
    window.dispatchEvent(new Event('launcher-home'));
  });
  await expect.poll(() => focused(page)).toBe('Home');
});
