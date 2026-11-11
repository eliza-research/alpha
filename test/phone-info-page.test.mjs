// Settings → Phone: what one phoneInfo read becomes on the page, and that the read is held only while
// the page is open. Pure presenters and a loader against a recording stub; no device or SIM is involved.
import {test} from 'node:test';
import assert from 'node:assert/strict';
const {createPhoneInfoLoader, identifiersElsewhere, phoneDefaultRows, phoneLineSections} = await import('../apps/app/src/prototype/phone-info-page.ts');

const line = (patch = {}) => ({subscriptionId: 1, slot: 0, displayName: 'Personal', carrierName: 'Synthetic Carrier', number: '+15550100100', countryIso: 'us',
  networkType: '5g', roaming: false, signalLevel: 3, embedded: false, iccid: null, imei: null, ...patch});
const info = (lines = [line()], access = {}) => ({access: {phoneState: true, phoneNumbers: true, deviceIdentifiers: false, ...access}, lines});
const status = (patch = {}) => ({version: 2, voiceCapable: true, smsCapable: true, permissions: {contacts: 'granted', phoneState: 'granted', sms: 'granted', sendSms: 'granted'}, sendMode: 'direct', mmsSend: false,
  roles: {dialer: {available: true, held: true, eligible: true}, sms: {available: true, held: false, eligible: true}}, defaultDialer: 'ai.alphacompute.alphaphone', defaultSms: 'com.android.messaging',
  subscriptions: [], defaultSmsSubscriptionId: null, ...patch});
const rows = section => section.rows.map(row => [row.label, row.value]);

test('one SIM shows carrier, number, network, signal and slot without a caption', () => {
  const [section, ...rest] = phoneLineSections(info());
  assert.equal(rest.length, 0); assert.equal(section.caption, '');
  assert.deepEqual(rows(section), [['Carrier', 'Synthetic Carrier'], ['SIM name', 'Personal'], ['Number', '(555) 010-0100'], ['Network', '5G'], ['Signal', 'Good'], ['SIM', 'Slot 1']]);
});
test('unreadable fields are left out, never guessed', () => {
  const [section] = phoneLineSections(info([line({number: null, signalLevel: null, roaming: null, displayName: '', networkType: 'unknown'})], {phoneNumbers: false}));
  assert.deepEqual(rows(section), [['Carrier', 'Synthetic Carrier'], ['Network', 'Unknown'], ['SIM', 'Slot 1']]);
  const [none] = phoneLineSections(info([line({networkType: 'none', signalLevel: 0})]));
  assert.deepEqual(rows(none).filter(([label]) => label === 'Network' || label === 'Signal'), [['Network', 'No service']], 'no signal row without service');
});
test('two SIMs are told apart; roaming, eSIM and identifiers show when the read returned them', () => {
  const sections = phoneLineSections(info([line(), line({subscriptionId: 2, slot: 1, embedded: true, roaming: true, networkType: '4g', carrierName: '', displayName: 'Travel', imei: '356938035643809', iccid: '8901260123456789012F'})], {deviceIdentifiers: true}));
  assert.deepEqual(sections.map(section => section.caption), ['SIM 1', 'SIM 2']);
  assert.deepEqual(rows(sections[1]), [['Carrier', 'Travel'], ['Number', '(555) 010-0100'], ['Network', '4G · Roaming'], ['Signal', 'Good'], ['SIM', 'eSIM'], ['IMEI', '356938035643809'], ['SIM serial', '8901260123456789012F']]);
  assert.equal(identifiersElsewhere(info()), true, 'without an IMEI the page links to Android status');
  assert.equal(identifiersElsewhere(info([line({imei: '356938035643809'})], {deviceIdentifiers: true})), false);
});
test('default apps name Alpha only when it holds the role; voicemail states are distinct', () => {
  assert.deepEqual(phoneDefaultRows(status(), 'ready').map(row => [row.label, row.value]), [['Phone app', 'Alpha'], ['Messages app', 'com.android.messaging'], ['Voicemail', 'On']]);
  assert.deepEqual(phoneDefaultRows(status({defaultSms: null}), null).map(row => row.value), ['Alpha', 'None'], 'an unanswered voicemail read shows no row');
  assert.equal(phoneDefaultRows(status(), 'unconfigured').at(-1).value, 'Not set up');
  assert.equal(phoneDefaultRows(status(), 'unsupported').at(-1).value, 'Not available');
});

function stub(answers = {}) {
  const calls = []; let changes = 0;
  const answer = (name, fallback) => async (...args) => { calls.push(name); return answers[name] ? answers[name](...args) : fallback; };
  const client = {status: answer('status', status()), phoneInfo: answer('phoneInfo', info()), voicemailStatus: answer('voicemailStatus', {access: true, state: 'ready'}), requestAccess: answer('requestAccess', status())};
  return {calls, client, loader: createPhoneInfoLoader(client, () => { changes++; }), changes: () => changes};
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
test('the read happens when the page opens and is forgotten when it closes', async () => {
  const s = stub();
  assert.equal(s.loader.state.phase, 'idle'); assert.deepEqual(s.calls, [], 'nothing is read before the page opens');
  s.loader.sync(true); s.loader.sync(true);
  assert.equal(s.loader.state.phase, 'loading');
  await settle();
  assert.equal(s.loader.state.phase, 'ready'); assert.deepEqual(s.calls, ['status', 'phoneInfo', 'voicemailStatus'], 'one read per opening');
  assert.equal(s.loader.state.info.lines[0].number, '+15550100100');
  s.loader.sync(false);
  assert.deepEqual(s.loader.state, {phase: 'idle'}, 'the number and carrier are not kept after the page closes');
  s.loader.refresh(); s.loader.allow(); await settle();
  assert.equal(s.calls.length, 3, 'a closed page reads nothing');
});
test('a reply that arrives after the page closed is dropped; failure offers a retry; Allow asks for phone-state access', async () => {
  let release; const held = new Promise(resolve => { release = resolve; });
  let s = stub({phoneInfo: async () => { await held; return info(); }});
  s.loader.sync(true); await settle(); s.loader.sync(false); release(); await settle();
  assert.deepEqual(s.loader.state, {phase: 'idle'});
  s = stub({phoneInfo: async () => { throw Error('unavailable'); }});
  s.loader.sync(true); await settle();
  assert.equal(s.loader.state.phase, 'failed');
  s = stub({voicemailStatus: async () => { throw Error('no voicemail'); }});
  s.loader.sync(true); await settle();
  assert.equal(s.loader.state.phase, 'ready'); assert.equal(s.loader.state.voicemail, null, 'voicemail is optional');
  s.loader.allow(); await settle();
  assert.deepEqual(s.calls.slice(3), ['requestAccess', 'phoneInfo', 'voicemailStatus']);
});

for(const before of ['status','requestAccess','phoneInfo'])test(`closing Phone during ${before} admits no later private read`,async()=>{
 let release;const held=new Promise(resolve=>release=resolve);
 const s=stub({[before]:async()=>{await held;return before==='phoneInfo'?info():status();}});
 s.loader.sync(true);await settle();
 if(before==='requestAccess'){s.loader.allow();await settle();}
 const admitted=s.calls.length;s.loader.sync(false);release();await settle();
 assert.equal(s.calls.length,admitted,'no native read starts after retirement');
 assert.deepEqual(s.loader.state,{phase:'idle'});
});
