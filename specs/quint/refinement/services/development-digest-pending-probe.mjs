import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
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

function fixture() {
  const files = new Map(), requests = [];
  let commits = 0;
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
  function request(input) {
    assert.equal(input.slot, slot);
    assert.ok(['digestRead', 'digestCompareExchange'].includes(input.operation));
    requests.push(input);
    return localAgentStorage(directory, input);
  }
  return {
    store: () => developmentDigestStore(async input => request(input)),
    raw: () => files.has(file) ? JSON.parse(files.get(file)) : null,
    request, requests, commits: () => commits,
  };
}

async function baseline() {
  const result = [];
  for (const phase of ['review', 'legacy']) {
    const f = fixture(), store = f.store();
    const prior = phase === 'review' ? {...reviewed, phase} : reviewed;
    if (phase === 'review') await store.write(slot, prior);
    else {
      const legacyBytes = JSON.stringify(prior, null, 2);
      f.request({operation: 'digestCompareExchange', slot, expectedValue: null, value: legacyBytes});
      assert.deepEqual(await store.read(slot), prior);
    }
    const before = f.raw(), calls = f.requests.length;
    let error;
    try {await store.write(slot, {...prior, phase: 'dispatched'});} catch (refusal) {error = refusal.message;}
    result.push({phase, error, current: f.raw(), before, reachedHost: f.requests.length !== calls, commits: f.commits()});
  }
  return result;
}

assert.equal(process.argv[2], 'baseline');
console.log(JSON.stringify(await baseline()));
