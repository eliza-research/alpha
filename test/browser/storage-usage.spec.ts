import {returnToApps} from './app-navigation';
import {test,expect} from '@playwright/test';

test('Files shows the volume free space and refreshes its actual usage', async ({page}) => {
  await page.addInitScript(() => {
    (window as any).usage = 1024;
    Object.defineProperty(navigator, 'storage', {configurable: true, value: {
      estimate: async () => ({usage: (window as any).usage, quota: 4096}),
    }});
  });
  await page.goto('/?mode=dev');
  await page.getByRole('button', {name: 'Files', exact: true}).click();
  const volume = page.getByRole('button', {name: 'Internal storage', exact: true});
  await expect(volume).toContainText('3 KB free of 4 KB');
  await page.evaluate(() => (window as any).usage = 2048);
  await returnToApps(page);
  await page.getByRole('button', {name: 'Files', exact: true}).click();
  await expect(volume).toContainText('2 KB free of 4 KB');
});

for (const unavailable of ['missing', 'rejected', 'negative', 'infinite', 'over-quota']) {
  test(`Files preserves exact local bytes when storage estimates are ${unavailable}`, async ({page}) => {
    await page.addInitScript(kind => Object.defineProperty(navigator, 'storage', {configurable: true, value:
      kind === 'missing' ? {} : {estimate: async () => {
        if (kind === 'rejected') throw Error('No estimate');
        return {usage: kind === 'negative' ? -1 : kind === 'infinite' ? Infinity : 8192, quota: 4096};
      }},
    }), unavailable);
    await page.goto('/?mode=dev');
    await page.evaluate(async () => {
      const {registerPlugin} = await import('/src/platform-plugins.ts');
      await registerPlugin<any>('AlphaFiles').importFile(new File(['Café'], 'count.txt', {type: 'text/plain'}));
    });
    await page.getByRole('button', {name: 'Files', exact: true}).click();
    const volume = page.getByRole('button', {name: 'Internal storage', exact: true});
    await expect(volume).toBeVisible();
    await expect(volume).not.toContainText('free of');
    await volume.click();
    await expect(page.getByRole('button', {name: 'Open count.txt', exact: true})).toContainText('5 B');
    await page.reload();
    await page.getByRole('button', {name: 'Files', exact: true}).click();
    await page.getByRole('button', {name: 'Internal storage', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Open count.txt', exact: true})).toContainText('5 B');
    expect(await page.evaluate(async () => {
      const {registerPlugin} = await import('/src/platform-plugins.ts');
      return (await registerPlugin<any>('AlphaFiles').storageList({path: ''})).entries[0].size;
    })).toBe(5);
    await page.evaluate(async () => {
      const {registerPlugin} = await import('/src/platform-plugins.ts');
      await registerPlugin<any>('AlphaFiles').storageTrash({paths: ['count.txt']});
    });
    await expect(page.getByRole('button', {name: 'Open count.txt', exact: true})).toHaveCount(0);
  });
}
