import {test, expect} from '@playwright/test';

test.use({hasTouch: true, isMobile: true});
for (const viewport of [{width: 412, height: 915}, {width: 360, height: 640}, {width: 915, height: 412}]) {
  test(`Camera controls stay reachable at ${viewport.width}x${viewport.height}`, async ({page}, info) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind: 'offline'}));
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Fixture has no hardware camera', 'NotFoundError'); };
    });
    await page.goto('/');
    await page.getByRole('button', {name: 'Camera', exact: true}).click();
    const root = page.locator('[data-alpha-camera-root]');
    await expect(root).toBeVisible();
    if (viewport.width > viewport.height) await expect(page.locator('html')).toHaveClass(/alpha-landscape/);
    await expect(root.getByRole('button', {name: /Choose image|Scan document|Ask Alpha/})).toHaveCount(0);
    for (const name of ['Back to apps', 'Photo mode', 'Video mode', 'Take photo']) {
      const button = root.getByRole('button', {name, exact: true});
      // The fitted phone uses a fractional transform at narrow desktop preview widths.
      await expect(button).toBeInViewport({ratio: 0.9999});
      expect(await button.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      })).toBe(true);
    }
    await page.screenshot({path: info.outputPath('camera-controls.png'), animations: 'disabled'});
  });
}
