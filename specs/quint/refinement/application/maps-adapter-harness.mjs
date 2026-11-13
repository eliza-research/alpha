/** The Maps adapter with the shared Maps screen, mounted over controlled ports.
 *
 * What runs: installPrototypeMapsAdapter of apps/app/src/prototype/maps-adapter.ts bundled with
 * the code it composes: the shared MapsScreenController, MapsController, saved places,
 * BackgroundNavigation, bindAgentNavigation and DeviceMapsNavigation, the provider runtime and
 * the Calendar return helpers. Ports: the native plugins, the location owners, the Cloud Maps
 * read, the connection controller, the map plane, the guidance voice, the share sheet, the
 * shell and its Maps view state, `document`, `window` and `localStorage`. The Maps provider is a
 * scripted object installed through the real configureMapsProvider.
 *
 * The adapter's own microtasks go through a queue the caller can hold, so a step can stand
 * between a render and the work that render queued. A read-only observer exposes the adapter's
 * private hand-off latch; the screen instance, its host object and the agent surface are kept
 * as the adapter created them. Each mount evaluates the bundle again: the provider runtime and
 * the navigation port are module state. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {build} from 'esbuild';
import {repositoryRoot} from '../services/maps-model-traces.mjs';

const app = path => join(repositoryRoot, 'apps/app/src', path);
const adapterFile = app('prototype/maps-adapter.ts');
const latch = '  let pendingHandoff: {query:string}|undefined, mapsController:MapsController|undefined;';
const ports = new Map(Object.entries({
  'runtime/action-message-presentation.ts': 'export const mapsChatText=text=>({cards:[],displayText:text});',
  'platform-plugins.ts': 'export const registerPlugin=name=>globalThis.mapsHarness.plugin(name);',
  'daily.ts': 'export const DailyApps=globalThis.mapsHarness.daily;',
  'native.ts': 'export const isAndroid=false;',
  'maps/navigation-voice.ts': 'export class NavigationVoice{enabled=false;update(){}pause(){}toggle(){this.enabled=!this.enabled;}}',
  'maps/share.ts': 'export const shareMap=async()=>"closed";',
  'maps/map-plane.ts': 'export class MapPlane{update(){}destroy(){}}',
  'maps/regional-provider.ts': 'export const regionalMapsConfigured=false,regionalMap=()=>undefined,regionalDiagnostics=()=>({configured:false,error:""}),initializeRegionalMaps=async()=>{};',
  'maps/cloud-maps.ts': 'const cloud=globalThis.mapsHarness.cloud;export const initializeCloudMaps=()=>cloud.initialize(),cloudMapsCoverage=()=>cloud.coverage,cloudMapsDiagnostics=()=>cloud.diagnostics,cloudMapsBasemap=()=>undefined;',
  'maps/native-location.ts': `const harness=globalThis.mapsHarness;
    export class NativeMapsLocation{
      constructor(){this.run=null;harness.locations.push(this);}
      awaitingPermission(){return false;}
      start(oneShot,onFix,onError){this.run={oneShot,onFix,onError};return Promise.resolve();}
      stop(){this.run=null;return Promise.resolve();}
    }
    export const locationPermissionGranted=async()=>harness.locationGranted;`,
  'runtime/connection-ui.ts': 'export const connectionController=globalThis.mapsHarness.connection;',
  'runtime/cloud-protocol.ts': 'export const cloudServiceName="Cloud";',
  'maps/screen.ts': `import {MapsScreenController as Shared} from ${JSON.stringify(join(repositoryRoot, '.eliza/client-features/plugins/plugin-maps/src/client/maps-screen.ts'))};
    const harness=globalThis.mapsHarness;
    export class MapsScreenController extends Shared{
      constructor(host){super(host);harness.screen=this;harness.host=host;}
      handoff(text,fromEvent){harness.handoffs++;return super.handoff(text,fromEvent);}
      surface(present){const surface=super.surface(present);harness.surface=surface;return surface;}
    }`,
}).map(([path, code]) => [app(path), code]));

/** The bundle text; mount it once per trace. */
export async function bundleMapsAdapter() {
  const result = await build({
    absWorkingDir: repositoryRoot, bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent',
    stdin: {resolveDir: repositoryRoot, loader: 'ts', contents: `
      export {installPrototypeMapsAdapter} from './apps/app/src/prototype/maps-adapter.ts';
      export {configureMapsProvider} from './apps/app/src/maps/runtime.ts';
      export {residentMapsNavigationPort} from './apps/app/src/maps/agent-navigation.ts';`},
    plugins: [{name: 'ports', setup(builder) {
      builder.onResolve({filter: /^@capacitor\/core$/}, () => ({path: 'capacitor', namespace: 'port'}));
      builder.onResolve({filter: /\.svg\?url$/}, () => ({path: 'asset', namespace: 'port'}));
      builder.onResolve({filter: /^\./}, args => {
        const bare = join(args.resolveDir, args.path), path = /\.(ts|js)$/.test(bare) ? bare : bare + '.ts';
        return ports.has(path) ? {path, namespace: 'port'} : undefined;
      });
      builder.onLoad({filter: /.*/, namespace: 'port'}, args => ({
        contents: args.path === 'capacitor' ? 'export const Capacitor={isNativePlatform:()=>true,isPluginAvailable:()=>true};'
          : args.path === 'asset' ? 'export default "fixture-asset.svg";' : ports.get(args.path),
        loader: 'js', resolveDir: repositoryRoot,
      }));
      builder.onLoad({filter: /maps-adapter\.ts$/}, args => {
        if (args.path !== adapterFile) return undefined;
        const source = readFileSync(args.path, 'utf8');
        assert.equal(source.split(latch).length, 2, 'one hand-off latch declaration to observe');
        return {loader: 'ts', contents: source
          .replace(latch, latch + '\n  globalThis.mapsHarness.inspect = () => ({pendingHandoff, shell, disposed});')
          .replaceAll('queueMicrotask(', 'globalThis.mapsHarness.microtask(')};
      });
    }}],
  });
  return result.outputFiles[0].text;
}

export const tick = () => new Promise(resolve => setImmediate(resolve));
export const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };
export const providerId = 'eliza-cloud-osm', connectionId = 'conn_refinement_fixture_1234', attribution = 'Fixture map attribution';
export const providerConfig = {status: 'configured', providerId, connectionId, revision: 'revision',
  capabilities: {map: false, search: true, placeDetails: true, modes: ['drive', 'walk'], traffic: 'none', transit: 'none', offline: {map: false, search: false, routing: false}}};

let mounts = 0;
/**
 * Mounts the adapter. `storage` seeds localStorage; `configure(app, harness)` runs after the
 * bundle is evaluated and before the adapter is installed; `view` is the launcher view in front;
 * `onSet(patch)` is told every Maps view state write, as the shell that renders on one would be.
 */
export async function mountMapsAdapter(code, {storage = {}, configure, view = 'maps', onSet} = {}) {
  const saved = {document: globalThis.document, window: globalThis.window, localStorage: globalThis.localStorage};
  const document = globalThis.document = Object.assign(new EventTarget(), {
    hidden: false, querySelector: () => null,
    documentElement: {classList: {contains: () => false}},
  });
  const window = globalThis.window = Object.assign(new EventTarget(), {open() {}});
  const stored = new Map(Object.entries(storage));
  globalThis.localStorage = {getItem: key => stored.has(key) ? stored.get(key) : null, setItem: (key, value) => { stored.set(key, String(value)); }};
  const bridgeListeners = new Set();
  const harness = globalThis.mapsHarness = {
    locations: [], locationGranted: true, handoffs: 0, screen: null, host: null, surface: null, inspect: null,
    held: null,
    /** Runs the adapter's microtasks at once, or keeps them while `held` is a list. */
    microtask(run) { if (harness.held) harness.held.push(run); else queueMicrotask(run); },
    cloud: {coverage: undefined, diagnostics: {configured: true, error: ''}, initialize: async () => {}},
    connection: {
      snapshot: {open: false, busy: false, session: null}, client: null, listeners: new Set(),
      getSnapshot() { return this.snapshot; }, getCloudClient() { return this.client; },
      getSelectedConversationId: () => 'conversation', subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); },
    },
    daily: {perform: async () => ({status: 'opened'}), capabilities: async () => ({actions: []}), surfaceInfo: async () => ({})},
    /** The native screen-off session: every start stays pending until the trace settles it. */
    bridge: {
      starts: [], stops: [],
      navigationAvailability: async () => ({background: true}),
      addListener: async (name, listener) => { bridgeListeners.add(listener); return {remove: async () => { bridgeListeners.delete(listener); }}; },
      startNavigation(input) { const start = {...deferred(), sessionId: input.sessionId}; this.starts.push(start); return start.promise; },
      updateNavigation: async () => ({active: true}),
      stopNavigation: async input => { harness.bridge.stops.push(input.sessionId); return {stopped: true}; },
      stopped(reason) { const sessionId = this.starts.at(-1)?.sessionId; for (const listener of [...bridgeListeners]) listener({sessionId, reason}); },
    },
    plugin: name => name === 'AlphaMapsTransport' ? harness.bridge : name === 'AlphaCalendar' ? {list: async () => ({status: 'unknown'})} : {openSettings: async () => {}},
  };
  const app = await import('data:text/javascript;base64,' + Buffer.from(code + `\n//${++mounts}`).toString('base64'));
  await configure?.(app, harness);
  // The shell as the adapter reads it: one launcher state value and the Maps view's own state.
  const shellState = {screen: 'home', secure: false, shade: false, view, stack: []};
  const mapsState = {query: null, fromEvent: null};
  const mapsModule = {render: () => ({cats: [], C: {}, nativeModeMetadata: [{mode: 'drive', label: 'Drive', d: ''}, {mode: 'walk', label: 'Walk', d: ''}]})};
  const shell = {
    live: true, pageSuspended: false, props: {assistantSurface: false}, opened: [], commits: [],
    S: () => shellState, openView(view) { this.opened.push(view); }, setState(patch, done) { if (done) this.commits.push(done); },
  };
  const component = {prototype: {renderVals() { return {}; }}};
  const stop = app.installPrototypeMapsAdapter(component, {maps: mapsModule});
  component.prototype.renderVals.call(shell);
  let renders = 0;
  const api = {
    S: shellState, name: 'Alpha', isActive: () => shellState.view === 'maps', get: () => mapsState,
    set(patch) { Object.assign(mapsState, patch); onSet?.(patch); }, toast() {}, send() {}, setView() {}, open() {}, shell() {},
  };
  return {
    app, harness, document, window, shell, shellState, mapsState, mapsModule, api,
    /** The bindings of a render. `offer` lets the render see the Maps view's one-use query. */
    render({offer = false} = {}) { renders++; return mapsModule.render(offer ? {...mapsState} : {...mapsState, query: null}, api); },
    renders: () => renders,
    visibility(hidden) { document.hidden = hidden; document.dispatchEvent(new Event('visibilitychange')); },
    stop,
    restore() { stop(); Object.assign(globalThis, saved); delete globalThis.mapsHarness; },
  };
}
