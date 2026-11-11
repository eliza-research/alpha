import {openRetainedDigests} from './helpers/retained-digests';
// Loop D on the FLAG-OFF bundle: reviewed digest schedules created, recovered, paused and revoked
// against the resident agent.
//
// The agent side is the opt-in `schedules` agent in test/browser/flag-off-android.ts: it keeps
// sources and loops with the pinned plugin-workflow's request keys, refusals and receipts, replays a
// receipt by mutationId and checks expectedVersionId on edits. It runs no schedule and no model.
// The renderer's hosted digest protocol, its pending-request slot (over the stubbed Keystore) and
// the panel are the shipped code.
//
// Evidence boundary: source/test evidence for the flag-off renderer with the Android bridge
// stubbed. It is not evidence for an installed APK, the resident runtime's scheduler, a model run,
// Android background delivery or a device, and no source or schedule here is real.
import { test, expect, type Page } from '@playwright/test';
import { flagOffAndroid, harness, button, fenceNetwork, expectNoDevelopmentSurface, residentHome } from './flag-off-android';

const SNAPSHOT = 'Pick up the parcel\nCall the plumber about the sink';
const panel = (page: Page) => page.getByRole('dialog', { name: 'Scheduled digests', exact: true });
const posts = (page: Page) => harness(page, f => f.digests.posts) as Promise<{ path: string; body: any }[]>;
const schedules = (page: Page) => panel(page).getByRole('region', { name: 'Digest schedules' }).getByRole('listitem');
async function confirmReview(page: Page, summary: string | RegExp) {
  const review = panel(page).locator('section', { has: page.getByRole('heading', { name: 'Review', exact: true }) });
  await expect(review).toContainText(summary);
  await review.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(panel(page).getByRole('heading', { name: 'Review', exact: true })).toHaveCount(0);
}

test('loop D on Android: a reviewed snapshot, morning and evening schedules, a lost acknowledgement retried exactly, pause and revoke', async ({ page }) => {
  test.setTimeout(180_000);
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page, { digests: 'native', schedules: { dropFirstAck: 'loops' } });
  await residentHome(page);
  await openRetainedDigests(page);
  const digests = panel(page);
  await expect(digests.getByRole('status')).toHaveText('Synced with this agent.');
  const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

  // 1. Review and confirm an expiring snapshot. Reviewing alone sends nothing.
  await digests.getByText('Share a snapshot', { exact: true }).click();
  await digests.getByRole('textbox', { name: 'Label', exact: true }).fill('Errands');
  await digests.getByRole('textbox', { name: 'Snapshot text', exact: true }).fill(SNAPSHOT);
  await digests.getByRole('spinbutton', { name: 'Expires after hours', exact: true }).fill('48');
  await button(page, 'Review snapshot').click();
  expect(await posts(page)).toEqual([]);
  await confirmReview(page, 'Share this tasks snapshot with the connected agent.');
  await expect.poll(() => posts(page)).toHaveLength(1);
  const [snapshot] = await posts(page);
  expect(snapshot.path).toBe('sources');
  expect(Object.keys(snapshot.body).sort()).toEqual(['confirmed', 'expiresAt', 'id', 'kind', 'label', 'observedAt', 'text']);
  expect(snapshot.body).toMatchObject({ kind: 'tasks', label: 'Errands', text: SNAPSHOT, confirmed: true });
  expect(Date.parse(snapshot.body.expiresAt) - Date.parse(snapshot.body.observedAt)).toBe(48 * 3_600_000);
  const source = await harness(page, f => f.digests.sources[0]) as { id: string; revision: string };
  expect(source.id).toBe(snapshot.body.id);

  // 2. Morning schedule: the agent applies it, but its acknowledgement is lost.
  await digests.getByRole('combobox', { name: 'Reviewed source', exact: true }).selectOption(source.id);
  await digests.getByLabel('Morning', { exact: true }).fill('07:30');
  await button(page, 'Review morning schedule').click();
  await confirmReview(page, `Runs daily at 07:30 (${zone}) and reads the Errands snapshot.`);
  await expect(digests.getByRole('status')).toHaveText('Save not confirmed. Retry.');
  const pendingSection = digests.locator('section', { has: page.getByRole('heading', { name: 'Unconfirmed save', exact: true }) });
  await expect(pendingSection).toContainText('Runs daily at 07:30');
  const morning = (await posts(page))[1];
  expect(morning).toEqual({ path: 'loops', body: { spec: { version: 1, template: 'morning', sourceId: source.id, sourceRevision: source.revision, timeZone: zone, localTime: '07:30', enabled: true }, mutationId: expect.stringMatching(/^[0-9a-f-]{36}$/), confirmed: true } });
  expect(await harness(page, f => [f.digests.dropped, f.digests.loops.length])).toEqual([['loops'], 1]);
  // Nothing else is offered until the saved request is resolved.
  await expect(button(page, 'Review evening schedule')).toHaveCount(0);
  // Retry sends the exact saved request; the agent replays the receipt it already issued.
  await pendingSection.getByRole('button', { name: 'Retry exact saved request', exact: true }).click();
  await expect(digests.getByRole('heading', { name: 'Unconfirmed save', exact: true })).toHaveCount(0);
  await expect(digests.getByRole('status')).toHaveText('Synced with this agent.');
  expect((await posts(page))[2]).toEqual(morning);
  expect(await harness(page, f => f.digests.loops.length)).toBe(1);
  expect(Object.keys(await harness(page, f => f.digests.receipts))).toEqual([morning.body.mutationId]);
  await expect(schedules(page)).toHaveText([`Morning at 07:30 (${zone}) · Errands · On`]);

  // 3. Evening schedule on the same source.
  await digests.getByLabel('Evening', { exact: true }).fill('19:15');
  await button(page, 'Review evening schedule').click();
  await confirmReview(page, `Runs daily at 19:15 (${zone}) and reads the Errands snapshot.`);
  await expect(schedules(page)).toHaveText([`Morning at 07:30 (${zone}) · Errands · On`, `Evening at 19:15 (${zone}) · Errands · On`]);
  expect((await posts(page))[3].body).toEqual({ spec: { version: 1, template: 'evening', sourceId: source.id, sourceRevision: source.revision, timeZone: zone, localTime: '19:15', enabled: true }, mutationId: expect.stringMatching(/^[0-9a-f-]{36}$/), confirmed: true });

  // 4. Pause the morning schedule: an edit of that exact version.
  const loop = await harness(page, f => f.digests.loops.find((row: any) => row.spec.template === 'morning')) as { id: string; versionId: string };
  await digests.getByRole('button', { name: 'Review pause', exact: true }).first().click();
  await confirmReview(page, `Pause the morning digest at 07:30 (${zone})?`);
  await expect(schedules(page)).toHaveText([`Morning at 07:30 (${zone}) · Errands · Paused`, `Evening at 19:15 (${zone}) · Errands · On`]);
  expect((await posts(page))[4].body).toEqual({ spec: { version: 1, template: 'morning', sourceId: source.id, sourceRevision: source.revision, timeZone: zone, localTime: '07:30', enabled: false }, mutationId: expect.stringMatching(/^[0-9a-f-]{36}$/), confirmed: true, id: loop.id, expectedVersionId: loop.versionId });

  // 5. Revoke the source: the running evening schedule reports the revoked source and pauses.
  await digests.getByRole('button', { name: 'Review revocation', exact: true }).click();
  await confirmReview(page, 'Revoke Errands? Future runs stop and saved results stay.');
  await expect(schedules(page)).toHaveText([`Morning at 07:30 (${zone}) · Errands · Paused`, `Evening at 19:15 (${zone}) · Errands · Source revoked — paused`]);
  expect((await posts(page))[5]).toEqual({ path: 'sources/revoke', body: { id: source.id, confirmed: true } });
  await expect(digests.getByRole('region', { name: 'Source renewal' })).toContainText('Errands: Source revoked. Its schedule is paused until you review a new source for it.');
  // A revoked source cannot be chosen again or renewed in place.
  await expect(digests.getByRole('combobox', { name: 'Reviewed source', exact: true }).locator('option')).toHaveText(['Choose source']);
  await expect(digests.getByRole('button', { name: 'Renew Errands', exact: true })).toHaveCount(0);

  expect((await posts(page)).map(post => post.path)).toEqual(['sources', 'loops', 'loops', 'loops', 'loops', 'sources/revoke']);
  // No development scheduler copy and no foreign request.
  await expect(digests.getByText(/Schedules run while this app is open|development reply/)).toHaveCount(0);
  await expectNoDevelopmentSurface(page);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});

test('loop D on Android: a schedule edit made against an older version is refused and nothing is changed', async ({ page }) => {
  test.setTimeout(120_000);
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page, { digests: 'native', schedules: {} });
  await residentHome(page);
  await openRetainedDigests(page);
  const digests = panel(page);
  await digests.getByText('Share a snapshot', { exact: true }).click();
  await digests.getByRole('textbox', { name: 'Snapshot text', exact: true }).fill(SNAPSHOT);
  await button(page, 'Review snapshot').click();
  await confirmReview(page, 'Share this tasks snapshot');
  const source = await harness(page, f => f.digests.sources[0].id) as string;
  await digests.getByRole('combobox', { name: 'Reviewed source', exact: true }).selectOption(source);
  await button(page, 'Review morning schedule').click();
  await confirmReview(page, 'Runs daily at 08:00');
  await expect(schedules(page)).toHaveCount(1);
  // The agent's loop changes after the panel read it (another device edited it).
  await button(page, 'Review pause').click();
  await page.evaluate(() => { const loop = (window as any).flagOff.digests.loops[0]; loop.versionId = 'changed-elsewhere'; });
  await digests.locator('section', { has: page.getByRole('heading', { name: 'Review', exact: true }) }).getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(digests.getByRole('status')).toHaveText('Save not confirmed. Retry.');
  expect(await harness(page, f => [f.digests.loops[0].spec.enabled, f.digests.loops[0].versionId])).toEqual([true, 'changed-elsewhere']);
  expect(Object.keys(await harness(page, f => f.digests.receipts))).toHaveLength(1);
  // The refused edit was sent once and applied nothing.
  expect((await posts(page)).map(post => post.path)).toEqual(['sources', 'loops', 'loops']);
  await expectNoDevelopmentSurface(page);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});
