import assert from 'node:assert/strict';
import {createInboxFixture} from '../services/inbox-coordinator-ports.mjs';
import {call, checkpoint, deferred, trace} from './support.mjs';

const grant = 'grant-1', query = 'in:inbox';
const account = {connectionId: grant, label: 'Synthetic account', connected: true,
  grantedCapabilities: ['google.gmail.triage']};
const message = {id: 'saved-message', threadId: 'saved-thread', from: 'Synthetic sender',
  fromEmail: 'sender@example.invalid', to: [], subject: 'Saved subject', snippet: 'Saved preview',
  receivedAt: null, unread: false};
const savedText = 'Synthetic saved body';

async function fixture(withBody) {
  const source = await createInboxFixture();
  const {controller, client, modules} = source;
  source.sandbox.document.querySelector = () => null;
  const binding = controller.getCloudClient(), cloud = controller.getSnapshot().cloudAccount;
  const owner = {environment: cloud.environment, userId: cloud.userId,
    organizationId: cloud.organizationId, credentialId: binding.credentialId};
  const disk = await modules.serviceReadCache(owner, 'gmail');
  const at = Date.now();
  const body = {message, bodyText: savedText, historyId: 'saved-history'};
  const list = {key: JSON.stringify([binding.sessionId, binding.credentialId, grant, query]),
    at, firstPageRevision: null, messages: [message], query, cursor: null, revision: 'saved-list',
    cursors: [], newerMail: false, status: '1 message'};
  await disk.put('gmail:mailbox', {accounts: [account], selected: grant, spamTrashSearch: false,
    lists: [list], bodies: withBody ? [{at, body}] : []});
  assert.ok(await disk.get('gmail:mailbox'), 'Actual cache admits the synthetic saved mailbox');

  const checks = [];
  client.gmailAccounts = signal => {
    const request = {signal, ...deferred()};
    checks.push(request);
    return request.promise;
  };
  let bodyReads = 0;
  client.gmailRead = async () => {bodyReads++; return body;};
  // An ordinary Inbox render may be the first read for this Cloud binding.
  // Do not pre-seed a concurrent Home warm read during the synthetic mount.
  const cloudClient = controller.getCloudClient;
  controller.getCloudClient = () => null;
  const mounted = source.mount();
  const {api, shell, views, render} = mounted;
  const inbox = views.inbox;
  let active = true;
  api.isActive = () => active;
  const settle = () => source.settle();
  function observe() {
    const value = render(), notice = value.cachedListNotice || '';
    if (value.rows.length) assert.deepEqual(Array.from(value.rows, row => row.subj), [message.subject]);
    if (value.d) assert.equal(value.d.body, withBody ? savedText : 'Message not saved on this device.');
    if (notice) {
      assert.equal(shell.st.nativeMailSelection ?? null, null, 'Saved detail has no live selection');
      assert.equal(bodyReads, 0, 'Saved mail cannot trigger a body read');
      assert.ok(!source.events.some(([operation]) => operation === 'search' || operation === 'capabilities'),
        'Saved mail cannot trigger a provider page or capability read');
    }
    assert.equal(source.state.prepares, 0, 'The source schedule prepares no provider effect');
    assert.equal(source.state.dispatches, 0, 'The source schedule dispatches no provider effect');
    return {'s.shown': value.rows.length ? notice ? 'saved' : 'fresh' : 'none',
      's.reading': value.refreshDisabled, 's.checkFailed': notice === 'Saved mail · Could not check Gmail access',
      's.detail': value.d ? withBody ? 'cached' : 'missing' : 'closed',
      canMutate: inbox.emailTarget().ready, canUseDetail: value.d?.actionsAvailable === true};
  }
  const pending = () => {
    assert.ok(checks.at(-1)?.signal && !checks.at(-1).signal.aborted, 'One current account check');
    return checks.at(-1);
  };
  return {observe,
    async start() {
      controller.getCloudClient = cloudClient;active = true;
      const count = checks.length;
      render();await settle();pending();
      assert.equal(checks.length, count + 1, 'The Inbox renderer issues one current grant check');
    },
    async open() {
      const request = pending(), reads = bodyReads;
      render().rows[0].open();await settle();
      assert.equal(pending(), request, 'Opening saved mail preserves the pending grant check');
      assert.equal(bodyReads, reads, 'Opening saved mail does not fetch provider content');
    },
    async back() {
      const request = pending();
      assert.equal(inbox.back(shell.st, api), true);
      await settle();
      assert.equal(pending(), request, 'Back preserves the pending grant check');
    },
    async failed() {
      pending().reject(new TypeError('Failed to fetch'));await settle();
    },
    async recheck() {
      const count = checks.length;
      render().refresh();await settle();pending();
      assert.equal(checks.length, count + 1, 'Refresh checks the grant before other provider work');
    },
    async accept() {
      pending().resolve([account]);await settle();
      assert.equal((await disk.get('gmail:mailbox')).value.lists[0].at, at,
        'Grant acceptance alone does not advance the cached page read time');
      if (!withBody && render().d) {
        assert.equal(render().d.failed, true, 'A live retry is available for the missing saved body');
        assert.equal(bodyReads, 0, 'The placeholder waits for that explicit retry');
      }
    },
    async refuse() {
      // Keep the exact rejected bytes readable from the fake native store to
      // exercise the adapter's revocation fence independently of deletion.
      source.state.failStore = true;
      pending().resolve([]);await settle();
      assert.ok(await disk.get('gmail:mailbox'), 'Failed eviction leaves old bytes on disk');
    },
    async leave() {active = false;inbox.onLeave();await settle();},
    async close() {
      active = false;mounted.dispose();
      for (const request of checks) request.resolve([]);
      await settle();
    },
  };
}

export async function savedInboxTraces() {
  const cases = [
    ['Inbox keeps cached detail through a failed check and explicit retry', true, [
      ['start', [call('start'), call('restore')]], ['open', call('openSavedDetail', true)],
      ['failed', call('checkFailed')], ['recheck', call('recheck')], ['accept', call('acceptGrant')],
    ]],
    ['Inbox opening and Back on an unsaved body preserve the access check', false, [
      ['start', [call('start'), call('restore')]], ['open', call('openSavedDetail', false)],
      ['back', call('backFromDetail')], ['accept', call('acceptGrant')],
    ]],
    ['Inbox accepting a grant leaves a missing body awaiting live retry', false, [
      ['start', [call('start'), call('restore')]], ['open', call('openSavedDetail', false)],
      ['accept', call('acceptGrant')],
    ]],
    ['Inbox refusal closes cached detail and blocks reappearance after failed eviction', true, [
      ['start', [call('start'), call('restore')]], ['open', call('openSavedDetail', true)],
      ['refuse', call('refuse')], ['leave', call('leave')], ['start', [call('start'), call('restore')]],
    ]],
  ];
  const traces = [];
  for (const [name, withBody, steps] of cases) {
    const inbox = await fixture(withBody);
    try {
      const observed = trace(name, inbox.observe());
      for (const [operation, action] of steps) {
        await inbox[operation]();
        checkpoint(observed, operation, action, inbox.observe());
      }
      traces.push(observed);
    } finally {await inbox.close();}
  }
  return traces;
}
