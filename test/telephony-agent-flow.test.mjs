// Owner-approved telephony actions through Alpha's device-action client (AP-08): approve → journal →
// claim → execute → receipt. Recording request, journal and executor stubs: no device, Telecom,
// address book or radio is involved. A `placed` receipt proves only that the executor reported it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'telephony-flow-'));
process.on('exit', () => rmSync(dir, {recursive: true, force: true}));
const output = await build({entryPoints: [resolve('apps/app/src/runtime/device-actions.ts')], bundle: true, format: 'esm', platform: 'node', write: false});
writeFileSync(join(dir, 'sdk.mjs'), output.outputFiles[0].text);
const {DeviceActions} = await import(pathToFileURL(join(dir, 'sdk.mjs')));
const P = await import('../apps/app/src/runtime/phone-context.ts');

const context = {view: 'home', revision: 1, sensitive: false};
const session = {ownerId: 'owner', agentId: 'agent', origin: 'https://agent.example', sessionId: 'session'};
const id = '5d1f0d2a-7f0e-4c8a-9a51-0e6c1c1f9b20', digest = 'd'.repeat(64);
const ALL = ['phone.call.v1', 'contacts.write.v1', 'sms.compose.v1', 'messages.read.v1', 'voicemail.read.v1', 'voicemail.delete.v1'];
const callPriya = {type: 'phone_call', target: {kind: 'contact', query: 'Priya'}};
function fixture({capabilities = ALL, operation = callPriya, result = {kind: 'phone-call', status: 'placed', contact: true}, status = 'succeeded', receiptOutage = false} = {}) {
  let state = 'pending', attemptId, effects = 0, entry;
  const posts = [];
  const proposal = () => ({id, digest, state, subjectUserId: 'owner', requestedBy: 'agent', action: 'device_action', expiresAt: new Date(Date.now() + 600000).toISOString(),
    payload: {action: 'device_action', version: 1, installationId: 'device', enrollmentId: 'enrollment', operation}, execution: attemptId ? {attemptId, providerIdempotencyKey: id} : null});
  const request = async (path, body) => {
    if (body === undefined) return {proposals: [proposal()]};
    posts.push({path, body});
    if (path.endsWith('/decision')) state = 'approved';
    if (path.endsWith('/claim')) { state = 'executing'; attemptId = 'attempt'; }
    if (path.endsWith('/receipt')) { if (receiptOutage) throw Error('offline'); state = body.receipt.outcome === 'applied' ? 'done' : 'reconciliation_required'; }
    return {proposal: proposal(), digest};
  };
  const journal = {reserve: async input => { if (entry) return {created: false, entry}; entry = {...input, phase: 'reserved'}; return {created: true, entry}; },
    markApplying: async input => Object.assign(entry, {phase: 'applying', attemptId: input.attemptId}), finish: async input => Object.assign(entry, input, {phase: 'terminal'}),
    get: async () => ({entry}), list: async () => ({entries: entry ? [entry] : []})};
  const seen = [];
  const client = new DeviceActions(session, {installationId: 'device', enrollmentId: 'enrollment', key: 'a'.repeat(64), capabilities}, 'c'.repeat(64), request, journal,
    async (op, operationId) => { effects++; seen.push(operationId); assert.deepEqual(op, operation); return {status, summary: 'done', ...(result ? {telephonyResult: result} : {})}; });
  return {client, posts, seen, get entry() { return entry; }, get effects() { return effects; }, online() { receiptOutage = false; }};
}
const signal = () => new AbortController().signal;
const receiptOf = f => f.posts.find(post => post.path.endsWith('/receipt'))?.body.receipt;

test('the phone advertises telephony actions only on the image and only what the agent offers', () => {
  const profile = {android: true, native: true, aospImage: true};
  const offered = [...ALL, 'sms.send.v1'];
  assert.deepEqual(P.selectDeviceCapabilities(offered, profile).filter(capability => ALL.includes(capability)).sort(), [...ALL].sort());
  assert.deepEqual(P.selectDeviceCapabilities(['phone.call.v1'], profile).filter(capability => ALL.includes(capability)), ['phone.call.v1']);
  assert.deepEqual(P.selectDeviceCapabilities(offered, {...profile, aospImage: false}).filter(capability => ALL.includes(capability)), [], 'a standalone install advertises none');
});
test('each action needs its own negotiated capability', async () => {
  await assert.rejects(fixture({capabilities: []}).client.pending(context, signal()), /not negotiated/);
  await assert.rejects(fixture({capabilities: ['contacts.write.v1']}).client.pending(context, signal()), /not negotiated/);
  const [card] = await fixture().client.pending(context, signal());
  assert.match(`${card.title} ${card.description}`, /Priya/);
  assert.doesNotMatch(`${card.title} ${card.description}`, /connected|answered/i);
});
test('a sensitive screen cannot review a call', async () => {
  assert.deepEqual(await fixture().client.pending({...context, sensitive: true}, signal()), []);
});
test('an approved call runs once and its receipt carries exactly what the phone observed', async () => {
  const f = fixture();
  await f.client.pending(context, signal());
  assert.equal((await f.client.approve(id, context, signal())).status, 'succeeded');
  const receipt = receiptOf(f);
  assert.equal(receipt.outcome, 'applied'); assert.deepEqual(receipt.result, {kind: 'phone-call', status: 'placed', contact: true});
  await f.client.approve(id, context, signal()).catch(() => {});
  assert.equal(f.effects, 1, 'a second approval never calls again');
});
test('a result that contradicts the operation is refused rather than receipted', async () => {
  const f = fixture({operation: {type: 'phone_call', target: {kind: 'number', number: '+15555550100'}}, result: {kind: 'phone-call', status: 'placed', contact: true}});
  await f.client.pending(context, signal());
  await f.client.approve(id, context, signal()).catch(() => {});
  assert.notEqual(receiptOf(f)?.outcome, 'applied', 'a number call cannot report a contact choice');
});
test('a stale contact change is a failed receipt and nothing is retried', async () => {
  const f = fixture({operation: {type: 'contact_update', query: 'Priya', set: {displayName: 'Priya N'}}, result: {kind: 'contact-write', status: 'stale'}, status: 'failed'});
  await f.client.pending(context, signal());
  assert.equal((await f.client.approve(id, context, signal())).status, 'failed');
  assert.equal(receiptOf(f).outcome, 'failed'); assert.equal(receiptOf(f).result.status, 'stale'); assert.equal(f.effects, 1);
});
test('a text to a contact is journalled under the proposal id, and an unknown outcome is never sent again', async () => {
  const operation = {type: 'sms_compose', query: 'Priya', body: 'On my way'};
  let f = fixture({operation, result: {kind: 'sms-compose', status: 'submitted'}});
  await f.client.pending(context, signal()); await f.client.approve(id, context, signal());
  assert.deepEqual(f.seen, [id], 'the native send runs under the proposal id'); assert.equal(receiptOf(f).operationId, id);
  f = fixture({operation, result: {kind: 'sms-compose', status: 'unknown'}, status: 'unknown'});
  await f.client.pending(context, signal());
  assert.equal((await f.client.approve(id, context, signal())).status, 'unknown');
  await f.client.approve(id, context, signal()).catch(() => {});
  await f.client.syncReceipts(signal()).catch(() => {});
  assert.equal(f.effects, 1, 'an unknown send is not repeated');
  assert.notEqual(receiptOf(f)?.outcome, 'applied');
});
test('a receipt retry replays the journalled result without calling again', async () => {
  const f = fixture({receiptOutage: true});
  await f.client.pending(context, signal()); await f.client.approve(id, context, signal());
  f.online(); await f.client.syncReceipts(signal());
  assert.equal(f.effects, 1);
  assert.deepEqual(f.posts.filter(post => post.path.endsWith('/receipt')).at(-1).body.receipt.result, {kind: 'phone-call', status: 'placed', contact: true});
});
test('the open thread is returned to the agent as a read result', async () => {
  const result = {kind: 'messages-read', status: 'read', participant: 'Priya Nair', messages: [{direction: 'in', date: 1, body: 'Are we still on for 7?'}], truncated: false};
  const f = fixture({operation: {type: 'messages_read_selected'}, result});
  await f.client.pending(context, signal());
  assert.equal((await f.client.approve(id, context, signal())).status, 'succeeded');
  assert.equal(receiptOf(f).outcome, 'applied'); assert.deepEqual(receiptOf(f).result, result);
});
