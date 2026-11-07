import { test, expect } from '@playwright/test';
// Production lane (flag-off build, mocks unset). A fresh browser profile has no provider connected,
// no brief and no verified calendar read, so Home draws none of its cards and shows the date line
// instead (docs/ui-refresh-2026-11). Nothing fabricates an unread count, a result or avatars. The
// connected Inbox state of the mail card is exercised with development data in home-attention.spec.ts.
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'production', 'Runs against the flag-off production build only'); });
const offline = () => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' }));

test('not connected: no mail card and no setup card; Inbox stays reachable from its app tile', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(offline);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-connection-mode', 'live');
  const home = page.getByRole('region', { name: 'Home', exact: true });
  await expect(home.locator('[data-alpha-home-date]')).toBeVisible();
  await expect(home.locator('[data-alpha-home-inbox]')).toHaveCount(0);
  await expect(home).not.toContainText(/Connect email|Set up Gmail|unread/);
  // Offline is not signed in to Eliza Cloud, so Google is not known to be disconnected.
  await expect(home.getByRole('button', { name: 'Connect Google', exact: true })).toHaveCount(0);
  await expect(page.getByText('Accounts are not connected')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('home-not-connected.png') });
  await home.locator('[data-alpha-home-apps]').getByRole('button', { name: 'Inbox', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'inbox');
  expect(errors).toEqual([]);
});

test('unloaded workflow and unverified calendar states draw no card and fabricate no results or avatars', async ({ page }) => {
  await page.addInitScript(offline);
  await page.goto('/');
  const home = page.locator('[data-alpha-layer="home"]');
  await expect(home.locator('[data-alpha-home-date]')).toBeVisible();
  // No list loaded: no workflows card and no "Open to view" placeholder.
  await expect(page.getByRole('button', { name: 'Open workflows and automations', exact: true })).toHaveCount(0);
  await expect(home).not.toContainText(/Open to view|No brief yet|Connect your agent/);
  // An unverified agent source cannot claim a successful empty calendar read, and has no event to show.
  await expect(home.locator('[data-alpha-home-calendar]')).toHaveCount(0);
  await expect(home).not.toContainText(/Nothing planned|No upcoming events|Calendar has not been verified/);
  await expect(home.getByText(/^(MC|JP|\+2)$/)).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Has a meeting link' })).toHaveCount(0);
});
