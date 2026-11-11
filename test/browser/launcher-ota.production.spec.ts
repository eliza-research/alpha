import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { button, fenceNetwork, flagOffAndroid, harness } from './flag-off-android';

test('idle Home requests the exact launcher update on startup without opening Settings', async ({ page, request }) => {
  const signer = '5c'.repeat(32);
  const apk = {
    versionCode: 8,
    apkUrl: 'https://updates.example.invalid/launcher.apk',
    sha256: 'a4'.repeat(32),
    sizeBytes: 42_000_000,
  };
  const launcher = { ...apk, schema: 'alpha-update/v1', variant: 'launcher', signerSha256: signer };
  const standalone = { ...launcher, variant: 'standalone', versionCode: 9,
    apkUrl: 'https://updates.example.invalid/standalone.apk', sha256: 'b7'.repeat(32) };
  const manifest = JSON.stringify({ schema: 'alpha-update/index-v1', releases: [standalone, launcher] }, null, 2) + '\n';
  const manifestSha256 = createHash('sha256').update(manifest).digest('hex');
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page, { appUpdate: { manifest, manifestSha256, installedVersionCode: 7, installedSigner: signer } });
  await page.clock.install();

  expect(await (await request.get('/build-flags.json')).json()).toEqual({ testMocks: false });
  await page.goto('/');
  await expect.poll(() => harness(page, f => f.calls.includes('Agent.start'))).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'home');
  await expect(button(page, 'Notes')).toBeVisible();
  await expect(page.locator('.alpha-connection-scrim, dialog.alpha-startup-permissions')).toHaveCount(0);
  const updateChecks = () => harness(page, f => f.calls.filter((call: string) => call === 'AlphaDevice.checkForUpdate'));
  const installs = () => harness(page, f => f.appUpdate.installs);
  await expect.poll(updateChecks).toHaveLength(1);
  expect(await installs()).toEqual([]);

  await harness(page, f => f.appUpdate.releaseOffer());
  // Startup can overlap resident restoration. Allow one scheduler retry on the now-idle Home.
  await page.clock.runFor(60_001);
  await expect.poll(installs).toEqual([{ ...apk, automatic: true, manifestSha256 }]);
  expect(await updateChecks()).toHaveLength(1);
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'home');
  expect(await harness(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});
