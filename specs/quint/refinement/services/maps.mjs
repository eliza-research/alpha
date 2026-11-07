import assert from 'node:assert/strict';
import {createCloudMaps} from '../../../../apps/app/src/maps/cloud-provider.ts';
import {AlphaMapsDeviceNavigation} from '../../../../apps/app/src/maps/device-navigation.ts';
import {MapsController} from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/state.ts';
import {SavedPlaces} from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/saved-places.ts';
import {checkTraces, captureInputs} from '../check-traces.mjs';
import {action, deferred, until} from './support.mjs';

const now = Date.now();
const providerId = 'eliza-cloud-osm', attribution = 'Fixture map attribution';
const config = {status: 'configured', providerId, connectionId: 'conn_refinement_fixture_1234', revision: 'revision', capabilities: {map: false, search: true, placeDetails: true, modes: ['walk'], traffic: 'none', transit: 'none', offline: {map: false, search: false, routing: false}}};
const from = {latitude: 1, longitude: 1}, to = {latitude: 1.01, longitude: 1.01};
const destination = {provider: 'coordinates', providerPlaceId: 'pin', name: 'Destination', coordinates: to};
function fixture({granted = true, fresh = true, direct = false, hold = null} = {}) {
  const calls = [], releases = new Set(); let guidance = null, current = true;
  const provider = {providerId, connectionId: 'conn_refinement_fixture_1234', async detail() { return null; }, async search() { return []; }, async route(origin, target, mode, signal) {
    calls.push({signal}); if (hold) await hold.promise;
    return {providerId, id: 'route1_fixture_0123456789', from: origin, to: target, mode, geometry: [origin, target], distanceMeters: 100, durationSeconds: 20,
      steps: [{instruction: 'Arrive', coordinate: target, distanceMeters: 100, maneuver: 'arrive'}], attribution, fetchedAt: now, traffic: 'none'};
  }};
  const controller = new MapsController(config, provider, new SavedPlaces('fixture', {getItem: () => null, setItem() {}}), {awaitingPermission: () => false, start: async () => {}, stop: async () => {}});
  const fix = {coordinate: from, accuracyMeters: 5, timestamp: fresh ? now : now - 100000, precision: 'precise'};
  const surface = {async present() { return true; }, snapshot: () => controller.snapshot(), async showDirections(place, mode, resolve) { controller.clearOrigin(); controller.setMode(mode); await controller.select(place, resolve); },
    async showPlace(place, resolve) { await controller.select(place, resolve); }, async showResults() {}, async locationGranted() { return granted; }, async locate() { return fix; },
    async planFrom(origin) { controller.setOrigin(origin); await controller.planRoute(); }, guidance: () => guidance,
    startGuidance() { const route = controller.snapshot().route; if (route.phase !== 'ready') return false; guidance = {routeId: route.value.id, placeName: 'Destination', travelMode: 'walk', fix, rerouting: false, arrived: false}; return true; },
    async reroute(origin) { await controller.reroute(origin); }, async stop() { guidance = null; }, onRelease(listener) { releases.add(listener); return () => releases.delete(listener); }};
  const nav = new AlphaMapsDeviceNavigation(surface, {providerId, attribution, current: () => current, directStart: async () => direct}, {now: () => now});
  return {nav, controller, surface, calls, retire() { current = false; nav.retire(); }};
}
export async function mapsRefinement() {
  const sources = ['apps/app/src/maps/device-navigation.ts', 'apps/app/src/maps/navigation-fix.ts', 'apps/app/src/maps/cloud-provider.ts', '.eliza/client-features/plugins/plugin-maps/src/client/state.ts', 'specs/quint/refinement/services/maps.mjs', 'specs/quint/refinement/services/support.mjs'];
  const driverHashes = captureInputs(sources);
  const traces = [];
  for (const options of [{granted: false}, {fresh: false}, {direct: false}, {direct: true}]) {
    const f = fixture(options);
    const result = await f.nav.start({destination, travelMode: 'walk'});
    const permitted = options.granted !== false, fresh = options.fresh !== false;
    const trace = {name: `navigation permission ${permitted} freshness ${fresh} direct ${!!options.direct}`, expect: {'s.guidance': false, 's.route': 0}, steps: []};
    const actions = [];
    if (permitted) actions.push(action('grantLocation'));
    if (permitted && fresh) actions.push(action('receiveFix', true));
    actions.push(action('requestRoute'));
    if (result.state !== 'awaiting-location') actions.push(action('routeReply', 1, 0, true));
    if (result.state === 'navigating') actions.push(action('allowDirectStart'), action('agentStart'));
    trace.steps.push({label: 'actual navigation checks permission and fix before planning', action: actions, expect: {'s.guidance': f.surface.guidance() !== null, 's.route': f.controller.snapshot().route.phase === 'ready' ? 1 : 0, 's.phase': result.state === 'awaiting-confirmation' ? 'ready' : result.state}});
    const stopped = await f.nav.stop();
    trace.steps.push({label: 'real Stop releases guidance', action: action('stop'), expect: {'s.phase': stopped.state, 's.guidance': f.surface.guidance() !== null}});
    assert.equal(f.calls.length, permitted && fresh ? 1 : 0);
    traces.push(trace);
  }
  {
    const hold = deferred(), f = fixture({hold});
    const trace = {name: 'retired account rejects a late route result', expect: {'s.route': 0}, steps: []};
    const run = f.nav.start({destination, travelMode: 'walk'}).then(() => null, error => error);
    await until(() => f.calls.length === 1, 'route request');
    trace.steps.push({label: 'real route request is pending', action: [action('grantLocation'), action('receiveFix', true), action('requestRoute')], expect: {'s.guidance': f.surface.guidance() !== null}});
    f.retire(); hold.resolve(); const error = await run; assert.equal(error.code, 'MAPS_PROVIDER_CHANGED');
    trace.steps.push({label: 'retirement prevents late direct-start', action: action('switchOwner'), expect: {'s.guidance': f.surface.guidance() !== null}});
    traces.push(trace);
  }
  for (const advertised of ['none', 'live']) for (const returned of ['none', 'live', undefined, 'unknown']) {
    let installedConfig, installedProvider;
    const place = {providerId, id: 'destination', name: 'Destination', coordinate: to, attribution, fetchedAt: now};
    const cloud = createCloudMaps(() => async endpoint => {
      if (endpoint === 'capabilities') return {providerId, connectionId: 'conn_refinement_fixture_1234', revision: 'revision', attribution,
        regions: [{id: 'area', name: 'Area', bounds: [0, 0, 2, 2]}], capabilities: {search: true, placeDetails: true, modes: ['walk'], traffic: advertised, transit: 'none'}};
      if (endpoint === 'places/details') return {place};
      if (endpoint === 'routes') return {routes: [{providerId, id: 'route1_fixture_0123456789', from, to, mode: 'walk', geometry: [from, to],
        distanceMeters: 100, durationSeconds: 20, steps: [{instruction: 'Arrive', coordinate: to, distanceMeters: 100}], attribution, fetchedAt: now, traffic: returned}]};
      throw Error('Unexpected Cloud route');
    }, (value, provider) => { installedConfig = value; installedProvider = provider; });
    await cloud.initializeCloudMaps();
    const controller = new MapsController(installedConfig, installedProvider, new SavedPlaces('traffic-fixture', {getItem: () => null, setItem() {}}), {awaitingPermission: () => false, start: async () => {}, stop: async () => {}});
    await controller.select(place); controller.setOrigin(from); controller.setMode('walk'); await controller.planRoute();
    const route = controller.snapshot().route;
    const valid = returned === 'none' || returned === advertised;
    assert.equal(route.phase, valid ? 'ready' : 'error');
    if (route.phase === 'error') assert.equal(route.error.code, 'invalid-response');
    traces.push({name: `Cloud traffic advertised ${advertised} returned ${returned}`, expect: {'s.route': 0}, steps: [{
      label: 'actual controller retains free-flow traffic and rejects unsupported traffic evidence',
      action: [action('grantLocation'), action('receiveFix', true), action('requestRoute'), action('routeReply', 1, 0, route.phase === 'ready')],
      expect: {'s.phase': route.phase, 's.route': route.phase === 'ready' ? 1 : 0},
    }]});
  }
  return checkTraces({model: 'MapsNavigation', sources, driverHashes, traces, scope: 'bounded-component', assumptions: ['Actual AlphaMapsDeviceNavigation and MapsController run against scripted provider/location/surface ports.', 'The surface represents UI ownership. Native GPS, background navigation and the full Maps adapter require separate instrumentation.', 'Route identity is mapped to its allocation index within each trace.']});
}
