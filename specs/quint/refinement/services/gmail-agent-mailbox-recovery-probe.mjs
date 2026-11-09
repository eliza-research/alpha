import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createManagedGoogleClient, CloudProtocolError} from '../../../../.eliza/client-features/packages/app/src/runtime/managed-google-agent/managed-google-client.ts';
import {productionCloud} from '../../../../apps/app/src/runtime/cloud-deployment.generated.ts';
import {gmailAgentMailbox} from '../../../../.eliza/client-features/packages/app/src/runtime/managed-google-agent/gmail-agent-mailbox-host.ts';

globalThis.fetch = async () => {throw Error('Network is closed in the mailbox replay');};
const grant = '33333333-3333-4333-8333-333333333333';
const scope = 'a'.repeat(64);
const reference = 'fixture-only-reference';
const requests = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
const messages = ['mail1', 'mail2'];
const revisions = ['h1', 'h2'];
const operations = '/api/v1/eliza/google/gmail/inbox-v1/operations';
const emptyProposal = {request: 0, message: 0, history: 0, kind: 'none'};
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const account = {configured: true, connected: true, reason: 'connected', connectionId: grant,
  grantedCapabilities: ['google.gmail.triage', 'google.gmail.mailbox']};
const originalFailure = Error('Synthetic dispatch reply lost');
const action = (name, ...args) => ({name, args});
const ok = data => ({status: 200, data});
const receiptBody = receipt => ({version: 1, providerExactlyOnce: false, receipt});
const noRecord = {status: 404, data: {error: 'Operation not found'}};

function providerResult(kind, messageId, wrong = false) {
  const labels = {archive: [], trash: ['TRASH'], 'mark-read': ['INBOX'], 'mark-unread': ['INBOX', 'UNREAD']};
  const contradictory = {archive: ['INBOX'], trash: [], 'mark-read': ['INBOX', 'UNREAD'], 'mark-unread': ['INBOX']};
  return {messageId, labelIds: (wrong ? contradictory : labels)[kind],
    unread: wrong ? kind === 'mark-read' : kind === 'mark-unread'};
}

function resultOf(error) {
  if (error === originalFailure) return 'dispatch-error';
  if (error?.name === 'AbortError') return 'aborted';
  if (error instanceof CloudProtocolError) {
    if (error.code === 'invalid-response') return 'invalid-receipt';
    if (error.code === 'http' && error.status === 404) return 'lookup-error';
    if (error.code === 'http' && error.status === 409) return 'prepare-refused';
  }
  const known = [
    [/Select an exact message/, 'invalid-selection'], [/request is bound to another operation/, 'wrong-operation'],
    [/revision is unavailable/, 'history-unavailable'], [/mailbox review changed/, 'review-changed'],
    [/mailbox permission changed/, 'permission-changed'], [/Provider labels did not verify/, 'labels'],
  ];
  const found = known.find(([pattern]) => pattern.test(error.message));
  if (!found) throw error;
  return found[1];
}

function campaign(name, {seedRequest = 1, seedState = 'none', kind: seedKind = 'archive', message: seedMessage = 1} = {}) {
  const ledger = new Map(), wireErrors = [];
  if (seedState !== 'none') ledger.set(requests[seedRequest-1], {
    requestId: requests[seedRequest-1], kind: seedKind, state: seedState, reviewDigest: 'a'.repeat(64),
    providerResult: seedState === 'succeeded' ? providerResult(seedKind, messages[seedMessage-1]) : null, rejectionCode: null,
  });
  let invocation = null, invocations = 0, totalDispatches = 0;
  function observe() {
    return {
      's.durable': requests.map((id, index) => {
        const row = ledger.get(id);
        return [index+1, {state: row?.state ?? 'none', kind: row?.kind ?? 'none',
          message: messages.indexOf(row?.providerResult?.messageId)+1}];
      }),
      's.calls': [...(invocation?.calls ?? [])],
      's.proposal': invocation?.proposal ?? emptyProposal,
      's.sent': invocation?.sent ?? emptyProposal,
      's.aborted': invocation?.controller.signal.aborted ?? false,
      's.invocations': invocations, 's.totalDispatches': totalDispatches,
      's.recoveryReads': invocation?.calls.filter(name => name === 'readback').length ?? 0,
    };
  }
  const trace = {name, init: action('startState', seedRequest, seedState, seedKind, seedMessage), expect: observe(), steps: []};
  const point = (label, action, extra) => trace.steps.push({label, action, expect: {...observe(), ...extra}});

  function readReceipt(url, reply, row) {
    if (reply === 'lookup-error') return {status: 404, data: {error: 'Mailbox not found'}};
    if (!row) return noRecord;
    if (reply === 'wrong-kind') return ok(receiptBody({...row, kind: row.kind === 'archive' ? 'trash' : 'archive'}));
    if (reply === 'wrong-id') return ok(receiptBody({...row, requestId: requests.find(id => id !== row.requestId)}));
    if (reply === 'bad-labels') return ok(receiptBody({...row, providerResult: providerResult(row.kind, row.providerResult.messageId, true)}));
    assert.ok(url.pathname.endsWith('/'+row.requestId));
    return ok(receiptBody(row));
  }

  async function request(input) {
    try {
      const {options, controller, requestId, messageId, kind, calls} = invocation;
      const url = new URL(input.url);
      assert.equal(url.origin, productionCloud.api);
      assert.equal(input.credentialReference, reference);
      assert.equal(input.signal, controller.signal);
      assert.equal(input.headers.Authorization, undefined);
      assert.equal(input.redirect, 'error');
      if (url.pathname === operations+'/'+requestId) {
        assert.equal(input.method, 'GET');
        assert.deepEqual([...url.searchParams], [['grantId', grant]]);
        const readback = calls.includes('dispatch');
        const name = readback ? 'readback' : 'lookup';
        const reply = (readback ? options.recovery : options.prior) ?? 'canonical';
        assert.ok(!calls.includes(name), 'Each invocation reads the prior and recovery receipt at most once');
        calls.push(name);
        if (reply === 'abort') controller.abort();
        point(readback ? 'Read back the exact stable turn receipt once' : 'Read the durable prior receipt by exact grant and turn', action(name, reply));
        return readReceipt(url, reply, ledger.get(requestId));
      }
      if (url.pathname === '/api/v1/eliza/google/gmail/read') {
        assert.equal(input.method, 'GET');
        assert.deepEqual([...url.searchParams], [['side','owner'], ['grantId',grant], ['messageId',messageId]]);
        calls.push('message');
        const history = options.history ?? 1;
        point('Read the exact selected provider message and revision', action('readMessage', history));
        return ok({message: {externalId: messageId, threadId: 'thread1', subject: 'Synthetic message', from: 'Sender',
          to: [], snippet: '', receivedAt: '2026-10-15T00:00:00Z', isUnread: true,
          metadata: history ? {historyId: revisions[history-1]} : {}}, bodyText: 'Synthetic'});
      }
      if (url.pathname === operations) {
        assert.equal(input.method, 'POST');
        assert.deepEqual(input.body, {grantId: grant, requestId,
          proposal: {kind, messageId, expectedHistoryId: revisions[(options.history ?? 1)-1]}});
        invocation.proposal = {request: requests.indexOf(input.body.requestId)+1,
          message: messages.indexOf(input.body.proposal.messageId)+1,
          history: revisions.indexOf(input.body.proposal.expectedHistoryId)+1, kind: input.body.proposal.kind};
        calls.push('prepare');
        const reply = options.review ?? 'exact';
        if (reply === 'provider-refused') {
          point('The prior prepare no longer accepts this revision', action('prepare', reply));
          return {status: 409, data: {error: 'Review changed'}};
        }
        const review = {from: 'sender@example.invalid', ...input.body.proposal};
        const prepared = {requestId, kind, state: 'prepared', reviewDigest: digest(review), providerResult: null, rejectionCode: null};
        ledger.set(requestId, prepared);
        invocation.reviewDigest = prepared.reviewDigest;
        const visibleReview = {...review};
        if (reply === 'history') visibleReview.expectedHistoryId = 'foreign-revision';
        if (reply === 'message') visibleReview.messageId = 'foreign-message';
        if (reply === 'kind') visibleReview.kind = kind === 'archive' ? 'trash' : 'archive';
        if (reply === 'from') visibleReview.from = '';
        const visibleReceipt = {...prepared, reviewDigest: digest(visibleReview)};
        if (reply === 'digest') visibleReceipt.reviewDigest = 'f'.repeat(64);
        if (reply === 'receipt-id') visibleReceipt.requestId = requests.find(id => id !== requestId);
        if (reply === 'receipt-kind') visibleReceipt.kind = kind === 'archive' ? 'trash' : 'archive';
        if (reply === 'receipt-state') visibleReceipt.state = 'dispatched';
        point('Prepare the exact proposal and return the selected review evidence', action('prepare', reply));
        return ok({...receiptBody(visibleReceipt), review: visibleReview});
      }
      if (url.pathname === '/api/v1/eliza/google/accounts') {
        assert.equal(input.method, 'GET');
        assert.deepEqual([...url.searchParams], [['side','owner']]);
        const reply = options.accounts ?? 'matching';
        calls.push('accounts');
        if (reply === 'abort') controller.abort();
        point('Read the current owner grant after preparation', action('accounts', reply));
        const row = {...account};
        if (reply === 'revoked') row.grantedCapabilities = ['google.gmail.triage'];
        if (reply === 'foreign') row.connectionId = '44444444-4444-4444-8444-444444444444';
        if (reply === 'disconnected') row.connected = false;
        return ok([row]);
      }
      if (url.pathname === operations+'/'+requestId+'/dispatch') {
        assert.equal(input.method, 'POST');
        assert.deepEqual(input.body, {grantId: grant, reviewDigest: invocation.reviewDigest,
          proposal: {kind, messageId, expectedHistoryId: revisions[(options.history ?? 1)-1]}});
        assert.equal(ledger.get(requestId)?.state, 'prepared');
        invocation.sent = {request: requests.indexOf(url.pathname.split('/').at(-2))+1,
          message: messages.indexOf(input.body.proposal.messageId)+1,
          history: revisions.indexOf(input.body.proposal.expectedHistoryId)+1, kind: input.body.proposal.kind};
        calls.push('dispatch');
        totalDispatches++;
        const state = options.providerState ?? 'succeeded', reply = options.dispatch ?? 'canonical';
        const row = {...ledger.get(requestId), state,
          providerResult: state === 'succeeded' ? providerResult(kind, messageId) : null};
        ledger.set(requestId, row);
        if (reply === 'abort') controller.abort();
        point('Dispatch once with the exact prepared digest and proposal', action('dispatch', state, reply));
        if (reply === 'lost' || reply === 'abort') throw originalFailure;
        const visible = reply === 'bad-labels' ? {...row, providerResult: providerResult(kind, messageId, true)} : row;
        return ok(receiptBody(visible));
      }
      throw Error('Unexpected closed mailbox route: '+url.pathname);
    } catch (error) {
      if (error !== originalFailure) wireErrors.push(error);
      throw error;
    }
  }

  const client = createManagedGoogleClient({apiOrigin: productionCloud.api,
    credential: {credentialReference: reference}, request, async current() {
      if (invocation.options.abortBeforeDispatch && invocation.calls.at(-1) === 'accounts') {
        invocation.controller.abort();
        point('Abort before the reviewed transport dispatch is admitted', action('abortBeforeDispatch'));
      }
    }});

  return {trace, async invoke(options = {}) {
    const scopeMatched = options.scopeMatched ?? true, message = options.message ?? seedMessage;
    const request = options.request ?? seedRequest, kind = options.kind ?? seedKind;
    const messageId = messages[message-1] ?? 'malformed/message';
    const requestId = requests[request-1] ?? 'malformed-turn';
    const messageInput = 'alpha-gmail:'+(scopeMatched ? scope : 'b'.repeat(64))+':'+messageId;
    invocation = {options, calls: [], controller: new AbortController(), requestId, messageId, kind};
    invocations++;
    point('Invoke the actual host with the selected scope, message, kind and turn', action('begin', scopeMatched, message, request, kind));
    let result;
    try {
      const returned = await gmailAgentMailbox(client, grant, scope, {messageId: messageInput, kind, requestId}, invocation.controller.signal);
      assert.deepEqual(returned, {requestId, kind, messageId: messageInput, ok: returned.ok});
      assert.equal(typeof returned.ok, 'boolean');
      result = returned.ok ? 'ok' : 'unconfirmed';
    } catch (error) {result = resultOf(error);}
    assert.deepEqual(wireErrors, []);
    point('Observe the actual host result after all in-memory transport effects', null, {'s.result': result});
  }};
}

const traces = [];
async function run(name, options = {}, seed = {}) {
  const f = campaign(name, seed);
  for (const invocation of Array.isArray(options) ? options : [options]) await f.invoke(invocation);
  traces.push(f.trace);
}
for (const kind of ['archive', 'trash', 'mark-read', 'mark-unread']) {
  await run(kind+' verifies exact provider labels', {kind, message: 2, request: 2, history: 2});
  await run(kind+' refuses contradictory labels in both replies', {kind, dispatch: 'bad-labels', recovery: 'bad-labels'});
}
for (const [name, options] of Object.entries({
  'foreign scope': {scopeMatched: false}, 'malformed provider ID': {message: 0}, 'malformed request ID': {request: 0},
  'unsupported operation': {kind: 'send'}, 'non-operation 404': {prior: 'lookup-error'},
  'missing selected message history': {history: 0}, 'changed reviewed history': {review: 'history'},
  'changed reviewed message': {review: 'message'}, 'changed reviewed kind': {review: 'kind'},
  'missing reviewed sender': {review: 'from'}, 'wrong digest': {review: 'digest'},
  'wrong prepared state': {review: 'receipt-state'}, 'wrong prepared turn': {review: 'receipt-id'},
  'wrong prepared kind': {review: 'receipt-kind'}, 'selected grant revoked': {accounts: 'revoked'},
  'other account has mailbox permission': {accounts: 'foreign'}, 'selected grant disconnected': {accounts: 'disconnected'},
  'abort while reading account grant': {accounts: 'abort'}, 'abort before dispatch transport': {abortBeforeDispatch: true},
  'abort after dispatch prevents fallback': {dispatch: 'abort'},
  'readback abort preserves first dispatch error': {dispatch: 'lost', recovery: 'abort'},
  'unavailable readback preserves first dispatch error': {dispatch: 'lost', recovery: 'lookup-error'},
  'wrong readback request preserves first dispatch error': {dispatch: 'lost', recovery: 'wrong-id'},
  'invalid dispatch evidence recovered from matching receipt': {dispatch: 'bad-labels'},
})) await run(name, options);
for (const seedState of ['succeeded', 'dispatched', 'rejected', 'outcome-unknown'])
  await run('durable prior '+seedState+' never resubmits', {}, {seedState});
await run('wrong-kind prior is never resubmitted', {prior: 'wrong-kind'}, {seedState: 'prepared'});
await run('wrong-turn prior is never resubmitted', {prior: 'wrong-id'}, {seedState: 'succeeded'});
await run('durable receipt is bound to a different selected kind', {kind: 'trash'}, {seedState: 'succeeded'});
await run('durable success is bound to a different selected message', {message: 2}, {seedState: 'succeeded'});
await run('prior success must verify provider labels', {prior: 'bad-labels'}, {seedState: 'succeeded'});
await run('prior prepare may reject a changed message revision', {history: 2, review: 'provider-refused'}, {seedState: 'prepared'});
await run('lost success reads one receipt and repeat stays read-only', [{dispatch: 'lost'}, {}]);
await run('lost uncertain reply never resubmits a durable unknown', [{dispatch: 'lost', providerState: 'outcome-unknown'}, {}]);
await run('stable prior prepared permits a later exact prepare', [{dispatch: 'lost', providerState: 'prepared'}, {}]);
console.log(JSON.stringify(traces));
