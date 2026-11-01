// What the flag-off Android renderer says when a resident reply fails, when the phone loses its
// network, and when the native stream refuses, is rate-limited or drops; and what a restart during
// a held reply shows. None of these resends a message.
//
// Evidence boundary: source/test evidence for the flag-off renderer only. The Capacitor bridge is
// the stub in flag-off-android.ts plus resident-stub.ts; it is not the native Agent plugin, the
// resident runtime, Eliza Cloud, Cerebras or a device.
import { test, expect, type Page } from '@playwright/test';
import { flagOffAndroid, harness, button, fenceNetwork, expectNoDevelopmentSurface, residentHome } from './flag-off-android';
import { residentStub, stub, setStub } from './resident-stub';

test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'production', 'Production bundle only'); });

const id = '9f1dc45a-4011-4e44-947a-30d999d24fa5';
const owner = { token: 'synthetic-cloud-key', userId: id, email: 'owner@example.invalid', balance: 5 };
const composer = (page: Page) => page.locator('[data-alpha-layer="composer"][aria-hidden="false"], [data-alpha-layer="conversation"][aria-hidden="false"]').getByRole('textbox').first();
const conversation = (page: Page) => page.locator('[data-alpha-layer="conversation"]');
const bubble = (page: Page, text: string) => page.getByRole('button', { name: 'Message actions: ' + text, exact: true });
const UNKNOWN = 'Sorry, I couldn’t finish that reply.';
const NOT_SENT = 'Not sent. Your message is back in the composer.';

async function connected(page: Page, nativeSignIn = true) {
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page);
  await residentStub(page, { accounts: [owner], nativeSignIn });
  await residentHome(page);
  return foreign;
}
async function send(page: Page, text: string) { await composer(page).fill(text); await composer(page).press('Enter'); }

const KINDS = {
  // Cloud's billing refusal of a signed-in account: one answer naming both ways back (cloud-membership-ui.tsx).
  insufficient_credits: 'Eliza Cloud declined this AI request for your account’s billing. Check your subscription or enter a membership code, then send again. Nothing was retried or purchased.',
  provider_issue: 'Alpha’s AI service could not complete this reply. Nothing was resent.',
  generation_timeout: 'Alpha’s AI service could not complete this reply. Nothing was resent.',
  // Bound to an admitted plan, yet the agent ran without a provider: a recheck is offered.
  no_provider: 'Your agent answered without its AI connection. Check the connection again; nothing was retried.',
} as const;

for (const [kind, text] of Object.entries(KINDS)) for (const frame of ['done', 'error'] as const) {
  test(`a resident reply that fails with ${kind} (${frame} frame) says so, offers the next step and sends once`, async ({ page }, info) => {
    test.setTimeout(120_000);
    const foreign = await connected(page);
    await setStub(page, { stream: { failure: kind, frame } });
    if (kind === 'insufficient_credits') await stub(page, s => { s.accounts[0].balance = 0; s.accounts[0].plan = 'none'; s.persist(); });
    await send(page, `Failing ${kind}`);
    await expect(conversation(page).getByText(text, { exact: true })).toHaveCount(1);
    // Upstream's provider prose is never shown, and the agent's own outcome needs no history check.
    await expect(page.getByText(/PRIVATE_PROVIDER_ERROR_CANARY/)).toHaveCount(0);
    await expect(page.getByText(UNKNOWN, { exact: true })).toHaveCount(0);
    await expect(bubble(page, `Failing ${kind}`)).toHaveCount(1);
    if (kind === 'insufficient_credits') {
      // One answer in the chat, and Subscription opens with plan selection and code entry.
      // The backend's zero balance stays an admission fact; the UI never offers a cash top-up.
      const account = page.getByRole('dialog', { name: 'Subscription', exact: true });
      await expect(account).toBeVisible();
      const membership = account.getByRole('region', { name: 'Subscription', exact: true });
      await expect(membership).not.toContainText(/Available credits|Add credits|\$\d/);
      await expect(membership.getByRole('status').filter({ hasText: 'Eliza Cloud declined your last AI request for billing.' })).toHaveCount(1);
      await expect(membership.getByRole('button', { name: 'Choose a monthly plan', exact: true })).toBeVisible();
      await expect(membership.getByRole('button', { name: 'Enter membership code', exact: true })).toBeVisible();
      expect(await stub(page, s => s.opened)).toEqual([]);
      await account.getByRole('button', { name: 'Close membership settings', exact: true }).click();
      await expect(account).toHaveCount(0);
      await button(page, 'Expand chat').click();
      // No second billing message; the answer carries the one offer, which reopens the same popup.
      await expect(page.getByRole('button', { name: /^Manage billing in Eliza Cloud/ })).toHaveCount(0);
      const offer = page.getByRole('button', { name: /^Check subscription or enter a membership code/ });
      await expect(offer).toHaveCount(1);
      await offer.click();
      await expect(account).toBeVisible();
      await membership.getByRole('button', { name: 'Enter membership code', exact: true }).click();
      await expect(membership.getByRole('textbox', { name: 'Membership code' })).toBeVisible();
      await page.screenshot({path:info.outputPath('membership-code-mobile.png'),animations:'disabled'});
      await page.setViewportSize({width:1024,height:768});
      await expect(account.getByRole('textbox',{name:'Membership code'})).toBeVisible();
      await page.screenshot({path:info.outputPath('membership-code-wide.png'),animations:'disabled'});
      await page.setViewportSize({width:412,height:915});
      // Plan selection opens Cloud billing only after the account check; nothing is bought here.
      await membership.getByRole('button', { name: 'Choose a monthly plan', exact: true }).click();
      await expect(page.getByRole('heading',{name:'Check the billing account',exact:true})).toBeVisible();
      await expect(page.getByRole('button',{name:'Open billing',exact:true})).toBeDisabled();
      expect(await stub(page,s=>s.opened)).toEqual([]);
      await page.getByRole('checkbox',{name:'I’ll check the account before paying.',exact:true}).check();
      await page.getByRole('button',{name:'Open billing',exact:true}).click();
      await expect.poll(() => stub(page, s => s.opened)).toEqual(['https://cloud.eliza.app/cloud/billing']);
    } else {
      if (kind === 'no_provider') await expect(page.getByRole('button', { name: /^Check Eliza Cloud again/ })).toHaveCount(1);
      else await expect(page.getByRole('button', { name: /^(Manage (plan|billing)|Check Eliza Cloud again|Set up AI)/ })).toHaveCount(0);
      // Agent connection no longer says the agent is ready.
      await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
      await button(page, 'Settings').click();
      await page.getByRole('button', { name: 'Agent connection', exact: true }).click();
      await expect(page.getByRole('heading',{name:'Agent connection',exact:true})).toBeVisible();
      await expect(page.getByRole('region',{name:'Settings',exact:true})).not.toContainText('Connected');
    }
    // Exactly one stream request and no automatic resend of any kind.
    await page.waitForTimeout(1500);
    expect(await harness(page, f => f.streams)).toBe(1);
    expect(await stub(page, s => s.recoveries)).toEqual([]);
    expect(await harness(page, f => f.unexpected)).toEqual([]);
    await expectNoDevelopmentSurface(page);
    expect(foreign).toEqual([]);
  });
}

// The on-device agent runs without Eliza Cloud inference when the account has no plan (P-43). A chat
// turn gets the agent's honest answer in the conversation with the plan actions, never "Set up AI".
for (const frame of ['done', 'error'] as const) test(`a provider-less turn without a plan (${frame} frame) answers honestly and offers Redeem code or choose a plan`, async ({ page }) => {
  test.setTimeout(120_000);
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page);
  await residentStub(page, { accounts: [{ ...owner, plan: 'none' }] });
  await residentHome(page);
  // No plan is a notice beside the running agent, not a gate.
  await expect(page.getByRole('region', { name: 'Eliza Cloud plan notice' })).toContainText('AI replies aren’t available right now');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await harness(page, f => f.calls.filter((call: string) => call === 'Agent.start').length)).toBeGreaterThan(0);
  expect(await stub(page, s => s.order.filter((entry: string) => entry.startsWith('configureCloudProvider')))).toEqual([]);
  await setStub(page, { stream: { failure: 'no_provider', frame } });
  await send(page, 'Asked without a plan');
  await expect(conversation(page).getByText(/^I'm running on this device, but AI replies aren’t available right now\./)).toHaveCount(1);
  await expect(page.getByText(/Set up AI/)).toHaveCount(0);
  await expect(page.getByText(/PRIVATE_PROVIDER_ERROR_CANARY/)).toHaveCount(0);
  const plan = page.getByRole('button', { name: /^Redeem code or choose a plan/ });
  await expect(plan).toHaveCount(1);
  await plan.click();
  // On the phone's own agent the plan action opens the resident account & plan panel (plan headline,
  // Check plan again, Approve this phone again); it carries the Subscription controls.
  const account = page.getByRole('dialog', { name: 'Eliza Cloud account & plan', exact: true });
  await expect(account).toBeVisible();
  await expect(account.getByRole('region', { name: 'Subscription', exact: true })).toBeVisible();
  // Nothing was purchased or opened, and the message was sent once.
  expect(await stub(page, s => s.opened)).toEqual([]);
  expect(await harness(page, f => f.streams)).toBe(1);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});

test('without a network the resident says AI needs a connection, sends nothing, and clears the notice when back online', async ({ page, context }) => {
  test.setTimeout(120_000);
  await connected(page);
  const notice = page.getByText('Your agent is running; AI needs a connection. Nothing is sent until this phone is back online.', { exact: true });
  await expect(notice).toHaveCount(0);
  await context.setOffline(true);
  await expect(notice).toBeVisible();
  await send(page, 'Sent while offline');
  await expect(page.getByText(NOT_SENT, { exact: true }).first()).toBeVisible();
  await expect(composer(page)).toHaveValue('Sent while offline');
  expect(await harness(page, f => f.streams)).toBe(0);
  // Local apps keep working: Notes opens and the notice stays beside the composer.
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await button(page, 'Notes').click();
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'notes');
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  // Readiness is retracted while offline.
  await button(page, 'Settings').click();
  await page.getByRole('button', { name: 'Agent connection', exact: true }).click();
  await expect(page.getByRole('region',{name:'Settings',exact:true})).not.toContainText('Connected');
  await page.getByRole('button', { name: 'Back to Settings', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await context.setOffline(false);
  await expect(notice).toHaveCount(0);
  // Only the owner's own Send posts it, once.
  await composer(page).fill('Sent when back online'); await composer(page).press('Enter');
  await expect(bubble(page, 'Resident reply 1')).toHaveCount(1);
  expect(await harness(page, f => f.posts)).toHaveLength(1);
});

for (const mode of ['reject', 'busy'] as const) {
  test(`a resident stream ${mode === 'reject' ? 'refused by native IPC' : 'refused with HTTP 429'} keeps the text, and a second Send posts once`, async ({ page }) => {
    test.setTimeout(120_000);
    await connected(page);
    await setStub(page, { stream: mode });
    await send(page, `Refused by ${mode}`);
    await expect(page.getByText(mode === 'busy' ? 'Not sent. The agent is busy and did not accept this message. Wait, then send it again.' : NOT_SENT, { exact: true }).first()).toBeVisible();
    await expect(composer(page)).toHaveValue(`Refused by ${mode}`);
    await expect(bubble(page, `Refused by ${mode}`)).toHaveCount(0);
    await expect(page.getByText(UNKNOWN, { exact: true })).toHaveCount(0);
    expect(await harness(page, f => ({ streams: f.streams, posts: f.posts.length }))).toEqual({ streams: 1, posts: 0 });
    await stub(page, s => { s.stream = null; });
    await composer(page).press('Enter');
    await expect(bubble(page, 'Resident reply 2')).toHaveCount(1);
    await expect(bubble(page, `Refused by ${mode}`)).toHaveCount(1);
    expect(await harness(page, f => f.posts)).toHaveLength(1);
    expect(await stub(page, s => s.recoveries)).toEqual([]);
    expect(await harness(page, f => f.unexpected)).toEqual([]);
  });
}

test('a resident stream that fails after the turn was recorded says the reply could not finish, never resends, and a restart shows the turn once', async ({ page }) => {
  test.setTimeout(150_000);
  await connected(page);
  await stub(page, s => { s.stream = 'drop'; });
  await send(page, 'Dropped after recording');
  await expect(page.getByText(UNKNOWN, { exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Check saved conversation/ })).toHaveCount(0);
  await expect(composer(page)).toHaveValue('');
  // The one re-read of a dropped stream reuses the same clientMessageId; nothing new is posted.
  const [body] = await stub(page, s => s.bodies);
  expect(await stub(page, s => s.recoveries)).toEqual([body.clientMessageId]);
  await page.waitForTimeout(1500);
  expect(await harness(page, f => f.streams)).toBe(1);
  await page.reload();
  await expect.poll(() => harness(page, f => f.calls.includes('Agent.start')), { timeout: 30_000 }).toBe(true);
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0, { timeout: 30_000 });
  await button(page, 'Open conversation').click();
  await expect(bubble(page, 'Dropped after recording')).toHaveCount(1, { timeout: 30_000 });
  expect(await harness(page, f => f.streams)).toBe(0);
});

test('a restart while the resident holds a reply posts nothing and shows the user turn and the reply once', async ({ page }) => {
  test.setTimeout(150_000);
  await connected(page);
  await stub(page, s => { s.stream = 'hold'; });
  await send(page, 'Held across a restart');
  await expect(bubble(page, 'Held across a restart')).toHaveCount(1);
  await expect.poll(() => stub(page, s => !!s.held)).toBe(true);
  await page.reload();
  await expect.poll(() => harness(page, f => f.calls.includes('Agent.start')), { timeout: 30_000 }).toBe(true);
  await expect(page.locator('.alpha-connection-scrim')).toHaveCount(0, { timeout: 30_000 });
  await button(page, 'Open conversation').click();
  await expect(bubble(page, 'Held across a restart')).toHaveCount(1, { timeout: 30_000 });
  // The restored chat says it will check once; the agent finishes after the restart.
  await expect(conversation(page).getByText('The agent may still finish this reply. Alpha Phone will check once and show it here if it does.', { exact: true })).toHaveCount(1);
  await stub(page, s => s.finishHeld());
  await expect(bubble(page, 'Held reply 1')).toHaveCount(1, { timeout: 60_000 });
  await expect(bubble(page, 'Held across a restart')).toHaveCount(1);
  expect(await harness(page, f => f.streams)).toBe(0);
  expect(await stub(page, s => s.recoveries)).toEqual([]);
});

test('a resident send the runtime no longer accepts (401) asks for an Eliza Cloud sign-in, never pairing', async ({ page }) => {
  test.setTimeout(120_000);
  await connected(page, true);
  await setStub(page, { stream: 'expired' });
  await send(page, 'Sent with an expired session');
  const dialog = page.getByRole('main',{name:'Welcome to Alpha.',exact:true});
  await expect(dialog.getByRole('alert')).toHaveText('Your Cloud sign-in has expired. Sign in with Cloud again.', { timeout: 30_000 });
  await expect(dialog.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Email me a code', exact: true })).toBeEnabled();
  expect(await harness(page, f => ({ streams: f.streams, posts: f.posts.length }))).toEqual({ streams: 1, posts: 0 });
  await expect(page.locator('body')).not.toContainText(/pair/i);
  expect(await stub(page, s => s.recoveries)).toEqual([]);
});
