// Production (flag-off) renderer: Clock repeat days reach DailyApps.clockHandoff only when the
// native surface reports clockRepeatDaysVersion >= 1. Otherwise no day chips are rendered and a
// reviewed request never carries days.
//
// Evidence boundary: the flag-off renderer over the stubbed Capacitor bridge in flag-off-android.ts,
// with DailyApps.clockHandoff and the surfaceInfo flag added at the same test boundary. It is not
// the native DailyApps plugin, Android's AlarmClock intent or an installed Clock app: no alarm is
// created and nothing proves Clock honours EXTRA_DAYS.
import { test, expect, type Page } from '@playwright/test';
import { flagOffAndroid, harness, button, fenceNetwork, expectNoDevelopmentSurface, residentHome } from './flag-off-android';

/** Adds DailyApps.clockHandoff (recorded, reports 'opened') and the repeat-days surface flag. */
async function clockBridge(page: Page, repeatDaysVersion: number | null) {
  await page.addInitScript((version) => {
    const w = window as any, capacitor = w.Capacitor, original = capacitor.nativePromise;
    const daily = capacitor.PluginHeaders.find((plugin: any) => plugin.name === 'DailyApps');
    daily.methods.push({ name: 'clockHandoff', rtype: 'promise' });
    capacitor.nativePromise = async (plugin: string, method: string, input: any) => {
      if (plugin === 'DailyApps' && method === 'surfaceInfo') { w.flagOff.calls.push('DailyApps.surfaceInfo'); return { developmentBuild: false, assistant: false, ...(version === null ? {} : { clockRepeatDaysVersion: version }) }; }
      if (plugin === 'DailyApps' && method === 'clockHandoff') { w.flagOff.calls.push('DailyApps.clockHandoff'); (w.clockHandoffs ??= []).push(structuredClone(input)); return { action: input.action, status: 'opened', message: 'Approved Clock handoff sent. Check Clock; Alpha cannot confirm an alarm was changed.' }; }
      return original(plugin, method, input);
    };
  }, repeatDaysVersion);
}
const handoffs = (page: Page) => page.evaluate(() => (window as any).clockHandoffs ?? []) as Promise<Array<Record<string, unknown>>>;
async function openClock(page: Page) {
  await residentHome(page);
  await button(page, 'Calendar').click();
  await button(page, 'Clock alarms').click();
  return page.getByRole('dialog', { name: 'Clock alarms', exact: true });
}
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

for (const version of [1, 2]) test(`clockRepeatDaysVersion ${version}: Mon to Fri is reviewed as repeating weekdays and sent as one handoff with days [2,3,4,5,6]`, async ({ page }) => {
  test.setTimeout(120_000);
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page);await clockBridge(page, version);
  const clock = await openClock(page);
  const repeat = clock.getByRole('group', { name: 'Repeat', exact: true });
  for (const day of [...weekdays, 'Sat', 'Sun']) await expect(repeat.getByRole('button', { name: day, exact: true })).toHaveAttribute('aria-pressed', 'false');
  await clock.getByLabel('Alarm time', { exact: true }).fill('06:30');
  await clock.getByRole('textbox', { name: 'Alarm label' }).fill('Weekday wake');
  // Chosen out of order; the request is still the ascending Calendar values.
  for (const day of ['Fri', 'Mon', 'Wed', 'Tue', 'Thu']) await repeat.getByRole('button', { name: day, exact: true }).click();
  for (const day of weekdays) await expect(repeat.getByRole('button', { name: day, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await clock.getByRole('button', { name: 'Review Clock request', exact: true }).click();
  await expect(clock).toContainText('Ask Clock to set a repeating alarm (weekdays) at 06:30 named “Weekday wake”, using the phone’s local time. Review the alarm in Clock.');
  expect(await handoffs(page)).toEqual([]);
  await clock.getByRole('button', { name: 'Confirm Clock request', exact: true }).dblclick();
  await expect(clock).toContainText('Approved Clock handoff sent. Check Clock; Alpha cannot confirm an alarm was changed.');
  const sent = await handoffs(page);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ action: 'set', hour: 6, minute: 30, label: 'Weekday wake', reviewed: true, days: [2, 3, 4, 5, 6] });
  await expect(clock).not.toContainText(/Alarm saved|will ring|Ringing/);
  await expectNoDevelopmentSurface(page);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});

test('without clockRepeatDaysVersion there are no day chips and a set request carries no days', async ({ page }) => {
  test.setTimeout(120_000);
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page);await clockBridge(page, null);
  const clock = await openClock(page);
  await expect.poll(() => harness(page, f => f.calls.includes('DailyApps.surfaceInfo'))).toBe(true);
  await expect(clock.getByRole('group', { name: 'Repeat', exact: true })).toHaveCount(0);
  for (const day of [...weekdays, 'Sat', 'Sun']) await expect(clock.getByRole('button', { name: day, exact: true })).toHaveCount(0);
  await clock.getByLabel('Alarm time', { exact: true }).fill('06:30');
  await clock.getByRole('button', { name: 'Review Clock request', exact: true }).click();
  await expect(clock).toContainText('Ask Clock to set an alarm at 06:30, using the phone’s local time.');
  await expect(clock).not.toContainText('repeating');
  await clock.getByRole('button', { name: 'Confirm Clock request', exact: true }).click();
  await expect.poll(() => handoffs(page).then(rows => rows.length)).toBe(1);
  const [request] = await handoffs(page);
  expect(request).toMatchObject({ action: 'set', hour: 6, minute: 30, reviewed: true });
  expect('days' in request).toBe(false);
  // Show alarms is its own reviewed handoff.
  await clock.getByRole('button', { name: 'Show alarms', exact: true }).click();
  await clock.getByRole('button', { name: 'Review Clock request', exact: true }).click();
  await expect(clock).toContainText('Open the installed Clock app’s alarms page.');
  await clock.getByRole('button', { name: 'Confirm Clock request', exact: true }).click();
  await expect.poll(() => handoffs(page).then(rows => rows.length)).toBe(2);
  expect((await handoffs(page))[1]).toEqual({ action: 'show', reviewed: true });
  await expectNoDevelopmentSurface(page);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});
