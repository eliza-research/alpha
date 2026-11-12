import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {registerHooks} from '../../../../test/support/module-hooks.mjs';
import {join} from 'node:path';
import {developmentDigestStore} from '../../../../apps/app/src/runtime/local-agent-storage.ts';

const hostSource = new URL('../../../../scripts/local-agent-dev-storage.ts', import.meta.url).href;
const port = 'data:text/javascript,'+encodeURIComponent(`
 export const mkdirSync=(...args)=>globalThis.digestPendingFiles.mkdir(...args);
 export const chmodSync=(...args)=>globalThis.digestPendingFiles.chmod(...args);
 export const existsSync=(...args)=>globalThis.digestPendingFiles.exists(...args);
 export const readFileSync=(...args)=>globalThis.digestPendingFiles.read(...args);
 export const writeFileSync=(...args)=>globalThis.digestPendingFiles.write(...args);
 export const renameSync=(...args)=>globalThis.digestPendingFiles.rename(...args);
`);
globalThis.fetch = async () => {throw Error('Network is closed in this digest replay');};
let fenced = false;
const hooks = registerHooks({resolve(specifier, context, next) {
  if (context.parentURL === hostSource && specifier === 'node:fs') {
    fenced = true;
    return {url: port, shortCircuit: true};
  }
  return next(specifier, context);
}});
const {localAgentStorage} = await import(hostSource);
hooks.deregister();
assert.ok(fenced, 'The exact host imported the in-memory filesystem port');

const slot = 'hosted-digests:v1:'+'a'.repeat(64)+':pending';
const directory = '/synthetic-digest-pending';
const file = join(directory, createHash('sha256').update(slot).digest('hex')+'.json');
const reviewed = {
  path: 'sources', body: {id: 'synthetic-source', mutationId: 'synthetic-turn', confirmed: true},
  summary: 'Synthetic reviewed source',
  rebind: [{id: 'synthetic-loop', expectedVersionId: 'loop-revision', mutationId: 'synthetic-renewal', spec: {enabled: true}}],
};

const beforeCommit = Error('Synthetic request unavailable before host commit');
const afterCommit = Error('Synthetic acknowledgement lost after host commit');
function fixture() {
  const files = new Map(), requests = [];
  let commits = 0, fault = 'none';
  globalThis.digestPendingFiles = {
    mkdir(name, options) {assert.deepEqual([name, options], [directory, {recursive: true, mode: 0o700}]);},
    chmod(name, mode) {assert.deepEqual([name, mode], [directory, 0o700]);},
    exists(name) {assert.equal(name, file);return files.has(name);},
    read(name, encoding) {assert.equal(name, file);assert.equal(encoding, 'utf8');return files.get(name);},
    write(temporary, bytes, options) {
      assert.ok(temporary.startsWith(file+'.') && !files.has(temporary));
      assert.deepEqual(options, {mode: 0o600, flag: 'wx'});
      files.set(temporary, bytes);
    },
    rename(temporary, name) {
      assert.equal(name, file);
      assert.ok(temporary.startsWith(file+'.') && files.has(temporary));
      files.set(name, files.get(temporary));
      files.delete(temporary);
      commits++;
    },
  };
  function request(input, failure = "none") {
    assert.equal(input.slot, slot);
    assert.ok(['digestRead', 'digestCompareExchange'].includes(input.operation));
    requests.push(input);
    if (input.operation === 'digestCompareExchange' && failure === 'before') throw beforeCommit;
    const result = localAgentStorage(directory, input);
    if (input.operation === 'digestCompareExchange' && failure === 'after' && result.status === 'saved') throw afterCommit;
    return result;
  }
  return {
    store: () => developmentDigestStore(async input => request(input, fault)),
    failure: value => {fault = value;},
    raw: () => files.has(file) ? JSON.parse(files.get(file)) : null,
    request, requests, commits: () => commits,
  };
}

const variants = [
  reviewed,
  {...reviewed, body: {...reviewed.body, mutationId: 'different-turn'}},
  {...reviewed, summary: 'Changed reviewed description'},
  {body: reviewed.body, path: reviewed.path, summary: reviewed.summary, rebind: reviewed.rebind},
  {...reviewed, path: 'dossier'},
  {...reviewed, rebind: [{...reviewed.rebind[0], expectedVersionId: 'different-revision'}]},
];
const canonical = (payload, phase) => phase === 'legacy' ? variants[payload-1] : {...variants[payload-1], phase};
const bytes = (payload, phase, pretty) => payload === 0 ? null : JSON.stringify(canonical(payload, phase), null, pretty ? 2 : 0);
const value = raw => {
  if (raw === null) return {payload: 0, phase: 'none', pretty: false};
  const parsed = JSON.parse(raw), {phase, ...payload} = parsed;
  const index = variants.findIndex(candidate => JSON.stringify(candidate) === JSON.stringify(payload));
  assert.ok(index >= 0, 'Only the reviewed payload and exact mutations are projected');
  assert.ok(phase === undefined || ['review', 'dispatched'].includes(phase));
  return {payload: index+1, phase: phase ?? 'legacy', pretty: JSON.stringify(parsed) !== raw};
};
const action = (name, ...args) => ({name, args});

async function scenario(name, seed, run) {
  const f = fixture();
  if (seed[0] !== 0) assert.deepEqual(f.request({operation: 'digestCompareExchange', slot, expectedValue: null,
    value: bytes(...seed)}), {status: 'saved'});
  const initialRequests = f.requests.length, initialCommits = f.commits();
  const tabs = new Map([[1, f.store()], [2, f.store()]]);
  function observe({actor = 0, before = null, proposed = null, expected = null, result = 'idle',
    casAttempted = false, operations = 0} = {}) {
    const calls = f.requests.slice(initialRequests);
    return {
      's.stored': value(f.raw()), 's.actor': actor, 's.before': value(before), 's.proposed': value(proposed),
      's.expected': value(expected), 's.result': result, 's.casAttempted': casAttempted,
      's.reads': calls.filter(row => row.operation === 'digestRead').length,
      's.compares': calls.filter(row => row.operation === 'digestCompareExchange').length,
      's.commits': f.commits()-initialCommits, 's.operations': operations,
    };
  }
  const trace = {name, init: action('startState', ...seed), expect: observe(), steps: []};
  const point = async (label, name, ...args) => {
    const tab = args[0] ?? 0, store = tabs.get(tab), before = f.raw(), start = f.requests.length;
    let result, proposed = null;
    if (name === 'read') {
      assert.deepEqual(await store.read(slot), before === null ? null : JSON.parse(before));
      result = 'read';
    } else if (name === 'reopen') {
      tabs.set(tab, f.store());
      result = 'reopened';
    } else if (name === 'hostReencode') {
      assert.equal(value(before).pretty, true);
      proposed = JSON.stringify(JSON.parse(before));
      assert.deepEqual(f.request({operation: 'digestCompareExchange', slot, expectedValue: before, value: proposed}),
        {status: 'saved'});
      result = 'reencoded';
    } else {
      assert.equal(name, 'save');
      const [, payload, phase, failure] = args;
      proposed = bytes(payload, phase, false);
      f.failure(failure);
      try {
        if (payload === 0) await store.remove(slot);
        else await store.write(slot, canonical(payload, phase));
        result = 'saved';
      } catch (error) {
        if (error === beforeCommit) result = 'unavailable';
        else if (error === afterCommit) result = 'lost';
        else if (error.message === 'A digest request is already awaiting recovery') result = 'guard';
        else if (error.message === 'Digest storage changed in another tab. Refresh before continuing.') result = 'conflict';
        else throw error;
      } finally {f.failure('none');}
    }
    const calls = f.requests.slice(start).filter(row => row.operation === 'digestCompareExchange');
    assert.ok(calls.length <= 1);
    if (calls.length) assert.equal(calls[0].value, proposed);
    if (result === 'saved' || result === 'lost') {
      assert.equal(calls[0].expectedValue, before, 'CAS sends the exact original bytes');
      assert.equal(f.raw(), proposed);
    }
    trace.steps.push({label, action: action(name, ...args), expect: observe({
      actor: tab, before, proposed, expected: calls[0]?.expectedValue ?? null, result,
      casAttempted: calls.length > 0, operations: trace.steps.length+1,
    })});
  };
  await run(point);
  return trace;
}

assert.equal(process.argv[2], 'current');
const traces = [];
traces.push(await scenario('exact reviewed request advances and survives reopen', [0,'none',false], async point => {
  await point('Read the empty pending slot', 'read', 1);
  await point('Save reviewed bytes', 'save', 1, 1, 'review', 'none');
  await point('Advance only the phase', 'save', 1, 1, 'dispatched', 'none');
  await point('Retry exact dispatched bytes', 'save', 1, 1, 'dispatched', 'none');
  await point('Open another renderer store', 'reopen', 2);
  await point('Read the saved dispatched request', 'read', 2);
  await point('Clear the exact matching request', 'save', 1, 0, 'none', 'none');
}));
traces.push(await scenario('legacy retry retains original expected bytes', [1,'legacy',true], async point => {
  await point('Read the old whitespace-preserving serialization', 'read', 1);
  await point('Normalize the same legacy request to dispatched', 'save', 1, 1, 'dispatched', 'none');
  await point('Read exact normalized state in another store', 'read', 2);
}));
traces.push(await scenario('reviewed payload and dispatched phase stay immutable', [1,'review',false], async point => {
  for (const [index, field] of ['turn body','summary','field order','route','renewal binding'].entries()) {
    await point('Refuse changed '+field, 'save', 1, index+2, 'dispatched', 'none');
  }
  await point('Refuse removing the reviewed phase', 'save', 1, 1, 'legacy', 'none');
  await point('Advance the original payload', 'save', 1, 1, 'dispatched', 'none');
  await point('Refuse downgrading a dispatched request to review', 'save', 1, 1, 'review', 'none');
  await point('Repeat the exact dispatched payload', 'save', 1, 1, 'dispatched', 'none');
}));
traces.push(await scenario('stale tab cannot promote or clear a newer saved phase', [1,'review',false], async point => {
  await point('First tab observes the review', 'read', 1);
  await point('Second tab observes the same review', 'read', 2);
  await point('First tab commits dispatch', 'save', 1, 1, 'dispatched', 'none');
  await point('Second tab sends a stale phase CAS', 'save', 2, 1, 'dispatched', 'none');
  await point('Second tab cannot clear with its stale expected bytes', 'save', 2, 0, 'none', 'none');
  await point('Second tab reads the committed phase', 'read', 2);
  await point('Fresh exact dispatched retry succeeds', 'save', 2, 1, 'dispatched', 'none');
}));
traces.push(await scenario('lost acknowledgement preserves host commit and stale renderer view', [1,'review',false], async point => {
  await point('First tab observes review', 'read', 1);
  await point('Second tab observes review', 'read', 2);
  await point('Host advances dispatch but acknowledgement is lost', 'save', 1, 1, 'dispatched', 'after');
  await point('Immediate retry keeps stale expected review bytes', 'save', 1, 1, 'dispatched', 'none');
  await point('Other stale renderer still cannot clear the committed row', 'save', 2, 0, 'none', 'none');
  await point('Reopen the initiating renderer store', 'reopen', 1);
  await point('Read back the persisted dispatched row', 'read', 1);
  await point('Retry the exact persisted row', 'save', 1, 1, 'dispatched', 'none');
  await point('Second tab reads the same persisted row', 'read', 2);
}));
traces.push(await scenario('precommit transport failure leaves the reviewed bytes', [1,'review',false], async point => {
  await point('Read current review', 'read', 1);
  await point('Transport fails before host sees the candidate', 'save', 1, 1, 'dispatched', 'before');
  await point('Another tab reads the unchanged review', 'read', 2);
  await point('Retry the exact intended phase', 'save', 1, 1, 'dispatched', 'none');
  await point('Read back the dispatched row', 'read', 2);
}));
traces.push(await scenario('raw CAS refuses an equivalent legacy re-encoding', [1,'legacy',true], async point => {
  await point('Read the old pretty JSON', 'read', 1);
  await point('A separate raw host writer canonicalizes only the serialization', 'hostReencode');
  await point('An equivalent decoded review still has different expected bytes', 'save', 1, 1, 'dispatched', 'none');
  await point('Refresh from the exact current byte string', 'read', 1);
  await point('Advance only after seeing current bytes', 'save', 1, 1, 'dispatched', 'none');
}));
console.log(JSON.stringify(traces));
