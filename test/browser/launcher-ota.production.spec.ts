import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { button, fenceNetwork, flagOffAndroid, harness } from './flag-off-android';
import { residentStub, stub } from './resident-stub';

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
const appUpdate = { manifest, manifestSha256, installedVersionCode: 7, installedSigner: signer };
const expectedInstall = { ...apk, automatic: true, manifestSha256 };
const updateChecks = (page: Page) => harness(page, f => f.calls.filter((call: string) => call === 'AlphaDevice.checkForUpdate'));
const installs = (page: Page) => harness(page, f => f.appUpdate.installs);

test('idle Home requests the exact launcher update on startup without opening Settings', async ({ page, request }) => {
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page, { appUpdate });
  await page.clock.install();

  expect(await (await request.get('/build-flags.json')).json()).toEqual({ testMocks: false });
  await page.goto('/');
  await expect.poll(() => harness(page, f => f.calls.includes('Agent.start'))).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'home');
  await expect(button(page, 'Notes')).toBeVisible();
  await expect(page.locator('.alpha-connection-scrim, dialog.alpha-startup-permissions')).toHaveCount(0);
  await expect.poll(() => updateChecks(page)).toHaveLength(1);
  expect(await installs(page)).toEqual([]);

  await harness(page, f => f.appUpdate.releaseOffer());
  // Startup can overlap resident restoration. Allow one scheduler retry on the now-idle Home.
  await page.clock.runFor(60_001);
  await expect.poll(() => installs(page)).toEqual([expectedInstall]);
  expect(await updateChecks(page)).toHaveLength(1);
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'home');
  expect(await harness(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});

async function openSignedOutLauncher(page: Page) {
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page, { appUpdate });
  await residentStub(page, { nativeSignIn: true, emptyKeystore: true });
  await page.clock.install();
  await page.goto('/');
  const welcome = page.getByRole('main', { name: 'Alpha', exact: true });
  const email = welcome.getByRole('textbox', { name: 'Email', exact: true });
  await expect(welcome).toBeVisible();
  await expect(email).toBeEnabled();
  await expect(email).not.toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'home');
  await expect.poll(() => updateChecks(page)).toHaveLength(1);
  await expect.poll(() => stub(page, s => s.order.includes('native sign-in status'))).toBe(true);
  expect(await installs(page)).toEqual([]);
  return { welcome, email, foreign };
}

async function expectNoSignIn(page: Page, foreign: string[]) {
  expect(await harness(page, f => Object.hasOwn(f.slots, 'cloud:production'))).toBe(false);
  expect(await stub(page, s => s.order.filter((call: string) => /^native sign-in (startEmail|verifyEmail)$/.test(call)))).toEqual([]);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
}

test('untouched required sign-in requests the exact launcher update with an empty Keystore', async ({ page, request }) => {
  expect(await (await request.get('/build-flags.json')).json()).toEqual({ testMocks: false });
  const { welcome, email, foreign } = await openSignedOutLauncher(page);
  await expect(email).toHaveValue('');
  await expectNoSignIn(page, foreign);

  await harness(page, f => f.appUpdate.releaseOffer());
  await page.clock.runFor(60_001);
  await expect.poll(() => installs(page)).toEqual([expectedInstall]);
  await expect(welcome).toBeVisible();
  await expectNoSignIn(page, foreign);
});

test('a blurred sign-in draft holds the launcher update until the field is cleared', async ({ page }) => {
  const { welcome, email, foreign } = await openSignedOutLauncher(page);
  const draft = 'unsent@fixture.invalid';
  await email.fill(draft);
  await email.press('Tab');
  await expect(email).not.toBeFocused();

  await harness(page, f => f.appUpdate.releaseOffer());
  // Cover the initial attempt and first retry with the unsent address still in the field.
  await page.clock.runFor(60_001);
  expect(await installs(page)).toEqual([]);
  await expect(email).toHaveValue(draft);

  await email.fill('');
  await email.press('Tab');
  await expect(email).not.toBeFocused();
  await page.clock.runFor(120_001);
  await expect.poll(() => installs(page)).toEqual([expectedInstall]);
  await expect(welcome).toBeVisible();
  await expectNoSignIn(page, foreign);
});
