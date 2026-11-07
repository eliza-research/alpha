import {openBrowserCalendar} from './helpers/browser-calendar';
// Journey J04: Schedule -> travel, driven through rendered controls in the browser build
// (development profile with the development device controls, /?mode=dev&tools=1).
//
// Evidence boundary: a pass is source/test evidence for the browser renderer only. It is NOT
// APK, emulator, AOSP image, physical-device or real-integration evidence.
//
// Synthetic fixtures:
// - The Maps provider (place search, place detail, routing) is an external boundary. It is
//   replaced with configureMapsProvider(), the same hook calendar-maps-handoff.spec.ts uses.
//   The fixture logs every search and route request to a test-owned localStorage key so the
//   exactly-once assertions survive reloads. No map tiles, geocoder or router is contacted.
// - "Device controls -> Back" is the development stand-in for the Android system Back gesture.
// - Events live in the development browser calendar, an explicit test-mocks Calendar source
//   (openBrowserCalendar); Agent Calendar is not involved.
//
// Native-only steps (not provable here; the honest browser state is asserted where one exists):
// - Device location as a route origin and turn-by-turn "Start": the browser build reports that
//   location permission was not granted and offers a manual origin.
// - Map rendering, GPS, background navigation and voice guidance.
// - Android system Back itself; hand-off to another installed maps application.
//
// Maps offers an explicit "Back to event" control when it was opened from an event's location; it
// returns to that exact event and never replays the hand-off. System Back still works as before.
import {test, expect, type Page} from '@playwright/test';

const address = '12 Market Street, Test Town';
const LOG = 'journey-j04-maps';
const button = (page: Page, name: string) => page.getByRole('button', {name, exact: true});

/** Synthetic Maps provider; module state is lost on reload so it is installed after every load. */
async function installMaps(page: Page) {
  await page.evaluate(async ({address, LOG}) => {
    const log = (kind: 'queries' | 'routes', value: unknown) => { const v = JSON.parse(localStorage.getItem(LOG) || '{"queries":[],"routes":[]}'); v[kind].push(value); localStorage.setItem(LOG, JSON.stringify(v)); };
    const {configureMapsProvider} = await import('/src/maps/runtime.ts');
    const places = ['East entrance', 'West entrance'].map((name, i) => ({providerId: 'travel-fixture', id: String(i), name, coordinate: {latitude: [43.739, 43.74][i], longitude: 7.425}, attribution: 'Travel fixture', fetchedAt: Date.now()}));
    configureMapsProvider(
      {status: 'configured', providerId: 'travel-fixture', connectionId: 'conn_travel_fixture_123456', revision: 'fixture1', capabilities: {map: false, search: true, placeDetails: true, modes: ['drive', 'walk'], traffic: 'none', transit: 'none', offline: {map: false, search: false, routing: false}}},
      {
        providerId: 'travel-fixture', connectionId: 'conn_travel_fixture_123456',
        search: async (query: string) => { log('queries', query); return query === address ? places : []; },
        detail: async (id: string) => places[Number(id)],
        route: async (from: any, to: any, mode: any) => {
          log('routes', {from, to, mode});
          return {providerId: 'travel-fixture', id: 'route-' + mode, from, to, mode, geometry: [from, to], distanceMeters: mode === 'walk' ? 380 : 420, durationSeconds: mode === 'walk' ? 540 : 300, steps: [{instruction: 'Continue to the selected entrance', coordinate: to, distanceMeters: 400}], attribution: 'Travel fixture', fetchedAt: Date.now(), traffic: 'none'};
        },
      } as any,
    );
  }, {address, LOG});
}
const requests = (page: Page) => page.evaluate(LOG => JSON.parse(localStorage.getItem(LOG) || '{"queries":[],"routes":[]}') as {queries: string[]; routes: {from: unknown; to: unknown; mode: string}[]}, LOG);
const events = (page: Page) => page.evaluate(async () => JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw()) || '{"events":[]}').events as {title: string; location: string}[]);
async function systemBack(page: Page) {
  await button(page, 'Device controls').click();
  const controls = page.getByRole('dialog', {name: 'Development device controls', exact: true});
  await controls.getByRole('button', {name: 'Back', exact: true}).click();
  const close = controls.getByRole('button', {name: 'Close device controls', exact: true});
  if (await close.isVisible()) await close.click();
  await expect(controls).toBeHidden();
}

test('calendar event location is handed to Maps once, routed by explicit choices, and returns to the event', async ({page}) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => { if (!localStorage.getItem('alpha.connection.selection.v1')) localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind: 'offline'})); });
  await page.goto('/?mode=dev&tools=1');
  await installMaps(page);
  const heading = page.getByRole('heading', {name: 'Harbour meeting', exact: true});
  const search = page.getByRole('textbox', {name: 'Search places', exact: true});
  const from = {latitude: 43.738, longitude: 7.424}, to = {latitude: 43.74, longitude: 7.425};

  await test.step('create an event with a location through the editor', async () => {
    await openBrowserCalendar(page);
    await button(page, 'New event').click();
    await page.getByRole('textbox', {name: 'Title', exact: true}).fill('Harbour meeting');
    await page.getByRole('textbox', {name: 'Location', exact: true}).fill(address);
    await button(page, 'Save event').click();
    await expect(heading).toBeVisible();
    await expect(button(page, address)).toBeVisible();
    const saved = await events(page);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({title: 'Harbour meeting', location: address});
    // Creating and viewing the event must not contact the Maps provider.
    expect(await requests(page)).toEqual({queries: [], routes: []});
  });

  await test.step('reopen the saved event after reload and hand its location to Maps once', async () => {
    await page.reload();
    await installMaps(page);
    await openBrowserCalendar(page);
    await page.getByRole('button', {name: /^Harbour meeting,/}).click();
    await expect(heading).toBeVisible();
    expect(await requests(page)).toEqual({queries: [], routes: []});
    await button(page, address).click();
    await expect(search).toHaveValue(address);
    await expect(page.getByRole('button', {name: /^East entrance/}).first()).toBeVisible();
    await expect(page.getByRole('button', {name: /^West entrance/}).first()).toBeVisible();
    // Two candidates: nothing is selected or routed until the user chooses.
    await expect(button(page, 'Directions')).toHaveCount(0);
    expect(await requests(page)).toEqual({queries: [address], routes: []});
  });

  await test.step('explicit destination, explicit origin, explicit route choice', async () => {
    await page.getByRole('button', {name: /^West entrance/}).first().click();
    await button(page, 'Directions').click();
    const status = page.getByRole('region', {name: 'Maps'}).getByRole('status');
    await expect(status).toHaveText('Enter an origin latitude, longitude and press Enter, or explicitly use current location.');
    await expect(page.getByText('Choose a real origin to calculate a route.')).toBeVisible();
    expect((await requests(page)).routes).toEqual([]);
    const origin = page.getByRole('textbox', {name: 'Route origin coordinates'});
    await origin.fill('43.738, 7.424');
    await origin.press('Enter');
    await expect(page.getByRole('region', {name: 'Maps'})).toContainText(/5 min\s*0\.4 km · no live traffic/);
    expect((await requests(page)).routes).toEqual([{from, to, mode: 'drive'}]);
    // A mode the provider does not offer is refused by name and requests nothing.
    await button(page, 'Transit').click();
    await expect(status).toHaveText('Transit schedules are not available for this region.');
    await button(page, 'Bike').click();
    await expect(status).toHaveText('Bike directions are not available from this Maps provider.');
    expect((await requests(page)).routes).toEqual([{from, to, mode: 'drive'}]);
    // The selected mode is exposed as state, not by color only; a refused mode is not selected.
    await expect(button(page, 'Drive')).toHaveAttribute('aria-pressed', 'true');
    for (const mode of ['Walk', 'Bike', 'Transit']) await expect(button(page, mode)).toHaveAttribute('aria-pressed', 'false');
    await button(page, 'Walk').click();
    await expect(button(page, 'Walk')).toHaveAttribute('aria-pressed', 'true');
    await expect(button(page, 'Drive')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('region', {name: 'Maps'})).toContainText(/9 min\s*0\.4 km · no live traffic/);
    expect((await requests(page)).routes).toEqual([{from, to, mode: 'drive'}, {from, to, mode: 'walk'}]);
    // Native-only: live navigation needs device location; the browser build says so.
    await button(page, 'Start').click();
    await expect(status).toHaveText('Location permission was not granted. You can choose an origin manually.');
    expect((await requests(page)).queries).toEqual([address]);
  });

  await test.step('"Back to event" returns to the same event without another hand-off', async () => {
    const routesBefore = (await requests(page)).routes.length;
    // Offered in directions, on the place and in results; used here from directions.
    await expect(button(page, 'Back to event')).toHaveCount(1);
    await button(page, 'Back to event').click();
    await expect(heading).toBeVisible();
    await expect(button(page, address)).toBeVisible();
    await expect(button(page, 'Back to calendar')).toBeVisible();
    const after = await requests(page);
    expect(after.queries).toEqual([address]);
    expect(after.routes).toHaveLength(routesBefore);
    expect(await events(page)).toHaveLength(1);
  });

  await test.step('system Back also returns to the same event without another hand-off', async () => {
    // A second, explicit hand-off from the event (one new search), then the system Back path.
    await button(page, address).click();
    await expect(search).toHaveValue(address);
    await page.getByRole('button', {name: /^West entrance/}).first().click();
    await expect(button(page, 'Directions')).toBeVisible();
    await expect(button(page, 'Back to event')).toHaveCount(1);
    const routesBefore = (await requests(page)).routes.length;
    let presses = 0;
    while (!await heading.isVisible()) {
      expect(++presses).toBeLessThanOrEqual(5);
      await systemBack(page);
    }
    await expect(heading).toBeVisible();
    await expect(button(page, address)).toBeVisible();
    await expect(button(page, 'Back to calendar')).toBeVisible();
    const after = await requests(page);
    expect(after.queries).toEqual([address, address]);
    expect(after.routes).toHaveLength(routesBefore);
  });

  await test.step('reload does not replay the hand-off; a new tap is one new hand-off', async () => {
    const routesBefore = (await requests(page)).routes.length;
    await page.reload();
    await installMaps(page);
    await button(page, 'Maps').click();
    await expect(search).toHaveValue('');
    await expect(page.getByRole('button', {name: /entrance/})).toHaveCount(0);
    // Maps opened from the launcher has no event to return to.
    await expect(button(page, 'Back to event')).toHaveCount(0);
    await systemBack(page);
    await openBrowserCalendar(page);
    await page.getByRole('button', {name: /^Harbour meeting,/}).click();
    await expect(heading).toBeVisible();
    expect(await events(page)).toHaveLength(1);
    expect((await requests(page)).queries).toEqual([address, address]);
    await button(page, address).click();
    await expect(search).toHaveValue(address);
    await expect(page.getByRole('button', {name: /^West entrance/}).first()).toBeVisible();
    const final = await requests(page);
    expect(final.queries).toEqual([address, address, address]);
    expect(final.routes).toHaveLength(routesBefore);
  });
});
