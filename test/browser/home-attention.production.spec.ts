import { test, expect } from '@playwright/test';
// Production lane (flag-off build, mocks unset). Home's attention, brief and calendar cards show
// honest states: no provider is connected in a fresh browser profile, no brief has run, and the
// calendar names where it was read from. The connected Inbox state of this card is exercised with
// development data in home-attention.spec.ts until a provider adapter reports through
// setHomeSources() in this lane.
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'production', 'Runs against the flag-off production build only'); });
const offline = () => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' }));

test('not connected: the Inbox card opens Connections without inventing an unread count', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(offline);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-connection-mode', 'live');
  const card = page.locator('[data-alpha-home-inbox]');
  await expect(card).toBeVisible();
  await expect(card).toHaveAccessibleName('Inbox');
  await expect(card.locator('[data-overview-part="count"]')).toHaveText('');
  await expect(page.getByText('Accounts are not connected')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('home-not-connected.png') });
  await card.click();
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'settings');
  await expect(page.getByRole('heading', { name: 'Connections', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('unloaded workflow and unverified calendar states do not fabricate results or avatars', async ({ page }) => {
  await page.addInitScript(offline);
  await page.goto('/');
  const brief = page.getByRole('button', { name: 'Open workflows and automations', exact: true });
  await expect(brief).toContainText('Workflows');
  await expect(brief).toContainText('Open to view');
  await brief.click();
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'workflows');
  await page.getByRole('button', { name: 'Back to apps', exact: true }).click();
  // An unverified agent source cannot claim a successful empty calendar read.
  const calendar = page.locator('[data-alpha-layer="home"] button[data-alpha-home-calendar]');
  await expect(calendar).toHaveAttribute('aria-label','Open Agent Calendar');
  // Unverified startup keeps the neutral Calendar label until a complete source read.
  await expect(calendar.locator('[data-overview-part="title"]')).toHaveText('Calendar');
  await expect(calendar).not.toContainText('Nothing planned');
  await expect(calendar).not.toContainText('No upcoming events');
  await expect(calendar).toHaveAttribute('data-alpha-home-calendar-event','false');
  await expect(calendar).not.toContainText(/^(MC|JP|\+2)$/);
  await expect(page.locator('[data-alpha-layer="home"]').getByText(/^(MC|JP|\+2)$/)).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Has a meeting link' })).toHaveCount(0);
});
