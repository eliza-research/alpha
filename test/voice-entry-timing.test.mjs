import test from 'node:test';
import assert from 'node:assert/strict';

// Entry-sourced voice latency records under both send policies (voice-selection.ts
// voiceSendPolicy; P-39 auto-sends the voice assistant, A-10 measures it). The real voice-timing source and the
// real aggregator run on a deterministic clock. The views only choose the entry: a Cloud voice
// conversation started on Home or Calendar is a 'conversation' entry, the Notes recorder is a
// 'notes' entry whose send is the user's Save. The rendered integration is covered by
// test/browser/voice-timing.spec.ts and chat-voice-mode.spec.ts.
const store = new Map();
globalThis.localStorage = {getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k)};
const timing = await import('../apps/app/src/runtime/voice-timing.ts');
const {aggregate} = await import('../scripts/aggregate-voice-latency.mjs');
let now = 0;
timing.setVoiceTimingClock(() => now);
const RECOGNITION = 700, REVIEW = 2500, TOKEN = 400, REPLY = 900;

/** One turn through the send boundary. `review` is the user's decision when the policy asks for one. */
async function entryTurn({view, policy, decision = text => text + ' (edited)'}) {
  const entry = view === 'Notes' ? 'notes' : 'conversation', reviews = [], sent = [];
  now = 50_000;
  const id = timing.beginVoiceTurn({route: 'eliza-cloud', cold: false, entry, ...(entry === 'conversation' ? {policy} : {})});
  now += RECOGNITION; assert.equal(timing.markVoiceTiming('transcript-ready'), true);
  const outcome = await timing.sendVoiceEntry({
    // Notes always shows its transcript for editing and Save, whatever the conversation policy is.
    policy: entry === 'notes' ? 'review' : policy, transcript: 'Book the dentist',
    review: async text => { reviews.push(text); now += REVIEW; return decision(text); },
    send: async text => {
      sent.push(text);
      if (entry === 'notes') { timing.finishVoiceTurn(); return 'saved'; }
      now += TOKEN; timing.markVoiceTiming('first-token');
      now += REPLY - TOKEN; timing.markVoiceTiming('final-reply'); timing.finishVoiceTurn();
      return 'reply';
    },
  });
  return {id, entry, reviews, sent, outcome, row: timing.voiceTimingRecords().find(row => row.id === id)};
}

for (const policy of ['auto-send', 'review']) {
  for (const view of ['Home', 'Calendar']) test(`${policy}: a Cloud voice conversation turn from ${view} records its entry, policy and send boundary`, async () => {
    timing.clearVoiceTiming();
    const {entry, reviews, sent, outcome, row} = await entryTurn({view, policy});
    const reviewed = policy === 'review';
    assert.equal(entry, 'conversation');
    assert.deepEqual(reviews, reviewed ? ['Book the dentist'] : [], 'only the review policy asks the user before sending');
    assert.deepEqual(sent, [reviewed ? 'Book the dentist (edited)' : 'Book the dentist'], 'exactly one send, of the reviewed text');
    assert.equal(outcome.text, sent[0]);
    const send = RECOGNITION + (reviewed ? REVIEW : 0);
    assert.deepEqual(row.marks, {'recording-end': 0, 'transcript-ready': RECOGNITION, send, 'first-token': send + TOKEN, 'final-reply': send + REPLY});
    assert.equal(row.entry, 'conversation'); assert.equal(row.policy, policy); assert.equal(row.outcome, undefined);
    assert.doesNotMatch(timing.exportVoiceTiming(), /dentist/, 'the export never holds transcript text');
  });

  test(`${policy}: a reviewed Notes voice draft marks send at the explicit Save`, async () => {
    timing.clearVoiceTiming();
    const {reviews, sent, row} = await entryTurn({view: 'Notes', policy});
    assert.deepEqual(reviews, ['Book the dentist'], 'Notes always reviews: the conversation policy does not apply');
    assert.deepEqual(sent, ['Book the dentist (edited)']);
    assert.deepEqual(row.marks, {'recording-end': 0, 'transcript-ready': RECOGNITION, send: RECOGNITION + REVIEW});
    assert.equal(row.entry, 'notes'); assert.equal('policy' in row, false); assert.equal(row.outcome, undefined);
  });

  test(`${policy}: discarding the recording abandons its latency record and sends nothing`, async () => {
    timing.clearVoiceTiming();
    if (policy === 'review') {
      // Discard at the review step.
      const {reviews, sent, outcome, row} = await entryTurn({view: 'Home', policy, decision: () => null});
      assert.equal(reviews.length, 1); assert.deepEqual(sent, []); assert.equal(outcome, null);
      assert.equal(row.outcome, 'abandoned'); assert.equal(row.marks.send, undefined);
    } else {
      // Auto-send has no review step: a discard before the transcript is ready (cancel, keyboard,
      // account change) abandons the turn.
      now = 0; const id = timing.beginVoiceTurn({route: 'eliza-cloud', cold: true, entry: 'conversation', policy});
      now = 300; timing.abandonVoiceTurn();
      const row = timing.voiceTimingRecords().find(item => item.id === id);
      assert.equal(row.outcome, 'abandoned'); assert.deepEqual(row.marks, {'recording-end': 0});
    }
    // A failed send also abandons the turn, and never marks a reply.
    now = 0; timing.beginVoiceTurn({route: 'eliza-cloud', cold: false, entry: 'conversation', policy});
    now = 100; timing.markVoiceTiming('transcript-ready');
    await assert.rejects(timing.sendVoiceEntry({policy, transcript: 'Call home', review: async text => text, send: async () => { throw Error('Synthetic send failure'); }}), /Synthetic send failure/);
    const failed = timing.voiceTimingRecords().at(-1);
    assert.equal(failed.outcome, 'abandoned'); assert.equal(failed.marks.send, 100); assert.equal(failed.marks['final-reply'], undefined);
  });
}

test('a send boundary never marks or abandons a turn that started after it', async () => {
  timing.clearVoiceTiming();
  now = 0; const first = timing.beginVoiceTurn({route: 'eliza-cloud', cold: false, entry: 'conversation', policy: 'review'});
  now = 100; timing.markVoiceTiming('transcript-ready');
  let decide;
  const pending = timing.sendVoiceEntry({policy: 'review', transcript: 'First', review: () => new Promise(resolve => { decide = resolve; }), send: async text => text});
  // A newer recording supersedes the held review (beginVoiceTurn abandons the first turn).
  now = 200; const second = timing.beginVoiceTurn({route: 'eliza-cloud', cold: false, entry: 'conversation', policy: 'review'});
  decide(null); assert.equal(await pending, null);
  const rows = timing.voiceTimingRecords();
  assert.equal(rows.find(row => row.id === first).outcome, 'abandoned');
  assert.equal(rows.find(row => row.id === second).outcome, undefined, 'the newer turn is untouched');
  assert.equal(timing.activeVoiceTurn(), second);
});

test('the aggregator reads entry-sourced records and reports both review boundaries', async () => {
  timing.clearVoiceTiming();
  await entryTurn({view: 'Home', policy: 'review'});
  await entryTurn({view: 'Calendar', policy: 'auto-send'});
  await entryTurn({view: 'Notes', policy: 'auto-send'});
  await entryTurn({view: 'Home', policy: 'review', decision: () => null});
  const exported = JSON.parse(timing.exportVoiceTiming());
  const summary = aggregate([exported]);
  assert.deepEqual(Object.keys(summary.entries).sort(), ['conversation', 'notes']);
  assert.deepEqual({...summary.entries.conversation, recognition: undefined}, {records: 3, complete: 2, abandoned: 1, policies: {'auto-send': 1, review: 2}, recognition: undefined});
  assert.equal(summary.entries.conversation.recognition.p50, RECOGNITION);
  assert.deepEqual({records: summary.entries.notes.records, complete: summary.entries.notes.complete}, {records: 1, complete: 0}, 'a Notes save has no reply, so it is never a complete reply sample');
  assert.ok(summary.boundaries.excludingReview && summary.boundaries.includingReview);
  const warm = summary.cohorts.warm.phases;
  assert.deepEqual([warm.speechToTokenExcludingReview.p50, warm.speechToTokenExcludingReview.max], [RECOGNITION + TOKEN, RECOGNITION + TOKEN], 'excluding review, both policies measure the same');
  assert.deepEqual([warm.speechToTokenIncludingReview.p50, warm.speechToTokenIncludingReview.max], [RECOGNITION + TOKEN, RECOGNITION + REVIEW + TOKEN], 'including review, the reviewed turn carries its review time');
  const notesOnly = aggregate([exported], {entry: 'notes'});
  assert.equal(notesOnly.records, 1); assert.equal(notesOnly.entry, 'notes');
  assert.throws(() => aggregate([exported], {entry: 'chat'}), /Unknown entry/);
  // Older exports without an entry stay readable.
  const legacy = {...exported, records: exported.records.map(({entry, policy, ...row}) => row)};
  assert.deepEqual(Object.keys(aggregate([legacy]).entries), ['unspecified']);
  const invalid = {...exported, records: [{...exported.records[0], entry: 'composer'}]};
  assert.equal(aggregate([invalid]).invalid, 1);
});
