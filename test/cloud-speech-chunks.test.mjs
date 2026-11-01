import test from 'node:test';
import assert from 'node:assert/strict';
import {CLOUD_FIRST_SPEECH_CHARS, CLOUD_SPEECH_REQUEST_CHARS, planCloudSpeechChunks, speakCloudSpeechChunks} from '../.eliza/client-features/packages/voice/src/cloud-speech-chunks.ts';

const normalize = text => text.replace(/\s+/g, ' ').trim();
const first = 'Your next meeting starts at three o’clock.';
const reply = `${first} ${'The meeting notes are ready for you to review. '.repeat(160)}`;

test('short replies use one request; a long reply starts with its natural first sentence', () => {
  assert.deepEqual(planCloudSpeechChunks('  Hello.\n  '), ['Hello.']);
  assert.deepEqual(planCloudSpeechChunks(' \n '), []);
  const chunks = planCloudSpeechChunks(reply);
  assert.equal(chunks[0], first);
  assert.equal(chunks.join(' '), normalize(reply));
  assert.ok(chunks[0].length <= CLOUD_FIRST_SPEECH_CHARS);
  assert.ok(chunks.every(chunk => chunk.length <= CLOUD_SPEECH_REQUEST_CHARS));
  assert.ok(chunks.length < 5, 'the remainder is not one network request per sentence');
});

test('abbreviations and decimals stay in their sentence; long prose can start at a clause or word boundary', () => {
  const sentence = 'Your appointment is with Dr. Smith at 3.30 tomorrow.';
  assert.equal(planCloudSpeechChunks(`${sentence} ${'Please bring your notes. '.repeat(20)}`)[0], sentence);
  const clause = 'The draft contains your requested changes, ';
  const text = clause + 'and the review will continue '.repeat(20);
  const chunks = planCloudSpeechChunks(text);
  assert.equal(chunks[0], clause.trim());
  assert.equal(chunks.join(' '), normalize(text));
  const words = 'unpunctuated words '.repeat(500);
  const plain = planCloudSpeechChunks(words);
  assert.ok(plain[0].length <= CLOUD_FIRST_SPEECH_CHARS);
  assert.equal(plain.join(' '), normalize(words));
});

test('planning preserves Unicode, numbers, and long words without exceeding provider bounds', () => {
  const text = `  Résumé 東京 🦉  3.14159\n${'x'.repeat(400)} ${'more words '.repeat(700)}`;
  const chunks = planCloudSpeechChunks(text);
  assert.equal(chunks.join(' '), normalize(text));
  assert.ok(chunks.every(chunk => chunk.length <= CLOUD_SPEECH_REQUEST_CHARS));
  assert.throws(() => planCloudSpeechChunks(`${first} ${'x'.repeat(5001)}`), RangeError);
});

test('pieces are spoken sequentially and first audio is reported only once', async () => {
  const controller = new AbortController(), calls = [], callbacks = [], releases = [];
  let starts = 0;
  const pending = speakCloudSpeechChunks({text: reply, signal: controller.signal, assertCurrent() {}, onStarted() { starts++; },
    speak(text, signal, onStarted) {
      assert.equal(signal, controller.signal); calls.push(text); callbacks.push(onStarted);
      return new Promise(resolve => releases.push(resolve));
    },
  });
  assert.deepEqual(calls, [first]);
  callbacks[0](); callbacks[0](); assert.equal(starts, 1);
  releases[0](); await Promise.resolve();
  assert.equal(calls.length, 2, 'the second request begins only when the first retires');
  callbacks[1](); callbacks[0](); assert.equal(starts, 1);
  for (let index = 1; index < planCloudSpeechChunks(reply).length; index++) {
    releases[index](); await Promise.resolve();
  }
  await pending;
  assert.deepEqual(calls, planCloudSpeechChunks(reply));
  assert.equal(starts, 1);
});

test('aborting during playback prevents every later request and suppresses stale start callbacks', async () => {
  const controller = new AbortController(); let calls = 0, starts = 0, release, callback;
  const pending = speakCloudSpeechChunks({text: reply, signal: controller.signal, assertCurrent() {}, onStarted() { starts++; },
    speak(_text, _signal, onStarted) { calls++; callback = onStarted; return new Promise(resolve => release = resolve); },
  });
  controller.abort(); release();
  await assert.rejects(pending, {name: 'AbortError'});
  callback();
  assert.equal(calls, 1); assert.equal(starts, 0);
});

test('account changes and playback failures stop the sequence; invalid later text sends nothing', async () => {
  for (const fail of ['binding', 'playback']) {
    let current = true, calls = 0;
    const pending = speakCloudSpeechChunks({text: reply, signal: new AbortController().signal,
      assertCurrent() { if (!current) throw Error('Binding changed'); },
      async speak() { calls++; if (fail === 'playback') throw Error('Playback failed'); current = false; },
    });
    await assert.rejects(pending, fail === 'binding' ? /Binding changed/ : /Playback failed/);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(speakCloudSpeechChunks({text: `${first} ${'x'.repeat(5001)}`, signal: new AbortController().signal,
    assertCurrent() {}, async speak() { calls++; },
  }), RangeError);
  assert.equal(calls, 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(speakCloudSpeechChunks({text: reply, signal: controller.signal, assertCurrent() {}, async speak() { calls++; }}), {name: 'AbortError'});
  assert.equal(calls, 0);
});
