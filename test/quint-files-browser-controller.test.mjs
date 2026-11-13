import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {checkTraces, qset, qmap} from '../specs/quint/refinement/check-traces.mjs';
import {root, captureSources, boundInputs, deferred, tick, call, trace, checkpoint} from '../specs/quint/refinement/application/support.mjs';

const driver = fileURLToPath(import.meta.url);
const source = '.eliza/client-features/plugins/plugin-files/src/browser/files-browser-adapter.ts';
const ids = Array.from({length: 6}, (_, i) => i + 1);
const paths = {Download: 1, 'Download/Child': 2};
const entry = (id, directory = false) => ({path: id === 1 ? 'Download/Owned.txt' : id === 2 ? 'Download/Child' : 'Download/Child/Later.txt',
  name: id === 1 ? 'Owned.txt' : id === 2 ? 'Child' : 'Later.txt', mimeType: directory ? 'inode/directory' : 'text/plain', size: directory ? 0 : 4, modified: 1, directory});
const entryId = value => value.path === 'Download/Owned.txt' ? 1 : value.path === 'Download/Child' ? 2 : value.path === 'Download/Child/Later.txt' ? 3 : assert.fail('Unknown entry identity');
const volume = id => ({id: id === 1 ? 'primary' : 'secondary', primary: id === 1, name: id === 1 ? 'Internal' : 'SD', free: 1, total: 2});

async function compile(extraSources) {
  const compiled = await build({absWorkingDir: root, entryPoints: [source],
    bundle: true, platform: 'node', format: 'cjs', write: false, metafile: true,
    plugins: [{name: 'files-coordinator-observer', setup(builder) {
      builder.onLoad({filter: /\/files-browser-adapter\.ts$/}, args => {
        const text = readFileSync(args.path, 'utf8'), marker = '  const repaint = () =>';
        assert.equal(text.split(marker).length, 2, 'One Files closure observation seam');
        return {loader: 'ts', contents: text.replace(marker, `  __ports.inspect=()=>({bound:!!api,active,place,generation,stateGeneration,access,volumes,entries,loaded,busy,loading,error});\n${marker}`)};
      });
    }}]});
  const sources = [...Object.keys(compiled.metafile.inputs).filter(path => !path.startsWith('<')),
    driver, 'specs/quint/refinement/application/support.mjs', ...extraSources];
  captureSources(sources); return {code: compiled.outputFiles[0].text, sources};
}

async function fixture(compiled) {
  const document = Object.assign(new EventTarget(), {hidden: false, querySelector: () => null});
  const states = [], lists = [], shareCalls = [], toasts = [];
  let active = true, invokingAgent = false, completingState = 0;
  const port = {};
  const storage = {
    storageState() {
      const task = deferred(), value = port.inspect();
      const request = {id: states.length + 1, generation: value.generation, place: paths[value.place.path], agent: invokingAgent, task, settled: false};
      states.push(request); return task.promise;
    },
    storageList(input) {
      const task = deferred(), request = {id: completingState, input, task, settled: false};
      assert.ok(request.id); lists.push(request); return task.promise;
    },
    async storageCategory() {throw Error('Category reads outside folder campaign');},
    async storageTrashList() {throw Error('Trash reads outside folder campaign');},
    async storageWatch() {return {status: 'ready'};}, async storageUnwatch() {return {status: 'ready'};},
    async addListener() {return {async remove() {}};},
    async storageShare(input) {shareCalls.push(input); return {status: 'opened'};},
  };
  const module = {exports: {}};
  new Function('require', 'module', 'exports', '__ports', 'document', 'window', compiled.code)(createRequire(import.meta.url), module, module.exports, port, document, new EventTarget());
  const localState = {}, api = {ic: {}, get: () => localState, set: patch => Object.assign(localState, patch),
    isActive: () => active, toast(message) {toasts.push(message);}, open() {}};
  const view = {render: () => ({}), onLeave() {}};
  const runner = module.exports.installFilesBrowserAdapter(view,
    async () => {throw Error('Preview outside readback fixture');}, () => {}, {
      storage, createInlineModal: () => ({ref() {}}), menuFocus() {},
      async forgetSelected() {throw Error('Preview outside readback fixture');},
    });
  Object.assign(localState, view.preset('folder'));
  const observe = () => {
    const value = port.inspect();
    return {'s.bound': value.bound, 's.active': value.active, 's.place': paths[value.place.path], 's.generation': value.generation,
      's.stateGeneration': value.stateGeneration, 's.access': value.access, 's.volumes': value.volumes.map(item => item.primary ? 1 : 2),
      // The model's read-in-progress flag is loading; busy owns unrelated mutations.
      's.entries': value.entries.map(entryId), 's.loaded': value.loaded, 's.busy': value.loading, 's.error': !!value.error,
      's.states': qset(states.filter(request => !request.settled).map(request => request.id)),
      's.lists': qset(lists.filter(request => !request.settled).map(request => request.id)),
      's.requests': qmap(ids.map(id => {const request = states[id - 1]; return [id, request
        ? {generation: request.generation, place: request.place, agent: request.agent} : {generation: 0, place: 0, agent: false}];})),
      's.shares': shareCalls.length};
  };
  const output = () => view.render(localState, api);
  async function enter() {active = true; output(); await tick(); await tick();}
  async function refresh() {document.dispatchEvent(new Event('visibilitychange')); await tick();}
  async function navigate(place) {
    if (place === 1) view.back(localState, api);
    else output().fd.items.find(item => item.isFolder).tap();
    await tick();
  }
  function agentRead() {invokingAgent = true; const operation = runner.run({type: 'files_share', paths: ['Download/Owned.txt']}, new AbortController().signal); invokingAgent = false; operation.catch(() => {});}
  async function stateReply(id, access = 'granted', volumes = [1], success = true) {
    const request = states[id - 1]; assert.ok(request && !request.settled);
    request.settled = true; completingState = id;
    if (success) request.task.resolve({status: access === 'granted' ? 'ready' : 'denied', access, volumes: volumes.map(volume)});
    else request.task.reject(Error('Injected storage state read failure'));
    await tick(); await tick();
  }
  async function listReply(id, values, success = true) {
    const request = lists.find(request => request.id === id && !request.settled); assert.ok(request);
    request.settled = true;
    if (success) request.task.resolve({status: 'ready', entries: values.map(value => entry(value, value === 2))});
    else request.task.reject(Error('Injected listing read failure'));
    await tick(); await tick();
  }
  function leave() {active = false; view.onLeave(api);}
  async function close() {leave(); for (const request of [...states, ...lists]) if (!request.settled) {request.settled = true; request.task.reject(Error('Fixture teardown'));} await tick();}
  return {observe, enter, refresh, navigate, agentRead, stateReply, listReply, leave, close, shareCalls, output, states, lists};
}

async function checkFilesBrowserController(extraSources = []) {
  const compiled = await compile(extraSources), traces = [];
  for (const name of ['primary-volume-order', 'current-denial', 'old-denial', 'old-grant', 'old-state-error', 'old-list', 'old-list-error',
    'leave-state', 'leave-list', 'reenter-state', 'reenter-list', 'agent-overlap', 'agent-replaced-by-navigation', 'agent-replaced-by-leave']) {
    const f = await fixture(compiled), t = trace(name, f.observe());
    const step = (label, action) => checkpoint(t, label, action, f.observe());
    const replyState = async (id, access = 'granted', volumes = [1], success = true) => {
      await f.stateReply(id, access, volumes, success); step('storageState ' + id + ' settles', call('stateReply', id, success ? access : 'unavailable', success ? volumes : []));
    };
    const replyList = async (id, entries, success = true) => {await f.listReply(id, entries, success); step('storageList ' + id + ' settles', call('listReply', id, entries, success));};
    try {
      await f.enter(); step('real Files entry starts current folder read', call('enter'));
      if (name.endsWith('state') && ['leave-state', 'reenter-state'].includes(name)) {
        f.leave(); step('leave before state reply', call('leave'));
        if (name === 'reenter-state') {await f.enter(); step('return starts a new read', call('enter')); await replyState(2); await replyList(2, [1, 2]);}
        await replyState(1, 'denied', []);
      } else {
        await replyState(1, 'granted', name === 'primary-volume-order' ? [2, 1] : [1]);
        if (['leave-list', 'reenter-list'].includes(name)) {
          f.leave(); step('leave before listing reply', call('leave'));
          if (name === 'reenter-list') {await f.enter(); step('return starts new generation', call('enter')); await replyState(2); await replyList(2, [1, 2]);}
          await replyList(1, [3]);
        } else {
          await replyList(1, [1, 2]);
          if (name === 'primary-volume-order') {
            assert.deepEqual(f.observe()['s.volumes'], [1, 2]);
          } else if (name.startsWith('agent-')) {
            f.agentRead(); step('registered agent operation requests fresh state', call('agentRead'));
            if (name === 'agent-overlap') {
              f.agentRead(); step('newer registered operation requests state', call('agentRead')); await replyState(3); await replyState(2);
              assert.equal(f.shareCalls.length, 1);
            } else if (name === 'agent-replaced-by-navigation') {
              await f.navigate(2); step('folder navigation replaces old agent read', call('navigate', 2));
              await replyState(3); await replyList(3, [3]); await replyState(2); assert.equal(f.shareCalls.length, 0);
            } else {
              f.leave(); step('leaving Files retires the held agent access check', call('leave'));
              await replyState(2); assert.equal(f.shareCalls.length, 0);
            }
          } else {
            await f.refresh(); step('visibility refresh starts held read', call('refresh'));
            if (name === 'current-denial') await replyState(2, 'denied', []);
            else {
              if (name.startsWith('old-list')) await replyState(2);
              await f.navigate(2); step('user opens child folder during old read', call('navigate', 2));
              if (name === 'old-grant') await replyState(3, 'denied', []);
              else {await replyState(3, 'granted', [1, 2]); await replyList(3, [3]);}
              if (name.startsWith('old-list')) await replyList(2, [1], name !== 'old-list-error');
              else await replyState(2, name === 'old-grant' ? 'granted' : 'denied', name === 'old-grant' ? [1] : [], name !== 'old-state-error');
            }
          }
        }
      }
      traces.push(t);
    } finally {await f.close();}
  }
  return checkTraces(boundInputs({model: 'FilesBrowserController', sources: compiled.sources, traces, scope: 'bounded-component', assumptions: [
    'Actual installed Files browser, storage helpers and registered Files agent runner execute with deferred native storage ports. A read-only build-time closure observer exposes state without changing it.',
    'The campaign models current folder reads, shared access/volume readback and registered share admission. Two folders, three entries, two volumes and six read identities bound the model.',
    'Storage state and listing completion are settled promise macrosteps. Direct open and late selection release use the shared FilesDirectAdmission model and the Alpha cold-start browser flows. Category/Trash aggregation, filters, mutations, dialogs, watch ownership and provider persistence remain explicit extensions. Native storage effects themselves are controlled ports.'] }));
}

test('Files readback and listings retain the current request across late native completions', {timeout:120000}, async () => {
  const receipt = await checkFilesBrowserController([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 14);
});
