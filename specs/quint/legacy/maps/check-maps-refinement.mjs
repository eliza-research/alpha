import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium, expect as baseExpect} from '@playwright/test';
import {createServer} from 'vite';
import {checkClientFeatures} from '../../../../scripts/prepare-client-features.mjs';
import {filesWithin, sha256, repositoryRoot as root} from '../../../../scripts/quint-lib.mjs';
import {preloadPageModules} from '../../../../test/browser/helpers/page-modules.ts';
import {captureInputs, checkTraces} from '../../refinement/check-traces.mjs';

const model = 'MapsReplay';
const modelPath = 'test/fixtures/quint/MapsComparison.qnt';
const cacheDir = resolve(root, 'test-results/quint-refinement/legacy-maps-vite-cache');
const adapter = resolve(root, 'apps/app/src/prototype/maps-adapter.ts');
const expect = baseExpect.configure({timeout: 15000});
const button = (page, name) => page.getByRole('button', {name, exact: true});
const sheet = (page, mode) => page.locator('[data-alpha-maps-sheet="'+mode+'"]');
const query = page => page.getByRole('textbox', {name: 'Search places', exact: true});
const status = page => page.locator('[data-alpha-maps-status] [role="status"]');
const action = (name, ...args) => ({name, args});
const origin = {latitude: 43.738, longitude: 7.424};
const destination = {latitude: 43.741, longitude: 7.424};
const far = {latitude: 43.750, longitude: 7.424};
const label = 'Fixture destination';
const deviceModule = '/src/browser/device.ts';
const agentModule = '/src/maps/agent-navigation.ts';
const fixtureModules = ['/src/runtime/connection-ui.tsx', '/src/maps/cloud-maps.ts', '/src/maps/runtime.ts', deviceModule];

async function setup(page, holdRouteReplies) {
  const paths = holdRouteReplies ? [...fixtureModules, agentModule] : fixtureModules;
  await preloadPageModules(page, paths);
  await page.evaluate(({paths, destination, label, holdRouteReplies}) => {
    const modules = window.__alphaModules;
    const {connectionController} = modules[paths[0]];
    const {cloudMapsDiagnostics} = modules[paths[1]];
    const {mapsConnection} = modules[paths[2]];
    const providerId = 'eliza-cloud-osm', attribution = 'Synthetic map attribution';
    const position = () => ({providerId, id: 'fixture-place', name: label, coordinate: destination,
      address: 'Synthetic address', attribution, fetchedAt: Date.now()});
    const f = window.closedMaps = {requests: [], pendingCapability: null, diagnostic: cloudMapsDiagnostics, mapsConnection, routeRefusal: false,
      holdRouteReplies: false, pendingRoutes: [], agentPort: holdRouteReplies ? modules[paths[4]].residentMapsNavigationPort : undefined};
    const client = {
      async mapsRequest(endpoint, signal, body) {
        f.requests.push({endpoint, body: body ? structuredClone(body) : null});
        signal.throwIfAborted();
        if (endpoint === 'capabilities') {
          if (f.pendingCapability) throw Error('Duplicate capability attempt in closed Maps fixture');
          const online = await new Promise(resolve => {f.pendingCapability = resolve;});
          f.pendingCapability = null;
          if (!online) throw Error('Network fixture offline');
          return {providerId, connectionId: 'conn_fixture_maps_123456789', revision: 'fixture-map-v1', attribution,
            regions: [{id: 'fixture', name: 'Fixture', bounds: [7.3, 43.6, 7.6, 43.9]}],
            capabilities: {search: true, placeDetails: true, modes: ['drive'], traffic: 'none', transit: 'none'}};
        }
        if (endpoint === 'places/search') return {places: [position()]};
        if (endpoint === 'places/details') return {place: position()};
        if (endpoint === 'routes') {
          const reply = f.holdRouteReplies ? await new Promise(resolve => {
            f.pendingRoutes.push({body, signal, settle: resolve, settled: false});
          }) : undefined;
          if (f.routeRefusal || reply?.refuse) throw Object.assign(Error('Fixture provider unavailable'), {
            name: 'CloudProtocolError', code: 'http', status: 503, data: {code: 'provider_unavailable'},
          });
          const {from, to, mode} = body;
          return {routes: [{providerId, id: reply?.id ?? 'route1_fixture_0123456789', from, to, mode, geometry: [from, to],
            distanceMeters: 333, durationSeconds: 223, attribution, fetchedAt: Date.now(), traffic: 'none',
            steps: [{instruction: 'Continue to destination', coordinate: to, distanceMeters: 333, maneuver: 'arrive'}]}]};
        }
        throw Error('Unexpected closed Maps endpoint '+endpoint);
      },
      async mapsTile() {throw Error('Closed Maps provider advertises no tiles');},
    };
    const owner = {sessionId: 'synthetic-maps-owner', credentialId: 'synthetic-maps-credential', client};
    connectionController.getCloudClient = () => owner;
  }, {paths, destination, label, holdRouteReplies});
}

async function observe(page) {
  return page.evaluate(() => {
    const f = window.closedMaps;
    const screen = document.documentElement.dataset.activeView !== 'maps' ? 'Away'
      : document.querySelector('[aria-label="End navigation"]') ? window.inspectHistoricalMaps().arrived ? 'Arrived' : 'Nav'
      : document.querySelector('[data-alpha-maps-sheet="directions"]') ? 'Route'
      : document.querySelector('[data-alpha-maps-sheet="place"]') ? 'Place'
      : document.querySelector('[data-alpha-maps-sheet="results"]') ? 'Results' : 'Base';
    const configured = f.mapsConnection().config.status === 'configured';
    const diagnostic = f.diagnostic();
    const tried = f.requests.some(row => row.endpoint === 'capabilities');
    const session = configured ? 'ready' : f.pendingCapability ? 'connecting' : tried && diagnostic.error ? 'error' : 'idle';
    const text = document.querySelector('[data-alpha-maps-status] [role="status"]')?.textContent.trim() || '';
    const message = text === 'Cloud Maps is unreachable. Check the connection.' ? 'offline'
      : text === 'Cloud Maps is temporarily unavailable. Try again later.' ? 'down'
      : /^Connect a Maps provider/.test(text) ? 'connectProvider' : 'none';
    return {
      's.screen': screen, 's.session': session, 's.tried': tried, 's.message': message,
      's.route': window.inspectHistoricalMaps().route?.phase === 'ready',
      's.assistant': !!document.querySelector('[data-alpha-layer="conversation"]:not([aria-hidden="true"])'),
      ProfileSafety: true,
    };
  });
}

async function schedule(page, name, net = 'up') {
  const trace = {name, init: action('StartState', 'proposed', net, 'active', 'ok'), expect: await observe(page), steps: []};
  return {trace, async point(label, next, omit = []) {
    const expect = await observe(page);
    for (const field of omit) delete expect[field];
    trace.steps.push({label, action: next, expect});
  }};
}
function difference(trace, name, profile = 'proposed') {
  const copy = structuredClone(trace);
  copy.name = name;
  copy.init.args[0] = profile;
  delete copy.expect.ProfileSafety;
  for (const step of copy.steps) delete step.expect.ProfileSafety;
  return copy;
}

function waitForCapability(page) {
  return page.waitForFunction(() => typeof window.closedMaps.pendingCapability === 'function');
}
function settleCapability(page, online) {
  return page.evaluate(online => {window.closedMaps.pendingCapability(online);}, online);
}
function requests(page) {
  return page.evaluate(() => window.closedMaps.requests);
}
async function open(page, t, online, submitWhileConnecting = false) {
  await button(page, 'Maps').click();
  await expect(page.locator('html')).toHaveAttribute('data-active-view', 'maps');
  await waitForCapability(page);
  await t.point('Opening Maps dispatches one held capabilities read', [action('OpenMaps'), action('Connect')]);
  if (submitWhileConnecting) {
    await search(page);
    await expect(sheet(page, 'results')).toBeVisible();
    await t.point('An explicit search waits for the held read', action('Search'));
  }
  await settleCapability(page, online);
  if (online) await page.waitForFunction(() => window.closedMaps.mapsConnection().config.status === 'configured');
  else await page.waitForFunction(() => window.closedMaps.diagnostic().error === 'offline');
  if (!online && submitWhileConnecting)
    await expect(status(page)).toHaveText('Cloud Maps is unreachable. Check the connection.');
  await t.point(online ? 'Accepted capabilities install the closed provider' : 'Failed capabilities retain the offline diagnostic',
    action('Connected'), !online && !submitWhileConnecting ? ['s.message'] : []);
}

async function search(page) {
  await query(page).fill(label);
  await query(page).press('Enter');
}
const result = page => sheet(page, 'results').getByRole('button', {name: /^Fixture destination/}).first();

async function passiveOffline(page) {
  const t = await schedule(page, 'passive_open_records_failure_without_a_search_notice', 'down');
  await open(page, t, false);
  await expect(status(page)).toHaveText('Add a location');
  const passive = difference(t.trace, 'passive_capability_failure_does_not_yet_replace_base_status');
  passive.steps.at(-1).expect['s.message'] = (await observe(page))['s.message'];
  return {trace: t.trace, differences: [['MapsHistoricalPassiveOfflineNotice', passive]]};
}

async function offlineRecovery(page) {
  const t = await schedule(page, 'offline_capabilities_error_and_explicit_search_recovery', 'down');
  await open(page, t, false, true);
  const oldError = difference(t.trace, 'offline_message_differs_from_historical_provider_prompt', 'current');
  assert.deepEqual((await requests(page)).map(row => row.endpoint), ['capabilities']);
  await search(page);
  await waitForCapability(page);
  await expect(sheet(page, 'results')).toBeVisible();
  await t.point('Explicit search admits a new read while the restored transport is held',
    [action('Heal'), action('Search'), action('Connect')], ['s.message']);
  await settleCapability(page, true);
  await expect(result(page)).toBeVisible();
  await t.point('Accepted second read enables exactly one successful search', action('Connected'));
  assert.deepEqual((await requests(page)).map(row => row.endpoint), ['capabilities', 'capabilities', 'places/search']);
  return {trace: t.trace, differences: [['MapsHistoricalOfflinePrompt', oldError]]};
}

export async function route(page, t) {
  await open(page, t, true);
  await search(page);
  await expect(result(page)).toBeVisible();
  await t.point('Explicit search shows the actual returned destination', action('Search'));
  await result(page).click();
  await expect(sheet(page, 'place').getByRole('button', {name: 'Rename place', exact: true})).toHaveText(label);
  await t.point('Selecting that result opens its actual place card', action('PickPlace'));
  await button(page, 'Directions').click();
  const input = page.getByRole('textbox', {name: 'Route origin coordinates', exact: true});
  await expect(input).toBeVisible();
  await expect(sheet(page, 'directions')).toContainText('Choose a real origin to calculate a route.');
  assert.equal((await requests(page)).some(row => row.endpoint === 'routes'), false);
  const immediate = t.trace && difference(t.trace, 'directions_wait_for_explicit_origin_before_route');
  immediate?.steps.push({label: 'Directions without an origin has no accepted route', action: action('Directions'), expect: await observe(page)});
  await input.fill(origin.latitude+', '+origin.longitude);
  await input.press('Enter');
  await expect(sheet(page, 'directions')).toContainText(/no live traffic/);
  await t.point('Directions plus explicit coordinates accept a route matching both endpoints', action('Directions'));
  assert.deepEqual((await requests(page)).filter(row => row.endpoint === 'routes').map(row => row.body),
    [{from: origin, to: destination, mode: 'drive'}]);
  return immediate;
}
export function geo(page, point) {
  return page.evaluate(point => {
    const f = window.closedMapsGeo;
    const latest = [...f.watches.values()].at(-1);
    if (!latest) throw Error('No synthetic location watch');
    latest({coords: {...point, accuracy: 5}, timestamp: Date.now()});
  }, point);
}
export async function start(page, t) {
  await button(page, 'Start').click();
  await expect(button(page, 'End navigation')).toBeVisible();
  await page.waitForFunction(() => window.closedMapsGeo.watches.size === 1);
  await t.point('Start preserves the accepted route and owns one location watch', action('Start'));
  const mute = button(page, 'Mute voice guidance');
  if (await mute.count()) await mute.click();
}

async function guidance(page) {
  const t = await schedule(page, 'owner_directions_guidance_chat_stop_and_arrival');
  const immediate = await route(page, t);
  await start(page, t);
  await button(page, 'Open conversation').click();
  await expect(button(page, 'Minimize chat')).toBeVisible();
  await t.point('Opening the conversation overlays the active guidance', action('OpenAssistant'));
  await button(page, 'Minimize chat').click();
  await expect(button(page, 'End navigation')).toBeVisible();
  await expect(button(page, 'Minimize chat')).toHaveCount(0);
  await t.point('Minimizing chat leaves guidance and the accepted route in place', action('CloseAssistant'));
  const interrupted = difference(t.trace, 'minimizing_conversation_does_not_interrupt_guidance', 'current');
  await button(page, 'End navigation').click();
  await expect(sheet(page, 'directions')).toBeVisible();
  await page.waitForFunction(() => window.closedMapsGeo.watches.size === 0);
  await t.point('Ending navigation returns to directions and releases location', action('Back'));
  await start(page, t);
  await geo(page, destination);
  await expect(page.getByText('Destination reached', {exact: true})).toBeVisible();
  await page.waitForFunction(() => window.closedMapsGeo.watches.size === 0);
  await t.point('A destination fix reaches Arrived and releases location', action('Arrive'), ['s.route']);
  const arrival = difference(t.trace, 'arrival_retains_the_route_after_releasing_location');
  arrival.steps.at(-1).expect['s.route'] = (await observe(page))['s.route'];
  return {trace: t.trace, differences: [
    ['MapsHistoricalDirectionsBeforeOrigin', immediate], ['MapsHistoricalChatInterruption', interrupted],
    ['MapsHistoricalArrivalClearsRoute', arrival],
  ]};
}

async function guidanceTargets(page, viewports) {
  const viewport = page.viewportSize();
  const settle = () => page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  const setText = async percent => {
    await page.evaluate(async ({path, percent}) => {
      const {BrowserDevice} = window.__alphaModules[path];
      await BrowserDevice.prototype.setTextScale({percent});
    }, {path: deviceModule, percent});
    await expect.poll(() => page.evaluate(() => Number(
      getComputedStyle(document.documentElement).getPropertyValue('--alpha-text-scale')))).toBe(percent / 100);
  };
  const observations = [];
  try {
    for (const percent of [100, 150]) {
      await setText(percent);
      for (const [width, height] of viewports) {
        await page.setViewportSize({width, height});
        await page.waitForFunction(landscape => document.documentElement.classList.contains('alpha-landscape') === landscape,
          width > height);
        await settle();
        const {targets, rightDock} = await page.evaluate(landscape => {
          const root = document.querySelector('[data-alpha-maps-root]');
          const end = root.querySelector('button[aria-label="End navigation"]');
          const owns = (node, x, y) => node.contains(document.elementFromPoint(x, y));
          const points = (node, heights) => {
            const box = node.getBoundingClientRect();
            return [0.2, 0.5, 0.8].flatMap(x => heights.map(y =>
              owns(node, box.left + box.width*x, box.top + box.height*y)));
          };
          const textLines = node => {
            const range = document.createRange();
            range.selectNodeContents(node);
            return [...range.getClientRects()].map(box =>
              owns(node, box.left + box.width/2, box.top + box.height/2));
          };
          const guidance = [...end.parentElement.querySelectorAll('button')].map(node => ({
            label: node.getAttribute('aria-label') || node.textContent.trim(),
            owned: points(node, [0.2, 0.5, 0.8]),
          }));
          const information = root.querySelector('summary[aria-label="Map information"]');
          const attribution = [...root.querySelectorAll('.alpha-map-credits a')].map(node =>
            ({label: node.textContent.trim(), owned: textLines(node)}));
          const notice = root.querySelector('[data-alpha-maps-status] [role="status"]');
          const pill = root.closest('[data-screen]').querySelector('[data-alpha-layer="pill"]');
          const rail = pill?.getBoundingClientRect(), app = root.getBoundingClientRect();
          const dockButtons = pill ? [...pill.querySelectorAll('button,[role="button"]')].filter(node =>
            node.getClientRects().length && !node.closest('[aria-hidden="true"],[inert]')) : [];
          return {
            targets: [...guidance, {label: 'Map information', owned: points(information, [0.05, 0.2, 0.5, 0.8, 0.95])},
              ...attribution, {label: notice.textContent.trim(), owned: textLines(notice)}],
            rightDock: landscape && rail ? {
              atRight: rail.left > app.left + app.width / 2 && Math.abs(rail.right - app.right) < 1,
              controls: dockButtons.map(node => ({label: node.getAttribute('aria-label'), owned: points(node, [0.5])[1]})),
            } : null,
          };
        }, width > height);
        assert.equal(targets.length, 9, 'Four guidance controls, Map information, three attribution links and status');
        for (const {label, owned} of targets) {
          assert.ok(owned.length && owned.every(Boolean), `${width}×${height} at ${percent}%: ${label} owns its sampled points`);
        }
        if (width > height) {
          assert.ok(rightDock?.atRight, 'The landscape assistant pill remains right-docked');
          assert.ok(rightDock.controls.length && rightDock.controls.every(control => control.owned),
            'The assistant pill still owns the centers of its controls');
          const information = page.locator('[data-alpha-maps-root] summary[aria-label="Map information"]');
          await information.tap();
          await expect(information.locator('..')).toHaveAttribute('open', '');
          const coordinates = information.locator('..').getByRole('button', {name:'Enter coordinates', exact:true});
          assert.ok(await coordinates.evaluate(node => {
            const box = node.getBoundingClientRect();
            return node.contains(document.elementFromPoint(box.left+box.width/2, box.top+box.height/2));
          }), 'The open disclosure owns its first action');
          await information.tap();
          await expect(information.locator('..')).not.toHaveAttribute('open', '');
        }
        observations.push({width, height, percent, targets, ...(rightDock ? {rightDock} : {})});
      }
    }
  } finally {
    await page.setViewportSize(viewport);
    await setText(100);
    await settle();
  }
  return observations;
}

async function reroute(page) {
  const t = await schedule(page, 'off_route_prompt_before_explicit_reroute');
  await route(page, t);
  await start(page, t);
  await geo(page, far);
  await expect(status(page)).toContainText('Off route. Stop and calculate a new route.');
  const rerouteButton = button(page, 'Reroute from here');
  await expect(rerouteButton).toBeVisible();
  assert.equal((await requests(page)).filter(row => row.endpoint === 'routes').length, 1);
  await t.point('An off-route fix preserves the route pending an explicit choice', action('OffRoute'));
  const portrait = await guidanceTargets(page, [[412, 915], [360, 640]]);
  const landscape = await guidanceTargets(page, [[915, 412], [640, 360]]);
  await page.evaluate(() => {
    window.closedMaps.routeRefusal = true;
    document.addEventListener('pointerdown', event => {
      const button = event.target.closest('button');
      window.closedMaps.reroutePointer = {label: button?.textContent.trim(),
        layer: event.target.closest('[data-alpha-layer]')?.getAttribute('data-alpha-layer')};
    }, {capture: true, once: true});
  });
  await rerouteButton.tap();
  assert.deepEqual(await page.evaluate(() => window.closedMaps.reroutePointer),
    {label: 'Reroute from here', layer: 'app'});
  await expect(sheet(page, 'directions')).toBeVisible();
  await expect(status(page)).toContainText('Cloud Maps is temporarily unavailable. Try again later.');
  await page.waitForFunction(() => window.closedMapsGeo.watches.size === 0);
  assert.deepEqual((await requests(page)).filter(row => row.endpoint === 'routes').at(-1).body,
    {from: far, to: destination, mode: 'drive'});
  const failed = difference(t.trace, 'failed_explicit_reroute_ends_guidance_and_clears_route');
  // The projected failed-reroute outcome uses the original Fault/OffRoute
  // pair. The original fault transition would also retire the service session,
  // whereas the mounted source has a failed route request on an installed provider.
  const after = await observe(page);
  failed.steps.pop();
  failed.steps.push({label: 'Failed reroute ends guidance and clears the prior route',
    action: [action('CloudFault'), action('OffRoute')],
    expect: {'s.screen': after['s.screen'], 's.route': after['s.route'], 's.message': after['s.message']}});
  assert.equal(after['s.session'], 'ready');
  return {trace: t.trace, differences: [['MapsHistoricalFailedRerouteKeepsRoute', failed]], portrait, landscape};
}

export async function mountClosedMaps(extraSources, runs, holdRouteReplies = false) {
  checkClientFeatures();
  const watched = new Set([adapter, ...['maps-screen.ts', 'state.ts', 'cloud-provider.ts', 'cloud-session.ts']
    .map(path => resolve(root, '.eliza/client-features/plugins/plugin-maps/src/client/'+path))]);
  if (holdRouteReplies) watched.add(resolve(root, '.eliza/client-features/plugins/plugin-maps/src/client/device-navigation.ts'));
  const sources = [...new Set([
    ...filesWithin(resolve(root, 'apps/app/src')), ...filesWithin(resolve(root, '.eliza/client-features')),
    ...filesWithin(resolve(root, 'config')), ...filesWithin(resolve(root, 'patches/eliza')),
    ...filesWithin(resolve(root, 'vendor/eliza/plugins/plugin-native-passwords/src')),
    ...filesWithin(resolve(root, 'vendor/eliza/plugins/plugin-native-system/src')),
    'vendor/eliza/packages/core/src/utils/uuid.ts',
    'apps/app/index.html', 'vite.config.ts', 'package.json', 'package-lock.json', 'upstream.lock.json',
    'scripts/prepare-client-features.mjs', 'scripts/quint-lib.mjs', 'scripts/browser-full-reload.ts',
    modelPath, fileURLToPath(import.meta.url), 'test/browser/helpers/page-modules.ts', ...extraSources,
  ])];
  const driverHashes = captureInputs(sources), loaded = new Set();
  const flags = ['ELIZA_DEV_ALLOW_TEST_MOCKS', 'VITE_ELIZA_DEV_ALLOW_TEST_MOCKS'];
  const previous = flags.map(name => process.env[name]);
  let server, browser;
  try {
    for (const name of flags) process.env[name] = '';
    server = await createServer({configFile: resolve(root, 'vite.config.ts'), logLevel: 'error', cacheDir,
      server: {host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null},
      define: {'import.meta.env.VITE_ELIZA_DEV_ALLOW_TEST_MOCKS': JSON.stringify('')},
      plugins: [{name: 'quint-legacy-maps-inputs', enforce: 'pre', transform(code, id) {
        const path = id.split('?')[0];
        if (path.startsWith(root+'/') && !path.startsWith(cacheDir+'/') && !path.includes('/node_modules/') && existsSync(path)) {
          assert.ok(driverHashes[path], 'Mounted source captured before execution: '+path);
          if (watched.has(path)) {
            assert.equal(sha256(Buffer.from(code)), driverHashes[path], 'Mounted source matches its before-driver capture');
            loaded.add(path);
          }
        }
        if (path === adapter) {
          const anchor = '  let returningToEvent:';
          assert.equal(code.split(anchor).length, 2);
          const fields = holdRouteReplies ? ', guidance: surface.guidance(), session: screen.navSession, publication: screen.reroutePublication' : '';
          return code.replace(anchor, '  Object.assign(window, {inspectHistoricalMaps: () => ({route: mapsController?.snapshot().route, arrived: surface.guidance()?.arrived === true'+fields+'})});\n'+anchor);
        }
      }}]});
    await server.listen();
    browser = await chromium.launch({headless: true});
    const base = 'http://127.0.0.1:'+server.httpServer.address().port;
    const results = [];
    for (const run of runs) {
      const page = await browser.newPage({viewport: {width: 412, height: 915}, hasTouch: true, reducedMotion: 'reduce'});
      page.setDefaultTimeout(40000);
      const foreign = [], errors = [], moduleFailures = [];
      await page.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (['data:', 'blob:'].includes(url.protocol)) return route.continue();
        if (request.method() === 'GET' && url.href === 'https://tiles.openfreemap.org/styles/bright') {
          // A closed style exercises the actual map plane without external tiles.
          return route.fulfill({json: {version: 8, sources: {}, layers: [{id: 'background', type: 'background',
            paint: {'background-color': '#e7ebed'}}]}});
        }
        if (url.origin === base && request.method() === 'GET'
            && !url.pathname.startsWith('/__alpha-') && !url.pathname.startsWith('/api/')) return route.continue();
        foreign.push(request.method()+' '+url.origin+url.pathname);
        return route.abort();
      });
      await page.routeWebSocket(/.*/, socket => {
        const url = new URL(socket.url());
        const vite = [base.replace(/^http:/, 'ws:'), 'ws://127.0.0.1:0'].includes(url.origin)
          && url.pathname === '/' && url.searchParams.has('token');
        if (!vite) foreign.push('WS '+url.origin+url.pathname);
        return socket.close();
      });
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => {
        const url = new URL(response.url());
        if (url.origin === base && response.status() >= 400 && moduleFailures.length < 12)
          moduleFailures.push(response.status()+' '+url.pathname);
      });
      await page.addInitScript(() => {
        localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind: 'offline'}));
        const f = window.closedMapsGeo = {next: 1, watches: new Map()};
        Object.defineProperty(navigator, 'permissions', {value: {query: async () => ({state: 'granted'})}});
        Object.defineProperty(navigator, 'geolocation', {value: {
          watchPosition(callback) {const id = f.next++; f.watches.set(id, callback); return id;},
          clearWatch(id) {f.watches.delete(id);},
          getCurrentPosition() {throw Error('Fixture requires an owned synthetic location watch');},
        }});
        if (navigator.mediaDevices)
          navigator.mediaDevices.getUserMedia = async () => {throw Error('Maps fixture forbids physical capture');};
      });
      try {
        await page.goto(base+'/', {waitUntil: 'commit', timeout: 120000});
        await expect(button(page, 'Maps')).toBeVisible({timeout: 120000});
        await page.waitForFunction(() => typeof window.inspectHistoricalMaps === 'function');
        await setup(page, holdRouteReplies);
        const navigations = [];
        page.on('framenavigated', frame => {if (frame === page.mainFrame()) navigations.push(frame.url());});
        results.push(await run(page));
        assert.deepEqual(navigations, [], 'Replay retains its mounted document and fixture');
        assert.deepEqual(foreign, [], 'Only the closed Maps ports may answer');
        assert.deepEqual(errors, [], 'Mounted Maps reports no uncaught errors');
      } catch (error) {
        const mounted = await page.evaluate(() => ({
          document: document.readyState,
          rootChildren: document.getElementById('root')?.childElementCount ?? 0,
          view: document.documentElement.dataset.activeView ?? '',
          fixtureInstalled: !!window.closedMapsGeo,
          inspectorInstalled: typeof window.inspectHistoricalMaps === 'function',
        })).catch(() => null);
        throw new Error('Mounted Maps '+run.name+' schedule failed: '+error.message+
          '\n'+JSON.stringify({mounted, pageErrors: errors.slice(0, 6), moduleFailures}), {cause: error});
      } finally {await page.close();}
    }
    assert.deepEqual([...loaded].sort(), [...watched].sort());
    return {results, sources, driverHashes};
  } finally {
    for (const [index, name] of flags.entries()) {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    }
    try {await browser?.close();} finally {await server?.close();}
  }
}

export async function checkMapsRefinement(extraSources = []) {
  const {results, sources, driverHashes} = await mountClosedMaps(extraSources, [passiveOffline, offlineRecovery, guidance, reroute]);
  const shared = {model, modelPath, sources, driverHashes, scope: 'bounded-orchestration', assumptions: [
    'Actual flag-off Maps renderer, shared Maps screen/controller, Cloud provider and browser location run in Chromium. The account transport, external map style and precise fixes are closed synthetic ports. No geographic request leaves the fixture.',
    'Connection observations are scoped to the captured synthetic owner and its actual capability requests. The network, subscription and Cloud service facts are controlled inputs. Informational and unmodeled notices have no historical error category.',
    'The accepted Directions projection includes the owner entering explicit origin coordinates. The real Arrived projection checks the screen and released location separately from the accepted route retained in the arrival state.',
    'Mounted hit tests cover guidance, Map information, attribution and status at two sizes per orientation and two text scales. Landscape checks the right-docked assistant and taps Map information. Portrait taps Reroute and observes its exact admission.',
    'Calendar return, native background service, remote agent requests, installed permission flow and fairness are independent obligations.',
  ]};
  const receipt = await checkTraces({...shared, traces: results.map(result => result.trace)});
  const mismatches = [];
  for (const [id, trace] of results.flatMap(result => result.differences)) {
    const out = 'test-results/quint-refinement/'+id+'.json', receiptPath = resolve(root, out);
    await assert.rejects(checkTraces({...shared, id, out, traces: [trace]}), /Source\/model trace mismatch/);
    const mismatch = JSON.parse(readFileSync(receiptPath, 'utf8'));
    assert.equal(mismatch.results[0].kind, 'observation-mismatch');
    assert.ok(mismatch.driverInputsBound);
    mismatches.push({...mismatch, id, receiptPath});
  }
  return {receipts: [receipt], mismatches, portrait: results.flatMap(result => result.portrait ?? []),
    landscape: results.flatMap(result => result.landscape ?? [])};
}
