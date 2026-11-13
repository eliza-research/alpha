import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkTraces, qmap} from '../specs/quint/refinement/check-traces.mjs';
import {boundInputs, bundledSource, call, captureSources, checkpoint, deferred, tick, trace} from '../specs/quint/refinement/application/support.mjs';

const driver = fileURLToPath(import.meta.url);
const implementation = 'apps/app/src/runtime/digest-inbox.ts';
const model = 'RendererDigestQueue';
const ids = [1, 2, 3, 4];
const empty = {scope: '', order: 0, phase: '', cancelled: false, gets: 0};

async function scenario(createDigestInbox, name, drive) {
  const scope = 'hosted-digests:fixture-queue-' + name;
  const values = new Map(), attempts = new Map();
  const storage = {
    async read(key) {return structuredClone(values.get(key) ?? null);},
    async write(key, value) {values.set(key, structuredClone(value));},
    async remove(key) {values.delete(key);},
  };
  const observe = () => ({'s.lastOrder': attempts.size, 's.requests': qmap(ids.map(id => {
    const request = attempts.get(id);
    if (!request) return [id, empty];
    return [id, {scope: request.scope, order: request.order, phase: request.phase,
      cancelled: request.controller.signal.aborted, gets: request.gets}];
  }))});
  const schedule = trace(name, observe());
  const record = (label, action, ...args) => checkpoint(schedule, label, call(action, ...args), observe());
  await drive({
    async submit(id, target = 'web') {
      assert.ok(!attempts.has(id));
      const controller = new AbortController(), android = target === 'android-fallback';
      const exact = android ? 'renderer-' + scope : scope;
      const request = {controller, scope: target, order: attempts.size + 1, phase: 'queued', gets: 0};
      const inbox = createDigestInbox({android, nativeReady: false, storage, scope,
        native() {throw Error('This queue campaign uses renderer ownership only');}});
      attempts.set(id, request);
      request.completion = inbox.sync({
        results(clientId, signal) {
          assert.equal(signal, controller.signal);
          assert.equal(clientId, values.get(exact).clientId);
          assert.equal([...attempts.values()].filter(other => other.scope === target && other.phase === 'running').length, 0);
          assert.equal(request.gets, 0);
          request.gets++;
          request.phase = 'running';
          request.reply = deferred();
          return request.reply.promise;
        },
        ack() {throw Error('An empty result page cannot acknowledge');},
      }, controller.signal).then(rows => {
        assert.deepEqual(rows, []);
        request.phase = 'complete';
      }, error => {
        if (error.name === 'AbortError') request.phase = 'aborted';
        else {
          assert.equal(error.message, 'Synthetic result read refused');
          request.phase = 'refused';
        }
      });
      await tick();
      record('An actual inbox call enters the exact scope queue or owns the first read', 'submit', id, target);
    },
    async abort(id) {
      attempts.get(id).controller.abort();
      await tick();
      record('Abort retires a queued or held caller without transferring the scope early', 'abort', id);
    },
    async finish(id, replied = true) {
      const request = attempts.get(id);
      assert.equal(request.phase, 'running');
      if (replied) request.reply.resolve([]);
      else request.reply.reject(Error('Synthetic result read refused'));
      await request.completion;
      await tick();
      record('Settlement releases the actual scope and admits its first live successor', 'finish', id, replied);
    },
  });
  assert.ok([...attempts.values()].every(request => ['complete', 'aborted', 'refused'].includes(request.phase)));
  assert.ok([...values.keys()].every(key => key === scope || key === 'renderer-' + scope));
  return schedule;
}

async function checkRendererDigestQueue(extraSources = []) {
  captureSources([driver, implementation, ...extraSources]);
  const {exports: {createDigestInbox}, sources} = await bundledSource(implementation);
  const run = (name, drive) => scenario(createDigestInbox, name, drive);
  const traces = [
    await run('same-scope-fifo-and-reuse', async f => {
      await f.submit(1); await f.submit(2); await f.submit(3);
      await f.finish(1); await f.finish(2); await f.finish(3);
      await f.submit(4); await f.finish(4);
    }),
    await run('cancelled-predecessor-and-queued-successor', async f => {
      await f.submit(1); await f.submit(2); await f.submit(3); await f.abort(2);
      await f.abort(1); await f.finish(1); await f.finish(3);
    }),
    await run('renderer-fallback-does-not-share-browser-queue', async f => {
      await f.submit(1); await f.submit(2, 'android-fallback'); await f.submit(3);
      await f.finish(2); await f.submit(4, 'android-fallback'); await f.finish(1);
      await f.finish(4); await f.finish(3);
    }),
    await run('refused-predecessor-still-releases-next-fallback-call', async f => {
      await f.submit(1, 'android-fallback'); await f.submit(2, 'android-fallback');
      await f.finish(1, false); await f.finish(2);
    }),
    await run('transport-refusal-can-settle-before-abort-readback', async f => {
      await f.submit(1); await f.submit(2); await f.abort(1);
      await f.finish(1, false); await f.finish(2);
    }),
    await run('all-cancelled-queued-calls-drain-without-provider-reads', async f => {
      await f.submit(1); await f.submit(2); await f.submit(3); await f.abort(2); await f.abort(3);
      await f.finish(1); await f.submit(4); await f.finish(4);
    }),
  ];
  return await checkTraces(boundInputs({model, traces, sources: [driver, ...sources, ...extraSources],
    scope: 'bounded-orchestration', assumptions: [
      'Distinct actual renderer inbox instances share the pinned module queue by exact storage scope. All provider calls return controlled empty pages.',
      'Four caller slots, one page per caller and two effective scopes. Multi-page retention, physical cross-tab locking and installed native inbox arbitration use separate evidence.',
    ]}));
}

test('renderer digest sync queues by exact scope and retires queued callers', {timeout: scaledTimeout(120000)}, async () => {
  const receipt = await checkRendererDigestQueue([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 6);
  assert.deepEqual(receipt.observedFields, ['s.lastOrder', 's.requests']);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
