import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';

test('test source loading supports enums and parameter properties on Node 26', () => {
  const source = `
    enum Phase { Ready = 'ready' }
    class Session {
      constructor(readonly phase: Phase) {}
    }
    globalThis.result = new Session(Phase.Ready).phase;
  `;
  const context = {};
  vm.runInNewContext(stripTypeScriptTypes(source, {mode: 'transform'}), context);
  assert.equal(context.result, 'ready');
});

test('transforming a test source keeps value imports and removes type imports', () => {
  const source = `
    import {load} from './runtime.js';
    import type {Options} from './types.js';
    export class Session {
      constructor(readonly options: Options) {}
      run() { return load(this.options); }
    }
  `;
  const output = stripTypeScriptTypes(source);
  assert.match(output, /import \{ load \} from ["']\.\/runtime\.js["']/);
  assert.doesNotMatch(output, /types\.js|readonly|: Options/);
});
