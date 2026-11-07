import { test, expect } from '@playwright/test';

test('Home icons stay fixed while chat is dragged and its resting controls animate in', async ({ page }) => {
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind:'offline'})));
  await page.goto('/?shell=launcher');
  // Match the physical Pixel's system-bar clearance; the desktop dock fits
  // below the minimum reserve and would hide this native-only regression.
  await page.evaluate(() => {
    document.documentElement.classList.add('native-phone');
    document.documentElement.style.setProperty('--native-bottom-inset', '48px');
  });
  await page.getByRole('button', {name:'Open conversation', exact:true}).click();
  const handle = page.getByRole('button', {name:'Resize chat', exact:true});
  await expect(handle).toBeVisible();
  const icon = page.locator('[data-alpha-home-apps]').getByRole('button', {name:'Inbox', exact:true});
  // Finish the entry animation before measuring movement caused by this drag.
  await page.waitForTimeout(500);
  const box = (await handle.boundingBox())!;
  const positions = [await icon.evaluate(el => el.getBoundingClientRect().top)];
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    for (let delta = 10; delta <= 100; delta += 10) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + delta);
      await page.evaluate(() => new Promise(requestAnimationFrame));
      positions.push(await icon.evaluate(el => el.getBoundingClientRect().top));
    }
  } finally {
    await page.mouse.up();
  }
  for (let frame = 0; frame < 35; frame++) {
    await page.evaluate(() => new Promise(requestAnimationFrame));
    positions.push(await icon.evaluate(el => el.getBoundingClientRect().top));
  }
  expect(Math.max(...positions) - Math.min(...positions), JSON.stringify(positions)).toBeLessThan(1);
});
