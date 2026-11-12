import test from 'node:test';
import assert from 'node:assert/strict';
import {modelTraces, replayTraces, loadBundled, installDocument, settle} from '../specs/quint/refinement/application/browser-model-traces.mjs';

/** Replays BrowserSurfaceNavigation traces against the web build's real `BrowserSurface` plugin in a
 * jsdom document.
 *
 * Abstraction: the model's frame numbers are the iframe elements in the order the surface created
 * them; `frameLoad(n)` dispatches a load event on the n-th element. `loadable` and `navigationFrame`
 * are derived from the driver's own record of which elements a navigation created; `staleCommit` is
 * a model-only ghost. The saved-bookmark and saved-tabs documents are not used by these actions. */

const model = {path: 'specs/quint/application/BrowserSurfaceNavigation.qnt', module: 'BrowserSurfaceNavigation'};
const scenarios = ['retiredFrameLoadTest', 'stoppedLoadNeverCommitsTest', 'innerNavigationTest', 'historyCommandsTest', 'closedTabIgnoresLoadTest'];
const witnesses = ['LateLoadPendingWitness', 'InnerNavigationWitness', 'StoppedWitness'];
const tab = {session: 'session', id: 'tab'};

async function browserSurfaceNavigationDriver() {
  const load = await loadBundled('apps/app/src/browser/browser-surface.ts', {
    './preference-documents': 'const unused={read(){throw Error("unused")},edit(){throw Error("unused")}};export const bookmarkDocument=unused,browsingSessionDocument=unused;'});
  return async () => {
    const dom = await installDocument();
    const {window, document} = dom;
    const {BrowserSurface} = await load();
    const surface = new BrowserSurface();
    const frames = [], addressed = new Set();
    let pages = 0, lastEvent;
    await surface.addListener('stateChanged', event => { lastEvent = event; });
    // Elements are numbered as the surface puts them in the tab.
    const note = navigated => {
      const frame = document.querySelector('[data-browser-surface] iframe');
      if (frame && !frames.includes(frame)) { frames.push(frame); if (navigated) addressed.add(frames.length); }
    };
    const command = name => async () => { await surface.command({...tab, command: name}); note(name !== 'stop'); await settle(); };
    return {
      async create() { await surface.create(tab); note(false); },
      async navigate() { await surface.navigate({...tab, url: `https://example.test/page-${++pages}`}); note(true); await settle(); },
      back: command('back'), forward: command('forward'), reload: command('reload'), stop: command('stop'),
      async frameLoad(id) { frames[id - 1].dispatchEvent(new window.Event('load')); await settle(); },
      async close() { await surface.close(tab); lastEvent = undefined; },
      observe() {
        const state = surface.tabs.get('session:tab');
        const error = !state?.error ? '' : state.error === 'Stopped' ? 'stopped' : state.error === 'Page blocked' ? 'inner-navigation' : state.error;
        if (state && lastEvent) {
          // What listeners were told matches the tab the surface holds.
          if (lastEvent.navigation !== state.navigation || lastEvent.loading !== state.loading || lastEvent.committed !== state.committed) throw Error('stateChanged disagrees with the tab');
        }
        return {exists: !!state, entries: state ? state.history.length : 0, position: state ? state.position : -1,
          navigation: state ? state.navigation : 0, loading: !!state?.loading, committed: !!state?.committed, error,
          frame: frames.length, frameShown: !state || frames.indexOf(state.frame) + 1 === frames.length && state.frame.isConnected,
          loadable: [...addressed].sort((a, b) => a - b)};
      },
      teardown() { dom.restore(); },
    };
  };
}

async function checkBrowserSurfaceNavigation({random = 40, steps = 30} = {}) {
  const create = await browserSurfaceNavigationDriver();
  const traces = modelTraces({...model, scenarios, witnesses, random, steps});
  return replayTraces(traces, create,
    {project: s => ({exists: s.exists, entries: s.entries, position: s.position, navigation: s.navigation, loading: s.loading, committed: s.committed,
      error: s.error, frame: s.frame, frameShown: true, loadable: s.loadable})});
}

test('the web browser surface follows every BrowserSurfaceNavigation trace', {timeout: 240000}, async () => {
  const receipt = await checkBrowserSurfaceNavigation();
  assert.equal(receipt.traces, 48);
  assert.ok(receipt.checkpoints > 1000, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['create', 'navigate', 'back', 'forward', 'reload', 'stop', 'frameLoad', 'close'])
    assert.ok(receipt.actions[action] > 0, `${action} is replayed`);
});
