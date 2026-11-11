import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import vm from 'node:vm';
import {CapacitorException, ExceptionCode} from '@capacitor/core';

const source = readFileSync(process.env.ALPHA_BROWSER_ADAPTER_SOURCE || 'apps/app/src/prototype/browser-adapter.ts', 'utf8');
const start = source.indexOf('  let bookmarkRead:');
const end = source.indexOf('  function saveBookmark(', start);
assert.ok(start >= 0 && end > start, 'execute the actual bookmark read and coalescing paths');
const stateStart = source.indexOf('  const state = () =>');
const stateEnd = source.indexOf('\n', stateStart);
const titleStart = source.indexOf('  function retainedTitles(');
const titleEnd = source.indexOf('  let reading:', titleStart);
assert.ok(stateStart >= 0 && stateEnd > stateStart && titleStart >= 0 && titleEnd > titleStart, 'execute the actual browser state and retained-title helpers');
const bookmarkSource = stripTypeScriptTypes(source.slice(start, end) + source.slice(stateStart, stateEnd) + source.slice(titleStart, titleEnd), {mode: 'strip'});
const unsupported = () => new CapacitorException('Browser unavailable on this host', ExceptionCode.Unimplemented);

function fixture() {
  const state = {view: 'settings'}, errors = [], writes = [];
  const browserState = {titles: {'https://example.com': 'Example', 'https://retired.invalid': 'Retired'}, visits: []};
  let reads = 0, rejectRead, resolveRead;
  const context = {
    Promise, CapacitorException, ExceptionCode,
    Capacitor: {isNativePlatform: () => true},
    disposed: false, session: 'test-session', refresh() {},
    shell: {S: () => state, vget: () => browserState, vset: (...args) => writes.push(args)},
    report: error => {if (!context.disposed) errors.push(error);},
    Browser: {bookmarks: () => {
      reads++;
      return new Promise((resolve, reject) => {resolveRead = resolve; rejectRead = reject;});
    }},
  };
  const api = vm.runInNewContext(bookmarkSource + ';({refreshBookmarks, settled: () => bookmarkQueue})', context);
  return {
    state, errors, writes, context, api,
    get reads() {return reads;},
    async start(background = true) {api.refreshBookmarks(background); await Promise.resolve();},
    async fail(error = unsupported()) {rejectRead(error); await api.settled();},
    async succeed(urls) {resolveRead({urls}); await api.settled();},
  };
}

test('unsupported startup bookmark reads stay quiet outside Browser', async () => {
  const h = fixture(); await h.start(); await h.fail();
  assert.equal(h.errors.length, 0);
  assert.equal(h.writes.length, 0, 'a failed read cannot overwrite saved bookmarks');
});

test('opening Browser promotes its coalesced startup bookmark read', async () => {
  const h = fixture(); await h.start();
  h.state.view = 'browser'; h.api.refreshBookmarks(false);
  await h.fail();
  assert.equal(h.reads, 1, 'opening Browser shares the in-flight native read');
  assert.equal(h.errors.length, 1, 'the foreground failure is no longer suppressed');
  assert.equal(h.errors[0].code, ExceptionCode.Unimplemented);
});

test('a background notification cannot demote an explicit foreground read', async () => {
  const h = fixture(); await h.start();
  h.api.refreshBookmarks(false); h.api.refreshBookmarks(true);
  await h.fail();
  assert.equal(h.reads, 1);
  assert.equal(h.errors.length, 1);
});

test('an active Browser sees failure even before its foreground refresh callback', async () => {
  const h = fixture(); await h.start(); h.state.view = 'browser'; await h.fail();
  assert.equal(h.errors.length, 1);
});

test('real startup storage failures remain actionable and do not erase bookmarks', async () => {
  const h = fixture(), failure = new Error('Bookmark storage could not be read');
  await h.start(); await h.fail(failure);
  assert.equal(h.errors[0], failure);
  assert.equal(h.writes.length, 0);
});

test('a later foreground request retries after a quiet unsupported startup read', async () => {
  const h = fixture(); await h.start(); await h.fail();
  h.state.view = 'browser'; await h.start(false); await h.fail();
  assert.equal(h.reads, 2);
  assert.equal(h.errors.length, 1);
});

test('successful coalesced reads still publish bookmarks once', async () => {
  const h = fixture(); await h.start(); h.api.refreshBookmarks(false);
  await h.succeed(['https://example.com']);
  assert.equal(h.reads, 1); assert.equal(h.errors.length, 0);
  assert.equal(h.writes.length, 1);
  assert.deepEqual(Array.from(h.writes[0][1].marks), ['https://example.com']);
  assert.deepEqual(JSON.parse(JSON.stringify(h.writes[0][1].titles)), {'https://example.com': 'Example'}, 'only the retained bookmark keeps display metadata');
});
