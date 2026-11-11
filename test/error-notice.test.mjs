import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';

const source = stripTypeScriptTypes(readFileSync(new URL('../apps/app/src/runtime/error-notice.ts', import.meta.url), 'utf8'), {mode: 'strip'})
  .replace(/^export /gm, '');
const context = vm.createContext({});
vm.runInContext(source + '\nglobalThis.api = {errorNotice, ERROR_TOAST};', context);
const {errorNotice, ERROR_TOAST} = context.api;

test('a sentence the app wrote for the owner is shown', () => {
  assert.equal(errorNotice(Error('The selection changed. Choose it again.'), 'Sharing is unavailable.'), 'The selection changed. Choose it again.');
  assert.equal(errorNotice('Couldn’t open the file.', 'Unavailable'), 'Couldn’t open the file.');
  assert.equal(errorNotice({message: 'Rename isn’t available for this file.'}, 'Rename unavailable'), 'Rename isn’t available for this file.');
});

test('platform exceptions and non-errors fall back', () => {
  assert.equal(errorNotice(new TypeError('Cannot read properties of undefined (reading \'id\')'), 'Not sent'), 'Not sent');
  assert.equal(errorNotice(new RangeError('Invalid time value'), 'Not sent'), 'Not sent');
  assert.equal(errorNotice(Object.assign(Error('The operation was aborted.'), {name: 'AbortError'}), 'Not sent'), 'Not sent');
  for (const value of [undefined, null, 0, 404, {}, {message: 7}, Error('')]) assert.equal(errorNotice(value, 'Not sent'), 'Not sent');
});

test('implementation vocabulary, code and long or multi-line text fall back', () => {
  for (const message of [
    'Selected note revision changed',
    'Saved-copy receipt identity changed',
    'Deletion cancelled before admission.',
    'Unexpected token < in JSON at position 0',
    'Request failed with HTTP 503',
    'fetch failed: https://example.invalid/api/notes',
    'workflow_intent missing',
    'store.read() returned undefined',
    'First line\nat Object.run (index.js:1:1)',
    'x'.repeat(201),
  ]) assert.equal(errorNotice(Error(message), 'Couldn’t save. Try again.'), 'Couldn’t save. Try again.', message);
});

test('the toast option marks a failure', () => {
  assert.equal(ERROR_TOAST.kind, 'error');
  assert.ok(Object.isFrozen(ERROR_TOAST));
});
