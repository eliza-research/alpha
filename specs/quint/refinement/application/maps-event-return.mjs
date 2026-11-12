import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {checkTraces, qmap} from '../check-traces.mjs';
import {boundInputs, call, captureSources, checkpoint, deferred, read, tick, trace} from './support.mjs';

const driver = fileURLToPath(import.meta.url);
const adapterPath = 'apps/app/src/prototype/maps-adapter.ts';
const helperPath = 'apps/app/src/runtime/maps-event-return.ts';
const marker = '  let returningToEvent: {raw: unknown; abort: AbortController} | undefined;';
const noOrigin = {event: '', kind: ''};
const noAttempt = {origin: 0, aborted: false, settled: false};
const messages = new Map([
  ["Can't check this event. Try again.", 'unknown'],
  ['Allow Calendar access to check this event.', 'permission'],
  ['That event was deleted or moved.', 'missing'],
]);

function compile() {
  const source = read(adapterPath);
  assert.equal(source.split(marker).length, 2, 'Exact Maps event-return state observer');
  const observed = source.replace(marker, marker + '\n  globalThis.inspectEventReturn = () => returningToEvent;');
  const code = [read(helperPath), observed].map(text => stripTypeScriptTypes(text, {mode: 'strip'})
    .replace(/^import .*;\n/gm, '').replace(/^export /gm, '')).join('\n');
  return new vm.Script(code + '\nglobalThis.install = installPrototypeMapsAdapter;');
}

function fixture(compiled) {
  const window = new EventTarget(), document = Object.assign(new EventTarget(), {hidden: false});
  const shell = {pageSuspended: false};
  const mapsModule = {render: () => ({cats: []})};
  const attempts = [], opened = [], notices = [], origins = new Map(), ids = new WeakMap();
  let view = 'home', stack = [], maps = {fromEvent: null}, unwinds = 0, navigating = false, disposed = false;

  function request(kind, input, signal) {
    const raw = maps.fromEvent;
    assert.ok(raw);
    if (kind === 'canonical') {
      assert.equal(raw.version, 2);
      assert.deepEqual({...input}, raw, 'Canonical read receives the exact captured origin fields');
      assert.equal(signal.aborted, false);
    } else {
      assert.equal(raw.version, 1);
      assert.deepEqual({...input}, {begin: raw.begin - 1, end: raw.begin + 1}, 'Native read uses the exact event window');
    }
    const attempt = {...deferred(), raw, kind, signal, settled: false};
    attempts.push(attempt);
    return attempt.promise;
  }

  class ScreenPort {
    view() {return {status: {text: '', visible: false}, query: '', emptyQuery: true, noResults: false, hasResults: false, saved: [], results: [], map: {overlay: {pins: []}}, diagnostics: {}, mode: navigating ? 'navigation' : 'base', showSearch: true};}
    surface() {return {};}
    isNavigating() {return navigating;}
    release() {}
    refresh() {}
    hidden() {}
    unwind() {unwinds++;}
    dispose() {}
  }
  const context = vm.createContext({window, document, AbortController, queueMicrotask,
    registerPlugin: name => name === 'AlphaCalendar' ? {list: input => request('native', input)} : {},
    NavigationVoice: class {}, BackgroundNavigation: class {}, MapsScreenController: ScreenPort,
    mapsConnection: () => undefined, onMapsConnectionChange: () => () => {}, NativeMapsLocation: class {},
    locationPermissionGranted: async () => false, shareMap: () => {}, mapShareLabel: () => 'Share', canShareMap: () => false, isAndroid: false,
    publishMapsSelection: () => {}, clearMapsSelection: () => {},
    bindAgentNavigation: () => ({dispose() {}}), residentMapsNavigationPort: {}, keepCloudMapsCoverage: () => () => {},
    devSurfacesEnabled: true, regionalMapsConfigured: false, regionalMap: () => undefined, cloudMapsBasemap: () => undefined,
    cloudMapsDiagnostics: () => ({}), cloudMapsCoverage: () => undefined, globalBasemap: {attribution: 'Fixture map'},
    describeMapsDisclosure: () => '',
  });
  compiled.runInContext(context);
  const component = {prototype: {renderVals() {}}};
  const stop = context.install(component, {maps: mapsModule});
  component.prototype.renderVals.call(shell);
  window.addEventListener('pagehide', () => {shell.pageSuspended = true;});
  window.addEventListener('pageshow', () => {shell.pageSuspended = false;});

  const api = {
    get S() {return {stack};},
    isActive: () => view === 'maps',
    get(key) {assert.equal(key, 'maps'); return maps;},
    checkCanonicalCalendarReturn: (origin, signal) => request('canonical', origin, signal),
    toast(text) {assert.ok(messages.has(text), text); notices.push(messages.get(text));},
    set(update) {
      assert.deepEqual({...update}, {fromEvent: null});
      maps = {...maps, ...update};
    },
    setView(key, fields) {
      const raw = maps.fromEvent, id = ids.get(raw);
      assert.equal(key, 'calendar');
      assert.deepEqual({...fields}, {...(raw.version === 2 ? {calendarAuthority: 'canonical'} : {}),
        open: raw.rowId, openDay: raw.day, day: raw.day, month: null, form: null});
      opened.push({origin: id, event: fields.open.split('-')[1],
        kind: fields.calendarAuthority === 'canonical' ? 'canonical' : 'native', day: fields.day});
    },
    open(key, options) {
      assert.equal(key, 'calendar');
      assert.deepEqual({...options}, {keepState: true});
      mapsModule.onLeave(api);
      view = key;
    },
    shell(fields) {assert.ok(Array.isArray(fields.stack)); stack = [...fields.stack];},
  };
  function render() {return mapsModule.render(maps, api);}

  return {
    observe() {
      const active = context.inspectEventReturn();
      const activeId = active ? attempts.findIndex(attempt => attempt.token === active) + 1 : 0;
      if (active) assert.ok(activeId, 'The real pending token belongs to an observed dispatch');
      return {'s.view': view, 's.visible': !document.hidden, 's.suspended': shell.pageSuspended,
        's.disposed': disposed, 's.navigating': navigating, 's.calendarStack': stack.at(-1) === 'calendar',
        's.origin': ids.get(maps.fromEvent) ?? 0, 's.lastOrigin': origins.size,
        's.origins': qmap(Array.from({length: 6}, (_, i) => {
          const row = origins.get(i + 1)?.raw;
          return [i + 1, row ? {event: row.id, kind: row.version === 2 ? 'canonical' : 'native'} : noOrigin];
        })),
        's.active': activeId, 's.lastId': attempts.length,
        's.attempts': qmap(Array.from({length: 5}, (_, i) => {
          const attempt = attempts[i];
          return [i + 1, attempt ? {origin: ids.get(attempt.token.raw), aborted: attempt.token.abort.signal.aborted,
            settled: attempt.settled} : noAttempt];
        })),
        's.opened': opened, 's.notices': notices, 's.unwinds': unwinds};
    },
    enter(event, kind) {
      view = 'maps';
      stack = ['calendar'];
      navigating = false;
      const id = origins.size + 1, day = event === 'A' ? 1 : 2;
      const raw = {version: kind === 'canonical' ? 2 : 1, id: event, begin: day * 1000, rowId: 'row-' + event + '-' + id, day, title: event};
      if (kind === 'canonical') Object.assign(raw, {binding: 'fixture-binding', eventKey: 'fixture-' + event,
        revision: 'v1', sourceRevision: 'a'.repeat(64)});
      ids.set(raw, id);
      maps = {fromEvent: raw};
      const callback = render().backToEvent;
      assert.equal(typeof callback, 'function', 'Real Maps renderer exposes return for a captured origin');
      origins.set(id, {raw, callback});
    },
    leave() {mapsModule.onLeave(api); view = 'home'; stack = []; navigating = false;},
    hide() {document.hidden = true; document.dispatchEvent(new Event('visibilitychange'));},
    show() {document.hidden = false; document.dispatchEvent(new Event('visibilitychange'));},
    pagehide() {window.dispatchEvent(new Event('pagehide'));},
    pageshow() {window.dispatchEvent(new Event('pageshow'));},
    dispose() {if (!disposed) {stop(); disposed = true;}},
    setNavigation(value) {navigating = value; render();},
    setStack(calendar) {stack = [calendar ? 'calendar' : 'notes']; render();},
    tap(id) {
      const previous = attempts.length, captured = origins.get(id);
      captured.callback();
      if (attempts.length !== previous) {
        assert.equal(attempts.length, previous + 1);
        const attempt = attempts.at(-1), token = context.inspectEventReturn();
        assert.equal(token.raw, captured.raw, 'Return token retains the exact clicked origin object');
        if (attempt.signal) assert.equal(attempt.signal, token.abort.signal);
        attempt.token = token;
      }
    },
    async reply(id, outcome) {
      const attempt = attempts[id - 1];
      assert.ok(attempt && !attempt.settled);
      attempt.settled = true;
      if (outcome === 'rejected') attempt.reject(Error('Fixture read rejected'));
      else if (attempt.kind === 'canonical') attempt.resolve(outcome);
      else {
        const row = {id: attempt.raw.id, begin: attempt.raw.begin};
        const events = outcome === 'found' ? [row] : outcome === 'ambiguous' ? [row, {...row}] : [];
        const status = outcome === 'permission' ? 'permission-required' : outcome === 'unknown' ? 'error' : 'ready';
        attempt.resolve({status, events});
      }
      await tick();
    },
  };
}

const enter = (event = 'A', kind = 'canonical') => ['enter', event, kind];
const tap = (id = 1) => ['tap', id];
const reply = (id = 1, outcome = 'found') => ['reply', id, outcome];
const started = [enter(), tap()];
const native = [enter('A', 'native'), tap()];
const cases = [
  ['canonical-success-deduplicates-and-returns-exact-row', [...started, tap(), reply()]],
  ['native-success-restores-exact-event', [...native, reply()]],
  ['leave-and-reenter-same-event-does-not-reuse-visit', [...started, ['leave'], enter(), tap(2), reply(), tap(2), reply(2)]],
  ['latest-visit-can-finish-before-old-event', [...started, ['leave'], enter('B'), tap(2), reply(2), reply()]],
  ['stale-missing-after-leave-does-not-withdraw-future-origin', [...started, ['leave'], reply(1, 'missing'), enter('B'), tap(2), reply(2)]],
  ['visible-pagehide-refuses-detached-tap-until-pageshow', [...started, ['pagehide'], tap(), reply(), ['pageshow'], tap(), reply(2)]],
  ['visible-pagehide-old-rejection-keeps-latest-pending', [...started, ['pagehide'], ['pageshow'], tap(), reply(1, 'rejected'), tap(), reply(2)]],
  ['hidden-native-read-retires-even-though-native-port-cannot-abort', [...native, ['hide'], tap(), ['show'], tap(),
    reply(1, 'permission'), reply(2, 'missing')]],
  ['new-origin-replaces-pending-return-within-view', [...started, enter('B'), tap(), tap(2), reply(), reply(2)]],
  ['old-origin-settles-before-new-tap-without-navigating', [...started, enter('B'), reply(), tap(2), reply(2)]],
  ['detached-handler-cannot-start-native-read', [enter('A', 'native'), enter('B', 'native'), tap(), tap(2), reply()]],
  ['changed-stack-withholds-completion-and-allows-later-retry', [...started, ['setStack', false], reply(),
    ['setStack', true], tap(), reply(2)]],
  ['active-guidance-withholds-completion-and-reads', [...started, ['setNavigation', true], tap(), reply(),
    ['setNavigation', false], tap(), reply(2)]],
  ['permission-refusal-keeps-exact-native-origin', [...native, reply(1, 'permission'), tap(), reply(2)]],
  ['unknown-and-rejected-canonical-reads-keep-exact-origin', [...started, reply(1, 'unknown'), tap(),
    reply(2, 'rejected'), tap(), reply(3)]],
  ['confirmed-missing-withdraws-origin-and-fences-detached-tap', [...started, reply(1, 'missing'), tap()]],
  ['ambiguous-native-read-withdraws-origin', [...native, reply(1, 'ambiguous'), tap()]],
  ['disposed-owner-ignores-native-settlement-and-detached-tap', [...native, ['dispose'], tap(), reply()]],
];

export async function checkMapsEventReturn(extraSources = []) {
  const sources = [adapterPath, helperPath, driver, ...extraSources];
  captureSources(sources);
  const compiled = compile(), traces = [];
  for (const [name, steps] of cases) {
    const f = fixture(compiled), t = trace(name, f.observe());
    try {
      for (const [operation, ...args] of steps) {
        await f[operation](...args);
        checkpoint(t, [operation, ...args].join(' '), call(operation, ...args), f.observe());
      }
      traces.push(t);
    } finally {f.dispose();}
  }
  return checkTraces(boundInputs({model: 'MapsEventReturn', sources, traces, scope: 'bounded-orchestration',
    assumptions: [
      'Executes the current Maps adapter and canonical/native origin helpers through the actual render bindings, with a read-only observer for its private return token.',
      'The screen, shell and native/Calendar ports supply two events, six exact origin objects and five attempts. Browser renderer regressions separately drive real navigation, pagehide and late canonical service readback.',
      'Native provider records and canonical readback outcomes are controlled. Installed-provider effects, screen rendering geometry and detailed route guidance have separate scope.',
    ]}));
}
