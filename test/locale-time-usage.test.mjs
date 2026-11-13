import {test} from 'node:test';
import assert from 'node:assert/strict';

/** Argument text of the call whose opening parenthesis is at `open`, with nested parentheses. */
function args(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return text.slice(open + 1, i);
  }
  return '';
}
function bareTimeCalls(text) {
  const found = [];
  for (const match of text.matchAll(/([\w.$\])]*)\.toLocale(Time|Date)?String\(/g)) {
    const [, receiver, kind] = match, given = args(text, match.index + match[0].length - 1).trim();
    const showsTime = /\bhour\b|\btimeStyle\b/.test(given);
    // A number's toLocaleString() is not a time; only a Date-like receiver counts.
    const dateLike = /\)$|(?:date|Date|at|At|time|Time|now|stamp)$/.test(receiver);
    if (kind === 'Time' || (kind === 'Date' && showsTime) || (!kind && (showsTime || (!given && dateLike))))
      found.push(text.slice(0, match.index).split('\n').length);
  }
  return found;
}

test('bareTimeCalls finds time-bearing calls and ignores date-only and number calls', () => {
  assert.deepEqual(bareTimeCalls('new Date(x).toLocaleTimeString([],{hour:"numeric"})'), [1]);
  assert.deepEqual(bareTimeCalls('new Date(x).toLocaleString()'), [1]);
  assert.deepEqual(bareTimeCalls('d.toLocaleString(undefined,{dateStyle:"full",timeStyle:"long"})'), [1]);
  assert.deepEqual(bareTimeCalls('when.toLocaleDateString(undefined,{hour:"numeric"})'), [1]);
  assert.deepEqual(bareTimeCalls('new Date(x).toLocaleDateString()'), []);
  assert.deepEqual(bareTimeCalls('d.toLocaleDateString(undefined,{month:"short",day:"numeric"})'), []);
  assert.deepEqual(bareTimeCalls('file.size.toLocaleString()'), []);
});
