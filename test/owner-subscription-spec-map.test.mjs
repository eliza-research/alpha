// The #659/#660 reviewer table parses spec source only; it runs no browser and is not a browser,
// APK, emulator, image or device result.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {entryOf, failingTitles, fixtureFacts, mapSpec, parseCases, predictedSurface, SPEC} from '../scripts/owner/subscription-spec-map.mjs';

const sample = [
 "test.describe('plan state',()=>{",
 " test('an active plan shows the panel',async({page})=>{",
 "  await boot(page,{...await entitlements(),plan:'active'});",
 "  await openAccountPlan(page);",
 " });",
 " for(const status of ['none'] as const)test(`a ${status} plan needs a plan`,async({page})=>{",
 "  await boot(page,{...await entitlements(),plan:status,cashBalance:5});await needsPlan(page);",
 " });",
 "});",
 "test.describe('explicit entry',()=>{",
 " async function notice(page:Page){",
 "  await boot(page,{plan:'none',holdProvider:false});",
 " }",
 " test('opens the field',async({page})=>{await notice(page);await expect(sheet(page)).toBeVisible();});",
 "});",
 "test('signed out',async({page})=>{await boot(page,{saved:false});await expect(signInPage(page)).toBeVisible();});",
].join('\n');

test('cases carry their line, describe, boot fixture and loop marker', () => {
 const cases = parseCases(sample);
 assert.deepEqual(cases.map(c => [c.line, c.describe, c.title, c.loop]), [
  [2, 'plan state', 'an active plan shows the panel', false],
  [6, 'plan state', 'a ${status} plan needs a plan', true],
  [14, 'explicit entry', 'opens the field', false],
  [16, '', 'signed out', false],
 ]);
 assert.equal(cases[0].boot, "{...await entitlements(),plan:'active'}");
 assert.equal(cases[2].boot, "{plan:'none',holdProvider:false}", 'a shared describe helper supplies the boot fixture');
});

test('fixture facts and expectations follow the helpers each case uses', () => {
 assert.deepEqual(fixtureFacts("{saved:false}").account, 'signed out');
 assert.deepEqual(fixtureFacts("{identity:'401'}").account, 'identity 401');
 assert.equal(fixtureFacts("{plan:'none',cashBalance:5}").cashBalance, 5);
 const rows = mapSpec(sample);
 assert.ok(rows[0].expects.some(item => item.includes('resident plan panel')));
 assert.ok(rows[1].expects.some(item => item.includes('Eliza Cloud plan notice')));
 assert.ok(rows[2].expects.some(item => item.includes('carrying the membership controls')));
 assert.ok(rows[3].expects.some(item => item.includes('sign-in page')));
 assert.ok(rows.every(row => row.flow.startsWith('resident')));
 assert.ok(rows.every(row => row.failed === null));
});

test('a list-reporter log marks failing cases by line', () => {
 const log = [
  '  ✓  1 [chromium] › test/browser/native-cloud-subscription.spec.ts:2:2 › plan state › an active plan shows the panel (1.2s)',
  '  ✘  2 [chromium] › test/browser/native-cloud-subscription.spec.ts:6:84 › plan state › a none plan needs a plan (31.0s)',
 ].join('\n');
 assert.deepEqual([...failingTitles(log)], ['6|a none plan needs a plan']);
 const rows = mapSpec(sample, log);
 assert.deepEqual(rows.map(row => row.failed?.length ?? null), [0, 1, 0, 0]);
});

test('the real spec parses into cases that all boot the resident flow', () => {
 const rows = mapSpec(fs.readFileSync(SPEC, 'utf8'));
 assert.ok(rows.length >= 30, `parsed ${rows.length} cases`);
 assert.ok(rows.every(row => row.flow.startsWith('resident')));
});

test('the cloud-account entry predicts the Membership & credits sheet for any signed-in balance', () => {
 // connection-ui.tsx: purpose 'cloud-account' has no residentCloudFlow() guard, so Settings >
 // Manage Cloud account, Inbox Connect, voice and cloud-voice.ts reach the sheet for a nonzero
 // balance too; only the plan entry depends on the zero-balance (fundingRequired) branch.
 assert.equal(entryOf("await page.getByRole('button',{name:'Manage Cloud account',exact:true}).click();"), 'cloud-account');
 assert.equal(entryOf('c.openCloudAccount();'), 'cloud-account');
 assert.equal(entryOf('await openAccountPlan(page);'), 'plan');
 assert.equal(entryOf('await openAccountPlan(page);c.openCloudAccount();'), 'both');
 assert.equal(entryOf('expect(1).toBe(1);'), 'none');
 const funded = fixtureFacts("{signed,plan:'none',cashBalance:5}");
 assert.match(predictedSurface(funded, 'cloud-account'), /Membership & credits.*any signed-in balance/);
 assert.match(predictedSurface(funded, 'plan'), /^resident dialog/);
 assert.match(predictedSurface(fixtureFacts('{saved:false}'), 'cloud-account'), /sign-in screen/);
 const rows = mapSpec("test('settings entry',async({page})=>{await boot(page,{signed});await page.getByRole('button',{name:'Manage Cloud account',exact:true}).click();});");
 assert.equal(rows[0].entry, 'cloud-account');
 assert.ok(rows[0].expects.some(item => item.includes('via the cloud-account entry')));
 assert.match(rows[0].surface, /Membership & credits/);
});
