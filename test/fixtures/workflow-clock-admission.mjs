import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {stripTypeScriptTypes} from '../support/strip-types.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const clock = 'apps/app/src/prototype/clock-adapter.ts';
const agent = 'apps/app/src/prototype/agent-adapter.ts';
const shellSource = 'apps/app/src/prototype/model.js';
const template = 'apps/app/src/prototype/template.html';
const shared = 'vendor/eliza/plugins/plugin-assistant/src/services/device-actions/';
const dependencyPaths = ['apps/app/src/runtime/clock-contract.ts', 'apps/app/src/runtime/clock-handoff-history.ts',
  'apps/app/src/runtime/inline-modal.ts', 'apps/app/src/runtime/modal-inert.ts',
  ...['clock-contract.ts', 'clock-handoff.ts', 'clock-handoff-history.ts'].map(path => shared+path)];
export const workflowClockSources = [clock, agent, shellSource, template, 'apps/app/src/main.tsx',
  'scripts/test-clock-handoff-flow.ts', 'test/support/strip-types.mjs', ...dependencyPaths];
const read = path => readFileSync(resolve(root, path), 'utf8');
const strip = text => stripTypeScriptTypes(text, {mode: 'strip'});
const settle = () => new Promise(resolve => setImmediate(resolve));

export async function loadWorkflowClockFixture() {
  const bundle = await build({absWorkingDir: root, stdin: {resolveDir: root, contents: `
    export {currentClockTimeZone,buildClockRequest,describeClockDays} from './${dependencyPaths[0]}';
    export {createClockHandoffHistory,clockHandoffLegacyKey,clockHandoffSlot} from './${dependencyPaths[1]}';
    export {createInlineModal} from './${dependencyPaths[2]}';`}, bundle: true, write: false, metafile: true,
  format: 'esm', platform: 'node', plugins: [{name: 'authenticated-clock-source', setup(build) {
    const marker = '.eliza/client-features/';
    build.onResolve({filter: /\.eliza\/client-features\//}, args => {
      const path = 'vendor/eliza/' + args.path.slice(args.path.indexOf(marker) + marker.length);
      assert.ok(dependencyPaths.includes(path), path);
      return {path: resolve(root, path)};
    });
  }}]});
  const inputs = Object.keys(bundle.metafile.inputs).filter(path => path !== '<stdin>');
  assert.deepEqual(new Set(inputs), new Set(dependencyPaths));
  const bindings = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
  const installer = strip(read(clock).replace(/^import .*?;\n/gm, '').replace(/^export /gm, ''));
  const agentText = read(agent);
  const contextStart = agentText.indexOf('  function context(shell: Shell) {');
  const contextEnd = agentText.indexOf('  p.componentDidMount', contextStart);
  assert.ok(contextStart >= 0 && contextEnd > contextStart);
  const context = strip(agentText.slice(contextStart, contextEnd));
  const shellText = read(shellSource);
  const leaveStart = shellText.indexOf('  leave() {');
  const leaveEnd = shellText.indexOf('\n\n  preset(', leaveStart);
  assert.ok(leaveStart >= 0 && leaveEnd > leaveStart);
  const leave = vm.runInNewContext(`({${shellText.slice(leaveStart, leaveEnd)}}).leave`);

  const templateText = read(template);
  const start = templateText.indexOf('<sc-if value="{{is.workflows}}">');
  assert.ok(start >= 0);
  // The compiler normally substitutes CSS holes. This fixture resolves only action bindings.
  const dom = new JSDOM(templateText.slice(start).replace(/\sstyle="[^"]*"/g, ''));
  const node = dom.window.document;
  const route = node.querySelector('sc-if[value="{{is.workflows}}"]');
  const page = route.querySelector('[data-alpha-clock-page]');
  assert.equal(page.closest('sc-if').getAttribute('value'), '{{workflows.clock}}');
  const binding = (within, selector) => {
    const text = within.querySelector(selector)?.getAttribute('onclick');
    assert.match(text, /^\{\{workflows\.[\w.]+\}\}$/);
    return text.slice(2, -2).split('.').slice(1);
  };
  const alarms = 'button[aria-label="Clock alarms"]';
  const routes = {
    chooser: binding(route, `.automation-new ${alarms}`), list: binding(route, `.workflow-list ${alarms}`),
    review: binding(page, 'button[aria-label="Review Clock request"]'),
    approve: binding(page, 'button[aria-label="Confirm Clock request"]'), close: binding(page, 'button[aria-label="Close Clock"]'),
  };
  dom.window.close();
  return (browser, testMocksEnabled) => fixture({bindings, installer, context, leave, routes, browser, testMocksEnabled});
}

function fixture({bindings, installer, context, leave, routes, browser, testMocksEnabled}) {
  const state = {view: 'workflows', screen: 'home'};
  let hidden = false, selected, slot = null, saveOpening, finishHandoff, reviewRun, oldOpener, clockDraftId;
  const requests = [], shows = [], updates = [];
  const document = Object.assign(new EventTarget(), {documentElement: {dataset: {connectionMode: 'live'}}, querySelector: () => null});
  Object.defineProperty(document, 'hidden', {get: () => hidden});
  const window = new EventTarget();
  const views = {workflows: {render: () => ({}), onLeave: () => {updates.push('leave');}}};
  const api = {isActive: () => state.view === 'workflows', toast: () => assert.fail('Unexpected browser Clock error')};
  const secureConnectionStore = {
    read: async () => structuredClone(slot),
    async compareExchange(key, expected, value) {
      assert.equal(key, bindings.clockHandoffSlot);
      if (value.record.status === 'opening') await new Promise(resolve => {saveOpening = resolve;});
      assert.deepEqual(structuredClone(expected), slot);
      slot = structuredClone(value);
      return {status: 'saved'};
    },
  };
  const DailyApps = {
    surfaceInfo: async () => ({clockRepeatDaysVersion: 1}),
    async clockHandoff(input) {
      if (browser) {
        assert.deepEqual(structuredClone(input), {action: 'show', reviewed: true});
        shows.push(input);
        return {action: 'show', status: 'opened', message: 'Synthetic browser show'};
      }
      assert.equal(slot.record.status, 'opening');
      assert.equal(input.reviewed, true);
      requests.push(input);
      return new Promise(resolve => {finishHandoff = resolve;});
    },
  };
  const alphaClient = {setViewContext(value) {selected = value;}, getState: () => ({context: selected})};
  const readContext = vm.runInNewContext(`${context}\ncontext`, {...bindings, document, alphaClient,
    connectionController: {getSnapshot: () => ({open: false})}, syncPreviousNotesAvailability() {},
    updateBackAvailability() {}, recoverPendingActions() {}});
  class Shell {
    componentDidMount() {}
    componentWillUnmount() {}
    S() {return state;}
    vget() {return {};}
    vset(view) {assert.equal(view, 'workflows');readContext(this);}
    clear() {}
    stopEvery() {}
    mod(view) {return views[view] ?? {};}
    api() {return api;}
    workflowSelection() {return {kind: 'workflow', id: 'synthetic-workflow', revision: 'version-1'};}
  }
  vm.runInNewContext(`${installer}\ninstallClockAdapter(Shell,views,{browser,simulated:false});`, {
    ...bindings, Shell, views, browser, testMocksEnabled, DailyApps, secureConnectionStore,
    document, window, localStorage: {getItem: () => null}, crypto: {randomUUID}, Intl, Date,
  });
  const shell = new Shell();
  shell.componentDidMount();
  const render = () => views.workflows.render({}, api);
  const callback = route => routes[route].reduce((value, key) => value[key], render());
  const navigate = view => {
    if (view !== state.view) leave.call(shell);
    state.view = view;
    readContext(shell);
  };
  const observe = () => {
    readContext(shell);
    const out = render();
    const item = selected.selectedObject;
    assert.equal(selected.view, state.view);
    assert.equal(selected.sensitive, hidden);
    if (item?.kind === 'clock-draft') {
      clockDraftId ??= item.id;
      assert.equal(item.id, clockDraftId);
      assert.equal(shell.clockSelection().revision, item.revision);
    }
    return {browser, view: state.view, shown: !!out.clock, review: !!out.clock?.review,
      selection: item?.kind ?? 'none', hidden, mock: document.documentElement.dataset.connectionMode === 'mock',
      phase: saveOpening ? 'saving' : finishHandoff ? 'dispatching' : 'idle', record: slot?.record.status ?? 'none',
      handoffs: requests.length, shows: shows.length};
  };
  return {
    settle, observe, navigate, remember: () => {oldOpener = callback('chooser');},
    open: async (source = 'chooser') => {if (source === 'stale') oldOpener();else callback(source)();await settle();},
    review: () => {const previous = shell.clockSelection().revision;callback('review')();
      assert.ok(Number(shell.clockSelection().revision) > Number(previous));},
    approve: async () => {reviewRun = callback('approve')();await settle();},
    close: () => callback('close')(),
    back: () => {const event = new Event('alpha-back', {cancelable: true});window.dispatchEvent(event);assert.ok(event.defaultPrevented);},
    mock: value => {document.documentElement.dataset.connectionMode = value ? 'mock' : 'live';},
    visibility: async value => {hidden = value;document.dispatchEvent(new Event('visibilitychange'));await settle();},
    release: async () => {const resolve = saveOpening;assert.ok(resolve);saveOpening = null;resolve();await settle();},
    finish: async status => {const resolve = finishHandoff;assert.ok(resolve);finishHandoff = null;
      resolve({action: requests.at(-1).action, status, message: 'Synthetic Clock response'});await reviewRun;},
    assertDeparted: () => assert.ok(updates.includes('leave')),
    assertMessage: pattern => assert.match(render().clock.message, pattern),
    unmount: () => {assert.ok(!saveOpening && !finishHandoff);shell.componentWillUnmount();},
  };
}
