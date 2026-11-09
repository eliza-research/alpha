import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {captureInputs} from '../../refinement/check-traces.mjs';
import {loadTaskService} from '../../refinement/services/task-service/module.mjs';

const sibling = 'sibling';
const action = (name, ...args) => ({name, args});
const denyFetch = async () => {throw Error('The connector custody fixture forbids external requests');};

async function fixture(runtime, identity, {detached = false, eager = false, heldDisposal = false} = {}) {
  const a = 'quint-connector-owner-'+identity;
  const b = 'quint-connector-rival-'+identity;
  const type = 'quint-connector-service-'+identity;
  const source = 'quint-connector-custody-'+identity;
  const start = Promise.withResolvers(), started = Promise.withResolvers();
  const stop = Promise.withResolvers(), stopping = Promise.withResolvers();
  const after = Promise.withResolvers(), dispose = Promise.withResolvers(), disposing = Promise.withResolvers();
  const legacy = source+'-legacy';
  let continuation, onDetached, unloading, loading, stopCalls = 0;
  let continuationState = 'none', disposeHeld = false;
  const actions = [];
  const transition = (name, ...args) => actions.push(action(name, 1, ...args));
  const service = {name: 'HeldConnectorService', serviceType: type, async start(owner) {
    started.resolve();
    await start.promise;
    if (detached) {
      continuationState = 'waiting';
      continuation = after.promise.then(async () => {
        register(owner, 'late');
        continuationState = 'done';
        transition('continueDetached');
        await onDetached?.();
      });
    } else register(owner, 'late');
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
    ...(heldDisposal ? {async dispose() {
      disposeHeld = true;
      disposing.resolve();
      try {await dispose.promise;}
      finally {disposeHeld = false;}
    }} : {}),
  };
  const rival = {name: b, init(_config, owner) {
    register(owner, 'rival');
    register(owner, 'sibling', sibling);
  }};
  function register(owner, label, accountId) {
    const sendHandler = async () => label;
    owner.registerMessageConnector({source, label, accountId, sendHandler});
    owner.registerPostConnector({source, label, accountId});
    if (!accountId) owner.registerSendHandler(legacy, sendHandler);
  }
  function keys(name) {
    const ownership = runtime.getPluginOwnership(name);
    const selected = entries => entries.filter(entry => entry.source === source)
      .map(entry => entry.accountId ?? 'default').sort();
    return ownership ? {
      message: selected(ownership.messageConnectors),
      post: selected(ownership.postConnectors),
      legacy: ownership.sendHandlerSources.includes(legacy),
    } : {message: null, post: null, legacy: null};
  }
  async function route(accountId, target = source) {
    try {
      return await runtime.sendMessageToTarget({source: target, accountId}, {text: 'synthetic fixture', agentVoiced: true});
    } catch (error) {
      assert.match(error.message, /No send handler registered for source/);
      return 'missing';
    }
  }
  async function observe() {
    const connectors = runtime.getMessageConnectors().filter(entry => entry.source === source);
    const posts = runtime.getPostConnectors().filter(entry => entry.source === source);
    const current = runtime.getPluginOwnership(a), owner = keys(a), rival = keys(b);
    return {
      owner: current ? current.plugin === first ? 'first' : 'replacement' : 'absent',
      ownerKeys: owner.message, rivalKeys: rival.message,
      ownerPostKeys: owner.post, rivalPostKeys: rival.post,
      ownerLegacyKey: owner.legacy, rivalLegacyKey: rival.legacy,
      default: connectors.find(entry => !entry.accountId)?.label ?? 'missing',
      sibling: connectors.find(entry => entry.accountId === sibling)?.label ?? 'missing',
      defaultPost: posts.find(entry => !entry.accountId)?.label ?? 'missing',
      siblingPost: posts.find(entry => entry.accountId === sibling)?.label ?? 'missing',
      route: await route(undefined), siblingRoute: await route(sibling),
      legacyRoute: await route(undefined, legacy),
      servicePublished: runtime.getService(type) !== null,
      stopCalls,
    };
  }
  async function cleanup() {
    start.resolve();
    stop.resolve();
    after.resolve();
    dispose.resolve();
    try {
      await continuation;
      await unloading;
      await loading;
      await runtime.unloadPlugin(a);
      await runtime.unloadPlugin(b);
    } finally {
      runtime.unregisterMessageConnector(source);
      runtime.unregisterMessageConnector(legacy);
      runtime.unregisterPostConnector(source);
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
    runtime, observe, cleanup, first, a,
    drainActions: () => actions.splice(0),
    observeScheduling: () => ({
      classPresent: runtime.serviceTypes.get(type)?.includes(service) ?? false,
      disposing: disposeHeld, continuation: continuationState,
    }),
    async registerRival() {await runtime.registerPlugin(rival); transition('registerRival');},
    registerHost() {register(runtime, 'host'); transition('hostClaim');},
    async registerReplacement(label) {
      await runtime.registerPlugin({name: a, init(_config, owner) {if (label) register(owner, label);}});
      transition('registerReplacement', Boolean(label));
    },
    async unloadReplacement() {await runtime.unloadPlugin(a); transition('unloadReplacement');},
    async unloadRival() {await runtime.unloadPlugin(b); transition('unloadRival');},
    async withdraw() {
      unloading = runtime.unloadPlugin(a);
      assert.equal(runtime.serviceTypes.has(type), false, 'Unload withdrew the class before yielding');
      await assert.rejects(runtime.getServiceLoadPromise(type), /not found or failed to start/);
      transition('withdraw');
    },
    async returnStart() {start.resolve(); await stopping.promise; transition('returnStart');},
    async beginDispose() {unloading = runtime.unloadPlugin(a); await disposing.promise; transition('beginDispose');},
    async publishBeforeCordon() {start.resolve(); assert.ok((await loading).service); transition('returnStart');},
    async completeDispose() {dispose.resolve(); await stopping.promise; transition('withdraw');},
    async finish() {
      stop.resolve();
      const ownership = await unloading;
      if (loading && !heldDisposal) assert.match((await loading).error?.message, /not found or failed to start/);
      transition('finishUnload');
      return ownership;
    },
    async completeDetached(run) {assert.ok(continuation); onDetached = run; after.resolve(); await continuation;},
  };
}

const expected = (owner, ownerKeys, rivalKeys, label, account = 'missing', stopCalls = 1) => ({
  owner, ownerKeys, rivalKeys, ownerPostKeys: ownerKeys, rivalPostKeys: rivalKeys,
  ownerLegacyKey: ownerKeys?.includes('default') ?? null, rivalLegacyKey: rivalKeys?.includes('default') ?? null,
  default: label, sibling: account, defaultPost: label, siblingPost: account,
  route: label, siblingRoute: account === 'missing' ? label : account, legacyRoute: label,
  servicePublished: false, stopCalls,
});

async function sharedClassRuntimeIsolation(sql, left) {
  const database = await sql.createIsolatedTestDatabase('quint-connector-isolation-'+randomUUID(), [], {postgresUrl: null});
  const right = database.runtime;
  right.fetch = denyFetch;
  const source = 'quint-shared-class-route', serviceType = 'quint-shared-class-service';
  const owners = new Map([[left, 'quint-left-owner'], [right, 'quint-right-owner']]);
  const stopped = new Map();
  const checkpoints = [];
  const definition = {name: 'SharedConnectorClass', serviceType, async start(runtime) {
    runtime.registerMessageConnector({source, label: owners.get(runtime)});
    return {async stop() {stopped.set(runtime, (stopped.get(runtime) ?? 0)+1);}};
  }};
  const observe = runtime => {
    const name = owners.get(runtime);
    return {
      route: runtime.getMessageConnectors().find(entry => entry.source === source)?.label ?? 'missing',
      owned: runtime.getPluginOwnership(name)?.messageConnectors.some(entry => entry.source === source) ?? false,
      published: runtime.getService(serviceType) !== null,
      stopped: stopped.get(runtime) ?? 0,
    };
  };
  function point(label, expected, ...actions) {
    const actual = [observe(left), observe(right)];
    assert.deepEqual(actual, expected, label);
    checkpoints.push({label, actual, actions});
  }
  const active = runtime => ({route: owners.get(runtime), owned: true, published: true, stopped: 0});
  const inactive = stopped => ({route: 'missing', owned: false, published: false, stopped});
  try {
    await right.initialize({skipMigrations: true});
    for (const [runtime, name] of owners) await runtime.registerPlugin({
      name, init: (_config, runtime) => runtime.registerService(definition),
    });
    point('both runtimes register the same class before either starts', [inactive(0), inactive(0)]);
    await left.getServiceLoadPromise(serviceType);
    point('left start captures its owner even after right registers the same class', [active(left), inactive(0)],
      action('beginStart', 1), action('returnStart', 1));
    await right.getServiceLoadPromise(serviceType);
    point('each runtime publishes its own exact route', [active(left), active(right)],
      action('beginStart', 2), action('returnStart', 2));
    await left.unloadPlugin(owners.get(left));
    point('left unload keeps right service and route untouched', [inactive(1), active(right)],
      action('withdraw', 1), action('finishUnload', 1));
    return {name: 'shared service class keeps runtime-local owner custody', init: action('initIsolation'), checkpoints};
  } finally {
    try {
      await left.unloadPlugin(owners.get(left));
      await right.stop();
    } finally {await database.cleanup();}
  }
}

/** Replay the original late connector schedules against the authenticated product repair. */
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
        checkpoints.push({label, actual: {...actual, ...f.observeScheduling()}, actions: f.drainActions()});
      };
      await point('initial registration while service start is held', expected('first', ['default'], null, 'initial', 'missing', 0));
      await run(f, point);
      records.push({name, init: action('initHeld', options.detached ?? false), checkpoints});
    } finally {await f.cleanup();}
  }

  try {
    await runtime.initialize({skipMigrations: true});
    await scenario('late start cannot republish a withdrawn connector', {eager: true}, async (f, point) => {
      await f.withdraw();
      await point('connector and service class withdrawn', expected('first', ['default'], null, 'missing', 'missing', 0));
      await f.returnStart();
      await point('late publication is refused while returned service is stopped', expected('first', ['default'], null, 'missing'));
      assert.equal((await f.finish()).plugin, f.first);
      await point('unload finishes with no connector or handler', expected('absent', null, null, 'missing'));
      assert.equal(await f.runtime.unloadPlugin(f.a), null);
      await f.registerReplacement();
      await point('same-name registration has no stale key', expected('replacement', [], null, 'missing'));
      await f.unloadReplacement();
      await point('second unload also leaves no route', expected('absent', null, null, 'missing'));
    });

    await scenario('late start preserves a rival that already owns the exact key', {}, async (f, point) => {
      await f.registerRival();
      await point('rival takes default key and claims sibling account', expected('first', [], ['default', sibling], 'rival', 'sibling', 0));
      await f.withdraw();
      await f.returnStart();
      await point('retired publication leaves both rival keys intact', expected('first', [], ['default', sibling], 'rival', 'sibling'));
      await f.finish();
      await point('both exact routes outlive the unrelated unload', expected('absent', null, ['default', sibling], 'rival', 'sibling'));
      await f.unloadRival();
      await point('rival unload removes both of its own keys', expected('absent', null, null, 'missing'));
    });

    await scenario('rival can claim the exact key while late service stops', {}, async (f, point) => {
      await f.withdraw();
      await f.returnStart();
      await point('old route remains withdrawn while the late service stops', expected('first', ['default'], null, 'missing'));
      await f.registerRival();
      await point('rival claims the keys before teardown finishes', expected('first', [], ['default', sibling], 'rival', 'sibling'));
      await f.finish();
      await point('rival remains the public route and exact owner', expected('absent', null, ['default', sibling], 'rival', 'sibling'));
    });

    await scenario('detached lazy continuation cannot install an orphan', {detached: true}, async (f, point) => {
      await f.withdraw();
      await f.returnStart();
      await f.finish();
      await point('unload completes with no public connector', expected('absent', null, null, 'missing'));
      await f.completeDetached();
      await point('old continuation has no publication authority', expected('absent', null, null, 'missing'));
      await f.registerReplacement('replacement');
      await point('a deliberate current claim works', expected('replacement', ['default'], null, 'replacement'));
      await f.unloadReplacement();
      await point('current claim is removed by its own unload', expected('absent', null, null, 'missing'));
    });

    for (const eager of [false, true]) {
      await scenario('detached '+(eager ? 'eager' : 'lazy')+' continuation cannot overwrite the replacement',
        {detached: true, eager}, async (f, point) => {
          await f.withdraw();
          await f.returnStart();
          await f.finish();
          await f.registerReplacement('replacement');
          await point('replacement owns its own connector', expected('replacement', ['default'], null, 'replacement'));
          await f.completeDetached();
          await point('retired continuation preserves replacement route and ownership', expected('replacement', ['default'], null, 'replacement'));
          await f.unloadReplacement();
          await point('replacement unload removes only its own route', expected('absent', null, null, 'missing'));
        });
    }

    await scenario('unscoped host claims stay callable across old teardown', {}, async (f, point) => {
      await f.withdraw();
      f.registerHost();
      await point('host registers through all three existing unscoped APIs', expected('first', [], null, 'host', 'missing', 0));
      await f.returnStart();
      await f.finish();
      await point('retired start cannot displace the unscoped host', expected('absent', null, null, 'host'));
    });

    await scenario('current nested plugin registration uses its own capture', {detached: true}, async (f, point) => {
      await f.withdraw();
      await f.returnStart();
      await f.finish();
      await f.completeDetached(f.registerRival);
      await point('rival init opens a distinct live ownership scope', expected('absent', null, ['default', sibling], 'rival', 'sibling'));
    });

    await scenario('disposal still settles before connector withdrawal', {heldDisposal: true}, async (f, point) => {
      await f.beginDispose();
      await f.publishBeforeCordon();
      await point('start still publishes normally while disposal is held',
        {...expected('first', ['default'], null, 'late', 'missing', 0), servicePublished: true});
      await f.completeDispose();
      await point('after disposal existing cleanup withdraws connector and service', expected('first', ['default'], null, 'missing'));
      await f.finish();
      await point('unload returns after its sole service stop', expected('absent', null, null, 'missing'));
    });
    records.push(await sharedClassRuntimeIsolation(sql, runtime));
  } finally {
    try {await runtime.stop();}
    finally {await database.cleanup();}
  }

  const sourceHashesAfter = captureInputs(sql.sources);
  assert.deepEqual(sourceHashesAfter, sql.driverHashes, 'Pinned runtime and source-fixture bytes stayed unchanged');
  return {records, sources: sql.sources, driverHashes: sql.driverHashes};
}
