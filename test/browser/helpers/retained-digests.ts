import {expect, type Page} from '@playwright/test';

/** The owner removed the Settings shortcut. Retained result and renewal routes still
 * mount this panel. These cases cover its real event handler and controls, not a
 * user navigation route from Settings. No new production entry point is added. */
export async function openRetainedDigests(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('alpha:hosted-digests')));
  await expect(page.getByRole('dialog', {name:'Scheduled digests',exact:true})).toBeVisible();
}
