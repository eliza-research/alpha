import {test} from 'node:test';
import {runChildSuite} from './fixtures/child-suite.mjs';
test('new email preserves unfinished emails as separate account-scoped local drafts',()=>{runChildSuite('test-inbox-multiple-drafts.mjs',{timeout:30000});});
