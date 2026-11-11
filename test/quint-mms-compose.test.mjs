// MmsCompose traces replayed against the Messages adapter's MMS composer. The telephony client is
// a held port with a send journal that follows the shared send contract, and the system picture
// chooser is a held file input: it answers or is cancelled only when the trace says so. No SIM,
// carrier, chooser activity or Android is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {modelTraces, replayTraces, repositoryRoot, settle} from '../specs/quint/refinement/services/identity-comms-traces.mjs';
import {observedSmsAdapter} from './fixtures/observed-sms-adapter.mjs';

const MODEL = {path: 'specs/quint/services/MmsCompose.qnt', module: 'MmsCompose'};
const SCENARIOS = ['pictureChooserKeepsVisitTest', 'hideWithoutChooserEndsVisitTest', 'retryAfterCancelledAndDeniedTest', 'repeatedIdNeverDispatchesTwiceTest',
  'pickedPicturesResetIdTest', 'pageHideEndsPickTest', 'sixthPictureRefusedTest', 'carrierAnswerReadBackTest',
  'acceptedDraftRetiredUntilOwnerEditsTest', 'retiredUncertainDraftResumesWithoutDispatchTest'];
const WITNESSES = ['VisitKeptBehindChooserWitness', 'PicturesAddedWhileHiddenWitness', 'RetryAfterCancelledWitness', 'RepeatedIdAnsweredFromJournalWitness',
  'LatePicturesDroppedWitness', 'PickedPicturesResetIdWitness'];
const contracts = `${repositoryRoot}.eliza/client-features/packages/contracts/src`;
const adapter = await observedSmsAdapter({
  'platform-plugins$': 'export const registerPlugin=()=>({});',
  'runtime/aosp-image$': 'export const aospImage=true;',
  'native-adapter$': 'export const watchReturnToApp=()=>()=>{};',
  'runtime/aosp-telephony$': `export {reviewSms,reviewMms} from ${JSON.stringify(`${contracts}/native-telephony.ts`)};
    export {MMS_MAX_ATTACHMENTS} from ${JSON.stringify(`${contracts}/mms-send.ts`)};
    export const registerTelephonyProfile=()=>{};
    export const createAospTelephony=()=>new Proxy({},{get:(_,name)=>globalThis.__smsClient[name]});`,
});
const LIMIT = 'Max 5 pictures', UNREADABLE = 'Only JPEG, PNG and GIF pictures can be sent.';
const UNKNOWN = 'May have sent';
const shownOf = notice => {
  const fixed = {'': 'none', [LIMIT]: 'limit', [UNREADABLE]: 'picture-error', [UNKNOWN]: 'outcome-unknown'}[notice];
  if (fixed) return fixed;
  const status = ['cancelled', 'denied', 'failed', 'unknown', 'submitted', 'sent'].find(item => adapter.mmsReceiptLabel(item) === notice);
  assert.ok(status, `unexpected notice: ${notice}`);
  return status;
};
const IDS = ['1', '2', '3'];
const project = s => ({busy: s.busy, pictures: s.pictures, chooser: s.chooser, operationId: s.operationId, minted: s.minted, call: s.call, reply: s.reply,
  journal: s.journal, dispatches: s.dispatches, shown: s.shown});

function create() {
  const ids = [], journal = new Map(), dispatches = new Map(), pageHideListeners = new Set();
  let sendAccess = true, call = null, mmsUpdated = () => {}, probing = null, edits = 0, input = null;
  const ordinal = id => { if (!ids.includes(id)) ids.push(id); return ids.indexOf(id) + 1; };
  const status = {permissions: {sms: 'granted', sendSms: 'granted', phoneState: 'granted'}, subscriptions: [{id: 1, slot: 0, displayName: 'SIM', carrierName: 'Carrier'}],
    defaultSmsSubscriptionId: 1, sendMode: 'direct', mmsSend: true, roles: {sms: {available: true, held: true, eligible: true}}};
  globalThis.__smsClient = {
    status: async () => status, smsSendHistory: async () => [], threadPage: async () => ({rows: [], next: null}), messagePage: async () => ({rows: [], next: null}),
    markThreadRead: async () => {}, requestAccess: async () => status,
    observeMessages: async (_changed, _sms, onMmsSendUpdated) => { mmsUpdated = onMmsSendUpdated; return async () => { mmsUpdated = () => {}; }; },
    sendMms(review, operationId) {
      assert.equal(document.hidden, false, 'a native MMS request starts only in the foreground');
      assert.equal(globalThis.__smsDraftProbe().active, true, 'a native MMS request names a current visit');
      assert.equal(call, null, 'one native review at a time');
      assert.deepEqual(review.recipients, ['+15555550100']);
      ordinal(operationId);
      return new Promise((resolve, reject) => { call = {operationId, reply: 'none', resolve, reject}; });
    },
    async mmsSendResult(_review, operationId) {
      if (probing) { probing.push(operationId); throw Error('no record'); }
      if (!journal.has(operationId)) throw Error('no record');
      return {operationId, status: journal.get(operationId)};
    },
  };
  globalThis.document = {hidden: false, addEventListener() {}, removeEventListener() {},
    createElement() { assert.equal(input, null, 'one chooser at a time'); return input = {click() {}, files: [], value: ''}; }};
  globalThis.window = {addEventListener: (_type, listener) => pageHideListeners.add(listener), removeEventListener: (_type, listener) => pageHideListeners.delete(listener)};
  const views = {messages: {}};
  class Shell { view = 'home'; S() { return {view: this.view}; } setState() {} }
  adapter.installSmsAdapter(Shell, views);
  const shell = new Shell();
  shell.componentDidMount();
  const page = () => views.messages.render({}, {});
  const type = (field, value) => page()[field]({target: {value}});
  // The owner writes recipients and text whenever the draft is empty: at the start of a visit, where
  // the model holds no ID and no notice either, and after Clear.
  const settled = async () => { await settle(); if (shell.view === 'messages' && !document.hidden && page().nativeRecipients === '' && !page().nativeBusy) { type('nativeOnRecipients', '+1 555 555 0100'); type('nativeOnBody', 'hello'); } };
  const view = async name => { shell.view = name; shell.componentDidUpdate(); await settled(); };
  const visibility = async hidden => { globalThis.document.hidden = hidden; shell.smsHide(); await settled(); };
  const picture = readable => ({type: readable ? 'image/jpeg' : 'text/plain', size: 16, arrayBuffer: async () => new ArrayBuffer(16)});
  return {
    openView: () => view('messages'), closeView: () => view('home'), hide: () => visibility(true), show: () => visibility(false),
    async pageHide() { for (const listener of [...pageHideListeners]) listener({type: 'pagehide'}); await settled(); },
    async attach() { page().nativeAttach(); await settled(); },
    async attachAtLimit() { page().nativeAttach(); await settled(); },
    async chooserAnswers(count, readable) {
      const chooser = input; input = null;
      chooser.files = Array.from({length: count}, () => picture(readable));
      await chooser.onchange(); await settled();
    },
    async chooserCancelled() { const chooser = input; input = null; chooser.oncancel(); await settled(); },
    async edit(removePicture) { if (removePicture) page().nativeAttachments[0].remove(); else type('nativeOnBody', `hello ${++edits}`); await settled(); },
    async clearDraft() { page().nativeClear(); await settled(); },
    accessChanged() { sendAccess = !sendAccess; },
    async send() { page().nativeSendMms(); await settled(); },
    nativeDecide(confirmed) {
      const existing = journal.get(call.operationId);
      if (existing) { call.reply = existing; return; }
      call.reply = !sendAccess ? 'denied' : confirmed ? 'submitted' : 'cancelled';
      journal.set(call.operationId, call.reply);
      if (call.reply === 'submitted') dispatches.set(call.operationId, (dispatches.get(call.operationId) || 0) + 1);
    },
    async deliver() { const pending = call; call = null; pending.resolve({operationId: pending.operationId, status: pending.reply}); await settled(); },
    async callRejected() { const pending = call; call = null; pending.reject(Error('The bridge closed.')); await settled(); },
    journalAdvance(id, next) { journal.set(ids[id - 1], next); },
    async reconcile(context) { mmsUpdated(ids[context.before.operationId - 1]); await settled(); },
    async observe() {
      // The last sent receipt can reconcile independently of the current draft's held ID.
      probing = [];
      for (const id of ids) mmsUpdated(id);
      await settle();
      const asked = probing; probing = null;
      const held = globalThis.__smsDraftProbe(), allowed = new Set([held.mmsOperationId, held.mmsSentId].filter(Boolean));
      assert.ok(asked.length <= allowed.size);
      for (const id of asked) assert.ok(allowed.has(id), 'native MMS read names the held draft or last sent receipt');
      const model = page();
      const byId = (map, missing) => Object.fromEntries(IDS.map((key, index) => [key, map.get(ids[index]) ?? missing]));
      return {busy: model.nativeBusy, pictures: model.nativeAttachments.length, chooser: input !== null, operationId: held.mmsOperationId ? ordinal(held.mmsOperationId) : 0,
        minted: ids.length, call: call ? ordinal(call.operationId) : 0, reply: call ? call.reply : 'none',
        journal: byId(journal, 'none'), dispatches: byId(dispatches, 0), shown: held.active ? shownOf(model.nativeNotice) : 'none'};
    },
    effects: () => ({ids: [...ids], call: call?.operationId ?? null, journal: [...journal], dispatches: [...dispatches]}),
    close() { shell.componentWillUnmount(); delete globalThis.document; delete globalThis.window; delete globalThis.__smsClient; delete globalThis.__smsDraftProbe; },
  };
}

test('the MMS composer follows MmsCompose scenarios, witnesses and random walks', {timeout: 240000}, async () => {
  const traces = modelTraces({...MODEL, scenarios: SCENARIOS, witnesses: WITNESSES, random: 80, steps: 30});
  const receipt = await replayTraces(traces, create, {project});
  assert.equal(receipt.traces, SCENARIOS.length + WITNESSES.length + 80);
  // The comparison is live: a model that kept the operation ID after a declined review is refused.
  const kept = state => ({...project(state), operationId: state.operationId || (state.shown === 'cancelled' ? 1 : 0)});
  await assert.rejects(replayTraces(traces.filter(trace => trace.name === 'retryAfterCancelledAndDeniedTest'), create, {project: kept}), /retryAfterCancelledAndDeniedTest step/);
  for (const action of ['openView', 'closeView', 'hide', 'show', 'pageHide', 'attach', 'chooserAnswers', 'chooserCancelled', 'edit', 'clearDraft',
    'accessChanged', 'send', 'nativeDecide', 'deliver', 'callRejected', 'journalAdvance', 'reconcile']) assert.ok(receipt.actions[action] > 0, action);
});

test('accepted empty MMS and hidden uncertain MMS cannot dispatch; an owned edit starts a new identity', async () => {
  for (const hidden of [false, true]) {
    const f = create();
    try {
      await f.openView();await f.send();f.nativeDecide(true);
      if (hidden) {await f.callRejected();await f.hide();}
      else await f.deliver();
      const before = f.effects();await f.send();assert.deepEqual(f.effects(), before, 'no new native request or carrier effect');
      if (hidden) {await f.show();assert.deepEqual(f.effects(), before);assert.ok(globalThis.__smsDraftProbe().mmsOperationId);}
      await f.edit(false);await f.send();
      assert.equal(f.effects().ids.length, 2);assert.notEqual(f.effects().ids[0], f.effects().ids[1]);
    } finally {f.close();}
  }
});

test('a declined MMS review is reviewed again under a new operation ID without editing the draft', async () => {
  const driver = create();
  try {
    await driver.openView(); await driver.send(); driver.nativeDecide(false); await driver.deliver();
    assert.deepEqual([(await driver.observe()).shown, (await driver.observe()).operationId], ['cancelled', 0]);
    await driver.send(); driver.nativeDecide(true); await driver.deliver();
    const after = await driver.observe();
    assert.equal(after.shown, 'submitted');
    assert.deepEqual(after.dispatches, {1: 0, 2: 1, 3: 0}, 'the second review is a new operation and is dispatched once');
  } finally { driver.close(); }
});
