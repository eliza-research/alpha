import { test, expect, type Page } from '@playwright/test';

// Production builds resolve ./fixtures.js to ./fixtures.empty.js. The dev server
// always serves the real fixtures, so swap the module over the network here and
// check that the live product renders from empty, honest state without errors.
const sentinels = /Jordan Park|Maya Chen|Priya Nair|Alex Kim|you@gmail\.example|Ritual Coffee|news\.example|Design review at|Unlock for details|Running a few minutes late|218 GB free|tartine|Enclave lock/;
const views = ['Inbox', 'Calendar', 'Browser', 'Camera', 'Photos', 'Maps', 'Notes', 'Files', 'Workflows', 'Settings'];

async function withEmptyFixtures(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let swapped = 0;
  await page.route(/\/src\/prototype\/fixtures\.js(\?.*)?$/, async route => {
    swapped++;
    const response = await route.fetch({ url: route.request().url().replace('/fixtures.js', '/fixtures.empty.js') });
    await route.fulfill({ response });
  });
  return { errors, swapped: () => swapped };
}

test('live views render from empty fixtures without errors or fixture text', async ({ page }) => {
  test.setTimeout(90_000);
  const { errors, swapped } = await withEmptyFixtures(page);
  for (const name of views) {
    await page.goto('/');
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-active-view', name.toLowerCase());
    await page.waitForTimeout(250);
    const text = await page.locator('body').innerText();
    expect(text, name).not.toMatch(sentinels);
    expect(text, name).not.toContain('undefined');
  }
  expect(swapped()).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('Files root shows the storage browser instead of seeded files', async ({ page }) => {
  const { errors } = await withEmptyFixtures(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Internal storage', exact: true })).toBeVisible();
  await expect(page.getByText(/No recent files/)).toHaveCount(0);
  await expect(page.getByText('218 GB free')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('notification shade has no seeded notices, no Enclave lock tile and neutral unknown tiles', async ({ page }) => {
  const { errors } = await withEmptyFixtures(page);
  await page.goto('/?shell=launcher');
  await expect(page.getByRole('button', { name: 'Inbox', exact: true })).toBeVisible();
  const box=(await page.locator('[data-screen]').boundingBox())!,scale=box.width/412;await page.mouse.move(box.x+206*scale,box.y+420*scale);await page.mouse.down();await page.mouse.move(box.x+206*scale,box.y+660*scale,{steps:10});await page.mouse.up();
  const shade = page.locator('[data-alpha-layer="shade"]');
  await expect(shade).toHaveAttribute('aria-hidden', 'false');
  await expect(shade.getByRole('status').filter({ hasText: 'No notifications' })).toBeVisible();
  await expect(shade.getByRole('button', { name: 'Enclave lock' })).toHaveCount(0);
  // Flashlight has no device fact behind it, so it must not claim on or off.
  await expect(shade.getByRole('button', { name: 'Flashlight', exact: true })).not.toHaveAttribute('aria-pressed', /.*/);
  expect(await shade.innerText()).not.toMatch(sentinels);
  expect(errors).toEqual([]);
});
