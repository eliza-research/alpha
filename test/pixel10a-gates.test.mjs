import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {GATE_NAMES, PIXEL10A_GATES, pixel10aGateProblems} from '../scripts/pixel10a-gates.mjs';

const FILES = [PIXEL10A_GATES, 'android/aosp/pixel10a-product.json', 'vendor/eliza/packages/os/android/sources/pixel10a-stallion.json', 'android/aosp/pixel10a-ota-channel.json',
  'docs/pixel10a-source-verification-2026-10-25.json', 'docs/pixel10a-code6-boot-evidence.json', 'docs/evidence/cuttlefish-observation-2026-10-25.json'];
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function copy(t, change = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel10a-gates-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  for (const file of FILES) {
    fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true});
    fs.copyFileSync(file, path.join(root, file));
  }
  for (const [file, edit] of Object.entries(change)) fs.writeFileSync(path.join(root, file), JSON.stringify(edit(read(path.join(root, file))), null, 2));
  return root;
}
const gate = (name, edit) => ({[PIXEL10A_GATES]: record => ({...record, gates: {...record.gates, [name]: edit(record.gates[name])}})});

test('the committed record keeps every gate distinct and claims no release qualification', () => {
  assert.deepEqual(pixel10aGateProblems(), []);
  const {gates} = read(PIXEL10A_GATES);
  assert.deepEqual(Object.keys(gates), GATE_NAMES);
  assert.equal(gates.sourceAdmission.status, 'passed');
  for (const name of ['cuttlefishBoot', 'physicalDevice', 'signedUpdateRecovery', 'userAcceptance']) assert.notEqual(gates[name].status, 'passed', name);
  const product = read('android/aosp/pixel10a-product.json');
  assert.equal(product.releaseQualified, false);
  assert.equal(product.deviceAcceptanceVerified, false);
});

test('development boot evidence cannot pass a gate, and passing needs evidence', t => {
  assert.match(pixel10aGateProblems(copy(t, gate('physicalDevice', g => ({...g, status: 'passed'})))).join('\n'), /physicalDevice cannot pass on development evidence/);
  assert.match(pixel10aGateProblems(copy(t, gate('cuttlefishBoot', g => ({...g, status: 'development', evidence: []})))).join('\n'), /cuttlefishBoot is "development" without evidence/);
  assert.match(pixel10aGateProblems(copy(t, gate('cuttlefishBoot', g => ({...g, evidence: [{ref: 'docs/absent.json', level: 'development'}]})))).join('\n'), /evidence docs\/absent.json is missing/);
  assert.match(pixel10aGateProblems(copy(t, gate('userAcceptance', g => ({...g, status: 'accepted'})))).join('\n'), /status must be one of/);
});

test('the gates and descriptor record Alpha\'s product, never another brand\'s', t => {
  const eliza = {[PIXEL10A_GATES]: record => ({...record, product: 'eliza_stallion_phone'}), 'android/aosp/pixel10a-product.json': product => ({...product, product: 'eliza_stallion_phone'})};
  assert.match(pixel10aGateProblems(copy(t, eliza)).join('\n'), /must record alpha_stallion_phone/);
});

test('gates cannot be merged, dropped or passed out of order', t => {
  const dropped = {[PIXEL10A_GATES]: record => { const {cuttlefishBoot, ...rest} = record.gates; return {...record, gates: rest}; }};
  assert.match(pixel10aGateProblems(copy(t, dropped)).join('\n'), /gates must be exactly/);
  const accepted = gate('userAcceptance', g => ({...g, status: 'passed', evidence: [{ref: 'docs/pixel10a-code6-boot-evidence.json', level: 'release'}]}));
  assert.match(pixel10aGateProblems(copy(t, accepted)).join('\n'), /userAcceptance cannot pass before every other gate/);
});

test('signed update and recovery cannot pass while the channel drills are not run', t => {
  const passed = gate('signedUpdateRecovery', g => ({...g, status: 'passed', evidence: [{ref: 'android/aosp/pixel10a-ota-channel.json', level: 'release'}]}));
  const problems = pixel10aGateProblems(copy(t, passed)).join('\n');
  assert.match(problems, /signedUpdateRecovery passed while .*signedUpdate drill is "not run"/);
  assert.match(problems, /knownGoodRelease\.otaSha256 is unset/);
});

test('source admission must match the pinned, admitted lock and its verification', t => {
  const unadmitted = {'vendor/eliza/packages/os/android/sources/pixel10a-stallion.json': lock => ({...lock, developmentOnly: true})};
  const problems = pixel10aGateProblems(copy(t, unadmitted)).join('\n');
  assert.match(problems, /sourceAdmission passed while the lock is developmentOnly/);
  assert.match(problems, /does not pin the lock/);
  const stale = {'docs/pixel10a-source-verification-2026-10-25.json': report => ({...report, sourceLockSha256: '0'.repeat(64)})};
  assert.match(pixel10aGateProblems(copy(t, stale)).join('\n'), /evidence does not verify the pinned admitted lock/);
});
