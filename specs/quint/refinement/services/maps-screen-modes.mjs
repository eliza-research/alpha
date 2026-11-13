/** Replays MapsScreenModes model traces against the Maps screen as the launcher mounts it.
 *
 * What runs: installPrototypeMapsAdapter with the shared MapsScreenController, MapsController,
 * saved places and BackgroundNavigation (see ../application/maps-adapter-harness.mjs). Every
 * user action is taken through the bindings a render returns, agent requests through the
 * navigation surface the adapter offers, leaving and Back through the view module, hiding and
 * showing through `visibilitychange`, and a cross-app search through the Maps view's query.
 * The provider answers searches and place details at once; each route request, the located fix
 * and the native screen-off start stay pending until the trace settles them.
 *
 * Observation after every step, from a fresh render: the template mode, the screen's flags and
 * origin text, the controller's origin, route and search phases, the controller's location
 * watch, the screen-off session, the adapter's hand-off latch and the Maps view's query. The
 * model's `lastChoice` records history and is not compared. The origin field's "Your location"
 * is the located position; coordinates an agent supplied read as typed coordinates.
 *
 * The location permission is a port: `openDirections` opens the route sheet with it refused and
 * `openGrantedDirections` with it granted. "Leave" is the view module's onLeave; Maps stays the
 * view the shell reports, as when the user comes straight back.
 *
 * Liberties the driver takes, none of which changes model state: a route outcome with no request
 * in flight (leaving and hiding abort it) re-taps the selected travel mode to plan again;
 * choosing a starting point when the candidate rows were cleared presses Enter first to search
 * again; End on a hidden page is the notification's Stop. */
import assert from 'node:assert/strict';
import {modelTraces, replayTraces} from './maps-model-traces.mjs';
import {bundleMapsAdapter, mountMapsAdapter, tick, deferred, providerId, connectionId, providerConfig, attribution} from '../application/maps-adapter-harness.mjs';

const model = {path: 'specs/quint/services/MapsScreenModes.qnt', module: 'MapsScreenModes'};
const here = {latitude: 1, longitude: 1}, hereLabel = '1.00000, 1.00000', locatedLabel = 'Your location';
const typedName = 'Start St', typedPoint = '2.5, 2.5', chosenName = 'Start Place';
const enter = {key: 'Enter', preventDefault() {}, target: {blur() {}}};
const modes = {navigation: 'nav', directions: 'dir'};

function modeOf(v) {
  const choosing = v.originMode && v.directions && !v.navigating && v.selected !== 'none';
  return v.navigating ? 'nav' : choosing ? 'origin' : v.directions ? 'dir' : v.selected !== 'none' ? 'place' : v.searching ? 'results' : 'base';
}

async function driver(code) {
  const now = Date.now(), routes = [];
  const place = {providerId, id: 'cafe-1', name: 'Cafe', coordinate: {latitude: 1.01, longitude: 1.01}, attribution, fetchedAt: now};
  const start = {providerId, id: 'start-1', name: chosenName, coordinate: {latitude: 1.03, longitude: 1.03}, attribution, fetchedAt: now};
  const provider = {
    providerId, connectionId,
    async search(text) { return text === typedName || text === chosenName ? [start] : [place]; },
    async detail(id) { return id === start.id ? start : place; },
    route(from, to, mode, signal) { const request = {...deferred(), from, to, mode, signal, settled: false}; routes.push(request); return request.promise; },
  };
  const m = await mountMapsAdapter(code, {
    storage: {'alpha.maps.saved-places.v1': JSON.stringify({version: 1, items: [{id: 'saved-1', label: 'Home', coordinate: {latitude: 1.02, longitude: 1.02}, savedAt: now}]})},
    configure: app => app.configureMapsProvider(providerConfig, provider),
  });
  const {harness} = m;
  let requests = 0, offered = [];
  const screen = () => harness.screen;
  const data = () => m.render();
  const watch = () => harness.locations.length > 2 ? harness.locations.at(-1) : null;
  const originText = () => ({'': 'empty', [locatedLabel]: 'location', [hereLabel]: 'coordinates', [typedPoint]: 'coordinates', [typedName]: 'typed', [chosenName]: 'chosen'})[screen().originText];
  const act = async run => { await run(); await tick(); };
  m.render(); await tick();
  return {
    focusSearch: () => act(() => data().focusQ()),
    typeQuery: () => act(() => data().onQ({target: {value: 'cafe'}})),
    clearQuery: () => act(() => data().clearQ()),
    submitSearch: () => act(() => data().qKey(enter)),
    pickResult: () => act(() => { const rows = data().results; assert.equal(rows.length, 1, 'one result row'); rows[0].go(); }),
    pickSaved: () => act(() => data().chips[0].go()),
    closePlace: () => act(() => data().pc.close()),
    openDirections: () => act(() => { harness.locationGranted = false; data().pc.dirs(); }),
    openGrantedDirections: () => act(() => { harness.locationGranted = true; data().pc.dirs(); }),
    locate: () => act(() => data().nativeLocation()),
    async fixArrives(usable) {
      const location = watch(), run = location?.run;
      assert.ok(run?.oneShot, 'the controller holds a one-fix watch');
      await act(() => {
        if (usable) run.onFix({coordinate: here, accuracyMeters: 5, timestamp: Date.now(), precision: 'precise'});
        else { location.run = null; run.onError({code: 'unavailable', message: 'Location unavailable.'}); }
      });
    },
    editOrigin: coordinates => act(() => {
      const bindings = data(), event = {target: {value: coordinates ? typedPoint : typedName}};
      if (bindings.mode === 'origin') bindings.onQ(event); else bindings.onOrigin(event);
    }),
    searchOrigin: () => act(() => { const bindings = data(); if (bindings.mode === 'origin') bindings.qKey(enter); else bindings.originKey(enter); }),
    async chooseOrigin() {
      const bindings = data();
      if (bindings.mode !== 'origin') return act(() => bindings.originKey(enter));
      if (originText() === 'coordinates') return act(() => bindings.qKey(enter));
      if (!bindings.results.length) await act(() => bindings.qKey(enter));
      await act(() => { const rows = data().results; assert.equal(rows.length, 1, 'one starting point row'); rows[0].go(); });
    },
    async routePlanned(ready) {
      const fresh = () => { const request = routes.at(-1); return request && !request.settled && !request.signal.aborted ? request : null; };
      if (!fresh()) await act(() => data().dr.modes.find(choice => choice.on).go());
      const request = fresh();
      assert.ok(request, 'the controller asked the provider for a route');
      request.settled = true;
      await act(() => ready ? request.resolve({providerId, id: `route_fixture_${routes.length}_0123456789`, from: request.from, to: request.to, mode: request.mode,
        geometry: [request.from, request.to], distanceMeters: 100, durationSeconds: 20, attribution, fetchedAt: Date.now(), traffic: 'none',
        steps: [{instruction: 'Arrive', coordinate: request.to, distanceMeters: 100, maneuver: 'arrive'}]}) : request.reject(Error('The route failed.')));
    },
    start: () => act(() => data().dr.start()),
    screenOffStarted: () => act(() => harness.bridge.starts.at(-1).resolve()),
    screenOffRefused: () => act(() => harness.bridge.starts.at(-1).reject(Error('The session could not start.'))),
    screenOffLost: () => act(() => harness.bridge.stopped('unavailable')),
    end: () => act(() => m.document.hidden ? harness.bridge.stopped('notification') : data().dr.nav.end()),
    back: () => act(() => m.mapsModule.back()),
    leave: () => act(() => m.mapsModule.onLeave()),
    hide: () => act(() => m.visibility(true)),
    show: () => act(() => m.visibility(false)),
    agentShowPlace: () => act(() => { void harness.surface.showPlace(place, true).catch(() => {}); }),
    agentShowDirections: () => act(() => { void harness.surface.showDirections(place, 'drive', true).catch(() => {}); }),
    agentPlanFrom: () => act(() => { void harness.surface.planFrom(here).catch(() => {}); }),
    crossAppQuery: () => act(() => { requests++; m.mapsState.query = 'Event place'; }),
    offerHandoff: () => act(() => { harness.held = []; m.render({offer: true}); offered.push(...harness.held); harness.held = null; }),
    consumeHandoff: () => act(() => { for (const run of offered.splice(0)) run(); }),
    async observe() {
      const view = m.render(); await tick();
      const s = screen(), background = harness.host.background, state = s.state, selected = s.selected;
      assert.equal(m.render().mode, view.mode, 'a render changes nothing');
      return {
        mode: modes[view.mode] ?? view.mode, searching: s.searching, hasQuery: !!s.query, results: state?.search.phase === 'ready',
        selected: !selected ? 'none' : selected.origin === 'location' ? 'location' : selected.origin === 'saved' ? 'saved' : 'place',
        directions: s.directions, originMode: s.originMode, navigating: s.navigating,
        screenOff: s.backgroundRunning ? 'running' : background.active() ? 'starting' : 'none', hidden: m.document.hidden,
        locating: s.locating, watch: !!watch()?.run, originText: originText(), origin: !!state?.origin, routeReady: state?.route.phase === 'ready',
        handoffQuery: m.mapsState.query != null, handoffPending: !!harness.inspect().pendingHandoff, requests, handoffs: harness.handoffs,
      };
    },
    close() { m.restore(); },
  };
}

const project = state => {
  const {lastChoice, ...compared} = state;
  return {...compared, mode: modeOf(state)};
};

export async function replayMapsScreenModes({scenarios, witnesses, random = 150, steps = 60}) {
  const traces = modelTraces({...model, scenarios, witnesses, random, steps});
  const code = await bundleMapsAdapter();
  return replayTraces(traces, () => driver(code), {project});
}
