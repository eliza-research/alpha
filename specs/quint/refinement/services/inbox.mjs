import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {InboxOperation} from '../../../../apps/app/src/runtime/inbox-operation.ts';
import {checkTraces, captureInputs} from '../check-traces.mjs';
import {action, casStore, deferred, until} from './support.mjs';

function fixture(resultState) {
  const disk = casStore(), prepareGate = deferred(), dispatchGate = deferred();
  let prepares = 0, dispatches = 0, active = true, receipt;
  const client = {
    async gmailPrepareOperation(_grant, requestId, proposal) {
      prepares++; await prepareGate.promise;
      const review = {...proposal, from: 'owner@example.invalid', attachments: []};
      receipt = {requestId, kind: proposal.kind, state: 'prepared', reviewDigest: createHash('sha256').update(JSON.stringify(review)).digest('hex'), providerResult: null, rejectionCode: null};
      return {receipt, review};
    },
    async gmailDispatchOperation(_grant, requestId, reviewDigest, proposal) {
      assert.equal(disk.read().phase, 'dispatching', 'actual storage commit precedes external dispatch');
      dispatches++; await dispatchGate.promise;
      receipt = {requestId, kind: proposal.kind, state: resultState, reviewDigest, providerResult: resultState === 'succeeded' ? {messageId: 'message'} : null, rejectionCode: resultState === 'rejected' ? 'policy' : null};
      return receipt;
    },
    async gmailOperation() { return receipt; },
  };
  const store = {read: async () => disk.store.read(), compareExchange: async (_key, before, next) => ({status: await disk.store.compareExchange(before, next)})};
  const make = () => new InboxOperation({owner: 'owner-A', grantId: 'grant-A', active: () => active, store, client});
  return {disk, make, prepareGate, dispatchGate, prepares: () => prepares, dispatches: () => dispatches, retire: () => { active = false; }};
}
export async function inboxRefinement() {
  const sources = ['apps/app/src/runtime/inbox-operation.ts', 'apps/app/src/runtime/inbox-attachment.ts', 'specs/quint/refinement/services/inbox.mjs', 'specs/quint/refinement/services/support.mjs'];
  const driverHashes = captureInputs(sources);
  const traces = [];
  for (const outcome of ['succeeded', 'rejected', 'outcome-unknown', 'prepared']) {
    const f = fixture(outcome), op = f.make();
    const trace = {name: `persisted Inbox dispatch outcome ${outcome}`, expect: {'s.phase': f.disk.read()?.phase ?? 'empty', 's.dispatches': f.dispatches()}, steps: []};
    const preparing = op.prepare({kind: 'archive', messageId: 'message', expectedHistoryId: 'revision'});
    await until(() => f.prepares() === 1, 'provider preparation');
    trace.steps.push({label: 'preparing intent exists before provider review', action: action('prepare'), expect: {'s.phase': f.disk.read().phase, 's.durable': f.disk.read().requestId.length > 0}});
    const competing = f.make(); await competing.load();
    await assert.rejects(competing.prepare({kind: 'archive', messageId: 'other', expectedHistoryId: 'revision'}));
    trace.steps.push({label: 'retained intent refuses a competing operation', action: {...action('prepare'), reject: true}, expect: {'s.phase': f.disk.read().phase, 's.dispatches': f.dispatches()}});
    f.prepareGate.resolve(); await preparing;
    trace.steps.push({label: 'real review validation accepts matching receipt and content', action: action('review', true), expect: {'s.phase': op.snapshot().phase, 's.exactReview': op.snapshot().review.messageId === op.snapshot().proposal.messageId}});
    const confirming = op.confirm(); await until(() => f.dispatches() === 1, 'single external dispatch');
    trace.steps.push({label: 'dispatch requires prior durable phase', action: action('confirm'), expect: {'s.phase': f.disk.read().phase, 's.dispatches': f.dispatches()}});
    await assert.rejects(op.confirm(), /pending/);
    trace.steps.push({label: 'concurrent confirmation cannot dispatch again', action: {...action('confirm'), reject: true}, expect: {'s.dispatches': f.dispatches()}});
    f.dispatchGate.resolve(); await confirming;
    const mapped = outcome === 'outcome-unknown' ? 'unknown' : outcome;
    trace.steps.push({label: 'provider response determines retained phase', action: action('providerReply', mapped), expect: {'s.phase': op.snapshot().phase, 's.outcome': outcome === 'prepared' ? 'unknown' : mapped}});
    const restarted = f.make(); await restarted.load();
    trace.steps.push({label: 'new instance restores original operation without dispatch', action: action('restart'), expect: {'s.phase': restarted.snapshot().phase, 's.dispatches': f.dispatches()}});
    await assert.rejects(restarted.confirm());
    trace.steps.push({label: 'restored dispatch cannot rearm confirmation', action: {...action('confirm'), reject: true}, expect: {'s.dispatches': f.dispatches()}});
    traces.push(trace);
  }
  {
    const f = fixture('succeeded'), op = f.make();
    const trace = {name: 'owner retirement rejects delayed review', expect: {'s.phase': 'empty', 's.dispatches': f.dispatches()}, steps: []};
    const preparing = op.prepare({kind: 'archive', messageId: 'message', expectedHistoryId: 'revision'}).then(() => null, error => error);
    await until(() => f.prepares() === 1, 'held review');
    trace.steps.push({label: 'persisted preparation begins', action: action('prepare'), expect: {'s.phase': f.disk.read().phase}});
    f.retire(); op.stop(); f.prepareGate.resolve(); assert.ok(await preparing instanceof DOMException);
    trace.steps.push({label: 'owner invalidation prevents late review commit', action: action('switchOwner'), expect: {'s.dispatches': f.dispatches(), 's.exactReview': f.disk.read().review !== null}});
    traces.push(trace);
  }
  return checkTraces({model: 'InboxDelivery', sources, driverHashes, traces, scope: 'bounded-component', assumptions: ['Real InboxOperation performs its own hashing, review validation, CAS and outcome parsing.', 'The controlled provider returns synthetic receipt data. Provider delivery and UI grant revalidation are separate obligations.', 'Persisted review left by retired ownership is hidden by UI ownership; this adapter checks rejection of late work and no dispatch.']});
}
