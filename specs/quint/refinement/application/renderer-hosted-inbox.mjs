import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkTraces, qmap, qset} from '../check-traces.mjs';
import {boundInputs, bundledSource, call, captureSources, checkpoint, deferred, trace} from './support.mjs';

const driver = fileURLToPath(import.meta.url);
const implementation = 'apps/app/src/runtime/digest-inbox.ts';
const model = 'RendererHostedInbox';
const ids = [1, 2];
const now = '2027-01-01T12:00:00.000Z';
const runId = id => 'run-' + id;
const numeric = value => {
  const id = ids.find(id => runId(id) === value);
  assert.ok(id, 'The scope only contains declared synthetic result identities');
  return id;
};
function payload(id, version) {
  return {cursor: id, runId: runId(id), workflowId: 'fixture-workflow', workflowVersionId: 'fixture-version',
    templateVersion: 'fixture-template', scheduledAt: now, source: {observedAt: now, expiresAt: now},
    status: 'completed', startedAt: now, completedAt: now, output: 'fixture-result-v' + version, error: null};
}
function resultClass(error) {
  if (error.name === 'AbortError') return 'aborted';
  if (error.message === 'Saved digest result changed') return 'changed';
  if (['Synthetic storage refusal', 'Synthetic acknowledgement refusal'].includes(error.message)) return 'refused';
  throw error;
}

async function scenario(createDigestInbox, name, platform, seed, drive) {
  const scope = 'hosted-digests:fixture-' + name;
  const indexKey = platform === 'fallback' ? 'renderer-' + scope : scope;
  const slot = id => indexKey + ':' + runId(id);
  const values = new Map();
  const index = () => values.get(indexKey);
  let fault = 'none', notice = 'ok', indexWrites = 0, held, arrival, sync, controller, firstClient;
  let getCalls = 0, ackCalls = 0, ackCommits = 0, lastAck = 0, noticeCalls = 0, posted = 0, result = '';
  if (seed !== 'empty') {
    values.set(slot(1), payload(1, 1));
    values.set(indexKey, {clientId: 'fixture-restored-client', ids: seed === 'retained' ? [runId(1)] : [],
      pendingRemoval: [runId(1)]});
  }
  const admittedSlot = key => assert.ok(key === indexKey || ids.some(id => slot(id) === key), 'Renderer uses its exact scope');
  const storage = {
    async read(key) {admittedSlot(key); return structuredClone(values.get(key) ?? null);},
    async write(key, value) {
      admittedSlot(key);
      const isIndex = key === indexKey;
      if (isIndex) indexWrites++;
      if ((!isIndex && fault === 'rowBefore') || (isIndex && fault === 'indexBefore') ||
        (isIndex && indexWrites === 2 && fault === 'noticeClear')) throw Error('Synthetic storage refusal');
      values.set(key, structuredClone(value));
      if ((!isIndex && fault === 'rowAfter') || (isIndex && fault === 'indexAfter')) throw Error('Synthetic storage refusal');
    },
    async remove(key) {admittedSlot(key); values.delete(key);},
  };
  const inbox = createDigestInbox({android: platform === 'fallback', nativeReady: false, storage, scope,
    native() {throw Error('Unverified Android renderer must use its own inbox');},
    async afterCommit(entry, signal) {
      signal.throwIfAborted();
      const id = numeric(entry.runId);
      assert.ok(index().ids.includes(entry.runId));
      assert.equal(entry.output, values.get(slot(id)).output);
      noticeCalls++;
      if (notice !== 'refused') posted++;
      if (notice !== 'ok') throw Error('Synthetic publication did not acknowledge');
    },
  });
  function hold(kind, signal, entry) {
    assert.equal(held, undefined);
    assert.equal(signal, controller.signal);
    held = {...deferred(), kind, signal, entry};
    arrival.resolve();
    return held.promise;
  }
  function verifyClient(clientId) {
    assert.equal(clientId, index().clientId);
    firstClient ??= clientId;
    assert.equal(clientId, firstClient, 'Replay reuses the durable inbox client identity');
  }
  const client = {
    results(clientId, signal) {
      verifyClient(clientId);
      getCalls++;
      return hold('results', signal);
    },
    ack(clientId, entry, signal) {
      verifyClient(clientId);
      assert.ok(index().ids.includes(entry.runId), 'The exact result is indexed before provider ACK');
      assert.deepEqual(values.get(slot(numeric(entry.runId))), entry);
      ackCalls++;
      return hold('ack', signal, entry);
    },
  };
  async function observe() {
    const current = index(), retained = current?.ids ?? [];
    assert.deepEqual((await inbox.history()).map(row => row.runId), retained);
    return {'s.scope': platform, 's.phase': held?.kind ?? 'idle', 's.client': !!current?.clientId,
      's.cancelled': controller?.signal.aborted ?? false, 's.result': result,
      's.rows': qmap(ids.map(id => {
        const stored = values.get(slot(id));
        if (!stored) return [id, 0];
        const version = [1, 2].find(version => payload(id, version).output === stored.output);
        assert.ok(version);
        assert.deepEqual(stored, payload(id, version));
        return [id, version];
      })),
      's.retained': qset(retained.map(numeric)), 's.removals': qset((current?.pendingRemoval ?? []).map(numeric)),
      's.notices': qset((current?.pendingNotices ?? []).map(numeric)), 's.getCalls': getCalls,
      's.ackCalls': ackCalls, 's.ackCommits': ackCommits, 's.lastAck': lastAck,
      's.waitingAck': held?.entry ? numeric(held.entry.runId) : 0, 's.noticeCalls': noticeCalls, 's.posted': posted};
  }
  const schedule = trace(name, await observe(), call('initFor', platform, seed));
  const record = async (label, action, ...args) => checkpoint(schedule, label, call(action, ...args), await observe());
  async function waitBoundary() {
    await Promise.race([arrival.promise, sync]);
    if (!held) {await sync; sync = undefined;}
  }
  async function settle(kind, response, error) {
    const current = held;
    assert.equal(current?.kind, kind);
    held = undefined;
    arrival = deferred();
    if (error) current.reject(error);
    else current.resolve(response);
    await waitBoundary();
  }
  await drive({
    async start() {
      assert.equal(sync, undefined);
      controller = new AbortController();
      fault = 'none';
      notice = 'ok';
      arrival = deferred();
      sync = inbox.sync(client, controller.signal)
        .then(history => {
          assert.deepEqual(history.map(row => row.runId), index().ids);
          result = 'complete';
        }, error => {result = resultClass(error);});
      await waitBoundary();
      await record('Actual inbox recovery and notice retry precede the first provider read', 'start');
    },
    async deliver(id, version = 1, writeFault = 'none', noticeReply = 'ok') {
      fault = writeFault;
      notice = noticeReply;
      indexWrites = 0;
      await settle('results', [payload(id, version)]);
      fault = 'none';
      await record('The result is stored, indexed and offered to the notice port before ACK', 'deliver', id, version, writeFault, noticeReply);
    },
    async acknowledge(reply = 'ok') {
      assert.equal(held?.kind, 'ack');
      if (reply !== 'refused') {
        ackCommits++;
        lastAck = numeric(held.entry.runId);
      }
      await settle('ack', undefined, reply === 'ok' ? undefined : Error('Synthetic acknowledgement refusal'));
      await record('Provider acceptance and reply settlement remain separate', 'acknowledge', reply);
    },
    async empty() {
      await settle('results', []);
      await record('An empty page ends the actual inbox sync', 'emptyPage');
    },
    async abort() {
      controller.abort();
      assert.ok(held.signal.aborted);
      await record('The real signal retires the current held request', 'abort');
    },
  });
  assert.equal(sync, undefined);
  return schedule;
}

export async function checkRendererHostedInbox(extraSources = []) {
  captureSources([driver, implementation, ...extraSources]);
  const {exports: {createDigestInbox}, sources} = await bundledSource(implementation);
  const native = {history() {}, sync() {}};
  assert.equal(createDigestInbox({android: true, nativeReady: true, native: () => native}), native);
  const run = (name, platform, seed, drive) => scenario(createDigestInbox, name, platform, seed, drive);
  const retry = async f => {await f.start(); await f.deliver(1); await f.acknowledge(); await f.empty();};
  const traces = [
    await run('normal-retention-and-ack', 'browser', 'empty', retry),
    await run('exact-evicted-journal-row-is-removed-on-recovery', 'browser', 'evicted', async f => {
      await f.start(); await f.empty();
    }),
    await run('stale-removal-marker-cannot-remove-retained-row', 'fallback', 'retained', async f => {
      await f.start(); await f.empty(); await f.start(); await f.deliver(1, 2);
    }),
  ];
  for (const fault of ['rowBefore', 'rowAfter', 'indexBefore', 'indexAfter', 'noticeClear']) {
    traces.push(await run('replay-after-'+fault, 'browser', 'empty', async f => {
      await f.start(); await f.deliver(1, 1, fault); await retry(f);
    }));
  }
  traces.push(
    await run('notice-refusal-and-lost-provider-ack-recover-separately', 'fallback', 'empty', async f => {
      await f.start(); await f.deliver(1, 1, 'none', 'refused'); await f.acknowledge('lost');
      await retry(f);
    }),
    await run('notice-effect-with-lost-reply-is-retried', 'browser', 'empty', async f => {
      await f.start(); await f.deliver(1, 1, 'none', 'lost'); await f.acknowledge(); await f.empty();
      await f.start(); await f.empty();
    }),
    await run('refused-provider-ack-cannot-overwrite-a-digest', 'browser', 'empty', async f => {
      await f.start(); await f.deliver(1); await f.acknowledge('refused');
      await f.start(); await f.deliver(1, 2);
    }),
    await run('retirement-before-results-prevents-local-admission', 'browser', 'empty', async f => {
      await f.start(); await f.abort(); await f.deliver(2);
    }),
    await run('retirement-during-ack-keeps-committed-result-and-remote-outcome', 'browser', 'empty', async f => {
      await f.start(); await f.deliver(2); await f.abort(); await f.acknowledge();
    }),
    await run('second-page-and-repeated-result-remain-exact', 'fallback', 'empty', async f => {
      await f.start(); await f.deliver(1); await f.acknowledge(); await f.deliver(2);
      await f.acknowledge(); await f.empty();
    }),
  );
  return await checkTraces(boundInputs({model, traces, sources: [driver, ...sources, ...extraSources],
    scope: 'bounded-orchestration', assumptions: [
      'Actual Alpha inbox admission and pinned DigestInbox execute with synthetic storage, result and acknowledgement ports.',
      'Two result identities, one row per provider page and exact stored bytes. Recovered index writes and notices succeed at the start of these schedules. Physical storage, bulk retention and concurrent same-scope callers remain separate.',
      'The browser notice ledger has its own source model. A synthetic notice effect that commits without a reply can be offered again by this inbox.',
    ]}));
}
