import { test, expect } from '@playwright/test';
// Production lane (flag-off build, mocks unset). Home's Inbox card shows an honest state: no
// provider is connected in a fresh browser profile. The connected Inbox state of this card is
// exercised with development data in home-attention.spec.ts until a provider adapter reports
// through setHomeSources() in this lane. The fresh brief and calendar cards are covered in
// home-daily-overview.production.spec.ts.
const offline = () => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' }));

test('not connected: the Inbox card opens Connections without inventing an unread count', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(offline);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-connection-mode', 'live');
  const card = page.locator('[data-alpha-home-inbox]');
  await expect(card).toBeVisible();
  await expect(card).toHaveAccessibleName('Connect email');
  await expect(card).toContainText('Connect email');
  await expect(card.locator('[data-overview-part="count"]')).toHaveText('');
  await expect(page.getByText('Accounts are not connected')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('home-not-connected.png') });
  await card.click();
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'settings');
  await expect(page.getByRole('heading', { name: 'Connections', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
