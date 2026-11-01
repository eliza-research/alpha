import { test, expect, type Page, type Locator } from '@playwright/test';

// Every enabled root view on a fresh profile, and with browser storage blocked, in both themes.
// Product rule: an honest, labelled empty or unconnected state (never fixture content), a
// role=alert when persistent storage is unavailable, a named landmark for the active view, and
// keyboard focus that lands on a named control inside it. No new dependency: plain Playwright.
//
const ROOT = ['Inbox', 'Calendar', 'Browser', 'Camera', 'Photos', 'Maps', 'Notes', 'Files', 'Workflows', 'Settings'] as const;
type View = typeof ROOT[number] | 'Reminders' | 'Notifications';
const VIEWS: View[] = [...ROOT, 'Reminders', 'Notifications'];
const EMPTY: Record<View, RegExp> = {
  Inbox: /Connect Eliza Cloud to use Gmail/,
  Calendar: /Connect to view Agent Calendar\./,
  Browser: /No open pages|New tab/,
  Camera: /^Camera unavailable$/,
  Photos: /^No photos$/,
  Maps: /Add a location/,
  // Agent Notes waiting for a connection (canonical-notes-ui.ts), as in production-surface.spec.ts.
  Notes: /Notes is unavailable for this agent connection\. Check Settings › Agent connection\./,
  Files: /No recent files/,
  Workflows: /Connect your remote agent in Settings\. Reminders on this phone stay available/,
  Settings: /Not signed in/,
  Reminders: /Connect to view Agent Calendar\./,
  Notifications: /No notifications/,
};
// Fixture identities from the reference prototype must never appear in a live profile.
const FIXTURE = [/\bMaya\b/, /\bJordan\b/, /\bNopa\b/, /2,418 items/, /Morning brief/];

// A cold dev server compiles the app on first load; allow for it without hiding slow views.
test.describe.configure({ timeout: 60_000 });

async function blockStorage(page: Page) {
  await page.addInitScript(() => {
    const blocked = () => { throw new DOMException('Storage blocked for this test', 'SecurityError'); };
    for (const key of ['localStorage', 'sessionStorage', 'indexedDB']) Object.defineProperty(window, key, { configurable: true, get: blocked });
  });
}
async function open(page: Page, view: View, theme: 'light' | 'dark'): Promise<Locator> {
  if(view==='Maps')await page.route('https://tiles.openfreemap.org/**',route=>route.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e7ebed'}}]}}));
  // Android's shade is the notification surface (#416). This development build stands in for it,
  // opened from launcher Home's Notifications button (docs/gesture-zones.md); the standalone app has none.
  const launcher = view === 'Notifications' ? (theme === 'dark' ? '&shell=launcher' : '?shell=launcher') : '';
  await page.goto((theme === 'dark' ? '/?theme=dark' : '/') + launcher);
  // Home shortcuts cannot be restored when storage is blocked. All apps must
  // remain usable in that state, so exercise its actual built-in navigation.
  await page.getByRole('button', { name: 'All apps', exact: true }).waitFor({ state: 'visible' });
  if (view === 'Notifications') {
    await page.getByRole('button', { name: 'Open notifications', exact: true }).click();
    const shade = page.locator('[data-alpha-layer="shade"]');
    await expect(shade).toHaveAttribute('aria-hidden', 'false');
    return shade;
  }
  const target=view === 'Reminders' ? 'Calendar' : view;
  const shortcut=page.getByRole('button',{name:target,exact:true});
  if(await shortcut.isVisible())await shortcut.click();
  else{await page.getByRole('button',{name:'All apps',exact:true}).click();await page.getByRole('dialog',{name:'All apps',exact:true}).getByRole('button',{name:`Open ${target}`,exact:true}).click();}
  await expect(page.locator('html')).toHaveAttribute('data-active-view', view === 'Reminders' ? 'calendar' : view.toLowerCase());
  const app = page.locator('[data-alpha-layer="app"]');
  await expect(app).toHaveAttribute('aria-hidden', 'false');
  if(view==='Notes')return page.getByRole('region',{name:'Notes',exact:true}).filter({has:page.getByRole('heading',{name:'Notes',exact:true})});
  return app;
}
async function themeIsApplied(surface: Locator, theme: 'light' | 'dark') {
  const luminance = await surface.evaluate(element => {
    const [r, g, b] = getComputedStyle(element).color.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  });
  // Dark theme draws light foreground text; light theme draws dark text.
  if (theme === 'dark') expect(luminance).toBeGreaterThan(0.5); else expect(luminance).toBeLessThan(0.5);
}
for (const theme of ['light', 'dark'] as const) for (const view of VIEWS) {
  test(`${view} ${theme}: fresh profile is empty, labelled and keyboard accessible`, async ({ page }) => {
    const surface = await open(page, view, theme);
    // One fresh profile covers the same root's content, landmark and focus.
    if (view !== 'Camera') await themeIsApplied(surface, theme);
    await expect(surface.getByText(EMPTY[view]).filter({visible:true}).first()).toBeVisible();
    if (view === 'Camera') {
      const recovery = surface.getByRole('alert', { name: 'Camera unavailable', exact: true });
      await expect(recovery).toBeVisible();
      await expect(recovery.getByRole('button', { name: 'Try again', exact: true })).toBeEnabled();
    }
    const text = await surface.innerText();
    for (const fixture of FIXTURE) expect(text, `${view} renders fixture ${fixture}`).not.toMatch(fixture);
    const name = view === 'Reminders' ? /Reminders|Calendar/ : new RegExp(view);
    await expect(page.getByRole('main', { name }).or(page.getByRole('region', { name })).or(page.getByRole('dialog', { name })).first()).toBeVisible();
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    await expect(focused).toHaveCount(1);
    expect(await focused.evaluate((element, root) => root!.contains(element), await surface.elementHandle())).toBe(true);
    const label = await focused.evaluate(element => (element.getAttribute('aria-label') || (element as HTMLElement).innerText || element.getAttribute('title') || '').trim());
    expect(label.length, 'focused control has an accessible name').toBeGreaterThan(0);
  });

  test(`${view} ${theme}: blocked storage raises a role=alert`, async ({ page }) => {
    await blockStorage(page);
    const surface=await open(page, view, theme);
    await expect(page.locator('[role=status],[role=alert]').filter({ hasText: /could not|unavailable|recovery|retry/i, visible: true }).first()).toBeVisible();
    await expect(surface.getByRole('alert').filter({ hasText: /storage|could not|unavailable|recovery|retry/i }).first()).toBeVisible({timeout:3_000});
  });
}

test('empty Calendar timeline remains reachable and scrollable by keyboard',async({page})=>{
 await open(page,'Calendar','light');const timeline=page.getByRole('region',{name:'Calendar timeline',exact:true});
 await timeline.focus();await expect(timeline).toBeFocused();await page.keyboard.press('End');
 await expect.poll(()=>timeline.evaluate(element=>element.scrollTop)).toBeGreaterThan(0);
});
