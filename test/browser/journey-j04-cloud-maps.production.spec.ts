// J04 with Eliza Cloud Maps on the FLAG-OFF bundle: a canonical Calendar event's location is passed to
// Maps once, searched through the account-bound Cloud Maps routes (/api/v1/maps capabilities, search
// and routes), routed from an explicit origin with an explicit travel-mode choice, started and
// stopped, and Back to event restores that exact event. A mid-search cancel, an out-of-coverage
// place and a Retry-After request limit are shown as the shipped renderer words them.
//
// Synthetic boundaries, all at the Capacitor bridge (flag-off-android.ts, resident-stub.ts):
// CalendarService rows, the Cloud Maps HTTP answers (resident-stub `maps`), the ElizaLocation fix
// stream and the AlphaMapsTransport screen-off service. The shipped renderer, CloudProtocol, the
// plugin-maps Cloud provider, controller and screen all run.
//
// Evidence boundary: source/test evidence for the flag-off renderer only. Nothing here is a
// deployed Cloud Maps service, Nominatim or GraphHopper, GPS, the Android foreground service, an
// APK, an emulator or a device.
import { test, expect, type Page } from '@playwright/test';
import {installCanonicalCalendarFixture} from './helpers/canonical-calendar';
import { flagOffAndroid, harness, button, fenceNetwork, expectNoDevelopmentSurface, residentHome } from './flag-off-android';
import { residentStub, stub, type StubMaps } from './resident-stub';

test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'production', 'Production bundle only'); });

const TITLE = 'Harbour inspection';
const LOCATION = 'Port Hercule, Monaco';
const MONACO: [number, number, number, number] = [7.409, 43.724, 7.449, 43.752];
const PORT = { latitude: 43.7347, longitude: 7.4206 };
const ORIGIN = { latitude: 43.7397, longitude: 7.4276 };
const MAPS: StubMaps = {
  regions: [{ id: 'monaco', name: 'Monaco', bounds: MONACO }],
  places: {
    [LOCATION]: [
      { id: 'N1001', name: 'Port Hercule', latitude: PORT.latitude, longitude: PORT.longitude, address: 'Quai Albert 1er, Monaco' },
      { id: 'N1002', name: 'Port Hercule fuel dock', latitude: 43.7351, longitude: 7.4232, address: 'Quai Rainier III, Monaco' },
    ],
    // A real place that Cloud found, but outside every coverage region.
    'Nice harbour': [{ id: 'N2001', name: 'Port of Nice', latitude: 43.6955, longitude: 7.2853, address: 'Quai Lunel, Nice' }],
  },
  routes: [{ minutes: 7, meters: 1200, via: 'Boulevard Albert 1er' }, { minutes: 9, meters: 1500, via: 'Avenue de la Costa' }],
};

/** Adds the event location, a granted ElizaLocation fix stream and the AlphaMapsTransport service. */
async function devicePorts(page: Page, location: string) {
  await page.addInitScript(location => {
    const w = window as any, base = w.Capacitor, f = w.flagOff;
    const record = w.j04 = { lists: [] as Array<{ begin: number; end: number }>, navigation: [] as string[], watches: [] as string[], cleared: [] as string[] };
    const listeners = [{ name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'callback' }];
    base.PluginHeaders.push(
      { name: 'ElizaLocation', methods: [...['checkPermissions', 'requestPermissions', 'cancelPermissionRequest', 'watchPosition', 'clearWatch'].map(name => ({ name, rtype: 'promise' })), ...listeners] },
      { name: 'AlphaMapsTransport', methods: [...['navigationAvailability', 'startNavigation', 'updateNavigation', 'stopNavigation'].map(name => ({ name, rtype: 'promise' })), ...listeners] },
    );
    const native = base.nativePromise;
    base.nativePromise = async (plugin: string, method: string, input: any) => {
      if (plugin === 'ElizaLocation') {
        f.calls.push(plugin + '.' + method);
        if (method === 'checkPermissions' || method === 'requestPermissions') return { location: 'granted', accuracy: 'precise' };
        if (method === 'watchPosition') { const watchId = 'watch-' + (record.watches.length + 1); record.watches.push(watchId); return { watchId }; }
        if (method === 'clearWatch') { record.cleared.push(input.watchId); return {}; }
        return {};
      }
      if (plugin === 'AlphaMapsTransport') {
        f.calls.push(plugin + '.' + method);
        if (method === 'navigationAvailability') return { background: true, activeSessionId: null };
        record.navigation.push(method + (method === 'updateNavigation' ? '' : ' ' + (input?.title ?? '')).trimEnd());
        if (method === 'updateNavigation') return { active: true };
        if (method === 'stopNavigation') return { stopped: true };
        return {};
      }
      const result = await native(plugin, method, input);
      if (plugin === 'AlphaCalendar' && method === 'list') { record.lists.push({ begin: input.begin, end: input.end }); if (result?.events) result.events = result.events.map((row: any) => ({ ...row, location })); }
      return result;
    };
  }, location);
}
const calendarReads=(page:Page)=>page.evaluate(()=>(window as any).canonicalCalendarAccessibility.requests as Array<{path:string;method:string}>);
const j04 = (page: Page) => page.evaluate(() => (window as any).j04 as { lists: Array<{ begin: number; end: number }>; navigation: string[]; watches: string[]; cleared: string[] });
const mapsRequests = (page: Page) => stub(page, s => s.maps.requests.map((row: any) => ({ route: row.route, body: row.body })));
/** Route request endpoints and mode; whether alternatives were asked for is asserted separately. */
const routeBodies = async (page: Page) => (await mapsRequests(page)).filter(row => row.route === 'routes').map(({ body }) => ({ from: body.from, to: body.to, mode: body.mode }));
/** A fresh precise fix from the stubbed ElizaLocation stream. */
const fix = (page: Page, point: { latitude: number; longitude: number }) => page.evaluate(point => (window as any).flagOff.emit('ElizaLocation', 'locationChange', { coords: { ...point, accuracy: 5, timestamp: Date.now(), heading: null, speed: null }, cached: false }), point);

test('an event location is searched once in Cloud Maps, routed from an explicit origin, started and stopped, and Back returns to the event', async ({ page }) => {
  test.setTimeout(180_000);
  const foreign = await fenceNetwork(page);
  const begin = (() => { const now = new Date(), at = new Date(now); at.setHours(at.getHours() + 2, 0, 0, 0); if (at.getDate() !== now.getDate()) { at.setTime(now.getTime()); at.setHours(22, 0, 0, 0); } return at.getTime(); })();
  await flagOffAndroid(page);
  await residentStub(page, { maps: MAPS });
  await devicePorts(page, LOCATION);
  await installCanonicalCalendarFixture(page,{eventTitle:TITLE,location:LOCATION,begin,end:begin+1_800_000});
  await residentHome(page);

  const maps = page.getByRole('region', { name: 'Maps' });
  const search = page.getByRole('textbox', { name: 'Search places', exact: true });

  await test.step('the event location is passed to Maps once and searched in Cloud Maps', async () => {
    await button(page,'Calendar').click();
    await page.getByRole('button', { name: new RegExp(`^${TITLE},`) }).first().click();
    await expect(page.getByRole('heading', { name: TITLE, exact: true })).toBeVisible();
    // Viewing the event contacts no Maps route.
    expect((await mapsRequests(page)).filter(row => row.route !== 'capabilities')).toEqual([]);
    await button(page, LOCATION).click();
    await expect(page.locator('html')).toHaveAttribute('data-active-view', 'maps');
    await expect(search).toHaveValue(LOCATION);
    await expect(page.getByRole('button', { name: /^Port Hercule fuel dock/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Port Hercule,|^Port Hercule$|^Port Hercule Quai/ }).first()).toBeVisible();
    // Two candidates: nothing is selected or routed until the user chooses.
    await expect(button(page, 'Directions')).toHaveCount(0);
    expect(await mapsRequests(page)).toEqual([{ route: 'capabilities', body: null }, { route: 'places/search', body: { query: LOCATION } }]);
  });

  await test.step('an explicit destination, an explicit origin and an explicit mode choice', async () => {
    await page.getByRole('button', { name: /^Port Hercule fuel dock/ }).first().click();
    await button(page, 'Directions').click();
    await expect(page.getByText('Choose a real origin to calculate a route.')).toBeVisible();
    expect((await mapsRequests(page)).filter(row => row.route === 'routes')).toEqual([]);
    const origin = page.getByRole('textbox', { name: 'Route origin coordinates' });
    await origin.fill(`${ORIGIN.latitude}, ${ORIGIN.longitude}`);
    await origin.press('Enter');
    await expect(maps).toContainText(/7 min\s*1\.2 km · no live traffic/);
    const destination = { latitude: 43.7351, longitude: 7.4232 };
    expect(await routeBodies(page)).toEqual([{ from: ORIGIN, to: destination, mode: 'drive' }]);
    // Cloud serves no transit: it is refused by name and nothing is requested.
    await button(page, 'Transit').click();
    await expect(maps.getByRole('status').first()).toContainText('Transit schedules are not available for this region.');
    await button(page, 'Walk').click();
    await expect(button(page, 'Walk')).toHaveAttribute('aria-pressed', 'true');
    await expect(maps).toContainText(/7 min\s*1\.2 km · no live traffic/);
    expect((await routeBodies(page)).map(row => row.mode)).toEqual(['drive', 'walk']);
  });

  await test.step('Start runs foreground guidance with the screen-off service; End stops both', async () => {
    expect((await j04(page)).navigation).toEqual([]);
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(button(page, 'End navigation')).toBeVisible();
    await expect.poll(async () => (await j04(page)).navigation[0]).toBe('startNavigation Route to Port Hercule fuel dock');
    await expect.poll(async () => (await j04(page)).watches.length).toBeGreaterThan(0);
    await fix(page, ORIGIN);
    await expect(page.getByRole('status', { name: 'Remaining distance and time' })).toBeVisible();
    await button(page, 'End navigation').click();
    await expect(button(page, 'End navigation')).toHaveCount(0);
    await expect.poll(async () => (await j04(page)).navigation.filter(row => row.startsWith('stopNavigation'))).toHaveLength(1);
    await expect.poll(async () => (await j04(page)).cleared.length).toBeGreaterThan(0);
  });

  await test.step('Back to event reads that exact event again', async () => {
    const before = (await calendarReads(page)).length;
    await button(page, 'Back to event').click();
    await expect(page.getByRole('heading', { name: TITLE, exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-active-view', 'calendar');
    expect((await calendarReads(page)).slice(before).some(row=>{const url=new URL(row.path,'http://fixture.invalid');return row.method==='GET'&&url.pathname==='/api/lifeops/calendar/feed'&&Date.parse(url.searchParams.get('timeMin')!)===begin-1&&Date.parse(url.searchParams.get('timeMax')!)===begin+1;})).toBe(true);
    expect(await harness(page,f=>f.calendar.lists)).toBe(0);
    // The hand-off searched once; returning replays nothing.
    expect((await mapsRequests(page)).filter(row => row.route === 'places/search')).toHaveLength(1);
  });

  await expectNoDevelopmentSurface(page);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});

test('a cancelled search shows nothing late, a place outside coverage is named, and a Retry-After limit is worded', async ({ page }) => {
  test.setTimeout(150_000);
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page, {});
  await residentStub(page, { maps: MAPS });
  await devicePorts(page, LOCATION);
  await residentHome(page);
  await button(page, 'Maps').click();
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'maps');
  const maps = page.getByRole('region', { name: 'Maps' });
  const search = page.getByRole('textbox', { name: 'Search places', exact: true });
  await expect.poll(async () => (await mapsRequests(page)).map(row => row.route)).toEqual(['capabilities']);

  await test.step('clearing a search in flight cancels that Cloud request; its late answer is not shown', async () => {
    await page.evaluate(() => { (window as any).residentStub.maps.hold = true; });
    await search.fill(LOCATION);
    await search.press('Enter');
    await expect.poll(async () => (await mapsRequests(page)).filter(row => row.route === 'places/search')).toHaveLength(1);
    await button(page, 'Clear search').click();
    await expect.poll(() => stub(page, s => s.maps.cancelled.length)).toBe(1);
    const [held] = await stub(page, s => s.maps.requests.filter((row: any) => row.route === 'places/search').map((row: any) => row.requestId));
    expect(await stub(page, s => s.maps.cancelled)).toEqual([held]);
    // The cancelled request's answer arrives late anyway; it is not shown.
    await page.evaluate(() => (window as any).residentStub.releaseSearch());
    await page.waitForTimeout(500);
    await expect(page.getByRole('button', { name: /^Port Hercule/ })).toHaveCount(0);
    await expect(search).toHaveValue('');
  });

  await test.step('a place Cloud found outside every coverage region is named, not routed', async () => {
    await search.fill('Nice harbour');
    await search.press('Enter');
    await page.getByRole('button', { name: /^Port of Nice/ }).first().click();
    await expect(maps).toContainText('This location is outside Monaco search and route coverage. Its coordinates are retained.');
    expect((await mapsRequests(page)).filter(row => row.route === 'routes')).toEqual([]);
  });

  await test.step('a 429 with Retry-After is worded with its wait and nothing is retried automatically', async () => {
    await page.evaluate(() => { (window as any).residentStub.maps.limit = '30'; });
    await search.fill(LOCATION);
    await search.press('Enter');
    await expect(maps).toContainText('Maps request limit reached. Try again in about 30 seconds.');
    const searches = (await mapsRequests(page)).filter(row => row.route === 'places/search').length;
    await page.waitForTimeout(1_000);
    expect((await mapsRequests(page)).filter(row => row.route === 'places/search')).toHaveLength(searches);
    // An explicit retry by the user is a new request, and it succeeds.
    await search.press('Enter');
    await expect(page.getByRole('button', { name: /^Port Hercule fuel dock/ }).first()).toBeVisible();
  });

  await expectNoDevelopmentSurface(page);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});

test('Cloud route alternatives are offered in order; choosing one requests nothing and Start follows it', async ({ page }) => {
  test.setTimeout(150_000);
  const foreign = await fenceNetwork(page);
  await flagOffAndroid(page, {});
  await residentStub(page, { maps: MAPS });
  await devicePorts(page, LOCATION);
  await residentHome(page);
  await button(page, 'Maps').click();
  const maps = page.getByRole('region', { name: 'Maps' });
  const search = page.getByRole('textbox', { name: 'Search places', exact: true });
  await search.fill(LOCATION);
  await search.press('Enter');
  await page.getByRole('button', { name: /^Port Hercule fuel dock/ }).first().click();
  await button(page, 'Directions').click();
  const origin = page.getByRole('textbox', { name: 'Route origin coordinates' });
  await origin.fill(`${ORIGIN.latitude}, ${ORIGIN.longitude}`);
  await origin.press('Enter');

  // One admitted request asks Cloud for alternatives; both come back in Cloud's order.
  const routes = page.getByRole('group', { name: 'Routes' });
  const recommended = routes.getByRole('button', { name: 'Recommended, 7 min, 1.2 km', exact: true });
  const alternative = routes.getByRole('button', { name: 'Alternative 1, 9 min, 1.5 km', exact: true });
  await expect(recommended).toHaveAttribute('aria-pressed', 'true');
  await expect(alternative).toHaveAttribute('aria-pressed', 'false');
  await expect(maps).toContainText('Head along Boulevard Albert 1er');
  const routeRequests = async () => (await mapsRequests(page)).filter(row => row.route === 'routes').map(row => row.body);
  expect(await routeRequests()).toEqual([{ from: ORIGIN, to: { latitude: 43.7351, longitude: 7.4232 }, mode: 'drive', alternatives: true }]);

  // Choosing the alternative is local: nothing more is requested.
  await alternative.click();
  await expect(alternative).toHaveAttribute('aria-pressed', 'true');
  await expect(recommended).toHaveAttribute('aria-pressed', 'false');
  await expect(maps).toContainText(/9 min\s*1\.5 km · no live traffic/);
  await expect(maps).toContainText('Head along Avenue de la Costa');
  expect(await routeRequests()).toHaveLength(1);

  // Start guides along the chosen route; End stops the screen-off service.
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(button(page, 'End navigation')).toBeVisible();
  await expect.poll(async () => (await j04(page)).navigation[0]).toBe('startNavigation Route to Port Hercule fuel dock');
  await fix(page, ORIGIN);
  // Guidance runs on the chosen route: its 9-minute duration, not the recommended 7.
  await expect(page.getByRole('status', { name: 'Remaining distance and time' })).toBeVisible();
  await expect(maps).toContainText('9 min');
  await expect(maps).not.toContainText('7 min');
  await button(page, 'End navigation').click();
  await expect.poll(async () => (await j04(page)).navigation.filter(row => row.startsWith('stopNavigation'))).toHaveLength(1);
  expect(await routeRequests()).toHaveLength(1);

  await expectNoDevelopmentSurface(page);
  expect(await harness(page, f => f.unexpected)).toEqual([]);
  expect(foreign).toEqual([]);
});
