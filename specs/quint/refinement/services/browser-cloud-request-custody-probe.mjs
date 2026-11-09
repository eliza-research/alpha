import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {EventEmitter} from 'node:events';
import {registerHooks} from 'node:module';
import {Readable} from 'node:stream';

const bridge = new URL('../../../../scripts/browser-cloud-dev-bridge.ts', import.meta.url).href;
const denied = 'data:text/javascript,'+encodeURIComponent(`
 const deny=()=>{globalThis.browserCloudProfileAccess++;throw Error('Fixture profile access is closed');};
 export const mkdir=deny, readFile=deny, writeFile=deny, rename=deny, lstat=deny, unlink=deny;
`);
globalThis.browserCloudProfileAccess = 0;
globalThis.fetch = async () => {throw Error('Fixture outbound network is closed');};
let profileHookInstalled = false;
const hooks = registerHooks({resolve(specifier, context, next) {
  if (context.parentURL === bridge && specifier === 'node:fs/promises') {
    profileHookInstalled = true;
    return {url: denied, shortCircuit: true};
  }
  return next(specifier, context);
}});
const {createBrowserCloudDevHandler, BROWSER_CLOUD_BRIDGE_PATH} = await import(bridge);
hooks.deregister();
assert.ok(profileHookInstalled, 'The exact bridge imported the closed profile port');

const origin = 'http://127.0.0.1:43210';
const endpoint = 'https://api.eliza.app/api/v1/subscription/entitlement-keys';
const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
];

class ClosedResponse extends EventEmitter {
  status = 0;
  destroyed = false;
  writableEnded = false;
  data;
  writeHead(status, headers) {
    assert.equal(this.destroyed, false);
    assert.equal(this.writableEnded, false);
    assert.equal(this.status, 0);
    assert.equal(headers['Cache-Control'], 'no-store');
    this.status = status;
  }
  end(body) {
    assert.equal(this.destroyed, false);
    this.data = JSON.parse(body);
    this.writableEnded = true;
  }
  close() {
    this.destroyed = true;
    this.emit('close');
  }
}

function fixture() {
  const owner = new AsyncLocalStorage(), records = new Map();
  const handler = createBrowserCloudDevHandler({
    profile: '/synthetic-never-read-browser-cloud-request-custody',
    async request(url, options) {
      assert.equal(url, endpoint);
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.has('Authorization'), false);
      assert.equal(options.method, undefined);
      const row = records.get(owner.getStore());
      assert.ok(row && !row.signal);
      row.signal = options.signal;
      row.entered.resolve();
      await row.release.promise;
      return Response.json({keys: ['synthetic-public-key-'+owner.getStore()]});
    },
  });

  function invoke(input, response) {
    const req = Readable.from([Buffer.from(JSON.stringify(input))]);
    Object.assign(req, {url: BROWSER_CLOUD_BRIDGE_PATH, method: 'POST',
      headers: {host: '127.0.0.1:43210', origin, 'content-type': 'application/json', 'x-alpha-browser-cloud': '1'}});
    return handler(req, response);
  }

  return {
    async start(generation, slot) {
      assert.ok(!records.has(generation) && ids[slot-1]);
      const row = {res: new ClosedResponse(), release: Promise.withResolvers(), entered: Promise.withResolvers()};
      records.set(generation, row);
      row.done = owner.run(generation, () => invoke({operation: 'request', environment: 'production', requestId: ids[slot-1],
        input: {url: endpoint, method: 'GET'}}, row.res));
      await Promise.race([row.entered.promise, row.done]);
    },
    async cancel(slot) {
      const res = new ClosedResponse();
      await invoke({operation: 'cancel', requestId: ids[slot-1]}, res);
      assert.deepEqual([res.status, res.data, res.listenerCount('close')], [200, {}, 0]);
    },
    close(generation) {
      records.get(generation).res.close();
    },
    async finish(generation) {
      const row = records.get(generation);
      assert.ok(row.signal);
      row.release.resolve();
      await row.done;
      assert.equal(row.res.listenerCount('close'), 0);
      if (row.res.status === 200)
        assert.deepEqual(row.res.data, {status: 200, data: {keys: ['synthetic-public-key-'+generation]}});
      if (row.res.status === 409) assert.deepEqual(row.res.data, {error: 'Cloud operation cancelled', code: 20});
    },
    observe() {
      const rows = [...records];
      return {
        dispatched: rows.filter(([, row]) => row.signal).map(([id]) => id),
        pending: rows.filter(([, row]) => row.res.listenerCount('close') === 1).map(([id]) => id),
        aborted: rows.filter(([, row]) => row.signal?.aborted).map(([id]) => id),
        closed: rows.filter(([, row]) => row.res.destroyed).map(([id]) => id),
        status: rows.map(([id, row]) => [id, row.res.status]),
      };
    },
  };
}

async function baseline() {
  const f = fixture();
  const steps = [];
  const point = async (name, ...args) => {
    await f[name](...args);
    steps.push({name, args, state: f.observe()});
  };
  await point('start', 1, 1);
  await point('start', 2, 1);
  await point('cancel', 1);
  await point('start', 3, 1);
  await point('finish', 1);
  await point('cancel', 1);
  await point('finish', 3);
  return steps;
}

assert.equal(process.argv[2], 'baseline');
const result = await baseline();
assert.equal(globalThis.browserCloudProfileAccess, 0);
console.log(JSON.stringify(result));
