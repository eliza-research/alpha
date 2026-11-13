import test from 'node:test';
import assert from 'node:assert/strict';
import {BROWSER_DISPATCH_FAILURE_KINDS} from '../vendor/eliza/plugins/plugin-browser/src/dispatch-types.ts';

test('refusal codes are typed dispatch failures the agent decodes',()=>{
 for(const code of ['UNSUPPORTED','UNAVAILABLE'])assert.ok(BROWSER_DISPATCH_FAILURE_KINDS.includes(code));
});
