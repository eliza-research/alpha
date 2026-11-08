import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {checkTraces as check} from '../check-traces.mjs';
import {root, bundledSource, sourceContext, deferred, tick, trace, checkpoint, call, captureSources, boundInputs} from './support.mjs';
captureSources(['specs/quint/refinement/application/boundaries.mjs']);
const checkTraces = options => check(boundInputs({...options, sources: [...options.sources,
  'specs/quint/refinement/application/boundaries.mjs', 'specs/quint/refinement/application/support.mjs']}));

export async function filesAndSharing() {
  const source = 'apps/app/src/prototype/file-email-review.ts';
  const attachment = await bundledSource('apps/app/src/runtime/inbox-attachment.ts');
  const modal = await bundledSource('apps/app/src/runtime/modal-inert.ts');
  const traces = [];
  for (const changed of [false, true]) {
    const page = new JSDOM('<div class="os"></div>', {pretendToBeVisual: true});
    page.window.HTMLDialogElement.prototype.showModal = function () {this.open = true;};
    let inserted = null, readCount = 0, lastReview = Promise.resolve();
    const document = page.window.document;
    const file = {name: 'Owned.txt', mimeType: 'text/plain', dataBase64: Buffer.from('first').toString('base64')};
    const reviewed = await attachment.exports.reviewMailAttachment(file);
    const second = {name: 'Owned.txt', mimeType: 'text/plain', dataBase64: Buffer.from('changed').toString('base64')};
    const changedReview = await attachment.exports.reviewMailAttachment(second);
    const module = sourceContext([source], ['reviewFileEmail'], {window: page.window, document,
      getComputedStyle: page.window.getComputedStyle.bind(page.window),
      reviewMailAttachment: value => (lastReview = attachment.exports.reviewMailAttachment(value)), holdPhoneInert: modal.exports.holdPhoneInert,
      describeEmailTarget: () => ({account: 'Owner', destination: 'Draft'})});
    const t = trace(`attachment-${changed ? 'changed' : 'exact'}`, {'s.inserted': !!inserted});
    const close = module.reviewFileEmail({read: async () => {
      readCount++;
      return readCount > 1 && changed ? {...second, ...changedReview} : {...file, ...reviewed};
    }, current: () => true, target: () => ({ready: true, token: 'draft-one'}),
    insert(value, token) {assert.equal(token, 'draft-one'); inserted = value; return true;}, inserted() {}});
    await tick(); await lastReview; await tick();
    const input = document.querySelector('input'); assert.equal(input.disabled, false);
    checkpoint(t, 'source performs initial attachment validation', call('read'), {'s.inserted': !!inserted, 's.checked': input.checked});
    input.checked = true; input.dispatchEvent(new page.window.Event('change'));
    checkpoint(t, 'explicit checkbox', call('check'), {'s.checked': input.checked});
    if (changed) checkpoint(t, 'source bytes changed before second read', call('changeSource'), {'s.inserted': !!inserted});
    [...document.querySelectorAll('button')].find(button => button.textContent === 'Insert attachment into draft').click();
    await tick(); await lastReview; await tick();
    checkpoint(t, 'source rereads bytes before insertion', changed ? {...call('insert'), reject: true} : call('insert'), {'s.inserted': !!inserted});
    close(); page.window.close(); traces.push(t);
  }
  return checkTraces({model: 'FilesAndSharing', sources: [source, ...attachment.sources, ...modal.sources], traces, scope: 'bounded-component', assumptions: [
    'Real review dialog and upstream byte validation execute for exact and changed-byte copies. Destination description is a text-only stub.',
    'Owner/draft token changes, focus/page retirement, revoked native grants and restart need further schedules.']});
}

export async function notificationCollection() {
  const source = 'apps/app/src/browser/notifications.ts', traces = [];
  for (const preview of [false, true]) for (const secret of [false, true]) {
    const page = new JSDOM('<div></div>', {pretendToBeVisual: true});
    let revision = 0;
    const state = {revision: 'r0', epoch: 'e0', enabled: false, paused: false, history: false, accessGranted: true,
      apps: [], events: [], dismissed: [], appEnabled: true, channels: {}, deviceEvents: []};
    const module = sourceContext([source], ['BrowserNotifications'], {
      window: page.window, document: page.window.document, crypto: webcrypto,
      Event: page.window.Event, CustomEvent: page.window.CustomEvent,
      WebPlugin: class {async notifyListeners() {}}, BrowserCalendar: class {},
      browserApps: [{packageName: 'browser.messages', label: 'Messages', view: 'messages'}],
      revision: () => `r${++revision}`, notificationState: async () => structuredClone(state),
      notificationDocument: {async edit(editor) {const next = structuredClone(state); const result = await editor(next); Object.assign(state, next); return result;}},
      readDevicePreferences: async () => ({}), browserScreenLocked: () => false, focusActive: () => false,
      focusHoldsNotice: () => false, focusAllowedNotices: () => [], listWorkflowNotices: async () => [],
      browserHostedResults: {list: async () => []}, NotificationPolicyChanged: class extends Error {},
    });
    const notifications = new module.BrowserNotifications({listReminders: async () => ({reminders: []})});
    const t = trace(`notice-preview-${preview}-secret-${secret}`, {'s.enabled': (await notifications.crossAppStatus()).enabled}, call('initFor', false));
    checkpoint(t, 'browser permission readback', call('grantAccess'), {'s.access': (await notifications.crossAppStatus()).accessGranted});
    await notifications.setNotificationPolicy({expectedRevision: state.revision, enabled: true, history: false, apps: [{packageName: 'browser.messages', preview}]});
    checkpoint(t, 'real policy mutation', [call('reviewPolicy', true, true, preview, false), call('commitPolicy', true)], {'s.enabled': state.enabled, 's.preview': state.apps[0].preview});
    await notifications.inject({packageName: 'browser.messages', title: 'Private title', text: 'Private text', secret});
    checkpoint(t, 'real source event arrives', call('post', secret), {'s.eventPresent': state.deviceEvents.length > 0});
    let rows = (await notifications.list()).items;
    checkpoint(t, 'actual list and redaction', [call('beginRead'), call('readComplete')], {'s.rowPresent': rows.length > 0, 's.rowText': rows.some(row => !!row.text)});
    Object.defineProperty(page.window.document, 'hidden', {value: true, configurable: true});
    rows = (await notifications.list()).items;
    checkpoint(t, 'lock while source event persists', [call('lock'), call('beginRead'), call('readComplete')],
      {'s.rowPresent': rows.length > 0, 's.rowText': rows.some(row => !!row.text)});
    assert.equal(rows.every(row => !row.canOpen), true);
    page.window.close(); traces.push(t);
  }
  return checkTraces({model: 'NotificationCollection', sources: [source], traces, scope: 'bounded-component', assumptions: [
    'Actual browser policy, event injection, listing and redaction bodies execute for four preview/secret combinations.',
    'Document and non-notification service dependencies are controlled ports. Native signature/user identity, history failures, action races and cross-tab CAS remain additional obligations.']});
}

export async function developmentHost() {
  const source = 'scripts/cloud-resident-host.mjs';
  captureSources([source, 'scripts/local-agent-source.mjs', 'scripts/native-view-policy.mjs',
    'scripts/cloud-sdk-authority.mjs', 'vendor/eliza/packages/agent/native-host/private-runtime-launch.mjs',
    'test/fixtures/product-character-host.mjs', 'scripts/native-google-host-artifact.mjs', 'scripts/workflow-worker-artifact.mjs']);
  const {createCloudResidentHost} = await import(new URL('../../../../test/fixtures/product-character-host.mjs', import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), 'alpha-refinement-host-'));
  const launches = [];
  const host = await createCloudResidentHost({profile: directory, port: 48768,
    launch: async options => {const completion = deferred(); const child = {options, completion: completion.promise, async stop() {completion.resolve({code: 0});}}; launches.push(child); return child;},
    inherited: {PATH: process.env.PATH}});
  try {
    const observe = () => ({'s.bound': host.status('one').attachable ? 1 : 0});
    const t = trace('real-host-binding-retirement', observe());
    await host.bind({token: 'synthetic-credential', credentialId: 'one', reference: 'reference-one'});
    checkpoint(t, 'source host accepts verified binding and launches owned process', [call('beginLogin'), call('receiveClaim'), call('commitCredential'), call('bind'), call('ready')], observe());
    await host.bind({token: 'synthetic-credential', credentialId: 'one', reference: 'reference-one'});
    assert.equal(launches.length, 1); checkpoint(t, 'same binding reuses source process', null, observe());
    await host.clear(); checkpoint(t, 'real host retires binding', [call('retireResident'), call('stopped'), call('signOut')], observe());
    assert.equal(launches.at(-1).options.env.ELIZAOS_CLOUD_API_KEY, undefined);
    await host.close(); checkpoint(t, 'close source host', call('close'), observe());
    return checkTraces({model: 'DevelopmentHost', sources: [source, 'scripts/local-agent-source.mjs', 'scripts/native-view-policy.mjs',
      'scripts/cloud-sdk-authority.mjs', 'vendor/eliza/packages/agent/native-host/private-runtime-launch.mjs'], traces: [t], scope: 'bounded-component', assumptions: [
      'Actual private-profile and resident-host logic execute through the existing product-character fixture with a relocated synthetic SDK/worker root and a process-launch port. All source and worker admission checks run; no network or real child starts.',
      'Binding observation covers attachability, retirement and same-binding reuse. Browser credential claims, requests, failed stop and launcher shutdown schedules remain untested.']});
  } finally {await host.close(); await rm(directory, {recursive: true, force: true});}
}
