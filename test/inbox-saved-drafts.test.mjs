import {test} from 'node:test';
import {runChildSuite} from './fixtures/child-suite.mjs';
test('saved Inbox drafts use the platform store and preserve account/conflict boundaries',()=>{
 runChildSuite('test-inbox-saved-drafts.mjs',{timeout:30000});
});
