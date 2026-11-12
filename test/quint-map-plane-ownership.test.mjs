import test from 'node:test';
import assert from 'node:assert/strict';
import {modelNames, modelTraces, replayTraces, repositoryRoot} from '../specs/quint/refinement/services/maps-model-traces.mjs';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';
import {createMapsNotificationOpen} from '../apps/app/src/runtime/maps-notification-open.ts';
import {stripTypeScriptTypes} from './support/strip-types.mjs';

/** Replays MapPlaneOwnership model traces against the Maps adapter's map plane handling.
 *
 * What runs: installPrototypeMapsAdapter of apps/app/src/prototype/maps-adapter.ts with the
 * Calendar return helpers it uses, through the bindings its render returns (`mapRef`,
 * `retryNativeMap`) and the `released` port it hands the screen. The map plane class, the
 * mutation observer, the screen controller and the shell are controlled ports. The screen port
 * records the map state it is told and shows the map as loading again on a retry, as the shared
 * screen does. A read-only observer exposes the adapter's private plane, generation and
 * copyright line.
 *
 * Observation: planes are named by the generation they were built under; `built` and `destroyed`
 * are the plane objects the port constructed and was asked to destroy; `reports` pairs every map
 * state the screen was told with the plane whose callback told it and the generation then in
 * place. A plane's ready and loading events arrive through its mutation observer and are not
 * delivered once the adapter disconnected it. */

const model = {path: 'specs/quint/application/MapPlaneOwnership.qnt', module: 'MapPlaneOwnership'};
const adapterPath = 'apps/app/src/prototype/maps-adapter.ts', helperPath = 'apps/app/src/runtime/maps-event-return.ts';
const marker = "  let mapCopyright='';";
// A scenario action that describes behaviour the code does not have; a trace ends before it.
const counterfactual = new Set(['unfencedEvent']);
const tick = () => new Promise(resolve => setImmediate(resolve));

function compile() {
  const read = path => readFileSync(join(repositoryRoot, path), 'utf8');
  const source = read(adapterPath);
  assert.equal(source.split(marker).length, 2, 'one map plane state declaration to observe');
  const observed = source.replace(marker, marker + '\n  globalThis.inspectMapPlane = () => ({generation: mapGeneration, plane, planeElement, planeBasemap, mapCopyright});');
  // Use the actual product policy helpers without the unrelated upstream provider exports.
  const policy = read('apps/app/src/maps/cloud-provider.ts').replace(/^export \*.*;\n/gm,'');
  const code = [read(helperPath), policy, observed].map(text => stripTypeScriptTypes(text, {mode: 'strip'})
    .replace(/^import .*;\n/gm, '').replace(/^export /gm, '')).join('\n');
  return new vm.Script(code + '\nglobalThis.install = installPrototypeMapsAdapter;');
}

function driver(compiled) {
  const window = new EventTarget(), document = Object.assign(new EventTarget(), {hidden: false});
  const globalBasemap = {kind: 'global', attribution: 'Fixture world map'};
  const basemaps = [null, globalBasemap, {kind: 'cloud-raster', attribution: 'Fixture raster A'}, {kind: 'cloud-raster', attribution: 'Fixture raster B'}];
  const elements = [null, {dataset: {}, replaceChildren() {}}, {dataset: {}, replaceChildren() {}}];
  const planes = new Map(), destroyed = new Set(), reports = [];
  const probe = {host: null, mapState: 'loading', retries: 0, calls: 0, failNext: false, source: 0};
  let basemap = 1, active = true, disposed = false, lastEvent = 'none', newest = null, events = 0;
  const context = vm.createContext({window, document, AbortController, queueMicrotask, setTimeout, createMapsNotificationOpen,
    googleMapsLogo: 'fixture-google-logo.svg',
    registerPlugin: () => ({}), NavigationVoice: class {}, BackgroundNavigation: class {}, NativeMapsLocation: class {},
    Capacitor: {isNativePlatform: () => false}, isAndroid: false,
    MapsScreenController: class {
      constructor(host) { probe.host = host; }
      view() { return {status: {text: '', visible: false}, saved: [], results: [], mode: 'base', showSearch: true, map: {overlay:{}}, diagnostics: {}}; }
      surface() { return {snapshot() {}}; }
      isNavigating() { return false; }
      setMapState(state) { probe.calls++; probe.mapState = state; reports.push({source: probe.source, generation: context.inspectMapPlane().generation}); }
      refresh() { probe.calls++; }
      retryMap() { probe.retries++; probe.mapState = 'loading'; }
      pin() {} release() {} hidden() {} dispose() {}
    },
    MapPlane: class {
      constructor(element, region, onError, colors, onPin, onCopyright) {
        assert.equal(region, basemaps[basemap], 'the plane is built for the basemap the screen draws now');
        if (probe.failNext) throw Error('The map plane could not be built.');
        Object.assign(this, {element, onError, onCopyright, generation: context.inspectMapPlane().generation, observer: null});
        planes.set(this.generation, newest = this);
      }
      update() {}
      destroy() { destroyed.add(this.generation); }
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.connected = false; newest.observer = this; }
      observe(element) { assert.equal(element, newest.element); this.connected = true; }
      disconnect() { this.connected = false; }
    },
    mapsConnection: () => ({config: {status: 'unconfigured'}}), onMapsConnectionChange: () => () => {},
    locationPermissionGranted: () => false, shareMap: () => {}, publishMapsSelection: () => {}, clearMapsSelection: () => {},
    bindAgentNavigation: () => ({registered: () => false, dispose() {}}), residentMapsNavigationPort: {relay: false}, keepCloudMapsCoverage: () => () => {},
    regionalMapsConfigured: false, regionalMap: () => undefined, cloudMapsBasemap: () => basemap === 1 ? undefined : basemaps[basemap],
    cloudMapsDiagnostics: () => ({configured: false, error: ''}), cloudMapsCoverage: () => undefined, globalBasemap,
    describeMapsDisclosure: () => '',
  });
  compiled.runInContext(context);
  const mapsModule = {render: () => ({cats: [], C: {}})};
  const component = {prototype: {renderVals() {}}};
  const stop = context.install(component, {maps: mapsModule});
  const api = {S: {stack: []}, name: 'Alpha', isActive: () => active, get: () => ({}), set() {}, toast() {}, send() {}};
  const render = () => mapsModule.render({}, api);
  async function during(source, run) {
    const before = probe.calls;
    probe.source = source; run(); await tick();
    return probe.calls > before;
  }
  return {
    async render(element, constructs) {
      probe.failNext = !constructs;
      // A build that fails tells the screen from a microtask, under the generation it was attempted in.
      const data = render();
      probe.source = 0;
      data.mapRef(elements[element]);
      await during(context.inspectMapPlane().generation, () => {});
      probe.failNext = false;
    },
    setBasemap(next) { basemap = next; },
    async planeEvent(source, kind) {
      const plane = planes.get(source);
      assert.ok(plane, `the code built a plane under generation ${source}`);
      const applied = await during(source, () => {
        if (kind === 'error') plane.onError();
        else if (kind === 'copyright') plane.onCopyright(`c${source}-${++events}`);
        else if (plane.observer?.connected) {
          if (kind === 'ready') plane.element.dataset.mapReady = 'true'; else delete plane.element.dataset.mapReady;
          plane.observer.callback();
        }
      });
      lastEvent = applied ? 'applied' : 'ignored';
    },
    async retry() { const data = render(); await during(0, () => data.retryNativeMap()); },
    async release() { await during(0, () => probe.host.released()); },
    setActive(flag) { active = flag; },
    dispose() { stop(); disposed = true; },
    observe() {
      const held = context.inspectMapPlane(), copyright = /^c(\d+)-/.exec(held.mapCopyright);
      return {
        active, disposed, basemap, planeElement: Math.max(0, elements.indexOf(held.planeElement ?? null)),
        planeBasemap: Math.max(0, basemaps.indexOf(held.planeBasemap ?? null)), generation: held.generation,
        plane: held.plane?.generation ?? 0, built: [...planes.keys()].sort(), destroyed: [...destroyed].sort(),
        mapState: probe.mapState, reports: [...new Set(reports.map(report => `${report.source}:${report.generation}`))].sort(),
        copyrightFrom: copyright ? Number(copyright[1]) : 0, retries: probe.retries, lastEvent,
      };
    },
    close() { if (!disposed) stop(); },
  };
}

const project = state => ({...state, reports: state.reports.map(report => `${report.source}:${report.generation}`).sort()});

async function replayMapPlaneOwnership({scenarios, witnesses, random = 60, steps = 30}) {
  const traces = modelTraces({...model, scenarios, witnesses, random, steps}).map(trace => {
    const end = trace.steps.findIndex(step => counterfactual.has(step.action));
    return end < 0 ? trace : {...trace, steps: trace.steps.slice(0, end)};
  });
  const compiled = compile();
  return replayTraces(traces, () => driver(compiled), {project});
}

test('the Maps adapter map plane handling follows every MapPlaneOwnership model trace step by step', {timeout: 300000}, async () => {
  const {scenarios, witnesses} = modelNames('specs/quint/application/MapPlaneOwnership.qnt');
  assert.equal(scenarios.length, 7);
  assert.equal(witnesses.length, 5);
  const result = await replayMapPlaneOwnership({scenarios, witnesses});
  console.log(JSON.stringify(result));
  assert.equal(result.traces, scenarios.length + witnesses.length + 60);
  assert.ok(result.checkpoints > result.traces * 5);
  for (const action of ['render', 'setBasemap', 'planeEvent', 'retry', 'release', 'setActive', 'dispose']) assert.ok(result.actions[action] > 0, action);
});
