import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';

const source = readFileSync('apps/app/src/prototype/settings-adapter.ts', 'utf8');
const start = source.indexOf('export function mergeDeviceFacts('), end = source.indexOf('export function installSettingsAdapter(', start);
assert.ok(start >= 0 && end > start);
const context = vm.createContext({});
vm.runInContext(`${stripTypeScriptTypes(source.slice(start, end)).replace('export function', 'function')}\nglobalThis.merge = mergeDeviceFacts;`, context);
const merge = (...args) => JSON.parse(JSON.stringify(context.merge(...args)));

test('a device read that overlapped a text-size change keeps the shown text size and takes every other fact', () => {
  const read = {textScalePercent: 100, effectiveTextZoom: 100, battery: 40, wifi: true};
  const shown = {textScalePercent: 130, effectiveTextZoom: 130, battery: 80};
  assert.deepEqual(merge(read, shown, true), {textScalePercent: 130, effectiveTextZoom: 130, battery: 40, wifi: true});
  assert.deepEqual(merge({}, shown, true), {textScalePercent: 130, effectiveTextZoom: 130});
  assert.deepEqual(merge(read, {}, true), read);
});

test('a read with no overlapping text-size change is used as read', () => {
  const read = {textScalePercent: 100, battery: 40};
  assert.equal(context.merge(read, {textScalePercent: 130}, false), read);
});

test('text-size controls retain the read generation and protect a pending or settled write', () => {
  const control=source.slice(source.indexOf('  async function changeTextScale('),source.indexOf('  p.componentDidMount ='));
  assert.match(control,/token=\+\+scaleGeneration/);
  assert.doesNotMatch(control,/\+\+generation/);
  assert.match(source,/scaleAtRead = scaleVersion/);
  assert.match(source,/scalePending \|\| scaleAtRead !== scaleVersion/);
});
