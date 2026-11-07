import {openCloudPlanFromSettings} from './helpers/cloud-plan-settings';
import {seedCompletedAccessSetup} from './flag-off-android';
// Replacing one Eliza Cloud account with another on the flag-off Android renderer, and a second
// sign-in over a saved key.
//
// Evidence boundary: source/test evidence for the flag-off renderer only. The bridge stub
// (flag-off-android.ts and resident-stub.ts) is not the native plugins, Eliza Cloud, Google, the
// resident runtime or a device. Two synthetic accounts stand in for two real ones.
import { test, expect, type Page } from '@playwright/test';
import { flagOffAndroid, harness, button, fenceNetwork, expectNoDevelopmentSurface, residentHome, openYourAgent, completeAccessSetup } from './flag-off-android';
import { residentStub, stub, setStub, enterNativeEmailCode, type StubAccount } from './resident-stub';

test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'production', 'Production bundle only'); });

const A: StubAccount = { token: 'account-a-key', userId: '9f1dc45a-4011-4e44-947a-30d999d24fa5', email: 'owner-a@example.invalid', balance: 5, inbox: 'mail-a@example.invalid' };
const B: StubAccount = { token: 'account-b-key', userId: '3c5e7a90-1b2d-4f6e-8a0c-2e4f6a8b0c1d', email: 'owner-b@example.invalid', balance: 7, inbox: 'mail-b@example.invalid' };
const PERSONAL_A = 'alpha.cloud.personal-setup.v1:' + JSON.stringify(['production', A.userId, null]);
const bubble = (page: Page, text: string) => page.getByRole('button', { name: 'Message actions: ' + text, exact: true });
async function cloudPlan(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await button(page, 'Settings').click();
  await openCloudPlanFromSettings(page);
  return page.getByRole('region',{name:'Settings',exact:true});
}

test('signing out of account A and into account B stops the resident before A is revoked and uses only B afterwards', async ({ page }) => {
  test.setTimeout(150_000);
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page);
  await residentStub(page, { nativeSignIn:true, accounts: [A, B] });
  // Account A left a Cloud personal-setup intent on this phone; the renderer records who reads it.
  await page.addInitScript(key => {
    if (!sessionStorage.getItem('replacement-seeded')) { sessionStorage.setItem('replacement-seeded', '1'); localStorage.setItem(key, JSON.stringify({ version: 1, credentialId: 'a-credential', phase: 'activation', personalElizaId: 'personal-a', state: 'attempting' })); }
    const w = window as any, read = Storage.prototype.getItem; w.personalReads = [];
    Storage.prototype.getItem = function (name: string) { if (String(name).startsWith('alpha.cloud.personal-setup.v1:')) w.personalReads.push(name); return read.call(this, name); };
  }, PERSONAL_A);
  await residentHome(page);
  const ask = page.getByRole('textbox', { name: 'Ask Alpha', exact: true });
  await ask.fill('Asked while signed in as A'); await ask.press('Enter');
  await expect(bubble(page, 'Resident reply 1')).toHaveCount(1);
  let dialog = await cloudPlan(page);
  await expect(dialog.getByText(A.email, { exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await button(page, 'Inbox').click();
  // Inbox reads A's Gmail accounts with A's key (the account label is shown only beside a second account).
  await expect.poll(() => stub(page, s => s.cloud.filter((row: any) => row.path === '/api/v1/eliza/google/accounts' && row.auth === 'Bearer ' + 'account-a-key').length), { timeout: 30_000 }).toBeGreaterThan(0);

  // Sign out of A: the resident stops before A's key is revoked and removed.
  dialog = await cloudPlan(page);
  page.once('dialog', prompt => void prompt.accept());
  await dialog.getByRole('button', { name: 'Sign out', exact: true }).click();
  dialog=page.locator('[role="main"].alpha-cloud-sign-in');
  await expect(dialog.getByRole('button', { name: 'Email me a code', exact: true })).toBeEnabled({ timeout: 30_000 });
  const signOut = await stub(page, s => s.order.length) as number;
  // Sign in as B.
  await setStub(page, { nextToken: B.token });
  await enterNativeEmailCode(page);
  await expect(page.locator('[role="main"].alpha-cloud-sign-in')).toHaveCount(0, { timeout: 30_000 });
  await completeAccessSetup(page);

  const order = await stub(page, s => s.order) as string[];
  const stored = JSON.parse(await harness(page, f => f.slots['cloud:production']));
  expect(stored.token).toBe(B.token);
  const firstStart = order.indexOf('Agent.start'), lastStart = order.lastIndexOf('Agent.start');
  const removeA = order.indexOf('remove cloud key'), revokeA = order.indexOf('revoke Bearer ' + A.token), storeB = order.indexOf('store ' + B.token);
  // A's agent was stopped before A's key was revoked and removed, and before B's key was stored.
  expect(order.slice(firstStart, revokeA)).toContain('Agent.stop');
  expect(revokeA).toBeLessThan(removeA);
  expect(removeA).toBeLessThan(storeB);
  // P-43: after sign-out the resident runs with no provider, and it keeps running while the owner signs
  // in as B in the native form; it is stopped only after B's key is stored, then restarted bound to B.
  expect(order.slice(signOut, storeB)).not.toContain('Agent.stop');
  expect(order.slice(storeB, lastStart)).toContain('Agent.stop');
  // B's key binds the provider before the agent starts again, with B's plan read first.
  expect(order.indexOf('plan ' + B.email)).toBeGreaterThan(storeB);
  expect(order.indexOf('configureCloudProvider ' + stored.credentialId)).toBeGreaterThan(order.indexOf('plan ' + B.email));
  expect(lastStart).toBeGreaterThan(order.indexOf('configureCloudProvider ' + stored.credentialId));
  // A's key never binds the provider again, and was signed out once (sign-out, not the new sign-in).
  expect(order.filter(entry => entry.startsWith('revoke'))).toEqual(['revoke Bearer ' + A.token]);

  // Account copy, plan status and the connected Inbox account are B's (subscription-entitlement.ts).
  dialog = await cloudPlan(page);
  await expect(dialog.getByText(B.email, { exact: true })).toBeVisible();
  await expect(dialog.getByText(A.email, { exact: true })).toHaveCount(0);
  await expect(dialog).toContainText('Plus');
  await expect(dialog).not.toContainText(/Credits available|Add credits/);
  await dialog.getByRole('button', { name: 'Back to Settings', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await button(page, 'Inbox').click();
  await expect.poll(() => stub(page, s => s.cloud.filter((row: any) => row.path === '/api/v1/eliza/google/accounts' && row.auth === 'Bearer account-b-key').length), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(page.getByText(A.inbox!, { exact: false })).toHaveCount(0);
  // After A's sign-out, no Cloud request carried A's key, and A's personal-setup intent was neither
  // read nor removed; no digest delegation was asked for.
  const cloud = await stub(page, s => s.cloud) as Array<{ path: string; auth?: string }>;
  const afterSignOut = cloud.slice(cloud.findIndex(row => row.path === '/api/v1/api-keys/current') + 1);
  expect(afterSignOut.filter(row => row.auth === 'Bearer ' + A.token)).toEqual([]);
  expect(await page.evaluate(() => (window as any).personalReads)).toEqual([]);
  expect(await page.evaluate(key => localStorage.getItem(key), PERSONAL_A)).not.toBeNull();
  // Neither the native delegation callback, a Cloud delegation route, nor (via f.unexpected below) the
  // agent's cloud-delegation route was used.
  expect(await harness(page, f => f.calls.filter((call: string) => /Delegation/.test(call)))).toEqual([]);
  expect(cloud.filter(row => /delegation/i.test(row.path))).toEqual([]);
  expect(await page.locator('body').innerText()).not.toContain('personal-a');

  // Current behaviour: the resident's conversation lives on this phone under the local owner, not the
  // Cloud account, so B's session restores the conversation started under A.
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await button(page, 'Open conversation').click();
  await expect(bubble(page, 'Asked while signed in as A')).toHaveCount(1, { timeout: 30_000 });
  await expect(bubble(page, 'Resident reply 1')).toHaveCount(1);
  await expectNoDevelopmentSurface(page);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});

test('a second sign-in over a saved key uses the native replacement result without revoking the new key', async ({ page }) => {
  test.setTimeout(150_000);
  await fenceNetwork(page);
  await flagOffAndroid(page);
  await residentStub(page, { nativeSignIn:true, emptyKeystore: true, accounts: [A, B] });
  await page.goto('/');
  await setStub(page, { nextToken: A.token });
  // P-43: the resident starts signed out; sign-in is offered from Settings › Agent connection.
  await expect.poll(() => harness(page, f => f.calls.includes('Agent.start')), { timeout: 30_000 }).toBe(true);
  let welcome = await openYourAgent(page);
  await enterNativeEmailCode(page);
  await expect(page.locator('[role="main"].alpha-cloud-sign-in')).toHaveCount(0, { timeout: 30_000 });
  await completeAccessSetup(page);
  expect(await stub(page, s => s.order.filter((entry: string) => entry.startsWith('revoke')))).toEqual([]);
  // Eliza Cloud stops accepting A's key; the next start asks for a new sign-in.
  await page.evaluate(() => { const s = (window as any).residentStub; s.accounts[0].userStatus = 401; s.nextToken = 'account-b-key'; s.polls = 0; s.persist(); });
  await page.reload();
  // The resident starts again with AI off; Your agent says the saved sign-in is no longer valid.
  await expect.poll(() => harness(page, f => f.calls.includes('Agent.start')), { timeout: 30_000 }).toBe(true);
  welcome = await openYourAgent(page);
  await expect(welcome.getByText('Your Cloud sign-in has expired. Sign in with Cloud again.', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(welcome).not.toContainText(/pair/i);
  await enterNativeEmailCode(page);
  await expect(page.locator('[role="main"].alpha-cloud-sign-in')).toHaveCount(0, { timeout: 30_000 });
  await completeAccessSetup(page);
  const order = await stub(page, s => s.order) as string[];
  expect(order.filter(entry => entry.startsWith('revoke'))).toEqual(['revoke Bearer ' + A.token]);
  expect(order.indexOf('revoke Bearer ' + A.token)).toBeGreaterThan(order.indexOf('store ' + B.token));
  expect(order.filter(entry=>entry==='store '+B.token)).toHaveLength(1);
  expect(JSON.parse(await harness(page, f => f.slots['cloud:production'])).token).toBe(B.token);
});

// UI progress only: this feature fixture does not manufacture OS/provider grants.
test.beforeEach(async({page})=>seedCompletedAccessSetup(page));
