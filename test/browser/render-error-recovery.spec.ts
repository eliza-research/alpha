import {openLegacyNotes} from './helpers/legacy-notes';
import { test, expect } from '@playwright/test';
const offline = () => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind:'offline'}));

test('a render failure shows recovery without user content', async ({ page }) => {
  await page.addInitScript(offline);
  await page.goto('/');
  await openLegacyNotes(page);
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Private recovery title');
  await page.evaluate(() => window.dispatchEvent(new Event('alpha:force-render-error')));
  const recovery = page.getByRole('alertdialog', { name: 'Alpha Phone needs to reload' });
  await expect(recovery).toBeVisible();
  await recovery.getByText('Diagnostics', { exact: true }).click();
  const diagnostics = await recovery.locator('pre').innerText();
  expect(diagnostics).toContain('failure: render');
  expect(diagnostics).not.toContain('Private recovery title');
  expect(diagnostics).not.toContain('Forced render failure');
  await recovery.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});
