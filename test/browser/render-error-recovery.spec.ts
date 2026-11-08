import { test, expect } from '@playwright/test';
const offline = () => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind:'offline'}));

test('a render failure shows recovery without user content', async ({ page }) => {
  await page.addInitScript(offline);
  await page.goto('/');
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
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

for (const order of ['startup-first', 'render-first']) {
  test(`recovery remains a single focused surface with ${order}`, async ({ page }) => {
    await page.addInitScript(offline);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
    const startup = () => page.evaluate(async () => {
      const recovery = await import('/src/runtime/error-boundary.tsx');
      recovery.showRecoveryScreen('startup', new Error('Synthetic private recovery content'));
    });
    const render = () => page.evaluate(() => window.dispatchEvent(new Event('alpha:force-render-error')));
    if (order === 'startup-first') { await startup(); await render(); }
    else { await render(); await expect(page.getByRole('alertdialog')).toBeVisible(); await startup(); }
    const recovery = page.getByRole('alertdialog', { name: 'Alpha Phone needs to reload' });
    await expect(recovery).toHaveCount(1);
    await expect(recovery.getByRole('button', { name: 'Reload', exact: true })).toBeFocused();
    await expect(page.locator('#alpha-recovery-title')).toHaveCount(1);
    const diagnostics = await recovery.locator('pre').textContent();
    expect(diagnostics).toContain(`failure: ${order === 'startup-first' ? 'startup' : 'render'}`);
    expect(diagnostics).not.toContain('Synthetic private recovery content');
    await recovery.getByRole('button', { name: 'Reload', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });
}
