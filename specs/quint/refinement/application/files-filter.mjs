import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {checkTraces, qmap, qset} from '../check-traces.mjs';
import {boundInputs, call, captureSources, checkpoint, deferred, root, tick, trace} from './support.mjs';

const driver = fileURLToPath(import.meta.url);
const source = '.eliza/client-features/plugins/plugin-files/src/browser/files-browser-adapter.ts';
const ids = [1, 2, 3], kinds = ['old', 'new'];
const files = ['Old.txt', 'New.txt', 'Old-New.txt', 'Irrelevant.txt'].map((name, index) => ({
  name, path: 'Download/' + name, mimeType: 'text/plain', size: 4, modified: index + 1, directory: false,
}));
const fileId = row => {
  const id = files.findIndex(file => file.path === row.path) + 1;
  assert.ok(id);
  return id;
};

async function compile(extraSources) {
  const built = await build({absWorkingDir: root, entryPoints: [source], bundle: true, platform: 'node',
    format: 'cjs', write: false, metafile: true, plugins: [{name: 'files-filter-observer', setup(builder) {
      builder.onLoad({filter: /\/files-browser-adapter\.ts$/}, ({path}) => {
        const input = readFileSync(path, 'utf8'), marker = '  const repaint = () =>';
        assert.equal(input.split(marker).length, 2, 'One Files filter observation seam');
        return {loader: 'ts', contents: input.replace(marker,
          '  __port.inspect = () => ({filter,pendingFilter,filterRows,access,stateGeneration,filterGeneration,active});\n' + marker)};
      });
    }}]});
  const sources = [...Object.keys(built.metafile.inputs), driver, ...extraSources];
  captureSources(sources);
  return {code: built.outputFiles[0].text, sources};
}

async function fixture(compiled) {
  const document = Object.assign(new EventTarget(), {hidden: false, querySelector: () => null});
  const context = new AsyncLocalStorage(), port = {}, operations = new Map();
  const owners = new Map(), queries = [], allRequests = [];
  let active = true, writes = 0;
  const runtimeErrors = [];
  const accessValue = access => ({status: access === 'granted' ? 'ready' : 'denied', access, volumes: []});
  function request() {const result = {...deferred(), settled: false}; allRequests.push(result); return result;}
  async function mutate() {writes++; throw Error('A Files filter must not write to storage');}
  const storage = {
    storageState() {
      const id = context.getStore();
      if (!id) return Promise.resolve(accessValue('granted'));
      const operation = operations.get(id), task = request();
      operation.phase = 'admission';
      assert.equal(operation.read, undefined, 'Each filter makes one access check');
      operation.read = task;
      owners.set(port.inspect().pendingFilter, id);
      return task.promise;
    },
    storageQuery(input) {
      const id = context.getStore() ?? 0, task = request();
      queries.push({id, task, input});
      if (id) {
        const operation = operations.get(id);
        assert.equal(input.text, kinds[operation.kind - 1]);
        operation.phase = 'query';
        operation.queryTicket = port.inspect().filterGeneration;
      }
      return task.promise;
    },
    async storageCategory() {return {status: 'ready', entries: [], count: 0};},
    async storageTrashList() {return {status: 'ready', items: []};},
    async storageWatch() {return {status: 'ready'};},
    async storageUnwatch() {return {status: 'ready'};},
    async addListener() {return {async remove() {}};},
    storageTransfer: mutate, storageRename: mutate, storageCreateFolder: mutate,
    storageTrash: mutate, storageRestore: mutate, storageEmptyTrash: mutate,
  };
  const module = {exports: {}};
  new Function('require', 'module', 'exports', '__port', 'document', 'window', compiled.code)(
    createRequire(import.meta.url), module, module.exports, port, document, new EventTarget());
  const local = {}, api = {ic: {}, get: () => local, isActive: () => active, toast() {},
    set(patch) {Object.assign(local, patch);},
  };
  const view = {render: () => ({}), onLeave() {}};
  const runner = module.exports.installFilesBrowserAdapter(view, async () => assert.fail('No selection in filter campaign'), () => {}, {
    storage, createInlineModal: () => ({ref() {}}), menuFocus() {}, async forgetSelected() {assert.fail('No selection');},
  });
  for (const id of ids) operations.set(id, {controller: new AbortController(), kind: 0, phase: 'idle',
    queryTicket: 0, result: 'none', count: 0});
  const render = () => view.render(local, api);
  render();
  await tick();
  const observe = () => {
    if (runtimeErrors.length) throw runtimeErrors[0];
    const actual = port.inspect(), filter = actual.filter ? owners.get(actual.filter) : 0;
    const pending = actual.pendingFilter ? owners.get(actual.pendingFilter) : 0;
    assert.notEqual(filter, undefined, 'Current filter came from an observed admission');
    assert.notEqual(pending, undefined, 'Pending filter came from an observed admission');
    return {'s.filter': filter, 's.pending': pending, 's.rows': actual.filterRows.map(fileId), 's.access': actual.access,
      's.writes': writes,
      's.stateGeneration': actual.stateGeneration, 's.filterGeneration': actual.filterGeneration,
      's.operations': qmap([...operations].map(([id, op]) => [id, {
        kind: op.kind, phase: op.phase, queryTicket: op.queryTicket,
        aborted: op.controller.signal.aborted, result: op.result, count: op.count,
      }]))};
  };
  return {
    observe, inspect: port.inspect,
    begin(id, kind) {
      const operation = operations.get(id);
      operation.kind = kind;
      void context.run(id, () => runner.run({type: 'files_filter', text: kinds[kind - 1]}, operation.controller.signal)).then(
        result => {
          operation.phase = 'done';
          operation.result = result.status;
          if (result.status === 'succeeded') {
            const summary = /^Showing (\d+) items? in Files\.$/.exec(result.summary);
            assert.ok(summary, result.summary);
            operation.count = Number(summary[1]);
          }
        },
        error => {
          if (error !== operation.controller.signal.reason) runtimeErrors.push(error);
          operation.phase = 'done';
          operation.result = 'aborted';
        },
      ).catch(error => runtimeErrors.push(error));
    },
    abort(id) {operations.get(id).controller.abort(Error('Fixture abort'));},
    accessReply(id, access) {
      const task = operations.get(id).read;
      assert.ok(task && !task.settled, 'Actual pending storageState call');
      task.settled = true;
      if (access === 'unavailable') task.reject(Error('Injected state read failure'));
      else task.resolve(accessValue(access));
    },
    queryReply(id, disposition, rows = []) {
      const request = queries.find(query => query.id === id && !query.task.settled);
      assert.ok(request, 'Actual pending storageQuery call');
      request.task.settled = true;
      if (disposition === 'rejected') request.task.reject(Error('Injected query rejection'));
      else request.task.resolve({status: disposition, entries: rows.map(row => files[row - 1])});
    },
    clear(method) {
      if (method === 'back') assert.equal(view.back(local, api), true);
      else render().chip.clear();
    },
    reload() {document.dispatchEvent(new Event('visibilitychange'));},
    leave() {active = false; view.onLeave(api);},
    assertSettled() {
      assert.ok(allRequests.every(task => task.settled), 'Every concrete request settled');
      assert.ok([...operations.values()].every(op => ['idle', 'done'].includes(op.phase)));
      assert.equal(writes, 0);
    },
    async close() {
      active = false;
      view.onLeave(api);
      for (const task of allRequests) if (!task.settled) task.reject(Error('Fixture teardown'));
      await tick();
    },
  };
}

const begin = (id, kind) => ['begin', id, kind];
const access = (id, kind = 'granted') => ['accessReply', id, kind];
const query = (id, disposition = 'ready', rows = [1, 4, 2, 3]) => ['queryReply', id, disposition, rows];
const start = (id, kind) => [begin(id, kind), access(id)];
const abort = id => ['abort', id];
const schedules = [
  ['outdated-rejection-keeps-new-rows', [...start(1, 1), ...start(2, 2), query(2), query(1, 'rejected')]],
  ['outdated-success-keeps-new-rows', [...start(1, 1), ...start(2, 2), query(2), query(1)]],
  ['old-query-fenced-during-new-admission', [...start(1, 1), begin(2, 2), query(1), access(2), query(2)]],
  ['same-text-new-identity-fences-old-query', [...start(1, 1), ...start(2, 1), query(2, 'ready', [1]), query(1)]],
  ['clear-chip-before-query', [...start(1, 1), ['clear', 'chip'], query(1)]],
  ['back-before-query', [...start(1, 1), ['clear', 'back'], query(1, 'rejected')]],
  ['clear-prior-filter-during-new-admission', [...start(1, 1), query(1), begin(2, 2), ['clear', 'chip'], access(2), query(2)]],
  ['denied-admission-keeps-prior-rows', [...start(1, 1), query(1), begin(2, 2), access(2, 'denied')]],
  ['admission-unavailable', [begin(1, 1), access(1, 'unavailable')]],
  ['older-admission-fenced', [begin(1, 1), begin(2, 2), access(2), query(2), access(1, 'denied')]],
  ['reload-during-admission', [begin(1, 1), ['reload'], access(1), query(1)]],
  ['reload-during-query', [...start(1, 1), ['reload'], query(1)]],
  ['empty-success-is-not-unavailable', [...start(1, 1), query(1, 'ready', [2, 4]), ...start(2, 2), query(2, 'denied')]],
  ['current-query-rejects', [...start(1, 1), query(1, 'rejected')]],
  ['preaborted', [abort(1), begin(1, 1)]],
  ['abort-during-admission', [begin(1, 1), abort(1), access(1, 'denied')]],
  ['abort-during-query', [...start(1, 1), abort(1), query(1)]],
];

export async function checkFilesFilter(extraSources = []) {
  const compiled = await compile(extraSources), traces = [];
  for (const [name, operations] of schedules) {
    const f = await fixture(compiled), t = trace(name, f.observe());
    try {
      for (const [operation, ...args] of operations) {
        f[operation](...args);
        await tick();
        const action = operation === 'queryReply' ? call(operation, args[0], args[1] === 'ready', qset(args[2]))
          : operation === 'clear' ? call(operation) : call(operation, ...args);
        checkpoint(t, [operation, ...args].join(' '), action, f.observe());
      }
      f.assertSettled();
      traces.push(t);
    } finally {await f.close();}
  }
  return checkTraces(boundInputs({model: 'FilesFilter', sources: compiled.sources, traces, scope: 'bounded-component', assumptions: [
    'Actual prepared shared Files browser runner, matching and sorting execute against held storage replies. The observer exposes pending and current filter identities, rows and the separate reload and query generations.',
    'The campaign starts in a settled mounted Browse view and observes three operation identities, two text classes and four unique storage rows. Provider query syntax and result data are controlled ports. A success count is parsed from the actual agent result.',
    'Unexpected storage mutations fail the campaign. Category and Trash results, viewport remount and background watch ownership remain separate obligations.',
  ]}));
}

export async function checkRetiredFilesFilterReload(extraSources = []) {
  const f = await fixture(await compile(extraSources));
  try {
    f.begin(1, 1); await tick();
    f.accessReply(1, 'granted'); await tick();
    f.queryReply(1, 'ready', [1]); await tick();
    assert.deepEqual(f.observe()['s.rows'], [1]);
    f.reload(); await tick();
    f.leave();
    f.queryReply(0, 'ready', [3]); await tick();
    assert.equal(f.inspect().active, false);
    assert.deepEqual(f.observe()['s.rows'], [1], 'Retired reload preserves the last active rows');
    f.assertSettled();
  } finally {await f.close();}
}
