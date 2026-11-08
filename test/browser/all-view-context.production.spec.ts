// Contract test on the flag-off Android renderer: every enabled view sends its own view id as the
// current-turn context, and no keystore value or fixture secret travels with a message. Password
// pages pause observation entirely, so nothing is sent from them.
//
// Evidence boundary: source/test evidence for the flag-off renderer only. The resident agent is
// the bridge stub (flag-off-android.ts, resident-stub.ts); this does not prove what a real agent or
// model does with the context, or any native view on a device.
import { test, expect, type Page } from '@playwright/test';
import { flagOffAndroid, harness, button, fenceNetwork, residentHome } from './flag-off-android';
import { residentStub, stub } from './resident-stub';

test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'production', 'Production bundle only'); });

const VIEWS = [
  { name: 'Home', view: 'home' }, { name: 'Inbox', view: 'inbox' }, { name: 'Calendar', view: 'calendar' }, { name: 'Browser', view: 'browser' },
  { name: 'Camera', view: 'camera' }, { name: 'Photos', view: 'photos' }, { name: 'Maps', view: 'maps' }, { name: 'Notes', view: 'notes' },
  { name: 'Files', view: 'files' }, { name: 'Workflows', view: 'workflows' }, { name: 'Settings', view: 'settings' },
] as const;
const composer = (page: Page) => page.locator('[data-alpha-layer="composer"][aria-hidden="false"], [data-alpha-layer="conversation"][aria-hidden="false"]').getByRole('textbox').first();
const home = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
/** Every value this phone keeps in its (stubbed) Keystore slots, and the stub's own secrets. */
async function secrets(page: Page) {
  const slots = await harness(page, f => Object.values(f.slots) as string[]);
  const values = new Set<string>(['synthetic-cloud-key', 'PRIVATE_PROVIDER_ERROR_CANARY']);
  for (const raw of slots) { try { for (const value of Object.values(JSON.parse(raw))) if (typeof value === 'string' && value.length >= 8) values.add(value); } catch { values.add(raw); } }
  return [...values];
}

test('each enabled view supplies its own context to the resident agent, and no secret is sent', async ({ page }) => {
  test.setTimeout(240_000);
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page);
  await residentStub(page);
  await residentHome(page);
  for (const [index, { name, view }] of VIEWS.entries()) {
    await home(page);
    if (view !== 'home') {
      await button(page, name).click();
      await expect(page.locator('html')).toHaveAttribute('data-active-view', view);
    }
    const text = `Context from ${name}`;
    // The camera viewfinder has no composer dock; the Android assist gesture opens the conversation over it.
    if (view === 'camera') await harness(page, f => f.emit('DailyApps', 'assistantInvoked'));
    else if (!await composer(page).isVisible()) await button(page, 'Open conversation').click();
    await composer(page).fill(text); await composer(page).press('Enter');
    await expect(page.getByRole('button', { name: `Message actions: Resident reply ${index + 1}`, exact: true })).toHaveCount(1, { timeout: 30_000 });
    const body = (await stub(page, s => s.bodies) as any[])[index];
    // The structured context names this view, unpaused. A product build sends the authored text
    // unchanged (no client-authored observation banner); the agent renders this metadata once.
    expect(body.metadata.clientDevice.context, name).toMatchObject({ view, sensitive: false });
    expect(String(body.text), name).toBe(text);
    const wire = JSON.stringify(body);
    for (const secret of await secrets(page)) expect(wire.includes(secret), `${name} carries a stored secret`).toBe(false);
  }
  expect(await harness(page, f => f.streams)).toBe(VIEWS.length);
  expect(foreign).toEqual([]);
});

test('the password manager pauses observation: a message there is not sent and carries no context', async ({ page }) => {
  test.setTimeout(120_000);
  await flagOffAndroid(page);
  await residentStub(page);
  await residentHome(page);
  await button(page, 'Settings').click();
  await page.getByRole('button', { name: 'Password manager', exact: true }).click();
  if (!await composer(page).isVisible()) await button(page, 'Open conversation').click();
  await composer(page).fill('Context from passwords'); await composer(page).press('Enter');
  await expect(page.getByText('Not sent. Agent observation is paused on this screen.', { exact: true }).first()).toBeVisible();
  await expect(composer(page)).toHaveValue('Context from passwords');
  expect(await harness(page, f => f.streams)).toBe(0);
  expect(await stub(page, s => s.bodies)).toEqual([]);
});

for (const repeatDays of [true, false]) {
  test(`a resident send advertises clock.handoff.v2 only when native Clock reports repeat days (${repeatDays ? 'reported' : 'not reported'})`, async ({ page }) => {
    test.setTimeout(90_000);
    await flagOffAndroid(page);
    await residentStub(page, { offered: ['clock.handoff.v1', 'clock.handoff.v2', 'notes.query.v1'], ...(repeatDays ? { clockRepeatDaysVersion: 1 } : {}) });
    await residentHome(page);
    const ask = page.getByRole('textbox', { name: 'Ask Alpha', exact: true });
    await ask.fill('Which alarms can you set?'); await ask.press('Enter');
    await expect(page.getByRole('button', { name: 'Message actions: Resident reply 1', exact: true })).toHaveCount(1);
    const advertised = (await stub(page, s => s.capabilities) as string).split(',');
    expect(advertised).toEqual(expect.arrayContaining(['calendar.local-event.v1', 'notes.local-record.v1', 'notes.query.v1', 'clock.handoff.v1']));
    expect(advertised.includes('clock.handoff.v2')).toBe(repeatDays);
    // Enrollment completed against the harness: no device route (such as the committed-enrollment
    // read) was refused, which would leave the send without any device capabilities.
    expect(await harness(page, f => f.unexpected)).toEqual([]);
  });
}
