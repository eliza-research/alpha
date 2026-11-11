import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join, relative} from 'node:path';

// Times shown on the phone go through apps/app/src/prototype/locale-time.ts, which applies the
// device locale and Android's 12/24-hour choice (a WebView's Intl cannot see the latter).
// A bare toLocaleTimeString, or a toLocaleString/toLocaleDateString that shows a time (no
// options, or hour/timeStyle), ignores that choice. Date-only calls are not checked.
const root = new URL('..', import.meta.url).pathname;
const src = join(root, 'apps/app/src');
// Files not yet converted. Each package that converts one removes it here; the test fails
// when a listed file no longer has a bare time call, so the list only shrinks.
const pending = new Set([
  'browser/calendar.ts', 'browser/clock.ts', 'browser/incoming-simulation.ts', 'browser/simulated-workflows.ts',
  'prototype/automations-adapter.ts', 'prototype/calendar-adapter.ts',
  'prototype/reminder-adapter.ts', 'prototype/settings-adapter.ts',
  'runtime/cloud-voice.ts', 'runtime/hosted-live-source-ui.tsx', 'runtime/reminder-creations.ts',
]);

function files(dir) {
  return readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(?:[jt]sx?|mjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : [];
  });
}
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

test('displayed times go through locale-time outside the files still pending conversion', () => {
  const offenders = [], stale = [];
  for (const path of files(src)) {
    const name = relative(src, path);
    if (name === 'prototype/locale-time.ts') continue;
    const lines = bareTimeCalls(readFileSync(path, 'utf8'));
    if (pending.has(name)) { if (!lines.length) stale.push(name); }
    else for (const line of lines) offenders.push(`${name}:${line}`);
  }
  assert.deepEqual(offenders, [], 'use formatTime or formatDateTime from prototype/locale-time.ts');
  assert.deepEqual(stale, [], 'these files are converted; remove them from the pending list');
});
