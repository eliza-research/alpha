import { test, expect, type Page } from '@playwright/test';
// The shell's toast lifetime (model.js toast): long enough to read, held while keyboard focus is
// inside it, dismissed by a tap. Android's "Time to take action" scale is 1 in a browser; the native
// setting is covered by test/accessibility-timeout.test.mjs and needs a device check.

/** The phone shell's own toast(), reached through the rendered tree: the call every adapter makes. */
const raise = (page: Page, message: string, undo = false) => page.evaluate(({ message, undo }) => {
  const screen = document.querySelector('[data-screen]') as any;
  const key = Object.keys(screen).find(name => name.startsWith('__reactFiber$'))!;
  let fiber = screen[key];
  while (fiber && !(fiber.stateNode && typeof fiber.stateNode.toast === 'function')) fiber = fiber.return;
  (window as any).__undone = 0;
  fiber.stateNode.toast(message, undo ? { undo: () => { (window as any).__undone++; ((window as any).__undoOrder ||= []).push(message); } } : undefined);
}, { message, undo });
const pill = (page: Page) => page.locator('[data-alpha-toast] .drop');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({ kind: 'offline' })));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible({timeout:15_000});
});

test('a long toast stays up for its reading time and a short one for 1.9 s', async ({ page }) => {
  test.setTimeout(60_000);
  await raise(page, 'A'.repeat(191));
  await page.waitForTimeout(9500);
  await expect(pill(page)).toBeVisible();
  await expect(pill(page)).toHaveCount(0, { timeout: 2500 });
  await raise(page, 'Saved');
  await page.waitForTimeout(1500);
  await expect(pill(page)).toBeVisible();
  await expect(pill(page)).toHaveCount(0, { timeout: 1500 });
});

test('a toast with Undo stays at least 5 s', async ({ page }) => {
  await raise(page, 'Deleted', true);
  await page.waitForTimeout(4700);
  await expect(pill(page).getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await expect(pill(page)).toHaveCount(0, { timeout: 2000 });
});

test('passive notices keep the current Undo and show the latest notice afterward', async ({page}) => {
  await raise(page, 'First item deleted', true);
  await raise(page, 'Older passive notice');
  await raise(page, 'Latest passive notice');
  await expect(pill(page)).toContainText('First item deleted');
  await pill(page).getByRole('button', {name:'Undo', exact:true}).click();
  await expect(pill(page)).toContainText('Latest passive notice');
  expect(await page.evaluate(() => (window as any).__undoOrder)).toEqual(['First item deleted']);
  await expect(pill(page).getByRole('button', {name:'Undo', exact:true})).toHaveCount(0);
});

test('consecutive deletion notices retain both exact Undo callbacks', async ({page}) => {
  await raise(page, 'First item deleted', true);
  await raise(page, 'Second item deleted', true);
  await expect(pill(page)).toContainText('First item deleted');
  await pill(page).getByRole('button', {name:'Undo', exact:true}).click();
  await expect(pill(page)).toContainText('Second item deleted');
  await pill(page).getByRole('button', {name:'Undo', exact:true}).click();
  await expect(pill(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__undoOrder)).toEqual(['First item deleted', 'Second item deleted']);
});

test('keyboard focus on Undo holds the toast, and focus returns when it ends', async ({ page }) => {
  test.setTimeout(60_000);
  const origin = page.getByRole('button', { name: 'Settings', exact: true });
  await origin.focus();
  await raise(page, 'Deleted', true);
  const undo = pill(page).getByRole('button', { name: 'Undo', exact: true });
  await undo.focus();
  await page.waitForTimeout(6500);
  await expect(undo).toBeVisible();
  await expect(undo).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(pill(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__undone)).toBe(1);
  await expect(origin).toBeFocused();
  // Focus leaving the toast lets it run out again.
  await raise(page, 'Deleted', true);
  await undo.focus();
  await page.waitForTimeout(5500);
  await expect(undo).toBeVisible();
  await origin.focus();
  await expect(pill(page)).toHaveCount(0, { timeout: 7000 });
});

test('tapping a plain toast dismisses it', async ({ page }) => {
  await raise(page, 'A'.repeat(120));
  await expect(pill(page)).toBeVisible();
  await pill(page).click();
  await expect(pill(page)).toHaveCount(0);
});

for (const key of ['Enter', 'Space']) {
  test(`a plain toast can be dismissed with ${key} and restores focus`, async ({page}) => {
    const origin=page.getByRole('button',{name:'Settings',exact:true});
    await origin.focus();
    await raise(page,'Calendar updated');
    const message=page.getByRole('button',{name:'Calendar updated',exact:true});
    await message.focus();
    await expect(message).toBeFocused();
    await page.keyboard.press(key);
    await expect(pill(page)).toHaveCount(0);
    await expect(origin).toBeFocused();
  });
}
