/** Real production renderer in local Vite; no native/GPS/provider acceptance. */
import assert from 'node:assert/strict';
import type { ContextEnvelope } from '../apps/app/src/runtime/alpha-client.ts';
import { playwright } from './fixtures/playwright.ts';
const url = process.env.ALPHA_MAPS_TEST_URL || 'http://127.0.0.1:5188';
if (new URL(url).hostname !== '127.0.0.1') throw Error('Use a dedicated local Vite server.');
const { chromium } = playwright(import.meta.url);
const browser = await chromium.launch({ headless: true });
try {
 const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
 page.setDefaultTimeout(15000);
 await page.goto(url, { waitUntil: 'load' });
 await page.getByRole('button', { name: 'Maps', exact: true }).click();
 await page.waitForFunction(() => document.documentElement.dataset.activeView === 'maps');
 const input = page.getByRole('textbox', { name: 'Search places', exact: true });
 await input.fill('37.123456, -122.654321'); await input.press('Enter');
 await page.getByRole('button', { name: 'Rename place' }).waitFor();
 assert.equal(await page.getByRole('textbox', { name: 'Place name' }).count(), 0);
 const observation = () => page.evaluate(async () => {
  const { alphaClient } = await import('/src/runtime/alpha-client.ts');
  const { phoneContextMessage } = await import('/src/runtime/phone-context.ts');
  return phoneContextMessage('Help with this screen', alphaClient.getState().context);
 });
 const first = await observation();
 const selected = first.context.selectedObject;
 assert.ok(selected);
 assert.equal(selected.kind, 'map-place');
 assert.match(selected.id, /^maps_[a-f0-9-]{36}$/);
 assert.ok(!first.text.includes('37.123456') && !first.text.includes('-122.654321'));
 await page.getByRole('button', { name: 'Rename place' }).click();
 await page.getByRole('textbox', { name: 'Place name' }).fill('PRIVATE_LOCATION_LABEL_91732');
 await page.getByRole('button', { name: 'Apply place name' }).click();
 const renamed = await observation();
 const renamedPlace = renamed.context.selectedObject;
 assert.ok(renamedPlace);
 assert.equal(renamedPlace.id, selected.id);
 assert.notEqual(renamedPlace.revision, selected.revision);
 assert.ok(!renamed.text.includes('PRIVATE_LOCATION_LABEL_91732'));
 const rejection = (context: ContextEnvelope) => page.evaluate(async value => {
  const { sanitizePhoneContext } = await import('/src/runtime/phone-context.ts');
  try { sanitizePhoneContext(value); return false; } catch { return true; }
 }, context);
 assert.ok(await rejection(first.context), 'Old revision is rejected');
 assert.ok(await rejection({ ...renamed.context, selectedObject: { ...renamedPlace, id: '37.123456:-122.654321' } }), 'Geographic forged ID rejected');
 assert.ok(await rejection({ ...renamed.context, view: 'notes' }), 'Cross-view Maps context rejected');
 await page.getByRole('button', { name: 'Close place', exact: true }).click();
 assert.ok(await rejection(renamed.context), 'Closed place capability revoked');
 await input.fill('PRIVATE_SEARCH_81732');
 const searched = await observation();
 assert.equal(searched.context.selectedObject?.kind, 'map-search');
 assert.ok(!searched.text.includes('PRIVATE_SEARCH_81732'));
 await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
 await page.waitForFunction(() => document.documentElement.dataset.activeView === 'home');
 assert.ok(await rejection(searched.context), 'Leaving Maps revokes search capability');
 const home = await observation(); assert.equal(home.context.view, 'home'); assert.equal(home.context.selectedObject, undefined);
 console.log('PASS real renderer Maps selection/rename/search/leave; wire context contains opaque identity only; stale, forged and cross-view capabilities rejected. Native location/provider behavior not tested.');
} finally { await browser.close(); }
