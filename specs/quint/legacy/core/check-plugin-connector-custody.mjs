import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {captureInputs} from '../../refinement/check-traces.mjs';
import {loadTaskService} from '../../refinement/services/task-service/module.mjs';

const sibling = 'sibling';
const denyFetch = async () => {throw Error('The connector custody fixture forbids external requests');};

async function fixture(runtime, identity, {detached = false, eager = false} = {}) {
  const a = 'quint-connector-owner-'+identity;
  const b = 'quint-connector-rival-'+identity;
  const type = 'quint-connector-service-'+identity;
  const source = 'quint-connector-custody-'+identity;
  const start = Promise.withResolvers(), started = Promise.withResolvers();
  const stop = Promise.withResolvers(), stopping = Promise.withResolvers();
  const after = Promise.withResolvers();
  let continuation, unloading, loading, stopCalls = 0;
  const service = {name: 'HeldConnectorService', serviceType: type, async start(owner) {
    started.resolve();
    await start.promise;
    if (detached) continuation = after.promise.then(() => register(owner, 'late'));
    else register(owner, 'late');
    return {async stop() {
      stopCalls++;
      stopping.resolve();
      await stop.promise;
    }};
  }};
  const first = {
    name: a,
    async init(_config, owner) {
      register(owner, 'initial');
      if (!eager) await owner.registerService(service);
    },
    ...(eager ? {services: [service]} : {}),
  };
  const rival = {name: b, init(_config, owner) {
    register(owner, 'rival');
    register(owner, 'sibling', sibling);
  }};
  function register(owner, label, accountId) {
    owner.registerMessageConnector({source, label, accountId, async sendHandler() {return label;}});
  }
  function keys(name) {
    return runtime.getPluginOwnership(name)?.messageConnectors
      .filter(entry => entry.source === source).map(entry => entry.accountId ?? 'default').sort() ?? null;
  }
  async function route(accountId) {
    try {
      return await runtime.sendMessageToTarget({source, accountId}, {text: 'synthetic fixture', agentVoiced: true});
    } catch (error) {
      assert.match(error.message, /No send handler registered for source/);
      return 'missing';
    }
  }
  async function observe() {
    const connectors = runtime.getMessageConnectors().filter(entry => entry.source === source);
    const current = runtime.getPluginOwnership(a);
    return {
      owner: current ? current.plugin === first ? 'first' : 'replacement' : 'absent',
      ownerKeys: keys(a), rivalKeys: keys(b),
      default: connectors.find(entry => !entry.accountId)?.label ?? 'missing',
      sibling: connectors.find(entry => entry.accountId === sibling)?.label ?? 'missing',
      route: await route(undefined), siblingRoute: await route(sibling),
      servicePublished: runtime.getService(type) !== null,
      stopCalls,
    };
  }
  async function cleanup() {
    start.resolve();
    stop.resolve();
    after.resolve();
    try {
      await continuation;
      await unloading;
      await loading;
      await runtime.unloadPlugin(a);
      await runtime.unloadPlugin(b);
    } finally {
      runtime.unregisterMessageConnector(source);
    }
  }
  try {
    await runtime.registerPlugin(first);
    if (!eager) loading = runtime.getServiceLoadPromise(type).then(service => ({service}), error => ({error}));
    await started.promise;
  } catch (error) {
    await cleanup();
    throw error;
  }
  return {
    runtime, observe, cleanup, first, a, b,
    registerRival: () => runtime.registerPlugin(rival),
    registerReplacement(label) {
      return runtime.registerPlugin({name: a, init(_config, owner) {if (label) register(owner, label);}});
    },
    async withdraw() {
      unloading = runtime.unloadPlugin(a);
      assert.equal(runtime.serviceTypes.has(type), false, 'Unload withdrew the class before yielding');
      await assert.rejects(runtime.getServiceLoadPromise(type), /not found or failed to start/);
    },
    async returnStart() {start.resolve(); await stopping.promise;},
    async finish() {
      stop.resolve();
      const ownership = await unloading;
      if (loading) assert.match((await loading).error?.message, /not found or failed to start/);
      return ownership;
    },
    async completeDetached() {assert.ok(continuation); after.resolve(); await continuation;},
  };
}

const expected = (owner, ownerKeys, rivalKeys, label, account = 'missing', stopCalls = 1) => ({
  owner, ownerKeys, rivalKeys, default: label, sibling: account,
  route: label, siblingRoute: account === 'missing' ? label : account,
  servicePublished: false, stopCalls,
});

/** Source baseline for the original PluginLateStartConnector mismatch and adjacent rival schedules. */
export async function checkPluginConnectorCustody(extraSources = []) {
  const sql = await loadTaskService([fileURLToPath(import.meta.url), ...extraSources]);
  const database = await sql.createIsolatedTestDatabase('quint-connector-custody-'+randomUUID(), [], {postgresUrl: null});
  const runtime = database.runtime;
  runtime.fetch = denyFetch;
  const records = [];
  async function scenario(name, options, run) {
    const f = await fixture(runtime, records.length+1, options);
    try {
      const checkpoints = [];
      const point = async (label, snapshot) => {
        const actual = await f.observe();
        assert.deepEqual(actual, snapshot, name+' '+label);
        checkpoints.push({label, actual});
      };
      await point('initial registration while service start is held', expected('first', ['default'], null, 'initial', 'missing', 0));
      await run(f, point);
      records.push({name, checkpoints});
    } finally {await f.cleanup();}
  }

  try {
    await runtime.initialize({skipMigrations: true});
    await scenario('late start becomes publicly routable without an owner', {eager: true}, async (f, point) => {
      await f.withdraw();
      await point('connector and service class withdrawn', expected('first', ['default'], null, 'missing', 'missing', 0));
      await f.returnStart();
      await point('late start publishes even though returned service is being stopped', expected('first', ['default'], null, 'late'));
      assert.equal((await f.finish()).plugin, f.first);
      await point('unload finishes while connector and handler remain', expected('absent', null, null, 'late'));
      assert.equal(await f.runtime.unloadPlugin(f.a), null);
      await f.registerReplacement();
      await point('same name registered without inheriting the orphan key', expected('replacement', [], null, 'late'));
      await f.runtime.unloadPlugin(f.a);
      await point('second unload cannot remove the unowned key', expected('absent', null, null, 'late'));
    });

    await scenario('late start displaces a rival that already owns the exact key', {}, async (f, point) => {
      await f.registerRival();
      await point('rival takes default key and claims sibling account', expected('first', [], ['default', sibling], 'rival', 'sibling', 0));
      await f.withdraw();
      await f.returnStart();
      await point('late start takes only default from the rival', expected('first', ['default'], [sibling], 'late', 'sibling'));
      await f.finish();
      await point('late key outlives unload while sibling stays rival-owned', expected('absent', null, [sibling], 'late', 'sibling'));
      await f.runtime.unloadPlugin(f.b);
      await point('rival unload removes only its sibling account', expected('absent', null, null, 'late'));
    });

    await scenario('rival takes the exact key after late publication', {}, async (f, point) => {
      await f.withdraw();
      await f.returnStart();
      await point('late key is briefly visible under withdrawing owner', expected('first', ['default'], null, 'late'));
      await f.registerRival();
      await point('rival replaces late key before teardown finishes', expected('first', [], ['default', sibling], 'rival', 'sibling'));
      await f.finish();
      await point('rival remains the public route and exact owner', expected('absent', null, ['default', sibling], 'rival', 'sibling'));
    });

    await scenario('detached start continuation runs after unregister with no replacement', {detached: true}, async (f, point) => {
      await f.withdraw();
      await f.returnStart();
      await f.finish();
      await point('unload completes with no public connector', expected('absent', null, null, 'missing'));
      await f.completeDetached();
      await point('old continuation installs an unowned route', expected('absent', null, null, 'late'));
      await f.registerReplacement('replacement');
      await point('a deliberate current claim overwrites the orphan', expected('replacement', ['default'], null, 'replacement'));
      await f.runtime.unloadPlugin(f.a);
      await point('current claim is removed by its own unload', expected('absent', null, null, 'missing'));
    });

    await scenario('detached start continuation adopts a replacement of the same name', {detached: true}, async (f, point) => {
      await f.withdraw();
      await f.returnStart();
      await f.finish();
      await f.registerReplacement('replacement');
      await point('replacement owns its own connector', expected('replacement', ['default'], null, 'replacement'));
      await f.completeDetached();
      await point('retired continuation overwrites the replacement route and borrows its ownership', expected('replacement', ['default'], null, 'late'));
      await f.runtime.unloadPlugin(f.a);
      await point('replacement unload finally removes the old route', expected('absent', null, null, 'missing'));
    });

    await scenario('detached eager continuation strips a replacement claim without adopting it', {detached: true, eager: true}, async (f, point) => {
      await f.withdraw();
      await f.returnStart();
      await f.finish();
      await f.registerReplacement('replacement');
      await point('replacement owns its own connector', expected('replacement', ['default'], null, 'replacement'));
      await f.completeDetached();
      await point('old registration capture strips the replacement claim', expected('replacement', [], null, 'late'));
      await f.runtime.unloadPlugin(f.a);
      await point('replacement unload cannot remove the late unowned route', expected('absent', null, null, 'late'));
    });
  } finally {
    try {await runtime.stop();}
    finally {await database.cleanup();}
  }

  const sourceHashesAfter = captureInputs(sql.sources);
  assert.deepEqual(sourceHashesAfter, sql.driverHashes, 'Pinned runtime and source-fixture bytes stayed unchanged');
  return {records, sourceHashesAfter};
}
