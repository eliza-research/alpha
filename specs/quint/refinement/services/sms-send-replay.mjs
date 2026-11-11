/** Existing source-executing MBT harness, shared by its original owning tests and the strict services receipt. */
// SmsSend traces replayed against the Messages adapter. The telephony client is a held port with a
// send journal that follows the shared send contract: a repeated operation ID is answered from its
// record, a new one is refused without send access, declined, or dispatched once. Each native send
// stays in flight until the trace delivers or rejects it. No SIM, radio or Android is involved.
import assert from 'node:assert/strict';
import {modelTraces, replayTraces, repositoryRoot, settle} from './identity-comms-traces.mjs';
import {observedSmsAdapter} from '../../../../test/fixtures/observed-sms-adapter.mjs';

const MODEL = {path: 'specs/quint/services/SmsSend.qnt', module: 'SmsSend'};
const SCENARIOS = ['retryAfterCancelledAndDeniedTest', 'repeatedIdNeverDispatchesTwiceTest', 'staleAnswerDroppedTest', 'editResetsOperationTest',
  'deliveryEvidenceTest', 'readBackKeepsIdUntilSendAnswersTest', 'refusedBeforeJournalTest',
  'acceptedDraftRetiredUntilOwnerEditsTest', 'retiredUncertainDraftResumesWithoutDispatchTest', 'retainedRefusalIsNotNewAttemptAuthorityTest'];
const WITNESSES = ['RetryAfterClosedRecordWitness', 'RepeatedIdAnsweredFromJournalWitness', 'StaleAnswerDroppedWitness', 'SentEvidenceWitness', 'RefusedBeforeJournalWitness'];
const contracts = `${repositoryRoot}.eliza/client-features/packages/contracts/src`;
const STUBS = {
  'platform-plugins$': 'export const registerPlugin=()=>({});',
  'runtime/aosp-image$': 'export const aospImage=true;',
  'native-adapter$': 'export const watchReturnToApp=()=>()=>{};',
  'runtime/aosp-telephony$': `export {reviewSms,reviewMms} from ${JSON.stringify(`${contracts}/native-telephony.ts`)};
    export {MMS_MAX_ATTACHMENTS} from ${JSON.stringify(`${contracts}/mms-send.ts`)};
    export const registerTelephonyProfile=()=>{};
    export const createAospTelephony=()=>new Proxy({},{get:(_,name)=>globalThis.__smsClient[name]});`,
};
const adapter = await observedSmsAdapter(STUBS);
const BUSY = 'Another text is being reviewed.', UNKNOWN = 'May have sent';
const shownOf = notice => {
  if (notice === '') return 'none';
  if (notice === BUSY) return 'refused';
  if (notice === UNKNOWN) return 'outcome-unknown';
  const status = ['cancelled', 'denied', 'failed', 'unknown', 'submitted', 'sent', 'delivered'].find(item => adapter.receiptLabel(item) === notice);
  assert.ok(status, `unexpected notice: ${notice}`);
  return status;
};
const IDS = ['1', '2', '3'];
const project = s => ({busy: s.busy, operationId: s.operationId, minted: s.minted, call: s.call, reply: s.reply, journal: s.journal, dispatches: s.dispatches, shown: s.shown});

function create() {
  // Operation IDs in the order native first saw them: the model's 1, 2, 3.
  const ids = [], journal = new Map(), dispatches = new Map();
  let sendAccess = true, call = null, sendUpdated = () => {}, probing = null, edits = 0;
  const ordinal = id => { if (!ids.includes(id)) ids.push(id); return ids.indexOf(id) + 1; };
  const status = {permissions: {sms: 'granted', sendSms: 'granted', phoneState: 'granted'}, subscriptions: [{id: 1, slot: 0, displayName: 'SIM', carrierName: 'Carrier'}],
    defaultSmsSubscriptionId: 1, sendMode: 'direct', mmsSend: false, roles: {sms: {available: true, held: false, eligible: true}}};
  globalThis.__smsClient = {
    status: async () => status, smsSendHistory: async () => [], threadPage: async () => ({rows: [], next: null}), messagePage: async () => ({rows: [], next: null}),
    markThreadRead: async () => {}, requestAccess: async () => status,
    observeMessages: async (_changed, onSendUpdated) => { sendUpdated = onSendUpdated; return async () => { sendUpdated = () => {}; }; },
    sendSms(review, operationId) {
      assert.equal(document.hidden, false, 'a native SMS request starts only in the foreground');
      assert.equal(globalThis.__smsDraftProbe().active, true, 'a native SMS request names a current visit');
      assert.equal(call, null, 'one native review at a time');
      assert.deepEqual(review, {recipients: ['+15555550100'], body: review.body, subscriptionId: 1});
      ordinal(operationId);
      return new Promise((resolve, reject) => { call = {operationId, reply: 'none', resolve, reject}; });
    },
    async smsSendResult(_review, operationId) {
      if (probing) { probing.push(operationId); throw Error('no record'); }
      if (!journal.has(operationId)) throw Error('no record');
      return {operationId, status: journal.get(operationId)};
    },
  };
  globalThis.document = {hidden: false, addEventListener() {}, removeEventListener() {}};
  const views = {messages: {}};
  class Shell { view = 'home'; S() { return {view: this.view}; } setState() {} }
  adapter.installSmsAdapter(Shell, views);
  const shell = new Shell();
  shell.componentDidMount();
  const page = () => views.messages.render({}, {});
  const type = (field, value) => page()[field]({target: {value}});
  return {
    async open() {
      shell.view = 'messages'; shell.componentDidUpdate(); await settle();
      // The owner writes only an empty draft; an unfinished or uncertain draft survives re-entry.
      if (!page().nativeBody) {type('nativeOnRecipients', '+1 555 555 0100'); type('nativeOnBody', 'hello');}
    },
    async leave() { shell.view = 'home'; shell.componentDidUpdate(); await settle(); },
    async edit() { type('nativeOnBody', `hello ${++edits}`); await settle(); },
    accessChanged() { sendAccess = !sendAccess; },
    async send() { page().nativeSend(); await settle(); },
    nativeDecide(confirmed) {
      const existing = journal.get(call.operationId);
      if (existing) { call.reply = existing; return; }
      call.reply = !sendAccess ? 'denied' : confirmed ? 'submitted' : 'cancelled';
      journal.set(call.operationId, call.reply);
      if (call.reply === 'submitted') dispatches.set(call.operationId, (dispatches.get(call.operationId) || 0) + 1);
    },
    async deliver() { const pending = call; call = null; pending.resolve({operationId: pending.operationId, status: pending.reply}); await settle(); },
    async callRejected(beforeJournal) {
      const pending = call; call = null;
      pending.reject(beforeJournal ? Object.assign(Error(BUSY), {code: 'busy'}) : Error('The bridge closed.'));
      await settle();
    },
    journalAdvance(id, next) { journal.set(ids[id - 1], next); },
    async reconcile(_context) { sendUpdated(ids[_context.before.operationId - 1]); await settle(); },
    async observe() {
      // A refresh can also reconcile the last sent receipt. It does not grant that receipt's ID
      // to the edited draft; read both actual closure identities and validate every native read.
      probing = [];
      page().nativeRefresh(); await settle();
      const asked = probing; probing = null;
      const held = globalThis.__smsDraftProbe(), allowed = new Set([held.operationId, held.sentId].filter(Boolean));
      assert.ok(asked.length <= allowed.size);
      for (const id of asked) assert.ok(allowed.has(id), 'native read names the held draft or last sent receipt');
      const model = page();
      const byId = (map, missing) => Object.fromEntries(IDS.map((key, index) => [key, map.get(ids[index]) ?? missing]));
      return {busy: model.nativeBusy, operationId: held.operationId ? ordinal(held.operationId) : 0, minted: ids.length,
        call: call ? ordinal(call.operationId) : 0, reply: call ? call.reply : 'none',
        journal: byId(journal, 'none'), dispatches: byId(dispatches, 0), shown: held.active ? shownOf(model.nativeNotice) : 'none'};
    },
    effects: () => ({ids: [...ids], call: call?.operationId ?? null, journal: [...journal], dispatches: [...dispatches]}),
    close() { shell.componentWillUnmount(); delete globalThis.document; delete globalThis.__smsClient; delete globalThis.__smsDraftProbe; },
  };
}


export async function runSmsSendCase1(t, {canaries=true}={}) {
  const traces = modelTraces({...MODEL, scenarios: SCENARIOS, witnesses: WITNESSES, random: 80, steps: 30});
  const receipt = await replayTraces(traces, create, {project});
  assert.equal(receipt.traces, SCENARIOS.length + WITNESSES.length + 80);
  if(canaries){
  // The comparison is live: a model that kept the operation ID after a cancelled review is refused.
  const kept = state => ({...project(state), operationId: state.operationId || (state.shown === 'cancelled' ? 1 : 0)});
  await assert.rejects(replayTraces(traces.filter(trace => trace.name === 'retryAfterCancelledAndDeniedTest'), create, {project: kept}), /retryAfterCancelledAndDeniedTest step/);
  }
  for (const action of ['open', 'leave', 'edit', 'accessChanged', 'send', 'nativeDecide', 'deliver', 'callRejected', 'journalAdvance', 'reconcile']) assert.ok(receipt.actions[action] > 0, action);
  return receipt;
}

export async function runSmsSendCase2(t, {canaries=true}={}) {
  for (const retired of [false, true]) {
    const f = create();
    try {
      await f.open();await f.send();f.nativeDecide(true);
      if (retired) {await f.callRejected(false);await f.leave();}
      else await f.deliver();
      const before = f.effects();await f.send();assert.deepEqual(f.effects(), before, 'no new native request or carrier effect');
      if (retired) {await f.open();assert.deepEqual(f.effects(), before);assert.ok(globalThis.__smsDraftProbe().operationId);}
      await f.edit();await f.send();
      assert.equal(f.effects().ids.length, 2);assert.notEqual(f.effects().ids[0], f.effects().ids[1]);
    } finally {f.close();}
  }
}

export async function runSmsSendReplay(){return runSmsSendCase1(undefined,{canaries:false});}
