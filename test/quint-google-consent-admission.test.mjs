import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {mountGoogleAccountPanel} from './fixtures/google-account-panel.mjs';
import {checkTraces, qmap, qset} from '../specs/quint/refinement/check-traces.mjs';
import {boundInputs, bundledSource, call, captureSources, checkpoint, deferred, trace} from '../specs/quint/refinement/application/support.mjs';

const driver = fileURLToPath(import.meta.url);
const panelSource = 'apps/app/src/runtime/google-connection-ui.tsx';
const fixtureSource = 'test/fixtures/google-account-panel.mjs';
const readIds = [1, 2, 3, 4, 5, 6];
const address = 'owner@example.invalid', connectionId = '11111111-1111-4111-8111-111111111111';
const tierNames = ['none', 'read', 'send', 'modify'];
const ownerId = binding => {
  assert.ok(['cloud-credential', 'other-credential'].includes(binding.credentialId));
  return binding.credentialId === 'cloud-credential' ? 1 : 2;
};
const calendar = {current: () => true, canChange: () => true};
const noPermission = {owner: 0, read: 0, panel: 0};

async function compile(extraSources) {
  const modules = {
    cloudProtocol: 'cloud-protocol',
    connectionReturn: 'google-connection-return',
    workspaceReturn: 'google-workspace-return',
    gmailGrants: 'gmail-grants',
    calendarLink: 'google-accounts',
  };
  const sources = [panelSource, fixtureSource, driver, ...extraSources];
  captureSources(sources);
  const dependencies = {};
  for (const [name, module] of Object.entries(modules)) {
    const loaded = await bundledSource(`apps/app/src/runtime/${module}.ts`, {'import.meta.env': '{}'});
    sources.push(...loaded.sources);
    dependencies[name] = loaded.exports;
  }
  return {sources, dependencies: {...dependencies, cloudServiceName: dependencies.cloudProtocol.cloudServiceName}};
}

async function fixture(compiled, savedOn) {
  const p = await mountGoogleAccountPanel([], {calendarEdits: savedOn, observeAdmission: true}, compiled.dependencies);
  const requests = [], rowOwners = new WeakMap(), dispatches = [];
  let panel = 0, permission, holdCapture = false;
  const open = () => p.controller.getSnapshot();
  const owner = () => ownerId(p.currentBinding());
  const inspect = () => p.inspectAdmission();
  const mode = () => !open() ? 'closed' : inspect().calendar ? 'calendar' : 'settings';
  const verified = () => {
    const read = inspect().read;
    if (!read) return undefined;
    const request = rowOwners.get(read.rows);
    assert.ok(request, 'Verified account rows came from a real list or revoke reply');
    assert.equal(ownerId(read.binding), request.owner);
    return request;
  };
  const enqueue = (kind, binding) => {
    const task = deferred(), id = requests.length + 1;
    assert.ok(readIds.includes(id));
    requests.push({id, task, kind, owner: ownerId(binding), settled: false});
    return task.promise;
  };
  p.onList = binding => enqueue('load', binding);
  p.onRevoke = binding => enqueue('revoke', binding);
  p.onCapture = () => {
    if (!holdCapture) return;
    holdCapture = false;
    assert.equal(permission, undefined);
    const request = verified();
    assert.ok(request);
    permission = {task: deferred(), record: {owner: owner(), read: request.id, panel}};
    return permission.task.promise;
  };
  p.onConsent = (binding, calendarPermission, gmailPermission) => {
    const request = verified(), tier = tierNames.indexOf(gmailPermission);
    assert.ok(request, 'Consent dispatch always has a current verified account read');
    assert.ok(tier > 0);
    assert.equal(calendarPermission, 'write');
    dispatches.push({owner: ownerId(binding), read: request.id, held: request.tier,
      floor: mode() === 'calendar' ? 1 : 2, tier});
  };
  const rows = tier => {
    const {GMAIL_READ_CAPABILITY, GMAIL_MODIFY_CAPABILITIES} = compiled.dependencies.gmailGrants;
    return [{configured: true, connected: true, connectionId, label: address,
      grantedCapabilities: [GMAIL_READ_CAPABILITY, ...(tier === 3 ? GMAIL_MODIFY_CAPABILITIES : tier === 2 ? ['google.gmail.send'] : [])]}];
  };
  const click = name => p.act(() => {
    const button = p.button(name);
    assert.ok(button && !button.disabled, name + ' is actionable');
    button.click();
  });
  return {
    observe() {
      const view = inspect(), read = verified();
      assert.equal(p.opens, dispatches.length, 'Each admitted synthetic consent opens exactly one URL');
      return {'s.mode': mode(), 's.panel': panel, 's.owner': owner(), 's.latest': requests.length,
        's.pending': qset(requests.filter(request => !request.settled).map(request => request.id)),
        's.reads': qmap(readIds.map(id => {
          const request = requests[id - 1];
          return [id, request ? {owner: request.owner, kind: request.kind} : {owner: 0, kind: 'none'}];
        })),
        's.verified': read?.id ?? 0, 's.tier': read?.tier ?? 0, busy: open() && view.busy,
        's.unverified': open() && view.notice === 'Couldn’t verify',
        's.savedOn': p.access.calendarEdits, 's.permission': permission?.record ?? noPermission,
        's.choice': open() && !!p.button('Allow Calendar changes'), 's.dispatches': [...dispatches],
      };
    },
    async open(mode) {
      await p.act(() => mode === 'calendar' ? p.controller.openCalendar(calendar) : p.controller.open());
      assert.equal(open(), true);
      panel++;
    },
    async close() {await p.act(() => p.controller.close()); assert.equal(open(), false);},
    reload: () => p.dispatch('alpha:test-google-accounts'),
    replaceOwner: () => p.act(p.replaceCloud),
    async beginRevoke() {
      await click('Disconnect Google account ' + address);
      await click('Confirm disconnect Google account');
    },
    async reply(id, tier) {
      const request = requests[id - 1];
      assert.ok(request && !request.settled);
      request.tier = tier;
      request.settled = true;
      const value = tier ? rows(tier) : undefined;
      if (value) rowOwners.set(value, request);
      await p.act(() => {
        if (request.kind === 'revoke') request.task.resolve(value ? {outcome: 'disconnected', accounts: value} : {outcome: 'unconfirmed'});
        else if (value) request.task.resolve(value);
        else request.task.reject(Error('Injected account list failure'));
      });
    },
    connectSettings() {return click(verified() ? 'Add account' : 'Connect Google account');},
    async connectCalendar() {
      holdCapture = true;
      try {await click('Connect Google Calendar');} finally {holdCapture = false;}
    },
    async permissionReply() {
      assert.ok(permission);
      const pending = permission;
      permission = undefined;
      await p.act(() => pending.task.resolve());
    },
    allow() {return click('Allow Calendar changes');},
    async destroy() {
      await p.act(() => {
        p.controller.close();
        permission?.task.resolve();
        for (const request of requests) if (!request.settled) request.task.reject(Error('Fixture teardown'));
      });
      await p.close();
    },
  };
}

const openSettings = ['open', 'settings'], openCalendar = ['open', 'calendar'];
const reply = (id, tier) => ['reply', id, tier];
const ask = ['connectCalendar'], permissionReply = ['permissionReply'];
const settingsConsent = ['connectSettings'];
const cases = [
  ['settings-floor-preserves-read', true, [openSettings, reply(1, 1), settingsConsent]],
  ['settings-preserves-modify', true, [openSettings, reply(1, 3), settingsConsent]],
  ['unverified-settings-requires-retry', true, [openSettings, reply(1, 0), settingsConsent, ['reload'], reply(2, 2), settingsConsent]],
  ['older-success-cannot-restore-failed-readback', true, [openSettings, ['reload'], reply(2, 0), reply(1, 3), settingsConsent]],
  ['older-failure-cannot-drop-verified-readback', true, [openSettings, ['reload'], reply(2, 3), reply(1, 0), settingsConsent]],
  ['owner-replacement-fences-prior-grant', true, [openSettings, ['replaceOwner'], reply(2, 1), reply(1, 3), settingsConsent]],
  ['closed-then-reopened-panel-owns-new-readback', true, [openSettings, ['close'], openCalendar, reply(2, 2), reply(1, 3), ask, permissionReply]],
  ['unconfirmed-revoke-clears-grant', true, [openSettings, reply(1, 3), ['beginRevoke'], reply(2, 0), settingsConsent]],
  ['verified-revoke-readback-may-admit-next-consent', true, [openSettings, reply(1, 3), ['beginRevoke'], reply(2, 1), settingsConsent]],
  ['calendar-read-floor', true, [openCalendar, reply(1, 1), ask, permissionReply]],
  ['calendar-preserves-modify', true, [openCalendar, reply(1, 3), ask, permissionReply]],
  ['failed-replacement-during-held-permission', true, [openCalendar, reply(1, 2), ask, ['reload'], reply(2, 0), permissionReply]],
  ['successful-replacement-requires-fresh-intent', true, [openCalendar, reply(1, 2), ask, ['reload'], reply(2, 3), permissionReply, ask, permissionReply]],
  ['owner-replacement-while-permission-held', true, [openCalendar, reply(1, 3), ask, ['replaceOwner'], reply(2, 1), permissionReply, ask, permissionReply]],
  ['explicit-allow-after-saved-off', false, [openCalendar, reply(1, 3), ask, permissionReply, ['allow']]],
  ['close-during-held-permission', true, [openCalendar, reply(1, 3), ask, ['close'], permissionReply]],
  ['saved-off-choice-withdraws-on-new-account-read', false, [openCalendar, reply(1, 2), ask, permissionReply,
    ['reload'], reply(2, 1)]],
  ['held-saved-off-permission-cannot-show-choice-after-owner-replacement', false, [openCalendar, reply(1, 2), ask,
    ['replaceOwner'], reply(2, 1), permissionReply]],
];

async function checkGoogleConsentAdmission(extraSources = []) {
  const compiled = await compile(extraSources), traces = [];
  for (const [name, savedOn, operations] of cases) {
    const f = await fixture(compiled, savedOn);
    try {
      const t = trace(name, f.observe(), call('initWith', savedOn));
      for (const [operation, ...args] of operations) {
        await f[operation](...args);
        checkpoint(t, [operation, ...args].join(' '), call(operation, ...args), f.observe());
      }
      traces.push(t);
    } finally {await f.destroy();}
  }
  return checkTraces(boundInputs({model: 'GoogleConsentAdmission', sources: compiled.sources, traces,
    scope: 'bounded-orchestration', assumptions: [
      'Actual mounted GoogleConnectionsPanel, Google return watcher and Gmail grant policy run in React. Account list, revoke, Calendar permission and external browser calls are controlled ports.',
      'Two Cloud bindings, up to six account reads, three held grant tiers and one Calendar permission continuation. Read IDs label actual requests and returned row arrays. Checkpoints settle effects and promise microtasks.',
      'This checks consent admission before external OAuth. Calendar link writes, native callback persistence, binding expiry, multiple simultaneous permission continuations and real provider effects remain separate obligations.',
    ]}));
}

test('mounted Google consent retains only verified current readbacks and grant tiers', {timeout: scaledTimeout(120000)}, async () => {
  const receipt = await checkGoogleConsentAdmission([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 18);
  assert.equal(receipt.checkpoints, 114);
});
