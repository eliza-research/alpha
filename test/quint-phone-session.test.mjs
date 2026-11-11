// PhoneSession traces replayed against the image Phone adapter. The telephony plugin is a held
// port: every status read and dial handoff stays in flight until the trace settles it. No device,
// call log or Telecom is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {modelTraces, replayTraces, settle, sourceModule} from '../specs/quint/refinement/services/identity-comms-traces.mjs';
import {createAospTelephony} from '../apps/app/src/runtime/aosp-telephony.ts';

const MODEL = {path: 'specs/quint/services/PhoneSession.qnt', module: 'PhoneSession'};
const SCENARIOS = ['recentCallsTest', 'refreshDuringDialTest', 'leaveDuringDialTest', 'staleHandoffLeavesLaterDialTest',
  'dialRefusedWhileReadingTest', 'dialRefusedDuringHandoffTest', 'accessNeededTest', 'supersededReadTest', 'typedNumberClearsNoticeTest'];
const WITNESSES = ['ReadDuringHandoffWitness', 'AccessNeededWitness', 'DialNoticeWitness', 'RowsKeptWhileReadingWitness', 'StaleHandoffBesideLaterDialWitness'];
const OPENED = 'Your phone app is open with the number.';
const NOTICES = {'': 'none', 'Invalid number': 'invalid', [OPENED]: 'handed-off', 'Couldn’t open': 'failed'};
const status = callLog => ({version: 2, voiceCapable: true, smsCapable: true,
  permissions: {contacts: 'granted', phoneState: 'denied', sms: 'denied', sendSms: 'denied', ...(callLog ? {callLog} : {})},
  sendMode: 'handoff', roles: {dialer: {available: true, held: false, eligible: true}, sms: {available: true, held: false, eligible: true}},
  defaultDialer: 'com.android.dialer', defaultSms: null, subscriptions: null, defaultSmsSubscriptionId: null});
const call = {id: '4', number: '+15555550100', cachedName: 'Ada', date: 1700000000000, durationSeconds: 75, type: 'missed', isNew: true};

const {installPhoneAdapter} = await sourceModule('apps/app/src/prototype/phone-adapter.ts', {
  'runtime/aosp-image$': 'export const aospImage=false;',
  'native-adapter$': 'export function watchReturnToApp(){return ()=>{};}',
  'mvp-features$': 'export function isMvpView(){return false;}',
  'platform-plugins$': 'export function registerPlugin(){return {};}',
});

/** The model state as far as the adapter shows it: the busy flag is the disjunction of both latches. */
const project = s => ({busy: s.reading || s.dialing, calls: s.calls, needsAccess: s.needsAccess, notice: s.notice,
  reads: s.reads.length, dials: s.dials.length, handoffs: s.handoffs});

function create() {
  const reads = [], dials = [];
  let handoffs = 0;
  const hold = list => () => new Promise((resolve, reject) => list.push({resolve, reject}));
  const plugin = {status: hold(reads), listRecentCalls: async () => ({calls: [call]}),
    // PhoneSession is the legacy dialer-handoff branch. Direct Telecom and uncertain replies
    // are covered by PhoneCalls; role refusal here reaches the adapter's actual fallback.
    placeCall: async () => {throw Object.assign(Error('This host does not hold the dialer role'), {code: 'role-required'});},
    dial: options => { handoffs++; assert.match(options.number, /^\+\d+$/); return hold(dials)(); }};
  const views = {phone: {render: () => ({nativePrototype: true})}};
  class Shell { view = 'home'; S() { return {view: this.view}; } setState() {} }
  installPhoneAdapter(Shell, views, createAospTelephony(plugin, true));
  globalThis.document = {hidden: false, addEventListener() {}, removeEventListener() {}};
  const shell = new Shell();
  shell.componentDidMount();
  const page = () => views.phone.render({}, {});
  const visibility = async hidden => { globalThis.document.hidden = hidden; shell.phoneHide(); await settle(); };
  const view = async name => { shell.view = name; shell.componentDidUpdate(); await settle(); };
  return {
    openView: () => view('phone'), closeView: () => view('home'), hide: () => visibility(true), show: () => visibility(false),
    async refresh() { page().nativeRefresh(); await settle(); },
    async readCompletes(token, outcome, {before}) {
      const [read] = reads.splice(before.reads.indexOf(token), 1);
      if (outcome === 'error') read.reject(Error('locked'));
      else read.resolve(status(outcome === 'unsupported' ? undefined : outcome === 'rows' ? 'granted' : 'prompt'));
      await settle();
    },
    async dial(fromRow) {
      if (fromRow) page().nativeRows[0]?.dial();
      else { page().nativeOnNumber({target: {value: '+15555550123'}}); page().nativeDial(); }
      await settle();
    },
    async invalidNumber() { page().nativeOnNumber({target: {value: '*#06#'}}); page().nativeDial(); await settle(); },
    async dialCompletes(token, opened, {before}) {
      const [handoff] = dials.splice(before.dials.indexOf(token), 1);
      if (opened) handoff.resolve({status: 'handed-off', target: 'dialer', handler: null, message: OPENED}); else handoff.reject(Error('no activity'));
      await settle();
    },
    observe() {
      const model = page();
      assert.ok(model.nativeNotice in NOTICES, model.nativeNotice);
      return {busy: model.nativeBusy, calls: model.nativeRows.length > 0, needsAccess: model.nativeAccess, notice: NOTICES[model.nativeNotice],
        reads: reads.length, dials: dials.length, handoffs};
    },
    close() { shell.componentWillUnmount(); delete globalThis.document; },
  };
}

test('the Phone adapter follows PhoneSession scenarios, witnesses and random walks', {timeout: 240000}, async () => {
  const traces = modelTraces({...MODEL, scenarios: SCENARIOS, witnesses: WITNESSES, random: 60, steps: 25});
  const receipt = await replayTraces(traces, create, {project});
  assert.equal(receipt.traces, SCENARIOS.length + WITNESSES.length + 60);
  assert.equal(receipt.rejected, 2);
  // The comparison is live: a model that released the dial latch on a settled read is refused.
  const merged = state => ({...project(state), busy: state.reading});
  await assert.rejects(replayTraces(traces.filter(trace => trace.name === 'refreshDuringDialTest'), create, {project: merged}), /refreshDuringDialTest step/);
  for (const action of ['openView', 'closeView', 'hide', 'show', 'refresh', 'readCompletes', 'dial', 'invalidNumber', 'dialCompletes']) assert.ok(receipt.actions[action] > 0, action);
});
