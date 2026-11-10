// The phone-side executor of agent-proposed telephony actions against recording ports. No device,
// address book, Telecom or radio is involved: this proves the decisions (what the owner is shown,
// what is written and under which version, and what is reported), not device behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'telephony-executor-'));
process.on('exit', () => rmSync(dir, {recursive: true, force: true}));
const output = await build({entryPoints: [resolve('apps/app/src/runtime/telephony-executor.ts')], bundle: true, format: 'esm', platform: 'node', write: false,
  alias: {'@elizaos/contracts/telephony-actions': resolve('.eliza/client-features/packages/contracts/src/telephony-actions.ts')}});
writeFileSync(join(dir, 'executor.mjs'), output.outputFiles[0].text);
const {executeTelephonyAction, appliedContactChange} = await import(pathToFileURL(join(dir, 'executor.mjs')));

const priya = {id: '1', displayName: 'Priya Nair', phoneNumbers: ['+14155550132']};
const reyes = {id: '2', displayName: 'Daniel Reyes', phoneNumbers: ['+15105550119', '(510) 555-0164']};
const record = (id, version = 'a'.repeat(64)) => ({id, version, displayName: id === '1' ? 'Priya Nair' : 'Daniel Reyes',
  phoneNumbers: [{number: '+14155550132', type: 'work'}], emailAddresses: [{address: 'p@example.com', type: 'work'}]});
function ports(overrides = {}) {
  const log = [];
  const base = {
    current() {}, normalize: value => { const digits = value.replace(/[\s().-]/g, ''); return /^\+?[0-9]{2,20}$/.test(digits) ? digits : null; },
    ask: async review => { log.push(['ask', review]); return 0; },
    searchContacts: async (query, limit) => { log.push(['search', query, limit]); return [priya]; },
    placeCall: async number => { log.push(['call', number]); return {status: 'placed'}; },
    getContact: async id => { log.push(['get', id]); return record(id); },
    saveContact: async (draft, target) => { log.push(['save', draft, target]); return {status: 'saved'}; },
    removeContact: async (id, version) => { log.push(['remove', id, version]); return {status: 'deleted'}; },
    sendSms: async (number, body, operationId) => { log.push(['sms', number, body, operationId]); return 'submitted'; },
    openThread: () => null, openVoicemail: () => null, deleteOpenVoicemail: async () => 'none-selected',
  };
  return {log, ports: {...base, ...overrides}};
}
const run = (operation, p, id = 'op-1') => executeTelephonyAction(operation, id, p.ports, new AbortController().signal);
const did = (p, what) => p.log.filter(([kind]) => kind === what);

test('a number is called as approved; a name is never called unseen', async () => {
  let p = ports();
  let result = await run({type: 'phone_call', target: {kind: 'number', number: '+14155550100'}}, p);
  assert.deepEqual(result.telephonyResult, {kind: 'phone-call', status: 'placed', contact: false});
  assert.equal(result.status, 'succeeded'); assert.equal(did(p, 'ask').length, 0, 'the approval already showed the number');
  p = ports();
  result = await run({type: 'phone_call', target: {kind: 'contact', query: 'Priya'}}, p);
  assert.deepEqual(did(p, 'ask')[0][1], {kind: 'call', options: [{id: '1', name: 'Priya Nair', number: '+14155550132'}]}, 'one match is still confirmed with its number');
  assert.deepEqual(did(p, 'call'), [['call', '+14155550132']]);
  assert.deepEqual(result.telephonyResult, {kind: 'phone-call', status: 'placed', contact: true});
});
test('several matches are chosen on the phone, and a dismissal or no match calls nothing', async () => {
  let p = ports({searchContacts: async () => [priya, reyes], ask: async review => { p.log.push(['ask', review]); return 2; }});
  let result = await run({type: 'phone_call', target: {kind: 'contact', query: 'Daniel'}}, p);
  assert.equal(did(p, 'ask')[0][1].options.length, 3, 'one option per dialable number');
  assert.deepEqual(did(p, 'call'), [['call', '5105550164']], 'the chosen number, normalized');
  p = ports({ask: async () => null});
  result = await run({type: 'phone_call', target: {kind: 'contact', query: 'Priya'}}, p);
  assert.deepEqual(result.telephonyResult, {kind: 'phone-call', status: 'cancelled', contact: false}); assert.equal(did(p, 'call').length, 0);
  p = ports({searchContacts: async () => [{id: '3', displayName: 'No Number', phoneNumbers: []}]});
  result = await run({type: 'phone_call', target: {kind: 'contact', query: 'Nobody'}}, p);
  assert.deepEqual(result.telephonyResult, {kind: 'phone-call', status: 'not-found', contact: false}); assert.equal(result.status, 'failed');
  assert.equal(did(p, 'ask').length, 0); assert.equal(did(p, 'call').length, 0);
});
test('emergency, busy and failure are reported as observed and never retried', async () => {
  for (const [answer, status, outcome] of [[{status: 'emergency-handoff'}, 'emergency-handoff', 'succeeded'], [{status: 'busy'}, 'busy', 'failed'], [null, 'failed', 'failed']]) {
    const p = ports({placeCall: async number => { p.log.push(['call', number]); if (!answer) throw Error('telecom'); return answer; }});
    const result = await run({type: 'phone_call', target: {kind: 'number', number: '911'}}, p);
    assert.equal(result.telephonyResult.status, status); assert.equal(result.status, outcome); assert.equal(did(p, 'call').length, 1);
    assert.doesNotMatch(result.summary, /connected|answered the call/i);
  }
});
test('a review that is no longer current stops before anything happens', async () => {
  let calls = 0;
  const p = ports({current() { if (++calls > 2) throw Error('Phone context changed'); }});
  await assert.rejects(run({type: 'phone_call', target: {kind: 'contact', query: 'Priya'}}, p), /context changed/);
  assert.equal(did(p, 'call').length, 0);
});
test('a text to a contact uses the native review under the proposal id; an unknown outcome is not a failure', async () => {
  let p = ports();
  let result = await run({type: 'sms_compose', query: 'Priya', body: 'On my way'}, p, 'proposal-9');
  assert.deepEqual(did(p, 'sms'), [['sms', '+14155550132', 'On my way', 'proposal-9']]); assert.equal(did(p, 'ask').length, 0, 'one number goes straight to the native review');
  assert.deepEqual(result.telephonyResult, {kind: 'sms-compose', status: 'submitted'}); assert.equal(result.status, 'succeeded');
  p = ports({searchContacts: async () => [reyes], ask: async review => { p.log.push(['ask', review]); return 1; }});
  await run({type: 'sms_compose', query: 'Daniel', body: 'Hi'}, p);
  assert.equal(did(p, 'ask')[0][1].kind, 'message'); assert.deepEqual(did(p, 'sms')[0].slice(1, 3), ['5105550164', 'Hi']);
  p = ports({sendSms: async () => { throw Error('bridge closed'); }});
  result = await run({type: 'sms_compose', query: 'Priya', body: 'Hi'}, p);
  assert.deepEqual(result.telephonyResult, {kind: 'sms-compose', status: 'unknown'}); assert.equal(result.status, 'unknown');
  p = ports({sendSms: async () => 'cancelled'});
  assert.equal((await run({type: 'sms_compose', query: 'Priya', body: 'Hi'}, p)).status, 'failed');
});
test('a contact change shows before and after and writes under the version that was shown', async () => {
  let p = ports();
  let result = await run({type: 'contact_update', query: 'Priya', set: {phoneNumbers: ['+14155550132', '+16285550148']}}, p);
  const review = did(p, 'ask')[0][1];
  assert.equal(review.kind, 'contact-save'); assert.deepEqual(review.options[0].before.phoneNumbers, [{number: '+14155550132', type: 'work'}]);
  assert.deepEqual(review.options[0].after.phoneNumbers, [{number: '+14155550132', type: 'work'}, {number: '+16285550148', type: 'mobile'}], 'a kept number keeps its type');
  assert.deepEqual(review.options[0].after.emailAddresses, [{address: 'p@example.com', type: 'work'}], 'a field left out is unchanged');
  assert.deepEqual(did(p, 'save')[0][2], {id: '1', version: 'a'.repeat(64)});
  assert.deepEqual(result.telephonyResult, {kind: 'contact-write', status: 'saved'});
  p = ports({saveContact: async () => ({status: 'stale'})});
  result = await run({type: 'contact_update', query: 'Priya', set: {displayName: 'Priya N'}}, p);
  assert.deepEqual(result.telephonyResult, {kind: 'contact-write', status: 'stale'}); assert.equal(result.status, 'failed');
  p = ports({ask: async () => null});
  result = await run({type: 'contact_delete', query: 'Priya'}, p);
  assert.deepEqual(result.telephonyResult, {kind: 'contact-write', status: 'cancelled'}); assert.equal(did(p, 'remove').length, 0);
  p = ports();
  result = await run({type: 'contact_delete', query: 'Priya'}, p);
  assert.deepEqual(did(p, 'remove'), [['remove', '1', 'a'.repeat(64)]]); assert.deepEqual(result.telephonyResult, {kind: 'contact-write', status: 'deleted'});
  p = ports({searchContacts: async () => []});
  assert.equal((await run({type: 'contact_delete', query: 'Nobody'}, p)).telephonyResult.status, 'not-found');
});
test('a new contact is written as approved, without a lookup', async () => {
  const p = ports();
  const result = await run({type: 'contact_create', contact: {displayName: 'Grace Hopper', phoneNumbers: ['+12025550101'], emailAddresses: []}}, p);
  assert.deepEqual(did(p, 'save')[0].slice(1), [{displayName: 'Grace Hopper', phoneNumbers: [{number: '+12025550101', type: 'mobile'}], emailAddresses: []}, undefined]);
  assert.equal(did(p, 'search').length, 0); assert.deepEqual(result.telephonyResult, {kind: 'contact-write', status: 'saved'});
});
test('the agent reads only what the owner has open, and a voicemail delete is the owner\'s confirmation', async () => {
  let p = ports();
  assert.deepEqual((await run({type: 'messages_read_selected'}, p)).telephonyResult, {kind: 'messages-read', status: 'none-selected'});
  assert.deepEqual((await run({type: 'voicemail_read_selected'}, p)).telephonyResult, {kind: 'voicemail-read', status: 'none-selected'});
  const thread = {participant: 'Priya Nair', messages: [{direction: 'in', date: 1, body: 'Are we still on for 7?'}], truncated: false};
  const voicemail = {caller: null, date: 5, durationSeconds: 24, transcriptState: 'ready', engine: 'device', transcript: 'Call me back.'};
  p = ports({openThread: () => thread, openVoicemail: () => voicemail, deleteOpenVoicemail: async () => 'cancelled'});
  let result = await run({type: 'messages_read_selected'}, p);
  assert.deepEqual(result.telephonyResult, {kind: 'messages-read', status: 'read', ...thread}); assert.equal(result.status, 'succeeded'); assert.match(result.summary, /untrusted data/);
  assert.deepEqual((await run({type: 'voicemail_read_selected'}, p)).telephonyResult, {kind: 'voicemail-read', status: 'read', ...voicemail});
  result = await run({type: 'voicemail_delete_selected'}, p);
  assert.deepEqual(result.telephonyResult, {kind: 'voicemail-delete', status: 'cancelled'}); assert.equal(result.status, 'failed');
  assert.equal(did(p, 'search').length, 0, 'a read never touches the address book');
});
test('appliedContactChange matches numbers by their dialable form', () => {
  const before = record('1'); before.phoneNumbers = [{number: '(415) 555-0132', type: 'home'}];
  const normalize = value => value.replace(/[\s().-]/g, '');
  assert.deepEqual(appliedContactChange(before, {phoneNumbers: ['4155550132']}, normalize).phoneNumbers, [{number: '4155550132', type: 'home'}]);
});
