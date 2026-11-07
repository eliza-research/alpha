import {test,expect} from '@playwright/test';
for (const theme of ['light', 'dark']) test(`Files category and storage labels align in the ${theme} browse list`, async ({page}, info) => {
  await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind: 'offline'})));
  await page.goto(`/?mode=dev&theme=${theme}`);
  await page.getByRole('button', {name: 'Files', exact: true}).click();
  const list = page.locator('[data-alpha-app-scroll="files"]');
  await expect(list.getByRole('button', {name: 'Internal storage', exact: true})).toBeVisible();
  const names = ['Downloads', 'Images', 'Videos', 'Audio', 'Documents', 'Internal storage', 'Trash'];
  const positions = [];
  for (const name of names) {
    const row = list.getByRole('button', {name, exact: true});
    await expect(row).toBeVisible();
    positions.push(await row.evaluate(button => {
      const label = button.querySelector(':scope > span:nth-child(2)')!;
      return {top: button.getBoundingClientRect().top, left: label.getBoundingClientRect().left};
    }));
  }
  expect(new Set(positions.map(row => row.top)).size).toBe(names.length);
  expect(Math.max(...positions.map(row => row.left)) - Math.min(...positions.map(row => row.left))).toBeLessThan(1);
  await page.screenshot({path: info.outputPath('files-aligned.png'), animations: 'disabled'});
});
