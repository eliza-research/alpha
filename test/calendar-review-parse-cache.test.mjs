import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {calendarReviewText} from '../apps/app/src/runtime/calendar-approval.ts';

// The Calendar approval presentation (apps/app/src/prototype/calendar-approval-adapter.ts) runs on
// every render of the conversation, including each streamed chunk of another reply.
const source = readFileSync('apps/app/src/prototype/calendar-approval-adapter.ts', 'utf8');
const start = source.indexOf('export function createCalendarReviewParses'), end = source.indexOf('/** Presentation only', start);
assert.ok(start > 0 && end > start);
const createCalendarReviewParses = new Function('calendarReviewText', stripTypeScriptTypes(source.slice(start, end), {mode: 'strip'}).replace(/^export /m, '') + '\nreturn createCalendarReviewParses;')(calendarReviewText);
const id = '11111111-2222-4333-8444-555555555555';
const block = `[CHOICE:approval-${id} id=${id}]\napprove ${id}=Approve\nreject ${id}=Deny\n[/CHOICE]`;

test('a message is parsed once while its text is unchanged; an edited or streamed message is parsed again', () => {
  let calls = 0;
  const parses = createCalendarReviewParses(text => { calls++; return calendarReviewText(text); });
  const first = parses.parse('m-1', 'Please review.\n' + block);
  assert.deepEqual(first, {displayText: 'Please review.', ids: [id]});
  for (let render = 0; render < 50; render++) assert.equal(parses.parse('m-1', 'Please review.\n' + block), first, 'the same object comes back');
  assert.equal(calls, 1);
  // A reply that is still streaming changes on every chunk and is parsed for each new text only.
  parses.parse('m-2', 'Work'); parses.parse('m-2', 'Work'); parses.parse('m-2', 'Working on it');
  assert.equal(calls, 3);
  assert.equal(parses.parse('m-1', 'Please review.\n' + block), first, 'other messages keep their parse while one streams');
  assert.equal(calls, 3);
});

test('parses of messages that left the conversation are forgotten', () => {
  const parses = createCalendarReviewParses();
  parses.parse('a', 'one'); parses.parse('b', 'two'); parses.parse('c', 'three');
  assert.equal(parses.size, 3);
  parses.retain(['b']);
  assert.equal(parses.size, 1);
  assert.deepEqual(parses.parse('b', 'two'), {displayText: 'two', ids: []});
});

test('the adapter renders through the per-shell cache and drops it on unmount', () => {
  assert.match(source, /cache\.retain\(\(out\.msgs\|\|\[\]\)\.map\(\(message:Shell\)=>String\(message\.id\)\)\);/);
  assert.match(source, /const parsed=cache\.parse\(String\(message\.id\),source\),/);
  assert.doesNotMatch(source.slice(end), /calendarReviewText\(/, 'no uncached parse in render');
  assert.match(source, /parses\.delete\(this\);return unmount\?\.call\(this\);/);
});
