// AP-16 Alpha behaviours on the comms surfaces (docs/agentic-comms.md AC-21, AC-24, AC-25, AC-26,
// AC-30, D8), executed from source with no app start, agent, device or provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'comms-alpha-'));
process.on('exit', () => rmSync(dir, {recursive: true, force: true}));
async function load(entry, name) {
  const output = await build({entryPoints: [resolve(entry)], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
    define: {'import.meta.env': '{}'}});
  const file = join(dir, name + '.mjs');
  writeFileSync(file, output.outputFiles[0].text);
  return import(pathToFileURL(file).href);
}
// One bundle, so the suggestion source installed by comms-alpha is the one comms-bar reads.
const entry = join(dir, 'entry.ts');
writeFileSync(entry, `export * from ${JSON.stringify(resolve('apps/app/src/prototype/comms-alpha.ts'))};\nexport {openSuggestion, proposalCanAct} from ${JSON.stringify(resolve('apps/app/src/runtime/comms-bar.ts'))};\n`);
const A = await load(entry, 'comms-alpha'), B = A;
const R = await load('apps/app/src/prototype/telephony-review.ts', 'telephony-review');

const spec = (extra = {}) => ({target: {kind: 'thread', app: 'Messages', name: 'Maya Chen', first: 'Maya', initials: 'MC'}, contextKey: 'messages:thread:t1', briefing: 'Maya texted at 2:04 PM and hasn\'t had a reply.', incoming: null, emergency: false, ...extra});

test('the open faint suggestion names something on screen and never a feature (AC-24)', () => {
  const pick = candidates => A.pickOpenSuggestion({view: 'messages', spec: spec(), candidates});
  assert.equal(pick(['Set a reminder', 'Create a note', 'Add a contact', 'Plan my afternoon']), null);
  assert.equal(pick(['Plan my afternoon', 'Tell her I\'m 10 min late']), 'Tell her I\'m 10 min late', 'a digit');
  assert.equal(pick(['what did maya ask?']), 'what did maya ask?', 'the person on screen');
  assert.equal(pick(['Move the review to Friday']), 'Move the review to Friday', 'a capitalised word after the first');
  assert.equal(pick(['Can I reply later']), null, 'I is not a name');
  assert.equal(pick([{label: 'Maya', go() {}}]), null, 'only text candidates');
  assert.equal(A.pickOpenSuggestion({view: null, spec: null, candidates: ['Any new texts?', 'Who called?']}), null);
});

test('the installed source is the only open suggestion source', () => {
  assert.equal(B.openSuggestion({view: 'messages', spec: spec(), candidates: ['Ask Maya about 3:30']}), null, 'no source before install');
  const proto = {renderVals() { return {msgs: []}; }};
  A.installCommsAlpha({prototype: proto}, {});
  assert.equal(B.openSuggestion({view: 'messages', spec: spec(), candidates: ['Check voicemail', 'Ask Maya about 3:30']}), 'Ask Maya about 3:30');
});

test('a briefing is shown once per subject, only when the chat opens and something is known (AC-25)', () => {
  assert.equal(A.briefingDue(true, spec(), null), 'Maya texted at 2:04 PM and hasn\'t had a reply.');
  assert.equal(A.briefingDue(true, spec(), 'messages:thread:t1'), null, 'unchanged thread: no new briefing');
  assert.equal(A.briefingDue(false, spec(), null), null, 'only on open');
  assert.equal(A.briefingDue(true, spec({briefing: null}), null), null, 'nothing known: absent');
  assert.equal(A.briefingDue(true, null, null), null);
});

test('a ringing call is offered as one "Screen it" proposal dispatched to Phone (AC-21)', () => {
  const p = A.screenProposal(spec({target: {kind: 'incoming', app: 'Phone', name: 'Maya Chen', first: 'Maya', initials: 'MC'}, contextKey: 'phone:incoming:c1'}));
  assert.deepEqual(p, {id: 'screen:phone:incoming:c1', kind: 'screen', title: 'Screen it', detail: 'Maya Chen', button: 'Screen it', acts: true, act: {mod: 'phone', fn: 'screenIncoming'}, args: {}});
});

test('only an open view proposal is kept for restore, as data (AC-30)', () => {
  const card = {type: 'proposal', state: 'open', id: 'p1', kind: 'call', title: 'Call Maya Chen', detail: '(415) 555-0132', button: 'Call', acts: true, act: {mod: 'phone', fn: 'callApproved'}, args: {pid: 'maya', num: '4155550132'}, done: false, go: {view: 'phone'}};
  const kept = A.openProposalOf([{from: 'agent', text: 'Call Maya?', card}]);
  assert.deepEqual(kept, {text: 'Call Maya?', card: {type: 'proposal', state: 'open', id: 'p1', kind: 'call', title: 'Call Maya Chen', detail: '(415) 555-0132', button: 'Call', acts: true, act: {mod: 'phone', fn: 'callApproved'}, args: {pid: 'maya', num: '4155550132'}}}, 'no other card fields');
  assert.equal(A.openProposalOf([{from: 'agent', text: 'x', card: {...card, state: 'replaced'}}]), null, 'the newest proposal is not open');
  assert.equal(A.openProposalOf([{from: 'agent', text: 'x', card: {...card, args: {proposalId: 'live'}}}]), null, 'live proposals are re-offered by pending-action recovery');
  assert.equal(A.openProposalOf([{from: 'agent', text: 'x', card}, {from: 'agent', text: 'y', card: {...card, id: 'p2', state: 'done'}}]), null);
});

test('the proposal record reader accepts only its exact shape', async () => {
  const S = await load('apps/app/src/runtime/alpha-proposal-store.ts', 'alpha-proposal-store');
  const empty = {v: 1, briefed: null, open: null};
  for (const bad of [null, 'x', [], {v: 2, briefed: null, open: null}, {v: 1, briefed: 3, open: null}, {v: 1, briefed: null, open: null, extra: 1}]) assert.deepEqual(S.parseProposalRecord(bad), empty);
  const open = {text: 'Call Maya?', card: {type: 'proposal', state: 'open', id: 'p1', kind: 'call', title: 'Call Maya', detail: '', button: 'Call', acts: true, act: {mod: 'phone', fn: 'callApproved'}, args: {}}};
  assert.deepEqual(S.parseProposalRecord({v: 1, briefed: 'k', open}), {v: 1, briefed: 'k', open});
  assert.equal(S.parseProposalRecord({v: 1, briefed: 'k', open: {...open, card: {...open.card, state: 'done'}}}).open, null, 'a closed proposal is never restored');
  assert.equal(S.parseProposalRecord({v: 1, briefed: 'k', open: {...open, card: {...open.card, act: null}}}).open, null);
});

test('a replaced or finished proposal can never act; other cards are unaffected (AC-26)', () => {
  assert.equal(B.proposalCanAct({type: 'proposal', state: 'open'}), true);
  assert.equal(B.proposalCanAct({type: 'proposal', state: 'replaced'}), false);
  assert.equal(B.proposalCanAct({type: 'proposal', state: 'done'}), false);
  assert.equal(B.proposalCanAct({type: 'generic'}), true);
});

test('a contact call is chosen inside the approved card, never in a separate dialog (D8)', () => {
  const review = R.presentTelephonyReview({review: {kind: 'call', options: [{id: 'a', name: 'Maya Chen', number: '+14155550132'}]}, settle() {}});
  const msgs = [{id: 1, cProposal: true, c: {type: 'proposal', proposalId: 'p1'}}, {id: 2, cProposal: true, c: {type: 'proposal', proposalId: 'p2'}, proposalAsk: true}, {id: 3, isUser: true}];
  const placed = R.placeTelephonyReview(msgs, review, 'p2');
  assert.equal(placed[1].c.reviewing, review); assert.equal(placed[1].proposalAsk, false, 'the rows replace the card button');
  assert.equal(placed[0], msgs[0]);
  assert.equal(R.placeTelephonyReview(msgs, review, 'gone')[1].c.reviewing, review, 'otherwise the newest proposal card');
  const digest = R.placeTelephonyReview([{id: 1, cDigest: true, c: {proposalId: 'p3'}, rows: []}], review, 'p3');
  assert.deepEqual(digest[0].rows.map(row => row.who), ['Maya Chen', 'Not now']);
  assert.equal(R.placeTelephonyReview([{id: 3, isUser: true}], review, 'p1'), null, 'no card: the caller dismisses it');
  assert.equal(R.placeTelephonyReview(msgs, R.presentTelephonyReview(null), 'p1'), msgs);
});
