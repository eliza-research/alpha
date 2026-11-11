import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {call, checkpoint, deferred, root, tick, trace} from './support.mjs';

const driver = fileURLToPath(import.meta.url);
const implementation = 'apps/app/src/runtime/connection-ui.tsx';
const helpers = ['specs/quint/refinement/application/support.mjs', 'test/support/strip-types.mjs',
  'specs/quint/refinement/application/index.mjs', 'test/quint-application-refinement.test.mjs'];

function compile(text) {
  const section = (start, end) => {
    const from = text.indexOf(start), to = text.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, 'Exact connection source section: ' + start);
    return text.slice(from, to);
  };
  const line = start => section(start, '\n');
  const visible = line('  useEffect(()=>{const visible=()=>{if(!document.hidden)');
  return stripTypeScriptTypes([
    line('export const PLAN_RECHECK_INTERVAL_MS').replace('export ', ''),
    line('let lastPlanRecheck ='), line('let planManagementReturn ='),
    line('function planCheckScope()'), line('let networkLostUnder:'), line('let planRecheck:'),
    section('async function recheckResidentPlan()', '/** Bind or unbind'),
    section('async function work(', '/** Release only this operation'),
    'const connectionController={',
    section('  networkChanged(', '  openCloudAccount('),
    section('  recheckPlanOnReturn()', '  /** The owner asked to check Cloud again'),
    '};', visible,
    'globalThis.actual={connectionController,work,inspect:()=>({lastPlanRecheck,networkLostUnder,planRecheck,scope:planCheckScope()})};',
  ].join('\n'), {mode: 'strip'});
}

function fixture(code) {
  let clock = 0, scope = 0, lastOffline = false, cleanup;
  const reads = [];
  const document = Object.assign(new EventTarget(), {hidden: false});
  const window = new EventTarget();
  const state = {inferenceOffline: false, busy: false, session: {}, cloudAccount: {credentialId: 'credential-0'}};
  const box = vm.createContext({
    AbortController, DOMException, document, window, state, isAndroid: false,
    Date: class extends Date {static now() {return clock * 60_000;}},
    active: {kind: 'resident'}, service: null, residentBinding: 'unbound', entitlementRefresher: null,
    operation: null, sending: null, ownCloudServiceRestore: null, signInReadinessOwner: null,
    residentStartInBackground: false,
    ownProviderSelected: () => false, residentEnvironment: () => 'production', residentCloudFlow: () => true,
    residentBindable: () => false, update: patch => Object.assign(state, patch), retractReadiness() {},
    runQueuedResidentRebind() {}, runQueuedSignInReturn() {}, scheduleResidentAutoRetry() {},
    queueResidentRebind() {assert.fail('The live resident must not need a startup admission');},
    residentRebinds() {assert.fail('Synthetic admission keeps the current inference binding');},
    refreshMembershipBalance() {assert.fail('No optional Cloud service is installed in this fixture');},
    useEffect(install) {cleanup = install();},
    admitCloudResident(signal) {
      const task = {...deferred(), signal, offline: !!state.inferenceOffline};
      reads.push(task);lastOffline = task.offline;
      signal.addEventListener('abort', () => task.reject(signal.reason), {once: true});
      return task.promise;
    },
  });
  vm.runInContext(code, box);
  const actual = box.actual;
  return {
    observe() {
      const current = actual.inspect();
      return {'s.online': !state.inferenceOffline, 's.visible': !document.hidden, 's.scope': scope,
        // The model records a usable same-scope permit. A retained foreign string
        // is already unusable and is cleared by the actual next return callback.
        's.lost': current.networkLostUnder === current.scope ? scope : -1,
        's.clock': clock, 's.last': Number.isFinite(current.lastPlanRecheck) ? current.lastPlanRecheck / 60_000 : -1,
        's.reading': current.planRecheck !== null, 's.startedOffline': lastOffline, 's.reads': reads.length};
    },
    network(online) {actual.connectionController.networkChanged(online);},
    visibility(visible) {document.hidden = !visible;},
    request() {window.dispatchEvent(new Event('pageshow'));},
    async settle(outcome = 'refused') {
      const task = reads.at(-1);
      assert.ok(task && actual.inspect().planRecheck, 'An actual admission read is pending');
      if (outcome === 'accepted') task.resolve({binding: 'unbound'});
      else task.reject(Error('Synthetic Cloud server is unavailable'));
      await tick();
    },
    minute() {clock++;},
    replaceScope() {
      assert.equal(actual.inspect().planRecheck, null, 'This scope replacement occurs between reads');
      scope = 1;state.cloudAccount = {credentialId: 'credential-1'};
    },
    async cancelForOwnerAction() {await actual.work('Synthetic explicit owner action', async () => {});await tick();},
    close() {cleanup?.();},
  };
}

const cases = [
  ['server failure keeps the minute limit and success does not reset it', [
    ['request'], ['settle'], ['request'], ['minute'], ['request'], ['settle', 'accepted'], ['request'],
  ]],
  ['one actual offline to online edge permits exactly one immediate read', [
    ['request'], ['settle'], ['network', false], ['network', true], ['request'], ['settle'], ['request'],
  ]],
  ['a hidden document preserves the network permit until the visible return', [
    ['request'], ['settle'], ['visibility', false], ['network', false], ['network', true], ['request'],
    ['visibility', true], ['request'], ['settle'], ['request'],
  ]],
  ['a different credential cannot spend the prior credential network return', [
    ['request'], ['settle'], ['network', false], ['network', true], ['replaceScope'], ['request'],
    ['minute'], ['request'], ['settle', 'accepted'],
  ]],
  ['a read begun offline retains one permit for the later network return', [
    ['network', false], ['request'], ['settle'], ['request'], ['network', true], ['request'], ['settle'], ['request'],
  ]],
  ['an explicit owner operation aborts the read and releases its retry clock', [
    ['request'], ['cancelForOwnerAction'], ['request'], ['settle'], ['request'],
  ]],
  ['duplicate network and foreground events do not manufacture a permit', [
    ['request'], ['request'], ['settle'], ['network', true], ['request'], ['visibility', false], ['request'],
    ['visibility', true], ['request'], ['minute'], ['request'], ['settle'],
  ]],
];

export async function checkCloudPlanRecheck(extraSources = []) {
  const sources = [driver, implementation, ...helpers, ...extraSources];
  const driverHashes = captureInputs(sources);
  const generated = mkdtempSync(join(tmpdir(), 'alpha-plan-recheck-source-'));
  const input = join(generated, 'connection-return.js');
  try {
    writeFileSync(input, compile(readFileSync(join(root, implementation), 'utf8')));
    Object.assign(driverHashes, captureInputs([input]));sources.push(input);
    const code = readFileSync(input, 'utf8'), traces = [];
    for (const [name, steps] of cases) {
      const f = fixture(code), t = trace(name, f.observe());
      try {
        for (const [method, ...args] of steps) {
          await f[method](...args);
          // Both provider success and server failure use the model's settle action.
          checkpoint(t, [method, ...args].join(' '), call(method, ...(method === 'settle' ? [] : args)), f.observe());
        }
        traces.push(t);
      } finally {f.close();}
    }
    return await checkTraces({model: 'CloudPlanRecheck', sources, driverHashes, generatedSources: [input], traces,
      scope: 'bounded-orchestration', assumptions: [
        'Exact Alpha return/network guards, recheck coordinator, owner-work cancellation and installed visibility/pageshow callback execute. Synthetic admission promises observe actual read starts, aborts and settlement.',
        'Two credential scopes, three minute values, at most four reads and a Cloud-only resident without an entitlement refresher. Admission outcome, billing, provider authentication and resident rebind semantics are controlled ports, not proved here.',
        'The lost-scope projection denotes a usable current-scope permit. The modeled scenarios cover settled returns, offline-start settlement, background return and owner cancellation. A return during a read may consume an already answered network permit; that interleaving is outside these traces.',
        'No real Cloud requests, credentials, browser navigation or Android lifecycle callbacks run. React mounting and entitlement-refresher scheduling retain separate tests.',
      ]});
  } finally {rmSync(generated, {recursive: true, force: true});}
}
