// SmsSend traces replayed against the Messages adapter. The telephony client is a held port with a
// send journal that follows the shared send contract: a repeated operation ID is answered from its
// record, a new one is refused without send access, declined, or dispatched once. Each native send
// stays in flight until the trace delivers or rejects it. No SIM, radio or Android is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {modelTraces, replayTraces, repositoryRoot, settle, sourceModule} from '../specs/quint/refinement/services/identity-comms-traces.mjs';

const MODEL = {path: 'specs/quint/services/SmsSend.qnt', module: 'SmsSend'};
const SCENARIOS = ['retryAfterCancelledAndDeniedTest', 'repeatedIdNeverDispatchesTwiceTest', 'staleAnswerDroppedTest', 'editResetsOperationTest',
  'deliveryEvidenceTest', 'readBackKeepsIdUntilSendAnswersTest', 'refusedBeforeJournalTest'];
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
const adapter = await sourceModule(['apps/app/src/prototype/sms-adapter.ts', 'apps/app/src/runtime/image-sms.ts'], STUBS);
const BUSY = 'Another text is being reviewed.', UNKNOWN = 'This text may have sent. Check your messaging app before sending again.';
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
      // A new visit starts with an empty draft; the owner writes one before any Send.
      type('nativeOnRecipients', '+1 555 555 0100'); type('nativeOnBody', 'hello');
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
      // The ID the draft holds is the one a read-back asks native about; the probe answers "no record".
      probing = [];
      page().nativeRefresh(); await settle();
      const asked = probing; probing = null;
      assert.ok(asked.length <= 1);
      const model = page();
      const byId = (map, missing) => Object.fromEntries(IDS.map((key, index) => [key, map.get(ids[index]) ?? missing]));
      return {busy: model.nativeBusy, operationId: asked.length ? ordinal(asked[0]) : 0, minted: ids.length,
        call: call ? ordinal(call.operationId) : 0, reply: call ? call.reply : 'none',
        journal: byId(journal, 'none'), dispatches: byId(dispatches, 0), shown: shownOf(model.nativeNotice)};
    },
    close() { shell.componentWillUnmount(); delete globalThis.document; delete globalThis.__smsClient; },
  };
}

test('the Messages adapter follows SmsSend scenarios, witnesses and random walks', {timeout: 240000}, async () => {
  const traces = modelTraces({...MODEL, scenarios: SCENARIOS, witnesses: WITNESSES, random: 80, steps: 30});
  const receipt = await replayTraces(traces, create, {project});
  assert.equal(receipt.traces, SCENARIOS.length + WITNESSES.length + 80);
  // The comparison is live: a model that kept the operation ID after a cancelled review is refused.
  const kept = state => ({...project(state), operationId: state.operationId || (state.shown === 'cancelled' ? 1 : 0)});
  await assert.rejects(replayTraces(traces.filter(trace => trace.name === 'retryAfterCancelledAndDeniedTest'), create, {project: kept}), /retryAfterCancelledAndDeniedTest step/);
  for (const action of ['open', 'leave', 'edit', 'accessChanged', 'send', 'nativeDecide', 'deliver', 'callRejected', 'journalAdvance', 'reconcile']) assert.ok(receipt.actions[action] > 0, action);
});
