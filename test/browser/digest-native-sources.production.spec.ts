// Loop D phone sources on the FLAG-OFF bundle: reviewed consent for calendars and reminders read on
// this phone, schedules bound to that consent, its renewal notice, the Renew tap, revocation, the
// evening gate and the on-demand brief review.
//
// The Android side is the stubbed bridge in test/browser/flag-off-android.ts: AlphaHostedResults
// records each consent and renewal-notice call, AlphaCalendar lists workflow calendars, and the
// opt-in `schedules` agent keeps sources and loops with the pinned plugin-workflow's rules. The
// panel, its review copy and the renderer's protocol are the shipped code.
//
// Evidence boundary: source/test evidence for the flag-off renderer with the Android bridge
// stubbed. It is not evidence for an installed APK, Android CalendarProvider or reminders, the
// native consent store, an alarm-delivered renewal notice, the resident runtime's scheduler or a
// model run, and no calendar, consent or schedule here is real.
import { test, expect, type Page } from '@playwright/test';
import { flagOffAndroid, harness, button, fenceNetwork, expectNoDevelopmentSurface, residentHome } from './flag-off-android';

const calendars = Array.from({ length: 17 }, (_, index) => ({ id: String(index + 1), name: index ? `Shared ${index}` : 'Personal', account: 'owner@example.invalid' }));
const panel = (page: Page) => page.getByRole('dialog', { name: 'Scheduled digests', exact: true });
const posts = (page: Page) => harness(page, f => f.digests.posts) as Promise<{ path: string; body: any }[]>;
const schedules = (page: Page) => panel(page).getByRole('region', { name: 'Digest schedules' }).getByRole('listitem');
const reviewSection = (page: Page) => panel(page).locator('section', { has: page.getByRole('heading', { name: 'Review', exact: true }) });
const calendar = (page: Page, name: string) => panel(page).getByRole('checkbox', { name: `${name} · owner@example.invalid`, exact: true });

async function openDigests(page: Page) {
  await residentHome(page);
  await button(page, 'Settings').click();
  await button(page, 'Scheduled digests').click();
  await expect(panel(page).getByRole('status')).toHaveText('Synced with this agent.');
}
/** Selected phone sources > Choose calendars > Personal (+ reminders) > Review source consent. */
async function reviewConsent(page: Page, hours = '48', reminders = true) {
  const digests = panel(page);
  await button(page, 'Choose calendars').click();
  await calendar(page, 'Personal').check();
  if (reminders) await digests.getByRole('checkbox', { name: 'Open phone reminders due today and overdue', exact: true }).check();
  await digests.getByRole('spinbutton', { name: 'Consent expires in hours', exact: true }).fill(hours);
  await digests.getByRole('button', { name: /^Review (source consent|renewal)$/ }).click();
}

test('phone sources on Android: reviewed consent within the calendar and expiry bounds, a bound schedule arms renewal, a Renew tap rebinds it, and revocation clears it', async ({ page }) => {
  test.setTimeout(180_000);
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page, { digests: 'native', schedules: { native: { calendars } } });
  await openDigests(page);
  const digests = panel(page), zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  await digests.getByText('Selected phone sources', { exact: true }).click();
  await expect(digests).toContainText('Choose Calendar sources and reminders for morning and evening briefs or an on-demand brief.');
  await button(page, 'Choose calendars').click();
  await expect(digests.getByRole('checkbox', { name: / · owner@example\.invalid$/ })).toHaveCount(17);

  // The reviewed scope is bounded: at most 16 calendars and an expiry of 1 to 168 hours.
  for (const row of calendars) await calendar(page, row.name).check();
  await button(page, 'Review source consent').click();
  await expect(digests.getByRole('status')).toHaveText('Choose at most 16 calendars for this source.');
  for (const row of calendars.slice(1)) await calendar(page, row.name).uncheck();
  for (const hours of ['0', '169']) {
    await digests.getByRole('spinbutton', { name: 'Consent expires in hours', exact: true }).fill(hours);
    await button(page, 'Review source consent').click();
    await expect(digests.getByRole('status')).toHaveText('Choose a valid time zone and expiry from 1 to 168 hours (7 days).');
  }
  await expect(digests.getByRole('heading', { name: 'Review', exact: true })).toHaveCount(0);
  await digests.getByRole('checkbox', { name: 'Open phone reminders due today and overdue', exact: true }).check();
  await digests.getByRole('spinbutton', { name: 'Consent expires in hours', exact: true }).fill('48');
  await button(page, 'Review source consent').click();
  const review = reviewSection(page);
  await expect(review).toContainText('Allow Alpha to read the selected sources on this phone until');
  await expect(review).toContainText('Calendars: Personal (owner@example.invalid). Reminders: open reminders due today and overdue; evening briefs also list reminders completed today.');
  await expect(review).toContainText(`It reads only event titles and times for the day in ${zone}, plus selected reminders’ titles, due times and status, up to 200 items. Descriptions, attendees, locations and reminder bodies are excluded.`);
  await expect(review).toContainText('Schedules pause when this source expires; renew or revoke it here.');
  await expect(review).toContainText('It can’t send email, read your inbox or act on your phone. Model usage counts against your');
  // Reviewing records no consent and saves no source.
  expect(await harness(page, f => [f.digests.consents.length, f.digests.posts.length])).toEqual([0, 0]);

  // Confirm: Android records the consent first, then the agent saves the source bound to it.
  await review.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(digests.getByRole('heading', { name: 'Review', exact: true })).toHaveCount(0);
  await expect.poll(() => posts(page)).toHaveLength(1);
  const [consent] = await harness(page, f => f.digests.consents) as any[];
  const enrollment = await harness(page, f => ({ provider: 'native', ownerId: '9f1dc45a-4011-4e44-947a-30d999d24fa5', agentId: '6f1d3c3e-8c55-4c1b-9d1f-2b6f0b0d3a11', installationId: f.installationId, enrollmentId: 'fixture-enrollment' }));
  expect(consent).toMatchObject({ confirmed: true, expectedBinding: enrollment, scope: { calendars: [{ id: '1', revision: 'cal-rev-1' }], reminders: true, timeZone: zone, window: 'owner_day_and_overdue_reminders', maximumItems: 200, modelEgress: true } });
  const [saved] = await posts(page);
  expect(saved.path).toBe('sources');
  expect(saved.body).toEqual({ id: consent.sourceId, kind: 'tasks', label: 'Phone sources', observedAt: expect.any(String), expiresAt: new Date(consent.expiresAt).toISOString(), confirmed: true, live: { ...enrollment, sourceId: consent.sourceId, revision: expect.stringMatching(/^[a-f0-9]{64}$/) } });
  expect(Date.parse(saved.body.expiresAt) - Date.parse(saved.body.observedAt)).toBe(48 * 3_600_000);
  await expect(digests.getByRole('combobox', { name: 'Reviewed source', exact: true })).toHaveValue(consent.sourceId);
  // An unbound source arms no renewal notice.
  expect(await harness(page, f => f.digests.renewals.filter((row: string) => row.startsWith('arm:')))).toEqual([]);

  // A morning schedule bound to the phone source arms its renewal notice.
  await button(page, 'Review morning schedule').click();
  await expect(reviewSection(page)).toContainText(`Runs daily at 08:00 (${zone}) and reads Phone sources.`);
  await expect(reviewSection(page)).toContainText('Your agent’s AI gets that data.');
  await reviewSection(page).getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(schedules(page)).toHaveText([`Morning at 08:00 (${zone}) · Phone sources · On`]);
  await expect.poll(() => harness(page, f => f.digests.renewals.includes('arm:' + f.digests.sources[0].id))).toBe(true);
  const first = await harness(page, f => ({ source: f.digests.sources[0], loop: f.digests.loops[0] })) as any;

  // The Renew tap opens the panel at that source's renewal; nothing is renewed by the tap.
  await button(page, 'Close scheduled digests').click();
  await expect(digests).toHaveCount(0);
  await page.evaluate(id => { const f = (window as any).flagOff; f.digests.pendingRenewal = id; f.emit('AlphaHostedResults', 'renewSource'); }, first.source.id);
  // The panel opens on the phone-source selection in renewal mode. (Its 'Renew Phone sources: …'
  // message is replaced by the sync status the opening refresh writes, so the mode is read from the
  // review button instead.)
  await expect(digests).toBeVisible();
  await expect(button(page, 'Review renewal')).toBeVisible();
  await expect(button(page, 'Review source consent')).toHaveCount(0);
  expect(await harness(page, f => [f.digests.consents.length, f.digests.posts.length])).toEqual([1, 2]);
  await reviewConsent(page, '72');
  await expect(reviewSection(page)).toContainText('Renewal: morning at 08:00 moves to this source when you confirm.');
  await reviewSection(page).getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(digests.getByRole('heading', { name: 'Review', exact: true })).toHaveCount(0);
  await expect.poll(() => posts(page)).toHaveLength(4);
  const [, , renewed, rebound] = await posts(page);
  expect(renewed.path).toBe('sources');
  expect(renewed.body.id).not.toBe(first.source.id);
  const second = await harness(page, f => f.digests.sources[1]) as any;
  // The bound loop moves to the new source's exact revision, as an edit of the version it had.
  expect(rebound).toEqual({ path: 'loops', body: { spec: { version: 1, template: 'morning', timeZone: zone, localTime: '08:00', enabled: true, sourceId: second.id, sourceRevision: second.revision }, mutationId: expect.stringMatching(/^[0-9a-f-]{36}$/), confirmed: true, id: first.loop.id, expectedVersionId: first.loop.versionId } });
  await expect.poll(() => harness(page, f => f.digests.renewals)).toContain('clear:' + first.source.id);
  await expect.poll(() => harness(page, f => f.digests.renewals.includes('arm:' + f.digests.sources[1].id))).toBe(true);
  await expect(schedules(page)).toHaveText([`Morning at 08:00 (${zone}) · Phone sources · On`]);

  // Revoking the phone source revokes Android's consent, then the agent's source, and clears its notice.
  await digests.getByRole('button', { name: 'Review revocation', exact: true }).nth(1).click();
  await expect(reviewSection(page)).toContainText('Revoke Phone sources for future runs.');
  await reviewSection(page).getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(schedules(page)).toHaveText([`Morning at 08:00 (${zone}) · Phone sources · Source revoked — paused`]);
  const consents = await harness(page, f => f.digests.consents) as any[];
  expect(consents.at(-1)).toMatchObject({ sourceId: second.id, revoke: true, confirmed: true, expectedBinding: second.live });
  expect((await posts(page)).at(-1)).toEqual({ path: 'sources/revoke', body: { id: second.id, confirmed: true } });
  await expect.poll(() => harness(page, f => f.digests.renewals.at(-1))).toBe('clear:' + second.id);
  await expectNoDevelopmentSurface(page);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});

test('phone sources on an older agent without the evening advertisement: only a morning brief is offered', async ({ page }) => {
  test.setTimeout(120_000);
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page, { digests: 'native', schedules: { native: { olderAgent: true, calendars: calendars.slice(0, 2) } } });
  await openDigests(page);
  const digests = panel(page);
  await digests.getByText('Selected phone sources', { exact: true }).click();
  await expect(digests).toContainText('Choose Calendar sources and reminders for a morning brief or an on-demand brief.');
  await reviewConsent(page, '24', false);
  await expect(reviewSection(page)).toContainText('Reminders: excluded.');
  await expect(reviewSection(page)).not.toContainText('evening briefs');
  await reviewSection(page).getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect.poll(() => posts(page)).toHaveLength(1);
  const source = await harness(page, f => f.digests.sources[0]) as any;
  await expect(digests.getByRole('combobox', { name: 'Reviewed source', exact: true })).toHaveValue(source.id);
  // No evening control for a phone source on an agent that does not advertise phone-source evenings.
  await expect(button(page, 'Review morning schedule')).toBeVisible();
  await expect(button(page, 'Review evening schedule')).toHaveCount(0);
  await expect(digests.getByLabel('Evening', { exact: true })).toHaveCount(0);
  await expectNoDevelopmentSurface(page);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});

test('phone sources on Android: the on-demand brief is reviewed, Cancel dispatches nothing and Confirm dispatches once', async ({ page }) => {
  test.setTimeout(120_000);
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page, { digests: 'native', schedules: { native: { calendars: calendars.slice(0, 2) } } });
  await openDigests(page);
  const digests = panel(page);
  await digests.getByText('Selected phone sources', { exact: true }).click();
  await reviewConsent(page, '24', false);
  await reviewSection(page).getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect.poll(() => posts(page)).toHaveLength(1);
  const source = await harness(page, f => f.digests.sources[0]) as any;
  await expect(digests.getByRole('combobox', { name: 'Reviewed source', exact: true })).toHaveValue(source.id);

  // The on-demand brief is reviewed first; Cancel sends nothing.
  await button(page, 'Review on-demand brief').click();
  await expect(reviewSection(page)).toContainText('Prepare a brief now from Phone sources? This sends one read of these sources to your agent’s AI. It creates no schedule.');
  await reviewSection(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(digests.getByRole('heading', { name: 'Review', exact: true })).toHaveCount(0);
  expect(await harness(page, f => [f.digests.dossiers.length, f.digests.posts.map((post: any) => post.path)])).toEqual([0, ['sources']]);
  // Confirmed, it is exactly one dispatch bound to the source's revision.
  await button(page, 'Review on-demand brief').click();
  await reviewSection(page).getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect.poll(() => harness(page, f => f.digests.dossiers.length)).toBe(1);
  expect(await harness(page, f => f.digests.dossiers[0])).toEqual({ sourceId: source.id, sourceRevision: source.revision, mutationId: expect.stringMatching(/^[0-9a-f-]{36}$/), confirmed: true });
  await expectNoDevelopmentSurface(page);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});
