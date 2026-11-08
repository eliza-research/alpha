import { test, expect, type Page } from '@playwright/test';

// Android Back (or the edge swipe) on New or Edit password returns to the unlocked list and
// forgets the typed password, like the page's own Back (int-alphaphone-052). Development vault
// only (ELIZA_DEV_ALLOW_TEST_MOCKS=1, ?mode=dev); all values synthetic.
const TYPED = 'typed-synthetic-Back7';

async function unlockedVault(page: Page) {
  await page.goto('/?mode=dev');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Apps', exact: true }).click();
  await page.getByRole('button', { name: 'Passwords', exact: true }).click();
  await page.getByRole('button', { name: 'Unlock passwords', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Example sign-in', exact: true })).toBeVisible();
}
const androidBack = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('alpha-back', { cancelable: true })));

for (const form of ['New password', 'Edit password'] as const) {
  test(`Android Back on ${form} keeps the list unlocked and clears the typed password`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await unlockedVault(page);
    await page.getByRole('button', { name: form === 'New password' ? 'Add password' : 'Open Example sign-in', exact: true }).click();
    await expect(page.getByText(form, { exact: true }).first()).toBeVisible();
    await page.locator('input[aria-label="Password"]').fill(TYPED);
    await androidBack(page);
    await expect(page.getByText(form, { exact: true })).toHaveCount(0);
    // Still on Password manager, still unlocked: the entries are listed without a new unlock.
    await expect(page.getByRole('button', { name: 'Open Example sign-in', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unlock passwords', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Back to Apps', exact: true })).toBeVisible();
    // Reopening the form starts empty: the typed password was forgotten.
    await page.getByRole('button', { name: 'Add password', exact: true }).click();
    await expect(page.locator('input[aria-label="Password"]')).toHaveValue('');
    expect(await page.evaluate(marker => document.body.innerText.includes(marker), TYPED)).toBe(false);
    expect(errors).toEqual([]);
  });
}
