import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkTraces} from '../../refinement/check-traces.mjs';
import {bundleVendorCore, observeFile, deferred, tick} from './source-support.mjs';

const driver = fileURLToPath(import.meta.url);
const call = (name, ...args) => ({name, args});
const plugin = {name: 'observe-action-settlement', setup(builder) {
  observeFile(builder, 'action-handler-settlement.ts', [
    ['let effectContractDeclared = false;', 'let effectContractDeclared = false;\n__quint.inspect = () => ({phase,bufferedCallbacks,settledResult});'],
    ['const delivery = deliveryTail.then(() =>\n\t\t\tdeliverWithoutModelStream(buffered),\n\t\t);',
      'const observable = phase === "settled" && !settledResult?.replyFailure;\nif(observable)__quint.queued(buffered.response.text);\nconst delivery = deliveryTail.then(() => {\nif(observable)__quint.started(buffered.response.text);\nreturn deliverWithoutModelStream(buffered);\n});'],
  ]);
}};
const profile = name => name === 'late' ? {module: 'CoreActionSettlement', inHandler: 3, late: 3}
  : {module: 'CoreActionSettlementOutcomes', inHandler: 2, late: 1};

export async function checkActionSettlementRefinement(vendorPath) {
  const bundle = await bundleVendorCore(vendorPath, `
    export {settleActionHandler} from './packages/core/src/runtime/action-handler-settlement.ts';
    export {bindProcessingPolicy} from './packages/core/src/security/processing-policy.ts';
  `, [driver], [plugin]);
  const receipts = [];
  for (const name of ['late', 'outcomes']) {
    const spec = profile(name), traces = [];
    const cases = name === 'late' ? ['late-during-drain', 'late-after-drain', 'transport-rejection']
      : ['ok', 'denial', 'replyFailure', 'invalid', 'throw'];
    for (const scenario of cases) {
      const admitted = deferred(), returned = deferred(), queue = [], delivered = [], transports = [];
      let handlerCallback, finished = false, emitted = 0;
      const observer = {
        queued(text) {queue.push(Number(text));},
        started(text) {assert.equal(queue.shift(), Number(text));},
      };
      const {settleActionHandler, bindProcessingPolicy} = bundle.instantiate(observer);
      const runtime = {agentId: 'fixture-agent', logger: {warn() {}, error() {}}, reportError() {}};
      bindProcessingPolicy(runtime, {decide: () => admitted.promise});
      const result = settleActionHandler({runtime, action: {name: 'ORDER_FIXTURE', egress: []},
        invoke(callback) {handlerCallback = callback; return returned.promise;},
        callback(content) {
          const transport = deferred();
          delivered.push(Number(content.text));
          transports.push({transport, settled: false});
          return transport.promise;
        }}).then(value => {finished = true; return value;});
      const observe = () => {
        const value = observer.inspect();
        return {'state.phase': value.phase, 'state.buffer': value.bufferedCallbacks.map(entry => Number(entry.response.text)),
          'state.chain': [...queue], 'state.delivered': [...delivered], 'state.emitted': emitted,
          'state.busy': transports.some(row => !row.settled),
          'state.spc': finished ? 'done' : !handlerCallback ? 'admit' : value.phase === 'settled' ? 'drain' : 'wait'};
      };
      const trace = {name: scenario, init: {name: 'init'}, expect: observe(), steps: []};
      const step = (label, action) => trace.steps.push({label, action, expect: observe()});
      async function emit() {emitted++; await handlerCallback({text: String(emitted)});}
      function emitWithoutWaiting() {emitted++; void handlerCallback({text: String(emitted)});}
      async function finishTransport(reject = false) {
        const current = transports.find(row => !row.settled);
        assert.ok(current, 'A real transport invocation must be pending');
        current.settled = true;
        if (reject) current.transport.reject(Error('Injected transport rejection'));
        else current.transport.resolve([]);
        await tick();
      }
      if (scenario === 'denial') {
        admitted.resolve({allow: false, code: 'fixture-denied', policyRevision: null});
        const denial = await result;
        assert.equal(denial.data.processingDenied, true);
        step('actual policy denial returns before invoking the handler', call('admitDenied'));
      } else {
        admitted.resolve({allow: true, receiptId: 'receipt', policyRevision: 'v1'});
        await tick();
        step('actual admission invokes a held handler', call('admitAccepted'));
        for (let i = 0; i < spec.inHandler; i++) {await emit(); step('in-handler callback stays buffered', call('handlerEmit'));}
        const outcome = ['replyFailure', 'invalid', 'throw'].includes(scenario) ? scenario : 'ok';
        if (outcome === 'throw') returned.reject(Error('Injected handler failure'));
        else returned.resolve(outcome === 'invalid' ? {} : outcome === 'replyFailure' ? {success: true, replyFailure: {
          kind: 'no_provider', code: 'fixture-no-provider', message: 'No provider', transient: false}} : {success: true});
        await tick();
        step('source normalizes and starts its first eligible delivery', [call('handlerReturn', outcome), call('settle'), ...(outcome === 'ok' ? [call('deliver')] : [])]);
        if (outcome !== 'ok') {
          for (let i = 0; i < spec.late; i++) {await emit(); step('late callback is suppressed', call('lateEmit'));}
        } else {
          if (scenario !== 'late-after-drain') {
            for (let i = 0; i < spec.late; i++) {emitWithoutWaiting(); step('late callback queues behind current drain', call('lateEmit'));}
          }
          for (let i = 0; i < spec.inHandler; i++) {
            await finishTransport(scenario === 'transport-rejection' && i === 0);
            const end = i + 1 === spec.inHandler;
            const hasNext = !end || scenario !== 'late-after-drain';
            step('actual transport settles', [call('transportSettle'), ...(hasNext ? [call('deliver')] : []), ...(end ? [call('drained')] : [])]);
          }
          if (scenario === 'late-after-drain') {
            for (let i = 0; i < spec.late; i++) {
              emitWithoutWaiting(); await tick(); step('late callback after handler promise settles', [call('lateEmit'), call('deliver')]);
              await finishTransport(); step('late transport settles', call('transportSettle'));
            }
          } else {
            for (let i = 0; i < spec.late; i++) {
              await finishTransport();
              step('late transport releases the next ordered delivery', [call('transportSettle'), ...(i + 1 < spec.late ? [call('deliver')] : [])]);
            }
          }
        }
        await result;
      }
      traces.push(trace);
    }
    receipts.push(await checkTraces({model: spec.module, modelPath: 'specs/quint/legacy/CoreActionSettlement.qnt',
      id: `CoreActionSettlement-${name}-source`, sources: bundle.sources, driverHashes: bundle.driverHashes, traces,
      scope: 'bounded-component', assumptions: [
        `Actual upstream settleActionHandler at ${bundle.revision}, with real processing-policy admission and controlled handler/transport promises.`,
        'The observer exposes actual closed-over phase/buffer and enqueue/start events. The logical chain omits suppressed reply-failure transport work. Checkpoints compare seven state fields after promise microtasks settle.',
        'The schedule does not reenter from beforeCallbacks. Receipt binding, transport diagnostics, ambient stream suppression and arbitrary callback counts remain separate obligations.'] }));
  }
  return receipts;
}
if (process.argv[1] === driver) {
  const vendor = process.argv[2]?.replace(/^--vendor-dir=/, '');
  for (const receipt of await checkActionSettlementRefinement(vendor)) console.log(receipt.model, receipt.traces, receipt.checkpoints, receipt.passed);
}
