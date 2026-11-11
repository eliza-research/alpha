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
  const recovery = page.getByRole('alertdialog', { name: 'Something went wrong' });
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

for (const surface of ['standalone', 'launcher'] as const) {
  test(`a view render failure returns to usable ${surface} Home`, async ({ page }) => {
    await page.addInitScript(offline);
    await page.goto(surface === 'launcher' ? '/?shell=launcher' : '/');
    const notes = page.getByRole('button', { name: 'Notes', exact: true });
    await expect(notes).toBeVisible();

    const restoreRender = await page.evaluateHandle(async () => {
      const { VIEWS } = await import('/src/prototype/model.js');
      const render = VIEWS.notes.render;
      VIEWS.notes.render = () => {
        throw new TypeError('Private view error message');
      };
      return () => { VIEWS.notes.render = render; };
    });

    await notes.click();
    await expect(page.locator('[data-alpha-toast]')).toContainText('Notes had a problem and was closed.');
    await expect(page.locator('html')).toHaveAttribute('data-active-view', 'home');
    await expect(page.getByRole('alertdialog', { name: 'Something went wrong' })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Ask Alpha', exact: true })).toBeVisible();

    if (surface === 'standalone') {
      const log = await page.evaluate(() => localStorage.getItem('alpha.crash-log.v1'));
      expect(log).toContain('TypeError');
      expect(log).not.toContain('Private view error message');
    }
    await restoreRender.evaluate(restore => restore());
    await notes.click();
    await expect(page.locator('html')).toHaveAttribute('data-active-view', 'notes');
  });
}
