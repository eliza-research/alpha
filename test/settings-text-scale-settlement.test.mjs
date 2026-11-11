import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';

const source = readFileSync('apps/app/src/prototype/settings-adapter.ts', 'utf8');
const start = source.indexOf('export function textScaleSettlement('), end = source.indexOf('/** Device facts after a read.', start);
assert.ok(start >= 0 && end > start);
const context = vm.createContext({});
vm.runInContext(`${stripTypeScriptTypes(source.slice(start, end)).replace('export function', 'function')}\nglobalThis.settlement = textScaleSettlement;`, context);
const plain = value => JSON.parse(JSON.stringify(value));
const size = percent => ({textScalePercent: percent, effectiveTextZoom: percent});

test('when the newest text-size request fails, the applied older size is shown', () => {
  const results = context.settlement();
  // Requests 1 (115) and 2 (130) are in flight; the device applied 1 and rejected 2.
  assert.equal(results.applied(1, 2, size(115)), null);
  assert.deepEqual(plain(results.rejected(2, 2)), {newest: true, show: size(115)});
});

test('an older size that arrives after the newest request failed is shown on arrival', () => {
  const results = context.settlement();
  assert.deepEqual(plain(results.rejected(3, 3)), {newest: true, show: null});
  assert.deepEqual(plain(results.applied(1, 3, size(115))), size(115));
  assert.deepEqual(plain(results.applied(2, 3, size(130))), size(130));
  // A result older than one already shown never replaces it.
  const late = context.settlement();
  late.rejected(3, 3);
  assert.deepEqual(plain(late.applied(2, 3, size(130))), size(130));
  assert.equal(late.applied(1, 3, size(115)), null);
});

test('the newest result wins and an older result never replaces it', () => {
  const results = context.settlement();
  assert.equal(results.applied(1, 2, size(115)), null);
  assert.deepEqual(plain(results.applied(2, 2, size(130))), size(130));
  const reordered = context.settlement();
  assert.deepEqual(plain(reordered.applied(2, 2, size(130))), size(130));
  assert.equal(reordered.applied(1, 2, size(115)), null);
  // A later failure has nothing older to show: the size shown is already the device's.
  assert.deepEqual(plain(reordered.rejected(3, 3)), {newest: true, show: null});
});

test('an older failure is silent and a held size waits for the request that replaced the failed one', () => {
  const results = context.settlement();
  assert.deepEqual(plain(results.rejected(1, 2)), {newest: false, show: null});
  assert.deepEqual(plain(results.rejected(2, 2)), {newest: true, show: null});
  // Request 3 is issued; request 1's late result is held, then shown when 3 fails.
  const held = context.settlement();
  held.rejected(2, 2);
  assert.equal(held.applied(1, 3, size(115)), null);
  assert.deepEqual(plain(held.rejected(3, 3)), {newest: true, show: size(115)});
});

test('every text-size control uses the shared settlement and leaving Settings forgets held sizes', () => {
  assert.match(source, /void changeTextScale\(requested,api\)/);
  assert.match(source, /go:\(\)=>void changeTextScale\(value,api\)/);
  const control=source.slice(source.indexOf('  async function changeTextScale('),source.indexOf('  p.componentDidMount ='));
  assert.match(control,/scaleResults.applied\(token,scaleGeneration,result\)/);
  assert.match(control,/scaleResults.rejected\(token,scaleGeneration\)/);
  assert.match(source,/scalePending=false; scaleResults=textScaleSettlement\(\);/);
});
