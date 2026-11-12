import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {checkClientFeatures} from '../../../../scripts/prepare-client-features.ts';
import {captureInputs, checkTraces, qmap, qset, verifyRefinementReceiptInputs} from '../check-traces.mjs';
import {scaledTimeout} from '../timeouts.mjs';
import {realNode} from '../../../../scripts/run-node-only-tests.ts';

const root = resolve(import.meta.dirname, '../../../..');
const source = 'plugins/plugin-files/src/browser/storage-volume.ts';
const model = 'plugins/plugin-files/src/browser/storage-model.ts';
const librarySource = 'plugins/plugin-files/src/browser/files.ts';
const generated = '.eliza/client-features/';
const namespace = {trashFolder: '.Trash-alpha', trashKey: 'alpha.files.trash.v1'};
const lockName = 'browser-files-trash:'+namespace.trashKey;
const idle = {owner: 0, kind: 'none', subject: 0};
const files = [1, 2], markers = [1, 2, 3], startTime = 1000000;
const names = new Map([[1, 'first.pdf'], [2, 'second.pdf']]);
const path = file => 'Download/'+names.get(file);
const action = (name, ...args) => ({name, args});
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(Volume, context) {
  const rows = new Map([['download', {id: 'download', parentId: 'root', name: 'Download', directory: true,
    revision: '1', mimeType: '', size: 0}]]);
  for (const file of files) rows.set(String(file), {id: String(file), parentId: 'download', name: names.get(file),
    directory: false, revision: '1', mimeType: 'application/pdf', size: file});
  const handles = new Map(), requests = [], expired = new Set();
  let now = startTime, raw = null, held, refusePlacement, failWrite = false, result = null, visible = [];
  const mark = value => {
    assert.ok(handles.has(value), 'The exact marker was observed in a durable journal write');
    return handles.get(value);
  };
  const children = id => [...rows.values()].filter(row => row.parentId === id);
  const mutate = (input, change) => {
    const row = rows.get(input.id);
    assert.equal(row?.revision, input.expectedRevision, 'The source supplies the exact library revision');
    const next = change(row);
    if (!next) {rows.delete(row.id); return;}
    assert.ok(children(next.parentId).every(peer => peer.id === row.id || peer.name !== next.name));
    rows.set(row.id, {...next, revision: String(Number(row.revision)+1)});
  };
  const atPort = () => {
    const request = context.getStore();
    if (request) request.entered = true;
    return request;
  };
  async function gate(port, request, input) {
    if (held?.port !== port || request?.owner !== held.owner || !held.matches(input)) return;
    const captured = held;
    held = undefined;
    captured.arrived.resolve(request);
    await captured.release.promise;
  }
  const library = {
    async list({id = 'root'}) {
      const request = atPort();
      await gate('list', request, id);
      return {folder: rows.get(id) ?? {id}, entries: children(id).map(row => ({...row}))};
    },
    async createFolder({id, name}) {
      atPort();
      assert.equal(id, 'root');
      assert.equal(name, namespace.trashFolder);
      assert.ok(!rows.has('trash-folder'));
      rows.set('trash-folder', {id: 'trash-folder', parentId: id, name, directory: true,
        revision: '1', mimeType: '', size: 0});
    },
    async rename(input) {atPort(); mutate(input, row => ({...row, name: input.name}));},
    async place(input) {
      const request = atPort();
      if (request) request.prepared = true;
      await gate('place', request, input.id);
      if (refusePlacement === input.id) throw Error('Controlled placement refusal');
      mutate(input, row => ({...row, parentId: input.destinationId, name: input.name}));
    },
    async delete(input) {
      atPort();
      assert.equal(input.confirmPermanent, true);
      mutate(input, row => {assert.equal(row.parentId, 'trash-folder'); return null;});
    },
  };
  const store = {
    getItem(key) {atPort(); assert.equal(key, namespace.trashKey); return raw;},
    setItem(key, bytes) {
      atPort();
      assert.equal(key, namespace.trashKey);
      if (failWrite) {failWrite = false; throw Error('Controlled journal write refusal');}
      for (const id of Object.keys(JSON.parse(bytes))) {
        assert.match(id, /^[0-9a-f-]{36}$/);
        if (!handles.has(id)) handles.set(id, handles.size+1);
      }
      raw = bytes;
    },
  };
  const volumes = [1, 2].map(() => new Volume(library, namespace, () => {}, () => now, store));

  function classify(row) {
    if (!row) return 'gone';
    assert.ok(['download', 'trash-folder'].includes(row.parentId));
    return row.parentId === 'download' ? 'live' : 'trash';
  }
  function observe(mode) {
    const rawJournal = Object.entries(JSON.parse(raw ?? '{}'));
    const mapped = new Map();
    for (const [key, record] of rawJournal) {
      const file = files.find(file => names.get(file) === record.name);
      assert.ok(file);
      assert.deepEqual(record, {name: names.get(file), origin: 'Download', deletedAt: startTime,
        directory: false, mimeType: 'application/pdf', size: file});
      mapped.set(mark(key), file);
    }
    const active = requests.filter(row => row.entered && !row.settled);
    const queued = requests.filter(row => !row.entered && !row.settled);
    assert.ok(active.length <= 1 && queued.length <= 1, 'The selected namespace has exclusive source custody');
    const request = row => row ? {owner: row.owner, kind: row.kind, subject: row.subject} : idle;
    const states = files.map(file => [file, classify(rows.get(String(file)))]);
    for (const [file, state] of states) {
      const row = rows.get(String(file));
      if (state === 'trash') assert.equal(mapped.get(mark(row.name)), file);
      if (state === 'live') assert.equal(row.name, names.get(file));
    }
    return {
      's.mode': mode, 's.active': request(active[0]), 's.queued': request(queued[0]), 's.prepared': !!active[0]?.prepared,
      's.rows': qmap(states), 's.keys': qmap(states.map(([file, state]) => [file, state === 'trash' ? mark(rows.get(String(file)).name) : 0])),
      's.journal': qmap(markers.map(marker => [marker, mapped.get(marker) ?? 0])),
      's.allocated': handles.size, 's.expired': qset(expired), 's.visible': qset(visible),
      's.status': result?.status ?? 'idle', 's.count': result?.count ?? 0,
    };
  }
  function call(owner, kind, subject, options = {}) {
    const ticket = {owner, kind, subject, entered: false, settled: false};
    requests.push(ticket);
    const api = volumes[owner-1];
    const rawMarker = [...handles].find(([, value]) => value === subject)?.[0];
    const work = () => kind === 'trash' ? api.trash([path(subject)])
      : kind === 'list' ? api.trashList()
        : kind === 'restore' ? api.restore([rawMarker])
          : api.emptyTrash(rawMarker ? [rawMarker] : undefined, options.confirmed === true);
    ticket.promise = context.run(ticket, work).then(value => ({value}), error => ({error}))
      .finally(() => {ticket.settled = true;});
    return ticket;
  }
  async function record(ticket, expected) {
    const {value, error} = await ticket.promise;
    if (error) {
      assert.equal(expected, 'rejected');
      result = {status: 'rejected'};
      return error;
    }
    if (ticket.kind === 'list') {
      assert.equal(expected, 'listed');
      for (const item of value.items) {
        const record = JSON.parse(raw)[item.id];
        assert.deepEqual(item, {id: item.id, ...record});
        const row = [...rows.values()].find(row => row.parentId === 'trash-folder' && row.name === item.id);
        assert.ok(row && names.get(Number(row.id)) === item.name, 'The visible marker identifies the exact stored file');
      }
      visible = value.items.map(item => mark(item.id));
      result = {status: 'listed'};
    } else if (ticket.kind === 'trash' || ticket.kind === 'restore') {
      const [outcome] = value.outcomes;
      assert.equal(outcome.status, expected);
      result = {status: outcome.status};
    } else {
      assert.equal(value.status, expected);
      result = value;
    }
    return value;
  }
  return {observe, call, record, mark, volumes,
    hold(port, owner, matches = () => true) {
      assert.equal(held, undefined);
      const arrived = Promise.withResolvers(), release = Promise.withResolvers();
      held = {port, owner, matches, arrived, release};
      return {arrived: arrived.promise, release: release.resolve};
    },
    failWrite() {failWrite = true;},
    refusePlacement(file) {refusePlacement = file === undefined ? undefined : String(file);},
    time(value, marker) {
      now = value;
      if (marker) {expired.add(marker); result = {status: 'clock'};}
    },
  };
}

function schedule(mode, f, name) {
  const trace = {name: mode+' '+name, init: action('start', mode), expect: f.observe(mode), steps: []};
  return {trace, point(label, next) {trace.steps.push({label, action: next, expect: f.observe(mode)});}};
}
const begin = (owner, kind, subject = 0) => action('begin', owner, kind, subject);
const queue = (owner, kind, subject = 0) => action('queue', owner, kind, subject);
const trash = (owner, file, ok = true) => [begin(owner, 'trash', file), action('prepareTrash'), action('finishTrash', ok)];
const restore = (owner, marker, ok = true) => [begin(owner, 'restore', marker), action('prepareRestore'), action('finishRestore', ok)];
const listed = owner => [begin(owner, 'list'), action('finishList')];
const empty = (owner, marker, confirmed = true) => [begin(owner, 'empty', marker), action('finishEmpty', confirmed)];

async function verifyHeld(mode, lockManager, ticket, settled) {
  await tick();
  assert.equal(ticket.entered, false, 'A same-namespace peer has not entered a source port');
  assert.equal(ticket.settled, false, 'A same-namespace peer remains pending');
  if (mode === 'web') {
    const state = await lockManager.query();
    assert.equal(state.held.filter(lock => lock.name === lockName).length, 1);
    assert.equal(state.pending.filter(lock => lock.name === lockName).length, 1);
  }
  assert.equal(settled.settled, false);
}

async function heldTrashAndList(f, t, mode, locks) {
  const gate = f.hold('place', 1, id => id === '1');
  const moving = f.call(1, 'trash', 1);
  try {
    await gate.arrived;
    t.point('The marker is durable before the file crosses into Trash', [begin(1, 'trash', 1), action('prepareTrash')]);
    const listing = f.call(2, 'list', 0);
    await verifyHeld(mode, locks, listing, moving);
    t.point('A same-namespace peer list cannot enter while the placement is pending',
      [queue(2, 'list'), {...begin(2, 'list'), reject: true}]);
    gate.release();
    const {outcomes: [moved]} = await f.record(moving, 'trashed');
    const {items} = await f.record(listing, 'listed');
    assert.deepEqual(items.map(({id, name, origin}) => ({id, name, origin})),
      [{id: moved.to, name: names.get(1), origin: 'Download'}]);
    t.point('The later list returns the exact completed marker', [action('finishTrash', true), ...listed(2)]);
    const {outcomes: [back]} = await f.record(f.call(2, 'restore', f.mark(moved.to)), 'restored');
    assert.equal(back.to, path(1));
    t.point('The exact visible marker restores its original file', restore(2, 1));
  } finally {gate.release();}
}

async function heldRestoreAndTrash(f, t, mode, locks) {
  await f.record(f.call(1, 'trash', 1), 'trashed');
  t.point('First marker enters Trash', trash(1, 1));
  const gate = f.hold('place', 1, id => id === '1');
  const returning = f.call(1, 'restore', 1);
  try {
    await gate.arrived;
    t.point('Restore retains the marker while its exact row remains in Trash', [begin(1, 'restore', 1), action('prepareRestore')]);
    const moving = f.call(2, 'trash', 2);
    await verifyHeld(mode, locks, moving, returning);
    t.point('The second Trash waits behind the first Restore',
      [queue(2, 'trash', 2), {...begin(2, 'trash', 2), reject: true}]);
    gate.release();
    await f.record(returning, 'restored');
    const {outcomes: [second]} = await f.record(moving, 'trashed');
    assert.equal(f.mark(second.to), 2);
    t.point('Restore settles before the second write is committed', [action('finishRestore', true), ...trash(2, 2)]);
    const {items} = await f.record(f.call(1, 'list', 0), 'listed');
    assert.deepEqual(items.map(item => item.id), [second.to]);
    t.point('Only the second exact marker remains listed', listed(1));
  } finally {gate.release();}
}

async function heldTrashAndEmpty(f, t, mode, locks) {
  const {outcomes: [first]} = await f.record(f.call(1, 'trash', 1), 'trashed');
  t.point('First item has a marker the owner can confirm', trash(1, 1));
  const {items} = await f.record(f.call(1, 'list', 0), 'listed');
  assert.deepEqual(items.map(item => item.id), [first.to]);
  t.point('Owner sees only the first exact marker', listed(1));
  const gate = f.hold('place', 1, id => id === '2');
  const moving = f.call(1, 'trash', 2);
  try {
    await gate.arrived;
    t.point('The second item is held before its marker appears in Trash', [begin(1, 'trash', 2), action('prepareTrash')]);
    const deleting = f.call(2, 'empty', f.mark(items[0].id), {confirmed: true});
    await verifyHeld(mode, locks, deleting, moving);
    t.point('Confirmed Empty waits with the old reviewed marker', queue(2, 'empty', 1));
    gate.release();
    const {outcomes: [second]} = await f.record(moving, 'trashed');
    assert.equal((await f.record(deleting, 'ready')).count, 1);
    t.point('Empty removes only the reviewed item after the peer commits', [action('finishTrash', true), ...empty(2, 1)]);
    const {items: remaining} = await f.record(f.call(1, 'list', 0), 'listed');
    assert.deepEqual(remaining.map(item => item.id), [second.to]);
    t.point('The later marker remains visible', listed(1));
  } finally {gate.release();}
}

async function rejectedWrite(f, t, mode, locks) {
  const gate = f.hold('list', 1);
  f.failWrite();
  const moving = f.call(1, 'trash', 1);
  try {
    await gate.arrived;
    t.point('Trash is admitted before its first journal write', begin(1, 'trash', 1));
    const listing = f.call(2, 'list', 0);
    await verifyHeld(mode, locks, listing, moving);
    t.point('A peer waits while the first request still owns the namespace', queue(2, 'list'));
    gate.release();
    assert.match((await f.record(moving, 'rejected')).message, /Controlled journal write refusal/);
    assert.deepEqual((await f.record(listing, 'listed')).items, []);
    t.point('Journal refusal keeps the live file and admits the queued list', [action('abortTrashWrite'), ...listed(2)]);
    await f.record(f.call(2, 'trash', 2), 'trashed');
    t.point('The namespace can be used again after rejection', trash(2, 2));
  } finally {gate.release();}
}

async function staleMarkerAndRetention(f, t) {
  const {outcomes: [first]} = await f.record(f.call(1, 'trash', 1), 'trashed');
  t.point('First incarnation enters Trash', trash(1, 1));
  await f.record(f.call(2, 'restore', 1), 'restored');
  t.point('Restore consumes the original marker', restore(2, 1));
  const {outcomes: [next]} = await f.record(f.call(1, 'trash', 1), 'trashed');
  assert.notEqual(next.to, first.to);
  t.point('The same file receives a fresh exact marker when trashed again', trash(1, 1));
  await f.record(f.call(2, 'empty', 2), 'confirmation-required');
  t.point('Empty without confirmation leaves the current marker intact', empty(2, 2, false));
  await f.record(f.call(2, 'empty', 0, {confirmed: true}), 'invalid');
  t.point('Confirmed Empty still requires explicit markers', empty(2, 0));
  assert.equal((await f.record(f.call(2, 'empty', 1, {confirmed: true}), 'ready')).count, 0);
  t.point('The stale reviewed marker cannot remove the new incarnation', empty(2, 1));
  await f.record(f.call(2, 'restore', 1), 'missing');
  t.point('Restoring the retired marker likewise leaves the new incarnation', [begin(2, 'restore', 1), action('missingRestore')]);
  const horizon = startTime + 30*86400000;
  f.time(horizon-1);
  assert.deepEqual((await f.record(f.call(2, 'list', 0), 'listed')).items.map(item => item.id), [next.to]);
  t.point('The file is still visible one millisecond before retention ends', listed(2));
  f.time(horizon, 2);
  t.point('The exact retention boundary is reached', action('expireMarker', 2));
  assert.deepEqual((await f.record(f.call(2, 'list', 0), 'listed')).items, []);
  t.point('The boundary list removes only the expired marker and its exact row', listed(2));
}

async function failedPlacements(f, t) {
  await f.record(f.call(1, 'trash', 1), 'trashed');
  t.point('First file reaches Trash before the refusal schedule', trash(1, 1));
  f.refusePlacement(1);
  await f.record(f.call(1, 'restore', 1), 'failed');
  t.point('Failed Restore leaves the same physical row and exact marker in Trash', restore(1, 1, false));
  assert.equal((await f.record(f.call(2, 'list', 0), 'listed')).items.length, 1);
  t.point('Later list still exposes the exact recoverable file', listed(2));
  f.refusePlacement();
  await f.record(f.call(2, 'restore', 1), 'restored');
  t.point('The same marker supports a fresh Restore', restore(2, 1));
  f.refusePlacement(2);
  await f.record(f.call(2, 'trash', 2), 'failed');
  t.point('Failed Trash clears the provisional marker and leaves the live row unchanged', trash(2, 2, false));
  assert.deepEqual((await f.volumes[0].list('Download')).entries.map(row => row.name).sort(), [...names.values()]);
  t.point('Ordinary Downloads still exposes both original names', null);
}

// Bun has no Web Locks. Keep this one source campaign on a real Node runtime,
// including its fallback branch, when the aggregate itself is running on Bun.
function checkBrowserFilesTrashWithNode(extraSources) {
  const delegationInputs = captureInputs([fileURLToPath(import.meta.url),
    'scripts/run-node-only-tests.ts', 'specs/quint/refinement/timeouts.mjs']);
  const node = realNode();
  assert.ok(node, 'Files Trash refinement requires a real Node.js 24+ runtime with Web Locks');
  const directory = mkdtempSync(join(tmpdir(), 'alpha-files-trash-node-'));
  const request = join(directory, 'request.json'), output = join(directory, 'receipt.json');
  try {
    writeFileSync(request, JSON.stringify({extraSources, output}), {mode: 0o600, flag: 'wx'});
    const code = `
      import {readFileSync, writeFileSync} from 'node:fs';
      const {checkBrowserFilesTrash} = await import(${JSON.stringify(import.meta.url)});
      const request = JSON.parse(readFileSync(process.argv[1], 'utf8'));
      const receipt = await checkBrowserFilesTrash(request.extraSources);
      writeFileSync(request.output, JSON.stringify(receipt, (_key, value) =>
        typeof value === 'bigint' ? {'#bigint': String(value)} : value), {mode: 0o600, flag: 'wx'});
    `;
    const result = spawnSync(node, ['--input-type=module', '-e', code, request], {
      cwd: root, encoding: 'utf8', timeout: scaledTimeout(240000), maxBuffer: 16 * 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `Node Files Trash refinement failed (${result.signal ?? result.status})\n${result.stdout}\n${result.stderr}`);
    const receipt = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(receipt.model, 'BrowserFilesTrash');
    assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
    for (const [file, hash] of Object.entries(delegationInputs)) {
      assert.equal(receipt.sourceHashesBefore[file], hash, 'Delegation input changed before Node execution: ' + file);
    }
    assert.equal(verifyRefinementReceiptInputs(receipt), true, 'Node receipt inputs remain current');
    return receipt;
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
}

export async function checkBrowserFilesTrash(extraSources = []) {
  if (typeof process.versions.bun === 'string') return checkBrowserFilesTrashWithNode(extraSources);
  checkClientFeatures();
  const sources = [generated+source, generated+model, generated+librarySource, generated+'.source.json',
    'vendor/eliza/'+source, 'vendor/eliza/'+model, 'vendor/eliza/'+librarySource,
    'apps/app/src/browser/files.ts', 'upstream.lock.json', 'scripts/prepare-client-features.ts',
    'scripts/run-node-only-tests.ts', 'specs/quint/refinement/timeouts.mjs',
    fileURLToPath(import.meta.url), ...extraSources];
  const driverHashes = captureInputs(sources);
  const {BrowserStorageVolume} = await import(pathToFileURL(resolve(root, generated+source)).href);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const nativeLocks = globalThis.navigator.locks;
  assert.equal(typeof nativeLocks.request, 'function');
  const context = new AsyncLocalStorage();
  const traces = [];
  try {
    for (const mode of ['web', 'fallback']) {
      const navigator = mode === 'web' ? {locks: {request(name, options, callback) {
        const owner = context.getStore();
        assert.ok(owner);
        assert.equal(name, lockName);
        assert.deepEqual(options, {mode: 'exclusive'});
        return nativeLocks.request(name, options, lock => context.run(owner, () => callback(lock)));
      }}} : {};
      Object.defineProperty(globalThis, 'navigator', {configurable: true, value: navigator});
      for (const run of [heldTrashAndList, heldRestoreAndTrash, heldTrashAndEmpty, rejectedWrite,
        staleMarkerAndRetention, failedPlacements]) {
        const f = fixture(BrowserStorageVolume, context);
        const t = schedule(mode, f, run.name);
        await run(f, t, mode, nativeLocks);
        traces.push(t.trace);
      }
    }
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  }
  return checkTraces({model: 'BrowserFilesTrash', sources, driverHashes, traces, scope: 'bounded-orchestration',
    assumptions: [
      'The prepared shared BrowserStorageVolume and its storage rules execute directly. Two actual volume instances share the same in-memory CAS library and exact journal bytes.',
      'Node Web Locks supplies the exclusive request path. The second branch removes Web Locks and executes the source fallback in one realm. Deferred library calls expose the held source custody. Browser tabs, IndexedDB behavior and process interruption remain separate.',
      'UUIDs are mapped to allocation order. The fixture checks exact raw marker identity, original name, parent, MIME, size and listing payload. Rows and marker IDs use two files and three marker slots. Empty selects one reviewed marker.',
      'Held placement uses the precommit library port. Its success or definite refusal and the subsequent journal update settle in one model action. The actual IndexedDB transaction is tested separately. Ambiguous or interrupted journal publication is outside this projection.',
    ]});
}
