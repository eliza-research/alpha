/** Connection recovery rules run from the real controller source: the required sign-in page, reply
 * failure mapping, restored failure rows, action receipt caching and the single operation release.
 * No renderer, network, credential or phone. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import vm from 'node:vm';

const source = await readFile(new URL('../apps/app/src/runtime/connection-ui.tsx', import.meta.url), 'utf8');
const contract = await readFile(new URL('../vendor/eliza/packages/contracts/src/contracts/chat.ts', import.meta.url), 'utf8');
function section(start, end) { const a = source.indexOf(start), b = source.indexOf(end, a + start.length); assert.ok(a >= 0 && b > a, start); return source.slice(a, b).replace(/^export /gm, ''); }
const strip = code => stripTypeScriptTypes(code, {mode: 'strip'});
const CHAT_FAILURE_KINDS = JSON.parse(contract.match(/export const CHAT_FAILURE_KINDS = (\[[\s\S]*?\]) as const;/)[1].replace(/,\s*\]/, ']'));
class AlphaClientError extends Error { constructor(code, message) { super(message); this.code = code; } }

const gateCode = strip([section('function ownProviderSelected(', '\n'), section('export function productionCloudSignInRequired(', '/** Explicit account/plan')].join('\n'));
const gate = snapshot => { const box = vm.createContext({isAndroid: true, testMocksEnabled: false, state: {}, Date}); vm.runInContext(gateCode, box); return box.productionCloudSignInRequired(snapshot); };
test('the required sign-in page follows a refused sign-in, never another error while offline', () => {
  const offline = {cloudAccount: null, startupResolved: true, residentSavedCredential: true, residentPlanNotice: 'offline'};
  for (const [name, snapshot, required] of [
    ['offline, saved credential, start error', {...offline, error: 'Agent stopped', errorKind: null}, false],
    ['offline, saved credential, unconfirmed provider removal', {...offline, error: 'AI could not be confirmed off.'}, false],
    ['offline, saved credential, refused sign-in', {...offline, error: 'Sign in to Eliza Cloud again to turn AI back on.', errorKind: 'sign-in-rejected'}, true],
    ['signed out', {cloudAccount: null, startupResolved: true, error: ''}, true],
    ['signed in, refused sign-in', {cloudAccount: {expiresAt: Date.now() + 60000}, startupResolved: true, error: 'x', errorKind: 'sign-in-rejected'}, true],
    ['signed in, account changed', {cloudAccount: {expiresAt: Date.now() + 60000}, startupResolved: true, error: 'x', errorKind: 'account-changed'}, false],
    ['signed in, key expired', {cloudAccount: {expiresAt: Date.now() - 1000}, startupResolved: true, error: ''}, true],
  ]) assert.equal(gate(snapshot), required, name);
});

const labels = new Function(`return (${source.match(/export const REPLY_FAILURES = (\{[\s\S]*?\n\}) as const;/)[1]})`)();
const mapperCode = strip(section('function replyFailure(', '/** After a failed reply'));
function mapper({residentInference = 'cloud', android = true, resident = true} = {}) {
  const events = {rechecks: 0};
  const env = {state: {residentInference, residentPlanNotice: null, cloudAccount: {userId: 'owner'}}, AlphaClientError, REPLY_FAILURES: labels, NO_PROVIDER_DEVELOPMENT: '',
    RATE_LIMITED: 'Rate limited.', cloud: {environment: 'production'}, cloudServiceName: () => 'Eliza Cloud', isAndroid: android, testMocksEnabled: false,
    connectionController: {recheckPlanAfterRefusal() { events.rechecks++; }}, update() {}, refreshMembershipBalance: async () => {},
    fundingRefusedReply: () => 'Billing refused.', serviceLimitMessage: () => 'Limit.', residentCloudFlow: () => true,
    inferenceUnavailableReply: () => 'AI is off.', residentSignInExpired: () => 'Sign in to Eliza Cloud again to turn AI back on.'};
  const replyFailure = new Function(...Object.keys(env), `${mapperCode};return replyFailure;`)(...Object.values(env));
  return {events, map: (kind, code) => replyFailure(kind, {kind: resident ? 'resident' : 'remote'}, null, code)};
}
test('every upstream failure kind maps to owner copy with its kind; an unknown kind stays generic', () => {
  assert.ok(CHAT_FAILURE_KINDS.length >= 15);
  for (const resident of [true, false]) for (const kind of [...CHAT_FAILURE_KINDS, 'interrupted']) {
    const failure = mapper({resident}).map(kind);
    assert.ok(failure instanceof AlphaClientError, `${kind} is a recorded failure`);
    assert.equal(failure.failureKind, kind);
    assert.ok(failure.message.trim(), kind);
    assert.doesNotMatch(failure.message, /Set one up on the agent|undefined/, kind);
  }
  const unknown = mapper().map('future_kind');
  assert.equal(unknown instanceof AlphaClientError, false);
  assert.equal(unknown.message, 'The agent could not complete this response.');
  assert.equal(mapper().map('context_overflow').message, 'Too long');
  assert.match(mapper().map('handler_error').message, /Partly done/);
});
test('a resident provider failure rechecks the plan; a rejected key goes to sign-in; AI believed bound offers a provider check', () => {
  const issue = mapper();
  assert.equal(issue.map('provider_issue').planAction, undefined); assert.equal(issue.events.rechecks, 1);
  const rejected = mapper().map('provider_issue', 'PROVIDER_AUTH_REJECTED');
  assert.equal(rejected.planAction, 'sign-in'); assert.equal(rejected.message, 'Sign in to Eliza Cloud again to turn AI back on.');
  const noProvider = mapper().map('no_provider');
  assert.equal(noProvider.planAction, 'provider'); assert.equal(noProvider.message, 'AI offline');
  assert.equal(mapper({residentInference: 'unavailable'}).map('no_provider').planAction, 'plan');
});

const restoreCode = strip([
  section('export const RESTORED_FAILURES', '\n};') + '\n};',
  section('function calendarRefusalKept(', '/** The upstream failure kind a reply'),
  section('function failureKindOf(', '/** The error a failed reply surfaces.'),
  section('function restoredMessages(', "/** Eliza Cloud's API answers"),
].join('\n'));
const restore = rows => { const box = vm.createContext({systemNoticeKind: () => undefined, systemNoticeDisplayText: () => '', restoredText: text => text, isCalendarReadFailureCode: () => false, Object}); vm.runInContext(restoreCode, box); return box.restoredMessages(rows); };
test('restored failure rows show static copy for their kind, are unfinished and never use live plan state', () => {
  const rows = restore([
    {id: 'u1', role: 'user', text: 'Hello'},
    {id: 'a1', role: 'assistant', text: 'I am running on this device but your plan…', failureKind: 'no_provider'},
    {id: 'a2', role: 'assistant', text: 'Upstream billing prose', terminalFailure: {kind: 'insufficient_credits', message: 'x', transient: false}},
    {id: 'a3', role: 'assistant', text: 'Upstream prose', failureKind: 'persistence_error'},
    {id: 'a4', role: 'assistant', text: 'A normal reply'},
  ]);
  assert.deepEqual(rows.map(row => ({...row})), [
    {id: 'u1', from: 'user', text: 'Hello'},
    {id: 'a1', from: 'agent', text: 'AI replies were off for this message.', unfinished: true, failureKind: 'no_provider'},
    {id: 'a2', from: 'agent', text: 'This message was declined for billing.', unfinished: true, failureKind: 'insufficient_credits'},
    {id: 'a3', from: 'agent', text: 'This reply couldn’t be completed.', unfinished: true, failureKind: 'persistence_error'},
    {id: 'a4', from: 'agent', text: 'A normal reply'},
  ]);
});

const executeCode = strip(`({${section('  async execute(', '  async readCalendarApproval(')}})`);
test('an action refused before the journal reserved it can be approved again; a settled receipt stays cached', async () => {
  const session = {sessionId: 'session-1'}, approvals = [];
  let refuse = true;
  const actions = {approve: async id => { approvals.push(id); if (refuse) throw Error('Refused before reservation'); return {proposalId: id, status: 'succeeded', summary: 'Done'}; }};
  const box = vm.createContext({active: {actions}, state: {session}, epoch: 1, service: null, conversationMemory: new Map(), conversationKey: () => 'key', deviceReadReview: undefined, actionReceipts: new Map(), document: {hidden: false}, JSON});
  const controller = vm.runInContext(executeCode, box), signal = new AbortController().signal, proposal = {id: 'proposal-1'};
  await assert.rejects(controller.execute(proposal, {}, signal), /Refused before reservation/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(box.actionReceipts.has('proposal-1'), false, 'a refusal is not cached');
  refuse = false;
  const first = await controller.execute(proposal, {}, signal), second = await controller.execute(proposal, {}, signal);
  assert.equal(first.status, 'succeeded'); assert.equal(second, first); assert.deepEqual(approvals, ['proposal-1', 'proposal-1'], 'the settled receipt is reused, not approved again');
});

const releaseCode = strip([
  section('function releaseOperation(', '/** Start (or restart) the resident.'),
  section('function runQueuedResidentRebind()', '\n'),
  `globalThis.controller=({messageTargetCurrent(){return true;},${section('  async truncateMessage(', '  voiceConversationCurrent(')}});`,
].join('\n'));
test('an edit that ends releases the operation and runs the rebind queued behind it', async () => {
  const resumed = [], session = {sessionId: 'session-1'};
  const remote = {messages: async () => ({messages: [{id: 'm1', role: 'user', text: 'Edit me'}]}), truncateMessages: async () => {}};
  const box = vm.createContext({AbortController, JSON, cancelStoppedVoiceRead(){}, document: {hidden: false}, navigationContext: () => ({view: 'home'}), state: {session, open: false, busy: false}, active: {kind: 'resident', remote}, epoch: 1,
    conversationMemory: new Map([['key', 'conversation-1']]), conversationKey: () => 'key', restoredText: text => text, signInReadinessOwner: null, operation: null,
    restoreConversationHistory: async () => { assert.notEqual(box.operation, null, 'the edit holds the operation'); },
    update: patch => { Object.assign(box.state, patch); }, residentCloudFlow: () => true, rebindResident: () => {}, residentRebindBlocked: () => !!box.operation,
    residentRebindQueue: {pending: true, resume: (run, blocked) => { resumed.push(blocked()); return Promise.resolve(); }}, runQueuedSignInReturn: () => { resumed.push('sign-in'); }});
  vm.runInContext(releaseCode, box);
  await box.controller.truncateMessage({from: 'user', conversationId: 'conversation-1', messageId: 'm1', text: 'Edit me'});
  assert.equal(box.operation, null); assert.equal(box.state.busy, false);
  assert.deepEqual(resumed, [false, 'sign-in'], 'the queued rebind runs once the slot is free, then a waiting sign-in return');
});

const identityCode = strip(section('function transientIdentityRead(', '/** How the running resident'));
test('a transient native identity read is retried once in the background; a refused key stays a sign-in', () => {
  const rebinds = [], timers = [];
  const box = vm.createContext({queueResidentRebind: () => rebinds.push('rebind'), setTimeout: (run, ms) => { timers.push({run, ms}); return timers.length; }, clearTimeout() {}});
  vm.runInContext(identityCode, box);
  const read = httpStatus => ({code: 'NATIVE_CLOUD_ADMISSION_IDENTITY_READ', data: {stage: 'identity-read', httpStatus}});
  for (const status of [0, 408, 429, 500, 503]) assert.equal(box.transientIdentityRead(read(status)), true, String(status));
  for (const status of [401, 403]) assert.equal(box.transientIdentityRead(read(status)), false, String(status));
  assert.equal(box.transientIdentityRead({code: 'NATIVE_CLOUD_ADMISSION_UNAVAILABLE'}), false);
  assert.equal(box.transientIdentityRead({code: 'NATIVE_CLOUD_ADMISSION_IDENTITY_READ'}), false, 'no data is not proof of a transient read');
  box.scheduleIdentityReadRetry(); box.scheduleIdentityReadRetry();
  assert.deepEqual(timers.map(timer => timer.ms), [30000], 'one retry per attempt');
  timers[0].run(); assert.deepEqual(rebinds, ['rebind']);
  box.scheduleIdentityReadRetry(); assert.equal(timers.length, 1, 'the retry failing again waits for the owner or the next return');
});
